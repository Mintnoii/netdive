import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  MessageSquare,
  BookOpen,
  FileEdit,
  Terminal,
  Bookmark,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  Loader2,
  Sparkles,
} from 'lucide-react'
import type {
  TelemetryActor,
  TelemetryGesture,
  TelemetryObservation,
  TelemetryStatus,
} from '../types/telemetry'

export interface AgentNodeData {
  title: string
  actor: TelemetryActor
  gesture: TelemetryGesture
  status: TelemetryStatus
  duration?: string
  summary?: string
  isCorrectionBranch?: boolean
  observation?: TelemetryObservation
}

export const AgentNode: React.FC<NodeProps> = ({ data, selected }) => {
  const nodeData = data as unknown as AgentNodeData

  // 节点手势图标映射
  const getIcon = () => {
    switch (nodeData.gesture) {
      case 'think':
        return <MessageSquare className="w-3.5 h-3.5 text-indigo-600" />
      case 'read':
        return <BookOpen className="w-3.5 h-3.5 text-sky-600" />
      case 'edit':
        return <FileEdit className="w-3.5 h-3.5 text-blue-600" />
      case 'bash':
        return <Terminal className="w-3.5 h-3.5 text-emerald-600" />
      case 'memory':
        return <Bookmark className="w-3.5 h-3.5 text-purple-600" />
      case 'gate':
        return <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
      default:
        return <MessageSquare className="w-3.5 h-3.5 text-gray-600" />
    }
  }

  // 状态颜色边框与背景（保持 Paper & Ink 素雅手绘纸本质感，杜绝刺眼多余光晕）
  const getBorderClass = () => {
    if (selected) return 'border-[#1E2024] ring-2 ring-[#1E2024]/10 shadow-md'
    if (nodeData.status === 'failed') return 'border-red-400 bg-red-50/40 shadow-xs'
    if (nodeData.status === 'gate') return 'border-amber-400 bg-amber-50/40 ring-2 ring-amber-400/20'
    if (nodeData.isCorrectionBranch) {
      if (nodeData.status === 'running') {
        return 'border-amber-400 bg-amber-50/30 ring-2 ring-amber-400/20 shadow-xs'
      }
      return 'border-amber-300/80 bg-[#FCFAF6] hover:border-amber-400/90 shadow-xs'
    }
    if (nodeData.status === 'running') return 'border-indigo-400 bg-white ring-2 ring-indigo-400/20 shadow-xs'
    return 'border-[#E5E0D8] hover:border-[#B5AFA4]'
  }

  return (
    <div
      className={`w-[230px] rounded-lg bg-white border p-3 shadow-xs transition-all duration-150 ${getBorderClass()}`}
    >
      {/* React Flow 左侧输入连接桩（用于从左到右连线） */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2 !h-2 !bg-[#8F887D] !border-2 !border-white"
      />

      {/* 头部：手势图标、标题与自愈分支徽章 */}
      <div className="flex items-center space-x-2 mb-1.5">
        <div className="p-1 rounded bg-[#F4F0EA] border border-[#E5E0D8] shrink-0">
          {getIcon()}
        </div>
        <div className="text-xs font-semibold text-[#1E2024] truncate flex-1" title={nodeData.title}>
          {nodeData.title}
        </div>
        {nodeData.isCorrectionBranch && (
          <span
            className="shrink-0 text-[9px] font-mono font-medium px-1.5 py-0.5 rounded bg-amber-100/80 text-amber-900 border border-amber-300/70 flex items-center space-x-0.5"
            title="ReAct 自愈分叉分支"
          >
            <Sparkles className="w-2.5 h-2.5 text-amber-700 inline" />
            <span>自愈</span>
          </span>
        )}
      </div>

      {/* Observation 观测结果警示：若存在失败显示 exit: 1 提示 */}
      {nodeData.observation && nodeData.observation.exitCode !== 0 && (
        <div className="mb-2 px-2 py-1 rounded bg-red-50/90 border border-red-200 text-red-800 flex items-center justify-between text-[10px] font-mono">
          <div className="flex items-center space-x-1 font-semibold text-red-700">
            <AlertCircle className="w-3 h-3 text-red-600 shrink-0" />
            <span>exit: {nodeData.observation.exitCode}</span>
          </div>
          <span
            className="text-[9px] text-red-600/90 truncate max-w-[110px]"
            title={nodeData.observation.output?.[0]}
          >
            {nodeData.observation.output?.[0] || '断言异常'}
          </span>
        </div>
      )}

      {/* Observation 观测结果通过提示 */}
      {nodeData.observation && nodeData.observation.exitCode === 0 && (
        <div className="mb-2 px-2 py-1 rounded bg-emerald-50/80 border border-emerald-200/80 text-emerald-800 flex items-center justify-between text-[10px] font-mono">
          <div className="flex items-center space-x-1 font-semibold text-emerald-700">
            <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
            <span>exit: 0</span>
          </div>
          <span className="text-[9px] text-emerald-600 truncate max-w-[110px]">
            回归验证通过
          </span>
        </div>
      )}

      {/* 描述与流式打字摘要 */}
      <div className="text-[11px] text-[#5E6573] line-clamp-3 leading-relaxed mb-2 font-mono min-h-[2.5rem] break-words">
        {nodeData.summary || ''}
        {nodeData.status === 'running' && (
          <span className="inline-block w-1.5 h-3 ml-0.5 bg-indigo-500 animate-pulse align-middle" />
        )}
      </div>

      {/* 底部元数据：执行主体与状态 */}
      <div className="flex items-center justify-between pt-1.5 border-t border-[#F0EBE1] text-[10px] text-[#8F887D] font-mono">
        <span className="truncate max-w-[110px]" title={nodeData.actor}>
          {nodeData.actor}
        </span>
        <div className="flex items-center space-x-1 shrink-0">
          {nodeData.status === 'running' && (
            <span className="text-indigo-600 flex items-center font-medium">
              <Loader2 className="w-3 h-3 mr-0.5 inline animate-spin" /> 流式生成
            </span>
          )}
          {nodeData.status === 'completed' && (
            <span className="text-emerald-700 flex items-center">
              <CheckCircle2 className="w-3 h-3 mr-0.5 inline" /> 完成
            </span>
          )}
          {nodeData.status === 'failed' && (
            <span className="text-red-600 flex items-center font-bold">
              <AlertCircle className="w-3 h-3 mr-0.5 inline" /> 单测挂起
            </span>
          )}
          {nodeData.status === 'gate' && (
            <span className="text-amber-700 flex items-center font-bold">
              <ShieldAlert className="w-3 h-3 mr-0.5 inline" /> 门禁待审
            </span>
          )}
        </div>
      </div>

      {/* React Flow 右侧输出连接桩 */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2 !h-2 !bg-[#8F887D] !border-2 !border-white"
      />
    </div>
  )
}
