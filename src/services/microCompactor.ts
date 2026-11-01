import type { TelemetryObservation } from '../types/telemetry'
import { normalizeObservationOutput } from '../types/telemetry'

/**
 * Write-Ahead Log (WAL) 离线指针记录条目契约
 */
export interface WalRecord {
  pointerId: string
  toolCallId?: string
  toolName?: string
  rawOutput: string
  originalLines: number
  originalChars: number
  compactedOutput: string
  compactedLines: number
  compactedChars: number
  exitCode?: number
  compactSummary: string
  timestamp: number
  metadata?: Record<string, unknown>
}

/**
 * 上下文轻量保留的指针契约 (Context keeps { pointerId, exitCode, compactSummary })
 */
export interface CompactPointerContext {
  pointerId: string
  exitCode?: number
  compactSummary: string
  toolCallId?: string
}

/**
 * 微压缩输出结果契约
 */
export interface MicroCompactResult {
  compacted: boolean
  output: string
  pointerContext?: CompactPointerContext
  pointerId?: string
  exitCode?: number
  compactSummary: string
  originalLines: number
  originalChars: number
  compactedLines: number
  compactedChars: number
  reclaimedChars: number
}

/**
 * 协议配对校验错误与结果契约
 */
export interface PairingValidationResult {
  valid: boolean
  errors: string[]
  pairedCount: number
  unmatchedToolCalls: string[]
  unmatchedToolResults: string[]
}

/**
 * 工具调用块结构 (兼容 Anthropic Messages API 及 OpenAI Function Call)
 */
export interface ToolCallEnvelope {
  id: string
  type?: string
  name?: string
  function?: {
    name: string
    arguments: string
  }
  input?: Record<string, unknown> | string
}

/**
 * 工具结果块结构
 */
export interface ToolResultEnvelope {
  tool_call_id?: string
  tool_use_id?: string
  id?: string
  type?: string
  role?: string
  content?: string | unknown
  exitCode?: number
  is_error?: boolean
  pointerContext?: CompactPointerContext
}

/**
 * 统一多轮对话消息结构契约
 */
export interface ConversationMessage {
  role?: 'system' | 'user' | 'assistant' | 'tool'
  type?: string
  content?: string | unknown[] | Record<string, unknown> | null
  tool_calls?: ToolCallEnvelope[]
  tool_call_id?: string
  tool_use_id?: string
  id?: string
  name?: string
}

/**
 * Prompt Cache 前缀边界契约 (保证 System Prompt 与 LTM 边界字节级不可变)
 */
export interface CachePrefixBoundary {
  systemPrompt: string
  ltm: string
  prefixHash: string
  rawCanonical: string
  timestamp: number
}

/**
 * 微压缩引擎配置选项
 */
export interface MicroCompactorOptions {
  maxLinesThreshold?: number // 默认 40 行
  maxCharsThreshold?: number // 默认 1500 字符
  headLinesCount?: number // 默认 15 行
  tailLinesCount?: number // 默认 15 行
  pointerPrefix?: string // 默认 'wal-call-'
}

/** 默认常量配置 */
export const DEFAULT_MAX_LINES_THRESHOLD = 40
export const DEFAULT_MAX_CHARS_THRESHOLD = 1500
export const DEFAULT_HEAD_LINES = 15
export const DEFAULT_TAIL_LINES = 15
export const DEFAULT_POINTER_PREFIX = 'wal-call-'

/**
 * 格式化折叠占位标记 (Rule 1)
 */
export function formatCompactFoldMarker(omittedCount: number): string {
  return `[... 原始输出已折叠 ${omittedCount} 行，保留前置入参及尾部退出判定 ...]`
}

/**
 * 确定性 64 位十六进制哈希计算 (纯函数，零外部依赖，浏览器与 Node 环境 100% 兼容)
 */
export function computePrefixHash(content: string): string {
  let h1 = 0xdeadbeef ^ content.length
  let h2 = 0x41c6ce57 ^ content.length
  let h3 = 0x811c9dc5 ^ content.length
  let h4 = 0x9e3779b9 ^ content.length

  for (let i = 0; i < content.length; i++) {
    const ch = content.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
    h3 = Math.imul(h3 ^ ch, 2166136261)
    h4 = Math.imul(h4 ^ ch, 3141592653)
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h3 ^ (h3 >>> 13), 3266489909)
  h3 = Math.imul(h3 ^ (h3 >>> 16), 2246822507) ^ Math.imul(h4 ^ (h4 >>> 13), 3266489909)
  h4 = Math.imul(h4 ^ (h4 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)

  const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, '0')
  return `${toHex(h1)}${toHex(h2)}${toHex(h3)}${toHex(h4)}${toHex(h1 ^ h3)}${toHex(h2 ^ h4)}${toHex(h1 + h4)}${toHex(h2 + h3)}`.toLowerCase()
}

/**
 * 协议配对校验异常类
 */
export class ProtocolPairingError extends Error {
  readonly validationResult: PairingValidationResult

  constructor(message: string, validationResult: PairingValidationResult) {
    super(message)
    this.name = 'ProtocolPairingError'
    this.validationResult = validationResult
  }
}

/**
 * Prompt Cache 前缀突变异常类
 */
export class PrefixMutationError extends Error {
  readonly diffDetails?: string

  constructor(message: string, diffDetails?: string) {
    super(message)
    this.name = 'PrefixMutationError'
    this.diffDetails = diffDetails
  }
}

/**
 * 统一步进工具输出为规约化的纯行集合与源文本元数据
 * 一次解析，源头治理，彻底消灭下游函数反复多次 Array.isArray 样板
 */
function resolveOutputPayload(output: string | string[]): {
  lines: string[]
  rawText: string
  totalLines: number
  totalChars: number
} {
  if (Array.isArray(output)) {
    const rawText = output.join('\n')
    return {
      lines: output,
      rawText,
      totalLines: output.length,
      totalChars: rawText.length,
    }
  }

  const rawText = typeof output === 'string' ? output : String(output ?? '')
  const lines = rawText.includes('\n') ? rawText.split('\n') : [rawText]
  return {
    lines,
    rawText,
    totalLines: lines.length,
    totalChars: rawText.length,
  }
}

/**
 * 检测输出是否满足微压缩触发条件 (Rule 1)
 * 条件：行数 > 40 行 或 字符数 > 1500 字符
 */
export function isCompactionNeeded(
  output: string | string[],
  options: MicroCompactorOptions = {}
): boolean {
  const maxLines = options.maxLinesThreshold ?? DEFAULT_MAX_LINES_THRESHOLD
  const maxChars = options.maxCharsThreshold ?? DEFAULT_MAX_CHARS_THRESHOLD
  const { totalLines, totalChars } = resolveOutputPayload(output)
  return totalLines > maxLines || totalChars > maxChars
}

/**
 * 统一标准化行列表 (支持针对超长单行进行合理分行，便于保留头部与尾部上下文)
 */
function normalizeOutputToLines(payload: { lines: string[]; totalChars: number }): string[] {
  const { lines, totalChars } = payload

  // 若总行数 <= 30 但总字符数 > 1500，按保证产生 > 30 行的步长对超长行分块，确保有效折叠
  if (lines.length <= 30 && totalChars > DEFAULT_MAX_CHARS_THRESHOLD) {
    const chunkSize = Math.min(50, Math.max(10, Math.floor(totalChars / 32)))
    return lines.flatMap((line) => {
      if (line.length <= chunkSize) return [line]
      const chunks: string[] = []
      for (let i = 0; i < line.length; i += chunkSize) {
        chunks.push(line.slice(i, i + chunkSize))
      }
      return chunks
    })
  }

  return lines
}

/**
 * 针对工具输出执行本地确定性微压缩 (Rule 1 核心算法，纯函数，零模型调用)
 */
export function compactToolLines(
  output: string | string[],
  options: MicroCompactorOptions = {}
): {
  compacted: boolean
  compactedText: string
  originalLines: number
  originalChars: number
  compactedLines: number
  compactedChars: number
  foldedLinesCount: number
} {
  const payload = resolveOutputPayload(output)
  const lines = normalizeOutputToLines(payload)
  const originalLines = lines.length
  const originalChars = payload.totalChars

  const maxLines = options.maxLinesThreshold ?? DEFAULT_MAX_LINES_THRESHOLD
  const maxChars = options.maxCharsThreshold ?? DEFAULT_MAX_CHARS_THRESHOLD
  const headCount = options.headLinesCount ?? DEFAULT_HEAD_LINES
  const tailCount = options.tailLinesCount ?? DEFAULT_TAIL_LINES
  const minLinesToFold = headCount + tailCount

  const needsCompaction = originalLines > maxLines || originalChars > maxChars

  if (!needsCompaction || originalLines <= minLinesToFold) {
    return {
      compacted: false,
      compactedText: payload.rawText,
      originalLines,
      originalChars,
      compactedLines: originalLines,
      compactedChars: originalChars,
      foldedLinesCount: 0,
    }
  }

  const headLines = lines.slice(0, headCount)
  const tailLines = lines.slice(-tailCount)
  const foldedLinesCount = originalLines - minLinesToFold
  const foldMarker = formatCompactFoldMarker(foldedLinesCount)

  const compactedText = [...headLines, foldMarker, ...tailLines].join('\n')
  const compactedLines = headCount + 1 + tailCount
  const compactedChars = compactedText.length

  return {
    compacted: true,
    compactedText,
    originalLines,
    originalChars,
    compactedLines,
    compactedChars,
    foldedLinesCount,
  }
}

/**
 * 微压缩引擎核心服务 (MicroCompactor Engine)
 *
 * 核心法则：
 * - Rule 1: Local Deterministic Micro-Compaction (Zero Model Calls)
 *   工具输出行数 > 40 或字符数 > 1500 时，保留 Head 15 行 + Tail 15 行，
 *   插入 '[... 原始输出已折叠 %d 行，保留前置入参及尾部退出判定 ...]'，节省 80-90% token 且无 LLM 开销。
 * - Rule 2: Protocol Pairing Guard
 *   严格校验 tool_call_id 与工具回包信封契约，防止因丢弃或未配对导致 Anthropic/OpenAI HTTP 400 崩溃。
 * - Rule 3: Pointer-based Offline WAL Storage (Write-Ahead Log)
 *   压缩大输出时，将原始全量结果存入内存 WAL 注册表（如 'wal-call-12'），上下文仅保留轻量引用：
 *   { pointerId, exitCode, compactSummary }，支持随时回放与按 ID 检视。
 * - Rule 4: Prompt Cache Prefix Stability
 *   系统提示词 (System Prompt) 与长期记忆 (LTM) 绝对不可变，确保前缀序列化字节级一致，最大化 Prompt Cache 命中率。
 */
export class MicroCompactor {
  private walRegistry = new Map<string, WalRecord>()
  private counter = 0
  private options: Required<MicroCompactorOptions>

  constructor(options: MicroCompactorOptions = {}) {
    this.options = {
      maxLinesThreshold: options.maxLinesThreshold ?? DEFAULT_MAX_LINES_THRESHOLD,
      maxCharsThreshold: options.maxCharsThreshold ?? DEFAULT_MAX_CHARS_THRESHOLD,
      headLinesCount: options.headLinesCount ?? DEFAULT_HEAD_LINES,
      tailLinesCount: options.tailLinesCount ?? DEFAULT_TAIL_LINES,
      pointerPrefix: options.pointerPrefix ?? DEFAULT_POINTER_PREFIX,
    }
  }

  /**
   * 生成全局唯一自增指针 ID (Pointer ID)
   */
  generatePointerId(): string {
    this.counter++
    return `${this.options.pointerPrefix}${this.counter}`
  }

  /**
   * 清理 WAL 注册表与计数器
   */
  clearWal(): void {
    this.walRegistry.clear()
    this.counter = 0
  }

  /**
   * 获取指定指针 ID 对应的原始 WAL 记录
   */
  getWal(pointerId: string): WalRecord | undefined {
    return this.walRegistry.get(pointerId)
  }

  /**
   * 检查指定指针 ID 是否存在
   */
  hasWal(pointerId: string): boolean {
    return this.walRegistry.has(pointerId)
  }

  /**
   * 获取当前全部 WAL 记录清单
   */
  getAllWal(): WalRecord[] {
    return Array.from(this.walRegistry.values())
  }

  /**
   * 检索并回放原始完整输出 (Replay raw output by pointerId)
   */
  replay(pointerId: string): string | undefined {
    return this.walRegistry.get(pointerId)?.rawOutput
  }

  /**
   * 获取 WAL 统计指标 (全量字符、压缩字符、释放字符数)
   * 声明式集合归约 (Reduce)，消除命令式可变累加变量
   */
  getWalStats(): {
    totalEntries: number
    totalRawChars: number
    totalCompactedChars: number
    totalReclaimedChars: number
  } {
    const records = Array.from(this.walRegistry.values())
    const totalRawChars = records.reduce((acc, r) => acc + r.originalChars, 0)
    const totalCompactedChars = records.reduce((acc, r) => acc + r.compactedChars, 0)
    return {
      totalEntries: this.walRegistry.size,
      totalRawChars,
      totalCompactedChars,
      totalReclaimedChars: Math.max(0, totalRawChars - totalCompactedChars),
    }
  }

  // ---------------------------------------------------------------------------
  // Rule 1 & Rule 3: 执行本地微压缩并登记 WAL 指针
  // ---------------------------------------------------------------------------
  /**
   * 针对工具输出执行微压缩，并在触发折叠时自动登记 WAL 离线记录
   */
  compactToolOutput(
    output: string | string[],
    params: {
      pointerId?: string
      toolCallId?: string
      toolName?: string
      exitCode?: number
      summary?: string
      metadata?: Record<string, unknown>
    } = {}
  ): MicroCompactResult {
    const payload = resolveOutputPayload(output)
    const compaction = compactToolLines(output, this.options)

    const exitCode = params.exitCode
    const exitCodeSummary = exitCode !== undefined ? `, exit: ${exitCode}` : ''
    const fallbackSummary = compaction.compacted
      ? `输出已折叠 ${compaction.foldedLinesCount} 行 (保留首尾各 15 行${exitCodeSummary})`
      : params.summary || `工具执行完成${exitCodeSummary}`

    const compactSummary = params.summary || fallbackSummary

    if (!compaction.compacted) {
      return {
        compacted: false,
        output: payload.rawText,
        exitCode,
        compactSummary,
        originalLines: compaction.originalLines,
        originalChars: compaction.originalChars,
        compactedLines: compaction.originalLines,
        compactedChars: compaction.originalChars,
        reclaimedChars: 0,
      }
    }

    // 触发微压缩：生成 pointerId 并落盘到内存 WAL 注册表 (Rule 3)
    const pointerId = params.pointerId || this.generatePointerId()
    const rawText = payload.rawText
    const reclaimedChars = compaction.originalChars - compaction.compactedChars

    const walRecord: WalRecord = {
      pointerId,
      toolCallId: params.toolCallId,
      toolName: params.toolName,
      rawOutput: rawText,
      originalLines: compaction.originalLines,
      originalChars: compaction.originalChars,
      compactedOutput: compaction.compactedText,
      compactedLines: compaction.compactedLines,
      compactedChars: compaction.compactedChars,
      exitCode,
      compactSummary,
      timestamp: Date.now(),
      metadata: params.metadata,
    }

    this.walRegistry.set(pointerId, walRecord)

    const pointerContext: CompactPointerContext = {
      pointerId,
      exitCode,
      compactSummary,
      toolCallId: params.toolCallId,
    }

    return {
      compacted: true,
      output: compaction.compactedText,
      pointerContext,
      pointerId,
      exitCode,
      compactSummary,
      originalLines: compaction.originalLines,
      originalChars: compaction.originalChars,
      compactedLines: compaction.compactedLines,
      compactedChars: compaction.compactedChars,
      reclaimedChars,
    }
  }

  /**
   * 针对流式遥测 TelemetryObservation 进行紧凑压缩并注入 WAL 指针
   */
  compactObservation(
    observation: TelemetryObservation,
    context: {
      toolName?: string
      toolCallId?: string
      nodeId?: string
    } = {}
  ): TelemetryObservation & { pointerContext?: CompactPointerContext; output: string[] } {
    if (!observation) {
      return { exitCode: 0, output: [] }
    }

    const outputList = normalizeObservationOutput(observation.output)
    if (outputList.length === 0) {
      return {
        ...observation,
        output: outputList,
      }
    }

    if (!isCompactionNeeded(outputList, this.options)) {
      return {
        ...observation,
        output: outputList,
      }
    }

    const result = this.compactToolOutput(outputList, {
      toolCallId: context.toolCallId || (context.nodeId ? `call-${context.nodeId}` : undefined),
      toolName: context.toolName,
      exitCode: observation.exitCode,
    })

    if (!result.compacted) {
      return {
        ...observation,
        output: outputList,
      }
    }

    return {
      ...observation,
      exitCode: observation.exitCode ?? 0,
      output: result.output.split('\n'),
      pointerId: result.pointerId,
      compactSummary: result.compactSummary,
      pointerContext: result.pointerContext,
    }
  }

  // ---------------------------------------------------------------------------
  // Rule 2: Protocol Pairing Guard (协议配对守卫，防 HTTP 400)
  // ---------------------------------------------------------------------------
  /**
   * 校验多轮对话中的工具调用与工具结果配对完整性
   * 遵循 Anthropic Messages API 及 OpenAI Function Calling 契约
   */
  validatePairing(messages: ConversationMessage[]): PairingValidationResult {
    const errors: string[] = []
    const pendingToolCalls = new Map<string, { role: string; index: number; name?: string }>()
    const matchedToolCalls = new Set<string>()
    const unmatchedToolResults: string[] = []

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (!msg) continue

      // 1. 扫描 Assistant 或模型发出的 tool_calls / tool_use 块
      // OpenAI 格式: msg.tool_calls = [{ id, type: 'function', function: { name } }]
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          if (!tc.id) {
            errors.push(`Message[${i}]: tool_call is missing required 'id' attribute`)
          } else {
            pendingToolCalls.set(tc.id, {
              role: msg.role || 'assistant',
              index: i,
              name: tc.name || tc.function?.name,
            })
          }
        }
      }

      // Anthropic 格式: content 包含 { type: 'tool_use', id, name, input }
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (
            typeof block === 'object' &&
            block !== null &&
            'type' in block &&
            (block as { type: string }).type === 'tool_use'
          ) {
            const tu = block as { id?: string; name?: string }
            if (!tu.id) {
              errors.push(`Message[${i}]: tool_use block is missing required 'id' attribute`)
            } else {
              pendingToolCalls.set(tu.id, {
                role: msg.role || 'assistant',
                index: i,
                name: tu.name,
              })
            }
          }
        }
      }

      // 2. 扫描 Tool 角色或 User 消息中的 tool_result
      // OpenAI 格式: msg.role === 'tool' && msg.tool_call_id
      if (msg.role === 'tool') {
        const callId = msg.tool_call_id || msg.id
        if (!callId) {
          errors.push(
            `Message[${i}] (role 'tool'): missing required 'tool_call_id' field. Breaches API contract.`
          )
        } else {
          if (pendingToolCalls.has(callId)) {
            matchedToolCalls.add(callId)
            pendingToolCalls.delete(callId)
          } else if (matchedToolCalls.has(callId)) {
            errors.push(`Message[${i}]: duplicate tool result returned for tool_call_id '${callId}'`)
          } else {
            unmatchedToolResults.push(callId)
            errors.push(
              `Message[${i}] (role 'tool'): orphan tool_call_id '${callId}' without preceding tool_call declaration`
            )
          }
        }
      }

      // Anthropic 格式: msg.content 包含 { type: 'tool_result', tool_use_id }
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (
            typeof block === 'object' &&
            block !== null &&
            'type' in block &&
            (block as { type: string }).type === 'tool_result'
          ) {
            const tr = block as { tool_use_id?: string; content?: unknown }
            const tuId = tr.tool_use_id
            if (!tuId) {
              errors.push(
                `Message[${i}]: tool_result block is missing required 'tool_use_id' field. Breaches Anthropic contract.`
              )
            } else {
              if (pendingToolCalls.has(tuId)) {
                matchedToolCalls.add(tuId)
                pendingToolCalls.delete(tuId)
              } else if (matchedToolCalls.has(tuId)) {
                errors.push(`Message[${i}]: duplicate tool result returned for tool_use_id '${tuId}'`)
              } else {
                unmatchedToolResults.push(tuId)
                errors.push(
                  `Message[${i}]: orphan tool_result for tool_use_id '${tuId}' without preceding tool_use declaration`
                )
              }
            }
          }
        }
      }

      // 通用单个工具信封消息校验 (如 msg.tool_call_id || msg.tool_use_id)
      if (msg.role !== 'tool' && (msg.tool_call_id || msg.tool_use_id)) {
        const id = msg.tool_call_id || msg.tool_use_id
        if (id) {
          if (pendingToolCalls.has(id)) {
            matchedToolCalls.add(id)
            pendingToolCalls.delete(id)
          }
        }
      }
    }

    const unmatchedToolCalls = Array.from(pendingToolCalls.keys())
    if (unmatchedToolCalls.length > 0) {
      for (const callId of unmatchedToolCalls) {
        const item = pendingToolCalls.get(callId)
        errors.push(
          `Unmatched tool_call '${callId}' (tool: ${item?.name || 'unknown'} at message ${item?.index}) has no matching tool_result. Will trigger HTTP 400.`
        )
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      pairedCount: matchedToolCalls.size,
      unmatchedToolCalls,
      unmatchedToolResults,
    }
  }

  /**
   * 断言工具调用与工具结果协议配对，若违反契约立即抛出强类型异常
   */
  assertPairing(messages: ConversationMessage[]): void {
    const res = this.validatePairing(messages)
    if (!res.valid) {
      throw new ProtocolPairingError(
        `Protocol Pairing Guard violation: ${res.errors.join('; ')}`,
        res
      )
    }
  }

  /**
   * 确保工具回包信封结构完整性 (Preserve Envelope Contract)
   * 在微压缩内容的同时，强制保留 tool_call_id 与信封元数据，杜绝破坏上游协议
   */
  ensureToolEnvelope(
    envelope: ToolResultEnvelope,
    compactedContent: string,
    pointerContext?: CompactPointerContext
  ): ToolResultEnvelope {
    const callId = envelope.tool_call_id || envelope.tool_use_id || envelope.id
    if (!callId) {
      throw new Error(
        'Cannot wrap tool envelope: missing required tool_call_id or tool_use_id'
      )
    }

    return {
      ...envelope,
      tool_call_id: envelope.tool_call_id || callId,
      tool_use_id: envelope.tool_use_id || callId,
      content: compactedContent,
      pointerContext,
    }
  }

  // ---------------------------------------------------------------------------
  // Rule 4: Prompt Cache Prefix Stability (Prompt 缓存前缀字节级不可变)
  // ---------------------------------------------------------------------------
  /**
   * 建立 Prompt Cache 确定性不可变前缀边界
   * 将 System Prompt 与 LTM 边界进行规范化序列化并锁定哈希
   */
  createPrefixBoundary(systemPrompt: string, ltm: string | unknown): CachePrefixBoundary {
    const canonicalSystem = typeof systemPrompt === 'string' ? systemPrompt : String(systemPrompt || '')
    const canonicalLtm =
      typeof ltm === 'string'
        ? ltm
        : ltm !== undefined && ltm !== null
          ? JSON.stringify(ltm)
          : ''

    const rawCanonical = `[SYSTEM_PROMPT_BOUNDARY]\n${canonicalSystem}\n[LTM_BOUNDARY]\n${canonicalLtm}\n[CACHE_BREAKPOINT]`
    const prefixHash = computePrefixHash(rawCanonical)

    return {
      systemPrompt: canonicalSystem,
      ltm: canonicalLtm,
      prefixHash,
      rawCanonical,
      timestamp: Date.now(),
    }
  }

  /**
   * 校验 Prompt Cache 前缀稳定性 (字节级逐字符比对)
   */
  verifyPrefixStability(
    original: CachePrefixBoundary | string,
    candidate: CachePrefixBoundary | string
  ): { stable: boolean; diffDetails?: string } {
    const rawOriginal = typeof original === 'string' ? original : original.rawCanonical
    const rawCandidate = typeof candidate === 'string' ? candidate : candidate.rawCanonical

    if (rawOriginal === rawCandidate) {
      return { stable: true }
    }

    // 发现前缀突变：精确提取突变字符偏移与上下文片段
    let diffOffset = -1
    const minLen = Math.min(rawOriginal.length, rawCandidate.length)
    for (let i = 0; i < minLen; i++) {
      if (rawOriginal.charCodeAt(i) !== rawCandidate.charCodeAt(i)) {
        diffOffset = i
        break
      }
    }
    if (diffOffset === -1) {
      diffOffset = minLen
    }

    const snippetOriginal = rawOriginal.slice(Math.max(0, diffOffset - 15), diffOffset + 25)
    const snippetCandidate = rawCandidate.slice(Math.max(0, diffOffset - 15), diffOffset + 25)

    const diffDetails = `Byte mismatch at offset ${diffOffset}. Expected: "...${snippetOriginal}...", Actual: "...${snippetCandidate}..."`
    return { stable: false, diffDetails }
  }

  /**
   * 强制断言前缀绝对不可变，防止因意外篡改导致 Anthropic 缓存击穿
   */
  assertPrefixStability(
    original: CachePrefixBoundary | string,
    candidate: CachePrefixBoundary | string
  ): void {
    const res = this.verifyPrefixStability(original, candidate)
    if (!res.stable) {
      throw new PrefixMutationError(
        `Prompt Cache Prefix Stability violation! Mutating System Prompt or LTM will invalidate Anthropic prompt caching. ${res.diffDetails || ''}`,
        res.diffDetails
      )
    }
  }

  /**
   * 针对多轮会话执行前缀守卫式上下文压缩
   * 严格保护前缀边界不受任何修剪与改动，仅针对活动工具回包做局部微压缩
   */
  compactConversation(
    systemPrompt: string,
    ltm: string | unknown,
    turns: ConversationMessage[]
  ): {
    systemPrompt: string
    ltm: string
    turns: ConversationMessage[]
    prefixBoundary: CachePrefixBoundary
    prefixStable: boolean
    reclaimedChars: number
    walRecordsCreated: number
  } {
    const prefixBoundary = this.createPrefixBoundary(systemPrompt, ltm)
    let reclaimedChars = 0
    let walRecordsCreated = 0

    // 仅处理活跃轮次中的工具输出
    const compactedTurns: ConversationMessage[] = turns.map((turn) => {
      // 若当前轮次是工具回包 (role === 'tool' 或 content 中含有 tool_result)
      if (turn.role === 'tool' && typeof turn.content === 'string') {
        if (isCompactionNeeded(turn.content, this.options)) {
          const res = this.compactToolOutput(turn.content, {
            toolCallId: turn.tool_call_id || turn.id,
          })
          if (res.compacted) {
            reclaimedChars += res.reclaimedChars
            walRecordsCreated++
            return {
              ...turn,
              content: res.output,
            }
          }
        }
      }

      // Anthropic content blocks 压缩
      if (Array.isArray(turn.content)) {
        let changed = false
        const nextContent = turn.content.map((block) => {
          if (
            typeof block === 'object' &&
            block !== null &&
            'type' in block &&
            (block as { type: string }).type === 'tool_result' &&
            typeof (block as { content?: unknown }).content === 'string'
          ) {
            const blockWithContent = block as unknown as { content: string; tool_use_id?: string }
            const raw = blockWithContent.content
            if (isCompactionNeeded(raw, this.options)) {
              const res = this.compactToolOutput(raw, {
                toolCallId: blockWithContent.tool_use_id,
              })
              if (res.compacted) {
                reclaimedChars += res.reclaimedChars
                walRecordsCreated++
                changed = true
                return {
                  ...block,
                  content: res.output,
                }
              }
            }
          }
          return block
        })

        if (changed) {
          return {
            ...turn,
            content: nextContent,
          }
        }
      }

      return turn
    })

    // 压缩完成后重新比对前缀，断言字节级绝对不可变
    const postBoundary = this.createPrefixBoundary(systemPrompt, ltm)
    this.assertPrefixStability(prefixBoundary, postBoundary)

    return {
      systemPrompt: prefixBoundary.systemPrompt,
      ltm: prefixBoundary.ltm,
      turns: compactedTurns,
      prefixBoundary,
      prefixStable: true,
      reclaimedChars,
      walRecordsCreated,
    }
  }
}

/** 全局单例 MicroCompactor 微压缩引擎 */
export const microCompactor = new MicroCompactor()
