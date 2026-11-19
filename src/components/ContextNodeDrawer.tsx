import React from 'react'
import {
  X,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Scissors,
  FileCode,
  ShieldCheck,
  Terminal,
} from 'lucide-react'
import type { GovernanceStep } from '../services/contextGovernanceEngine'

export interface ContextNodeDrawerProps {
  isOpen: boolean
  onClose: () => void
  step: GovernanceStep
  isOptimized: boolean
  onToggleCompact: () => void
  onInspectRaw: (raw: string) => void
}

/**
 * 侧边节点上下文详情与治理建议抽屉 (ContextNodeDrawer)
 * 点击画布中节点即可在右侧顺畅滑出，显示当前节点上下文的深度指标、执行参数与治理方案
 */
export const ContextNodeDrawer: React.FC<ContextNodeDrawerProps> = ({
  isOpen,
  onClose,
  step,
  isOptimized,
  onToggleCompact,
  onInspectRaw,
}) => {
  if (!isOpen) return null

  return (
    <div className="absolute top-12 bottom-0 right-0 z-30 w-96 bg-[#FAF8F5] text-[#1E2024] shadow-2xl border-l border-[#E5E0D8] flex flex-col font-sans animate-in slide-in-from-right duration-150">
      {/* 头部 */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E5E0D8] bg-[#F4F0EA]">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-4 h-4 text-amber-600" />
          <h2 className="text-sm font-semibold text-[#1E2024]">
            节点上下文与治理分析
          </h2>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-[#8E887E] hover:text-[#1E2024] hover:bg-[#EAE4D9] cursor-pointer transition-colors"
          title="关闭"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 内容主体 */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
        {/* 节点基本信息 */}
        <div className="p-3 bg-white rounded-lg border border-[#E5E0D8] space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-xs text-[#1E2024]">
              Step {step.stepIndex + 1}: {step.title}
            </span>
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#EFECE6] text-[#6E685E]">
              {step.actor}
            </span>
          </div>
          <p className="text-[11px] text-[#6E685E] leading-relaxed">
            {step.summary}
          </p>
          {step.gesture === 'bash' && step.rawOutput && (
            <div className="pt-1">
              <div className="flex items-center space-x-1 text-[10px] text-[#8E887E] font-mono mb-1">
                <Terminal className="w-3 h-3" />
                <span>执行命令:</span>
              </div>
              <pre className="p-1.5 bg-[#1E2024] text-slate-200 rounded font-mono text-[10px] overflow-x-auto">
                {step.rawOutput.split('\n')[0]}
              </pre>
            </div>
          )}
        </div>

        {/* 上下文治理建议卡片 */}
        <div className="space-y-3">
          <span className="font-semibold text-xs text-[#1E2024] block">
            治理决策与上下文特征 (Governance Analysis)
          </span>

          {step.hasLargePayload ? (
            <div className="p-3 bg-amber-50/90 border border-amber-300 rounded-lg space-y-2.5">
              <div className="flex items-start space-x-2 text-amber-900 font-semibold">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <div>检测到大体积工具输出 ({step.largePayloadLines} 行)</div>
                  <div className="text-[10px] font-normal text-amber-800 font-mono mt-0.5">
                    未优化前占用超过 2,000 Tokens
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-amber-900/90 leading-relaxed">
                当前命令行产生了大量的全库向量校验日志。如果不加治理，会迅速引起上下文注意力稀释并推高计费。
                <b>建议策略：</b> 保留前 15 行（命令与入参）和后 15 行（退出码与聚合摘要），将完整原文转存至历史清理流水账，保留唯一索引 ID。
              </p>

              <div className="pt-2 border-t border-amber-200/80 flex items-center space-x-2">
                <button
                  onClick={onToggleCompact}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold cursor-pointer transition-all flex items-center justify-center space-x-1.5 ${
                    isOptimized
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-[#1E2024] text-white hover:bg-black'
                  }`}
                >
                  <Scissors className="w-3.5 h-3.5" />
                  <span>{isOptimized ? '已掐头去尾 (点此还原)' : '一键掐头去尾截断'}</span>
                </button>

                <button
                  onClick={() => onInspectRaw(step.rawOutput || '')}
                  className="px-2.5 py-1.5 rounded-lg border border-[#E5E0D8] bg-white text-xs text-[#4A453E] hover:bg-[#F7F5F0] cursor-pointer flex items-center space-x-1 shadow-2xs"
                  title="查看完整原文"
                >
                  <FileCode className="w-3.5 h-3.5 text-[#8E887E]" />
                  <span>看原文</span>
                </button>
              </div>
            </div>
          ) : step.isSafeBoundary ? (
            <div className="p-3 bg-emerald-50/90 border border-emerald-300 rounded-lg space-y-1.5">
              <div className="flex items-center space-x-2 text-emerald-900 font-semibold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>处于子任务安全软边界 (Safe Boundary)</span>
              </div>
              <p className="text-[11px] text-emerald-800 leading-relaxed">
                {step.boundaryReason || '当前工具执行闭环，适合在此刻触发上下文压缩或衰减检查，不中断链式推理。'}
              </p>
            </div>
          ) : (
            <div className="p-3 bg-white border border-[#E5E0D8] rounded-lg text-[#6E685E] leading-relaxed">
              当前步骤在思考链内部推进，输出平稳，无需截断与压缩，保持上下文语义连贯。
            </div>
          )}
        </div>

        {/* 契约安全提醒 */}
        <div className="p-3 bg-[#F0EBE1]/60 rounded-lg border border-[#E5E0D8] space-y-1 text-[#6E685E]">
          <div className="flex items-center space-x-1 text-xs font-semibold text-[#1E2024]">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
            <span>上下文工程守则</span>
          </div>
          <p className="text-[10px] leading-relaxed">
            1. 截断只裁剪中间过程行，绝对保留前置入参与末尾退出码；<br />
            2. 被截断的完整原文登记在历史清理流水账中，保留唯一索引 ID；<br />
            3. 固定前置上下文（Prompt 骨架）绝对不插动态时间戳，稳定命中大模型 90% 缓存折扣。
          </p>
        </div>
      </div>

      {/* 底部 */}
      <div className="px-5 py-3 border-t border-[#E5E0D8] bg-[#F4F0EA] flex items-center justify-between text-xs text-[#6E685E]">
        <span className="font-mono text-[10px]">Step {step.stepIndex + 1} of 5</span>
        <button
          onClick={onClose}
          className="text-xs text-[#4A453E] hover:underline cursor-pointer"
        >
          关闭抽屉
        </button>
      </div>
    </div>
  )
}
