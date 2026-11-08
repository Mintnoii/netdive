import React, { useEffect, useMemo, useState } from 'react'
import {
  X,
  Layers,
  Info,
  ChevronDown,
} from 'lucide-react'
import type {
  ContextPart,
  ContextPartKind,
  ContextPrompt,
  ContextWatermark,
  TelemetryEvent,
} from '../types/telemetry'
import { formatTokens } from '../types/telemetry'
import {
  ContextPromptMap,
  PART_LABELS,
  CONTEXT_PART_KINDS,
  type PromptFocus,
} from './ContextPromptMap'
import { ContextTextOverlay } from './ContextTextOverlay'
import { analyzeCompactionOpportunities } from '../services/compactionOpportunities'
import { useWalStats } from '../hooks/useWalStats'
import { CompactionPreviewOverlay } from './CompactionPreviewOverlay'
import { FALLBACK_CONTEXT_WINDOW } from '../services/modelWindows'

export interface ContextInspectorDrawerProps {
  isOpen: boolean
  onClose: () => void
  watermark: ContextWatermark
  events?: TelemetryEvent[]
  sessionTitle?: string
  sessionId?: string
}

const HEALTH_BADGES = [
  { max: 65, label: '健康', cls: 'bg-emerald-50 text-emerald-700', dotCls: 'bg-emerald-500' },
  { max: 85, label: '告警', cls: 'bg-amber-50 text-amber-700', dotCls: 'bg-amber-500' },
  { max: Infinity, label: '紧张', cls: 'bg-rose-50 text-rose-700', dotCls: 'bg-rose-500' },
] as const

const PROVENANCE_BADGES: Record<
  'counted' | 'estimated' | 'live',
  { label: string; cls: string; dotCls: string; title: string }
> = {
  counted: {
    label: '实测 Counted',
    cls: 'bg-emerald-50 text-emerald-700',
    dotCls: 'bg-emerald-500',
    title: '来自真实 usage（JSONL 的 message.usage）',
  },
  estimated: {
    label: '估算 Estimated',
    cls: 'bg-amber-50 text-amber-700',
    dotCls: 'bg-amber-500',
    title: '该会话 JSONL 未记录 usage，Token 按字符量启发式粗估',
  },
  live: {
    label: '实时 Live',
    cls: 'bg-indigo-50 text-indigo-700',
    dotCls: 'bg-indigo-500',
    title: '由实时流增量与手势启发式推算，非真实 usage',
  },
}

const PART_DOT_CLASSES: Record<ContextPartKind, string> = {
  system: 'bg-violet-500',
  tools: 'bg-indigo-500',
  skills: 'bg-fuchsia-500',
  memory: 'bg-sky-500',
  files: 'bg-emerald-500',
  results: 'bg-amber-500',
  chat: 'bg-slate-500',
}

const PART_FILL_CLASSES: Record<ContextPartKind, string> = {
  system: 'bg-violet-500',
  tools: 'bg-indigo-500',
  skills: 'bg-fuchsia-500',
  memory: 'bg-sky-500',
  files: 'bg-emerald-500',
  results: 'bg-amber-500',
  chat: 'bg-slate-500',
}

export const ContextInspectorDrawer: React.FC<ContextInspectorDrawerProps> = ({
  isOpen,
  onClose,
  watermark,
  events,
  sessionTitle,
  sessionId,
}) => {
  const [focus, setFocus] = useState<PromptFocus | null>(null)
  const [overlay, setOverlay] = useState<{ kind: ContextPartKind } | null>(null)
  const [isPreviewOverlayOpen, setIsPreviewOverlayOpen] = useState(false)

  const walStats = useWalStats(isOpen)

  const analysis = useMemo(() => {
    return analyzeCompactionOpportunities(events ?? [])
  }, [events])

  // 监听 Escape 键盘快捷键收起抽屉（浮层打开时只关闭浮层）
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (isPreviewOverlayOpen) {
          setIsPreviewOverlayOpen(false)
          return
        }
        if (overlay !== null) {
          setOverlay(null)
          return
        }
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isPreviewOverlayOpen, overlay, onClose])

  // 1. 全维上下文指标计算 (契约对齐与兼容降级)
  const maxCapacity = watermark.maxCapacity || watermark.totalLimit || FALLBACK_CONTEXT_WINDOW
  const systemPromptTokens = watermark.systemPrompt || 0
  const ltmTokens = watermark.ltm || 0
  const reasoningTokens = watermark.reasoningTokens || 0
  const conventionalHistoryTokens =
    watermark.conversationHistory !== undefined
      ? watermark.conversationHistory
      : Math.max(0, (watermark.activeTurns || 0) - reasoningTokens)
  const dialogueTokens = conventionalHistoryTokens + reasoningTokens
  const toolOutputsTokens =
    watermark.toolOutputs !== undefined ? watermark.toolOutputs : watermark.prunableTools || 0
  const cacheReadTokens = watermark.cacheRead || 0

  const totalUsed =
    watermark.total !== undefined
      ? watermark.total
      : systemPromptTokens + ltmTokens + dialogueTokens + toolOutputsTokens

  const usagePercent = Math.min(100, Math.round((totalUsed / maxCapacity) * 100))
  const remainingTokens = Math.max(0, maxCapacity - totalUsed)
  const cacheHitRate =
    totalUsed + cacheReadTokens > 0
      ? Math.round((cacheReadTokens / (totalUsed + cacheReadTokens)) * 100)
      : 0

  const health = HEALTH_BADGES.find((h) => usagePercent < h.max) ?? HEALTH_BADGES[2]
  const provenanceBadge = watermark.provenance ? PROVENANCE_BADGES[watermark.provenance] : null

  // 2. 规范化 ContextPrompt 契约
  const prompt = useMemo<ContextPrompt>(() => {
    if (watermark.prompt && watermark.prompt.parts && watermark.prompt.parts.length > 0) {
      const existingKinds = new Set(watermark.prompt.parts.map((p) => p.kind))
      const allParts: ContextPart[] = [...watermark.prompt.parts]
      for (const kind of CONTEXT_PART_KINDS) {
        if (!existingKinds.has(kind)) {
          allParts.push({ kind, tokens: 0, items: [] })
        }
      }
      return {
        tokens: watermark.prompt.tokens || totalUsed,
        window: watermark.prompt.window || maxCapacity,
        parts: allParts,
      }
    }

    // 兼容历史旧水印数据
    const fallbackParts: ContextPart[] = CONTEXT_PART_KINDS.map((kind) => {
      if (kind === 'system' && systemPromptTokens > 0) {
        return {
          kind,
          tokens: systemPromptTokens,
          items: [{ tag: 'prompt', name: '系统提示词', tokens: systemPromptTokens }],
        }
      }
      if (kind === 'chat' && dialogueTokens > 0) {
        return {
          kind,
          tokens: dialogueTokens,
          items: [{ tag: 'turn', name: '会话内容', tokens: dialogueTokens }],
        }
      }
      if (kind === 'results' && toolOutputsTokens > 0) {
        return {
          kind,
          tokens: toolOutputsTokens,
          items: [{ tag: 'result', name: '工具结果', tokens: toolOutputsTokens }],
        }
      }
      return { kind, tokens: 0, items: [] }
    })

    return {
      tokens: totalUsed,
      window: maxCapacity,
      parts: fallbackParts,
    }
  }, [watermark.prompt, totalUsed, maxCapacity, systemPromptTokens, dialogueTokens, toolOutputsTokens])

  // 所有 part 最大 token 数（供 mini bar 比例尺使用）
  const maxPartTokens = useMemo(() => {
    let max = 0
    for (const kind of CONTEXT_PART_KINDS) {
      const part = prompt.parts.find((p) => p.kind === kind)
      const tokens = part?.tokens ?? 0
      if (tokens > max) max = tokens
    }
    return max > 0 ? max : 1
  }, [prompt.parts])

  const overlayPart = overlay
    ? prompt.parts.find((p) => p.kind === overlay.kind) ?? null
    : null

  if (!isOpen) return null

  return (
    <>
      {/* 轻遮罩 (Fade-in Backdrop) */}
      <div
        className="fixed inset-0 z-40 bg-[#1E2024]/20 drawer-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* 面板本体 (Floating Bottom Sheet: 高度恒等于 min(66vh, 640px)) */}
      <section
        role="region"
        aria-label="上下文水位明细抽屉"
        className="fixed inset-x-0 bottom-0 z-50 flex flex-col h-[min(72vh,700px)] rounded-t-2xl border-t-2 border-[#DCD5C9] bg-[#FBF9F5] text-[#1E2024] font-sans [font-variant-numeric:tabular-nums] shadow-[0_-8px_24px_rgba(30,32,36,0.10)] overflow-hidden drawer-sheet-up"
      >
        {/* 顶部把手：点击即收起 */}
        <button
          type="button"
          onClick={onClose}
          aria-label="收起明细抽屉"
          className="w-full flex justify-center pt-1.5 pb-1 cursor-pointer group shrink-0"
        >
          <span className="w-10 h-1 rounded-full bg-[#D6D0C5] group-hover:bg-[#B5AFA4] transition-colors" />
        </button>

        {/* 内容区：三段卡片节奏 */}
        <div className="flex-1 min-h-0 flex flex-col gap-3.5 px-5 pb-3">
          {/* 第 1 段：顶部大盘 (Top Overview) */}
          <div className="shrink-0 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-0.5 rounded bg-violet-50 text-violet-700 shrink-0">
                  <Layers className="w-3.5 h-3.5" />
                </div>
                <span className="text-[13px] font-semibold text-[#1E2024]">上下文窗口</span>
                <span className={`inline-flex items-center gap-1.5 h-5 rounded-full px-2 text-[11px] font-medium ${health.cls}`}>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${health.dotCls}`} />
                  <span>{health.label}</span>
                </span>
                {provenanceBadge && (
                  <span
                    className={`inline-flex items-center gap-1.5 h-5 rounded-full px-2 text-[11px] font-medium ${provenanceBadge.cls}`}
                    title={provenanceBadge.title}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${provenanceBadge.dotCls}`} />
                    <span>{provenanceBadge.label}</span>
                  </span>
                )}
                {(sessionTitle || sessionId) && (
                  <span className="text-[11px] font-mono text-[#A8A29E] truncate max-w-[160px]">
                    {sessionTitle || sessionId}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-md text-[#8F887D] hover:text-[#1E2024] hover:bg-[#EAE5DC] transition-colors cursor-pointer shrink-0"
                title="收起抽屉 (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-end justify-between gap-6">
              {/* 大盘指标块 (.facts 风格：三格分别「已用 / 窗口上限 / 剩余」) */}
              <div className="flex items-end gap-8 pt-2 border-t border-[#EFEAE2]">
                {/* 格 1: 已用 */}
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-[#8F887D]">
                    已用 ({usagePercent}%)
                  </span>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xl font-semibold text-[#1E2024]">
                      {formatTokens(totalUsed)}
                    </span>
                    {(watermark.provenance === 'estimated' || watermark.provenance === 'live') && (
                      <span className="text-[10px] text-[#8F887D]">推算值</span>
                    )}
                  </div>
                </div>

                {/* 格 2: 窗口上限 */}
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-[#8F887D]">窗口上限</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-[13px] font-semibold text-[#1E2024]">
                      {formatTokens(maxCapacity)}
                    </span>
                    {watermark.windowSource === 'default' && (
                      <span className="text-[10px] text-[#8F887D]" title="按 200k 兜底">
                        (兜底)
                      </span>
                    )}
                  </div>
                </div>

                {/* 格 3: 剩余 */}
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-[#8F887D]">剩余</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-[13px] font-semibold text-[#1E2024]">
                      {formatTokens(remainingTokens)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Cache 块 */}
              <div className="pt-2.5 border-t border-[#EFEAE2] flex flex-col gap-1 items-end w-full max-w-[280px]">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[11px] text-[#8F887D]">提示词缓存</span>
                  <span className="text-[13px] font-semibold text-[#1E2024]">{cacheHitRate}% 命中</span>
                </div>
                <div className="h-1 w-full max-w-[280px] rounded-full bg-[#ECE8E1] overflow-hidden">
                  <div
                    style={{ width: `${Math.min(100, Math.max(0, cacheHitRate))}%` }}
                    className="h-full bg-amber-500 rounded-full"
                  />
                </div>
                <div className="text-[10px] text-[#A8A29E]">
                  {formatTokens(cacheReadTokens)} 来自缓存 · {formatTokens(totalUsed)} 新增
                </div>
              </div>
            </div>
          </div>

          {/* 第 2 段：上下文分布图 (ContextPromptMap: 单一 Treemap 视图) */}
          <div className="shrink-0 border-t border-[#EFEAE2] pt-3.5">
            <div className="h-[124px] w-full">
              <ContextPromptMap
                prompt={prompt}
                focus={focus}
                onFocus={setFocus}
                onOpenPart={(kind) => setOverlay({ kind })}
              />
            </div>
          </div>

          {/* 第 3 段：内容清单收敛为 7 个 part 概要行 */}
          <div className="flex-1 min-h-0 flex flex-col border-t border-[#EFEAE2] pt-3.5">
            <div className="shrink-0 flex items-center justify-between pb-1.5 mb-1.5 select-none">
              <span className="text-[11px] font-semibold text-[#5E6573]">内容构成</span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5 pr-1">
              {CONTEXT_PART_KINDS.map((kind) => {
                const part = prompt.parts.find((p) => p.kind === kind)
                const tokens = part?.tokens ?? 0
                const isEmpty = tokens === 0
                const pct = prompt.window > 0 ? Math.round((tokens / prompt.window) * 100) : 0
                const fillWidthPct = Math.min(100, Math.max(0, (tokens / maxPartTokens) * 100))
                const isFocused = focus?.kind === kind
                const itemCount = part?.items?.reduce((sum, it) => sum + (it.n ?? 1), 0) ?? 0
                const primaryTag = part?.items?.[0]?.tag

                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setOverlay({ kind })}
                    onMouseEnter={() => setFocus({ kind })}
                    onMouseLeave={() => setFocus(null)}
                    className={`w-full flex items-center gap-2 min-h-[26px] px-1.5 -mx-1.5 rounded-md text-[12px] hover:bg-[#F4F0EA] transition-colors cursor-pointer select-none text-left ${
                      isFocused ? 'bg-[#F4F0EA]' : ''
                    } ${isEmpty ? 'opacity-50' : ''}`}
                  >
                    {/* dot */}
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${PART_DOT_CLASSES[kind]}`}
                    />
                    {/* 名称 */}
                    <span className="text-[12px] font-medium text-[#1E2024] truncate">
                      {PART_LABELS[kind]}
                    </span>
                    {/* ×n */}
                    {itemCount > 1 && (
                      <span className="text-[11px] text-[#8F887D] shrink-0">
                        ×{itemCount}
                      </span>
                    )}
                    {/* tag 芯片 */}
                    {primaryTag && (
                      <span className="text-[10px] px-1.5 py-[1px] rounded bg-[#F4F0EA] text-[#8F887D] shrink-0">
                        {primaryTag}
                      </span>
                    )}
                    <div className="flex-1" />
                    {/* mini bar */}
                    <div className="w-[72px] h-1 rounded-sm bg-[#ECE8E1] shrink-0 overflow-hidden">
                      <div
                        style={{ width: `${fillWidthPct}%` }}
                        className={`h-full ${PART_FILL_CLASSES[kind]}`}
                      />
                    </div>
                    {/* token 值 */}
                    <span className="w-12 text-right text-[11.5px] text-[#5E6573] shrink-0">
                      {formatTokens(tokens)}
                    </span>
                    {/* 占比 */}
                    <span className="w-9 text-right text-[10px] text-[#A8A29E] shrink-0">
                      {pct}%
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* 压缩机会摘要条 (Compaction Opportunities Summary Bar) */}
        <div className="shrink-0 px-5 py-2 border-t border-[#E5E0D8] bg-[#FAF8F5] flex items-center justify-between text-[11px] select-none">
          {/* 左：推演账 */}
          <div className="flex items-center space-x-2 text-[#1E2024]">
            <span className="font-medium text-[11px]">
              {analysis.hitCount === 0
                ? '本次会话无折叠机会'
                : `可折叠 ${analysis.hitCount} 条 · 预计释放 ${formatTokens(analysis.totalReclaimedChars)} 字符`}
            </span>
          </div>

          {/* 中/右：真实账与预演按钮 */}
          <div className="flex items-center space-x-4">
            {walStats.isOffline ? (
              <span className="text-[11px] text-[#8F887D]">bridge 未连接，仅显示推演账</span>
            ) : walStats.stats ? (
              <span className="text-[11px] text-[#5E6573]">
                bridge 已折叠 {walStats.stats.totalEntries} 条 · 释放 {formatTokens(walStats.stats.totalReclaimedChars)} 字符
              </span>
            ) : null}

            <button
              type="button"
              onClick={() => setIsPreviewOverlayOpen(true)}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-[#DCD5C9] bg-white text-[#1E2024] hover:bg-[#F4F0EA] hover:border-[#B5AFA4] transition-colors cursor-pointer shadow-2xs"
            >
              查看预演
            </button>
          </div>
        </div>

        {/* 底部 (Footer) */}
        <footer className="shrink-0 px-5 py-2.5 border-t border-[#E5E0D8] bg-[#F4F0EA] flex flex-col gap-2 select-none">
          {/* 图例行 */}
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px]">
            {CONTEXT_PART_KINDS.map((kind) => {
              const part = prompt.parts.find((p) => p.kind === kind)
              const tokens = part?.tokens ?? 0
              return (
                <div key={kind} className="flex items-center gap-1.5 shrink-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PART_DOT_CLASSES[kind]}`} />
                  <span className="text-[#5E6573]">{PART_LABELS[kind]}</span>
                  <span className="font-semibold text-[#1E2024]">{formatTokens(tokens)}</span>
                </div>
              )
            })}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-[#8F887D]" />
              <span className="text-[#5E6573]">剩余空间</span>
              <span className="font-semibold text-[#1E2024]">{formatTokens(remainingTokens)}</span>
            </div>
          </div>

          {/* 操作与提示行 */}
          <div className="flex items-center justify-between gap-3 pt-1 border-t border-[#EAE5DC]">
            <div className="flex items-center space-x-1.5 text-[11px] text-[#5E6573] min-w-0 truncate">
              <Info className="w-3.5 h-3.5 text-[#8F887D] shrink-0" />
              <span className="truncate">
                微压缩由 bridge 摄入时自动完成，本面板只做推演与对账
              </span>
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1 text-[11px] font-medium rounded-lg border border-[#DCD5C9] bg-white text-[#5E6573] hover:text-[#1E2024] hover:border-[#B5AFA4] transition-colors cursor-pointer flex items-center space-x-1"
              >
                <ChevronDown className="w-3.5 h-3.5" />
                <span>收起 (Esc)</span>
              </button>
            </div>
          </div>
        </footer>
      </section>

      {/* 独立文本浮层 */}
      <ContextTextOverlay
        isOpen={overlay !== null}
        kind={overlay?.kind ?? 'chat'}
        part={overlayPart}
        initialItemIndex={null}
        onClose={() => setOverlay(null)}
      />

      {/* 压缩机会预演浮层 */}
      <CompactionPreviewOverlay
        isOpen={isPreviewOverlayOpen}
        opportunities={analysis.opportunities}
        totalRawChars={analysis.totalRawChars}
        totalReclaimedChars={analysis.totalReclaimedChars}
        walStats={walStats.stats}
        onClose={() => setIsPreviewOverlayOpen(false)}
      />
    </>
  )
}
