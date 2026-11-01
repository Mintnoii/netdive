import type {
  AssertionResult,
  TelemetryEvent,
  TelemetryGesture,
  TelemetryObservation,
  TelemetryStatus,
} from '../types/telemetry'
import { normalizeObservationOutput } from '../types/telemetry'

export type { AssertionResult }

/**
 * 工具调用执行上下文契约 (Tool Execution Context)
 */
export interface ToolExecutionContext {
  tool?: string
  command?: string
  gesture?: TelemetryGesture
  observation?: TelemetryObservation
  payload?: Record<string, unknown>
  exitCode?: number
  output?: string | string[]
  traceId?: string
  nodeId?: string
  title?: string
  status?: TelemetryStatus
  failureCount?: number
  schemaValidator?: (data: unknown) => boolean
}

/** 高危命令检测正则模式表 */
export const HIGH_RISK_COMMAND_PATTERNS: RegExp[] = [
  /\bgit\s+(commit|push|reset\s+--hard|clean\s+-[a-zA-Z]*f)/i,
  /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f\b/i,
  /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r\b/i,
  /\brm\s+-[a-zA-Z]*r\b/i,
  /\brmdir\s+\/s/i,
  /\bdel\s+\/[a-zA-Z0-9\s]*\b/i,
  /\b(drop|truncate)\s+(table|database|schema)\b/i,
  /\bdelete\s+from\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bchmod\s+(-R\s+)?777\b/i,
  /\bkubectl\s+delete\b/i,
  /\bdocker\s+(system\s+prune|rm\s+-f)/i,
]

/** AST 语法树异常模式表 */
export const AST_ERROR_PATTERNS: RegExp[] = [
  /\bSyntaxError:/i,
  /\bParseError:/i,
  /\bUnexpected token\b/i,
  /\bIndentationError:/i,
  /\bReferenceError:/i,
  /\bTypeError:\s+.*is not a function/i,
  /\b(ast\s*error|parsing failed|unrecognized token)\b/i,
]

/** 超时与死锁异常模式表 */
export const TIMEOUT_DEADLOCK_PATTERNS: RegExp[] = [
  /\b(etimedout|esockettimedout)\b/i,
  /\b(timed?\s*out|timeout(?:\s*error)?|command timed out)\b/i,
  /\b(deadlock(?:\s*detected)?|resource deadlock avoided)\b/i,
]

/** Schema 契约校验异常模式表 */
export const SCHEMA_ERROR_PATTERNS: RegExp[] = [
  /\b(schemavalidationerror|schema\s*error)\b/i,
  /\b(validation\s*error|invalid\s*schema)\b/i,
  /\b(json\s*parse\s*error|unexpected token < in json)\b/i,
]

/**
 * 提取并检测高危命令模式 (Rule 3)
 */
export function matchHighRiskCommand(command: string): { matched: boolean; pattern?: string } {
  if (!command || typeof command !== 'string') return { matched: false }
  const trimmed = command.trim()

  for (const pattern of HIGH_RISK_COMMAND_PATTERNS) {
    const match = trimmed.match(pattern)
    if (match) {
      return { matched: true, pattern: match[0] }
    }
  }

  // 兜底直接关键词检测
  const lower = trimmed.toLowerCase()
  if (lower.includes('git commit') || lower.includes('git push')) {
    return { matched: true, pattern: 'git commit/push' }
  }
  if (lower.includes('rm -rf') || lower.includes('rm -r')) {
    return { matched: true, pattern: 'rm -rf' }
  }
  if (lower.includes('drop table') || lower.includes('drop database')) {
    return { matched: true, pattern: 'drop table' }
  }
  if (lower.includes('truncate table')) {
    return { matched: true, pattern: 'truncate table' }
  }

  return { matched: false }
}

/**
 * 检测输出中是否存在 AST 语法树异常
 */
export function detectAstError(outputLines: string[]): string | null {
  for (const line of outputLines) {
    for (const pattern of AST_ERROR_PATTERNS) {
      const match = line.match(pattern)
      if (match) {
        return line.trim()
      }
    }
  }
  return null
}

/**
 * 检测输出中是否存在超时或死锁异常
 */
export function detectTimeoutOrDeadlock(outputLines: string[], exitCode?: number): string | null {
  // exitCode 124 (GNU timeout) or 143 (SIGTERM timeout)
  if (exitCode === 124 || exitCode === 143) {
    return `Process terminated by timeout (exit code ${exitCode})`
  }

  for (const line of outputLines) {
    for (const pattern of TIMEOUT_DEADLOCK_PATTERNS) {
      const match = line.match(pattern)
      if (match) {
        return line.trim()
      }
    }
  }
  return null
}

/**
 * 检测输出或 Payload 中是否存在 Schema 校验异常
 */
export function detectSchemaError(
  outputLines: string[],
  payload?: Record<string, unknown>,
  validator?: (data: unknown) => boolean
): string | null {
  if (validator && payload) {
    try {
      const valid = validator(payload)
      if (!valid) return 'Payload failed custom schema validator contract'
    } catch (err) {
      return `Payload schema validation exception: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  for (const line of outputLines) {
    for (const pattern of SCHEMA_ERROR_PATTERNS) {
      const match = line.match(pattern)
      if (match) {
        return line.trim()
      }
    }
  }
  return null
}

/**
 * 计算确定性失败指纹 (Deterministic Failure Signature)
 * 供 Rule 2 判定重复失败与致命共振
 */
export function computeFailureSignature(context: ToolExecutionContext): string {
  const target =
    context.command ||
    context.tool ||
    context.title ||
    context.gesture ||
    context.nodeId ||
    'tool_execution'

  const exitCode =
    context.exitCode !== undefined
      ? context.exitCode
      : context.observation?.exitCode !== undefined
        ? context.observation.exitCode
        : -1

  const outputLines = context.output !== undefined
    ? normalizeObservationOutput(context.output)
    : normalizeObservationOutput(context.observation?.output)

  // 提取首个或关键错误信息行
  const keyError =
    outputLines
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .slice(0, 2)
      .join(' | ') || 'exit_error'

  return `${target}::exit_${exitCode}::${keyError}`
}

export interface AssertionEngineOptions {
  maxFailuresBeforeResonance?: number
}

/**
 * L1 确定性断言引擎 (L1 Deterministic Assertion Engine)
 *
 * 核心法则：
 * - Rule 1: Non-zero exit code (exitCode !== 0) -> triggers Self-Correction branching immediately.
 * - Rule 2: Repetitive failure loop detector: If identical failure is caught >= 2 times,
 *           flags 'Fatal Failure Resonance' and forces emergency gate interception rather than futile self-reflection.
 * - Rule 3: High-risk command pattern assertion (e.g. 'git commit', 'rm -rf', 'drop table') ->
 *           automatically asserts need for Human Gate interception.
 */
export class AssertionEngine {
  private failureHistory = new Map<string, number>()
  private maxFailuresBeforeResonance: number

  constructor(options: AssertionEngineOptions = {}) {
    this.maxFailuresBeforeResonance = options.maxFailuresBeforeResonance ?? 2
  }

  /**
   * 重置失败共振历史统计
   */
  clearHistory(): void {
    this.failureHistory.clear()
  }

  /**
   * 重置引擎状态
   */
  reset(): void {
    this.clearHistory()
  }

  /**
   * 获取指定指纹或执行上下文的累积失败次数
   */
  getFailureCount(signatureOrContext: string | ToolExecutionContext): number {
    const signature =
      typeof signatureOrContext === 'string'
        ? signatureOrContext
        : computeFailureSignature(signatureOrContext)
    return this.failureHistory.get(signature) || 0
  }

  /**
   * 判定输入命令是否命中高危命令模式 (Rule 3)
   */
  isHighRiskCommand(command: string): boolean {
    return matchHighRiskCommand(command).matched
  }

  /**
   * 核心断言求值主入口 (支持 ToolExecutionContext 或 TelemetryEvent)
   */
  evaluate(input: ToolExecutionContext | TelemetryEvent): AssertionResult {
    const context = this.normalizeInput(input)

    // -------------------------------------------------------------------------
    // Rule 3: 高危命令模式断言 (High-Risk Command Pattern Assertion)
    // -------------------------------------------------------------------------
    const commandToCheck =
      context.command ||
      (typeof context.payload?.command === 'string' ? context.payload.command : undefined) ||
      (typeof context.payload?.proposedAction === 'object' &&
      context.payload?.proposedAction !== null &&
      'command' in context.payload.proposedAction
        ? String((context.payload.proposedAction as { command?: unknown }).command || '')
        : undefined) ||
      (context.gesture === 'bash' ? context.title : undefined)

    if (commandToCheck) {
      const { matched, pattern } = matchHighRiskCommand(commandToCheck)
      if (matched) {
        return {
          passed: false,
          triggerSelfCorrection: false,
          triggerGate: true,
          severity: 'critical',
          reason: `High-risk command pattern assertion triggered: "${pattern}". Human Gate interception required.`,
          rule: 'high_risk_gate',
          failureCount: 0,
        }
      }
    }

    // 提取执行状态与观测数据
    const exitCode =
      context.exitCode !== undefined
        ? context.exitCode
        : context.observation?.exitCode

    const outputLines: string[] = context.output !== undefined
      ? normalizeObservationOutput(context.output)
      : normalizeObservationOutput(context.observation?.output)

    // 语法树 AST 异常检测
    const astError = detectAstError(outputLines)

    // 超时与死锁异常检测
    const timeoutOrDeadlock = detectTimeoutOrDeadlock(outputLines, exitCode)

    // Schema 契约校验异常检测
    const schemaError = detectSchemaError(outputLines, context.payload, context.schemaValidator)

    // 判定是否存在异常失败
    const hasExitFailure = exitCode !== undefined && exitCode !== 0
    const hasFailure =
      hasExitFailure ||
      Boolean(astError) ||
      Boolean(timeoutOrDeadlock) ||
      Boolean(schemaError) ||
      context.status === 'failed'

    if (hasFailure) {
      // 计算确定性失败指纹
      const signature = computeFailureSignature(context)
      const currentCount = (this.failureHistory.get(signature) || 0) + 1
      this.failureHistory.set(signature, currentCount)

      // -----------------------------------------------------------------------
      // Rule 2: 重复失败死循环共振检测 (Repetitive Failure Loop Detector)
      // 若相同失败发生 >= 2 次，标记 'Fatal Failure Resonance' 并强制紧急门禁拦截
      // -----------------------------------------------------------------------
      if (currentCount >= this.maxFailuresBeforeResonance) {
        return {
          passed: false,
          triggerSelfCorrection: false,
          triggerGate: true,
          severity: 'critical',
          reason: `Fatal Failure Resonance: Identical failure caught ${currentCount} times ("${signature}"). Forcing emergency gate interception.`,
          rule: 'resonance_loop',
          failureCount: currentCount,
        }
      }

      // 超时/死锁异常分叉优先判定 (如 exitCode 124/143 或 ETIMEDOUT)
      if (timeoutOrDeadlock) {
        return {
          passed: false,
          triggerSelfCorrection: true,
          triggerGate: false,
          severity: 'warn',
          reason: `Timeout or deadlock detected: "${timeoutOrDeadlock}". Triggering self-correction branching immediately.`,
          rule: 'timeout_deadlock',
          failureCount: currentCount,
        }
      }

      // AST 语法树异常分叉
      if (astError) {
        return {
          passed: false,
          triggerSelfCorrection: true,
          triggerGate: false,
          severity: 'warn',
          reason: `AST error pattern detected: "${astError}". Triggering self-correction branching immediately.`,
          rule: 'ast_error',
          failureCount: currentCount,
        }
      }

      // Schema 异常分叉
      if (schemaError) {
        return {
          passed: false,
          triggerSelfCorrection: true,
          triggerGate: false,
          severity: 'warn',
          reason: `Schema validity error: "${schemaError}". Triggering self-correction branching immediately.`,
          rule: 'schema_invalid',
          failureCount: currentCount,
        }
      }

      // -----------------------------------------------------------------------
      // Rule 1: 非零 Exit Code -> 触发立即自愈分叉 (Self-Correction Branching)
      // -----------------------------------------------------------------------
      if (hasExitFailure) {
        return {
          passed: false,
          triggerSelfCorrection: true,
          triggerGate: false,
          severity: 'warn',
          reason: `Non-zero exit code (${exitCode}) detected. Triggering self-correction branching immediately.`,
          rule: 'exit_code',
          failureCount: currentCount,
        }
      }

      // 其它标记为 failed 的失败分叉
      return {
        passed: false,
        triggerSelfCorrection: true,
        triggerGate: false,
        severity: 'warn',
        reason: 'Tool execution marked as failed. Triggering self-correction branching.',
        rule: 'exit_code',
        failureCount: currentCount,
      }
    }

    // -------------------------------------------------------------------------
    // 正常通过断言 (Clean Passed)
    // -------------------------------------------------------------------------
    return {
      passed: true,
      triggerSelfCorrection: false,
      triggerGate: false,
      severity: 'info',
      reason: 'Execution passed all L1 deterministic assertions.',
      rule: 'passed',
      failureCount: 0,
    }
  }

  /**
   * 将不同来源的输入统一规约为 ToolExecutionContext
   */
  private normalizeInput(input: ToolExecutionContext | TelemetryEvent): ToolExecutionContext {
    if ('type' in input) {
      const event = input as TelemetryEvent
      const command =
        (typeof event.payload?.command === 'string' ? event.payload.command : undefined) ||
        event.gatePayload?.proposedAction?.command ||
        (typeof event.payload?.proposedAction === 'object' &&
        event.payload?.proposedAction !== null &&
        'command' in event.payload.proposedAction
          ? String((event.payload.proposedAction as { command?: unknown }).command || '')
          : undefined) ||
        event.title

      return {
        tool: event.gesture,
        command,
        gesture: event.gesture,
        observation: event.observation,
        payload: event.payload,
        exitCode: event.observation?.exitCode,
        output: event.observation?.output,
        traceId: event.traceId,
        nodeId: event.nodeId,
        title: event.title,
        status: event.status,
      }
    }

    return input
  }
}

/** 全局单例 L1 确定性断言引擎 */
export const assertionEngine = new AssertionEngine()
