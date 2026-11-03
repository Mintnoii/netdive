/**
 * NetDive (潜网) Telemetry Event Types & Data Contracts
 * 契约驱动的流式拓扑数据契约
 */
import type { Node } from '@xyflow/react'

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
  sessionId?: string
  sessionTitle?: string
  project?: string
  actor?: string
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
  exitCode?: number
  output?: string[] | string
  pointerId?: string
  compactSummary?: string
  command?: string
  [key: string]: unknown
}

/** 单项元素原子转文本原语 */
function extractItemToString(item: unknown): string {
  if (typeof item === 'string') return item
  if (item && typeof item === 'object') {
    const obj = item as Record<string, unknown>
    if (typeof obj.text === 'string') return obj.text
    if (typeof obj.content === 'string') return obj.content
    if (typeof obj.message === 'string') return obj.message
    return JSON.stringify(item)
  }
  return item !== undefined && item !== null ? String(item) : ''
}

/**
 * 安全规约任何形状的工具执行输出为 string[]
 * 统一归一化为单层集合，消灭内外重复 30 行类型判断八股
 */
export function normalizeObservationOutput(output: unknown): string[] {
  if (output === null || output === undefined) return []
  const rawList = Array.isArray(output) ? output : [output]
  return rawList
    .map(extractItemToString)
    .flatMap((str) => (str.includes('\n') ? str.split(/\r?\n/) : [str]))
}

/**
 * 规范化 TelemetryObservation 对象，确保 output 100% 规约为 string[]
 */
export function normalizeTelemetryObservation(
  observation: unknown
): (TelemetryObservation & { output: string[] }) | undefined {
  if (!observation || typeof observation !== 'object') {
    return undefined
  }
  const obs = observation as Record<string, unknown>
  const exitCode =
    typeof obs.exitCode === 'number'
      ? obs.exitCode
      : typeof obs.exitCode === 'string' && !isNaN(Number(obs.exitCode))
        ? Number(obs.exitCode)
        : undefined

  return {
    ...obs,
    exitCode,
    output: normalizeObservationOutput(obs.output),
    pointerId: typeof obs.pointerId === 'string' ? obs.pointerId : undefined,
    compactSummary: typeof obs.compactSummary === 'string' ? obs.compactSummary : undefined,
    command: typeof obs.command === 'string' ? obs.command : undefined,
  }
}

/** 上下文修剪结果负载 (Context Pruned Payload) */
export interface ContextPrunedPayload {
  before: ContextWatermark
  after: ContextWatermark
  reclaimedTokens: number
  prunedNodeIds?: string[]
}

/**
 * 安全格式化节点摘要文本，彻底消灭 [object Object] 坏味道
 */
export function formatNodeSummary(summary: unknown): string {
  if (summary === null || summary === undefined) return ''
  if (typeof summary === 'string') return summary
  if (typeof summary === 'number' || typeof summary === 'boolean') return String(summary)

  if (Array.isArray(summary)) {
    return summary
      .map((item) => formatNodeSummary(item))
      .filter(Boolean)
      .join('\n')
  }

  if (typeof summary === 'object') {
    const obj = summary as Record<string, unknown>
    if (typeof obj.text === 'string') return obj.text
    if (typeof obj.summary === 'string') return obj.summary
    if (typeof obj.plan === 'string') return obj.plan
    if (typeof obj.content === 'string') return obj.content
    if (typeof obj.message === 'string') return obj.message
    if (typeof obj.command === 'string') return `$ ${obj.command}`
    if (typeof obj.path === 'string') return `文件: ${obj.path}`
    return JSON.stringify(summary, null, 2)
  }

  return String(summary)
}

/** 核心流式遥测事件契约 (TelemetryEvent) */
export interface TelemetryEvent {
  nodeId: string
  sessionId?: string
  sessionTitle?: string
  project?: string
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
  isAggregated?: boolean
  aggregateCount?: number
  aggregatedEvents?: TelemetryEvent[]
  traceId?: string // 可选向后兼容别名
}

/** 会话列表项契约 (Master-Detail 视图数据模型) */
export interface ActiveSessionItem {
  id: string
  title: string
  actors: string[]
  status: TelemetryStatus
  nodeCount: number
  updatedAt: number
  project?: string
}

/**
 * 提取稳定会话标识 (Session ID)
 * 严格基于强契约 event.sessionId 提取，消除一切旧协议 trace 猜谜补丁
 */
export const resolveSessionId = (event?: Partial<TelemetryEvent>): string =>
  event?.sessionId?.trim() ||
  (event?.payload?.sessionId as string)?.trim() ||
  (event?.payload?.session_id as string)?.trim() ||
  'default-session'

/**
 * 提取清晰的会话意图标题 (Session Title)
 * 严格只从 sessionTitle、taskTitle、prompt 意图中提取，坚决禁止拿单个工具名覆写会话标题
 */
export function resolveSessionTitle(event?: Partial<TelemetryEvent>): string {
  const payload = event?.payload
  const explicit =
    event?.sessionTitle?.trim() ||
    (payload?.sessionTitle as string)?.trim() ||
    (payload?.taskTitle as string)?.trim() ||
    (payload?.objective as string)?.trim()

  if (explicit) return explicit

  const sid = resolveSessionId(event)
  return sid !== 'demo-session' && sid !== 'default-session' ? `会话 ${sid}` : '未命名任务会话'
}

/** 相对时间阶梯查表常数 */
const TIME_STEPS = [
  { limit: 30_000, label: () => '刚刚' },
  { limit: 3_600_000, label: (ms: number) => `${Math.floor(ms / 60_000)}分钟前` },
  { limit: 86_400_000, label: (ms: number) => `${Math.floor(ms / 3_600_000)}小时前` },
] as const

/**
 * 声明式格式化相对时间
 */
export function formatRelativeTime(timestamp: number): string {
  const diff = Math.max(0, Date.now() - timestamp)
  const matched = TIME_STEPS.find((step) => diff < step.limit)
  return matched ? matched.label(diff) : `${Math.floor(diff / 86_400_000)}天前`
}

/**
 * 格式化高密度结构化节点引用指纹 (Markdown)
 * 供人类快速查阅与直接投递给 AI 进行精准上下文沟通
 */
export function formatNodeReference(params: {
  node: Node
  sessionId?: string
  sessionTitle?: string
  project?: string
}): string {
  const { node, sessionId, sessionTitle, project } = params
  const data = (node?.data ?? {}) as Partial<{
    title?: string
    actor?: string
    gesture?: string
    status?: string
    summary?: unknown
    observation?: TelemetryObservation
    [key: string]: unknown
  }>

  const sid = sessionId?.trim() || 'default-session'
  const stitle = sessionTitle?.trim() || project?.trim() || '当前会话'
  const nodeId = node?.id || 'unknown-node'
  const title = data.title?.trim() || nodeId
  const actor = data.actor?.trim() || '未知主体'
  const gesture = data.gesture || 'unknown'
  const status = data.status || 'unknown'
  const summary = formatNodeSummary(data.summary ?? data.observation?.compactSummary).trim() || '无详细摘要'

  return [
    '[NetDive Node Reference]',
    `- 会话: ${sid} (${stitle})`,
    `- 节点: ${nodeId} (${title})`,
    `- 执行主体: ${actor}`,
    `- 手势/状态: ${gesture} · ${status}`,
    `- 摘要: ${summary}`,
  ].join('\n')
}

export interface ContextMenuPosition {
  x: number
  y: number
  flippedX: boolean
  flippedY: boolean
}

/** 默认菜单尺寸估算与边距 */
export const MENU_DEFAULT_WIDTH = 220
export const MENU_DEFAULT_HEIGHT = 190
export const MENU_VIEWPORT_MARGIN = 8

/**
 * 视口防溢出纯函数计算 (Viewport Anti-Overflow Positioning)
 * 当右侧或下侧超出边界时自动翻转展开，贴边时进行边界安全收敛
 */
export function calculateContextMenuPosition(
  x: number,
  y: number,
  menuWidth = MENU_DEFAULT_WIDTH,
  menuHeight = MENU_DEFAULT_HEIGHT,
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920,
  viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 1080,
  margin = MENU_VIEWPORT_MARGIN
): ContextMenuPosition {
  const flippedX = x + menuWidth > viewportWidth - margin
  const flippedY = y + menuHeight > viewportHeight - margin

  let posX = flippedX ? x - menuWidth : x
  let posY = flippedY ? y - menuHeight : y

  // 极窄视口防超界安全截断
  posX = Math.max(margin, Math.min(posX, Math.max(margin, viewportWidth - menuWidth - margin)))
  posY = Math.max(margin, Math.min(posY, Math.max(margin, viewportHeight - menuHeight - margin)))

  return { x: posX, y: posY, flippedX, flippedY }
}

/**
 * 复制节点引用到剪贴板核心逻辑 (兼容 Navigator Clipboard 与安全 DOM Fallback)
 */
export async function copyNodeReferenceToClipboard(params: {
  node: Node
  sessionId?: string
  sessionTitle?: string
  project?: string
  clipboard?: { writeText: (text: string) => Promise<void> }
}): Promise<{ success: boolean; text: string }> {
  const { node, sessionId, sessionTitle, project, clipboard } = params
  const text = formatNodeReference({
    node,
    sessionId,
    sessionTitle,
    project,
  })

  // 1. 优先使用注入或原生 navigator.clipboard
  const targetClipboard = clipboard ?? (typeof navigator !== 'undefined' ? navigator.clipboard : undefined)
  if (targetClipboard?.writeText) {
    try {
      await targetClipboard.writeText(text)
      return { success: true, text }
    } catch {
      // 降级进入 fallback
    }
  }

  // 2. 降级为 DOM textarea execCommand fallback (测试/非 HTTPS 环境)
  if (typeof document !== 'undefined') {
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      const succeeded = document.execCommand('copy')
      document.body.removeChild(textarea)
      return { success: succeeded, text }
    } catch {
      return { success: false, text }
    }
  }

  return { success: false, text }
}

/**
 * 格式化会话诊断现场为高密度合规 Markdown 卡片 (供用户一键复制与 AI 无缝沟通)
 */
export function formatSessionDiagnosticMarkdown(params: {
  sessionMeta?: ActiveSessionItem
  nodes: Node[]
}): string {
  const { sessionMeta, nodes } = params
  const title = sessionMeta?.title || '未命名会话'
  const sid = sessionMeta?.id || 'unknown'
  const project = sessionMeta?.project || '未标记工程'
  const actors =
    sessionMeta?.actors && sessionMeta.actors.length > 0
      ? sessionMeta.actors.join(', ')
      : '单 Agent 独立执行'
  const status = sessionMeta?.status || 'completed'

  // 统计各手势分布
  const gestureCounts: Record<string, number> = {}
  let failedCount = 0
  let hasGate = false
  let lastActionSummary = '无动作记录'

  for (const n of nodes) {
    const d = n.data as Record<string, unknown> | undefined
    const gesture = (d?.gesture as string) || 'think'
    gestureCounts[gesture] = (gestureCounts[gesture] || 0) + 1
    if (d?.status === 'failed') failedCount += 1
    if (d?.status === 'gate') hasGate = true
    if (d?.summary && typeof d.summary === 'string') {
      lastActionSummary = d.summary
    }
  }

  const breakdown = Object.entries(gestureCounts)
    .map(([g, count]) => `${g}: ${count}`)
    .join(', ')

  const lines = [
    '### 🛰️ NetDive 会话诊断现场',
    `- **会话名称**: ${title}`,
    `- **会话 ID**: \`${sid}\``,
    `- **所属工程**: \`${project}\``,
    `- **协同主体**: ${actors}`,
    `- **当前状态**: \`${status}\`${failedCount > 0 ? ` (⚠️ ${failedCount} 处断言异常)` : ''}${hasGate ? ' (🛑 门禁待审)' : ''}`,
    `- **节点拓扑**: 共 ${nodes.length} 步 (${breakdown || '无步骤'})`,
    `- **最新动作摘要**: ${lastActionSummary.slice(0, 120)}`,
  ]

  return lines.join('\n')
}

/**
 * 复制整个会话诊断上下文到剪贴板核心逻辑
 */
export async function copySessionDiagnosticToClipboard(params: {
  sessionMeta?: ActiveSessionItem
  nodes: Node[]
  clipboard?: { writeText: (text: string) => Promise<void> }
}): Promise<{ success: boolean; text: string }> {
  const text = formatSessionDiagnosticMarkdown(params)

  const targetClipboard =
    params.clipboard ?? (typeof navigator !== 'undefined' ? navigator.clipboard : undefined)
  if (targetClipboard?.writeText) {
    try {
      await targetClipboard.writeText(text)
      return { success: true, text }
    } catch {
      // 降级进入 fallback
    }
  }

  if (typeof document !== 'undefined') {
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      const succeeded = document.execCommand('copy')
      document.body.removeChild(textarea)
      return { success: succeeded, text }
    } catch {
      return { success: false, text }
    }
  }

  return { success: false, text }
}



