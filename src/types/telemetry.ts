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

/** L1 确定性断言引擎判定结果 (L1 Deterministic Assertion Result) */
export interface AssertionResult {
  passed: boolean
  triggerSelfCorrection: boolean
  triggerGate: boolean
  reason?: string
  severity: 'info' | 'warn' | 'critical'
  rule?: string
  failureCount?: number
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

/** 基础基准上下文水位 (22k / 128k, ~17%, 绿区安全水位) */
export const BASE_CONTEXT_WATERMARK: ContextWatermark = {
  totalLimit: 128000,
  systemPrompt: 12000,
  ltm: 8000,
  activeTurns: 2000,
  prunableTools: 0,
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

/** 可修剪冗余工具调用条目契约 */
export interface PrunableItem {
  id: string
  gesture: 'bash' | 'edit' | 'read'
  emoji: string
  title: string
  rawDetail: string
  tokens: number
  statusBadge: string
  foldedSummary: string
  rawPayloadPreview?: string
  linesCount?: number
}

/** 默认预设冗余工具调用明细 (46k tokens 待修剪分布) */
export const DEFAULT_PRUNABLE_ITEMS: PrunableItem[] = [
  {
    id: 'item-bash',
    gesture: 'bash',
    emoji: '📟',
    title: 'Bash: pnpm test:pipeline -> 156 passed',
    rawDetail: '150 lines raw test stdout/stderr, ~28k tokens',
    tokens: 28000,
    statusBadge: '已完成历史使命 (Resolved)',
    foldedSummary: '单元测试回归通过 (156 passed, 0 failed)',
    linesCount: 150,
    rawPayloadPreview: [
      '$ pnpm test:pipeline',
      '> vitest run pipeline',
      '',
      '✓ test/pipeline.test.ts (156 tests passed)',
      '  ✓ pipeline initialization (12ms)',
      '  ✓ radash.tryit error capture contract (8ms)',
      '  ✓ defensive fallback on empty payload (5ms)',
      '  ... (150 lines raw stdout/stderr hidden)',
    ].join('\n'),
  },
  {
    id: 'item-edit',
    gesture: 'edit',
    emoji: '📝',
    title: 'Edit: packages/core/pipeline.ts',
    rawDetail: 'Full AST diff & replaced try/catch (~14k tokens)',
    tokens: 14000,
    statusBadge: '已完成历史使命 (Resolved)',
    foldedSummary: 'packages/core/pipeline.ts 重构应用成功，移除 try-catch 样板并引入 radash.tryit',
    linesCount: 42,
    rawPayloadPreview: [
      '--- a/packages/core/src/pipeline.ts',
      '+++ b/packages/core/src/pipeline.ts',
      '@@ -24,8 +24,8 @@',
      '- try {',
      '-   const res = await run()',
      '+ const [err, res] = await tryit(run)()',
    ].join('\n'),
  },
  {
    id: 'item-read',
    gesture: 'read',
    emoji: '🔍',
    title: 'Read: src/config.ts',
    rawDetail: 'Raw file contents (~4k tokens)',
    tokens: 4000,
    statusBadge: '已完成历史使命 (Resolved)',
    foldedSummary: '成功读取 package.json，确认依赖缺失',
    linesCount: 28,
    rawPayloadPreview: [
      '{',
      '  "name": "@netdive/core",',
      '  "version": "0.1.0",',
      '  "dependencies": {',
      '    "pathe": "^0.2.0",',
      '    "radash": "^12.1.0"',
      '  }',
      '}',
    ].join('\n'),
  },
]

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
  pointerId?: string
  compactSummary?: string
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
  assertion?: AssertionResult
  timestamp?: number
  watermark?: ContextWatermark
  watermarkDelta?: {
    activeTurns?: number
    prunableTools?: number
  }
  reclaimedTokens?: number
  prunedNodeIds?: string[]
  contextPruned?: ContextPrunedPayload
}
