import React, { useState, useRef, useEffect } from 'react'
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
  Scissors,
} from 'lucide-react'
import type {
  TelemetryActor,
  TelemetryGesture,
  TelemetryObservation,
  TelemetryStatus,
} from '../types/telemetry'
import { formatTokens } from '../types/telemetry'

export interface AgentNodeData {
  title: string
  actor: TelemetryActor
  gesture: TelemetryGesture
  status: TelemetryStatus
  duration?: string
  summary?: string
  isCorrectionBranch?: boolean
  observation?: TelemetryObservation
  humanSteering?: string
  pruned?: boolean
  payload?: Record<string, unknown>
  prunableTokens?: number
}

export const AgentNode: React.FC<NodeProps> = ({ data, selected }) => {
  const nodeData = data as unknown as AgentNodeData

  // 判断是否为具备可修剪冗余上下文的已完成工具节点
  const isPrunable =
    !nodeData.pruned &&
    nodeData.status === 'completed' &&
    (nodeData.gesture === 'bash' ||
      nodeData.gesture === 'edit' ||
      nodeData.gesture === 'read' ||
      Boolean(nodeData.payload?.diff) ||
      Boolean(nodeData.payload?.content))

  const [showTooltip, setShowTooltip] = useState(false)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMouseEnter = () => {
    if (!isPrunable) return
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
    }
    hoverTimerRef.current = setTimeout(() => {
      setShowTooltip(true)
    }, 400)
  }

  const handleMouseLeave = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setShowTooltip(false)
  }

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current)
      }
    }
  }, [])

  const getPrunableTokens = () => {
    if (typeof nodeData.prunableTokens === 'number') {
      return nodeData.prunableTokens
    }
    if (nodeData.gesture === 'bash') {
      const hasHeavy = Boolean(
        (nodeData.observation?.output && nodeData.observation.output.length > 0) ||
          (nodeData.summary && /test|passed|failed|回归|单测|156/i.test(nodeData.summary)) ||
          (nodeData.title && /test|测试/i.test(nodeData.title))
      )
      return hasHeavy ? 28000 : 16000
    }
    if (nodeData.gesture === 'edit' || nodeData.payload?.diff) {
      return 14000
    }
    if (nodeData.gesture === 'read' || nodeData.payload?.content) {
      return 4000
    }
    return 8000
  }

  const getSnippetPreview = () => {
    if (nodeData.gesture === 'bash') {
      if (nodeData.observation?.output && nodeData.observation.output.length > 0) {
        return nodeData.observation.output.slice(0, 2).map((l) => `✓ ${l}`).join('\n')
      }
      return '$ pnpm test:pipeline\n✓ 156 tests passed'
    }
    if (nodeData.gesture === 'edit') {
      if (typeof nodeData.payload?.diff === 'string') {
        const lines = nodeData.payload.diff
          .split('\n')
          .filter((l) => l.startsWith('+') || l.startsWith('-'))
          .slice(0, 2)
        if (lines.length > 0) return lines.join('\n')
      }
      return '- try { const res = await run() }\n+ const [err, res] = await tryit(run)()'
    }
    if (nodeData.gesture === 'read') {
      if (typeof nodeData.payload?.content === 'string') {
        const lines = nodeData.payload.content
          .split('\n')
          .filter((l) => l.trim().length > 0)
          .slice(0, 2)
        if (lines.length > 0) return lines.join('\n')
      }
      return '"name": "@netdive/core",\n"dependencies": { "pathe": "^0.2.0" }'
    }
    return nodeData.summary || '原始上下文日志与执行输出'
  }

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
    if (nodeData.status === 'rejected') return 'border-red-400 bg-red-50/50 ring-2 ring-red-400/20 shadow-xs'
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

  // 当节点已被上下文剪枝折叠时，展示极简信纸折叠卡片 (Compact Folded Card)
  if (nodeData.pruned) {
    return (
      <div
        className={`w-[230px] rounded-lg bg-[#FAF8F5] border border-dashed border-[#C5BFB5] p-2.5 shadow-2xs transition-all duration-150 hover:border-[#8F887D] ${
          selected ? 'ring-2 ring-[#1E2024]/10 border-[#1E2024]' : ''
        }`}
      >
        {/* React Flow 左侧输入连接桩（用于从左到右连线） */}
        <Handle
          type="target"
          position={Position.Left}
          className="!w-2 !h-2 !bg-[#8F887D] !border-2 !border-[#FAF8F5]"
        />

        <div className="flex items-center space-x-1.5 mb-1">
          <div className="p-0.5 rounded bg-[#EDE8E0] text-[#78716C] shrink-0">
            <Scissors className="w-3 h-3 text-[#78716C]" />
          </div>
          <div className="text-[11px] font-semibold text-[#57534E] truncate flex-1" title={nodeData.title}>
            {nodeData.title}
          </div>
          <span className="shrink-0 text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#E7E5E4] text-[#57534E] border border-[#D6D3D1]">
            已修剪
          </span>
        </div>

        <div className="text-[10px] text-[#78716C] font-mono italic truncate mb-1.5" title={nodeData.summary}>
          {nodeData.summary ? `[折叠摘要] ${nodeData.summary}` : '[冗余工具调用上下文已折叠]'}
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-[#E7E5E4] text-[9px] text-[#A8A29E] font-mono">
          <span className="truncate max-w-[120px]" title={nodeData.actor}>
            {nodeData.actor}
          </span>
          <span className="text-amber-800 font-medium">冗余折叠态</span>
        </div>

        {/* React Flow 右侧输出连接桩 */}
        <Handle
          type="source"
          position={Position.Right}
          className="!w-2 !h-2 !bg-[#8F887D] !border-2 !border-[#FAF8F5]"
        />
      </div>
    )
  }

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`w-[230px] rounded-lg bg-white border p-3 shadow-xs transition-all duration-150 relative ${getBorderClass()}`}
    >
      {/* 悬停就地修剪提示气泡 (In-situ Hover Tooltip) */}
      {isPrunable && showTooltip && !nodeData.pruned && (
        <div
          role="tooltip"
          className="absolute left-1/2 -translate-x-1/2 bottom-[calc(100%+8px)] z-30 w-64 pointer-events-none rounded-lg bg-[#1E2024] text-[#FBF9F5] p-2.5 shadow-xl border border-[#2D3139] font-sans animate-in fade-in zoom-in-95 duration-150"
        >
          {/* 气泡下方向下的小三角尖角箭头 */}
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-[#1E2024] border-r border-b border-[#2D3139]" />

          {/* 标题 */}
          <div className="flex items-center space-x-1.5 text-xs font-semibold text-amber-300 font-mono mb-1.5">
            <span>✂ 可修剪冗余上下文 (~{formatTokens(getPrunableTokens())} tokens)</span>
          </div>

          {/* 1-2行原始输出/diff代码片段预览 */}
          <div className="bg-[#141618] border border-white/10 rounded px-2 py-1.5 text-[10px] font-mono text-slate-300 leading-relaxed overflow-hidden mb-1.5 break-all whitespace-pre-wrap select-none">
            {getSnippetPreview()}
          </div>

          {/* 底部折叠说明 */}
          <div className="text-[10px] text-[#A8A29E] font-mono flex items-center justify-between">
            <span>修剪将折叠为单行摘要</span>
            <span className="text-amber-400/80">Pending</span>
          </div>
        </div>
      )}

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

      {/* 人类热纠偏批示徽章 (如有) */}
      {nodeData.humanSteering && (
        <div
          className="mb-2 px-1.5 py-0.5 rounded bg-amber-50/90 border border-amber-300 text-amber-900 text-[9px] font-mono flex items-center space-x-1"
          title={`热纠偏: ${nodeData.humanSteering}`}
        >
          <Sparkles className="w-2.5 h-2.5 text-amber-600 shrink-0" />
          <span className="font-semibold text-amber-800 shrink-0">已热纠偏:</span>
          <span className="truncate">{nodeData.humanSteering}</span>
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
              <ShieldAlert className="w-3 h-3 mr-0.5 inline animate-pulse" /> 门禁待审
            </span>
          )}
          {nodeData.status === 'rejected' && (
            <span className="text-red-700 flex items-center font-bold">
              <AlertCircle className="w-3 h-3 mr-0.5 inline text-red-600" /> 已拦截
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
