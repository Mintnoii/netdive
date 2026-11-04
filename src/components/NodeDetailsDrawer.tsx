import React, { useState } from 'react'
import {
  X,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  Layers,
  Sparkles,
} from 'lucide-react'
import type { Node } from '@xyflow/react'
import type { AgentNodeData } from './AgentNode'
import type { TelemetryEvent } from '../types/telemetry'
import { normalizeObservationOutput, formatNodeSummary } from '../types/telemetry'

export interface NodeDetailsDrawerProps {
  isOpen: boolean
  onClose: () => void
  node: Node | null
  event?: TelemetryEvent | null
}

/**
 * 节点执行详情抽屉 (Paper & Ink 素雅手绘纸本风格)
 * 供用户全面审查思考推演、工具入参、Monaco Diff 与执行观测结果
 */
export const NodeDetailsDrawer: React.FC<NodeDetailsDrawerProps> = ({
  isOpen,
  onClose,
  node,
  event,
}) => {
  const [copiedPayload, setCopiedPayload] = useState(false)

  if (!isOpen || !node) return null

  const nodeData = (node.data || {}) as unknown as AgentNodeData

  // 契约解耦与 JIT 按需读取：优先从原始 TelemetryEvent 提取完整数据，降级自 nodeData 读取
  const title = event?.title || nodeData.title || '节点执行详情'
  const actor = event?.actor || nodeData.actor || '未知主体'
  const gesture = event?.gesture || nodeData.gesture || 'think'
  const status = event?.status || nodeData.status || 'completed'
  const isCorrectionBranch = event?.isCorrectionBranch ?? nodeData.isCorrectionBranch
  const isAggregated = event?.isAggregated ?? nodeData.isAggregated
  const aggregateCount = event?.aggregateCount ?? nodeData.aggregateCount
  const summary = event?.delta || nodeData.summary
  const payload = event?.payload ?? nodeData.payload
  const observation = event?.observation ?? nodeData.observation

  const copyPayload = async () => {
    if (!payload) return
    const text = JSON.stringify(payload, null, 2)
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text)
        setCopiedPayload(true)
        setTimeout(() => setCopiedPayload(false), 2000)
      }
    } catch {
      // ignore
    }
  }

  const isFailed =
    status === 'failed' ||
    status === 'rejected' ||
    (observation && typeof observation.exitCode === 'number' && observation.exitCode !== 0)

  return (
    <aside className="w-96 shrink-0 h-full border-l border-[#E5E0D8] bg-[#FAF8F5] flex flex-col shadow-xl z-20 overflow-hidden animate-in slide-in-from-right duration-200">
      {/* 头部标题栏 */}
      <div className="h-10 border-b border-[#E5E0D8] px-4 flex items-center justify-between bg-white shrink-0">
        <div className="flex items-center space-x-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-[#1E2024] shrink-0" />
          <span className="font-semibold text-xs text-[#1E2024] truncate">节点执行详情</span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#F4F0EA] text-[#6E685E] border border-[#E5E0D8] shrink-0">
            ID: {node.id.slice(0, 14)}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-[#8F887D] hover:text-[#1E2024] hover:bg-[#F4F0EA] cursor-pointer transition-colors"
          title="关闭详情抽屉 (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 详情滚动内容 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {/* 基本状态卡片 */}
        <div className="bg-white p-3 rounded-lg border border-[#E5E0D8] space-y-2 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-[#8F887D] uppercase font-semibold">
              {actor}
            </span>
            <div className="flex items-center space-x-1.5">
              {status === 'completed' && (
                <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-300">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  <span>已完成</span>
                </span>
              )}
              {isFailed && (
                <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-50 text-rose-800 border border-rose-300">
                  <AlertTriangle className="w-3 h-3 text-rose-600" />
                  <span>执行异常</span>
                </span>
              )}
              {status === 'gate' && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-900 border border-amber-300 animate-pulse">
                  🛑 门禁待审
                </span>
              )}
              {isCorrectionBranch && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-900 border border-amber-300">
                  <Sparkles className="w-2.5 h-2.5 inline mr-0.5 text-amber-700" />
                  自愈分叉
                </span>
              )}
            </div>
          </div>

          <div className="font-semibold text-sm text-[#1E2024]">{title}</div>

          {isAggregated && (
            <div className="p-2 rounded bg-[#FAF8F5] border border-[#E5E0D8] text-[11px] text-[#5C5549] flex items-center space-x-1.5">
              <Layers className="w-3.5 h-3.5 text-amber-600" />
              <span>连续调用聚合：包含 {aggregateCount || 2} 次连续同构操作</span>
            </div>
          )}
        </div>

        {/* 思考或输入概要 */}
        {summary && (
          <div className="space-y-1.5">
            <div className="text-[11px] font-mono font-medium text-[#6E685E]">
              {gesture === 'think' ? '思考与规划 (Thought)' : '执行摘要 (Summary)'}
            </div>
            <div className="p-3 bg-white border border-[#E5E0D8] rounded-lg text-[#1E2024] font-mono text-[11px] leading-relaxed whitespace-pre-wrap shadow-2xs">
              {formatNodeSummary(summary)}
            </div>
          </div>
        )}

        {/* 工具调用入参 Payload */}
        {payload && Object.keys(payload).length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono font-medium text-[#6E685E]">
              <span>工具调用参数 (Payload)</span>
              <button
                onClick={copyPayload}
                className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] text-[#8F887D] hover:text-[#1E2024] hover:bg-[#EAE5DC] transition-colors cursor-pointer"
                title="复制完整 JSON 参数"
              >
                {copiedPayload ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600" />
                    <span className="text-emerald-700">已复制</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>复制参数</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-3 bg-[#F4F0EA] border border-[#E5E0D8] rounded-lg text-[#1E2024] font-mono text-[11px] overflow-x-auto leading-normal select-all">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </div>
        )}

        {/* 执行观测与输出 (Observation) */}
        {observation && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono font-medium text-[#6E685E]">
              <span>执行观测结果 (Observation)</span>
              {typeof observation.exitCode === 'number' && (
                <span
                  className={`px-1.5 py-0.2 rounded font-mono text-[10px] ${
                    observation.exitCode === 0
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-rose-100 text-rose-800'
                  }`}
                >
                  exit: {observation.exitCode}
                </span>
              )}
            </div>
            <div className="p-3 rounded-lg bg-[#1E2024] text-[#FBF9F5] font-mono text-[11px] max-h-56 overflow-y-auto space-y-1 shadow-inner select-all leading-relaxed">
              {normalizeObservationOutput(observation.output).length === 0 ? (
                <div className="text-gray-400 italic">无输出内容</div>
              ) : (
                normalizeObservationOutput(observation.output).map((line, idx) => {
                  const isErr =
                    line.includes('Error') ||
                    line.includes('failed') ||
                    line.startsWith('✖')
                  const isSuccess =
                    line.includes('passed') ||
                    line.includes('success') ||
                    line.startsWith('✓')
                  return (
                    <div
                      key={idx}
                      className={
                        isErr
                          ? 'text-rose-400 font-medium'
                          : isSuccess
                            ? 'text-emerald-400'
                            : 'text-gray-200'
                      }
                    >
                      {line}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
