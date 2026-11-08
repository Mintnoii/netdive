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
  system: 'bg-violet-100 border-violet-300 text-violet-900',
  tools: 'bg-indigo-100 border-indigo-300 text-indigo-900',
  skills: 'bg-fuchsia-100 border-fuchsia-300 text-fuchsia-900',
  memory: 'bg-sky-100 border-sky-300 text-sky-900',
  files: 'bg-emerald-100 border-emerald-300 text-emerald-900',
  results: 'bg-amber-100 border-amber-300 text-amber-900',
  chat: 'bg-slate-100 border-slate-300 text-slate-900',
}

interface TreemapDatum {
  kind: ContextPartKind | 'free'
  tokens: number
  free?: boolean
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

    const children: TreemapDatum[] = []
    for (const kind of CONTEXT_PART_KINDS) {
      const part = prompt.parts.find((p) => p.kind === kind)
      const tokens = part?.tokens ?? 0
      if (tokens > 0) {
        children.push({ kind, tokens, free: false })
      }
    }

    const freeTokens = Math.max(0, prompt.window - prompt.tokens)
    if (freeTokens > 0) {
      children.push({ kind: 'free', free: true, tokens: freeTokens })
    }

    if (children.length === 0) return []

    const rootData: TreemapDatum = {
      kind: 'free',
      tokens: 0,
      children,
    }

    const root = hierarchy<TreemapDatum>(rootData, (d) => d.children)
      .sum((d) => d.tokens)

    const rectRoot = treemap<TreemapDatum>()
      .tile(treemapSquarify)
      .size([size.w, size.h])
      .paddingInner(3)
      .paddingOuter(0)
      .round(true)(root)

    return rectRoot.leaves()
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
            const isFree = Boolean(leaf.data.free || rawKind === 'free')
            const x = leaf.x0
            const y = leaf.y0
            const w = Math.max(0, leaf.x1 - leaf.x0)
            const h = Math.max(0, leaf.y1 - leaf.y0)
            const isBare = w < 44 || h < 30
            const tokens = leaf.data.tokens
            const pct = prompt.window > 0 ? Math.round((tokens / prompt.window) * 100) : 0

            if (isFree || rawKind === 'free') {
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
                      'repeating-linear-gradient(-45deg, rgba(30,32,36,.055) 0 1px, transparent 1px 6px)',
                  }}
                  className={`absolute border border-[#DCD5C9] rounded-[7px] p-1.5 flex flex-col justify-between text-left overflow-hidden transition-all select-none text-[#8F887D] cursor-default ${focusClass}`}
                  title={`剩余空间 · ${formatTokens(tokens)}`}
                >
                  {!isBare && (
                    <>
                      <div className="text-[11.5px] font-medium truncate leading-tight">
                        剩余空间
                      </div>
                      <div className="text-[10.5px] font-mono opacity-80 truncate leading-tight">
                        {pct}%
                      </div>
                    </>
                  )}
                </div>
              )
            }

            const kind = rawKind
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
                className={`absolute border rounded-[7px] p-1.5 flex flex-col justify-between text-left overflow-hidden transition-all select-none ${PART_CLASSES[kind]} cursor-pointer ${focusClass}`}
                title={`${PART_LABELS[kind]} · ${formatTokens(tokens)} · 占窗口 ${pct}%`}
              >
                {!isBare && (
                  <>
                    <div className="text-[11.5px] font-medium truncate leading-tight">
                      {PART_LABELS[kind]}
                    </div>
                    <div className="text-[10.5px] font-mono opacity-80 truncate leading-tight">
                      {formatTokens(tokens)} · 占窗口 {pct}%
                    </div>
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
