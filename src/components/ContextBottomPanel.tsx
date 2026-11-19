import React, { useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Layers,
  Database,
  ShieldCheck,
  Activity,
  FileCode,
  Copy,
  Check,
  AlertTriangle,
  Wrench,
  Terminal,
} from 'lucide-react'
import type { ContextState } from '../services/contextGovernanceEngine'

export interface ContextBottomPanelProps {
  isOpen: boolean
  onToggle: () => void
  contextState: ContextState
  onInspectWal?: (pointerId: string) => void
  onRestoreWal?: (pointerId: string) => void
  // 步进控制：移动到底部统一调度
  currentStepIndex: number
  totalSteps: number
  onPrev: () => void
  onNext: () => void
  onReset: () => void
  // 模拟前缀时间戳突变交互
  isTimestampInjected: boolean
  onToggleTimestampMutation: () => void
}

/**
 * 底部常驻上下文实体状态面板 (ContextBottomPanel)
 * 口语化直白设计：
 * - 顶栏：单步控制 + 上下文装配状态 + 核心 Token 对比
 * - 上层左侧：【1. Token 剩余容量与动态开销】(模型上下文上限、已装配、安全剩余空间、节约比例)
 * - 上层右侧：【2. 历史清理流水账 (备份索引表)】(掐头去尾与阶段精简备份，未裁减时引导，裁减后高亮浮现，带无损原件回溯)
 * - 下层全宽：【3. 固定前置上下文 · Prompt 骨架 (系统身份 + 用户目标 + 注册工具定义 + 任务里程碑)】(支持模拟时间戳突变破坏缓存交互)
 */
export const ContextBottomPanel: React.FC<ContextBottomPanelProps> = ({
  isOpen,
  onToggle,
  contextState,
  onInspectWal,
  onRestoreWal,
  currentStepIndex,
  totalSteps,
  onPrev,
  onNext,
  onReset,
  isTimestampInjected,
  onToggleTimestampMutation,
}) => {
  const [copiedHash, setCopiedHash] = useState(false)

  const { budget, staticPrefix, offloadedLedger } = contextState

  const handleCopyHash = () => {
    navigator.clipboard.writeText(staticPrefix.prefixHash)
    setCopiedHash(true)
    setTimeout(() => setCopiedHash(false), 1500)
  }

  const hasOffloaded = offloadedLedger.records.length > 0

  return (
    <div className="border-t border-[#E5E0D8] bg-[#F7F5F0] z-20 shrink-0 font-sans shadow-xs">
      {/* 1. 底部栏顶条：步进控制器 + 核心指标 + 展开/收起按钮 */}
      <div className="px-5 py-2 flex items-center justify-between text-xs border-b border-[#EAE4D9]">
        <div className="flex items-center space-x-3">
          {/* 上一步 / 下一步 / 重置 按钮组（操作顺手） */}
          <div className="flex items-center space-x-1 p-0.5 bg-[#EFECE6] border border-[#E5E0D8] rounded-lg">
            <button
              onClick={onPrev}
              disabled={currentStepIndex === 0}
              className={`p-1.5 rounded cursor-pointer transition-colors ${
                currentStepIndex === 0
                  ? 'text-[#B8B2A7] cursor-not-allowed'
                  : 'text-[#4A453E] hover:bg-[#FBF9F5]'
              }`}
              title="上一步"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={onNext}
              disabled={currentStepIndex === totalSteps - 1}
              className={`p-1.5 rounded cursor-pointer transition-colors ${
                currentStepIndex === totalSteps - 1
                  ? 'text-[#B8B2A7] cursor-not-allowed'
                  : 'text-[#4A453E] hover:bg-[#FBF9F5]'
              }`}
              title="下一步"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={onReset}
              className="p-1.5 rounded text-[#4A453E] hover:bg-[#FBF9F5] cursor-pointer"
              title="重置演练"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-mono font-medium">
            第 {currentStepIndex + 1} 步 / 共 {totalSteps} 步
          </span>

          <span className="text-[#D5CEC2]">|</span>

          {/* 标题与展开收起 */}
          <button
            onClick={onToggle}
            className="flex items-center space-x-1.5 font-semibold text-[#1E2024] hover:text-emerald-700 cursor-pointer transition-colors"
          >
            <Layers className="w-4 h-4 text-emerald-600" />
            <span>上下文装配状态 (Context State)</span>
            {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-[#8E887E]" /> : <ChevronUp className="w-3.5 h-3.5 text-[#8E887E]" />}
          </button>

          <span className="text-[#D5CEC2]">|</span>

          <div className="flex items-center space-x-1.5 font-mono">
            <span className="text-[#8E887E]">未治理原始输入:</span>
            <span className="font-semibold text-rose-700">{budget.rawTokensTotal.toLocaleString()} Tokens</span>
          </div>

          <span className="text-[#D5CEC2]">/</span>

          <div className="flex items-center space-x-1.5 font-mono">
            <span className="text-[#8E887E]">优化后实际装配:</span>
            <span className="font-semibold text-emerald-700">{budget.optimizedTokensTotal.toLocaleString()} Tokens</span>
          </div>

          <span className="text-[#D5CEC2]">|</span>

          <div className="flex items-center space-x-1.5">
            <span className="text-[#8E887E]">累计节省空间:</span>
            <span className="font-bold text-emerald-700 font-mono">
              {budget.savedPercent}%
            </span>
          </div>

          {hasOffloaded && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-purple-100 text-purple-900 border border-purple-300 font-mono font-bold animate-in fade-in duration-300">
              ⚡ 已存入备份流水账 {offloadedLedger.records.length} 条 (原件完整可查)
            </span>
          )}
        </div>

        <div className="flex items-center space-x-3 text-[11px] text-[#6E685E]">
          {isTimestampInjected ? (
            <span className="flex items-center space-x-1 text-rose-700 font-semibold bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
              <span>前缀发生突变！提示词缓存失效</span>
            </span>
          ) : (
            <span className="flex items-center space-x-1 text-emerald-800 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>固定前置骨架哈希锁定 (稳定命中 Prompt Cache 9折)</span>
            </span>
          )}

          <span className="font-mono text-[#8E887E] hidden md:inline">
            Hash: {staticPrefix.prefixHash.slice(0, 10)}...
          </span>

          <button
            onClick={onToggle}
            className="px-2 py-0.5 rounded border border-[#E5E0D8] bg-white text-[#4A453E] hover:bg-[#FAF8F5] cursor-pointer text-xs flex items-center space-x-1"
          >
            <span>{isOpen ? '收起' : '展开'}</span>
          </button>
        </div>
      </div>

      {/* 2. 展开后的两层全宽视图 */}
      {isOpen && (
        <div className="bg-[#FAF8F5] p-3 space-y-3 max-h-[380px] overflow-y-auto animate-in slide-in-from-bottom-2 duration-150 text-xs">
          {/* 上层：容量预算 (左侧) 与 历史清理流水账 (右侧) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* 上层左侧：Token 剩余容量与动态开销 */}
            <div className="p-3 bg-white rounded-lg border border-[#E5E0D8] space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5 font-semibold text-[#1E2024]">
                  <Activity className="w-3.5 h-3.5 text-sky-600" />
                  <span>1. Token 剩余容量与动态开销</span>
                </div>
                <span className="font-mono text-[11px] text-[#6E685E]">
                  模型最大上下文窗口 {budget.maxCapacity.toLocaleString()} Tokens
                </span>
              </div>

              <div className="w-full bg-[#EFECE6] h-2.5 rounded-full overflow-hidden flex">
                <div
                  className="bg-emerald-600 h-full transition-all duration-300"
                  style={{
                    width: `${Math.min(100, (budget.optimizedTokensTotal / budget.maxCapacity) * 100)}%`,
                  }}
                  title="优化后实际占用"
                />
              </div>

              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="text-[#6E685E]">
                  实际已占用: <b className="text-emerald-700">{budget.optimizedTokensTotal.toLocaleString()} Tokens</b> (剩余可用空间: {budget.headroomTokens.toLocaleString()})
                </span>
                <span className="text-emerald-700 font-bold">
                  累计节省空间: {budget.savedPercent}% (-{budget.reclaimedTokensTotal.toLocaleString()} Tokens)
                </span>
              </div>
            </div>

            {/* 上层右侧：历史清理流水账 (掐头去尾截断与阶段精简备份索引) */}
            <div className={`p-3 rounded-lg border transition-all duration-200 ${
              hasOffloaded
                ? 'bg-purple-50/70 border-purple-200/80 shadow-2xs'
                : 'bg-white border-[#E5E0D8]'
            }`}>
              <div className="flex items-center justify-between pb-1.5 border-b border-[#EAE4D9]/60">
                <div className="flex items-center space-x-1.5 font-semibold text-[#1E2024]">
                  <Database className="w-3.5 h-3.5 text-purple-600" />
                  <span>2. 历史清理流水账 (保留唯一索引 ID，随时秒级调取原件)</span>
                </div>
                <span className="font-mono text-[10px] text-purple-800 font-bold">
                  {hasOffloaded ? `已备份 ${offloadedLedger.records.length} 处` : '当前尚未触发截断与精简'}
                </span>
              </div>

              {!hasOffloaded ? (
                <div className="py-2.5 text-center text-[#8E887E] text-[11px] leading-relaxed">
                  在节点上执行<b>「掐头去尾截断」</b>或<b>「前半段定稿：一键打包精简」</b>后，被清理掉的完整文本与索引 ID 会记录在此流水账中，保证细节绝不丢失。
                </div>
              ) : (
                <div className="space-y-1.5 pt-1.5 max-h-24 overflow-y-auto pr-1">
                  {offloadedLedger.records.map((rec) => (
                    <div
                      key={rec.pointerId}
                      className="p-1.5 bg-white border border-purple-200 rounded flex items-center justify-between text-[11px] font-mono"
                    >
                      <div className="space-y-0.5 truncate mr-2">
                        <div className="font-bold text-[#1E2024] truncate">
                          {rec.stepTitle}
                        </div>
                        <div className="text-[10px] text-[#6E685E]">
                          {rec.originalLines} 行 → <b className="text-emerald-700">{rec.compactedLines} 行</b> | 释放 +{rec.reclaimedTokens} Tokens
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 shrink-0">
                        <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 text-[10px] font-bold">
                          {rec.pointerId}
                        </span>
                        {onInspectWal && (
                          <button
                            onClick={() => onInspectWal(rec.pointerId)}
                            className="px-2 py-0.5 rounded border border-[#E5E0D8] hover:bg-[#F4F0EA] text-[#4A453E] cursor-pointer flex items-center space-x-1 text-[10px]"
                            title="按索引 ID 从备份仓库 100% 原样取回完整原文查看"
                          >
                            <FileCode className="w-3 h-3 text-[#8E887E]" />
                            <span>按ID取回</span>
                          </button>
                        )}
                        {onRestoreWal && (
                          <button
                            onClick={() => onRestoreWal(rec.pointerId)}
                            className="px-2 py-0.5 rounded border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 cursor-pointer flex items-center space-x-1 text-[10px] font-semibold"
                            title="按索引 ID 把抽离出去的原文还原放回上下文，撤销这次裁剪"
                          >
                            <RotateCcw className="w-3 h-3 text-emerald-700" />
                            <span>还原放回</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 下层：固定前置上下文 · Prompt 骨架 (系统身份 + 用户目标 + 注册工具定义 + 任务里程碑) */}
          <div className="p-3 bg-white rounded-lg border border-[#E5E0D8] space-y-2.5">
            <div className="flex items-center justify-between border-b border-[#EAE4D9]/60 pb-1.5">
              <div className="flex items-center space-x-2">
                <div className="flex items-center space-x-1.5 font-semibold text-[#1E2024]">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  <span>3. 固定前置上下文 · Prompt 骨架 (字节级完全一致，稳定命中大模型 Prompt Cache 9折)</span>
                </div>
                {/* 模拟时间戳突变交互按钮 */}
                <button
                  onClick={onToggleTimestampMutation}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer transition-all flex items-center space-x-1 ${
                    isTimestampInjected
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      : 'bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300'
                  }`}
                  title="演示在固定前置提示词中误加动态时间戳，导致前缀哈希突变而丢掉缓存优惠的反面案例"
                >
                  {isTimestampInjected ? (
                    <>
                      <RotateCcw className="w-3 h-3" />
                      <span>恢复字节级锁定 (重新命中9折缓存)</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-3 h-3 text-rose-600" />
                      <span>演示反面案例：误插动态时间戳 (破坏缓存)</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex items-center space-x-1">
                <span className="text-[10px] font-mono text-[#8E887E]">SHA-256 骨架指纹:</span>
                <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border transition-colors ${
                  isTimestampInjected
                    ? 'bg-rose-100 text-rose-900 border-rose-400 animate-pulse'
                    : 'bg-[#F4F0EA] text-[#1E2024] border-[#E5E0D8]'
                }`}>
                  {staticPrefix.prefixHash.slice(0, 16)}...
                </span>
                <button
                  onClick={handleCopyHash}
                  className="p-1 rounded text-[#6E685E] hover:text-[#1E2024] cursor-pointer"
                  title="复制完整前缀哈希"
                >
                  {copiedHash ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            </div>

            {/* 四大固定块横排：①② 窄、③ 中、④ 里程碑最宽；整块固定高度，里程碑横向滚动不撑高 */}
            <div className="grid grid-cols-12 gap-2 text-[11px] leading-relaxed h-[104px]">
              {/* 1. 系统身份与原则 (窄) */}
              <div className="col-span-2 p-2 bg-[#FAF8F5] rounded border border-[#EAE4D9] space-y-1 overflow-hidden">
                <span className="font-semibold text-[#4A453E] flex items-center space-x-1">
                  <Terminal className="w-3 h-3 text-slate-600 shrink-0" />
                  <span>① 系统身份与原则</span>
                </span>
                <p className="text-[#6E685E] font-mono text-[9px] leading-tight line-clamp-3">
                  {staticPrefix.pinnedDirectives.systemPrompt}
                </p>
                {isTimestampInjected && (
                  <div className="p-1 bg-rose-50 border border-rose-300 rounded text-rose-800 text-[9px] font-mono line-clamp-2">
                    ⚠️ 误插时间戳，前缀突变
                  </div>
                )}
              </div>

              {/* 2. 注册工具 Schema (窄，横向滚动) */}
              <div className="col-span-2 p-2 bg-[#FAF8F5] rounded border border-[#EAE4D9] space-y-1 overflow-hidden">
                <span className="font-semibold text-[#4A453E] flex items-center space-x-1">
                  <Wrench className="w-3 h-3 text-amber-600 shrink-0" />
                  <span>② 工具定义 ({staticPrefix.pinnedDirectives.registeredTools.length})</span>
                </span>
                <div className="flex flex-wrap gap-1 max-h-[52px] overflow-y-auto">
                  {staticPrefix.pinnedDirectives.registeredTools.map((t) => (
                    <span
                      key={t.name}
                      className="px-1 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200 text-[9px] font-mono"
                      title={`${t.name}: ${t.description} | 参数: ${t.parameters}`}
                    >
                      {t.name}
                    </span>
                  ))}
                </div>
              </div>

              {/* 3. 用户初始目标 (中) */}
              <div className="col-span-3 p-2 bg-[#FAF8F5] rounded border border-[#EAE4D9] space-y-1 overflow-hidden">
                <span className="font-semibold text-[#4A453E]">③ 用户初始目标 (User Goal)</span>
                <p className="text-[#1E2024] font-medium leading-snug text-[10px] line-clamp-4">
                  {staticPrefix.pinnedDirectives.userGoal}
                </p>
              </div>

              {/* 4. 任务里程碑与约束 (最宽，里程碑横向滚动) */}
              <div className="col-span-5 p-2 bg-[#FAF8F5] rounded border border-[#EAE4D9] space-y-1 overflow-hidden">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#4A453E]">④ 任务里程碑与原则约束</span>
                  <span className="text-[10px] font-mono text-emerald-700 font-bold shrink-0">
                    {staticPrefix.pinnedDirectives.completedMilestones.length} 达标
                  </span>
                </div>
                <div className="text-[9px] text-[#6E685E] font-mono leading-tight line-clamp-2">
                  {staticPrefix.pinnedDirectives.hardConstraints.join('；')}
                </div>
                <div className="flex gap-1 pt-1 overflow-x-auto whitespace-nowrap pb-1">
                  {staticPrefix.pinnedDirectives.completedMilestones.map((m, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center space-x-0.5 px-1 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[9px] font-mono font-medium shrink-0"
                    >
                      <span className="text-emerald-600 font-bold">✓</span>
                      <span>{m}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
