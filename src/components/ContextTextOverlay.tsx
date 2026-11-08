import React, { useEffect, useState } from 'react'
import { X, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react'
import { tryit } from 'radash'
import type { ContextPart, ContextPartKind, ContextItem } from '../types/telemetry'
import { formatTokens } from '../types/telemetry'
import { PART_LABELS } from './ContextPromptMap'
import { microCompactor } from '../services/microCompactor'
import {
  searchAndSortItems,
  detectOutcome,
  detectFileRefs,
  classifyMarkdownLines,
  countLines,
  sourceChipOf,
  type ItemSort,
  type MarkdownLineKind,
} from '../services/contextBrowser'
import {
  CONTEXT_DETAIL_LIMITS,
  resolveDetailWindow,
} from '../services/contextProvenance'

export interface ContextTextOverlayProps {
  isOpen: boolean
  kind: ContextPartKind
  part: ContextPart | null
  initialItemIndex?: number | null
  onClose: () => void
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

const FALLBACK_NO_CONTENT = '该条目未在 JSONL 中记录原文，Token 由字符量折算'

type ItemView = 'raw' | 'markdown' | 'compact'

const MD_LINE_CLASSES: Record<MarkdownLineKind, string> = {
  heading: 'text-[12px] font-semibold text-[#1E2024]',
  list: 'text-[#5E6573]',
  code: 'text-sky-700 bg-[#F4F0EA]',
  quote: 'text-amber-700 italic',
  text: 'text-[#3D3831]',
}

function renderHighlightedSnippet(content: string) {
  const HIGHLIGHT_RULES: Array<{ match: (line: string) => boolean; cls: string }> = [
    { match: (l) => l.startsWith('+') || l.startsWith('✓'), cls: 'text-emerald-600 font-medium' },
    {
      match: (l) =>
        l.startsWith('-') || l.startsWith('✖') || l.includes('AssertionError') || l.includes('failed'),
      cls: 'text-rose-600 font-medium',
    },
    { match: (l) => l.startsWith('$') || l.startsWith('>'), cls: 'text-sky-700' },
    {
      match: (l) => l.startsWith('@') || l.includes('原始输出已折叠') || l.startsWith('--- [⚡ NetDive'),
      cls: 'text-amber-700 font-bold',
    },
    { match: (l) => l.includes('hidden') || l.includes('omitted'), cls: 'text-[#A8A29E] italic' },
  ]

  return content.split('\n').map((line, idx) => {
    const lineClass = HIGHLIGHT_RULES.find((rule) => rule.match(line))?.cls ?? 'text-[#3D3831]'
    return (
      <div key={idx} className={`${lineClass} font-mono leading-relaxed whitespace-pre-wrap break-all`}>
        {line || ' '}
      </div>
    )
  })
}

export const ContextTextOverlay: React.FC<ContextTextOverlayProps> = ({
  isOpen,
  kind,
  part,
  initialItemIndex = null,
  onClose,
}) => {
  const hasInitialItem =
    initialItemIndex !== null &&
    initialItemIndex !== undefined &&
    part !== null &&
    initialItemIndex >= 0 &&
    initialItemIndex < part.items.length

  const [showAll, setShowAll] = useState<boolean>(!hasInitialItem)
  const [pageSize, setPageSize] = useState<number>(CONTEXT_DETAIL_LIMITS.itemsPerPage)
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(() => {
    if (hasInitialItem) {
      return new Set([initialItemIndex])
    }
    return new Set()
  })
  const [itemTabs, setItemTabs] = useState<Record<number, ItemView>>({})
  const [copiedIndices, setCopiedIndices] = useState<Record<number, boolean>>({})
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<ItemSort>('size')

  // 同步重置状态
  useEffect(() => {
    const hasInit =
      initialItemIndex !== null &&
      initialItemIndex !== undefined &&
      part !== null &&
      initialItemIndex >= 0 &&
      initialItemIndex < part.items.length

    setShowAll(!hasInit)
    setPageSize(100)
    setItemTabs({})
    setCopiedIndices({})
    setQuery('')
    setSortBy('size')
    if (hasInit) {
      setExpandedIndices(new Set([initialItemIndex]))
    } else {
      setExpandedIndices(new Set())
    }
  }, [isOpen, part, initialItemIndex])

  // 监听 Escape 键盘快捷键关闭浮层
  useEffect(() => {
    if (!isOpen || !part) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, part, onClose])

  if (!isOpen || !part) return null

  const toggleExpand = (idx: number) => {
    setExpandedIndices((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) {
        next.delete(idx)
      } else {
        next.add(idx)
      }
      return next
    })
  }

  const setItemTab = (idx: number, tab: ItemView) => {
    setItemTabs((prev) => ({ ...prev, [idx]: tab }))
  }

  const handleCopy = async (idx: number, content?: string) => {
    const textToCopy = content ?? ''
    const [err] = await tryit(() => navigator.clipboard.writeText(textToCopy))()
    if (!err) {
      setCopiedIndices((prev) => ({ ...prev, [idx]: true }))
      setTimeout(() => {
        setCopiedIndices((prev) => ({ ...prev, [idx]: false }))
      }, 2000)
    }
  }

  const getCompactedOutput = (item: ContextItem): string | null => {
    if (!item.content) return null
    const [err, res] = tryit(() =>
      microCompactor.compactToolOutput(item.content ?? '', {
        toolName: item.name,
        exitCode: 0,
      })
    )()
    if (err || !res?.output) return null
    return res.output
  }

  const rankedItems = searchAndSortItems(part.items, query, sortBy)
  const isSingleItemView = hasInitialItem && !showAll && query.trim() === ''
  const detailWindow = resolveDetailWindow(rankedItems.length, pageSize)

  const displayedItems: Array<{ item: ContextItem; index: number }> = isSingleItemView
    ? [{ item: part.items[initialItemIndex!], index: initialItemIndex! }]
    : rankedItems.slice(0, detailWindow.visible)

  const remainingCount = detailWindow.hasMore
    ? rankedItems.length - detailWindow.visible
    : 0
  const nextMoreCount = Math.min(CONTEXT_DETAIL_LIMITS.itemsPerPage, remainingCount)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[#1E2024]/35 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${PART_LABELS[kind] ?? kind} 详情浮层`}
    >
      <div
        className="w-full max-w-3xl max-h-[78vh] flex flex-col rounded-2xl bg-[#FBF9F5] border border-[#DCD5C9] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <header className="shrink-0 px-5 py-3 border-b border-[#E5E0D8] bg-[#F4F0EA] flex items-center justify-between select-none">
          <div className="flex items-center space-x-2 min-w-0">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${PART_DOT_CLASSES[kind] ?? 'bg-slate-500'}`} />
            <span className="text-[13px] font-semibold text-[#1E2024] truncate">
              {PART_LABELS[kind] ?? kind}
            </span>
          </div>

          <div className="flex items-center space-x-3 shrink-0">
            <span className="text-xs font-mono text-[#5E6573] font-medium">
              {formatTokens(part.tokens)}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-md text-[#8F887D] hover:text-[#1E2024] hover:bg-[#EAE5DC] transition-colors cursor-pointer"
              title="关闭 (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* 说明行 */}
        <div className="shrink-0 px-5 py-2 text-[10px] text-[#8F887D] border-b border-[#F0EBE1] bg-[#FAF8F5] select-none">
          原文来自本次会话 JSONL；未记录原文的条目会明确提示，不做伪造。文件引用卡的尺寸按字符量推算，无缩略图数据。
        </div>

        {/* 检视工具栏：每类独立搜索与排序 */}
        <div className="shrink-0 px-5 py-2 border-b border-[#F0EBE1] bg-[#FAF8F5] flex items-center gap-2 select-none">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索条目名称或来源标签"
            className="h-6 min-w-0 flex-1 px-2 rounded border border-[#DCD5C9] bg-white text-[11px] text-[#1E2024] outline-none focus:border-[#B5AFA4]"
          />
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setSortBy('size')}
              className={`px-1.5 h-5 rounded text-[10px] border cursor-pointer ${
                sortBy === 'size'
                  ? 'bg-[#1E2024] text-[#FBF9F5] border-[#1E2024]'
                  : 'bg-white text-[#5E6573] border-[#DCD5C9]'
              }`}
            >
              按体量
            </button>
            <button
              type="button"
              onClick={() => setSortBy('name')}
              className={`px-1.5 h-5 rounded text-[10px] border cursor-pointer ${
                sortBy === 'name'
                  ? 'bg-[#1E2024] text-[#FBF9F5] border-[#1E2024]'
                  : 'bg-white text-[#5E6573] border-[#DCD5C9]'
              }`}
            >
              按名称
            </button>
          </div>
          <span className="text-[10px] text-[#A8A29E] shrink-0">
            {rankedItems.length} / {part.items.length} 条
          </span>
        </div>

        {/* 主体 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3 space-y-1.5">
          {displayedItems.length === 0 ? (
            <div className="text-center py-8 text-[11px] text-[#8F887D]">
              {query.trim() ? '没有匹配的条目' : '该分类暂无条目'}
            </div>
          ) : (
            displayedItems.map(({ item, index }) => {
              const isItemExpanded = expandedIndices.has(index)
              const tab = itemTabs[index] ?? 'raw'
              const isCopied = copiedIndices[index] ?? false
              const outcome = detectOutcome(item.content)
              const fileRefs = detectFileRefs(item.content)

              const displayedText = tab === 'compact' ? getCompactedOutput(item) : item.content || null

              return (
                <div key={`${item.name}-${index}`} className="flex flex-col">
                  {/* 折叠头 */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(index)}
                    className="w-full text-left p-2 rounded-lg border transition-all flex items-center justify-between space-x-3 select-none bg-[#FAF8F5] border-[#EFEAE2] hover:bg-white hover:border-[#B5AFA4] cursor-pointer"
                  >
                    <div className="flex items-center space-x-2 min-w-0 flex-1">
                      {isItemExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-[#8F887D] shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-[#8F887D] shrink-0" />
                      )}
                      <span className="text-[11.5px] font-medium text-[#1E2024] truncate min-w-0">
                        {item.name}
                      </span>
                      {item.n && item.n > 1 ? (
                        <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-[#EAE5DC] text-[#5E6573] border border-[#DCD5C9] shrink-0">
                          ×{item.n}
                        </span>
                      ) : null}
                      <code
                        className="text-[9px] font-mono px-1 py-0.2 rounded bg-[#EAE5DC] text-[#5E6573] border border-[#DCD5C9] shrink-0"
                        title="来源标签取自 JSONL 的 tag，未造插件命名空间"
                      >
                        {sourceChipOf(item)}
                      </code>
                      {outcome !== 'unknown' && (
                        <span
                          className={`text-[9px] px-1 rounded shrink-0 ${
                            outcome === 'ok'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-rose-50 text-rose-700'
                          }`}
                        >
                          {outcome === 'ok' ? 'OK' : 'ERROR'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      <span className="text-[9px] text-[#A8A29E]">
                        {countLines(item.content)} 行
                      </span>
                      <span className="text-[10px] font-mono text-right text-[#5E6573] font-semibold">
                        {formatTokens(item.tokens)}
                      </span>
                    </div>
                  </button>

                  {/* 展开区 */}
                  {isItemExpanded && (
                    <div className="rounded-lg bg-white border border-[#E5E0D8] overflow-hidden mt-1 mb-1 shadow-xs">
                      {/* 工具栏：Tab 切换与复制按钮 */}
                      <div className="shrink-0 px-3 py-1.5 border-b border-[#E5E0D8] bg-[#F4F0EA] flex items-center justify-between select-none">
                        <div className="flex items-center space-x-1.5">
                          <button
                            type="button"
                            onClick={() => setItemTab(index, 'raw')}
                            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                              tab === 'raw'
                                ? 'bg-white text-[#1E2024] shadow-xs font-semibold'
                                : 'text-[#5E6573] hover:text-[#1E2024]'
                            }`}
                          >
                            原文
                          </button>
                          <button
                            type="button"
                            onClick={() => setItemTab(index, 'markdown')}
                            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                              tab === 'markdown'
                                ? 'bg-white text-[#1E2024] shadow-xs font-semibold'
                                : 'text-[#5E6573] hover:text-[#1E2024]'
                            }`}
                          >
                            Markdown
                          </button>
                          <button
                            type="button"
                            onClick={() => setItemTab(index, 'compact')}
                            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                              tab === 'compact'
                                ? 'bg-white text-[#1E2024] shadow-xs font-semibold'
                                : 'text-[#5E6573] hover:text-[#1E2024]'
                            }`}
                          >
                            压缩预览（只读）
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleCopy(index, item.content)}
                          className="px-2 py-0.5 rounded text-[10px] font-medium border border-[#DCD5C9] bg-white text-[#5E6573] hover:text-[#1E2024] hover:border-[#B5AFA4] transition-colors cursor-pointer flex items-center space-x-1"
                          title="复制条目原文"
                        >
                          {isCopied ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-600" />
                              <span className="text-emerald-700">已复制</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3 text-[#8F887D]" />
                              <span>复制</span>
                            </>
                          )}
                        </button>
                      </div>

                      {tab === 'compact' && (
                        <div className="px-3 pt-2 text-[10px] text-[#8F887D] select-none">
                          只读预览，不改变会话上下文
                        </div>
                      )}

                      {/* 文本区 */}
                      {tab === 'markdown' && displayedText ? (
                        <div className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all max-h-[320px] overflow-y-auto p-2.5 bg-white border border-[#E5E0D8] rounded-lg m-2">
                          {classifyMarkdownLines(displayedText).map((line, lineIdx) => (
                            <div key={lineIdx} className={MD_LINE_CLASSES[line.kind]}>
                              {line.text || ' '}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all max-h-[320px] overflow-y-auto p-2.5 bg-white border border-[#E5E0D8] rounded-lg text-[#1E2024] selection:bg-violet-200 m-2">
                          <code>
                            {displayedText ? (
                              renderHighlightedSnippet(displayedText)
                            ) : (
                              <span className="text-[#8F887D] italic">{FALLBACK_NO_CONTENT}</span>
                            )}
                          </code>
                        </pre>
                      )}

                      {fileRefs.length > 0 && (
                        <div className="px-2.5 pb-2 flex flex-wrap gap-1.5 select-none">
                          {fileRefs.map((ref) => (
                            <span
                              key={ref.path}
                              className="text-[9px] px-1.5 py-0.5 rounded bg-[#F4F0EA] border border-[#E5E0D8] text-[#5E6573]"
                              title="事件流仅记录文本引用，尺寸与 token 按字符量推算"
                            >
                              {ref.path} · {ref.chars} 字符 · ~{ref.tokens} token
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}

          {/* initialItemIndex 非空时切到全部列表视图按钮 */}
          {isSingleItemView && (
            <div className="pt-2 pb-1 flex justify-center shrink-0">
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="px-3 py-1 text-[11px] font-medium rounded-md border border-[#DCD5C9] bg-white text-[#5E6573] hover:text-[#1E2024] hover:border-[#B5AFA4] transition-colors cursor-pointer"
              >
                全部 {part.items.length} 条
              </button>
            </div>
          )}

          {/* 触到硬上限时给可读降级文案，不静默截断 */}
          {!isSingleItemView && detailWindow.notice && (
            <div className="pt-2 pb-1 text-center text-[10px] text-amber-700">
              {detailWindow.notice}
            </div>
          )}

          {/* 完整列表按页补载 */}
          {!isSingleItemView && remainingCount > 0 && !detailWindow.notice && (
            <div className="pt-2 pb-1 flex justify-center shrink-0">
              <button
                type="button"
                onClick={() => setPageSize((prev) => prev + CONTEXT_DETAIL_LIMITS.itemsPerPage)}
                className="px-3 py-1 text-[11px] font-medium rounded-md border border-[#DCD5C9] bg-white text-[#5E6573] hover:text-[#1E2024] hover:border-[#B5AFA4] transition-colors cursor-pointer"
              >
                显示更多 {nextMoreCount} 条
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
