import React, { useMemo, useRef, useState, useEffect } from 'react'
import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy'
import type { ContextPartKind, ContextPrompt } from '../types/telemetry'
import { formatTokens } from '../types/telemetry'

export interface PromptFocus {
  kind: ContextPartKind
}

export interface ContextPromptMapProps {
  prompt: ContextPrompt
  focus?: PromptFocus | null
  onFocus?: (focus: PromptFocus | null) => void
  onOpenPart: (kind: ContextPartKind) => void
}

export const CONTEXT_PART_KINDS: ContextPartKind[] = [
  'system',
  'tools',
  'skills',
  'memory',
  'files',
  'results',
  'chat',
]

export const PART_LABELS: Record<ContextPartKind, string> = {
  system: '系统提示词',
  tools: '工具定义',
  skills: 'Skills',
  memory: '指令文件与记忆',
  files: '读入的文件',
  results: '工具结果',
  chat: '对话',
}

export const PART_CLASSES: Record<ContextPartKind, string> = {
  system: 'bg-violet-50 ring-violet-200 text-violet-900',
  tools: 'bg-indigo-50 ring-indigo-200 text-indigo-900',
  skills: 'bg-fuchsia-50 ring-fuchsia-200 text-fuchsia-900',
  memory: 'bg-sky-50 ring-sky-200 text-sky-900',
  files: 'bg-emerald-50 ring-emerald-200 text-emerald-900',
  results: 'bg-amber-50 ring-amber-200 text-amber-900',
  chat: 'bg-slate-50 ring-slate-200 text-slate-900',
}

const AGGREGATE_CLASSES = 'bg-stone-50 ring-stone-200 text-stone-900'

interface TreemapDatum {
  kind: ContextPartKind | 'free' | 'aggregate'
  tokens: number
  layoutValue?: number
  free?: boolean
  aggregateCount?: number
  aggregatedKinds?: ContextPartKind[]
  children?: TreemapDatum[]
}

export const ContextPromptMap: React.FC<ContextPromptMapProps> = ({
  prompt,
  focus,
  onFocus,
  onOpenPart,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          setSize((prev) => {
            const rw = Math.round(width)
            const rh = Math.round(height)
            if (prev.w === rw && prev.h === rh) return prev
            return { w: rw, h: rh }
          })
        }
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const tiles = useMemo(() => {
    if (size.w <= 0 || size.h <= 0) return []

    const rawParts: { kind: ContextPartKind; tokens: number }[] = []
    for (const kind of CONTEXT_PART_KINDS) {
      const part = prompt.parts.find((p) => p.kind === kind)
      const tokens = part?.tokens ?? 0
      if (tokens > 0) {
        rawParts.push({ kind, tokens })
      }
    }

    // 按 tokens 降序
    rawParts.sort((a, b) => b.tokens - a.tokens)

    const freeTokens = Math.max(0, prompt.window - prompt.tokens)
    if (rawParts.length === 0 && freeTokens <= 0) return []

    const floorWeight = (prompt.tokens || 0) * 0.02

    const doLayout = (aggKinds: ContextPartKind[]) => {
      const children: TreemapDatum[] = []
      const remainingParts = rawParts.filter((p) => !aggKinds.includes(p.kind))

      for (const item of remainingParts) {
        children.push({
          kind: item.kind,
          tokens: item.tokens,
          layoutValue: Math.max(item.tokens, floorWeight),
          free: false,
        })
      }

      if (aggKinds.length > 0) {
        const aggTokens = rawParts
          .filter((p) => aggKinds.includes(p.kind))
          .reduce((sum, p) => sum + p.tokens, 0)
        children.push({
          kind: 'aggregate',
          tokens: aggTokens,
          layoutValue: Math.max(aggTokens, floorWeight),
          free: false,
          aggregateCount: aggKinds.length,
          aggregatedKinds: aggKinds,
        })
      }

      if (freeTokens > 0) {
        children.push({
          kind: 'free',
          free: true,
          tokens: freeTokens,
          layoutValue: freeTokens,
        })
      }

      const rootData: TreemapDatum = {
        kind: 'free',
        tokens: 0,
        layoutValue: 0,
        children,
      }

      const root = hierarchy<TreemapDatum>(rootData, (d) => d.children)
        .sum((d) => d.layoutValue ?? d.tokens)

      const rectRoot = treemap<TreemapDatum>()
        .tile(treemapSquarify)
        .size([size.w, size.h])
        .paddingInner(4)
        .paddingOuter(0)
        .round(true)(root)

      return rectRoot.leaves()
    }

    // 阶段 1：初始布局（所有 tokens > 0 的 part 与 free 一起布局）
    let aggregatedKinds: ContextPartKind[] = []
    let currentLeaves = doLayout(aggregatedKinds)

    // 阶段 2：找出实际像素尺寸 w < 56 || h < 34 的非 free 叶子并合并为聚合节点重新布局（最多 3 轮）
    const MAX_REPACK_ROUNDS = 3
    for (let round = 0; round < MAX_REPACK_ROUNDS; round++) {
      const narrowLeaves = currentLeaves.filter((leaf) => {
        if (leaf.data.kind === 'free' || leaf.data.free) return false
        const w = Math.max(0, leaf.x1 - leaf.x0)
        const h = Math.max(0, leaf.y1 - leaf.y0)
        return w < 56 || h < 34
      })

      if (narrowLeaves.length === 0) {
        break
      }

      const remainingCount = rawParts.filter((p) => !aggregatedKinds.includes(p.kind)).length
      const totalNonFreeNodes = remainingCount + (aggregatedKinds.length > 0 ? 1 : 0)

      if (totalNonFreeNodes <= 1) {
        break
      }

      const nextAggKindsSet = new Set<ContextPartKind>(aggregatedKinds)
      for (const leaf of narrowLeaves) {
        if (leaf.data.kind !== 'aggregate' && leaf.data.kind !== 'free') {
          nextAggKindsSet.add(leaf.data.kind)
        }
      }

      // 如果 aggregate 自身过窄，或者只聚合了 1 个孤立 part（无法形成真正聚合以放大面积）
      const aggIsNarrow = narrowLeaves.some((leaf) => leaf.data.kind === 'aggregate')
      const needsCompanion = nextAggKindsSet.size === 1 && aggregatedKinds.length === 0

      if (aggIsNarrow || needsCompanion) {
        const unaggregated = rawParts.filter((p) => !nextAggKindsSet.has(p.kind))
        if (unaggregated.length > 0) {
          const smallest = unaggregated[unaggregated.length - 1]
          nextAggKindsSet.add(smallest.kind)
        }
      }

      // 若集合大小没有变化，尝试额外吸纳一个最小 part，否则跳出防死循环
      if (nextAggKindsSet.size === aggregatedKinds.length) {
        const unaggregated = rawParts.filter((p) => !nextAggKindsSet.has(p.kind))
        if (unaggregated.length > 0) {
          const smallest = unaggregated[unaggregated.length - 1]
          nextAggKindsSet.add(smallest.kind)
        } else {
          break
        }
      }

      aggregatedKinds = rawParts
        .filter((p) => nextAggKindsSet.has(p.kind))
        .map((p) => p.kind)

      currentLeaves = doLayout(aggregatedKinds)
    }

    return currentLeaves
  }, [prompt, size.w, size.h])

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-[132px] max-h-[232px] overflow-hidden rounded-xl border border-[#DCD5C9] bg-[#FAF8F5]"
    >
      {size.w > 0 && size.h > 0 && (
        <div className="relative w-full h-full">
          {tiles.map((leaf) => {
            const rawKind = leaf.data.kind
            const x = leaf.x0
            const y = leaf.y0
            const w = Math.max(0, leaf.x1 - leaf.x0)
            const h = Math.max(0, leaf.y1 - leaf.y0)
            const isBare = w < 56 || h < 34
            const tokens = leaf.data.tokens
            const pct = prompt.window > 0 ? Math.round((tokens / prompt.window) * 100) : 0

            if (rawKind === 'free' || leaf.data.free) {
              const focusClass = focus ? 'opacity-30' : 'opacity-100'

              return (
                <div
                  key="free"
                  style={{
                    left: `${x}px`,
                    top: `${y}px`,
                    width: `${w}px`,
                    height: `${h}px`,
                    backgroundImage:
                      'repeating-linear-gradient(-45deg, rgba(30,32,36,.08) 0 1px, transparent 1px 5px)',
                  }}
                  className={`absolute ring-1 ring-inset ring-[#E5E0D8] rounded-[7px] p-2 flex flex-col justify-start gap-0.5 text-left overflow-hidden transition-all select-none text-[#A8A29E] cursor-default ${focusClass}`}
                  title={`剩余空间 · ${formatTokens(tokens)}`}
                >
                  {!isBare && (
                    <>
                      <div className="text-[11px] font-medium truncate leading-tight">
                        剩余空间
                      </div>
                      <div className="text-[10px] opacity-80 truncate leading-tight">
                        占窗口 {pct}%
                      </div>
                    </>
                  )}
                </div>
              )
            }

            if (rawKind === 'aggregate') {
              const aggCount = leaf.data.aggregateCount ?? 0
              const aggregatedKinds = leaf.data.aggregatedKinds ?? []
              const isMatched = focus ? aggregatedKinds.includes(focus.kind) : false
              const focusClass = focus
                ? isMatched
                  ? 'opacity-100 scale-[1.02] z-10 shadow-sm'
                  : 'opacity-30'
                : 'opacity-100'
              const aggKindsLabel = aggregatedKinds.map((k) => PART_LABELS[k] ?? k).join('/')

              return (
                <button
                  key="aggregate"
                  type="button"
                  style={{
                    left: `${x}px`,
                    top: `${y}px`,
                    width: `${w}px`,
                    height: `${h}px`,
                  }}
                  onClick={() => {
                    const firstKind = aggregatedKinds[0]
                    if (firstKind) onOpenPart(firstKind)
                  }}
                  className={`absolute ring-1 ring-inset rounded-[7px] p-2 flex flex-col justify-start gap-0.5 text-left overflow-hidden transition-all select-none ${AGGREGATE_CLASSES} cursor-pointer ${focusClass}`}
                  title={`另外 ${aggCount} 项 · 合计 ${formatTokens(tokens)} · 占窗口 ${pct}%`}
                >
                  {!isBare && (
                    <>
                      <div className="text-[11px] font-medium truncate leading-tight">
                        另外 {aggCount} 项
                      </div>
                      {h >= 46 && (
                        <>
                          <div className="text-[10px] leading-tight truncate opacity-90">
                            {aggKindsLabel}
                          </div>
                          <div className="text-[10px] leading-tight opacity-75 truncate">
                            合计 {formatTokens(tokens)} · {pct}%
                          </div>
                        </>
                      )}
                    </>
                  )}
                </button>
              )
            }

            const kind = rawKind
            const part = prompt.parts.find((p) => p.kind === kind)
            const largestItemName = part?.items[0]?.name || '—'
            const isMatched = focus ? focus.kind === kind : false
            const focusClass = focus
              ? isMatched
                ? 'opacity-100 scale-[1.02] z-10 shadow-sm'
                : 'opacity-30'
              : 'opacity-100'

            return (
              <button
                key={kind}
                type="button"
                style={{
                  left: `${x}px`,
                  top: `${y}px`,
                  width: `${w}px`,
                  height: `${h}px`,
                }}
                onClick={() => onOpenPart(kind)}
                onMouseEnter={() => onFocus?.({ kind })}
                onMouseLeave={() => onFocus?.(null)}
                className={`absolute ring-1 ring-inset rounded-[7px] p-2 flex flex-col justify-start gap-0.5 text-left overflow-hidden transition-all select-none ${PART_CLASSES[kind]} cursor-pointer ${focusClass}`}
                title={`${PART_LABELS[kind]} · ${formatTokens(tokens)} · 占窗口 ${pct}%`}
              >
                {!isBare && (
                  <>
                    <div className="text-[11px] font-medium truncate leading-tight">
                      {PART_LABELS[kind]}
                    </div>
                    {h >= 46 && (
                      <>
                        <div className="text-[10px] leading-tight truncate opacity-90">
                          {largestItemName}
                        </div>
                        <div className="text-[10px] leading-tight opacity-75 truncate">
                          {formatTokens(tokens)} · 占窗口 {pct}%
                        </div>
                      </>
                    )}
                  </>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default ContextPromptMap
