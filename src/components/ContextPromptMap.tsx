import React, { useMemo, useRef, useState, useEffect } from 'react'
import {
  hierarchy,
  treemap,
  treemapSquarify,
  type HierarchyRectangularNode,
} from 'd3-hierarchy'
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

interface TreemapDatum {
  kind: ContextPartKind | 'free'
  tokens: number
  layoutValue: number
  free?: boolean
  children?: TreemapDatum[]
}

const MAX_LAYOUT_ROUNDS = 8

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

    const layoutValueMap = new Map<ContextPartKind, number>()
    for (const item of rawParts) {
      layoutValueMap.set(item.kind, item.tokens)
    }

    let leaves: HierarchyRectangularNode<TreemapDatum>[] = []

    for (let round = 0; round < MAX_LAYOUT_ROUNDS; round++) {
      const children: TreemapDatum[] = rawParts.map((item) => ({
        kind: item.kind,
        tokens: item.tokens,
        layoutValue: layoutValueMap.get(item.kind) ?? item.tokens,
        free: false,
      }))

      if (freeTokens > 0) {
        children.push({
          kind: 'free',
          tokens: freeTokens,
          layoutValue: freeTokens,
          free: true,
        })
      }

      const rootData: TreemapDatum = {
        kind: 'free',
        tokens: 0,
        layoutValue: 0,
        children,
      }

      const root = hierarchy<TreemapDatum>(rootData, (d) => d.children).sum(
        (d) => d.layoutValue
      )

      const rectRoot = treemap<TreemapDatum>()
        .tile(treemapSquarify)
        .size([size.w, size.h])
        .paddingInner(4)
        .paddingOuter(0)
        .round(true)(root)

      leaves = rectRoot.leaves()

      const underflowLeaves = leaves.filter((leaf) => {
        if (leaf.data.kind === 'free' || leaf.data.free) return false
        const w = Math.max(0, leaf.x1 - leaf.x0)
        const h = Math.max(0, leaf.y1 - leaf.y0)
        return Math.min(w, h) < 56
      })

      if (underflowLeaves.length === 0 || round === MAX_LAYOUT_ROUNDS - 1) {
        break
      }

      for (const leaf of underflowLeaves) {
        const leafKind = leaf.data.kind
        if (leafKind !== 'free') {
          const w = Math.max(0, leaf.x1 - leaf.x0)
          const h = Math.max(0, leaf.y1 - leaf.y0)
          const minSide = Math.max(1, Math.min(w, h))
          const prevVal = layoutValueMap.get(leafKind) ?? leaf.data.tokens
          const factor = (56 / minSide) * 1.05
          layoutValueMap.set(leafKind, prevVal * factor)
        }
      }
    }

    return leaves
  }, [prompt, size.w, size.h])

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-[132px] max-h-[232px] overflow-hidden rounded-xl border border-[#DCD5C9] bg-[#FAF8F5]"
    >
      {size.w > 0 && size.h > 0 && (
        <div className="relative w-full h-full">
          {tiles.map((leaf) => {
            const isFree = leaf.data.kind === 'free' || leaf.data.free
            const x = leaf.x0
            const y = leaf.y0
            const w = Math.max(0, leaf.x1 - leaf.x0)
            const h = Math.max(0, leaf.y1 - leaf.y0)
            const isBare = w < 56 || h < 34
            const tokens = leaf.data.tokens
            const pct = prompt.window > 0 ? Math.round((tokens / prompt.window) * 100) : 0

            if (isFree || leaf.data.kind === 'free') {
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

            const kind = leaf.data.kind
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
