import React, { useState } from 'react'
import { Info, Eye, Zap } from 'lucide-react'
import {
  type ContextWatermark,
  type PrunableItem,
  DEFAULT_CONTEXT_WATERMARK,
  formatTokens,
} from '../types/telemetry'
import type { WalStats } from '../hooks/useWalStats'
import { FALLBACK_CONTEXT_WINDOW } from '../services/modelWindows'

export interface ContextStripBarProps {
  watermark: ContextWatermark
  disabled?: boolean
  className?: string
  prunableItems?: PrunableItem[]
  onInspect?: () => void
  isInspectorOpen?: boolean
  walStats?: WalStats | null
  isWalOffline?: boolean
}

const PROVENANCE_BADGES: Record<
  'counted' | 'estimated' | 'live',
  { label: string; cls: string; title: string }
> = {
  counted: {
    label: '实测 Counted',
    cls: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    title: '来自真实 usage（JSONL 的 message.usage）',
  },
  estimated: {
    label: '估算 Estimated',
    cls: 'bg-amber-50 border-amber-300 text-amber-800',
    title: '该会话 JSONL 未记录 usage，Token 按字符量启发式粗估',
  },
  live: {
    label: '实时 Live',
    cls: 'bg-indigo-50 border-indigo-300 text-indigo-800',
    title: '由实时流增量与手势启发式推算，非真实 usage',
  },
}

export const ContextStripBar: React.FC<ContextStripBarProps> = ({
  watermark = DEFAULT_CONTEXT_WATERMARK,
  disabled: _disabled = false,
  className = '',
  prunableItems = [],
  onInspect,
  isInspectorOpen = false,
  walStats,
  isWalOffline,
}) => {
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null)

  const provenanceBadge = watermark.provenance ? PROVENANCE_BADGES[watermark.provenance] : null

  // 1. 全维真实上下文提取与兼容降级
  const totalLimit = watermark.maxCapacity || watermark.totalLimit || FALLBACK_CONTEXT_WINDOW
  const systemPrompt = watermark.systemPrompt || 8000
  const ltm = watermark.ltm || 0
  const reasoningTokens = watermark.reasoningTokens || 0
  const activeTurns =
    watermark.conversationHistory !== undefined
      ? watermark.conversationHistory + reasoningTokens
      : watermark.activeTurns
  const prunableTools =
    watermark.toolOutputs !== undefined ? watermark.toolOutputs : watermark.prunableTools
  const cacheRead = watermark.cacheRead || 0

  const totalUsed =
    watermark.total !== undefined
      ? watermark.total
      : systemPrompt + ltm + activeTurns + prunableTools

  const usagePercent = Math.min(100, Math.round((totalUsed / totalLimit) * 100))

  // 计算各片段占总限额 (totalLimit) 的百分比宽度
  const systemPct = (systemPrompt / totalLimit) * 100
  const ltmPct = (ltm / totalLimit) * 100
  const activePct = (activeTurns / totalLimit) * 100
  const prunablePct = (prunableTools / totalLimit) * 100

  // 告警水位分级：>= 65% 为琥珀色告警 (Amber Warning)，< 65% 为安全绿色 (Safe Green)
  const isWarning = usagePercent >= 65
  const isCritical = usagePercent >= 85

  const statusDotClass = isCritical
    ? 'bg-rose-500 animate-pulse'
    : isWarning
      ? 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.7)]'
      : 'bg-emerald-500'

  return (
    <div
      className={`border-b border-[#E5E0D8] bg-[#FAF8F3] px-5 py-2.5 flex flex-col justify-center transition-all duration-300 ${className}`}
      onClick={(e) => {
        // 点击空白区域时若未点击具体按钮，亦从底部展开上下文明细抽屉
        const target = e.target as HTMLElement
        if (!target.closest('button') && onInspect) {
          onInspect()
        }
      }}
      title="点击任意区域即可从底部展开上下文构成明细抽屉 (Context Inspector Drawer)"
    >
      {/* 顶部统计与操作行 */}
      <div className="flex items-center justify-between text-xs mb-2">
        {/* 左侧：标题、总体水位及状态 */}
        <div className="flex items-center space-x-3">
          <div
            className="flex items-center space-x-1.5 font-semibold text-[#1E2024] cursor-pointer hover:text-violet-900 transition-colors"
            onClick={onInspect}
          >
            <span
              className={`w-2 h-2 rounded-full transition-colors duration-500 ${statusDotClass}`}
            />
            <span>上下文 Token 内存水位</span>
          </div>

          {/* 来源徽标 */}
          {provenanceBadge && (
            <span
              className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${provenanceBadge.cls}`}
              title={provenanceBadge.title}
            >
              {provenanceBadge.label}
            </span>
          )}

          {/* Token 总体指标 */}
          <div className="font-mono text-xs text-[#5E6573] flex items-center space-x-1.5">
            <span className="font-semibold text-[#1E2024]">
              {formatTokens(totalUsed)} / {formatTokens(totalLimit)}
            </span>
            <span className="text-[#8F887D]">({usagePercent}%)</span>
            {watermark.windowSource === 'default' && (
              <span
                className="text-[10px] text-[#8F887D]"
                title="该模型不在本地窗口规则表内，按 200k 兜底计算占用百分比"
              >
                窗口未知·按 200k 兜底
              </span>
            )}
          </div>

          {/* 运行态安全 / 告警状态指示胶囊 */}
          <div
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-all duration-300 ${
              isWarning
                ? 'bg-amber-50 border-amber-300 text-amber-800'
                : 'bg-emerald-50 border-emerald-200 text-emerald-700'
            }`}
          >
            {isWarning ? '告警水位 (Amber Warning)' : '安全水位 (Safe)'}
          </div>

          {/* Prompt Cache 命中标识 */}
          {cacheRead > 0 && (
            <div className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-mono border bg-amber-50/90 border-amber-300 text-amber-800">
              <Zap className="w-3 h-3 text-amber-600 fill-amber-500" />
              <span>Cache: {formatTokens(cacheRead)}</span>
            </div>
          )}

          {/* 估算 / 实时推算极简提示 */}
          {(watermark.provenance === 'estimated' || watermark.provenance === 'live') && (
            <span className="text-[10px] text-[#8F887D]">数值为推算</span>
          )}
        </div>

        {/* 右侧：明细查看按钮 */}
        <div className="flex items-center space-x-2.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              if (onInspect) onInspect()
            }}
            title={
              isInspectorOpen
                ? '收起上下文分析视窗'
                : `从底部展开上下文水位明细与 ${prunableItems.length > 0 ? `${prunableItems.length} 个` : ''}高耗工具微压缩预览`
            }
            className={`px-2.5 py-1 text-xs font-medium rounded-md border flex items-center space-x-1.5 transition-colors cursor-pointer ${
              isInspectorOpen
                ? 'bg-[#EAE5DC] text-[#1E2024] border-[#B5AFA4] shadow-2xs font-semibold'
                : 'border-[#E5E0D8] bg-white text-[#5E6573] hover:text-[#1E2024] hover:bg-[#F4F0EA] hover:border-[#B5AFA4]'
            }`}
          >
            <Eye className="w-3.5 h-3.5 text-[#8F887D]" />
            <span>{isInspectorOpen ? '收起抽屉 (Close)' : '明细抽屉 (Drawer)'}</span>
          </button>
        </div>
      </div>

      {/* 中间多段水平条 (Multi-segmented Context Strip) */}
      <div
        className="relative w-full h-3 rounded-md bg-[#ECE8E1] border border-[#DCD5C9] overflow-hidden flex shadow-inner cursor-pointer hover:border-[#B5AFA4] transition-colors"
        onClick={(e) => {
          e.stopPropagation()
          if (onInspect) onInspect()
        }}
        title="点击从底部展开上下文构成明细抽屉"
      >
        {/* 片段 1: System Prompt (neutral violet/gray) */}
        <div
          style={{ width: `${systemPct}%` }}
          className="h-full bg-[#A8A29E] hover:brightness-95 transition-all duration-700 ease-out cursor-help"
          onMouseEnter={() => setActiveTooltip('system')}
          onMouseLeave={() => setActiveTooltip(null)}
          title={`系统提示词 (System Prompt): ${formatTokens(systemPrompt)} (${Math.round(systemPct)}%)`}
        />

        {/* 片段 2: Long-term Memory (slate/charcoal) */}
        {ltm > 0 && (
          <div
            style={{ width: `${ltmPct}%` }}
            className="h-full bg-[#334155] hover:brightness-110 transition-all duration-700 ease-out cursor-help"
            onMouseEnter={() => setActiveTooltip('ltm')}
            onMouseLeave={() => setActiveTooltip(null)}
            title={`长期事实记忆 (LTM Alaya): ${formatTokens(ltm)} (${Math.round(ltmPct)}%)`}
          />
        )}

        {/* 片段 3: Active Turns (subtle sky/indigo) */}
        <div
          style={{ width: `${activePct}%` }}
          className="h-full bg-[#6366F1] hover:brightness-105 transition-all duration-700 ease-out cursor-help"
          onMouseEnter={() => setActiveTooltip('active')}
          onMouseLeave={() => setActiveTooltip(null)}
          title={`对话与思考 (Dialogue & Thinking): ${formatTokens(activeTurns)} (${Math.round(activePct)}%)`}
        />

        {/* 片段 4: Prunable Tools (amber/orange) */}
        <div
          style={{ width: `${prunablePct}%` }}
          className="h-full bg-[#F59E0B] hover:brightness-105 transition-all duration-700 ease-out cursor-help"
          onMouseEnter={() => setActiveTooltip('tools')}
          onMouseLeave={() => setActiveTooltip(null)}
          title={`工具输出与载荷 (Tool Payloads): ${formatTokens(prunableTools)} (${Math.round(prunablePct)}%)`}
        />
      </div>

      {/* 底部明细图例 (Breakdown Legend) */}
      <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-[#EFEAE1] text-[11px] text-[#5E6573] font-mono">
        <div className="flex items-center space-x-4">
          {/* Legend 1: System */}
          <div
            className={`flex items-center space-x-1.5 transition-opacity ${
              activeTooltip && activeTooltip !== 'system' ? 'opacity-40' : 'opacity-100'
            }`}
          >
            <span className="w-2 h-2 rounded-xs bg-[#A8A29E] shrink-0" />
            <span className="text-[#8F887D]">系统提示:</span>
            <span className="font-semibold text-[#1E2024]">{formatTokens(systemPrompt)}</span>
          </div>

          {/* Legend 2: LTM (若有) */}
          {ltm > 0 && (
            <div
              className={`flex items-center space-x-1.5 transition-opacity ${
                activeTooltip && activeTooltip !== 'ltm' ? 'opacity-40' : 'opacity-100'
              }`}
            >
              <span className="w-2 h-2 rounded-xs bg-[#334155] shrink-0" />
              <span className="text-[#8F887D]">长期记忆:</span>
              <span className="font-semibold text-[#1E2024]">{formatTokens(ltm)}</span>
            </div>
          )}

          {/* Legend 3: Active Turns */}
          <div
            className={`flex items-center space-x-1.5 transition-opacity ${
              activeTooltip && activeTooltip !== 'active' ? 'opacity-40' : 'opacity-100'
            }`}
          >
            <span className="w-2 h-2 rounded-xs bg-[#6366F1] shrink-0" />
            <span className="text-[#8F887D]">对话思考:</span>
            <span className="font-semibold text-[#1E2024]">{formatTokens(activeTurns)}</span>
          </div>

          {/* Legend 4: Prunable Tools */}
          <div
            className={`flex items-center space-x-1.5 transition-opacity ${
              activeTooltip && activeTooltip !== 'tools' ? 'opacity-40' : 'opacity-100'
            }`}
          >
            <span className="w-2 h-2 rounded-xs shrink-0 bg-[#F59E0B]" />
            <span className="text-[#8F887D]">工具载荷:</span>
            <span className="font-semibold text-[#1E2024]">
              {formatTokens(prunableTools)}
            </span>
          </div>

          {/* Legend 5: Cache Read (若有命中) */}
          {cacheRead > 0 && (
            <div className="flex items-center space-x-1.5">
              <Zap className="w-3 h-3 text-amber-500 fill-amber-500 shrink-0" />
              <span className="text-[#8F887D]">Cache加速:</span>
              <span className="font-semibold text-amber-900">{formatTokens(cacheRead)}</span>
            </div>
          )}
        </div>

        {/* 右侧：真实账小字 + 辅助提示 */}
        <div className="flex items-center space-x-3">
          {isWalOffline ? (
            <span className="text-[10px] text-[#8F887D]">bridge 未连接</span>
          ) : walStats ? (
            <span className="text-[10px] text-[#5E6573]">
              bridge 已折叠 {walStats.totalEntries} 条 · 释放 {formatTokens(walStats.totalReclaimedChars)} 字符
            </span>
          ) : null}

          <div
            className="flex items-center space-x-1 text-[10px] text-[#8F887D] cursor-pointer hover:text-[#1E2024] transition-colors"
            onClick={onInspect}
          >
            <Info className="w-3 h-3 text-[#A8A29E]" />
            <span>点击水位条即可向上展开各片段明细与微压缩预览</span>
          </div>
        </div>
      </div>
    </div>
  )
}
