import React, { useEffect } from 'react'
import {
  X,
  Scissors,
  Check,
  Layers,
  Sparkles,
  Info,
  ArrowDown,
  Terminal,
  FileCode,
  FileText,
} from 'lucide-react'
import type { ContextWatermark, PrunableItem } from '../types/telemetry'
import { formatTokens } from '../types/telemetry'

export interface PrunableInspectorDrawerProps {
  isOpen: boolean
  onClose: () => void
  isPruned?: boolean
  reclaimedTokens?: number
  onPrune?: () => void
  items?: PrunableItem[]
  watermark?: ContextWatermark
}

/**
 * 终端高亮行渲染辅助函数
 */
function renderRawCodeSnippet(rawContent: string) {
  const lines = rawContent.split('\n')
  return lines.map((line, idx) => {
    let lineClass = 'text-slate-300'
    if (line.startsWith('+') || line.startsWith('✓')) {
      lineClass = 'text-emerald-400 font-medium'
    } else if (
      line.startsWith('-') ||
      line.startsWith('✖') ||
      line.includes('AssertionError')
    ) {
      lineClass = 'text-rose-400 font-medium'
    } else if (line.startsWith('$') || line.startsWith('>')) {
      lineClass = 'text-sky-300'
    } else if (line.startsWith('@')) {
      lineClass = 'text-amber-300'
    } else if (line.includes('hidden') || line.includes('omitted')) {
      lineClass = 'text-slate-500 italic'
    }
    return (
      <div key={idx} className={`${lineClass} font-mono leading-relaxed`}>
        {line || ' '}
      </div>
    )
  })
}

/**
 * 冗余上下文明细抽屉 (Paper & Ink 风格)
 * 查看注意力内存中可压缩折叠的工具调用历史与单行摘要预览，清晰对比原始上下文与修剪后目标
 */
export const PrunableInspectorDrawer: React.FC<PrunableInspectorDrawerProps> = ({
  isOpen,
  onClose,
  isPruned = false,
  reclaimedTokens = 0,
  onPrune,
  items = [],
  watermark,
}) => {
  // 键盘快捷键监听：Esc 关闭抽屉
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const totalPrunableTokens = items.reduce((sum, item) => sum + item.tokens, 0)
  const displayReclaimed =
    reclaimedTokens ||
    (isPruned ? 42000 : Math.max(0, totalPrunableTokens - 4000))

  return (
    <aside
      className="w-[420px] shrink-0 h-full bg-[#FBF9F5] border-l border-[#E5E0D8] shadow-xl flex flex-col text-[#1E2024] font-sans z-20 animate-in slide-in-from-right duration-200 overflow-hidden"
      aria-label="冗余上下文修剪明细"
    >
      {/* 顶部标题栏 */}
      <header className="px-5 py-3.5 border-b border-[#E5E0D8] bg-[#F4F0EA] flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2.5">
          <div className="p-1.5 rounded-lg bg-amber-100/80 border border-amber-300 text-amber-900 shrink-0">
            <Layers className="w-4 h-4 text-amber-800" />
          </div>
          <div>
            <h2 className="text-xs font-semibold text-[#1E2024] flex items-center space-x-1.5">
              <span>冗余上下文修剪明细</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#EAE5DC] text-[#5E6573] border border-[#DCD5C9]">
                Prunable Inspector
              </span>
            </h2>
            <p className="text-[10px] text-[#8F887D] mt-0.5 truncate max-w-[260px]">
              对比窗口内的原始高负载输出与剪枝后因果摘要
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-[#8F887D] hover:text-[#1E2024] rounded-md hover:bg-[#E5E0D8] transition-colors cursor-pointer shrink-0"
          title="关闭抽屉 (Esc)"
          aria-label="关闭抽屉"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

        {/* 水位概览统计卡片 */}
        <div className="px-6 py-3.5 border-b border-[#E8E3DA] bg-[#FAF8F3] shrink-0">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-medium text-[#5E6573]">当前可修剪总量:</span>
                <span className="font-mono text-sm font-semibold text-amber-900">
                  ~{formatTokens(totalPrunableTokens)} tokens
                </span>
                <span className="text-[11px] font-mono text-[#8F887D]">
                  ({items.length} 个工具调用)
                </span>
              </div>
              <div className="text-[11px] text-[#8F887D] flex items-center space-x-1.5">
                <span>预计释放净值:</span>
                <span className="font-mono font-medium text-emerald-700">
                  ~{formatTokens(displayReclaimed)} tokens
                </span>
                {watermark && (
                  <span className="text-[#8F887D]">
                    (占当前总限额 {Math.round((totalPrunableTokens / watermark.totalLimit) * 100)}%)
                  </span>
                )}
              </div>
            </div>

            {/* 状态徽标 */}
            <div>
              {isPruned ? (
                <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-300 text-emerald-800 font-mono text-xs">
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>已完成剪枝 (Pruned)</span>
                </div>
              ) : items.length === 0 ? (
                <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-[#F4F0EA] border border-[#DCD5C9] text-[#5E6573] font-mono text-xs">
                  <Check className="w-3.5 h-3.5 text-[#8F887D]" />
                  <span>无待修剪 (Clean)</span>
                </div>
              ) : (
                <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-300 text-amber-800 font-mono text-xs">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  <span>待修剪 (Pending)</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 明细条目滚动列表 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 flex flex-col">
          {items.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center my-auto space-y-3">
              <div className="p-3.5 rounded-full bg-[#F4F0EA] border border-[#E5E0D8] text-[#8F887D]">
                <Layers className="w-8 h-8 text-[#8F887D]" />
              </div>
              <div className="space-y-1.5 max-w-sm">
                <h3 className="text-sm font-semibold text-[#1E2024]">
                  暂无待修剪的冗余工具调用
                </h3>
                <p className="text-xs text-[#8F887D] leading-relaxed font-mono">
                  当前活跃步骤均为核心上下文，当执行包含大量标准输出的测试、编译或长文读取等重型工具后，将在此动态透视。
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="text-[11px] font-mono uppercase tracking-wider text-[#8F887D] flex items-center justify-between">
                <span>可折叠工具条目清单 ({items.length})</span>
                <span>按 Token 占用降序排列</span>
              </div>

              {items.map((item) => {
                const itemPruned =
                  isPruned ||
                  item.statusBadge.includes('Pruned') ||
                  item.statusBadge.includes('已折叠')

                const itemLines =
                  item.linesCount ??
                  (item.rawPayloadPreview
                    ? item.rawPayloadPreview.split('\n').length
                    : item.gesture === 'bash'
                      ? 150
                      : item.gesture === 'edit'
                        ? 42
                        : 28)

                const savedTokens = formatTokens(
                  item.tokens > 4000 ? item.tokens - 1000 : item.tokens
                )

                return (
                  <div
                    key={item.id}
                    className={`rounded-xl border p-4 space-y-3.5 transition-all duration-200 ${
                      itemPruned
                        ? 'bg-[#FDFCFA] border-emerald-200 shadow-2xs'
                        : 'bg-white border-[#E5E0D8] hover:border-amber-300 shadow-2xs'
                    }`}
                  >
                    {/* 条目标题行 */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center space-x-2">
                        <span className="text-base select-none">{item.emoji}</span>
                        <div>
                          <h4 className="text-xs font-mono font-semibold text-[#1E2024] leading-snug">
                            {item.title}
                          </h4>
                          <p className="text-[11px] font-mono text-[#5E6573] mt-0.5">
                            {item.rawDetail}
                          </p>
                        </div>
                      </div>

                      {/* 状态胶囊 */}
                      <div className="shrink-0 flex items-center space-x-1.5">
                        <span
                          className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                            itemPruned
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-700 font-medium'
                              : 'bg-[#F4F0EA] border-[#DCD5C9] text-[#5E6573]'
                          }`}
                        >
                          {itemPruned ? '已折叠压缩 (Pruned)' : item.statusBadge}
                        </span>
                      </div>
                    </div>

                    {/* Section A: 当前冗余上下文 (Raw Context in Window) */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] font-mono">
                        <div className="flex items-center space-x-1.5 font-medium text-[#1E2024]">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500/80" />
                          <span>当前冗余上下文 (Raw Context in Window)</span>
                        </div>
                        <div className="flex items-center space-x-1.5">
                          <span className="px-1.5 py-0.5 rounded bg-[#EAE5DC] text-[#5E6573] border border-[#DCD5C9] text-[10px] font-mono">
                            {itemLines} 行原始输出
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-mono font-semibold">
                            ~{formatTokens(item.tokens)} tokens
                          </span>
                        </div>
                      </div>

                      {/* Monospace terminal / code block (dark slate #1E2024) */}
                      <div className="rounded-lg bg-[#1E2024] border border-[#2D3139] p-3 text-slate-200 font-mono shadow-inner">
                        <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10 text-[10px] text-slate-400 select-none">
                          <div className="flex items-center space-x-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block" />
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
                            <span className="ml-1.5 font-mono text-slate-300 flex items-center space-x-1">
                              {item.gesture === 'bash' ? (
                                <>
                                  <Terminal className="w-3 h-3 text-sky-400" />
                                  <span>terminal stdout/stderr</span>
                                </>
                              ) : item.gesture === 'edit' ? (
                                <>
                                  <FileCode className="w-3 h-3 text-emerald-400" />
                                  <span>git diff snippet</span>
                                </>
                              ) : (
                                <>
                                  <FileText className="w-3 h-3 text-amber-400" />
                                  <span>raw file content</span>
                                </>
                              )}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono text-slate-400">
                            {item.tokens >= 20000 ? 'High Context Load' : 'Medium Context Load'}
                          </span>
                        </div>

                        <pre className="text-[11px] font-mono leading-relaxed overflow-x-auto selection:bg-amber-500/30 max-h-48">
                          <code>
                            {renderRawCodeSnippet(item.rawPayloadPreview || item.rawDetail)}
                          </code>
                        </pre>
                      </div>
                    </div>

                    {/* Downward arrow -> 修剪后保留的紧凑摘要 (Folded Target) */}
                    <div className="flex items-center justify-center py-0.5">
                      <div className="flex items-center space-x-2 text-[10px] font-mono text-[#8F887D]">
                        <div className="w-10 h-px bg-[#E5E0D8]" />
                        <div className="flex items-center space-x-1.5 bg-[#F4F0EA] px-2.5 py-0.5 rounded-full border border-[#E5E0D8] text-[#5E6573]">
                          <ArrowDown className="w-3 h-3 text-amber-600 animate-bounce duration-1000" />
                          <span>修剪后保留的紧凑摘要 (Folded Target)</span>
                        </div>
                        <div className="w-10 h-px bg-[#E5E0D8]" />
                      </div>
                    </div>

                    {/* Section B: 修剪后保留的紧凑摘要 */}
                    <div
                      className={`p-3 rounded-lg border transition-all duration-200 ${
                        itemPruned
                          ? 'border-emerald-300 bg-emerald-50/70 shadow-2xs'
                          : 'border-amber-300/80 bg-amber-50/40'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[11px] font-mono mb-1.5">
                        <div className="flex items-center space-x-1.5">
                          {itemPruned ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                              <span className="font-semibold text-emerald-900">
                                已完成压缩 (Compressed)
                              </span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                              <span className="font-semibold text-amber-900">
                                拟压缩为 (Target Summary)
                              </span>
                            </>
                          )}
                        </div>
                        <span
                          className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                            itemPruned
                              ? 'bg-emerald-100 border-emerald-300 text-emerald-800 font-semibold'
                              : 'bg-amber-100/80 border-amber-300 text-amber-900 font-medium'
                          }`}
                        >
                          -{savedTokens} tokens
                        </span>
                      </div>

                      <div
                        className={`p-2.5 rounded-md font-mono text-xs leading-relaxed border ${
                          itemPruned
                            ? 'bg-white border-emerald-200 text-emerald-950 font-medium'
                            : 'bg-white/95 border-amber-200/80 text-[#1E2024]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="break-words">
                            {item.foldedSummary.replace(/^\[已修剪:\s*/, '').replace(/\]$/, '')}
                          </span>
                          {itemPruned && (
                            <span className="shrink-0 text-[10px] font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 flex items-center space-x-1">
                              <Check className="w-3 h-3" />
                              <span>已生效</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Bottom summary */}
                    <div className="pt-2 border-t border-[#EAE5DC] flex items-center justify-between text-[11px] font-mono text-[#5E6573]">
                      <div className="flex items-center space-x-1.5">
                        <Info className="w-3.5 h-3.5 text-[#8F887D] shrink-0" />
                        <span>
                          修剪动作将从上下文窗口丢弃上述整段原始输出，仅保留单行因果摘要，节约 ~{savedTokens} tokens
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </div>

        {/* 底部操作工具栏 */}
        <footer className="px-5 py-3.5 border-t border-[#E5E0D8] bg-[#F4F0EA] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-1.5 text-xs text-[#5E6573] truncate max-w-[200px]">
            <Info className="w-3.5 h-3.5 text-[#8F887D] shrink-0" />
            <span className="truncate">
              {isPruned
                ? '已完成注意力净化'
                : items.length === 0
                  ? '暂无冗余工具调用'
                  : '压缩为单行摘要'}
            </span>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-[#DCD5C9] bg-white text-[#5E6573] hover:text-[#1E2024] hover:bg-[#F4F0EA] transition-colors cursor-pointer"
            >
              关闭
            </button>

            <button
              type="button"
              onClick={() => {
                if (!isPruned && items.length > 0 && onPrune) {
                  onPrune()
                }
              }}
              disabled={isPruned || items.length === 0}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border flex items-center space-x-1.5 transition-all duration-200 shadow-2xs ${
                isPruned || items.length === 0
                  ? 'bg-[#EAE5DC] text-[#8F887D] border-[#DCD5C9] cursor-not-allowed opacity-80'
                  : 'bg-[#1E2024] text-[#FBF9F5] border-[#1E2024] hover:bg-[#34383F] cursor-pointer'
              }`}
            >
              {isPruned ? (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                  <span>已完成修剪</span>
                </>
              ) : (
                <>
                  <Scissors className="w-3.5 h-3.5 text-amber-400" />
                  <span>一键修剪</span>
                </>
              )}
            </button>
          </div>
        </footer>
    </aside>
  )
}
