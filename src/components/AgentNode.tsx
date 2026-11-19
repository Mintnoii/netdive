import React from 'react'
import { Handle, Position, type NodeProps, useStore } from '@xyflow/react'
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
  Layers,
} from 'lucide-react'
import type {
  TelemetryActor,
  TelemetryGesture,
  TelemetryObservation,
  TelemetryStatus,
  AssertionResult,
  TelemetryEvent,
} from '../types/telemetry'
import { formatNodeSummary } from '../types/telemetry'
import { extractLandmarkLabel } from '../services/agentNodeLOD'

export const AGENT_NODE_WIDTH = 280
export const FAR_ZOOM_THRESHOLD = 0.85

export function isFarZoom(zoom: number): boolean {
  return zoom < FAR_ZOOM_THRESHOLD
}

export interface AgentNodeData {
  nodeId?: string
  gesture: TelemetryGesture
  title: string
  summary?: string
  status: TelemetryStatus
  isAggregated?: boolean
  aggregateCount?: number
  isCorrectionBranch?: boolean
  actor?: TelemetryActor
  duration?: string
  pruned?: boolean
  humanSteering?: string
  observation?: TelemetryObservation
  payload?: Record<string, unknown>
  assertion?: AssertionResult
  prunableTokens?: number
  reclaimedTokens?: number
  walPointerId?: string
  aggregatedEvents?: TelemetryEvent[]
  /** 瘦节点标量字段（见 services/nodeFacets.ts）：绝不承载完整 payload / observation */
  command?: string
  filePath?: string
  pattern?: string
  exitCode?: number
  outputHead?: string
  outputLineCount?: number
  outputChars?: number
  hasDiff?: boolean
  /** 演练沙盒交互扩展：大体积工具截断操作钩子 */
  onToggleCompact?: () => void
  hasLargePayload?: boolean
  largePayloadLines?: number
  /** 演练沙盒交互扩展：前半段打包精简操作钩子 */
  onTogglePruneStageOne?: () => void
  isSafeBoundary?: boolean
  isStageOnePruned?: boolean
  /** 演练沙盒交互扩展：连续同构调用折叠/展开钩子 */
  onToggleCoalesce?: () => void
  subCallCount?: number
  [key: string]: unknown
}

/**
 * 提取缩小远景模式下的核心意图标牌文本
 * 遵循真实动宾意图第一性原则：字号大、空间足、绝不截断
 * 例如：
 * - 思考手势：🎯 检查App.tsx切片
 * - 文件手势：📄 App.tsx
 * - 命令手势：$ pnpm test
 * - 异常手势：❌ 报错 / ❌ 已拦截
 * - 门禁手势：🛡️ 门禁待审
 */
export function extractBillboardText(nodeData: AgentNodeData): string {
  // 1. 优先提取远景地标标签
  const landmark = extractLandmarkLabel(nodeData)

  // 2. 针对文件读写 (read / edit)：未包含 Emoji 时补充 📄 前缀更醒目
  if (nodeData.gesture === 'read' || nodeData.gesture === 'edit') {
    if (
      !landmark.startsWith('📄') &&
      !landmark.startsWith('🔍') &&
      !landmark.startsWith('✂️') &&
      !landmark.startsWith('❌')
    ) {
      return `📄 ${landmark}`
    }
    return landmark
  }

  // 3. 针对命令行执行 (bash)：在 280px 卡片充裕空间下展现更完整的动宾命令与目标参数 (支持达 45~50 字符)
  if (nodeData.gesture === 'bash' && !landmark.startsWith('❌') && !landmark.startsWith('⚡')) {
    const rawCmd = String(nodeData.command || '').trim()
    const cleanCmd = (rawCmd || nodeData.title || '')
      .replace(/^bash:\s*/i, '')
      .replace(/^\$\s*/, '')
      .trim()

    const firstLineCmd = cleanCmd.split(/[\r\n]+/)[0].trim()
    if (firstLineCmd) {
      if (firstLineCmd.length <= 48) {
        return `$ ${firstLineCmd}`
      }
      return `$ ${firstLineCmd.slice(0, 46)}...`
    }
  }

  return landmark
}

/** 状态徽章渲染纯组件 */
function renderCompactStatusBadge(nodeData: AgentNodeData) {
  if (nodeData.isAggregated) {
    return (
      <span className="shrink-0 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full bg-[#EAE4D9] text-[#3D3831] border border-[#C5BDAF]">
        x{nodeData.aggregateCount || 2} 聚合
      </span>
    )
  }
  if (nodeData.status === 'failed') {
    return (
      <span className="shrink-0 text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-800 border border-red-200">
        失败
      </span>
    )
  }
  if (nodeData.status === 'rejected') {
    return (
      <span className="shrink-0 text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-800 border border-red-200">
        已拦截
      </span>
    )
  }
  if (nodeData.status === 'gate') {
    return (
      <span className="shrink-0 text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 animate-pulse">
        待审
      </span>
    )
  }
  if (nodeData.status === 'running') {
    return (
      <span className="shrink-0 text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 border border-indigo-200 animate-pulse">
        运行中
      </span>
    )
  }
  if (nodeData.isCorrectionBranch) {
    return (
      <span className="shrink-0 text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
        自愈
      </span>
    )
  }
  return (
    <span className="shrink-0 text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
      完成
    </span>
  )
}

export const AgentNode: React.FC<NodeProps> = ({ data, selected }) => {
  const nodeData = data as unknown as AgentNodeData

  // 监听 React Flow 当前视口 Zoom 缩放倍率 (Level of Detail - LOD 语义自适应)
  const zoom = useStore((s) => s.transform?.[2]) ?? 1
  const isFar = isFarZoom(zoom)

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
    if (selected) {
      if (nodeData.isAggregated) {
        return 'border-[#1E2024] ring-2 ring-[#1E2024]/10 bg-[#FAF8F5] shadow-[3px_3px_0px_#8F887D,6px_6px_0px_#C8C2B7]'
      }
      return 'border-[#1E2024] ring-2 ring-[#1E2024]/10 shadow-md'
    }
    if (nodeData.pruned) {
      return 'border-dashed border-[#C5BFB5] bg-[#FAF8F5] hover:border-[#8F887D] shadow-2xs'
    }
    if (nodeData.status === 'rejected') return 'border-red-400 bg-red-50/50 ring-2 ring-red-400/20 shadow-xs'
    if (nodeData.status === 'failed') return 'border-red-400 bg-red-50/40 shadow-xs'
    if (nodeData.status === 'gate') return 'border-amber-400 bg-amber-50/40 ring-2 ring-amber-400/20 shadow-xs'
    if (nodeData.isCorrectionBranch) {
      if (nodeData.status === 'running') {
        return 'border-amber-400 bg-amber-50/30 ring-2 ring-amber-400/20 shadow-xs'
      }
      return 'border-amber-300/80 bg-[#FCFAF6] hover:border-amber-400/90 shadow-xs'
    }
    if (nodeData.status === 'running') return 'border-indigo-400 bg-white ring-2 ring-indigo-400/20 shadow-xs'
    if (nodeData.isAggregated) {
      return 'border-[#C0B9AC] bg-[#FAF8F5] hover:border-[#8F887D] shadow-[3px_3px_0px_#D5CEC2,6px_6px_0px_#EDE8DF]'
    }
    return 'border-[#E5E0D8] hover:border-[#B5AFA4] shadow-xs'
  }

  // 缩小远景模式 (zoom < 0.85)：物理尺寸固定为标准的 w-[280px]，隐藏下半部分琐碎小字，全空间让给加粗、清晰、大字号核心意图与实体标题
  if (isFar) {
    const billboardText = extractBillboardText(nodeData)
    return (
      <div
        data-testid="lod-far-billboard"
        className={`w-[280px] rounded-lg bg-white border p-3 transition-all duration-150 relative select-none ${getBorderClass()}`}
        style={{ width: 280 }}
      >
        {/* React Flow 输入桩：物理固定锚定在 280px 标准卡片左边缘，连线稳定无漂移 */}
        <Handle
          type="target"
          position={Position.Left}
          className="!w-2 !h-2 !bg-[#8F887D] !border-2 !border-white"
        />

        {/* 顶部极简信息行：手势图标 + 执行主体 + 状态徽章 */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center space-x-1.5 min-w-0">
            <div className="p-1 rounded bg-[#F4F0EA] border border-[#E5E0D8] shrink-0">
              {getIcon()}
            </div>
            <span
              className="text-[10px] font-mono text-[#8F887D] truncate max-w-[120px]"
              title={nodeData.actor}
            >
              {nodeData.actor || 'Agent'}
            </span>
          </div>
          {renderCompactStatusBadge(nodeData)}
        </div>

        {/* 核心意图标牌：加粗、清晰、大字号真实意图与实体标题，多行自然排布，绝不截断 */}
        <div className="py-1">
          <div
            data-testid="lod-landmark-label"
            className="text-sm font-bold text-[#1E2024] font-sans leading-normal tracking-tight break-words"
            title={billboardText}
          >
            {billboardText}
          </div>
        </div>

        {/* React Flow 输出桩：物理固定锚定在 280px 标准卡片右边缘，连线稳定无漂移 */}
        <Handle
          type="source"
          position={Position.Right}
          className="!w-2 !h-2 !bg-[#8F887D] !border-2 !border-white"
        />
      </div>
    )
  }

  // 正常视距模式 (zoom >= 0.85)：展示完整信纸卡片 (包含摘要、指标与 exitCode)
  // 当节点已被上下文剪枝折叠时，展示信纸折叠卡片 (Compact Folded Card)
  if (nodeData.pruned) {
    const reclaimed = nodeData.reclaimedTokens || 85200
    const walId = nodeData.walPointerId || 'wal-lab-tsc-01'

    return (
      <div
        className={`w-[280px] rounded-lg bg-[#FAF8F5] border border-dashed border-[#C5BFB5] p-3 shadow-2xs transition-all duration-150 hover:border-[#8F887D] relative ${
          selected ? 'ring-2 ring-[#1E2024]/10 border-[#1E2024]' : ''
        }`}
        style={{ width: 280 }}
      >
        {/* React Flow 左侧输入连接桩（用于从左到右连线） */}
        <Handle
          type="target"
          position={Position.Left}
          className="!w-2 !h-2 !bg-[#8F887D] !border-2 !border-[#FAF8F5]"
        />

        <div className="flex items-center space-x-1.5 mb-1.5">
          <div className="p-1 rounded bg-amber-100/70 text-amber-800 shrink-0">
            <Scissors className="w-3.5 h-3.5 text-amber-700" />
          </div>
          <div className="text-xs font-semibold text-[#1E2024] truncate flex-1" title={nodeData.title}>
            {nodeData.title}
          </div>
          <span className="shrink-0 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">
            -{Math.round(reclaimed / 1000)}k Token
          </span>
        </div>

        {/* 微压缩切片示意条 (Head 15 / Tail 15) */}
        <div className="mb-2 p-1.5 rounded bg-white/80 border border-[#E8E2D5] text-[10px] font-mono space-y-1">
          <div className="flex items-center justify-between text-[#6E685E]">
            <span className="text-emerald-700 font-semibold">Head 15</span>
            <span className="text-amber-700 font-bold">折叠 ~1470 行</span>
            <span className="text-purple-700 font-semibold">Tail 15</span>
          </div>
          <div className="w-full bg-[#E5E0D8] rounded-full h-1.5 overflow-hidden flex">
            <div className="bg-emerald-500 h-1.5 w-2/12" title="前置入参" />
            <div className="bg-amber-400 h-1.5 w-8/12 opacity-40" title="WAL 折叠" />
            <div className="bg-purple-500 h-1.5 w-2/12" title="退出判定" />
          </div>
        </div>

        <div className="text-[11px] text-[#78716C] font-mono italic truncate mb-2" title={nodeData.summary}>
          {nodeData.summary ? `[骨架摘要] ${nodeData.summary}` : '[冗余工具调用上下文已折叠]'}
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-[#E7E5E4] text-[10px] text-[#A8A29E] font-mono">
          <span className="truncate max-w-[120px] font-medium text-purple-700" title={`WAL: ${walId}`}>
            WAL: {walId}
          </span>
          {typeof nodeData.onToggleCompact === 'function' ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                nodeData.onToggleCompact?.()
              }}
              className="text-emerald-800 font-semibold hover:underline cursor-pointer flex items-center space-x-0.5"
              title="点击展开还原原文"
            >
              <span>还原原文</span>
            </button>
          ) : (
            <span className="text-emerald-800 font-semibold">节约 86.5%</span>
          )}
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
      className={`w-[280px] rounded-lg bg-white border p-3 transition-all duration-150 relative ${getBorderClass()}`}
      style={{ width: 280 }}
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
        {nodeData.isAggregated && (
          <span
            className="shrink-0 text-[9px] font-mono font-semibold px-2 py-0.5 rounded-full bg-[#EAE4D9] text-[#3D3831] border border-[#C5BDAF] shadow-2xs flex items-center space-x-1"
            title={`连续聚合 ${nodeData.aggregateCount || 2} 次同构调用 (已折叠)`}
          >
            <Layers className="w-2.5 h-2.5 text-[#5C5549] inline" />
            <span>x{nodeData.aggregateCount || 2} 聚合</span>
          </span>
        )}
      </div>

      {/* Observation 观测结果警示：若存在失败显示 exit: 1 提示 */}
      {typeof nodeData.exitCode === 'number' && nodeData.exitCode !== 0 && (
        <div className="mb-2 px-2 py-1 rounded bg-red-50/90 border border-red-200 text-red-800 flex items-center justify-between text-[10px] font-mono">
          <div className="flex items-center space-x-1 font-semibold text-red-700">
            <AlertCircle className="w-3 h-3 text-red-600 shrink-0" />
            <span>exit: {nodeData.exitCode}</span>
          </div>
          <span
            className="text-[9px] text-red-600/90 truncate max-w-[130px]"
            title={nodeData.outputHead}
          >
            {nodeData.outputHead || '断言异常'}
          </span>
        </div>
      )}

      {/* Observation 观测结果通过提示 */}
      {nodeData.exitCode === 0 && (
        <div className="mb-2 px-2 py-1 rounded bg-emerald-50/80 border border-emerald-200/80 text-emerald-800 flex items-center justify-between text-[10px] font-mono">
          <div className="flex items-center space-x-1 font-semibold text-emerald-700">
            <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
            <span>exit: 0</span>
          </div>
          <span className="text-[9px] text-emerald-600 truncate max-w-[130px]">
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
        {formatNodeSummary(nodeData.summary)}
        {nodeData.status === 'running' && (
          <span className="inline-block w-1.5 h-3 ml-0.5 bg-indigo-500 animate-pulse align-middle" />
        )}
      </div>

      {/* 演练交互：大体积输出快捷掐头去尾按钮 */}
      {nodeData.hasLargePayload && typeof nodeData.onToggleCompact === 'function' && (
        <div className="mb-2 pt-1 border-t border-amber-200/60">
          <button
            onClick={(e) => {
              e.stopPropagation()
              nodeData.onToggleCompact?.()
            }}
            className="w-full py-1 px-2 rounded bg-amber-500 hover:bg-amber-600 text-white font-sans text-[11px] font-semibold flex items-center justify-center space-x-1.5 shadow-2xs transition-colors cursor-pointer"
            title="一键只留前后各15行，把中间繁琐日志存入内存"
          >
            <Scissors className="w-3 h-3 text-white" />
            <span>掐头去尾截断 ({nodeData.largePayloadLines}行)</span>
          </button>
        </div>
      )}

      {/* 演练交互：前半段任务收网，一键打包精简前序历史 */}
      {nodeData.isSafeBoundary && typeof nodeData.onTogglePruneStageOne === 'function' && (
        <div className="mb-2 pt-1 border-t border-emerald-200/60">
          <button
            onClick={(e) => {
              e.stopPropagation()
              nodeData.onTogglePruneStageOne?.()
            }}
            className={`w-full py-1 px-2 rounded font-sans text-[11px] font-semibold flex items-center justify-center space-x-1.5 shadow-2xs transition-colors cursor-pointer ${
              nodeData.isStageOnePruned
                ? 'bg-slate-700 hover:bg-slate-800 text-white'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
            }`}
            title="前半截素材提纯与润色已定稿，将前序草稿打包精简为结构化摘要，大幅释放空间"
          >
            <Sparkles className="w-3 h-3 text-emerald-200" />
            <span>{nodeData.isStageOnePruned ? '已打包精简前半段 (点击展开)' : '前半段定稿：一键打包精简 (-3.2k)'}</span>
          </button>
        </div>
      )}

      {/* 演练交互：连续同构调用折叠/展开（展开态第一个子节点折叠，聚合态展开） */}
      {typeof nodeData.onToggleCoalesce === 'function' && (
        <div className="mb-2 pt-1 border-t border-sky-200/60">
          <button
            onClick={(e) => {
              e.stopPropagation()
              nodeData.onToggleCoalesce?.()
            }}
            className={`w-full py-1 px-2 rounded font-sans text-[11px] font-semibold flex items-center justify-center space-x-1.5 shadow-2xs transition-colors cursor-pointer ${
              nodeData.isAggregated
                ? 'bg-slate-600 hover:bg-slate-700 text-white'
                : 'bg-sky-500 hover:bg-sky-600 text-white'
            }`}
            title={nodeData.isAggregated
              ? '展开这个聚合节点，还原为多次独立的同构工具调用'
              : '把连续的同构工具调用折叠为一个聚合节点，消除重复 Schema 样板'}
          >
            <Layers className="w-3 h-3 text-white" />
            <span>{nodeData.isAggregated
              ? `已聚合 x${nodeData.aggregateCount || 2} (点击展开)`
              : `折叠重复调用 (x${nodeData.subCallCount || 2})`}</span>
          </button>
        </div>
      )}

      {/* 底部元数据：执行主体与状态 */}
      <div className="flex items-center justify-between pt-1.5 border-t border-[#F0EBE1] text-[10px] text-[#8F887D] font-mono">
        <span className="truncate max-w-[130px]" title={nodeData.actor}>
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
              <CheckCircle2 className="w-3 h-3 mr-0.5 inline" /> {nodeData.isAggregated ? `已聚合 (x${nodeData.aggregateCount || 2})` : '完成'}
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

/**
 * 画布用节点渲染守卫：仅在节点自身数据引用、选中态或 id 变化时重渲染
 * 长会话下每次遥测都会产出新的 nodes 数组，浅比较 data 引用即可拦截全量重绘
 * 注意：`AgentNode` 保持纯函数组件导出（对外 SDK 契约与测试依赖其函数形态），
 * memo 包装以 `AgentNodeMemo` 形态提供给 React Flow 的 nodeTypes 使用。
 */
export const AgentNodeMemo = React.memo(AgentNode, (prev, next) => {
  return (
    prev.id === next.id &&
    prev.selected === next.selected &&
    prev.data === next.data &&
    prev.dragging === next.dragging
  )
})
