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

/** 单测或工具调用执行观测结果 */
export interface TelemetryObservation {
  exitCode: number
  output: string[]
}

/** 核心流式遥测事件契约 (TelemetryEvent) */
export interface TelemetryEvent {
  traceId: string
  nodeId: string
  parentId?: string
  type: TelemetryEventType
  gesture: TelemetryGesture
  actor: TelemetryActor
  title?: string
  status?: TelemetryStatus
  delta?: string // 流式打字增量 / typewriter incremental delta
  payload?: Record<string, unknown>
  observation?: TelemetryObservation
  gatePayload?: GatePromptPayload
  gateDecision?: GateDecision
  isCorrectionBranch?: boolean
  timestamp?: number
}
