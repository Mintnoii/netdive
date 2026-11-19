import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ClipboardCopy,
  FlaskConical,
  RotateCcw,
  Search,
  Loader2,
  Sparkles,
  ShieldAlert,
  Zap,
} from 'lucide-react'
import { tryit } from 'radash'
import type { ContextWatermark, TelemetryEvent } from '../types/telemetry'
import { formatRelativeTime } from '../types/telemetry'
import { parseTranscript } from '../services/transcriptParser'
import type { LocalSessionEntry } from '../services/localSessionScanner'
import {
  buildEvidence,
  buildRegressionCase,
  resolveCaseTrackingTag,
  buildTargetedReproPrompt,
  type RegressionCase,
  type RegressionEvidence,
} from '../services/regressionCase'
import {
  loadRegressionCases,
  upsertRegressionCase,
} from '../services/regressionCaseStore'
import {
  DEMO_SCENARIOS,
  type DemoScenario,
} from '../services/regressionDemoScenarios'

export interface RegressionPageProps {
  events: TelemetryEvent[]
  watermark: ContextWatermark
  sessionId: string
  sessionTitle?: string
  localSessions?: LocalSessionEntry[]
  onFetchTranscript?: (id: string) => Promise<string | null>
  onRefreshLocalSessions?: () => Promise<LocalSessionEntry[]>
}

export const RegressionPage: React.FC<RegressionPageProps> = ({
  watermark,
  localSessions = [],
  onFetchTranscript,
}) => {
  // 1. 已持久化的用例库真理源
  const [cases, setCases] = useState<RegressionCase[]>(() => loadRegressionCases())

  // 数据源模式：'demos' (演示场景库，默认) | 'local' (本地真实扫描会话)
  const [dataSourceMode, setDataSourceMode] = useState<'demos' | 'local'>('demos')

  // 2. 当前选中的失败会话 ID
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(() => DEMO_SCENARIOS[0]?.id ?? null)

  // 3. 筛选与搜索
  const [sessionSearch, setSessionSearch] = useState('')

  // 治愈翻牌状态
  const [isHealed, setIsHealed] = useState(false)

  // 逐病灶治理状态：被治理的病灶索引集合（用例提纯的最小单元）
  const [treatedFaults, setTreatedFaults] = useState<Set<number>>(new Set())

  // 4. 会话原文与证据的内存缓存（切换会话时 0ms 秒开，消灭频繁网络请求与列表跳动）
  const sessionCacheRef = useRef<
    Map<
      string,
      {
        events: TelemetryEvent[]
        watermark?: ContextWatermark
        evidence: RegressionEvidence[]
      }
    >
  >(new Map())

  // 5. 当前正在加载会话物理原文的 sessionId
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null)
  const [currentEvidence, setCurrentEvidence] = useState<RegressionEvidence[]>([])
  const [currentSessionEvents, setCurrentSessionEvents] = useState<TelemetryEvent[]>([])
  const [currentWatermark, setCurrentWatermark] = useState<ContextWatermark | null>(null)

  // 7. 交互复制反馈
  const [copiedPrompt, setCopiedPrompt] = useState(false)

  // 8. 本地历史中发生故障的会话集合（单一真理源）
  const failedLocalSessions = useMemo(() => {
    return localSessions.filter((s) => s.hasFailures)
  }, [localSessions])

  // 9. 构造演示场景列表 (Demo Scenarios)
  const demoItems = useMemo(() => {
    return DEMO_SCENARIOS.map((sc) => {
      const savedCase =
        cases.find(
          (c) =>
            c.sourceSessionId === sc.id ||
            c.id === `case-${sc.id}` ||
            c.id === sc.id
        ) ?? sc.initialCase

      return {
        id: sc.id,
        sessionId: sc.id,
        title: sc.title,
        project: sc.project,
        isCurated: Boolean(savedCase),
        caseItem: savedCase,
        mtime: sc.mtime,
        lineCount: sc.lineCount,
        techBadge: sc.techBadge,
        badgeTone: sc.badgeTone,
        scenario: sc,
        isDemo: true,
      }
    })
  }, [cases])

  // 本地扫描真实失败会话集合
  const localItems = useMemo(() => {
    const list: Array<{
      id: string
      sessionId?: string
      title: string
      project?: string
      isCurated: boolean
      caseItem?: RegressionCase
      mtime: number
      lineCount?: number
      techBadge?: string
      badgeTone?: string
      scenario?: DemoScenario
      isDemo: boolean
    }> = []

    for (const fs of failedLocalSessions) {
      const savedCase = cases.find(
        (c) => c.sourceSessionId === fs.id || c.id === `case-${fs.id}`
      )
      list.push({
        id: fs.id,
        sessionId: fs.id,
        title: savedCase?.title || fs.title,
        project: fs.project,
        isCurated: Boolean(savedCase),
        caseItem: savedCase,
        mtime: fs.mtime,
        lineCount: fs.lineCount,
        isDemo: false,
      })
    }
    return list.sort((a, b) => b.mtime - a.mtime)
  }, [failedLocalSessions, cases])

  // 当前激活的数据列表（由数据源切换决定）
  const activeItems = useMemo(() => {
    return dataSourceMode === 'demos' ? demoItems : localItems
  }, [dataSourceMode, demoItems, localItems])

  // 10. 过滤分流
  const filteredItems = useMemo(() => {
    const q = sessionSearch.trim().toLowerCase()
    return activeItems.filter((item) => {
      if (!q) return true
      return (
        item.title.toLowerCase().includes(q) ||
        (item.project && item.project.toLowerCase().includes(q))
      )
    })
  }, [activeItems, sessionSearch])

  // 12. 当前选中的失败会话条目
  const currentItem = useMemo(() => {
    if (!activeItems.length) return null
    return (
      activeItems.find(
        (i) => i.id === selectedSessionId || i.sessionId === selectedSessionId
      ) ?? activeItems[0]
    )
  }, [activeItems, selectedSessionId])

  const currentCase = currentItem?.caseItem ?? null

  const prevSelectedKeyRef = useRef<string | null>(null)

  // 13. 加载当前会话的物理故障特征（若已提炼则直读 case，若待提炼则拉取转录文本实时提取）
  useEffect(() => {
    if (!currentItem) return

    const currentKey = currentItem.sessionId || currentItem.id
    // 仅在真正切换到不同会话时，才重置对账状态
    if (prevSelectedKeyRef.current !== currentKey) {
      prevSelectedKeyRef.current = currentKey
      setIsHealed(false) // 切换会话时重置治愈态，回到原始故障现场
      setTreatedFaults(new Set())
      prevAllTreated.current = false
    }

    // 优先：如果是预置的演示场景，直接解构真实数据（0ms 无延迟）
    if (currentItem.scenario) {
      const sc = currentItem.scenario
      const evidence = currentItem.caseItem?.evidence ?? buildEvidence(sc.events)
      setCurrentEvidence(evidence)
      setCurrentSessionEvents(sc.events)
      setCurrentWatermark(sc.watermark)
      return
    }

    if (currentItem.caseItem) {
      setCurrentEvidence(currentItem.caseItem.evidence)
      setCurrentSessionEvents([])
      setCurrentWatermark(null)
      return
    }

    // 待提炼：检查内存缓存
    const cacheKey = currentItem.sessionId || currentItem.id
    const cached = sessionCacheRef.current.get(cacheKey)
    if (cached) {
      setCurrentEvidence(cached.evidence)
      setCurrentSessionEvents(cached.events)
      setCurrentWatermark(cached.watermark ?? null)
      return
    }

    // 无缓存：请求转录物理文本
    if (currentItem.sessionId && onFetchTranscript) {
      setLoadingSessionId(currentItem.sessionId)
      void (async () => {
        const text = await onFetchTranscript(currentItem.sessionId!)
        setLoadingSessionId(null)
        if (!text || !text.trim()) return

        const [, parsed] = tryit(() => parseTranscript(text))()
        if (!parsed || !parsed.events.length) return

        const evidence = buildEvidence(parsed.events)
        const entry = {
          events: parsed.events,
          watermark: parsed.watermark,
          evidence,
        }
        sessionCacheRef.current.set(cacheKey, entry)

        setCurrentEvidence(evidence)
        setCurrentSessionEvents(parsed.events)
        setCurrentWatermark(parsed.watermark ?? null)
      })()
    }
  }, [currentItem, onFetchTranscript])

  // 14. 聚合故障特征（消灭底层琐碎报错平铺，按命令/异常特征收敛聚类）
  const aggregatedFailures = useMemo(() => {
    const evList = currentCase?.evidence ?? currentEvidence
    if (!evList.length) return []

    const groups = new Map<
      string,
      {
        title: string
        command?: string
        rule: string
        count: number
        nodeIds: string[]
        outputHead: string[]
      }
    >()

    for (const ev of evList) {
      const key = ev.command ? `cmd:${ev.command}` : `rule:${ev.rule}`
      const existing = groups.get(key)
      if (existing) {
        existing.count += 1
        if (!existing.nodeIds.includes(ev.nodeId)) existing.nodeIds.push(ev.nodeId)
        if (existing.outputHead.length === 0 && ev.outputHead.length > 0) {
          existing.outputHead = ev.outputHead
        }
      } else {
        groups.set(key, {
          title: ev.title,
          command: ev.command,
          rule: ev.rule,
          count: 1,
          nodeIds: [ev.nodeId],
          outputHead: ev.outputHead,
        })
      }
    }

    return Array.from(groups.values())
  }, [currentCase, currentEvidence])

  // 逐病灶视图：把场景病灶或本地聚合故障统一为可治理的行数据
  const faultRows = useMemo(() => {
    const sc = currentItem?.scenario
    if (sc?.faults && sc.faults.length > 0) {
      return sc.faults.map((f) => ({
        type: f.type,
        command: f.command,
        summary: f.summary,
        detail: f.detail,
        cure: f.cureSummary || f.type,
        cureDetail: f.cureDetail || '',
        rawData: f.distillMethod?.beforeContent || f.detail,
        rawLabel: f.distillMethod?.beforeLabel || '原始数据',
        product: f.distillMethod?.afterContent || '',
        productLabel: f.distillMethod?.afterLabel || '提纯产物',
        pill: f.distillMethod?.pill || '',
      }))
    }
    return aggregatedFailures.map((g) => ({
      type: g.rule,
      command: g.command,
      summary: g.command ? `$ ${g.command} 触发 ${g.count} 次` : g.title,
      detail: g.rule,
      cure: `消除失败指纹 ${g.rule}`,
      cureDetail: '',
      rawData: g.outputHead.join('\n') || g.rule,
      rawLabel: '报错切片',
      product: `{ "rule": "${g.rule}", "expect": "failureCount === 0" }`,
      productLabel: '提纯产物',
      pill: '指纹去噪',
    }))
  }, [currentItem, aggregatedFailures])

  const treatedRows = useMemo(
    () => faultRows.filter((_, idx) => treatedFaults.has(idx)),
    [faultRows, treatedFaults]
  )
  const hasTreatedFault = treatedRows.length > 0
  const isAllFaultsTreated = faultRows.length > 0 && treatedFaults.size === faultRows.length

  // 提示轻量 Toast
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const prevAllTreated = useRef(false)

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 2500)
  }, [])

  useEffect(() => {
    const isAll = faultRows.length > 0 && treatedFaults.size === faultRows.length
    if (isAll && !prevAllTreated.current && !isHealed) {
      showToast('✓ 重跑指令已完整，可模拟应用')
    }
    prevAllTreated.current = isAll
  }, [treatedFaults.size, faultRows.length, isHealed, showToast])

  // 15. 当前用例唯一的追踪标签
  const currentCaseTag = useMemo(() => {
    if (currentCase) {
      return resolveCaseTrackingTag(currentCase)
    }
    if (currentItem) {
      return currentItem.project
        ? `${currentItem.project}#${(currentItem.sessionId || currentItem.id).slice(0, 8)}`
        : `case#${(currentItem.sessionId || currentItem.id).slice(0, 8)}`
    }
    return 'netdive-repro'
  }, [currentCase, currentItem])

  // 19. 重跑指令：只包含已治理病灶的准则，与左侧一一对应
  const targetedReproPrompt = useMemo(
    () =>
      buildTargetedReproPrompt({
        title: currentItem?.title || '回归用例',
        faults: treatedRows.map((f) => ({ type: f.type, command: f.command, cure: f.cure })),
        trackingTag: currentCaseTag,
      }),
    [currentItem, treatedRows, currentCaseTag]
  )

  // 19b. 指令结构化分段（用于在页面上高亮指纹与准则文案）
  const reproSections = useMemo(() => {
    const faults = treatedRows.map((f, i) => ({
      line: `- 病灶 0${i + 1} ${f.type}${f.command ? ` ($ ${f.command})` : ''}: ${f.cure}`,
      criterion: `- 病灶 0${i + 1} · ${f.type}：${f.cure}`,
    }))
    return {
      intro: '请针对以下回归测试用例重新执行任务，彻底修复已治理的故障：',
      task: `【任务目标】${currentItem?.title || '回归用例'}`,
      fingerprints: faults.length > 0
        ? faults.map((x) => x.line)
        : ['（待治理病灶后自动填入指纹 · 请先在下方「检出事故病灶」中点击治理）'],
      criteria: faults.length > 0
        ? [...faults.map((x) => x.criterion), '- 全局：峰值 Token 不超基线，前缀稳定，门禁拦截 = 0']
        : ['（待治理病灶后自动填入对应验收准则）', '- 全局：峰值 Token 不超基线，前缀稳定，门禁拦截 = 0'],
      hasFaults: faults.length > 0,
      tag: `<!-- [netdive-case: ${currentCaseTag}] -->`,
    }
  }, [treatedRows, currentItem, currentCaseTag])

  // 行动 1-0：治理 / 撤销单个病灶
  const handleToggleFault = (idx: number) => {
    setTreatedFaults((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
    setIsHealed(false)
  }

  // 行动 1-00：一键治理所有病灶（批量＝逐病灶提纯）
  const handleTreatAll = () => {
    setTreatedFaults(new Set(faultRows.map((_, i) => i)))
    setIsHealed(false)
  }

  // 行动 1-000：撤销所有病灶治理
  const handleUntreatAll = () => {
    setTreatedFaults(new Set())
    setIsHealed(false)
  }

  // 行动 1-C：重置会话到故障前初始状态（撤销治愈翻牌，并同步清空所有病灶治理）
  const handleResetHeal = () => {
    setIsHealed(false)
    setTreatedFaults(new Set())
    prevAllTreated.current = false
  }

  // 行动 2：一键复制重跑指令
  const handleCopyPrompt = async () => {
    if (!targetedReproPrompt) return
    const [err] = await tryit(() => navigator.clipboard.writeText(targetedReproPrompt))()
    if (err) return
    setCopiedPrompt(true)
    setTimeout(() => setCopiedPrompt(false), 2000)
  }

  // 行动 7：一键模拟优化重跑对账 (为演示与快速演练秒级注入全绿修复版报告)
  const handleSimulateRepro = () => {
    let targetCase = currentCase
    if (!targetCase && currentItem) {
      const events =
        currentSessionEvents.length > 0
          ? currentSessionEvents
          : (currentItem.scenario?.events ?? [
              {
                traceId: currentItem.sessionId || currentItem.id,
                nodeId: 'node-fail-1',
                type: 'node_complete' as const,
                gesture: 'bash' as const,
                actor: 'Pi (Agent)',
                title: currentItem.title,
                status: 'failed' as const,
                delta: '任务执行失败',
              },
            ])

      const wm = currentItem.scenario?.watermark ?? currentWatermark ?? watermark
      const newCase = buildRegressionCase({
        events,
        watermark: wm,
        taskKey: currentItem.project || 'local-task',
        title: currentItem.title,
        sourceSessionId: currentItem.sessionId || currentItem.id,
        createdAt: currentItem.mtime || Date.now(),
      })
      const updated = upsertRegressionCase(newCase)
      setCases(updated)
      targetCase = newCase
    }

    if (!targetCase) return
    // 核心：模拟重跑直接把顶部会话原地治愈翻牌，而非在下方冒出新大屏
    setIsHealed(true)
  }

  return (
    <div className="h-full w-full flex flex-col bg-[#FBF9F5] text-[#1E2024] select-text relative font-sans">
      {/* 提示轻量 Toast */}
      {toastMsg && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 pointer-events-none transition-all duration-200 ease-out">
          <div className="flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-[#1E2024] text-white text-xs font-medium shadow-lg border border-[#2E3238]">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{toastMsg}</span>
          </div>
        </div>
      )}
      {/* 顶部单栏标题 */}
      <div className="h-11 px-4 border-b border-[#E5E0D8] bg-[#F7F5F0] flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2.5">
          <FlaskConical className="w-4 h-4 text-indigo-600" />
          <span className="text-sm font-semibold tracking-tight text-[#1E2024]">用例提纯与回归工作台</span>
          <span className="text-xs text-[#8F887D]">|</span>
          <span className="text-xs text-[#5C5549] font-medium">
            失败会话特征捕获 ➔ 提炼测试用例与三维断言基线 ➔ 终端重跑自动对账验收
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* 左侧：本地全部失败会话列表 (Master List) */}
        <aside className="w-84 shrink-0 border-r border-[#E5E0D8] flex flex-col bg-[#FAF8F5]">
          {/* 数据源双轨分流：🌟 演示场景库 (默认激活) vs 📁 本机真实扫描会话 */}
          <div className="p-2.5 border-b border-[#E5E0D8] bg-[#F7F5F0] shrink-0">
            <div className="flex items-center p-0.5 bg-[#EFECE6] rounded-lg text-xs font-semibold border border-[#E5E0D8]">
              <button
                onClick={() => {
                  setDataSourceMode('demos')
                  setSelectedSessionId(demoItems[0]?.id ?? null)
                }}
                className={`flex-1 py-1.5 rounded-md text-center transition-all cursor-pointer flex items-center justify-center space-x-1.5 ${
                  dataSourceMode === 'demos'
                    ? 'bg-[#1E2024] text-white shadow-xs font-bold'
                    : 'text-[#5C5549] hover:text-[#1E2024] hover:bg-[#F7F5F0]'
                }`}
              >
                <span>🌟 演示场景库</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                  dataSourceMode === 'demos' ? 'bg-[#2E3238] text-white' : 'bg-[#EAE4D9] text-[#5C5549]'
                }`}>
                  {demoItems.length}
                </span>
              </button>
              <button
                onClick={() => {
                  setDataSourceMode('local')
                  setSelectedSessionId(localItems[0]?.id ?? null)
                }}
                className={`flex-1 py-1.5 rounded-md text-center transition-all cursor-pointer flex items-center justify-center space-x-1.5 ${
                  dataSourceMode === 'local'
                    ? 'bg-[#1E2024] text-white shadow-xs font-bold'
                    : 'text-[#5C5549] hover:text-[#1E2024] hover:bg-[#F7F5F0]'
                }`}
              >
                <span>📁 本地扫描</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                  dataSourceMode === 'local' ? 'bg-[#2E3238] text-white' : 'bg-[#EAE4D9] text-[#5C5549]'
                }`}>
                  {localItems.length}
                </span>
              </button>
            </div>
          </div>

          {/* 搜索 */}
          <div className="p-2.5 border-b border-[#E5E0D8] bg-[#FAF8F5] shrink-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-[#5C5549]">失败会话 ({activeItems.length})</span>
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#8F887D] absolute left-2.5 top-2 pointer-events-none" />
              <input
                type="text"
                value={sessionSearch}
                onChange={(e) => setSessionSearch(e.target.value)}
                placeholder={
                  dataSourceMode === 'demos'
                    ? '搜索演示测试场景...'
                    : '搜索失败会话意图或工程...'
                }
                className="w-full pl-7 pr-2 py-1 text-[11px] bg-[#F4F0EA] border border-[#E5E0D8] rounded-md text-[#1E2024] placeholder-[#8F887D] outline-none focus:border-[#1E2024] transition-colors"
              />
            </div>
          </div>

          {/* 会话列表项 (列表自身永不位移抖动) */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {filteredItems.length === 0 ? (
              <div className="p-6 text-[11px] text-[#8F887D] text-center leading-relaxed font-mono">
                未检测到符合条件的失败会话记录。
              </div>
            ) : (
              filteredItems.map((item) => {
                const isSelected =
                  currentItem?.id === item.id || currentItem?.sessionId === item.sessionId
                const isLoadingThis = loadingSessionId === (item.sessionId || item.id)

                return (
                  <div
                    key={item.id}
                    onClick={() => setSelectedSessionId(item.sessionId || item.id)}
                    className={`p-2.5 rounded-lg border cursor-pointer transition-all ${
                      isSelected
                        ? 'border-[#1E2024] bg-[#F4F0EA] shadow-xs ring-1 ring-[#1E2024]/10'
                        : 'border-[#E5E0D8] bg-white hover:bg-[#F7F5F0] hover:border-[#D5CFCE]'
                    }`}
                  >
                    <div className="flex items-start justify-between space-x-1.5">
                      <div className="flex items-start space-x-2 min-w-0 flex-1">
                        <FlaskConical className="w-3.5 h-3.5 text-indigo-600 mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-[#1E2024] truncate">
                            {item.title}
                          </div>

                          {/* 技术亮点徽标 (演示库特别突出) */}
                          {item.techBadge && (
                            <div className="mt-1">
                              <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border bg-indigo-50 text-indigo-700 border-indigo-200/80 inline-block">
                                {item.techBadge}
                              </span>
                            </div>
                          )}

                          <div className="text-[10px] text-[#8F887D] font-mono mt-1 flex items-center space-x-1.5 flex-wrap gap-y-0.5">
                            {item.project && (
                              <span className="text-[#5C5549] bg-[#EAE4D9] px-1 py-0.2 rounded border border-[#E5E0D8] font-medium">
                                {item.project}
                              </span>
                            )}
                            {item.mtime > 0 && <span>· {formatRelativeTime(item.mtime)}</span>}
                          </div>
                        </div>
                      </div>

                      {isLoadingThis && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600 shrink-0 mt-0.5" />
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </aside>

        {/* 右侧：递进式三层卡片详情区 (Detail View) */}
        <main className="flex-1 min-w-0 p-5 bg-[#FBF9F5] flex flex-col">
          {!currentItem ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 text-xs space-y-2">
              <FlaskConical className="w-8 h-8 text-slate-300" />
              <p>请在左侧选择一个失败会话进行复盘与用例提纯。</p>
            </div>
          ) : (
            /* 单一卡片：顶部会话信息 + 上半(左目标指标/右重跑指令) + 下半(固定高度病灶滚动区) */
            <div className="h-full flex flex-col bg-white rounded-xl border border-[#E5E0D8] shadow-xs overflow-hidden">
              {/* 顶部：会话基本信息 */}
              <div className="shrink-0 px-6 py-4 border-b border-[#EFECE6] flex items-center justify-between gap-4">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded border flex items-center space-x-1 ${
                        isHealed
                          ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                          : 'text-rose-700 bg-rose-50 border-rose-200'
                      }`}
                    >
                      {isHealed ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                      )}
                      <span>{isHealed ? '会话已治愈 (重跑验收通过)' : '翻车事故现场档案'}</span>
                    </span>
                    {currentItem.isDemo && (
                      <span className="text-[11px] font-mono text-indigo-800 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200/80 font-bold">🌟 预置复盘场景</span>
                    )}
                    {currentItem.project && (
                      <span className="text-[11px] font-mono text-[#5C5549] bg-[#EAE4D9] px-2 py-0.5 rounded border border-[#E5E0D8] font-medium">工程: {currentItem.project}</span>
                    )}
                    <span className="text-xs text-[#8F887D]">· {formatRelativeTime(currentItem.mtime)}</span>
                  </div>
                  <h2 className="text-lg font-bold text-[#1E2024] tracking-tight leading-snug">{currentItem.title}</h2>
                </div>
              </div>

              {/* 上半区：左(原始任务目标 + 体征) / 右(重跑指令 + 按钮) */}
              <div className="shrink-0 grid grid-cols-1 lg:grid-cols-2 gap-6 px-6 py-4 border-b border-[#EFECE6]">
                {/* 左：原始任务目标 + 三个体征指标（放大） */}
                <div className="space-y-3 min-w-0 flex flex-col justify-between">
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs font-bold text-[#1E2024] flex items-center space-x-1.5 mb-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                        <span>原始任务目标</span>
                      </div>
                      <div className="p-3 bg-[#FAF8F5] rounded-lg border border-[#E5E0D8] text-[13px] text-[#1E2024] leading-relaxed font-medium">
                        {currentItem.scenario?.userPrompt || currentItem.title}
                      </div>
                    </div>
                    {/* 三体征指标 */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className={`p-3 rounded-lg border transition-colors duration-200 ${isHealed ? 'bg-emerald-50/60 border-emerald-200' : 'bg-rose-50/50 border-rose-200'}`}>
                        <div className="text-[10px] font-semibold text-[#8F887D] mb-1">事故峰值 Tokens</div>
                        <div className={`text-lg font-black font-mono ${isHealed ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {isHealed ? Math.round((currentItem.scenario?.watermark.total ?? 38400) * 0.37).toLocaleString() : (currentItem.scenario?.watermark.total ?? 38400).toLocaleString()}
                          <span className="text-[10px] ml-1">tok</span>
                        </div>
                      </div>
                      <div className={`p-3 rounded-lg border transition-colors duration-200 ${isHealed ? 'bg-emerald-50/60 border-emerald-200' : 'bg-amber-50/50 border-amber-200'}`}>
                        <div className="text-[10px] font-semibold text-[#8F887D] mb-1">固定前缀缓存</div>
                        <div className={`text-lg font-black font-mono ${isHealed ? 'text-emerald-700' : 'text-amber-700'}`}>
                          {isHealed ? 'Stable' : 'Drifted'}
                        </div>
                      </div>
                      <div className={`p-3 rounded-lg border transition-colors duration-200 ${isHealed ? 'bg-emerald-50/60 border-emerald-200' : 'bg-[#FAF8F5] border-[#E5E0D8]'}`}>
                        <div className="text-[10px] font-semibold text-[#8F887D] mb-1">工具输出体积</div>
                        <div className={`text-lg font-black font-mono ${isHealed ? 'text-emerald-700' : 'text-[#1E2024]'}`}>
                          {isHealed ? '< 3KB' : '14.8KB'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 会话操作：锁死 h-8 高度，彻底根除有无按钮时的上下布局跳变 */}
                  <div className="h-8 flex items-center justify-start gap-2">
                    {isHealed ? (
                      <button
                        onClick={handleResetHeal}
                        className="h-7.5 px-3 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 text-[11px] font-medium flex items-center space-x-1.5 cursor-pointer transition-colors shadow-2xs"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>重置会话</span>
                      </button>
                    ) : (
                      faultRows.length > 0 &&
                      treatedFaults.size === faultRows.length && (
                        <button
                          onClick={handleSimulateRepro}
                          className="h-7.5 px-3 rounded-lg border border-emerald-600 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold flex items-center space-x-1.5 cursor-pointer transition-colors shadow-2xs animate-in fade-in"
                        >
                          <Zap className="w-3.5 h-3.5" />
                          <span>模拟应用重跑指令</span>
                        </button>
                      )
                    )}
                  </div>
                </div>

                {/* 右：重跑指令 + 精简按钮 */}
                <div className="space-y-2 min-w-0 flex flex-col justify-between">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold text-xs text-[#1E2024]">带追踪标签的重跑指令</div>
                    <div className="flex items-center space-x-2">
                      <button onClick={handleCopyPrompt} className="px-2 py-0.5 rounded border border-[#E5E0D8] bg-white hover:bg-[#FAF8F5] text-[#5C5549] text-[10px] font-medium flex items-center space-x-1 cursor-pointer transition-colors">
                        {copiedPrompt ? <Check className="w-3 h-3 text-emerald-600" /> : <ClipboardCopy className="w-3 h-3" />}
                        <span>{copiedPrompt ? '已复制' : '复制'}</span>
                      </button>
                      <div className="text-[10px] font-mono text-indigo-800 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200/80 font-semibold">
                        [{currentCaseTag}]
                      </div>
                    </div>
                  </div>
                  <div className="p-3 bg-[#FAF8F5] rounded-lg text-[11px] font-mono leading-relaxed overflow-auto h-48 border border-[#E5E0D8] whitespace-pre-wrap select-text text-[#1E2024]">
                    <div>{reproSections.intro}</div>
                    <div className="mt-2">{reproSections.task}</div>
                    <div className="mt-2 font-bold text-[#1E2024]">【已治理病灶指纹】</div>
                    {reproSections.fingerprints.map((line, i) => (
                      <div key={`fp-${i}`} className={reproSections.hasFaults ? 'text-emerald-700 bg-emerald-100/70 rounded px-1 font-semibold' : 'text-[#8F887D]'}>
                        {line}
                      </div>
                    ))}
                    <div className="mt-2 font-bold text-[#1E2024]">【验收通过准则】</div>
                    {reproSections.criteria.map((line, i) => (
                      <div key={`cr-${i}`} className={i === reproSections.criteria.length - 1 ? 'text-[#5C5549]' : reproSections.hasFaults ? 'text-emerald-700 bg-emerald-100/70 rounded px-1 font-semibold' : 'text-[#8F887D]'}>
                        {line}
                      </div>
                    ))}
                    <div className="mt-2 text-[#8F887D]">{reproSections.tag}</div>
                  </div>
                  {/* 右栏底部垫齐 h-8，使左右两栏底部绝对等高！ */}
                  <div className="h-8 flex items-center text-[10px] text-[#8F887D] font-mono">
                    <span>* 重跑指令已注入确定性微压缩与反震荡断言基线</span>
                  </div>
                </div>
              </div>

              {/* 下半区：检出病灶（固定高度容器 + 内部滚动） */}
              <div className="flex-1 min-h-0 flex flex-col px-6 py-4">
                <div className="shrink-0 flex items-center justify-between pb-2.5 border-b border-[#EFECE6] mb-3">
                  <div className="text-xs font-bold text-[#1E2024] flex items-center space-x-1.5">
                    <ShieldAlert className={`w-4 h-4 ${isAllFaultsTreated ? 'text-emerald-600' : 'text-rose-600'}`} />
                    <span>检出事故病灶与故障特征 ({faultRows.length})</span>
                  </div>
                  {faultRows.length > 0 && (
                    <div className="flex items-center space-x-2 h-7">
                      {hasTreatedFault && (
                        <button onClick={handleUntreatAll} className="h-7 px-2.5 rounded-md border border-[#E5E0D8] bg-white hover:bg-[#FAF8F5] text-[#5C5549] text-[11px] font-medium cursor-pointer transition-colors leading-none">撤销全部</button>
                      )}
                      {treatedFaults.size < faultRows.length && (
                        <button onClick={handleTreatAll} className="h-7 px-3 rounded-md border border-indigo-600 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold cursor-pointer transition-colors leading-none">一键治理全部 ({faultRows.length - treatedFaults.size})</button>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-1">
                  {faultRows.length > 0 ? (
                    faultRows.map((f, idx) => {
                      const isTreated = treatedFaults.has(idx)
                      return (
                        <div key={idx} className={`rounded-lg border transition-all ${isTreated ? 'border-emerald-200 bg-emerald-50/20' : 'border-rose-200 bg-rose-50/20'}`}>
                          {/* 行头：病灶标题 + 治理/撤销 */}
                          <div className="flex items-center justify-between px-3 py-2 border-b border-[#EFECE6] flex-wrap gap-2">
                            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                              <span className={`font-bold text-xs font-mono flex items-center space-x-1.5 leading-none ${isTreated ? 'text-emerald-900' : 'text-rose-900'}`}>
                                {isTreated ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />}
                                <span className="leading-none">病灶 0{idx + 1} · {f.type}</span>
                              </span>
                              {f.command && <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-white text-[#1E2024] border border-[#E5E0D8] leading-none">$ {f.command}</span>}
                            </div>
                            <button
                              onClick={() => handleToggleFault(idx)}
                              className={`h-7 px-2.5 rounded-md text-[11px] font-bold cursor-pointer transition-colors flex items-center space-x-1 border leading-none shrink-0 ${
                                isTreated
                                  ? 'border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800'
                                  : 'border-emerald-600 bg-emerald-600 hover:bg-emerald-700 text-white'
                              }`}
                            >
                              {isTreated ? <RotateCcw className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                              <span>{isTreated ? '撤销治理' : '治理'}</span>
                            </button>
                          </div>

                          {/* 行体：三栏严格等高 h-40（Zero CLS 保证） */}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3">
                            {/* 第一栏：病灶描述与治理后成效 */}
                            <div className="space-y-1.5 min-w-0 flex flex-col">
                              {/* 1. 标题行：病灶描述 + 治理建议并列 */}
                              <div className="flex items-center justify-between gap-2 h-5 shrink-0">
                                <div className="text-[10px] font-bold text-[#8F887D] uppercase tracking-wide">
                                  病灶描述
                                </div>
                                {f.pill && (
                                  <div className="flex items-center space-x-1 text-[10px] font-medium text-indigo-700 shrink-0">
                                    <span className="text-[#8F887D]">建议:</span>
                                    <span className="px-1.5 py-0.2 rounded bg-indigo-50 border border-indigo-200/80 font-mono font-bold text-indigo-800 leading-none">
                                      {f.pill}
                                    </span>
                                  </div>
                                )}
                              </div>

                              {/* 内容容器：固定 h-40 滚动，治理前后高度分毫不变 */}
                              <div className="h-40 overflow-y-auto p-2.5 bg-white rounded border border-[#E5E0D8] space-y-2">
                                <div className="space-y-1">
                                  <div className="text-[11px] font-semibold leading-relaxed text-[#1E2024]">
                                    {f.summary}
                                  </div>
                                  {f.detail && (
                                    <div className="text-[10px] font-mono leading-relaxed whitespace-pre-wrap text-rose-900/90">
                                      {f.detail}
                                    </div>
                                  )}
                                </div>

                                {/* 治理后成效：治理时平滑展开在描述下方 */}
                                {isTreated && (
                                  <div className="space-y-1 p-2 rounded bg-emerald-50/80 border border-emerald-200">
                                    <div className="text-[10px] font-bold text-emerald-800 uppercase tracking-wide">
                                      治理后成效
                                    </div>
                                    <div className="text-[11px] font-semibold leading-relaxed text-emerald-950">
                                      {f.cure}
                                    </div>
                                    {f.cureDetail && (
                                      <div className="text-[10px] font-mono leading-relaxed whitespace-pre-wrap text-emerald-800">
                                        {f.cureDetail}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* 第二栏：原始数据 */}
                            <div className="space-y-1.5 min-w-0 flex flex-col">
                              <div className="h-5 flex items-center shrink-0">
                                <span className="text-[10px] font-bold text-[#8F887D] uppercase tracking-wide">原始数据 · {f.rawLabel}</span>
                              </div>
                              <pre className="p-2.5 bg-[#1E2024] text-[#E5E0D8] rounded border border-[#2E3238] text-[10px] font-mono leading-relaxed whitespace-pre-wrap overflow-auto h-40">{f.rawData}</pre>
                            </div>

                            {/* 第三栏：提纯产物 */}
                            <div className="space-y-1.5 min-w-0 flex flex-col">
                              <div className="h-5 flex items-center shrink-0">
                                <span className={`text-[10px] font-bold uppercase tracking-wide ${isTreated ? 'text-emerald-700' : 'text-[#8F887D]'}`}>{isTreated ? `提纯产物 · ${f.productLabel}` : '提纯产物（待治理）'}</span>
                              </div>
                              {isTreated ? (
                                <pre className="p-2.5 bg-[#0f241d] text-emerald-200 rounded border border-emerald-800/70 text-[10px] font-mono leading-relaxed whitespace-pre-wrap overflow-auto h-40">{f.product}</pre>
                              ) : (
                                <div className="p-2.5 bg-white border border-dashed border-[#E5E0D8] rounded text-[10px] text-[#8F887D] flex items-center justify-center h-40">点「治理」后在此显示提纯产物</div>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })
                  ) : (
                    <div className="p-4 bg-white rounded-lg border border-[#E5E0D8] text-xs text-[#8F887D] text-center">未检出明确的故障病灶。</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
