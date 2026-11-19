/**
 * @file src/services/flowLayout.ts
 * @description React Flow 拓扑布局与连线语义单一真源。
 *
 * 契약：
 * 1. 坐标、折行网格、连线样式与动画语义只在此处定义，实时流与回放侧共用；
 * 2. 布局是纯函数，输入事件/父节点与既有节点集合，输出坐标或边，不持有任何状态；
 * 3. 边样式按「自愈分支 > 失败 > 常规」优先级查表，杜绝各调用点自行拼装。
 */

import type { Edge, Node } from '@xyflow/react'
import type { TelemetryEvent, TelemetryStatus } from '../types/telemetry'
import { BRANCH_EDGE_STYLE, FAILED_EDGE_STROKE, NEUTRAL_EDGE_STROKE } from './statusTone'

/** 布局常量：与节点物理尺寸 (280px 卡片) 严格对齐，预留充足水平间隙使因果连线与箭头清晰可见 */
export const FLOW_LAYOUT = {
  startX: 50,
  stepX: 370,
  baseY: 180,
  branchOffset: 160,
  rowGap: 380,
  nodesPerRow: 5,
  nodeHeight: 140,
} as const

/**
 * 回合卡片网格：宏观卡片尺寸与原子节点不同（450 步距 / 4 卡每行 / 320 折叠宽）
 * 预留 130px 水平间隙与清晰连线
 */
export const TURN_GRID = {
  stepX: 450,
  baseY: 180,
  rowGap: 300,
  nodesPerRow: 4,
  collapsedWidth: 320,
} as const

/** 回放侧折行网格布局参数（可按场景覆盖） */
export interface FlowGridOptions {
  stepX?: number
  baseY?: number
  branchOffset?: number
  rowGap?: number
  nodesPerRow?: number
}

/**
 * 解析连线样式
 *
 * @example
 * resolveFlowEdgeStyle(true)  // => { stroke: '#D97706', strokeWidth: 1.5, strokeDasharray: '5 4' }
 * resolveFlowEdgeStyle(false, 'failed') // => { stroke: '#DC2626', strokeWidth: 2 }
 */
export function resolveFlowEdgeStyle(
  isBranchEdge: boolean,
  status?: TelemetryStatus
): Edge['style'] {
  if (isBranchEdge) return BRANCH_EDGE_STYLE
  if (status === 'failed') return { stroke: FAILED_EDGE_STROKE, strokeWidth: 2 }
  return { stroke: NEUTRAL_EDGE_STROKE, strokeWidth: 1.5 }
}

/** 边的构建参数契约 */
export interface FlowEdgeParams {
  source: string
  target: string
  isBranchEdge?: boolean
  status?: TelemetryStatus
  /** 显式覆盖动画语义（回放时统一收敛为静态） */
  animated?: boolean
}

/**
 * 构建标准因果边（smoothstep + 统一样式与动画语义）
 *
 * @example
 * createFlowEdge({ source: 'node-1', target: 'node-2', status: 'running' })
 * // => { id: 'e-node-1-node-2', type: 'smoothstep', animated: true, ... }
 */
export function createFlowEdge(params: FlowEdgeParams): Edge {
  const { source, target, isBranchEdge = false, status, animated } = params

  return {
    id: `e-${source}-${target}`,
    source,
    target,
    type: 'smoothstep',
    animated: animated ?? (status === 'running' || !status),
    zIndex: 10,
    style: resolveFlowEdgeStyle(isBranchEdge, status),
  }
}

/**
 * 回放侧折行网格坐标：主干自左向右铺满一行后折行，自愈分支下沉
 *
 * @example
 * wrapGridPosition(0, false)  // => { x: 50, y: 180 }
 * wrapGridPosition(7, true)   // => { x: 330, y: 680 }
 */
export function wrapGridPosition(
  index: number,
  isCorrectionBranch?: boolean,
  options: FlowGridOptions = {}
): { x: number; y: number } {
  const stepX = options.stepX ?? FLOW_LAYOUT.stepX
  const baseY = options.baseY ?? FLOW_LAYOUT.baseY
  const branchOffset = options.branchOffset ?? FLOW_LAYOUT.branchOffset
  const rowGap = options.rowGap ?? FLOW_LAYOUT.rowGap
  const nodesPerRow = options.nodesPerRow ?? FLOW_LAYOUT.nodesPerRow

  const row = Math.floor(index / nodesPerRow)
  const col = index % nodesPerRow
  const rowBaseY = baseY + row * rowGap

  return {
    x: FLOW_LAYOUT.startX + col * stepX,
    y: isCorrectionBranch ? rowBaseY + branchOffset : rowBaseY,
  }
}

/**
 * 实时流侧因果坐标：沿父节点向右顺延，无父节点时按现有节点数铺续
 *
 * @example
 * causalNodePosition(undefined, 0)            // => { x: 50, y: 180 }
 * causalNodePosition({ position: { x: 330, y: 180 } as never }, 2) // => { x: 610, y: 180 }
 */
export function causalNodePosition(
  parentNode: Node | undefined,
  existingNodeCount: number,
  isCorrectionBranch?: boolean
): { x: number; y: number } {
  const x = parentNode
    ? parentNode.position.x + FLOW_LAYOUT.stepX
    : FLOW_LAYOUT.startX + existingNodeCount * FLOW_LAYOUT.stepX

  const y = isCorrectionBranch
    ? FLOW_LAYOUT.baseY + FLOW_LAYOUT.branchOffset
    : FLOW_LAYOUT.baseY

  return { x, y }
}

/**
 * 判定连线是否为自愈分支边（当前节点或父节点处于自愈分支）
 */
export function isBranchEdgeBetween(
  event: Partial<TelemetryEvent>,
  parentNode?: Node
): boolean {
  const isCurrentCorrection = Boolean(event.isCorrectionBranch)
  const isParentCorrection = Boolean(
    (parentNode?.data as { isCorrectionBranch?: boolean } | undefined)?.isCorrectionBranch
  )
  return isCurrentCorrection || isParentCorrection
}
