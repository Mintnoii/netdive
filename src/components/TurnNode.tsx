import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
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
  Layers,
  ArrowRight,
} from 'lucide-react'
import type { MacroTurnGroup } from '../types/telemetry'

export interface TurnNodeData extends MacroTurnGroup {
  onDrillDown?: (turnId: string) => void
  [key: string]: unknown
}

export const TurnNode: React.FC<NodeProps> = ({ data, selected }) => {
  const turn = data as unknown as TurnNodeData

  // 状态颜色边框与背景（继承 Paper & Ink 素雅手绘纸本质感）
  const getBorderClass = () => {
    if (selected) {
      return 'border-[#1E2024] ring-2 ring-[#1E2024]/10 bg-[#FAF8F5] shadow-[3px_3px_0px_#8F887D,6px_6px_0px_#C8C2B7]'
    }
    if (turn.status === 'gate') {
      return 'border-amber-400 bg-amber-50/40 ring-2 ring-amber-400/20 shadow-xs'
    }
    if (turn.status === 'failed') {
      return 'border-rose-400 bg-rose-50/40 ring-2 ring-rose-400/20 shadow-xs'
    }
    if (turn.status === 'branching') {
      return 'border-amber-300/90 bg-[#FCFAF6] hover:border-amber-400 shadow-[2px_2px_0px_#E8DFD1]'
    }
    if (turn.status === 'running') {
      return 'border-indigo-400 bg-white ring-2 ring-indigo-400/20 shadow-xs'
    }
    return 'border-[#E5E0D8] bg-white hover:border-[#B5AFA4] shadow-xs'
  }

  // 获取手势对应的小图标
  const renderToolChipIcon = (gesture: string) => {
    switch (gesture) {
      case 'read':
        return <BookOpen className="w-2.5 h-2.5 text-sky-600 shrink-0" />
      case 'bash':
        return <Terminal className="w-2.5 h-2.5 text-emerald-600 shrink-0" />
      case 'edit':
        return <FileEdit className="w-2.5 h-2.5 text-blue-600 shrink-0" />
      case 'memory':
        return <Bookmark className="w-2.5 h-2.5 text-purple-600 shrink-0" />
      case 'gate':
        return <ShieldAlert className="w-2.5 h-2.5 text-amber-600 shrink-0" />
      case 'think':
      default:
        return <Sparkles className="w-2.5 h-2.5 text-amber-600 shrink-0" />
    }
  }

  // 获取手势 Badge 样式
  const getToolChipClass = (gesture: string) => {
    switch (gesture) {
      case 'read':
        return 'bg-sky-50 text-sky-900 border-sky-200'
      case 'bash':
        return 'bg-emerald-50 text-emerald-900 border-emerald-200'
      case 'edit':
        return 'bg-blue-50 text-blue-900 border-blue-200'
      case 'memory':
        return 'bg-purple-50 text-purple-900 border-purple-200'
      case 'gate':
        return 'bg-amber-50 text-amber-900 border-amber-200'
      default:
        return 'bg-stone-50 text-stone-900 border-stone-200'
    }
  }

  const toolEntries = Object.entries(turn.toolCounts || {})
  const subEventsCount = turn.subEvents?.length || 0

  const handleDrillDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (typeof turn.onDrillDown === 'function') {
      turn.onDrillDown(turn.turnId)
    }
  }

  return (
    <div
      onDoubleClick={handleDrillDown}
      className={`w-[330px] rounded-xl border p-3.5 transition-all duration-150 relative cursor-pointer group ${getBorderClass()}`}
    >
      {/* React Flow 左侧输入连接桩 */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-[#8F887D] !border-2 !border-white"
      />

      {/* 顶部：Turn # 序号徽章、主体与状态指示 */}
      <div className="flex items-center justify-between pb-2 border-b border-[#F0EBE1]">
        <div className="flex items-center space-x-1.5 min-w-0">
          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-[#1E2024] text-white tracking-wider shrink-0">
            Turn #{turn.turnIndex}
          </span>
          <span className="text-[11px] font-mono text-[#8F887D] truncate max-w-[120px]" title={turn.actor}>
            {turn.actor?.replace(/\s*\([^)]*\)/g, '') || 'Pi'}
          </span>
        </div>

        <div className="flex items-center space-x-1.5 shrink-0">
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
              <span>完成</span>
            </span>
          )}

          <span className="text-[10px] font-mono text-[#8F887D] flex items-center space-x-0.5 shrink-0">
            <Clock className="w-3 h-3 text-[#B5AFA4]" />
            <span>{turn.totalDuration || '1.0s'}</span>
          </span>
        </div>
      </div>

      {/* 意图与主题首句 */}
      <div className="mt-2.5">
        <div className="text-xs font-semibold text-[#1E2024] truncate" title={turn.title}>
          {turn.title}
        </div>
        <div
          className="mt-1 text-[11px] text-[#5E6573] line-clamp-2 leading-relaxed font-mono bg-[#FAF8F5] p-2 rounded-lg border border-[#F0EBE1]"
          title={turn.intent}
        >
          {turn.intent}
        </div>
      </div>

      {/* 底部摘要区：工具调用 Badge 芯片统计 */}
      <div className="mt-3 pt-2.5 border-t border-[#F0EBE1] flex items-center justify-between">
        <div className="flex items-center space-x-1.5 flex-wrap gap-y-1 max-w-[200px]">
          {toolEntries.length > 0 ? (
            toolEntries.map(([gesture, count]) => (
              <span
                key={gesture}
                className={`inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-md text-[10px] font-mono border ${getToolChipClass(
                  gesture
                )}`}
              >
                {renderToolChipIcon(gesture)}
                <span>
                  {gesture} x{count}
                </span>
              </span>
            ))
          ) : (
            <span className="text-[10px] font-mono text-[#A8A29E] flex items-center space-x-1">
              <Sparkles className="w-2.5 h-2.5 text-amber-600" />
              <span>纯推理思考</span>
            </span>
          )}
        </div>

        {/* 醒目的层级下钻操作按钮 (Drill Down) */}
        <button
          type="button"
          onClick={handleDrillDown}
          className="nodrag nopan px-2.5 py-1 text-[11px] font-sans font-medium rounded-lg border border-[#D5CDBD] bg-[#F4F0EA] text-[#1E2024] hover:bg-[#1E2024] hover:text-white hover:border-[#1E2024] transition-all cursor-pointer flex items-center space-x-1 shadow-2xs group-hover:border-[#8F887D]"
          title="进入本回合独立的微观拓扑因果图 (双击卡片亦可直达)"
        >
          <Layers className="w-3 h-3 text-[#5E6573] group-hover:text-white" />
          <span>查看步骤 ({subEventsCount})</span>
          <ArrowRight className="w-3 h-3 ml-0.5 text-[#5E6573] group-hover:text-white group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>

      {/* React Flow 右侧输出连接桩 */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-[#8F887D] !border-2 !border-white"
      />
    </div>
  )
}
