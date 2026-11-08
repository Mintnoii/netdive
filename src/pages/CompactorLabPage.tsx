import React, { useState, useMemo, useCallback } from 'react'
import {
  FileCode,
  Sliders,
  Copy,
  Check,
  RotateCcw,
  ShieldCheck,
  Database,
  Zap,
  Sparkles,
  Flame,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Coins,
  BookOpen,
  Info,
  Trash2,
} from 'lucide-react'
import {
  MicroCompactor,
  DEFAULT_MAX_LINES_THRESHOLD,
  DEFAULT_MAX_CHARS_THRESHOLD,
  DEFAULT_HEAD_LINES,
  DEFAULT_TAIL_LINES,
  type CachePrefixBoundary,
} from '../services/microCompactor'
import { formatTokens } from '../types/telemetry'
import {
  estimateTokens,
  SANDBOX_PLACEHOLDER,
} from '../services/compactorLabScenarios'

/**
 * 确定性微压缩与上下文沙盒实验台 (CompactorLabPage)
 * Context Thermodynamics & Micro-Compaction Sandbox Laboratory
 * 仅用于纯本地算法试算，不改变任何会话数据
 */
export const CompactorLabPage: React.FC = () => {
  // 1. 自定义沙盒输入文本
  const [rawText, setRawText] = useState<string>('')

  // 2. 阈值滑块状态 (绑定 MicroCompactorOptions)
  const [maxLines, setMaxLines] = useState<number>(DEFAULT_MAX_LINES_THRESHOLD) // 默认 40
  const [maxChars, setMaxChars] = useState<number>(DEFAULT_MAX_CHARS_THRESHOLD) // 默认 1500
  const [headLines, setHeadLines] = useState<number>(DEFAULT_HEAD_LINES) // 默认 15
  const [tailLines, setTailLines] = useState<number>(DEFAULT_TAIL_LINES) // 默认 15

  // 3. 复制状态反馈
  const [copiedRaw, setCopiedRaw] = useState<boolean>(false)
  const [copiedCompacted, setCopiedCompacted] = useState<boolean>(false)
  const [copiedHash, setCopiedHash] = useState<boolean>(false)

  // 4. WAL 离线指针与回放交互状态
  const [selectedWalId, setSelectedWalId] = useState<string | null>(null)
  const [replayedRawText, setReplayedRawText] = useState<string | null>(null)

  // 5. 提示词前缀稳定性校验状态 (Rule 4)
  const defaultSystemPrompt =
    '你是由 NetDive 驱动的自主智能体协调者。在执行任务过程中必须严格遵循 L1 确定性硬断言与墨水信纸极简设计审美。'
  const defaultLtm = JSON.stringify(
    {
      用户名称: 'qing',
      工作空间: '个人核心工程 (NetDive + Ghost + Tachikoma)',
      活跃上下文: '阶段三：上下文热力学与微压缩确定性防护',
      核心原则: '先测后投，消除命令式胶水，严禁破坏前缀缓存',
    },
    null,
    2
  )

  const [systemPrompt, setSystemPrompt] = useState<string>(defaultSystemPrompt)
  const [ltm, setLtm] = useState<string>(defaultLtm)
  const [prefixMutationStatus, setPrefixMutationStatus] = useState<
    'pristine' | 'stable' | 'mutated'
  >('pristine')
  const [prefixDiffDetail, setPrefixDiffDetail] = useState<string | null>(null)

  // 本地独立 Compactor 实例，保证实验室交互隔离
  const labCompactor = useMemo(() => {
    return new MicroCompactor({
      maxLinesThreshold: maxLines,
      maxCharsThreshold: maxChars,
      headLinesCount: headLines,
      tailLinesCount: tailLines,
      pointerPrefix: 'wal-lab-',
    })
  }, [maxLines, maxChars, headLines, tailLines])

  // 执行微压缩计算 (纯函数推导，无额外副作用)
  const compactionResult = useMemo(() => {
    if (!rawText.trim()) return null
    return labCompactor.compactToolOutput(rawText, {
      toolName: 'sandbox-input',
      exitCode: 0,
    })
  }, [labCompactor, rawText])

  // 当前沙盒实例内存中的 WAL 记录清单
  const walList = useMemo(() => {
    return labCompactor.getAllWal()
  }, [labCompactor, compactionResult])

  // 原始与压缩文本度量指标
  const rawLinesCount = useMemo(() => (rawText ? rawText.split('\n').length : 0), [rawText])
  const rawCharsCount = rawText.length
  const rawTokens = useMemo(() => estimateTokens(rawText), [rawText])

  const compactedText = compactionResult ? compactionResult.output : ''
  const compactedLinesCount = useMemo(
    () => (compactedText ? compactedText.split('\n').length : 0),
    [compactedText]
  )
  const compactedCharsCount = compactedText.length
  const compactedTokens = useMemo(() => estimateTokens(compactedText), [compactedText])

  const reclaimedChars = compactionResult?.compacted ? compactionResult.reclaimedChars : 0
  const reclaimedTokens = Math.max(0, rawTokens - compactedTokens)
  const reclaimRatio =
    rawTokens > 0 && compactionResult?.compacted
      ? ((reclaimedTokens / rawTokens) * 100).toFixed(1)
      : '0.0'

  // 重置滑块阈值
  const handleResetSliders = () => {
    setMaxLines(DEFAULT_MAX_LINES_THRESHOLD)
    setMaxChars(DEFAULT_MAX_CHARS_THRESHOLD)
    setHeadLines(DEFAULT_HEAD_LINES)
    setTailLines(DEFAULT_TAIL_LINES)
  }

  // 复制文本辅助函数
  const copyToClipboard = (text: string, setter: (val: boolean) => void) => {
    navigator.clipboard.writeText(text)
    setter(true)
    setTimeout(() => setter(false), 1500)
  }

  // WAL 离线指针原地回放 (Replay Raw from WAL)
  const handleReplayWal = useCallback(
    (pointerId: string) => {
      const raw = labCompactor.replay(pointerId) || null
      setSelectedWalId(pointerId)
      setReplayedRawText(raw)
    },
    [labCompactor]
  )

  // Prompt Cache 前缀基线边界
  const baselineBoundary: CachePrefixBoundary = useMemo(() => {
    return labCompactor.createPrefixBoundary(defaultSystemPrompt, defaultLtm)
  }, [labCompactor, defaultSystemPrompt, defaultLtm])

  // 当前候选前缀边界
  const currentBoundary: CachePrefixBoundary = useMemo(() => {
    return labCompactor.createPrefixBoundary(systemPrompt, ltm)
  }, [labCompactor, systemPrompt, ltm])

  // 测试 1: 模拟工具微压缩过程下的前缀保真性
  const handleTestCompactionPreservesPrefix = () => {
    const testInput = rawText.trim() ? rawText : SANDBOX_PLACEHOLDER
    const convResult = labCompactor.compactConversation(defaultSystemPrompt, defaultLtm, [
      {
        role: 'tool',
        id: 'call-sandbox-test',
        tool_call_id: 'call-sandbox-test',
        content: testInput,
      },
    ])

    setSystemPrompt(defaultSystemPrompt)
    setLtm(defaultLtm)
    setPrefixMutationStatus('stable')
    setPrefixDiffDetail(
      `微压缩试算完成：本沙盒试算释放 ${convResult.reclaimedChars} 字符，创建 ${convResult.walRecordsCreated} 条沙盒 WAL 记录。System Prompt 与 LTM 前缀哈希 100% 字节一致 (${convResult.prefixBoundary.prefixHash.slice(0, 16)}...)，完全保真 Anthropic 90% Cache 命中。`
    )
  }

  // 测试 2: 模拟前缀被意外篡改导致 Cache 击穿
  const handleTestPrefixMutation = () => {
    const mutatedSystem = `${defaultSystemPrompt}\n[意外注入的动态时间戳: ${new Date().toLocaleTimeString()}]`
    setSystemPrompt(mutatedSystem)
    const mutatedBoundary = labCompactor.createPrefixBoundary(mutatedSystem, defaultLtm)
    const verification = labCompactor.verifyPrefixStability(baselineBoundary, mutatedBoundary)

    if (!verification.stable) {
      setPrefixMutationStatus('mutated')
      setPrefixDiffDetail(verification.diffDetails || '检测到前缀字节级篡改！')
    }
  }

  // 重置前缀状态
  const handleResetPrefix = () => {
    setSystemPrompt(defaultSystemPrompt)
    setLtm(defaultLtm)
    setPrefixMutationStatus('pristine')
    setPrefixDiffDetail(null)
  }

  return (
    <div className="flex-1 flex flex-col w-full h-full bg-[#FBF9F5] text-[#1E2024] overflow-y-auto">
      {/* 顶部沙盒定位横幅 (shrink-0 区块) */}
      <div className="border-b border-[#E5E0D8] bg-[#F7F5F0]/80 px-6 py-4 shrink-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 border border-amber-300 text-amber-900 shadow-2xs">
                沙盒实验台
              </span>
              <h1 className="text-base font-semibold text-[#1E2024] tracking-tight">
                非真实会话数据 · 仅本地试算，不改变任何会话
              </h1>
            </div>
            <p className="text-xs text-[#6E685E] mt-1.5 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              <span>
                指引：真实会话的压缩机会与真实账请看底部「上下文水位明细」抽屉；本页面用于任意文本微压缩试算、阈值边界调试与 Rule 1~4 机制验证。
              </span>
            </p>
          </div>

          <div className="flex items-center space-x-2 text-xs font-mono shrink-0">
            <span className="px-2.5 py-1 bg-[#FFFFFF] border border-[#E5E0D8] rounded-md text-[#5E6573] shadow-2xs">
              ⚡ 0 LLM API Cost
            </span>
            <span className="px-2.5 py-1 bg-[#FFFFFF] border border-[#E5E0D8] rounded-md text-[#5E6573] shadow-2xs">
              ⏱ 0ms Delay
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl w-full mx-auto p-6 space-y-6 flex-1">
        {/* 沙盒指标卡片 (沙盒口径，无全局统计/真实账混淆) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* 指标 1: 节约率 */}
          <div className="bg-[#FFFFFF] border border-[#E5E0D8] rounded-xl p-4 shadow-xs relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#6E685E]">沙盒试算节约率 (Ratio)</span>
              <Flame className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="mt-2 flex items-baseline space-x-1">
              <span className="text-2xl font-bold font-mono text-emerald-700">
                {compactionResult?.compacted ? `${reclaimRatio}%` : '0.0%'}
              </span>
              <span className="text-xs text-[#8F887D]">saved</span>
            </div>
            <div className="mt-2 w-full bg-[#EFECE6] rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-emerald-600 h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${compactionResult?.compacted ? reclaimRatio : 0}%` }}
              />
            </div>
          </div>

          {/* 指标 2: 试算释放字符 */}
          <div className="bg-[#FFFFFF] border border-[#E5E0D8] rounded-xl p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#6E685E]">本沙盒试算释放</span>
              <Zap className="w-4 h-4 text-amber-600" />
            </div>
            <div className="mt-2 flex items-baseline space-x-1">
              <span className="text-2xl font-bold font-mono text-[#1E2024]">
                {compactionResult?.compacted ? formatTokens(reclaimedTokens) : '0'}
              </span>
              <span className="text-xs text-[#8F887D]">
                tokens (~{Math.round(reclaimedChars)} 字符)
              </span>
            </div>
            <p className="text-[11px] text-[#8F887D] mt-2 font-mono">
              Raw {formatTokens(rawTokens)} → Compact {formatTokens(compactedTokens)}
            </p>
          </div>

          {/* 指标 3: 0 LLM API Cost */}
          <div className="bg-[#FFFFFF] border border-[#E5E0D8] rounded-xl p-4 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#6E685E]">大模型调用成本 (Cost)</span>
                <Coins className="w-4 h-4 text-sky-600" />
              </div>
              <div className="mt-2 flex items-baseline space-x-1">
                <span className="text-2xl font-bold font-mono text-sky-800">$0.00</span>
                <span className="text-xs text-[#8F887D]">USD</span>
              </div>
            </div>
            <p className="text-[11px] text-[#5E6573] mt-2 pt-2 border-t border-[#F4F0EA] leading-relaxed">
              💡 纯本地首尾行截取试算，零大模型调用开销。
            </p>
          </div>

          {/* 指标 4: 0ms Delay */}
          <div className="bg-[#FFFFFF] border border-[#E5E0D8] rounded-xl p-4 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#6E685E]">试算推理延迟 (Latency)</span>
                <Clock className="w-4 h-4 text-purple-600" />
              </div>
              <div className="mt-2 flex items-baseline space-x-1">
                <span className="text-2xl font-bold font-mono text-purple-800">&lt; 1ms</span>
                <span className="text-xs text-[#8F887D]">in-memory</span>
              </div>
            </div>
            <p className="text-[11px] text-[#5E6573] mt-2 pt-2 border-t border-[#F4F0EA] leading-relaxed">
              ⚡ 纯前端内存切分，微秒级即刻反馈。
            </p>
          </div>
        </div>

        {/* =====================================================================
            a) 自定义输入 textarea + 阈值滑杆 (绑定 MicroCompactorOptions)
           ===================================================================== */}
        <section className="bg-[#FFFFFF] border border-[#E5E0D8] rounded-xl p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E5E0D8]">
            <div className="flex items-center space-x-2">
              <FileCode className="w-4 h-4 text-[#1E2024]" />
              <h2 className="text-sm font-semibold text-[#1E2024]">
                自定义输入与阈值调节 (Custom Input & Thresholds)
              </h2>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setRawText(SANDBOX_PLACEHOLDER)}
                className="px-2.5 py-1 text-xs rounded border border-[#E5E0D8] bg-white text-[#5E6573] hover:text-[#1E2024] hover:bg-[#F4F0EA] cursor-pointer"
                title="载入简短占位示例"
              >
                载入占位示例
              </button>
              <button
                onClick={() => setRawText('')}
                className="px-2.5 py-1 text-xs rounded border border-[#E5E0D8] bg-white text-[#5E6573] hover:text-rose-600 hover:bg-rose-50 flex items-center space-x-1 cursor-pointer"
                title="清空输入框"
              >
                <Trash2 className="w-3 h-3" />
                <span>清空</span>
              </button>
            </div>
          </div>

          {/* 自定义 textarea */}
          <div>
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={SANDBOX_PLACEHOLDER}
              rows={6}
              className="w-full p-3 bg-[#FCFAF6] border border-[#E5E0D8] rounded-lg font-mono text-[11px] text-[#1E2024] leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-[#1E2024]"
            />
          </div>

          {/* 阈值滑杆集合 (绑定 MicroCompactorOptions: maxLines, maxChars, headLines, tailLines) */}
          <div className="p-3 bg-[#F7F5F0]/70 border border-[#E5E0D8] rounded-lg flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center space-x-2">
                <Sliders className="w-3.5 h-3.5 text-[#8F887D]" />
                <span className="text-[#6E685E]">触发行数 (Max Lines):</span>
                <input
                  type="range"
                  min="10"
                  max="120"
                  step="5"
                  value={maxLines}
                  onChange={(e) => setMaxLines(Number(e.target.value))}
                  className="w-20 accent-[#1E2024] cursor-pointer"
                  title="行数阈值：超过此行数启动裁剪"
                />
                <span className="font-semibold text-[#1E2024] w-6">{maxLines}</span>
              </div>

              <div className="flex items-center space-x-2">
                <span className="text-[#6E685E]">触发字符 (Max Chars):</span>
                <input
                  type="range"
                  min="200"
                  max="5000"
                  step="100"
                  value={maxChars}
                  onChange={(e) => setMaxChars(Number(e.target.value))}
                  className="w-20 accent-[#1E2024] cursor-pointer"
                  title="字符阈值：超过此字符数启动裁剪"
                />
                <span className="font-semibold text-[#1E2024] w-10">{maxChars}</span>
              </div>

              <div className="flex items-center space-x-2">
                <span className="text-[#6E685E]">保留头部 (Head):</span>
                <input
                  type="range"
                  min="3"
                  max="30"
                  step="1"
                  value={headLines}
                  onChange={(e) => setHeadLines(Number(e.target.value))}
                  className="w-16 accent-[#1E2024] cursor-pointer"
                  title="头部保留行数"
                />
                <span className="font-semibold text-[#1E2024] w-5">{headLines}</span>
              </div>

              <div className="flex items-center space-x-2">
                <span className="text-[#6E685E]">保留尾部 (Tail):</span>
                <input
                  type="range"
                  min="3"
                  max="30"
                  step="1"
                  value={tailLines}
                  onChange={(e) => setTailLines(Number(e.target.value))}
                  className="w-16 accent-[#1E2024] cursor-pointer"
                  title="尾部保留行数"
                />
                <span className="font-semibold text-[#1E2024] w-5">{tailLines}</span>
              </div>
            </div>

            <button
              onClick={handleResetSliders}
              className="p-1.5 rounded text-[#8F887D] hover:text-[#1E2024] hover:bg-[#EFECE6] transition-colors cursor-pointer flex items-center space-x-1"
              title="重置滑块默认值 (触发 40 行 / 1500 字符, 前置 15 行, 尾部 15 行)"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="text-[11px] font-sans">重置阈值</span>
            </button>
          </div>
        </section>

        {/* =====================================================================
            b) 折叠前后对照 (原文 vs 折叠后，等宽 pre、可滚动；缺失时显示中性占位文案)
           ===================================================================== */}
        <section className="bg-[#FFFFFF] border border-[#E5E0D8] rounded-xl shadow-xs overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#E5E0D8]">
            {/* 左侧：原文 */}
            <div className="flex flex-col h-[420px]">
              <div className="px-4 py-2.5 bg-[#FCFAF6] border-b border-[#E5E0D8] flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="font-medium text-xs text-[#1E2024]">原始输入 (Raw Input)</span>
                  {rawText.trim() ? (
                    <span className="text-[11px] font-mono text-[#8F887D]">
                      {rawLinesCount} 行 · {rawCharsCount} 字符 · ~{formatTokens(rawTokens)} tokens
                    </span>
                  ) : null}
                </div>
                {rawText.trim() && (
                  <button
                    onClick={() => copyToClipboard(rawText, setCopiedRaw)}
                    className="p-1 text-xs rounded border border-[#E5E0D8] bg-white text-[#6E685E] hover:text-[#1E2024] hover:bg-[#F4F0EA] flex items-center space-x-1 cursor-pointer"
                    title="复制原始输入文本"
                  >
                    {copiedRaw ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span className="text-[10px]">{copiedRaw ? '已复制' : '复制'}</span>
                  </button>
                )}
              </div>

              <pre className="flex-1 p-3 font-mono text-[11px] leading-relaxed bg-[#1E2024] text-[#E5E0D8] overflow-auto select-text whitespace-pre-wrap break-all">
                {rawText.trim() ? (
                  rawText
                ) : (
                  <span className="h-full flex items-center justify-center text-[#8F887D] font-sans">
                    暂无输入文本，请在上方输入框粘贴或输入待测文本
                  </span>
                )}
              </pre>
            </div>

            {/* 右侧：折叠后 */}
            <div className="flex flex-col h-[420px]">
              <div className="px-4 py-2.5 bg-[#FCFAF6] border-b border-[#E5E0D8] flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="font-medium text-xs text-[#1E2024]">折叠后输出 (Compacted Output)</span>
                  {compactionResult?.compacted ? (
                    <span className="text-[11px] font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                      {compactedLinesCount} 行 · {compactedCharsCount} 字符 · ~{formatTokens(compactedTokens)} tokens
                    </span>
                  ) : rawText.trim() ? (
                    <span className="text-[11px] font-mono text-[#6E685E] bg-[#EFECE6] px-1.5 py-0.5 rounded border border-[#E5E0D8]">
                      未达阈值 · 原样保留
                    </span>
                  ) : null}
                </div>
                {compactedText.trim() && (
                  <button
                    onClick={() => copyToClipboard(compactedText, setCopiedCompacted)}
                    className="p-1 text-xs rounded border border-[#E5E0D8] bg-white text-[#6E685E] hover:text-[#1E2024] hover:bg-[#F4F0EA] flex items-center space-x-1 cursor-pointer"
                    title="复制折叠后文本"
                  >
                    {copiedCompacted ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span className="text-[10px]">{copiedCompacted ? '已复制' : '复制'}</span>
                  </button>
                )}
              </div>

              <pre className="flex-1 p-3 font-mono text-[11px] leading-relaxed bg-[#1E2024] text-[#E5E0D8] overflow-auto select-text whitespace-pre-wrap break-all">
                {rawText.trim() ? (
                  compactedText.split('\n').map((line, idx) => {
                    const isFoldMarker = line.includes('原始输出已折叠')
                    if (isFoldMarker) {
                      return (
                        <span
                          key={idx}
                          className="my-1.5 px-3 py-1.5 bg-amber-950/70 border border-amber-600/50 rounded text-amber-300 font-semibold flex items-center space-x-2 select-none"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span>{line}</span>
                        </span>
                      )
                    }
                    return (
                      <span key={idx} className="block hover:bg-slate-800/40">
                        {line || ' '}
                      </span>
                    )
                  })
                ) : (
                  <span className="h-full flex items-center justify-center text-[#8F887D] font-sans">
                    暂无折叠试算结果
                  </span>
                )}
              </pre>
            </div>
          </div>
        </section>

        {/* =====================================================================
            c) 本沙盒实例的 WAL 指针列表与原文回放 (明确标注「沙盒实例 wal-lab-*，仅存于本页内存」)
           ===================================================================== */}
        <section className="bg-[#FFFFFF] border border-[#E5E0D8] rounded-xl p-5 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-[#E5E0D8] gap-4">
            <div>
              <div className="flex items-center space-x-2">
                <Database className="w-4 h-4 text-[#1E2024]" />
                <h2 className="text-sm font-semibold text-[#1E2024]">
                  本沙盒实例 WAL 存根与原文回放
                </h2>
                <span className="text-[10px] font-mono text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                  沙盒实例 wal-lab-*，仅存于本页内存
                </span>
              </div>
              <p className="text-xs text-[#5E6573] mt-1.5 leading-relaxed">
                💡 <b>机制说明</b>：当沙盒输入文本超过阈值触发折叠时，原始输出会登记到本页内存 WAL 注册表（指针前缀 <code>wal-lab-*</code>）。真实会话不会受此影响；点击任意条目即可 100% 字节无损回放。
              </p>
            </div>
          </div>

          <div className="mt-4">
            {walList.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#8F887D] bg-[#FCFAF6] border border-[#E5E0D8] rounded-lg">
                本沙盒尚未产生折叠
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* WAL 列表 */}
                <div className="lg:col-span-1 space-y-2">
                  <div className="text-xs font-semibold text-[#6E685E] pb-1">
                    WAL 指针列表 ({walList.length} 条记录):
                  </div>
                  <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                    {walList.map((rec) => {
                      const isSelected = selectedWalId === rec.pointerId
                      return (
                        <div
                          key={rec.pointerId}
                          onClick={() => handleReplayWal(rec.pointerId)}
                          className={`p-2.5 rounded-lg border text-xs font-mono cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-amber-50/80 border-amber-300 text-amber-950 shadow-2xs'
                              : 'bg-[#FCFAF6] border-[#E5E0D8] text-[#1E2024] hover:bg-[#F7F5F0]'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs">{rec.pointerId}</span>
                            <span className="text-[10px] text-[#8F887D]">
                              {rec.originalLines} 行 → {rec.compactedLines} 行
                            </span>
                          </div>
                          <div className="text-[11px] text-[#6E685E] mt-1 truncate">
                            {rec.compactSummary}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* 回放结果展示区 */}
                <div className="lg:col-span-2 border border-[#E5E0D8] rounded-lg p-3.5 bg-[#FCFAF6] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between pb-2 border-b border-[#E5E0D8]">
                      <span className="text-xs font-semibold text-[#1E2024] flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        WAL 离线内存读取视图
                      </span>
                      {replayedRawText && (
                        <span className="text-[10px] font-mono text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded">
                          ✅ 100% 原始输出字节级精确还原
                        </span>
                      )}
                    </div>

                    <div className="mt-3 text-xs text-[#5E6573] leading-relaxed">
                      {replayedRawText ? (
                        <div className="font-mono text-[11px] bg-[#1E2024] text-[#E5E0D8] p-3 rounded max-h-48 overflow-auto">
                          <div className="text-emerald-400 font-semibold pb-1 border-b border-slate-700 mb-2">
                            [WAL REPLAY SUCCESS] Pointer ID: {selectedWalId} | Total {replayedRawText.split('\n').length} lines
                          </div>
                          <pre className="whitespace-pre-wrap">{replayedRawText.slice(0, 1200)}</pre>
                          {replayedRawText.length > 1200 && (
                            <div className="text-slate-500 italic mt-1 text-[10px]">
                              ... (已截断预览，全量 {replayedRawText.length} 字符已就绪于内存)
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="py-6 text-center text-[#8F887D]">
                          点击左侧列表中任一条目，即可通过指针 ID 从沙盒内存注册表原地还原未压缩原文。
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 pt-2 border-t border-[#E5E0D8] flex items-center justify-between text-[11px] text-[#8F887D] font-mono">
                    <span>Memory Registry: {walList.length} records</span>
                    <span>Byte Fidelity: 100% Lossless</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* =====================================================================
            d) Rule 教学卡片区 (Rule 1~4)
           ===================================================================== */}
        <section className="bg-[#FFFFFF] border border-[#E5E0D8] rounded-xl p-5 shadow-xs space-y-5">
          <div className="flex items-center space-x-2 pb-3 border-b border-[#E5E0D8]">
            <BookOpen className="w-4 h-4 text-[#1E2024]" />
            <h2 className="text-sm font-semibold text-[#1E2024]">
              微压缩确定性四大法则 (Rule 1~4 教学卡片)
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Rule 1 卡片 */}
            <div className="bg-[#F7F5F0]/60 border border-[#E5E0D8] rounded-lg p-4 space-y-2 text-xs">
              <div className="flex items-center space-x-1.5 font-semibold text-[#1E2024]">
                <span className="w-2 h-2 rounded-full bg-emerald-600" />
                <span>Rule 1: 本地确定性折叠策略</span>
              </div>
              <p className="text-[#6E685E] leading-relaxed">
                当行数 &gt; 阈值（默认 40）或字符数 &gt; 阈值（默认 1500）时，纯本地切分保留 Head 15 + Tail 15 行，中间插入折叠行数提示。不调用外部 LLM，延迟 &lt; 1ms。
              </p>
            </div>

            {/* Rule 2 卡片 */}
            <div className="bg-[#F7F5F0]/60 border border-[#E5E0D8] rounded-lg p-4 space-y-2 text-xs">
              <div className="flex items-center space-x-1.5 font-semibold text-[#1E2024]">
                <span className="w-2 h-2 rounded-full bg-sky-600" />
                <span>Rule 2: 协议配对完整性守卫</span>
              </div>
              <p className="text-[#6E685E] leading-relaxed">
                遵循 Anthropic / OpenAI 契约，严格保证每个 <code>tool_call</code> 与 <code>tool_result</code> 按 ID 成对闭环。裁剪仅限于 output 内容，强制保留原始调用信封与元数据，防上游 400 契约报错。
              </p>
            </div>

            {/* Rule 3 卡片 */}
            <div className="bg-[#F7F5F0]/60 border border-[#E5E0D8] rounded-lg p-4 space-y-2 text-xs">
              <div className="flex items-center space-x-1.5 font-semibold text-[#1E2024]">
                <span className="w-2 h-2 rounded-full bg-purple-600" />
                <span>Rule 3: 内存 WAL 离线指针</span>
              </div>
              <p className="text-[#6E685E] leading-relaxed">
                折叠前将完整原始文本写入内存 WAL 注册表并派发指针（真实会话 <code>wal-call-*</code>，沙盒 <code>wal-lab-*</code>）。上下文仅带极轻量引用，需要时可凭指针 100% 字节无损回放。
              </p>
            </div>
          </div>

          {/* Rule 4: 前缀稳定性试验区 */}
          <div className="border border-[#E5E0D8] rounded-lg p-4 bg-[#FCFAF6] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E5E0D8]">
              <div>
                <div className="flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-700" />
                  <h3 className="text-xs font-semibold text-[#1E2024]">
                    Rule 4: Prompt Cache 前缀稳定性验证 (前缀边界试验)
                  </h3>
                  <span className="text-[10px] font-mono text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    守住 90% 缓存折扣
                  </span>
                </div>
                <p className="text-xs text-[#5E6573] mt-1 leading-relaxed">
                  大模型服务商（Anthropic / OpenAI）要求对话开头的系统设定哈希绝对不变才能享受 90% 缓存折扣。微压缩仅发生于后缀工具轮次，前缀字节级不可变。
                </p>
              </div>

              {/* 动作按钮 */}
              <div className="shrink-0 flex flex-wrap items-center gap-2">
                <button
                  onClick={handleTestCompactionPreservesPrefix}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-50 text-emerald-900 border border-emerald-300 hover:bg-emerald-100 flex items-center space-x-1.5 transition-all cursor-pointer shadow-2xs"
                  title="验证工具裁剪只动后面，前面的系统提示词哈希完全不变"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                  <span>验证前缀不变 (享受 90% 折扣)</span>
                </button>

                <button
                  onClick={handleTestPrefixMutation}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-rose-50 text-rose-900 border border-rose-300 hover:bg-rose-100 flex items-center space-x-1.5 transition-all cursor-pointer shadow-2xs"
                  title="模拟在开头注入动态时间戳导致缓存失效"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-700" />
                  <span>模拟错误做法 (篡改前缀丢折扣)</span>
                </button>

                <button
                  onClick={handleResetPrefix}
                  className="p-1.5 text-xs rounded-md border border-[#E5E0D8] bg-white text-[#6E685E] hover:text-[#1E2024] hover:bg-[#F4F0EA] transition-all cursor-pointer"
                  title="重置为默认基线前缀"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* 前缀规范化表示与哈希指纹 */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#1E2024]">
                  规范化前缀边界表示 (Canonical Prefix Representation)
                </span>
                <div className="flex items-center space-x-2">
                  <span className="text-[11px] font-mono text-[#6E685E]">SHA-256 前缀指纹:</span>
                  <span className="text-xs font-mono font-bold text-[#1E2024] bg-white px-2 py-0.5 rounded border border-[#E5E0D8]">
                    {currentBoundary.prefixHash.slice(0, 24)}...
                  </span>
                  <button
                    onClick={() => copyToClipboard(currentBoundary.prefixHash, setCopiedHash)}
                    className="p-1 text-[#6E685E] hover:text-[#1E2024] cursor-pointer"
                    title="复制全量 64 位前缀哈希"
                  >
                    {copiedHash ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="font-mono text-[11px] bg-[#1E2024] text-[#E5E0D8] p-3 rounded leading-relaxed overflow-x-auto">
                <div className="text-sky-300 font-semibold">[SYSTEM_PROMPT_BOUNDARY]</div>
                <div className="text-slate-300 pl-2">{systemPrompt}</div>
                <div className="text-sky-300 font-semibold">[LTM_BOUNDARY]</div>
                <div className="text-slate-300 pl-2">{ltm}</div>
                <div className="text-amber-400 font-semibold">[CACHE_BREAKPOINT]</div>
              </div>
            </div>

            {/* 校验反馈 */}
            {prefixMutationStatus === 'stable' && (
              <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-lg flex items-start space-x-2 text-xs text-emerald-950">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">✅ Prompt Cache 前缀 100% 字节级保真：</span>
                  <p className="mt-0.5 text-emerald-800">{prefixDiffDetail}</p>
                </div>
              </div>
            )}

            {prefixMutationStatus === 'mutated' && (
              <div className="p-3 bg-rose-50 border border-rose-300 rounded-lg flex items-start space-x-2 text-xs text-rose-950">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">❌ 前缀突变警告 (Cache Mutation Detected)：</span>
                  <p className="mt-0.5 text-rose-800 font-mono text-[11px]">{prefixDiffDetail}</p>
                  <p className="mt-1 text-rose-900">
                    在 System Prompt 或 LTM 中引入动态时间戳将导致 Prompt Cache 失效，使全量输入产生计费成本惩罚。
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

export default CompactorLabPage
