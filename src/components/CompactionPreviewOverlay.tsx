import React, { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { tryit } from 'radash'
import { DEFAULT_BRIDGE_HTTP_URL } from '../hooks/useBridgeConnection'
import type { CompactionOpportunity } from '../services/compactionOpportunities'
import type { WalStats } from '../hooks/useWalStats'
import { formatTokens } from '../types/telemetry'

export interface CompactionPreviewOverlayProps {
  isOpen: boolean
  opportunities: CompactionOpportunity[]
  totalRawChars: number
  totalReclaimedChars: number
  walStats: WalStats | null
  onClose: () => void
}

export const CompactionPreviewOverlay: React.FC<CompactionPreviewOverlayProps> = ({
  isOpen,
  opportunities,
  totalRawChars,
  totalReclaimedChars,
  walStats,
  onClose,
}) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [showReplay, setShowReplay] = useState(false)
  const [replayText, setReplayText] = useState<string | null>(null)
  const [replayLoading, setReplayLoading] = useState(false)
  const [replayError, setReplayError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setSelectedNodeId(opportunities[0]?.nodeId ?? null)
      setShowReplay(false)
      setReplayText(null)
      setReplayError(null)
    }
  }, [isOpen, opportunities])

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

  const selectedOpp =
    opportunities.find((opp) => opp.nodeId === selectedNodeId) ??
    opportunities[0] ??
    null

  const handleReplay = async () => {
    if (!selectedOpp?.pointerId) return
    const pointerId = selectedOpp.pointerId
    setShowReplay(true)
    setReplayLoading(true)
    setReplayError(null)

    const [err, text] = await tryit(async () => {
      const res = await fetch(`${DEFAULT_BRIDGE_HTTP_URL}/api/wal/${encodeURIComponent(pointerId)}/replay`)
      if (!res.ok) {
        throw new Error(`回放失败: HTTP ${res.status}`)
      }
      return await res.text()
    })()

    setReplayLoading(false)
    if (err || text === undefined) {
      setReplayError('回放失败：未找到对应的 WAL 记录或 bridge 连接异常')
      setReplayText(null)
    } else {
      setReplayText(text)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[#1E2024]/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="压缩机会预演"
    >
      <div className="w-full max-w-5xl max-h-[80vh] flex flex-col rounded-2xl bg-[#FBF9F5] border border-[#DCD5C9] shadow-2xl overflow-hidden">
        {/* 头部：标题 + 汇总 + 关闭按钮 */}
        <header className="px-5 py-3 border-b border-[#DCD5C9] bg-[#F4F0EA] flex items-center justify-between shrink-0 select-none">
          <div className="flex items-baseline space-x-3">
            <h2 className="text-sm font-bold text-[#1E2024] tracking-tight">压缩机会预演</h2>
            <div className="text-[11px] font-mono text-[#5E6573]">
              <span>
                命中 {opportunities.length} 条 · 原始 {formatTokens(totalRawChars)} 字符 → 预计释放 {formatTokens(totalReclaimedChars)} 字符
              </span>
              {walStats && (
                <span className="text-[#8F887D]">
                  {' · '}bridge 已折叠 {walStats.totalEntries} 条 · 释放 {formatTokens(walStats.totalReclaimedChars)} 字符
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-[#8F887D] hover:text-[#1E2024] hover:bg-[#EAE5DC] transition-colors cursor-pointer"
            title="关闭 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* 主体两栏 */}
        {opportunities.length === 0 ? (
          <div className="p-12 text-center text-[#8F887D] text-xs font-mono">
            本次会话没有触发折叠条件的工具输出
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex overflow-hidden">
            {/* 左列候选列表 */}
            <div className="w-[320px] shrink-0 border-r border-[#E5E0D8] bg-[#FAF8F5] overflow-y-auto p-2.5 space-y-1.5 select-none">
              {opportunities.map((opp) => {
                const isSelected = opp.nodeId === (selectedOpp?.nodeId ?? '')
                return (
                  <button
                    key={opp.nodeId}
                    type="button"
                    onClick={() => {
                      setSelectedNodeId(opp.nodeId)
                      setShowReplay(false)
                      setReplayText(null)
                      setReplayError(null)
                    }}
                    className={`w-full text-left p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col gap-1.5 ${
                      isSelected
                        ? 'bg-white border-[#B5AFA4] shadow-xs'
                        : 'bg-[#FAF8F5] border-[#EFEAE2] hover:bg-white hover:border-[#DCD5C9]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-[11.5px] font-semibold text-[#1E2024] truncate min-w-0" title={opp.toolName}>
                        {opp.toolName}
                      </span>
                      {opp.pointerId && (
                        <span className="px-1.5 py-0.2 text-[9px] font-mono rounded bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0 font-medium">
                          已折叠
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-[10px] font-mono text-[#5E6573]">
                      <span>{opp.originalLines} 行 · {formatTokens(opp.originalChars)} 字符</span>
                      <span className="text-amber-700 font-medium">
                        释放 {formatTokens(opp.reclaimedChars)} 字符 ({opp.reclaimedPercent}%)
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* 右列三段对照与原文回放 */}
            <div className="flex-1 min-h-0 flex flex-col p-4 bg-white overflow-hidden">
              {selectedOpp && (
                <>
                  {showReplay ? (
                    <div className="flex-1 min-h-0 flex flex-col">
                      <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#E5E0D8] shrink-0">
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-semibold text-[#1E2024]">WAL 原文回放</span>
                          <code className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#F4F0EA] border border-[#DCD5C9] text-[#5E6573]">
                            {selectedOpp.pointerId}
                          </code>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowReplay(false)}
                          className="px-2.5 py-1 text-[11px] font-medium rounded-lg border border-[#DCD5C9] bg-white text-[#5E6573] hover:text-[#1E2024] hover:bg-[#F4F0EA] transition-colors cursor-pointer"
                        >
                          返回三段对照
                        </button>
                      </div>

                      {replayLoading ? (
                        <div className="flex-1 flex items-center justify-center text-xs font-mono text-[#8F887D]">
                          正在从 bridge 读取 WAL 原文...
                        </div>
                      ) : replayError ? (
                        <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
                          <span className="text-xs font-mono text-rose-700 mb-2">{replayError}</span>
                          <button
                            type="button"
                            onClick={handleReplay}
                            className="px-3 py-1 text-xs font-medium rounded-lg border border-[#DCD5C9] bg-white text-[#5E6573] hover:text-[#1E2024] transition-colors cursor-pointer"
                          >
                            重试
                          </button>
                        </div>
                      ) : (
                        <pre className="flex-1 min-h-0 bg-[#FAF8F5] border border-[#E5E0D8] rounded-xl p-3 text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-all overflow-y-auto text-[#1E2024]">
                          {replayText}
                        </pre>
                      )}
                    </div>
                  ) : (
                    <div className="flex-1 min-h-0 flex flex-col justify-between">
                      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
                        {/* 头部保留行 (emerald 系) */}
                        <div>
                          <div className="text-[11px] font-semibold text-emerald-800 mb-1 flex items-center justify-between">
                            <span>头部保留行 ({selectedOpp.headLines.length} 行)</span>
                          </div>
                          <pre className="bg-emerald-50/60 border border-emerald-200 rounded-lg p-2.5 text-[11px] font-mono text-emerald-950 whitespace-pre-wrap break-all max-h-[140px] overflow-y-auto">
                            {selectedOpp.headLines.join('\n') || '(无)'}
                          </pre>
                        </div>

                        {/* 折叠标记 (amber 系) */}
                        <div>
                          <div className="text-[11px] font-semibold text-amber-800 mb-1">
                            <span>折叠标记</span>
                          </div>
                          <pre className="bg-amber-50/80 border border-amber-300 rounded-lg p-2.5 text-[11px] font-mono text-amber-900 font-bold whitespace-pre-wrap break-all">
                            {selectedOpp.foldMarker || selectedOpp.compactSummary || '(无折叠标记)'}
                          </pre>
                        </div>

                        {/* 尾部保留行 (sky 系) */}
                        <div>
                          <div className="text-[11px] font-semibold text-sky-800 mb-1 flex items-center justify-between">
                            <span>尾部保留行 ({selectedOpp.tailLines.length} 行)</span>
                          </div>
                          <pre className="bg-sky-50/60 border border-sky-200 rounded-lg p-2.5 text-[11px] font-mono text-sky-950 whitespace-pre-wrap break-all max-h-[140px] overflow-y-auto">
                            {selectedOpp.tailLines.join('\n') || '(无)'}
                          </pre>
                        </div>
                      </div>

                      {/* 底部操作区 */}
                      {selectedOpp.pointerId && (
                        <div className="mt-3 pt-2.5 border-t border-[#E5E0D8] flex items-center justify-between shrink-0">
                          <span className="text-[10px] font-mono text-[#8F887D]">
                            bridge 已为该工具输出分配 WAL 指针: {selectedOpp.pointerId}
                          </span>
                          <button
                            type="button"
                            onClick={handleReplay}
                            className="px-3 py-1 text-[11px] font-semibold rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 transition-colors cursor-pointer flex items-center space-x-1"
                          >
                            <span>回放原文</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
