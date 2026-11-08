import React, { useState } from 'react'
import {
  X,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  ShieldAlert,
  Loader2,
  Clock,
  BookOpen,
  Terminal,
  FileEdit,
  Bookmark,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Layers,
} from 'lucide-react'
import type { MacroTurnGroup, TelemetryEvent, TelemetryGesture } from '../types/telemetry'
import { normalizeObservationOutput, formatNodeSummary } from '../types/telemetry'

export interface TurnDetailsDrawerProps {
  isOpen: boolean
  onClose: () => void
  turn: MacroTurnGroup | null
  onDrillDown?: (turnId: string) => void
}

/**
 * 宏观回合微观钻取详情抽屉 (Hierarchical Turn Details Drawer)
 * 采用 Paper & Ink 素雅手绘纸本风格，提供时序流水瀑布 (Execution Waterfall)
 * 帮助用户在宏观与微观之间自由穿梭，兼顾全局心智大盘与原子调用审查
 */
export const TurnDetailsDrawer: React.FC<TurnDetailsDrawerProps> = ({
  isOpen,
  onClose,
  turn,
  onDrillDown,
}) => {
  // 记录每个展开的子步骤详情 index
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({})
  const [copiedStepIndex, setCopiedStepIndex] = useState<number | null>(null)

  if (!isOpen || !turn) return null

  const toggleStep = (idx: number) => {
    setExpandedSteps((prev) => ({ ...prev, [idx]: !prev[idx] }))
  }

  const copyStepPayload = async (idx: number, ev: TelemetryEvent) => {
    const text = ev.payload
      ? JSON.stringify(ev.payload, null, 2)
      : ev.observation?.output
        ? normalizeObservationOutput(ev.observation.output).join('\n')
        : ev.delta || ''
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text)
        setCopiedStepIndex(idx)
        setTimeout(() => setCopiedStepIndex(null), 2000)
      }
    } catch {
      // ignore
    }
  }

  // 节点手势图标映射
  const getGestureIcon = (gesture?: TelemetryGesture) => {
    switch (gesture) {
      case 'read':
        return <BookOpen className="w-3.5 h-3.5 text-sky-600 shrink-0" />
      case 'bash':
        return <Terminal className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
      case 'edit':
        return <FileEdit className="w-3.5 h-3.5 text-blue-600 shrink-0" />
      case 'memory':
        return <Bookmark className="w-3.5 h-3.5 text-purple-600 shrink-0" />
      case 'gate':
        return <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" />
      case 'think':
      default:
        return <MessageSquare className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
    }
  }

  const toolEntries = Object.entries(turn.toolCounts || {})
  const subEvents = turn.subEvents || []

  return (
    <aside className="w-[420px] shrink-0 h-full border-l border-[#E5E0D8] bg-[#FAF8F5] flex flex-col shadow-xl z-20 overflow-hidden animate-in slide-in-from-right duration-200">
      {/* 头部标题栏 */}
      <div className="h-11 border-b border-[#E5E0D8] px-4 flex items-center justify-between bg-white shrink-0">
        <div className="flex items-center space-x-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-[#1E2024] shrink-0" />
          <span className="font-semibold text-xs text-[#1E2024] truncate">
            回合微观钻取流水
          </span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#1E2024] text-white shrink-0 font-bold">
            Turn #{turn.turnIndex}
          </span>
        </div>
        <div className="flex items-center space-x-1.5 shrink-0">
          {onDrillDown && (
            <button
              type="button"
              onClick={() => {
                onDrillDown(turn.turnId)
                onClose()
              }}
              className="px-2 py-0.5 text-[11px] font-sans font-medium rounded-md border border-[#D5CDBD] bg-[#F4F0EA] text-[#1E2024] hover:bg-[#1E2024] hover:text-white transition-all cursor-pointer flex items-center space-x-1"
              title="在主画布打开微观因果拓扑图"
            >
              <Layers className="w-3 h-3" />
              <span>主画布拓扑</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[#8F887D] hover:text-[#1E2024] hover:bg-[#F4F0EA] cursor-pointer transition-colors"
            title="关闭微观抽屉 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 滚动内容区 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {/* 回合大盘概览卡片 */}
        <div className="bg-white p-3.5 rounded-xl border border-[#E5E0D8] shadow-2xs space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-[#8F887D] font-semibold">
              {turn.actor || 'Pi (Coordinator)'}
            </span>
            <div className="flex items-center space-x-1.5">
              {turn.status === 'gate' && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-amber-100 text-amber-900 border border-amber-300 flex items-center space-x-1 animate-pulse">
                  <ShieldAlert className="w-3 h-3 text-amber-700" />
                  <span>门禁待审</span>
                </span>
              )}
              {turn.status === 'failed' && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-rose-50 text-rose-800 border border-rose-300 flex items-center space-x-1">
                  <AlertTriangle className="w-3 h-3 text-rose-600" />
                  <span>单测异常</span>
                </span>
              )}
              {turn.status === 'branching' && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-amber-50 text-amber-900 border border-amber-300 flex items-center space-x-1">
                  <Sparkles className="w-3 h-3 text-amber-700" />
                  <span>自愈闭环</span>
                </span>
              )}
              {turn.status === 'running' && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-indigo-50 text-indigo-800 border border-indigo-300 flex items-center space-x-1">
                  <Loader2 className="w-3 h-3 animate-spin text-indigo-600" />
                  <span>执行中</span>
                </span>
              )}
              {turn.status === 'success' && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300 flex items-center space-x-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  <span>执行完成</span>
                </span>
              )}
              <span className="text-[10px] font-mono text-[#8F887D] flex items-center space-x-0.5">
                <Clock className="w-3 h-3 text-[#B5AFA4]" />
                <span>{turn.totalDuration || '1.0s'}</span>
              </span>
            </div>
          </div>

          <div className="font-semibold text-sm text-[#1E2024] leading-snug break-all whitespace-pre-wrap">
            {turn.intent || turn.title}
          </div>

          {turn.intent && turn.title && !turn.title.includes('用户') && !turn.title.includes('User') && (
            <div className="text-[11px] text-[#8F887D] font-mono break-all whitespace-pre-wrap">
              {turn.title}
            </div>
          )}

          <div className="p-2.5 rounded-lg bg-[#FAF8F5] border border-[#E5E0D8] text-[11px] text-[#5C5549] leading-relaxed font-mono break-all whitespace-pre-wrap">
            {turn.intent}
          </div>

          {/* 工具统计分布与 Token 水位概览 */}
          <div className="pt-2 border-t border-[#F0EBE1] flex items-center justify-between text-[11px] font-mono text-[#6E685E] flex-wrap gap-2">
            <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
              {toolEntries.length > 0 ? (
                toolEntries.map(([gesture, count]) => (
                  <span
                    key={gesture}
                    className="px-1.5 py-0.5 rounded bg-[#F4F0EA] border border-[#E5E0D8] text-[10px] font-medium"
                  >
                    {gesture} x{count}
                  </span>
                ))
              ) : (
                <span className="text-[10px] text-[#A8A29E] italic">无外部工具调用</span>
              )}
            </div>

            {turn.tokenBreakdown && (
              <span className="text-[10px] text-[#8F887D]">
                Tokens: ~{Math.round((turn.tokenBreakdown.total || 0) / 100) / 10}k
                {turn.tokenBreakdown.prunable ? ` (可剪枝 ~${Math.round(turn.tokenBreakdown.prunable / 100) / 10}k)` : ''}
              </span>
            )}
          </div>
        </div>

        {/* 内部时序流水瀑布 (Execution Waterfall) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] font-mono font-semibold text-[#6E685E] px-1">
            <div className="flex items-center space-x-1.5">
              <Layers className="w-3.5 h-3.5 text-[#1E2024]" />
              <span>内部时序流水瀑布 (Execution Waterfall)</span>
            </div>
            <span className="px-1.5 py-0.2 rounded bg-[#EAE4D9] text-[#3D3831] border border-[#D5CDBD] text-[10px]">
              {subEvents.length} 步调用
            </span>
          </div>

          {/* 瀑布步骤列表 */}
          <div className="space-y-2 relative before:absolute before:top-3 before:bottom-3 before:left-4 before:w-[1px] before:bg-[#E5E0D8]">
            {subEvents.map((ev, idx) => {
              const isExpanded = Boolean(expandedSteps[idx])
              const isFailedStep =
                ev.status === 'failed' ||
                ev.status === 'rejected' ||
                (typeof ev.observation?.exitCode === 'number' && ev.observation.exitCode !== 0)
              const hasCorrection = Boolean(ev.isCorrectionBranch)
              const outputLines = normalizeObservationOutput(ev.observation?.output)

              return (
                <div
                  key={ev.nodeId || idx}
                  className={`relative ml-8 rounded-lg border bg-white transition-all duration-150 ${
                    isExpanded ? 'border-[#1E2024]/40 shadow-xs ring-1 ring-[#1E2024]/5' : 'border-[#E5E0D8] hover:border-[#B5AFA4]'
                  }`}
                >
                  {/* 步骤轴点图标 */}
                  <div
                    className={`absolute -left-[26px] top-3 w-5 h-5 rounded-full border flex items-center justify-center bg-white shadow-2xs z-10 ${
                      isFailedStep
                        ? 'border-rose-400 bg-rose-50 text-rose-600'
                        : hasCorrection
                          ? 'border-amber-400 bg-amber-50 text-amber-600'
                          : 'border-[#D5CDBD] text-[#5C5549]'
                    }`}
                  >
                    {getGestureIcon(ev.gesture)}
                  </div>

                  {/* 步骤条目头部 */}
                  <div
                    onClick={() => toggleStep(idx)}
                    className="p-2.5 flex items-center justify-between cursor-pointer select-none space-x-2"
                  >
                    <div className="flex items-center space-x-2 min-w-0 flex-1">
                      <span className="font-mono text-[10px] font-bold text-[#8F887D] shrink-0">
                        #{idx + 1}
                      </span>
                      <span className="font-semibold text-xs text-[#1E2024] truncate" title={ev.title}>
                        {ev.title || '步骤执行'}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1.5 shrink-0">
                      {isFailedStep && (
                        <span className="px-1.5 py-0.2 rounded font-mono text-[9px] bg-rose-100 text-rose-800 font-semibold">
                          exit: {ev.observation?.exitCode ?? 1}
                        </span>
                      )}
                      {ev.observation && ev.observation.exitCode === 0 && (
                        <span className="px-1.5 py-0.2 rounded font-mono text-[9px] bg-emerald-100 text-emerald-800 font-semibold">
                          exit: 0
                        </span>
                      )}
                      {hasCorrection && (
                        <span className="px-1.5 py-0.2 rounded font-mono text-[9px] bg-amber-100 text-amber-900 font-semibold">
                          自愈
                        </span>
                      )}
                      {ev.status === 'gate' && (
                        <span className="px-1.5 py-0.2 rounded font-mono text-[9px] bg-amber-100 text-amber-900 font-semibold">
                          门禁
                        </span>
                      )}
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-[#8F887D]" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-[#8F887D]" />
                      )}
                    </div>
                  </div>

                  {/* 未展开时的紧凑单行摘要 */}
                  {!isExpanded && (
                    <div className="px-2.5 pb-2 text-[10px] text-[#78716C] font-mono truncate">
                      {ev.delta
                        ? ev.delta.slice(0, 80)
                        : ev.payload?.command
                          ? `$ ${ev.payload.command}`
                          : ev.payload?.path
                            ? `文件: ${ev.payload.path}`
                            : outputLines[0] || '已完成调用'}
                    </div>
                  )}

                  {/* 展开时的深潜详情区 */}
                  {isExpanded && (
                    <div className="p-3 pt-0 border-t border-[#F0EBE1] space-y-2.5 bg-[#FCFAF6]/60 rounded-b-lg">
                      {/* 执行主体与动作摘要 */}
                      <div className="pt-2 flex items-center justify-between text-[10px] font-mono text-[#8F887D]">
                        <span>主体: {ev.actor || 'Claude 3.7 (Worker)'}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            copyStepPayload(idx, ev)
                          }}
                          className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[#5C5549] hover:bg-[#EAE4D9] cursor-pointer transition-colors"
                          title="复制当前步骤原始数据"
                        >
                          {copiedStepIndex === idx ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-600" />
                              <span className="text-emerald-700">已复制</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>复制入参/输出</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* 思考推演或自然语言 Delta */}
                      {ev.delta && (
                        <div className="p-2 rounded bg-white border border-[#E5E0D8] text-[11px] font-mono text-[#1E2024] whitespace-pre-wrap break-all leading-relaxed shadow-2xs">
                          {formatNodeSummary(ev.delta)}
                        </div>
                      )}

                      {/* 工具入参 Payload */}
                      {ev.payload && Object.keys(ev.payload).length > 0 && (
                        <div className="space-y-1">
                          <span className="text-[10px] font-mono font-medium text-[#6E685E]">
                            工具入参 (Payload):
                          </span>
                          <pre className="p-2 rounded bg-[#F4F0EA] border border-[#E5E0D8] text-[10px] font-mono text-[#1E2024] overflow-x-auto whitespace-pre-wrap break-all leading-normal select-all">
                            {JSON.stringify(ev.payload, null, 2)}
                          </pre>
                        </div>
                      )}

                      {/* 观测输出 Observation Output */}
                      {outputLines.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-[10px] font-mono font-medium text-[#6E685E]">
                            终端输出 (Observation):
                          </span>
                          <div className="p-2.5 rounded-lg bg-[#1E2024] text-[#FBF9F5] font-mono text-[10px] max-h-48 overflow-y-auto space-y-0.5 shadow-inner select-all leading-relaxed">
                            {outputLines.map((line, lIdx) => {
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
                                  key={lIdx}
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
                            })}
                          </div>
                        </div>
                      )}

                      {/* L1 确定性断言结果 */}
                      {ev.assertion && (
                        <div
                          className={`p-2 rounded border text-[10px] font-mono flex items-center justify-between ${
                            ev.assertion.passed
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : 'bg-rose-50 text-rose-800 border-rose-200'
                          }`}
                        >
                          <span className="font-semibold">
                            L1 断言: {ev.assertion.passed ? '✓ 通过' : '✕ 异常命中'}
                          </span>
                          <span>{ev.assertion.rule || 'exitCodeCheck'}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </aside>
  )
}
