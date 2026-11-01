/**
 * NetDive (潜网) Telemetry Event Types & Data Contracts
 * 契约驱动的流式拓扑数据契约
 */

/** 节点手势动作类型 */
export type TelemetryGesture =
  | 'think'
  | 'read'
  | 'edit'
  | 'bash'
  | 'memory'
  | 'gate'

/** 执行主体标识 */
export type TelemetryActor =
  | 'Pi (Coordinator)'
  | 'Claude 3.7 (Worker)'
  | 'Human Operator'
  | 'pi-coordinator'
  | 'claude-worker'
  | (string & {})

/** 节点生命周期状态 */
export type TelemetryStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'gate'
  | 'rejected'

/** 人类在环决策结果契约 (Human Gate Decision) */
export interface GateDecision {
  action: 'approve' | 'reject' | 'modify'
  feedback?: string
  modifiedCommand?: string
}

/** 上下文水位与 Token 消耗分布契约 (Context Watermark) */
export interface ContextWatermark {
  totalLimit: number
  systemPrompt: number
  ltm: number
  activeTurns: number
  prunableTools: number
}

/** 默认上下文水位基准 (82k / 128k, ~64%) */
export const DEFAULT_CONTEXT_WATERMARK: ContextWatermark = {
  totalLimit: 128000,
  systemPrompt: 8000,
  ltm: 12000,
  activeTurns: 16000,
  prunableTools: 46000,
}

/**
 * 格式化 Token 计数展示 (例如 82000 -> 82k, 4500 -> 4.5k)
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    const k = tokens / 1000
    return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`
  }
  return `${tokens}`
}

/** 决策门禁挂起请求负载 (Gate Prompt Payload) */
export interface GatePromptPayload {
  gateId: string
  title: string
  riskLevel: 'high' | 'critical'
  proposedAction: {
    command: string
    diff?: string
    explanation: string
  }
  timestamp: string
}

/** 流式遥测事件类型 */
export type TelemetryEventType =
  | 'node_start'
  | 'node_stream'
  | 'node_complete'
  | 'gate_prompt'
  | 'gate_resolved'
  | 'context_pruned'

/** 单测或工具调用执行观测结果 */
export interface TelemetryObservation {
  exitCode: number
  output: string[]
}

/** 上下文修剪结果负载 (Context Pruned Payload) */
export interface ContextPrunedPayload {
  before: ContextWatermark
  after: ContextWatermark
  reclaimedTokens: number
  prunedNodeIds?: string[]
}

/** 核心流式遥测事件契约 (TelemetryEvent) */
export interface TelemetryEvent {
  traceId: string
  nodeId: string
  parentId?: string
  type: TelemetryEventType
  gesture?: TelemetryGesture
  actor?: TelemetryActor
  title?: string
  status?: TelemetryStatus
  delta?: string // 流式打字增量 / typewriter incremental delta
  payload?: Record<string, unknown>
  observation?: TelemetryObservation
  gatePayload?: GatePromptPayload
  gateDecision?: GateDecision
  isCorrectionBranch?: boolean
  timestamp?: number
  watermark?: ContextWatermark
  reclaimedTokens?: number
  prunedNodeIds?: string[]
  contextPruned?: ContextPrunedPayload
}
