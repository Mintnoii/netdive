import React, { useState } from 'react'
import { Scissors, Sparkles, Check, Info, Eye } from 'lucide-react'
import {
  type ContextWatermark,
  type PrunableItem,
  DEFAULT_CONTEXT_WATERMARK,
  formatTokens,
} from '../types/telemetry'

export interface ContextStripBarProps {
  watermark: ContextWatermark
  isPruned?: boolean
  reclaimedTokens?: number
  onPrune?: () => void
  disabled?: boolean
  className?: string
  prunableItems?: PrunableItem[]
  onInspect?: () => void
  isInspectorOpen?: boolean
}

export const ContextStripBar: React.FC<ContextStripBarProps> = ({
  watermark = DEFAULT_CONTEXT_WATERMARK,
  isPruned = false,
  reclaimedTokens = 0,
  onPrune,
  disabled = false,
  className = '',
  prunableItems = [],
  onInspect,
  isInspectorOpen = false,
}) => {
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null)

  const { totalLimit, systemPrompt, ltm, activeTurns, prunableTools } = watermark
  const totalUsed = systemPrompt + ltm + activeTurns + prunableTools
  const usagePercent = Math.min(100, Math.round((totalUsed / totalLimit) * 100))

  // 计算各片段占总限额 (totalLimit) 的百分比宽度
  const systemPct = (systemPrompt / totalLimit) * 100
  const ltmPct = (ltm / totalLimit) * 100
  const activePct = (activeTurns / totalLimit) * 100
  const prunablePct = (prunableTools / totalLimit) * 100

  // 告警水位分级：>= 65% 为琥珀色告警 (Amber Warning)，< 65% 为安全绿色 (Safe Green)
  const isWarning = usagePercent >= 65 && !isPruned
  const isCritical = usagePercent >= 85 && !isPruned

  const statusDotClass = isCritical
    ? 'bg-rose-500 animate-pulse'
    : isWarning
      ? 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.7)]'
      : 'bg-emerald-500'

  // 剪枝动作是否可用 (若已剪枝或无可修剪工具调用则置灰)
  const canPrune = !isPruned && prunableTools > 4000 && !disabled

  return (
    <div
      className={`border-b border-[#E5E0D8] bg-[#FAF8F3] px-5 py-2.5 flex flex-col justify-center transition-all duration-300 ${className}`}
    >
      {/* 顶部统计与操作行 */}
      <div className="flex items-center justify-between text-xs mb-2">
        {/* 左侧：标题、总体水位及状态 */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 font-semibold text-[#1E2024]">
            <span
              className={`w-2 h-2 rounded-full transition-colors duration-500 ${statusDotClass}`}
            />
            <span>上下文 Token 内存水位</span>
          </div>

          {/* Token 总体指标 */}
          <div className="font-mono text-xs text-[#5E6573] flex items-center space-x-1.5">
            <span className="font-semibold text-[#1E2024]">
              {formatTokens(totalUsed)} / {formatTokens(totalLimit)}
            </span>
            <span className="text-[#8F887D]">({usagePercent}%)</span>
          </div>

          {/* 运行态安全 / 告警状态指示胶囊 */}
          {!isPruned && (
            <div
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-all duration-300 ${
                isWarning
                  ? 'bg-amber-50 border-amber-300 text-amber-800'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-700'
              }`}
            >
              {isWarning ? '告警水位 (Amber Warning)' : '安全水位 (Safe)'}
            </div>
          )}

          {/* 剪枝已释放指示器 */}
          {isPruned && (
            <div className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 font-mono text-[11px] animate-fade-in">
              <Check className="w-3 h-3 text-emerald-600" />
              <span className="font-semibold">
                -{formatTokens(reclaimedTokens || 42000)} tokens released
              </span>
              <span className="text-emerald-700/80 text-[10px]">
                (冗余工具已折叠)
              </span>
            </div>
          )}
        </div>

        {/* 右侧：明细查看与剪枝操作按钮 */}
        <div className="flex items-center space-x-2.5">
          {/* 查看明细 (Inspect) 按钮 */}
          <button
            type="button"
            onClick={onInspect}
            title={
              isInspectorOpen
                ? '收起冗余上下文修剪抽屉'
                : `查看当前上下文 ${prunableItems.length > 0 ? `${prunableItems.length} 个` : ''}冗余工具调用明细与折叠预览`
            }
            className={`px-2.5 py-1 text-xs font-medium rounded-md border flex items-center space-x-1.5 transition-colors cursor-pointer ${
              isInspectorOpen
                ? 'bg-[#EAE5DC] text-[#1E2024] border-[#B5AFA4] shadow-2xs font-semibold'
                : 'border-[#E5E0D8] bg-white text-[#5E6573] hover:text-[#1E2024] hover:bg-[#F4F0EA] hover:border-[#B5AFA4]'
            }`}
          >
            <Eye className="w-3.5 h-3.5 text-[#8F887D]" />
            <span>{isInspectorOpen ? '收起明细 (Close)' : '查看明细 (Inspect)'}</span>
          </button>

          <button
            type="button"
            onClick={onPrune}
            disabled={!canPrune}
            title={
              isPruned
                ? '历史冗余上下文工具调用已完成剪枝折叠'
                : '一键将冗余工具调用折叠压缩为摘要，释放 Token 水位'
            }
            className={`px-3 py-1 text-xs font-medium rounded-md border flex items-center space-x-1.5 transition-all duration-200 cursor-pointer ${
              canPrune
                ? 'bg-white text-amber-900 border-amber-300 hover:bg-amber-50 hover:border-amber-400 shadow-2xs'
                : 'bg-[#EDE8E0] text-[#8F887D] border-[#D6D0C5] cursor-not-allowed opacity-70'
            }`}
          >
            {isPruned ? (
              <>
                <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                <span>已修剪 (Pruned)</span>
              </>
            ) : (
              <>
                <Scissors className="w-3.5 h-3.5 text-amber-700" />
                <span>修剪冗余上下文 (Prune Context)</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 中间多段水平条 (Multi-segmented Context Strip) */}
      <div className="relative w-full h-3 rounded-md bg-[#ECE8E1] border border-[#DCD5C9] overflow-hidden flex shadow-inner">
        {/* 片段 1: System Prompt (neutral gray) */}
        <div
          style={{ width: `${systemPct}%` }}
          className="h-full bg-[#A8A29E] hover:brightness-95 transition-all duration-700 ease-out cursor-help"
          onMouseEnter={() => setActiveTooltip('system')}
          onMouseLeave={() => setActiveTooltip(null)}
          title={`系统提示词 (System Prompt): ${formatTokens(systemPrompt)} (${Math.round(systemPct)}%)`}
        />

        {/* 片段 2: Long-term Memory (slate/charcoal) */}
        <div
          style={{ width: `${ltmPct}%` }}
          className="h-full bg-[#334155] hover:brightness-110 transition-all duration-700 ease-out cursor-help"
          onMouseEnter={() => setActiveTooltip('ltm')}
          onMouseLeave={() => setActiveTooltip(null)}
          title={`长期事实记忆 (LTM Alaya): ${formatTokens(ltm)} (${Math.round(ltmPct)}%)`}
        />

        {/* 片段 3: Active Turns (subtle sky/indigo) */}
        <div
          style={{ width: `${activePct}%` }}
          className="h-full bg-[#6366F1] hover:brightness-105 transition-all duration-700 ease-out cursor-help"
          onMouseEnter={() => setActiveTooltip('active')}
          onMouseLeave={() => setActiveTooltip(null)}
          title={`活动轮次交互 (Active Turns): ${formatTokens(activeTurns)} (${Math.round(activePct)}%)`}
        />

        {/* 片段 4: Prunable Tools (amber/orange) */}
        <div
          style={{ width: `${prunablePct}%` }}
          className={`h-full transition-all duration-700 ease-out cursor-help ${
            isPruned ? 'bg-amber-600/70' : 'bg-[#F59E0B] hover:brightness-105'
          }`}
          onMouseEnter={() => setActiveTooltip('tools')}
          onMouseLeave={() => setActiveTooltip(null)}
          title={`可修剪工具调用 (Prunable Tools): ${formatTokens(prunableTools)} (${Math.round(prunablePct)}%)`}
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

          {/* Legend 2: LTM */}
          <div
            className={`flex items-center space-x-1.5 transition-opacity ${
              activeTooltip && activeTooltip !== 'ltm' ? 'opacity-40' : 'opacity-100'
            }`}
          >
            <span className="w-2 h-2 rounded-xs bg-[#334155] shrink-0" />
            <span className="text-[#8F887D]">长期记忆:</span>
            <span className="font-semibold text-[#1E2024]">{formatTokens(ltm)}</span>
          </div>

          {/* Legend 3: Active Turns */}
          <div
            className={`flex items-center space-x-1.5 transition-opacity ${
              activeTooltip && activeTooltip !== 'active' ? 'opacity-40' : 'opacity-100'
            }`}
          >
            <span className="w-2 h-2 rounded-xs bg-[#6366F1] shrink-0" />
            <span className="text-[#8F887D]">活动轮次:</span>
            <span className="font-semibold text-[#1E2024]">{formatTokens(activeTurns)}</span>
          </div>

          {/* Legend 4: Prunable Tools */}
          <div
            className={`flex items-center space-x-1.5 transition-opacity ${
              activeTooltip && activeTooltip !== 'tools' ? 'opacity-40' : 'opacity-100'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-xs shrink-0 ${
                isPruned ? 'bg-amber-600/70' : 'bg-[#F59E0B]'
              }`}
            />
            <span className="text-[#8F887D]">冗余工具:</span>
            <span className={`font-semibold ${isPruned ? 'text-amber-800' : 'text-[#1E2024]'}`}>
              {formatTokens(prunableTools)}
            </span>
            {isPruned && (
              <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1 rounded">
                已收缩
              </span>
            )}
          </div>
        </div>

        {/* 辅助提示 */}
        <div className="flex items-center space-x-1 text-[10px] text-[#8F887D]">
          <Info className="w-3 h-3 text-[#A8A29E]" />
          <span>
            {isPruned
              ? '拓扑节点已折叠为摘要，冗余 Token 已释放'
              : '长会话中工具输入输出为最大冗余源，可按需剪枝'}
          </span>
        </div>
      </div>
    </div>
  )
}
