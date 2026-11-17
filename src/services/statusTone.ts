/**
 * @file src/services/statusTone.ts
 * @description 画布状态色单一真源（描边 / 底色 / 边样式）。
 *
 * 契约：
 * 1. 全仓状态语义色只在此处定义，组件严禁再写字面色值；
 * 2. 语义判定收敛为两个纯函数（回合级 / 原子节点级），小地图与缩略图共用同一套判定；
 * 3. 判定按「输入命中 → 状态键」查表，不写级联 if/else 与 switch 复本。
 */

import type { AgentNodeData } from '../components/AgentNode'
import type { TurnNodeData } from '../components/TurnNode'

/** 状态语义键 */
export type StatusToneKey =
  | 'success'
  | 'failed'
  | 'gate'
  | 'branching'
  | 'running'
  | 'aggregated'
  | 'pruned'
  | 'inputOnly'

/** 描边色调（小地图与连线描边复用） */
export const TONE_STROKE: Readonly<Record<StatusToneKey, string>> = {
  success: '#10B981',
  failed: '#F43F5E',
  gate: '#F59E0B',
  branching: '#D97706',
  running: '#6366F1',
  aggregated: '#B5AFA4',
  pruned: '#78716C',
  inputOnly: '#78716C',
}

/** 填充色调（小地图色块与节点基调复用） */
export const TONE_FILL: Readonly<Record<StatusToneKey, string>> = {
  success: '#D1FAE5',
  failed: '#FFE4E6',
  gate: '#FEF3C7',
  branching: '#FEF9C3',
  running: '#E0E7FF',
  aggregated: '#EAE4D9',
  pruned: '#F5F5F4',
  inputOnly: '#D6D3D1',
}

/** 原子节点执行失败的统一描边色（比回合级更暗一档，便于微观辨识） */
export const AGENT_FAILED_STROKE = '#EF4444'

/** 实时流失败连线色（比填充更醒目） */
export const FAILED_EDGE_STROKE = '#DC2626'

/** 回合级失败连线色（宏观主干略深一档，与实时流区分） */
export const TURN_FAILED_EDGE_STROKE = '#E11D48'

/** 中性连线色（常规因果主干） */
export const NEUTRAL_EDGE_STROKE = '#8F887D'

/** 自愈分支连线样式（声明式常量，杜绝多处字面量漂移） */
export const BRANCH_EDGE_STYLE = {
  stroke: TONE_STROKE.branching,
  strokeWidth: 1.5,
  strokeDasharray: '5 4',
} as const

/** 小地图可识别的最小节点形状 */
interface MiniMapNodeShape {
  id: string
  type?: string
  data?: unknown
}

/**
 * 判定回合节点是否为「纯人类输入回合」（无工具调用、至多一条人类消息）
 *
 * @example
 * isInputOnlyTurn({ toolCounts: {}, subEvents: [{ actor: 'Human Operator' }] }) // => true
 */
export function isInputOnlyTurn(turnData?: TurnNodeData): boolean {
  const toolEntries = Object.entries(turnData?.toolCounts ?? {})
  const subEvents = turnData?.subEvents ?? []
  const isHumanEvent = (actor?: string, title?: string) =>
    actor === 'Human Operator' || /用户|User/i.test(title ?? '')

  return (
    toolEntries.length === 0 &&
    (subEvents.length <= 1 || subEvents.every((ev) => isHumanEvent(ev.actor, ev.title)))
  )
}

/** 回合级状态映射表（字典直给，无 switch 复本） */
const TURN_TONE_MAP: Readonly<Record<string, StatusToneKey>> = {
  failed: 'failed',
  gate: 'gate',
  branching: 'branching',
  running: 'running',
  success: 'success',
}

/**
 * 解析回合节点的语义色调
 */
export function resolveTurnTone(turnData?: TurnNodeData): StatusToneKey {
  if (isInputOnlyTurn(turnData)) return 'inputOnly'
  return TURN_TONE_MAP[turnData?.status ?? 'success'] ?? 'success'
}

/**
 * 解析原子节点的语义色调（失败 > 门禁 > 自愈 > 聚合 > 运行中 > 完成）
 */
export function resolveAgentTone(nodeData?: AgentNodeData): StatusToneKey {
  if (!nodeData) return 'success'
  if (nodeData.status === 'failed' || nodeData.status === 'rejected') return 'failed'
  if (nodeData.status === 'gate') return 'gate'
  if (nodeData.isCorrectionBranch) return 'branching'
  if (nodeData.isAggregated) return 'aggregated'
  if (nodeData.pruned) return 'pruned'
  if (nodeData.status === 'running') return 'running'
  return 'success'
}

/**
 * 判定节点属于回合节点还是原子节点
 */
function isTurnNode(node: MiniMapNodeShape): boolean {
  return (
    node.type === 'turnNode' ||
    node.id.startsWith('turn-') ||
    Boolean((node.data as { turnId?: string } | undefined)?.turnId)
  )
}

/**
 * 解析节点的语义色调（回合节点与原子节点统一入口）
 */
export function resolveNodeTone(node: MiniMapNodeShape): StatusToneKey {
  return isTurnNode(node)
    ? resolveTurnTone(node.data as TurnNodeData | undefined)
    : resolveAgentTone(node.data as AgentNodeData | undefined)
}

/**
 * 小地图节点描边色
 *
 * @example
 * minimapNodeStroke({ id: 'node-1', data: { status: 'gate' } }) // => '#F59E0B'
 */
export function minimapNodeStroke(node: MiniMapNodeShape): string {
  const tone = resolveNodeTone(node)
  const isAgentFailed = !isTurnNode(node) && tone === 'failed'
  return isAgentFailed ? AGENT_FAILED_STROKE : TONE_STROKE[tone]
}

/**
 * 小地图节点填充色
 */
export function minimapNodeFill(node: MiniMapNodeShape): string {
  return TONE_FILL[resolveNodeTone(node)]
}
