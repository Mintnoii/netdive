/**
 * NetDive Transcript Parser Engine
 * 契约驱动的 Pi / Claude Code 会话历史 JSONL 解析引擎
 * 将本地或离线 JSONL 会话流水秒级规约为 NetDive 标准 TelemetryEvent[] 拓扑序列
 */

import { tryit, sift, unique } from 'radash'
import { basename } from 'pathe'
import type { Node, Edge } from '@xyflow/react'
import type {
  TelemetryActor,
  TelemetryEvent,
  TelemetryGesture,
  MacroTurnGroup,
  MacroTurnStatus,
  ContextWatermark,
  TurnTokenBreakdown,
  TurnCompoundNode,
  ContextPartKind,
  ContextItem,
  ContextPart,
  ContextPrompt,
} from '../types/telemetry'
export type {
  MacroTurnGroup,
  MacroTurnStatus,
  ContextWatermark,
  TurnTokenBreakdown,
  TurnCompoundNode,
  ContextPartKind,
  ContextItem,
  ContextPart,
  ContextPrompt,
}
import { normalizeObservationOutput } from '../types/telemetry'
import type { AgentNodeData } from '../components/AgentNode'
import { extractRealIntent } from './agentNodeLOD'
export { extractRealIntent } from './agentNodeLOD'
import { resolveContextWindow } from './modelWindows'

/** 解析后的会话元数据契约 */
export interface SessionMetadata {
  id: string
  sessionId?: string
  version?: number | string
  timestamp?: string
  cwd?: string
  cwdBase?: string
  modelId?: string
  provider?: string
  agentName?: string
  gitBranch?: string
  totalTurns: number
  totalTools: number
  format: 'pi' | 'claude' | 'generic'
}

/** 完整 Transcript 解析结果 */
export interface ParsedTranscript {
  session: SessionMetadata
  events: TelemetryEvent[]
  watermark?: ContextWatermark
}

/**
 * 扁平字典映射表：工程函数式查表法消除 50 行 if/else 级联
 */
const TOOL_GESTURE_MAP: Readonly<Record<string, TelemetryGesture>> = {
  bash: 'bash',
  exec: 'bash',
  command: 'bash',
  terminal: 'bash',
  sh: 'bash',
  edit: 'edit',
  write: 'edit',
  notebookedit: 'edit',
  patch: 'edit',
  apply_diff: 'edit',
  read: 'read',
  grep: 'read',
  glob: 'read',
  find: 'read',
  source_check: 'read',
  fetch_content: 'read',
  web_search: 'read',
  websearch: 'read',
  webfetch: 'read',
  gate: 'gate',
  askuserquestion: 'gate',
  approval: 'gate',
  confirm: 'gate',
  scratchpad: 'memory',
  honcho: 'memory',
}

/**
 * 将工具名称规约为 NetDive 标准手势类型
 * O(1) 字典查表直给，彻底消灭过程式分支
 *
 * @example
 * ```ts
 * mapToolNameToGesture('bash')       // => 'bash'
 * mapToolNameToGesture('write')      // => 'edit'
 * mapToolNameToGesture('grep')       // => 'read'
 * mapToolNameToGesture('memory_add') // => 'memory'
 * mapToolNameToGesture('unknown')    // => 'think'
 * ```
 */
export function mapToolNameToGesture(toolName?: string): TelemetryGesture {
  if (!toolName) return 'think'
  const name = toolName.toLowerCase()
  if (name.startsWith('memory')) return 'memory'
  return TOOL_GESTURE_MAP[name] ?? 'think'
}

/**
 * 依据工具名与入参生成精炼的标题 (Shape By Example)
 *
 * @example
 * ```ts
 * formatToolTitle('bash', { command: 'pnpm test' })             // => '$ pnpm test'
 * formatToolTitle('read', { path: 'src/types/telemetry.ts' })   // => 'read: telemetry.ts'
 * formatToolTitle('grep', { pattern: 'tryit' })                 // => 'rg "tryit"'
 * ```
 */
export function formatToolTitle(toolName: string, args?: Record<string, unknown>): string {
  const name = toolName.trim()
  if (!args) return `工具调用: ${name}`

  // Bash command
  if (typeof args.command === 'string' && args.command) {
    const cmd = args.command.trim().split('\n')[0]
    const shortCmd = cmd.length > 38 ? `${cmd.slice(0, 35)}...` : cmd
    return `$ ${shortCmd}`
  }

  // File read/edit/write
  const targetPath = (args.path || args.file_path || args.filePath) as string | undefined
  if (typeof targetPath === 'string' && targetPath) {
    const base = basename(targetPath)
    return `${name}: ${base}`
  }

  // Pattern search
  if (typeof args.pattern === 'string' && args.pattern) {
    return `rg "${args.pattern}"`
  }

  return `工具调用: ${name}`
}

/**
 * 将 sections 键名按规则映射至 ContextPartKind (键名小写匹配)
 */
function mapSectionKeyToPartKind(key: string): ContextPartKind {
  const k = key.toLowerCase()
  if (/^(systemprompt|preamble|rules|docs|addendum|guidelines|instructions|system|prompt)$/.test(k)) {
    return 'system'
  }
  if (/^(tools|tool)$/.test(k)) {
    return 'tools'
  }
  if (/^(skills|skill)$/.test(k)) {
    return 'skills'
  }
  if (/^(memory|agents|context|memoryfiles|claudemd)$/.test(k)) {
    return 'memory'
  }
  return 'system'
}

/**
 * 从事件 title 与工具入参中提取文件标识路径，取不到则降级为 title
 */
function extractFileIdentifier(title: string, toolArgs?: Record<string, unknown>): string {
  if (toolArgs) {
    const p = toolArgs.path ?? toolArgs.file_path ?? toolArgs.filePath ?? toolArgs.file
    if (typeof p === 'string' && p.trim()) {
      return p.trim()
    }
  }
  const trimmed = title.trim()
  const spaceIdx = trimmed.indexOf(' ')
  if (spaceIdx > 0 && spaceIdx < trimmed.length - 1) {
    return trimmed.slice(spaceIdx + 1).trim()
  }
  return trimmed
}

/**
 * 从文本块提取可读字符串
 */
function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== 'object') return ''
        const b = block as Record<string, unknown>
        if (typeof b.text === 'string') return b.text
        if (typeof b.content === 'string') return b.content
        if (typeof b.thinking === 'string') return b.thinking
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

/** 提取的原生使用量结构 */
export interface ExtractedUsage {
  input: number
  output: number
  cacheRead: number
  reasoning: number
  total: number
}

/**
 * 从 JSONL 记录或消息中提取真实 usage
 * 兼容 Pi 格式 (input, output, cacheRead, reasoning) 与 Claude Code 格式 (input_tokens, cache_read_input_tokens 等)
 */
export function extractUsageFromRecord(
  record: Record<string, unknown>,
  msg?: Record<string, unknown>
): ExtractedUsage | undefined {
  const usageObj =
    (msg?.usage as Record<string, unknown>) ||
    (record.usage as Record<string, unknown>) ||
    (msg?.token_usage as Record<string, unknown>) ||
    (record.token_usage as Record<string, unknown>)

  if (!usageObj || typeof usageObj !== 'object') {
    return undefined
  }

  const input =
    Number(
      usageObj.input ??
        usageObj.input_tokens ??
        usageObj.inputTokens ??
        usageObj.prompt_tokens ??
        usageObj.promptTokens ??
        0
    ) || 0

  const output =
    Number(
      usageObj.output ??
        usageObj.output_tokens ??
        usageObj.outputTokens ??
        usageObj.completion_tokens ??
        usageObj.completionTokens ??
        0
    ) || 0

  const cacheRead =
    Number(
      usageObj.cacheRead ??
        usageObj.cache_read ??
        usageObj.cacheReadTokens ??
        usageObj.cache_read_input_tokens ??
        usageObj.cacheReadInputTokens ??
        0
    ) || 0

  const reasoning =
    Number(
      usageObj.reasoning ??
        usageObj.reasoning_tokens ??
        usageObj.reasoningTokens ??
        usageObj.thinking_tokens ??
        usageObj.thinkingTokens ??
        0
    ) || 0

  const total =
    Number(
      usageObj.total ??
        usageObj.total_tokens ??
        usageObj.totalTokens ??
        (input + output)
    ) || (input + output)

  return { input, output, cacheRead, reasoning, total }
}

/** 解析器运行期内部状态上下文 */
interface ParserContext {
  session: SessionMetadata
  events: TelemetryEvent[]
  toolCallEventMap: Map<string, TelemetryEvent>
  idAliasMap: Map<string, string>
  lastEventId?: string
  turnCounter: number
  isPiSession: boolean
  isClaudeSession: boolean
  lastUsage?: ExtractedUsage
  systemTokens: number
  totalToolTokens: number
  systemText: string
  sectionsMap: Map<string, string>
  fileItems: Map<string, ContextItem>
  resultItems: Map<string, ContextItem>
  turnItems: ContextItem[]
  toolCallInfoMap: Map<
    string,
    {
      gesture: TelemetryGesture
      toolName: string
      fileIdentifier?: string
      currentTokens: number
    }
  >
}

/**
 * 提取系统提示词及 sections 的真实 Token 尺寸与分块
 */
function handleSystemMessage(record: Record<string, unknown>, ctx: ParserContext): boolean {
  // 扫描 sections 字段 (Pi 第一条消息或全局 sections)
  const sections = (record.sections || (record.message as Record<string, unknown> | undefined)?.sections) as unknown
  if (sections && typeof sections === 'object') {
    let sectionChars = 0
    if (Array.isArray(sections)) {
      for (let i = 0; i < sections.length; i++) {
        const s = sections[i]
        let key = `section-${i}`
        let valStr = ''
        if (typeof s === 'string') {
          valStr = s
        } else if (s && typeof s === 'object') {
          const obj = s as Record<string, unknown>
          if (typeof obj.name === 'string') key = obj.name
          else if (typeof obj.key === 'string') key = obj.key
          const content = obj.content ?? obj.text
          if (typeof content === 'string') valStr = content
          else valStr = JSON.stringify(s)
        }
        if (valStr) {
          sectionChars += valStr.length
          const existing = ctx.sectionsMap.get(key)
          ctx.sectionsMap.set(key, existing ? `${existing}\n${valStr}` : valStr)
        }
      }
    } else {
      for (const [key, val] of Object.entries(sections as Record<string, unknown>)) {
        let valStr = ''
        if (typeof val === 'string') {
          valStr = val
        } else if (val && typeof val === 'object') {
          valStr = JSON.stringify(val)
        }
        if (valStr) {
          sectionChars += valStr.length
          const existing = ctx.sectionsMap.get(key)
          ctx.sectionsMap.set(key, existing ? `${existing}\n${valStr}` : valStr)
        }
      }
    }
    if (sectionChars > 0) {
      ctx.systemTokens = Math.max(ctx.systemTokens, Math.ceil(sectionChars / 4))
    }
  }

  const isSystemType = record.type === 'system'
  const msg = record.message as Record<string, unknown> | undefined
  const isSystemRole = msg?.role === 'system' || record.role === 'system'

  if (isSystemType || isSystemRole) {
    const content = msg?.content ?? record.content ?? record.text ?? record.system
    const text = extractTextContent(content)
    if (text) {
      ctx.systemTokens = Math.max(ctx.systemTokens, Math.ceil(text.length / 4))
      ctx.systemText = ctx.systemText ? `${ctx.systemText}\n${text}` : text
    }
  }

  if (isSystemType || isSystemRole) {
    return true
  }

  return false
}

/**
 * 处理 Pi 会话头部及模型变更元数据
 */
function handlePiMetadata(record: Record<string, unknown>, ctx: ParserContext): boolean {
  if (record.type === 'session') {
    ctx.isPiSession = true
    ctx.session.format = 'pi'
    if (typeof record.id === 'string') ctx.session.id = record.id
    if (typeof record.version === 'number' || typeof record.version === 'string') {
      ctx.session.version = record.version
    }
    if (typeof record.timestamp === 'string') ctx.session.timestamp = record.timestamp
    if (typeof record.cwd === 'string') {
      ctx.session.cwd = record.cwd
      ctx.session.cwdBase = basename(record.cwd)
    }
    return true
  }

  if (record.type === 'model_change') {
    ctx.isPiSession = true
    ctx.session.format = 'pi'
    if (typeof record.provider === 'string') ctx.session.provider = record.provider
    if (typeof record.modelId === 'string') ctx.session.modelId = record.modelId
    return true
  }

  return false
}

/**
 * 处理 Claude Code 会话头部及附件元数据
 */
function handleClaudeMetadata(record: Record<string, unknown>, ctx: ParserContext): boolean {
  if (record.type === 'last-prompt' && typeof record.sessionId === 'string') {
    ctx.isClaudeSession = true
    ctx.session.format = 'claude'
    ctx.session.id = record.sessionId
    ctx.session.sessionId = record.sessionId
    return true
  }

  if (record.type === 'attachment') {
    ctx.isClaudeSession = true
    ctx.session.format = 'claude'
    if (typeof record.sessionId === 'string') ctx.session.sessionId = record.sessionId
    if (typeof record.cwd === 'string') {
      ctx.session.cwd = record.cwd
      ctx.session.cwdBase = basename(record.cwd)
    }
    if (typeof record.gitBranch === 'string') ctx.session.gitBranch = record.gitBranch
    if (typeof record.version === 'string') ctx.session.version = record.version
    return true
  }

  return false
}

/**
 * 处理 Pi 用户轮次消息
 */
function handlePiUserMessage(
  record: Record<string, unknown>,
  msg: Record<string, unknown>,
  msgId: string,
  parentMsgId: string | undefined,
  ctx: ParserContext
): void {
  ctx.turnCounter++
  let userText = extractTextContent(msg.content)

  // 若用户输入包含 URL 编码的中文路径（如 %E8%85%BE...），安全解码为可读文本
  if (/%[0-9a-fA-F]{2}/.test(userText)) {
    try {
      userText = decodeURIComponent(userText)
    } catch {
      userText = userText.replace(/(%[0-9a-fA-F]{2})+/g, (match) => {
        try {
          return decodeURIComponent(match)
        } catch {
          return match
        }
      })
    }
  }

  const event: TelemetryEvent = {
    traceId: ctx.session.id,
    nodeId: msgId,
    parentId: parentMsgId,
    type: 'node_complete',
    gesture: 'read',
    actor: 'Human Operator',
    title: '用户意图指令',
    status: 'completed',
    delta: userText,
    timestamp: typeof record.timestamp === 'string' ? new Date(record.timestamp).getTime() : Date.now(),
  }
  ctx.events.push(event)
  ctx.idAliasMap.set(msgId, msgId)
  ctx.lastEventId = msgId

  if (userText) {
    ctx.turnItems.push({
      tag: 'turn',
      name: String(ctx.turnCounter),
      tokens: Math.max(1, Math.ceil(userText.length / 4)),
      content: userText,
    })
  }
}

/**
 * 记录工具调用到 files 或 results part 集合
 */
function recordToolCallToPrompt(
  ctx: ParserContext,
  toolCallId: string,
  toolName: string,
  gesture: TelemetryGesture,
  title: string,
  toolArgs: Record<string, unknown>
): void {
  const isFile = gesture === 'read' || gesture === 'edit'
  const payloadText = JSON.stringify(toolArgs)
  const initialTokens = Math.max(1, Math.ceil(payloadText.length / 4))
  const fileIdentifier = isFile ? extractFileIdentifier(title, toolArgs) : undefined

  if (isFile && fileIdentifier) {
    const existing = ctx.fileItems.get(fileIdentifier)
    if (existing) {
      existing.n = (existing.n ?? 1) + 1
      existing.tokens += initialTokens
      existing.tag = gesture === 'read' ? 'read' : 'edit'
      existing.content = payloadText
    } else {
      ctx.fileItems.set(fileIdentifier, {
        tag: gesture === 'read' ? 'read' : 'edit',
        name: fileIdentifier,
        tokens: initialTokens,
        n: 1,
        content: payloadText,
      })
    }
  } else {
    const existing = ctx.resultItems.get(toolName)
    if (existing) {
      existing.n = (existing.n ?? 1) + 1
      existing.tokens += initialTokens
      existing.tag = 'result'
      existing.content = payloadText
    } else {
      ctx.resultItems.set(toolName, {
        tag: 'result',
        name: toolName,
        tokens: initialTokens,
        n: 1,
        content: payloadText,
      })
    }
  }

  ctx.toolCallInfoMap.set(toolCallId, {
    gesture,
    toolName,
    fileIdentifier,
    currentTokens: initialTokens,
  })
}

/**
 * 依据工具执行结果更新 files 或 results 中对应的 token 与最新观测内容
 */
function updateToolResultInPrompt(
  ctx: ParserContext,
  toolCallId: string,
  outputLines: string[]
): void {
  const toolInfo = ctx.toolCallInfoMap.get(toolCallId)
  if (!toolInfo) return

  const outputText = outputLines.join('\n')
  if (!outputText) return

  const newTokens = Math.max(1, Math.ceil(outputText.length / 4))
  const diff = newTokens - toolInfo.currentTokens
  toolInfo.currentTokens = newTokens

  if (toolInfo.fileIdentifier && ctx.fileItems.has(toolInfo.fileIdentifier)) {
    const item = ctx.fileItems.get(toolInfo.fileIdentifier)!
    item.tokens += diff
    item.content = outputText
  } else if (ctx.resultItems.has(toolInfo.toolName)) {
    const item = ctx.resultItems.get(toolInfo.toolName)!
    item.tokens += diff
    item.content = outputText
  }
}

/**
 * 处理 Pi 助手回复、思考及工具调用
 */
function handlePiAssistantMessage(
  record: Record<string, unknown>,
  msg: Record<string, unknown>,
  msgId: string,
  parentMsgId: string | undefined,
  ctx: ParserContext
): void {
  ctx.turnCounter++
  const content = msg.content
  if (!Array.isArray(content)) return

  const usage = extractUsageFromRecord(record, msg)
  if (usage) {
    ctx.lastUsage = usage
  }

  let stepParentId = parentMsgId
  const timestamp = typeof record.timestamp === 'string' ? new Date(record.timestamp).getTime() : Date.now()

  for (let i = 0; i < content.length; i++) {
    const block = content[i]
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>

    if (b.type === 'thinking' && typeof b.thinking === 'string') {
      const thinkNodeId = `${msgId}-think-${i}`
      const event: TelemetryEvent = {
        traceId: ctx.session.id,
        nodeId: thinkNodeId,
        parentId: stepParentId,
        type: 'node_complete',
        gesture: 'think',
        actor: (ctx.session.modelId || 'Pi (Coordinator)') as TelemetryActor,
        title: extractRealIntent(b.thinking, '目标规划与分解'),
        status: 'completed',
        delta: b.thinking,
        timestamp,
        usage: usage ? { ...usage } : undefined,
      }
      ctx.events.push(event)
      ctx.idAliasMap.set(msgId, thinkNodeId)
      stepParentId = thinkNodeId
      ctx.lastEventId = thinkNodeId
      continue
    }

    if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
      const textNodeId = `${msgId}-text-${i}`
      const event: TelemetryEvent = {
        traceId: ctx.session.id,
        nodeId: textNodeId,
        parentId: stepParentId,
        type: 'node_complete',
        gesture: 'think',
        actor: (ctx.session.modelId || 'Pi (Coordinator)') as TelemetryActor,
        title: extractRealIntent(b.text, '决策输出与复盘'),
        status: 'completed',
        delta: b.text,
        timestamp,
        usage: usage ? { ...usage } : undefined,
      }
      ctx.events.push(event)
      ctx.idAliasMap.set(msgId, textNodeId)
      stepParentId = textNodeId
      ctx.lastEventId = textNodeId

      ctx.turnItems.push({
        tag: 'turn',
        name: String(ctx.turnCounter),
        tokens: Math.max(1, Math.ceil(b.text.length / 4)),
        content: b.text,
      })
      continue
    }

    if (b.type === 'toolCall') {
      ctx.session.totalTools++
      const toolName = String(b.name || 'tool')
      const toolCallId = String(b.id || `${msgId}-tool-${i}`)
      const toolArgs = (b.arguments && typeof b.arguments === 'object' ? b.arguments : {}) as Record<string, unknown>
      const gesture = mapToolNameToGesture(toolName)
      const title = formatToolTitle(toolName, toolArgs)

      const event: TelemetryEvent = {
        traceId: ctx.session.id,
        nodeId: toolCallId,
        parentId: stepParentId,
        type: 'node_complete',
        gesture,
        actor: 'Claude 3.7 (Worker)',
        title,
        status: 'running',
        payload: toolArgs,
        delta: `调用 ${toolName}`,
        timestamp,
        usage: usage ? { ...usage } : undefined,
      }
      ctx.events.push(event)
      ctx.toolCallEventMap.set(toolCallId, event)
      ctx.idAliasMap.set(msgId, toolCallId)
      stepParentId = toolCallId
      ctx.lastEventId = toolCallId

      recordToolCallToPrompt(ctx, toolCallId, toolName, gesture, title, toolArgs)
    }
  }
}

/**
 * 处理 Pi 工具执行返回 (toolResult)
 */
function handlePiToolResult(
  record: Record<string, unknown>,
  msg: Record<string, unknown>,
  ctx: ParserContext
): void {
  const toolCallId = String(record.toolCallId || msg.toolCallId || '')
  const isError = Boolean(record.isError ?? msg.isError)
  const toolContent = msg.content ?? record.content
  const outputLines = normalizeObservationOutput(toolContent)
  const exitCode = isError ? 1 : 0

  const targetEvent = ctx.toolCallEventMap.get(toolCallId)
  if (targetEvent) {
    targetEvent.status = isError ? 'failed' : 'completed'
    targetEvent.isCorrectionBranch = isError

    const outputText = outputLines.join('\n')
    const payloadChars = targetEvent.payload ? JSON.stringify(targetEvent.payload).length : 0
    const totalChars = outputText.length + payloadChars
    const toolTokens = Math.max(1, Math.ceil(totalChars / 4))

    targetEvent.observation = {
      exitCode,
      output: outputLines,
      command: (targetEvent.payload?.command as string) || undefined,
      tokens: toolTokens,
      linesCount: outputLines.length,
      charsCount: totalChars,
    }
    if (targetEvent.payload) {
      targetEvent.payload.prunableTokens = toolTokens
      targetEvent.payload.linesCount = outputLines.length
    }
    ctx.totalToolTokens += toolTokens

    if (outputLines.length > 0) {
      targetEvent.delta = outputLines.slice(0, 3).join('\n')
    }
    if (typeof record.id === 'string') {
      ctx.idAliasMap.set(record.id, targetEvent.nodeId)
    }
    ctx.lastEventId = targetEvent.nodeId
  }

  updateToolResultInPrompt(ctx, toolCallId, outputLines)
}

/**
 * 处理 Pi 协议消息分发
 */
function handlePiMessage(record: Record<string, unknown>, ctx: ParserContext): boolean {
  if (record.type !== 'message' || !record.message || typeof record.message !== 'object') {
    return false
  }

  ctx.isPiSession = true
  ctx.session.format = 'pi'
  const msg = record.message as Record<string, unknown>
  const role = String(msg.role || '')
  const msgId = typeof record.id === 'string' ? record.id : `msg-${++ctx.turnCounter}`
  const rawParentMsgId = typeof record.parentId === 'string' ? record.parentId : ctx.lastEventId
  const parentMsgId = (rawParentMsgId && ctx.idAliasMap.get(rawParentMsgId)) || rawParentMsgId

  if (role === 'user') {
    handlePiUserMessage(record, msg, msgId, parentMsgId, ctx)
    return true
  }

  if (role === 'assistant') {
    handlePiAssistantMessage(record, msg, msgId, parentMsgId, ctx)
    return true
  }

  if (role === 'toolResult') {
    handlePiToolResult(record, msg, ctx)
    return true
  }

  return false
}

/**
 * 处理 Claude Code 用户轮次（包含 tool_result 回包或需求输入）
 */
function handleClaudeUserMessage(
  record: Record<string, unknown>,
  msg: Record<string, unknown>,
  uuid: string,
  parentUuid: string | undefined,
  ctx: ParserContext
): void {
  if (!Array.isArray(msg.content)) return

  const toolResultBlock = msg.content.find(
    (b) => b && typeof b === 'object' && (b as Record<string, unknown>).type === 'tool_result'
  ) as Record<string, unknown> | undefined

  if (toolResultBlock) {
    const toolCallId = String(toolResultBlock.tool_use_id || '')
    const isError = Boolean(toolResultBlock.is_error)
    const outputLines = normalizeObservationOutput(toolResultBlock.content)
    const exitCode = isError ? 1 : 0

    const targetEvent = ctx.toolCallEventMap.get(toolCallId)
    if (targetEvent) {
      targetEvent.status = isError ? 'failed' : 'completed'
      targetEvent.isCorrectionBranch = isError

      const outputText = outputLines.join('\n')
      const payloadChars = targetEvent.payload ? JSON.stringify(targetEvent.payload).length : 0
      const totalChars = outputText.length + payloadChars
      const toolTokens = Math.max(1, Math.ceil(totalChars / 4))

      targetEvent.observation = {
        exitCode,
        output: outputLines,
        command: (targetEvent.payload?.command as string) || undefined,
        tokens: toolTokens,
        linesCount: outputLines.length,
        charsCount: totalChars,
      }
      if (targetEvent.payload) {
        targetEvent.payload.prunableTokens = toolTokens
        targetEvent.payload.linesCount = outputLines.length
      }
      ctx.totalToolTokens += toolTokens

      if (outputLines.length > 0) {
        targetEvent.delta = outputLines.slice(0, 3).join('\n')
      }
      ctx.idAliasMap.set(uuid, targetEvent.nodeId)
      ctx.lastEventId = targetEvent.nodeId
    }

    updateToolResultInPrompt(ctx, toolCallId, outputLines)
    return
  }

  // 普通用户需求指令
  ctx.turnCounter++
  let userText = extractTextContent(msg.content)
  if (/%[0-9a-fA-F]{2}/.test(userText)) {
    try {
      userText = decodeURIComponent(userText)
    } catch {
      userText = userText.replace(/(%[0-9a-fA-F]{2})+/g, (match) => {
        try {
          return decodeURIComponent(match)
        } catch {
          return match
        }
      })
    }
  }

  const event: TelemetryEvent = {
    traceId: ctx.session.id,
    nodeId: uuid,
    parentId: parentUuid,
    type: 'node_complete',
    gesture: 'read',
    actor: 'Human Operator',
    title: '用户需求指令',
    status: 'completed',
    delta: userText,
    timestamp: typeof record.timestamp === 'string' ? new Date(record.timestamp).getTime() : Date.now(),
  }
  ctx.events.push(event)
  ctx.idAliasMap.set(uuid, uuid)
  ctx.lastEventId = uuid

  if (userText) {
    ctx.turnItems.push({
      tag: 'turn',
      name: String(ctx.turnCounter),
      tokens: Math.max(1, Math.ceil(userText.length / 4)),
      content: userText,
    })
  }
}

/**
 * 处理 Claude Code 助手回复与工具调用
 */
function handleClaudeAssistantMessage(
  record: Record<string, unknown>,
  msg: Record<string, unknown>,
  uuid: string,
  parentUuid: string | undefined,
  ctx: ParserContext
): void {
  if (!Array.isArray(msg.content)) return

  const usage = extractUsageFromRecord(record, msg)
  if (usage) {
    ctx.lastUsage = usage
  }

  ctx.turnCounter++
  let stepParentId = parentUuid
  const timestamp = typeof record.timestamp === 'string' ? new Date(record.timestamp).getTime() : Date.now()

  for (let i = 0; i < msg.content.length; i++) {
    const block = msg.content[i]
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>

    if (b.type === 'thinking' && typeof b.thinking === 'string') {
      const thinkNodeId = `${uuid}-think-${i}`
      const event: TelemetryEvent = {
        traceId: ctx.session.id,
        nodeId: thinkNodeId,
        parentId: stepParentId,
        type: 'node_complete',
        gesture: 'think',
        actor: 'Claude 3.7 (Worker)',
        title: extractRealIntent(b.thinking, '内部推演与反思'),
        status: 'completed',
        delta: b.thinking,
        timestamp,
        usage: usage ? { ...usage } : undefined,
      }
      ctx.events.push(event)
      ctx.idAliasMap.set(uuid, thinkNodeId)
      stepParentId = thinkNodeId
      ctx.lastEventId = thinkNodeId
      continue
    }

    if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
      const textNodeId = `${uuid}-text-${i}`
      const event: TelemetryEvent = {
        traceId: ctx.session.id,
        nodeId: textNodeId,
        parentId: stepParentId,
        type: 'node_complete',
        gesture: 'think',
        actor: 'Claude 3.7 (Worker)',
        title: extractRealIntent(b.text, '模型执行分析'),
        status: 'completed',
        delta: b.text,
        timestamp,
        usage: usage ? { ...usage } : undefined,
      }
      ctx.events.push(event)
      ctx.idAliasMap.set(uuid, textNodeId)
      stepParentId = textNodeId
      ctx.lastEventId = textNodeId

      ctx.turnItems.push({
        tag: 'turn',
        name: String(ctx.turnCounter),
        tokens: Math.max(1, Math.ceil(b.text.length / 4)),
        content: b.text,
      })
      continue
    }

    if (b.type === 'tool_use') {
      ctx.session.totalTools++
      const toolName = String(b.name || 'tool')
      const toolCallId = String(b.id || `${uuid}-tool-${i}`)
      const toolArgs = (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>
      const gesture = mapToolNameToGesture(toolName)
      const title = formatToolTitle(toolName, toolArgs)

      const event: TelemetryEvent = {
        traceId: ctx.session.id,
        nodeId: toolCallId,
        parentId: stepParentId,
        type: 'node_complete',
        gesture,
        actor: 'Claude 3.7 (Worker)',
        title,
        status: 'running',
        payload: toolArgs,
        delta: `执行 ${toolName}`,
        timestamp,
        usage: usage ? { ...usage } : undefined,
      }
      ctx.events.push(event)
      ctx.toolCallEventMap.set(toolCallId, event)
      ctx.idAliasMap.set(uuid, toolCallId)
      stepParentId = toolCallId
      ctx.lastEventId = toolCallId

      recordToolCallToPrompt(ctx, toolCallId, toolName, gesture, title, toolArgs)
    }
  }
}

/**
 * 处理 Claude Code 协议消息分发
 */
function handleClaudeMessage(record: Record<string, unknown>, ctx: ParserContext): boolean {
  if (record.type !== 'user' && record.type !== 'assistant') {
    return false
  }

  ctx.isClaudeSession = true
  ctx.session.format = 'claude'
  const msg = record.message as Record<string, unknown> | undefined
  if (!msg) return false

  const uuid = typeof record.uuid === 'string' ? record.uuid : `cl-${++ctx.turnCounter}`
  const rawParentUuid = typeof record.parentUuid === 'string' ? record.parentUuid : ctx.lastEventId
  const parentUuid = (rawParentUuid && ctx.idAliasMap.get(rawParentUuid)) || rawParentUuid

  if (record.type === 'user') {
    handleClaudeUserMessage(record, msg, uuid, parentUuid, ctx)
    return true
  }

  if (record.type === 'assistant') {
    handleClaudeAssistantMessage(record, msg, uuid, parentUuid, ctx)
    return true
  }

  return false
}

/**
 * 对单条已反序列化的会话 JSON 对象执行流式分发解析
 */
function processTranscriptRecord(record: Record<string, unknown>, ctx: ParserContext): void {
  // 1. 先验探测：若本身已是 NetDive TelemetryEvent 单条记录
  if (
    typeof record.nodeId === 'string' &&
    typeof record.type === 'string' &&
    typeof record.traceId === 'string'
  ) {
    ctx.events.push(record as unknown as TelemetryEvent)
    ctx.lastEventId = record.nodeId
    return
  }

  // 2. 系统提示词与 sections
  if (handleSystemMessage(record, ctx)) return

  // 3. Pi 会话及模型元数据
  if (handlePiMetadata(record, ctx)) return

  // 4. Claude Code 元数据
  if (handleClaudeMetadata(record, ctx)) return

  // 5. Pi 消息流
  if (handlePiMessage(record, ctx)) return

  // 6. Claude Code 消息流
  if (handleClaudeMessage(record, ctx)) return
}

/**
 * 终态收口：将所有仍处于 running 状态且未显式报错的工具调用标记为 completed
 */
function finalizeRunningEvents(events: TelemetryEvent[]): void {
  for (const event of events) {
    if (event.status === 'running') {
      event.status = 'completed'
      if (!event.observation) {
        event.observation = { exitCode: 0, output: [] }
      }
    }
  }
}

/**
 * 核心转换函数 1：解析 Pi / Claude JSONL 文本为标准 TelemetryEvent[] 拓扑序列 (Shape By Example)
 * 模块化拆解巨型过程式循环，消灭状态堆砌
 *
 * @example
 * ```ts
 * // [Input Shape - Raw JSONL]:
 * // {"type":"session","id":"sess-pi-001","cwd":"/repo"}
 * // {"type":"message","id":"msg-1","message":{"role":"user","content":"Run tests"}}
 * // {"type":"message","id":"msg-2","message":{"role":"assistant","content":[{"type":"toolCall","id":"call-1","name":"bash","arguments":{"command":"pnpm test"}}]}}
 *
 * const { session, events } = parseTranscript(jsonlText)
 *
 * // [Output Shape - ParsedTranscript]:
 * // session: { id: 'sess-pi-001', format: 'pi', totalTurns: 2, totalTools: 1, cwd: '/repo', cwdBase: 'repo' }
 * // events: [
 * //   { nodeId: 'msg-1', gesture: 'read', actor: 'Human Operator', title: '用户意图指令', delta: 'Run tests', status: 'completed' },
 * //   { nodeId: 'call-1', parentId: 'msg-1', gesture: 'bash', title: '$ pnpm test', status: 'completed' }
 * // ]
 * ```
 */
export function parseTranscript(jsonlText: string): ParsedTranscript {
  const lines = jsonlText.split(/\r?\n/)

  const ctx: ParserContext = {
    session: {
      id: `session-${Date.now()}`,
      totalTurns: 0,
      totalTools: 0,
      format: 'generic',
    },
    events: [],
    toolCallEventMap: new Map(),
    idAliasMap: new Map(),
    turnCounter: 0,
    isPiSession: false,
    isClaudeSession: false,
    systemTokens: 0,
    totalToolTokens: 0,
    systemText: '',
    sectionsMap: new Map(),
    fileItems: new Map(),
    resultItems: new Map(),
    turnItems: [],
    toolCallInfoMap: new Map(),
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) {
      continue
    }

    const [err, record] = tryit(JSON.parse)(line) as [Error | undefined, Record<string, unknown>]
    if (err || !record || typeof record !== 'object') {
      continue
    }

    processTranscriptRecord(record, ctx)
  }

  finalizeRunningEvents(ctx.events)

  ctx.session.totalTurns = ctx.turnCounter || ctx.events.length
  if (ctx.isPiSession) ctx.session.format = 'pi'
  else if (ctx.isClaudeSession) ctx.session.format = 'claude'

  // 构建全维上下文水位 ContextWatermark
  // 启发式粗估：JSONL 未记录 system 段时按 12k 兜底（非真实值）
  const systemPromptTokens = ctx.systemTokens > 0 ? ctx.systemTokens : 12000
  const toolOutputsTokens = ctx.totalToolTokens
  const cacheReadTokens = ctx.lastUsage?.cacheRead || 0
  const reasoningTokens = ctx.lastUsage?.reasoning || 0

  let totalTokens = 0
  let activeTurnsTokens = 0
  let convHistoryTokens = 0

  if (ctx.lastUsage) {
    totalTokens = ctx.lastUsage.total || (ctx.lastUsage.input + ctx.lastUsage.output)
    convHistoryTokens = Math.max(0, ctx.lastUsage.input - systemPromptTokens - toolOutputsTokens)
    activeTurnsTokens = convHistoryTokens + reasoningTokens + ctx.lastUsage.output
  } else {
    // 启发式粗估计算
    // 启发式粗估：无 real usage 时按事件数粗估活跃轮次 token（非真实值）
    activeTurnsTokens = Math.max(2000, ctx.events.length * 300)
    convHistoryTokens = activeTurnsTokens
    totalTokens = systemPromptTokens + activeTurnsTokens + toolOutputsTokens
  }

  const resolvedWindow = resolveContextWindow(ctx.session.modelId)

  const watermark: ContextWatermark = {
    totalLimit: resolvedWindow.window,
    maxCapacity: resolvedWindow.window,
    windowSource: resolvedWindow.source,
    systemPrompt: systemPromptTokens,
    ltm: 0,
    activeTurns: activeTurnsTokens,
    prunableTools: toolOutputsTokens,
    total: totalTokens,
    conversationHistory: convHistoryTokens,
    toolOutputs: toolOutputsTokens,
    cacheRead: cacheReadTokens,
    reasoningTokens,
    provenance: ctx.lastUsage ? 'counted' : 'estimated',
  }

  // 初始化 Prompt 采集累积器
  const partItemsMap: Record<ContextPartKind, ContextItem[]> = {
    system: [],
    tools: [],
    skills: [],
    memory: [],
    files: [],
    results: [],
    chat: [],
  }

  // 1. sectionsMap 映射条目
  for (const [key, val] of ctx.sectionsMap.entries()) {
    const kind = mapSectionKeyToPartKind(key)
    partItemsMap[kind].push({
      tag: 'prompt',
      name: key,
      tokens: Math.max(1, Math.ceil(val.length / 4)),
      content: val,
    })
  }

  // 2. {type:'system'} / role:'system' 合并条目
  if (ctx.systemText) {
    partItemsMap.system.push({
      tag: 'prompt',
      name: 'prompt',
      tokens: Math.max(1, Math.ceil(ctx.systemText.length / 4)),
      content: ctx.systemText,
    })
  }

  // 3. 文件读写条目 (files)
  partItemsMap.files = Array.from(ctx.fileItems.values())

  // 4. 其余工具条目 (results)
  partItemsMap.results = Array.from(ctx.resultItems.values())

  // 5. 对话轮次条目 (chat)，若超过 30 条将最早项聚合为 turns 项
  let chatItems = [...ctx.turnItems]
  if (chatItems.length > 30) {
    const overflowCount = chatItems.length - 30
    const headItems = chatItems.slice(0, overflowCount)
    const tailItems = chatItems.slice(overflowCount)
    const mergedTokens = headItems.reduce((acc, it) => acc + it.tokens, 0)
    const mergedItem: ContextItem = {
      tag: 'turns',
      name: '0',
      tokens: mergedTokens,
      n: overflowCount,
    }
    chatItems = [mergedItem, ...tailItems]
  }
  partItemsMap.chat = chatItems

  // 6. 构造七大固定顺序 parts，items 依 tokens 降序排列
  const PART_ORDER: ContextPartKind[] = [
    'system',
    'tools',
    'skills',
    'memory',
    'files',
    'results',
    'chat',
  ]

  const parts: ContextPart[] = PART_ORDER.map((kind) => {
    const items = partItemsMap[kind]
    items.sort((a, b) => b.tokens - a.tokens)
    const tokens = items.reduce((acc, it) => acc + it.tokens, 0)
    return { kind, tokens, items }
  })

  // 7. 严格对账：Σ parts.tokens === watermark.total (Prompt Reconciliation)
  const watermarkTotal = watermark.total ?? totalTokens
  const sum = parts.reduce((acc, p) => acc + p.tokens, 0)

  if (sum < watermarkTotal) {
    const diff = watermarkTotal - sum
    const chatPart = parts.find((p) => p.kind === 'chat')!
    chatPart.items.push({
      tag: 'more',
      name: 'more',
      tokens: diff,
    })
    chatPart.items.sort((a, b) => b.tokens - a.tokens)
    chatPart.tokens += diff
  } else if (sum > watermarkTotal && sum > 0) {
    // 比例缩放每个 item 与 part
    for (const part of parts) {
      for (const item of part.items) {
        item.tokens = Math.max(1, Math.round((item.tokens * watermarkTotal) / sum))
      }
      part.tokens = part.items.reduce((acc, it) => acc + it.tokens, 0)
    }

    let currentSum = parts.reduce((acc, p) => acc + p.tokens, 0)
    let diff = watermarkTotal - currentSum

    if (diff !== 0) {
      const allItems = parts.flatMap((p) => p.items)
      if (allItems.length > 0) {
        const maxItem = allItems.reduce(
          (prev, curr) => (curr.tokens > prev.tokens ? curr : prev),
          allItems[0]
        )
        maxItem.tokens = Math.max(1, maxItem.tokens + diff)

        for (const part of parts) {
          part.tokens = part.items.reduce((acc, it) => acc + it.tokens, 0)
        }
        currentSum = parts.reduce((acc, p) => acc + p.tokens, 0)
        diff = watermarkTotal - currentSum

        if (diff !== 0) {
          for (const item of allItems) {
            if (diff === 0) break
            if (diff > 0) {
              item.tokens++
              diff--
            } else if (diff < 0 && item.tokens > 1) {
              item.tokens--
              diff++
            }
          }
          for (const part of parts) {
            part.tokens = part.items.reduce((acc, it) => acc + it.tokens, 0)
          }
        }
      }
    }

    for (const part of parts) {
      part.items.sort((a, b) => b.tokens - a.tokens)
    }
  }

  // 8. 组装 ContextPrompt 并挂载至 ContextWatermark
  const prompt: ContextPrompt = {
    tokens: watermarkTotal,
    window: watermark.maxCapacity ?? watermark.totalLimit ?? resolvedWindow.window,
    parts,
  }
  watermark.prompt = prompt

  if (ctx.events.length > 0) {
    ctx.events[ctx.events.length - 1].watermark = watermark
  }

  return { session: ctx.session, events: ctx.events, watermark }
}

/**
 * 判定事件是否为错误/失败/自愈分叉节点
 * 契约：所有失败或自愈节点绝不参与折叠，保持强可见性
 */
export function isFailureOrCorrectionEvent(ev: TelemetryEvent): boolean {
  if (ev.status === 'failed' || ev.status === 'rejected') return true
  if (ev.isCorrectionBranch) return true
  if (typeof ev.observation?.exitCode === 'number' && ev.observation.exitCode !== 0) return true
  if (ev.assertion && !ev.assertion.passed) return true
  return false
}

/**
 * 提取用于连续聚合的同构手势与目标键
 * 若返回 null 则表示该节点不可参与任何聚合（如思考节点、人类交互、门禁、失败节点）
 */
export function getToolTargetKey(ev: TelemetryEvent): string | null {
  if (isFailureOrCorrectionEvent(ev)) return null
  if (ev.status === 'gate' || ev.gesture === 'gate') return null
  if (ev.gesture === 'think' || ev.actor === 'Human Operator') return null

  if (ev.gesture === 'edit' || ev.gesture === 'read') {
    const targetPath = (ev.payload?.path || ev.payload?.file_path || ev.payload?.filePath) as
      | string
      | undefined
    if (targetPath) {
      return `file:${basename(targetPath)}`
    }
    if (ev.gesture === 'read') {
      if (typeof ev.payload?.pattern === 'string') {
        return `read:pattern:${ev.payload.pattern}`
      }
      return 'read:general'
    }
    return 'edit:general'
  }

  if (ev.gesture === 'bash') {
    const cmd = String(ev.payload?.command || ev.observation?.command || '').trim()
    // 识别终端轮询指令 (如 orca terminal read)
    if (
      cmd.includes('terminal read') ||
      cmd.includes('terminal get') ||
      cmd.includes('terminal wait') ||
      cmd.includes('terminal check') ||
      cmd.includes('terminal status')
    ) {
      const termMatch = cmd.match(/term_[a-zA-Z0-9_-]+/)
      const termId = termMatch ? termMatch[0] : 'poll'
      return `bash:terminal-poll:${termId}`
    }
    return 'bash'
  }

  if (ev.gesture === 'memory') {
    return 'memory'
  }

  return ev.gesture || null
}

/**
 * 依据手势与聚合序列生成符合规约的精炼标题
 * 例如 'read: useTelemetryStream.ts (x3)' 或 'bash: orca 命令组 (x3)'
 */
export function formatAggregatedTitle(gesture: TelemetryGesture, group: TelemetryEvent[]): string {
  const count = group.length

  // 1. 同目标文件管道：包含 read 和 edit 混合，或纯连续读写
  const gestures = unique(sift(group.map((e) => e.gesture)))
  const targetPath = (group[0].payload?.path ||
    group[0].payload?.file_path ||
    group[0].payload?.filePath) as string | undefined

  if (targetPath) {
    const fileBase = basename(targetPath)
    if (gestures.includes('edit') && gestures.includes('read')) {
      const readCount = group.filter((e) => e.gesture === 'read').length
      const editCount = group.filter((e) => e.gesture === 'edit').length
      return `file: ${fileBase} (${readCount}检视 + ${editCount}补丁)`
    }
    if (gesture === 'edit') {
      return `edit: ${fileBase} (x${count})`
    }
    if (gesture === 'read') {
      return `read: ${fileBase} (x${count})`
    }
  }

  // 2. 终端轮询聚合
  const commands = sift(
    group.map((e) => String(e.payload?.command || e.observation?.command || '').trim())
  )
  const isTerminalPoll = commands.some((c) =>
    c.includes('terminal read') ||
    c.includes('terminal wait') ||
    c.includes('terminal get') ||
    c.includes('terminal check') ||
    c.includes('terminal status')
  )
  if (isTerminalPoll) {
    const termMatch = commands[0].match(/term_[a-zA-Z0-9_-]+/)
    const shortTerm = termMatch ? `${termMatch[0].slice(0, 12)}...` : '终端'
    return `terminal: 轮询 ${shortTerm} (x${count})`
  }

  if (gesture === 'read') {
    if (typeof group[0].payload?.pattern === 'string') {
      return `rg "${group[0].payload.pattern}" (x${count})`
    }
    return `read: 连续读取 (x${count})`
  }

  if (gesture === 'edit') {
    return `edit: 连续编辑 (x${count})`
  }

  if (gesture === 'bash') {
    const firstWords = sift(
      commands.map((c) => {
        const clean = c.replace(/^\$\s*/, '').trim()
        return clean.split(/\s+/)[0] || ''
      })
    )

    const allSameFirstWord =
      firstWords.length > 0 && firstWords.every((w) => w === firstWords[0])
    if (allSameFirstWord && firstWords[0]) {
      return `bash: ${firstWords[0]} 命令组 (x${count})`
    }
    return `bash: 命令组 (x${count})`
  }

  if (gesture === 'memory') {
    return `memory: 记忆存取 (x${count})`
  }

  return `${gesture}: 聚合调用 (x${count})`
}

/** 连续工具调用折叠配置契约 */
export interface AggregateOptions {
  enabled?: boolean
}

/**
 * 核心转换函数 2：智能聚合连续同构工具调用 (Shape By Example)
 * - 将同手势、同目标的连续成功工具调用折叠为一个带有 (xN) 标记与聚合详情的主节点
 * - 绝对不折叠任何 exitCode !== 0 或 status === 'failed' 的单测/异常自愈节点
 * - 当 options.enabled 为 false 时，精确无损保留原始展开序列
 * - 自动重写后续节点的 parentId，确保因果 DAG 连接完整无断链
 *
 * @example
 * ```ts
 * // [Input Shape - Expanded TelemetryEvent[]]:
 * // [
 * //   { nodeId: 'read-1', gesture: 'read', payload: { path: 'src/app.ts' }, status: 'completed' },
 * //   { nodeId: 'read-2', parentId: 'read-1', gesture: 'read', payload: { path: 'src/app.ts' }, status: 'completed' },
 * //   { nodeId: 'read-3', parentId: 'read-2', gesture: 'read', payload: { path: 'src/app.ts' }, status: 'completed' }
 * // ]
 *
 * const aggregated = aggregateConsecutiveToolEvents(events, { enabled: true })
 *
 * // [Output Shape - Folded TelemetryEvent[]]:
 * // [
 * //   {
 * //     nodeId: 'read-1',
 * //     gesture: 'read',
 * //     title: 'read: app.ts (x3)',
 * //     isAggregated: true,
 * //     aggregateCount: 3,
 * //     payload: { isAggregated: true, aggregateCount: 3, subCalls: [...] },
 * //     observation: { exitCode: 0, aggregatedCount: 3, output: [...] }
 * //   }
 * // ]
 * ```
 */
export function aggregateConsecutiveToolEvents(
  events: TelemetryEvent[],
  options?: AggregateOptions
): TelemetryEvent[] {
  if (options?.enabled === false || !events || events.length <= 1) {
    return [...(events || [])]
  }

  const result: TelemetryEvent[] = []
  const idAliasMap = new Map<string, string>()

  let currentGroup: TelemetryEvent[] = []
  let currentThinks: TelemetryEvent[] = []
  let currentKey: string | null = null

  let pendingTransientThinks: TelemetryEvent[] = []

  const flushGroup = () => {
    if (currentGroup.length === 0) {
      if (pendingTransientThinks.length > 0) {
        result.push(...pendingTransientThinks)
        pendingTransientThinks = []
      }
      return
    }

    // 只有当有新同构工具到来并真正被当前组吸收时，pendingTransientThinks 才能作为 subNotes 合并
    // 若 flushGroup 时 pendingTransientThinks 之后没有同构工具到来，则这些 think 是正常独立节点，原样放入 result
    const trailingThinks = pendingTransientThinks
    pendingTransientThinks = []

    if (currentGroup.length === 1) {
      result.push(currentGroup[0])
      if (trailingThinks.length > 0) {
        result.push(...trailingThinks)
      }
    } else {
      const first = currentGroup[0]
      const count = currentGroup.length

      // 注册所有被吸收的子节点 ID 别名映射到聚合主节点 ID
      for (const item of currentGroup) {
        idAliasMap.set(item.nodeId, first.nodeId)
      }
      for (const think of currentThinks) {
        idAliasMap.set(think.nodeId, first.nodeId)
      }

      const allOutputs = currentGroup.flatMap((e) =>
        normalizeObservationOutput(e.observation?.output)
      )

      const commands = sift(
        currentGroup.map((e) =>
          String(e.observation?.command || e.payload?.command || '').trim()
        )
      )

      const subCalls = currentGroup.map((e, idx) => ({
        index: idx + 1,
        nodeId: e.nodeId,
        title: e.title,
        gesture: e.gesture,
        status: e.status,
        payload: e.payload,
        observation: e.observation,
        delta: e.delta,
        timestamp: e.timestamp,
      }))

      // 若混合包含 edit 与 read，提升主手势为 edit
      const gestures = unique(sift(currentGroup.map((e) => e.gesture)))
      const gesture = gestures.includes('edit') ? 'edit' : (first.gesture || 'think')
      const title = formatAggregatedTitle(gesture, currentGroup)

      const thoughts = sift(
        currentThinks
          .map((e) => e.delta)
          .filter(Boolean) as string[]
      )

      const aggEvent: TelemetryEvent = {
        ...first,
        nodeId: first.nodeId,
        parentId: first.parentId,
        title,
        gesture,
        status: 'completed',
        delta: thoughts.length > 0
          ? thoughts.join('\n')
          : `连续执行 ${count} 次 ${gesture} 调用已聚合`,
        isAggregated: true,
        aggregateCount: count,
        aggregatedEvents: currentGroup,
        isCorrectionBranch: false,
        payload: {
          ...first.payload,
          isAggregated: true,
          aggregateCount: count,
          commands: commands.length > 0 ? commands : undefined,
          subCalls,
          subNotes: thoughts.length > 0 ? thoughts : undefined,
          thoughts: thoughts.length > 0 ? thoughts : undefined,
        },
        observation: {
          exitCode: 0,
          output: allOutputs,
          command: commands.length > 0 ? commands.join(' && ') : undefined,
          aggregatedCount: count,
          notes: thoughts.length > 0 ? thoughts : undefined,
          subNotes: thoughts.length > 0 ? thoughts : undefined,
        },
      }

      result.push(aggEvent)
      if (trailingThinks.length > 0) {
        result.push(...trailingThinks)
      }
    }

    currentGroup = []
    currentThinks = []
    currentKey = null
  }

  for (const ev of events) {
    const key = getToolTargetKey(ev)

    if (key !== null && key === currentKey) {
      // 关键修复：如果在同一组同构工具调用间隙穿插了暂存的 think，将其吸收进 currentThinks 作为附属注解
      if (pendingTransientThinks.length > 0) {
        for (const think of pendingTransientThinks) {
          idAliasMap.set(think.nodeId, currentGroup[0].nodeId)
          currentThinks.push(think)
        }
        pendingTransientThinks = []
      }
      currentGroup.push(ev)
    } else if (
      currentGroup.length > 0 &&
      key === null &&
      ev.gesture === 'think' &&
      !isFailureOrCorrectionEvent(ev)
    ) {
      // 容忍同构工具调用间隙的过渡思考：暂存并等待下一事件
      // 若下一个事件依然是同构 key，则在上一分支将 think 吸收；若不是，在 flushGroup 时完整保留为独立节点
      pendingTransientThinks.push(ev)
    } else {
      flushGroup()
      if (key !== null) {
        currentKey = key
        currentGroup = [ev]
      } else {
        result.push(ev)
      }
    }
  }

  flushGroup()

  // 修复因果链 parentId：若后续节点的 parentId 是某个已被聚合吸收的子节点，重定向到聚合主节点
  for (const ev of result) {
    if (ev.parentId && idAliasMap.has(ev.parentId)) {
      ev.parentId = idAliasMap.get(ev.parentId)
    }
  }

  return result
}

/** 增量聚合操作返回契约 */
export interface CoalesceIncrementalResult {
  coalesced: boolean
  updatedTail: TelemetryEvent
}

/**
 * 核心转换函数 2-B：在线流式增量聚合器纯函数 (Shape By Example)
 * 为后续 WebSocket 实时流就地吸附翻牌 (In-place Absorbing & Debounce) 提供通用纯函数支撑，
 * 使离线回放与实时流共用同一套聚合决策逻辑。
 */
export function coalesceIncrementalEvent(
  currentTail: TelemetryEvent | null | undefined,
  newEvent: TelemetryEvent
): CoalesceIncrementalResult {
  if (!currentTail) {
    return { coalesced: false, updatedTail: newEvent }
  }

  if (isFailureOrCorrectionEvent(currentTail) || isFailureOrCorrectionEvent(newEvent)) {
    return { coalesced: false, updatedTail: newEvent }
  }

  // 1. 若新事件是过渡思考节点，且当前尾节点是工具或聚合工具节点，将其吸收为尾节点的 subNotes/thoughts
  if (
    newEvent.gesture === 'think' &&
    (currentTail.gesture === 'bash' ||
      currentTail.gesture === 'read' ||
      currentTail.gesture === 'edit' ||
      currentTail.gesture === 'memory' ||
      currentTail.isAggregated)
  ) {
    const existingNotes = (currentTail.payload?.subNotes as string[]) || []
    const newNote = newEvent.delta || newEvent.title || ''
    const updatedNotes = newNote ? [...existingNotes, newNote] : existingNotes
    const updatedTail: TelemetryEvent = {
      ...currentTail,
      payload: {
        ...currentTail.payload,
        subNotes: updatedNotes.length > 0 ? updatedNotes : undefined,
        thoughts: updatedNotes.length > 0 ? updatedNotes : undefined,
      },
      observation: {
        ...currentTail.observation,
        notes: updatedNotes.length > 0 ? updatedNotes : undefined,
        subNotes: updatedNotes.length > 0 ? updatedNotes : undefined,
      },
    }
    return { coalesced: true, updatedTail }
  }

  // 2. 检查同构目标 Key
  const tailKey = getToolTargetKey(currentTail)
  const newKey = getToolTargetKey(newEvent)

  if (tailKey !== null && newKey !== null && tailKey === newKey) {
    const existingEvents = currentTail.aggregatedEvents || [currentTail]
    const mergedEvents = [...existingEvents, newEvent]
    const aggregated = aggregateConsecutiveToolEvents(mergedEvents, { enabled: true })
    if (aggregated.length === 1) {
      return { coalesced: true, updatedTail: aggregated[0] }
    }
  }

  return { coalesced: false, updatedTail: newEvent }
}

/** 拓扑排版与网格流式布局配置契约 */
export interface FlowLayoutOptions {
  nodesPerRow?: number
  stepX?: number
  baseY?: number
  rowGap?: number
  branchOffset?: number
  expandedTurnIds?: Set<string>
  onToggleExpand?: (turnId: string) => void
  onDrillDown?: (turnId: string) => void
}

/**
 * 核心转换函数 3：将 TelemetryEvent[] 序列计算为 React Flow 所需的 Node[] 与 Edge[] (Shape By Example)
 * 采用多行流式网格排版 (Row-Wrapped Grid Layout)，告别单调的一字长蛇阵
 * 充分利用现代化 16:9 画布纵向与横向空间，支持自愈分支相对偏移与琥珀金分支线
 *
 * @example
 * ```ts
 * // [Input Shape - TelemetryEvent[]]:
 * // [
 * //   { nodeId: 'node-1', gesture: 'think', title: '目标规划', status: 'completed' },
 * //   { nodeId: 'node-2', parentId: 'node-1', gesture: 'bash', title: 'pnpm test', status: 'failed', isCorrectionBranch: true }
 * // ]
 *
 * const { nodes, edges } = eventsToFlowNodesAndEdges(events)
 *
 * // [Output Shape - React Flow Graph]:
 * // nodes: [
 * //   { id: 'node-1', type: 'agentNode', position: { x: 50, y: 180 }, data: { title: '目标规划', gesture: 'think', ... } },
 * //   { id: 'node-2', type: 'agentNode', position: { x: 330, y: 340 }, data: { title: 'pnpm test', isCorrectionBranch: true, ... } }
 * // ]
 * // edges: [
 * //   { id: 'e-node-1-node-2', source: 'node-1', target: 'node-2', type: 'smoothstep', animated: true, style: { stroke: '#D97706', ... } }
 * // ]
 * ```
 */
export function eventsToFlowNodesAndEdges(
  events: TelemetryEvent[],
  options?: FlowLayoutOptions
): {
  nodes: Node[]
  edges: Edge[]
} {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const nodeMap = new Map<string, Node>()

  const START_X = 50
  const STEP_X = options?.stepX ?? 280
  const BASE_Y = options?.baseY ?? 180
  const BRANCH_OFFSET = options?.branchOffset ?? 160 // 行内自愈分支下沉偏移 (180 + 160 = 340)
  const ROW_GAP = options?.rowGap ?? 340 // 行与行之间的垂直跨度，为自愈分支与跨行连线留足空间
  const NODES_PER_ROW = options?.nodesPerRow ?? 6 // 每行折行主节点数

  // 遵循第一性真实性：取消粗暴硬截断，全量保留因果事件，依托多行流式网格与折叠聚合自然收敛 DOM 压力
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    const parentNode = ev.parentId ? nodeMap.get(ev.parentId) : undefined

    // 计算多行流式网格坐标 (Row-Wrapped Grid Layout)
    const row = Math.floor(i / NODES_PER_ROW)
    const col = i % NODES_PER_ROW

    const posX = START_X + col * STEP_X
    const rowBaseY = BASE_Y + row * ROW_GAP
    const posY = ev.isCorrectionBranch ? rowBaseY + BRANCH_OFFSET : rowBaseY

    let nodeSummary = ''
    if (ev.isAggregated && ev.aggregateCount) {
      if (
        ev.gesture === 'bash' &&
        Array.isArray(ev.payload?.commands) &&
        (ev.payload.commands as string[]).length > 0
      ) {
        const cmds = ev.payload.commands as string[]
        nodeSummary = cmds.slice(0, 3).map((c) => `$ ${c}`).join('\n')
      } else if (ev.payload?.subCalls && Array.isArray(ev.payload.subCalls)) {
        const subCalls = ev.payload.subCalls as Array<{ title?: string }>
        nodeSummary = subCalls.map((s) => `• ${s.title || '调用'}`).join('\n')
      } else {
        nodeSummary = `已折叠 ${ev.aggregateCount} 次连续 ${ev.gesture} 调用`
      }
    } else if (ev.delta && typeof ev.delta === 'string') {
      nodeSummary = ev.delta.length > 300 ? `${ev.delta.slice(0, 300)}...` : ev.delta
    } else if (ev.payload) {
      if (typeof ev.payload.command === 'string') {
        nodeSummary = `$ ${ev.payload.command}`
      } else if (typeof ev.payload.path === 'string') {
        nodeSummary = `文件: ${ev.payload.path}`
      } else if (typeof ev.payload.pattern === 'string') {
        nodeSummary = `搜索模式: ${ev.payload.pattern}`
      } else {
        nodeSummary = JSON.stringify(ev.payload)
      }
    } else if (ev.observation?.output) {
      const outputLines = normalizeObservationOutput(ev.observation.output)
      nodeSummary = outputLines.slice(0, 3).join('\n')
    }

    // 确保节点摘要文本永远不超过 300 字符，消除 DOM 文本重排压力
    if (nodeSummary.length > 300) {
      nodeSummary = `${nodeSummary.slice(0, 280)}...`
    }

    const toolTokens =
      (typeof ev.observation?.tokens === 'number' ? ev.observation.tokens : 0) ||
      (typeof ev.payload?.prunableTokens === 'number' ? (ev.payload.prunableTokens as number) : 0) ||
      (ev.gesture === 'read' || ev.gesture === 'edit' || ev.gesture === 'bash'
        ? Math.ceil(
            ((ev.observation?.output ? normalizeObservationOutput(ev.observation.output).join('\n').length : 0) +
              (ev.payload ? JSON.stringify(ev.payload).length : 0)) /
              4
          )
        : undefined)

    // 瘦节点纯视图模型 (Lean View-Model)：剔除大型 payload / observation，保证画布 60fps 运镜
    const nodeData: AgentNodeData = {
      nodeId: ev.nodeId,
      title: ev.title || '执行节点',
      actor: ev.actor || 'Pi (Coordinator)',
      gesture: ev.gesture || 'think',
      status: ev.status || 'completed',
      summary: nodeSummary,
      isCorrectionBranch: ev.isCorrectionBranch,
      isAggregated: ev.isAggregated,
      aggregateCount: ev.aggregateCount,
      prunableTokens: toolTokens || undefined,
    }

    const node: Node = {
      id: ev.nodeId,
      type: 'agentNode',
      position: { x: posX, y: posY },
      data: nodeData,
    }

    nodes.push(node)
    nodeMap.set(ev.nodeId, node)

    // 构建因果边
    if (ev.parentId && nodeMap.has(ev.parentId)) {
      const isBranchEdge = Boolean(
        ev.isCorrectionBranch || (parentNode?.data as unknown as AgentNodeData)?.isCorrectionBranch
      )
      const edgeStyle = isBranchEdge
        ? { stroke: '#D97706', strokeWidth: 1.5, strokeDasharray: '5 4' }
        : { stroke: '#8F887D', strokeWidth: 1.5 }

      const edge: Edge = {
        id: `e-${ev.parentId}-${ev.nodeId}`,
        source: ev.parentId,
        target: ev.nodeId,
        type: 'smoothstep',
        animated: isBranchEdge,
        style: edgeStyle,
      }
      edges.push(edge)
    }
  }

  return { nodes, edges }
}

/**
 * 提取精炼的核心意图首句
 */
function extractIntentSentence(text?: string): string {
  if (!text) return ''
  // 1. 若包含 URL 编码的中文字符（如 %E8%85%BE%E8%AE%AF），先优雅安全解码，杜绝出现长串乱码 %xx
  let decoded = text
  if (/%[0-9a-fA-F]{2}/.test(text)) {
    try {
      decoded = decodeURIComponent(text)
    } catch {
      // 容错降级：逐段正则自愈解码
      decoded = text.replace(/(%[0-9a-fA-F]{2})+/g, (match) => {
        try {
          return decodeURIComponent(match)
        } catch {
          return match
        }
      })
    }
  }

  // 2. 若文本以 ## Design Feedback: 开头，提纯真实反馈或文件语义，杜绝输出天书级长路径
  if (/^#*\s*Design Feedback:\s*/i.test(decoded)) {
    // 优先提取 Design Feedback 下面的真实反馈内容（如 Feedback: xxx）
    const feedbackMatch = decoded.match(/\*\*Feedback:\*\*\s*([^\r\n]+)/i)
    if (feedbackMatch && feedbackMatch[1].trim()) {
      const fb = feedbackMatch[1].trim()
      return fb.length > 90 ? `${fb.slice(0, 87)}...` : fb
    }
    // 若无 Feedback 标记，提取针对的文件名
    const pathMatch = decoded.match(/Design Feedback:\s*([^\r\n]+)/i)
    if (pathMatch && pathMatch[1].trim()) {
      const cleanPath = pathMatch[1].trim().replace(/^file:\/\/\/?/i, '').replace(/^[A-Za-z]:\//, '')
      const fileName = basename(cleanPath)
      return `界面走查反馈: ${fileName}`
    }
  }

  const clean = decoded.replace(/^[#>\s*`-]+/, '').trim()
  const firstLine = clean.split(/\r?\n/)[0]?.trim() || clean
  const match = firstLine.match(/^(.+?)(?:[。！？!?；;]|$)/)
  const candidate = (match && match[1] ? match[1] : firstLine).trim()
  return candidate.length > 90 ? `${candidate.slice(0, 87)}...` : candidate
}

/**
 * 格式化持续时间毫秒数为易读字符串
 */
function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}

/**
 * 判定事件是否为新的回合起始分界
 */
function isTurnStartBoundary(
  ev: TelemetryEvent,
  currentGroup: TelemetryEvent[],
  currentTurnIndex: number
): boolean {
  if (currentGroup.length === 0) return false

  // 1. 显式 payload turnIndex / turnId 变更
  if (
    typeof ev.payload?.turnIndex === 'number' &&
    ev.payload.turnIndex !== currentTurnIndex
  ) {
    return true
  }

  // 2. 人类需求指令或用户角色消息（非中间审批门禁）
  if (
    ev.gesture !== 'gate' &&
    ev.status !== 'gate' &&
    (ev.actor === 'Human Operator' ||
      /用户|User\s*Prompt/i.test(ev.title || '') ||
      (ev.payload as Record<string, unknown> | undefined)?.role === 'user')
  ) {
    return true
  }

  // 3. 跨轮独立根节点（无 parentId 且当前组已包含动作）
  if (ev.parentId === undefined || ev.parentId === null) {
    return true
  }

  return false
}

/**
 * 将一组子事件组装为 MacroTurnGroup 结构
 */
function buildMacroTurnGroup(group: TelemetryEvent[], turnIndex: number): MacroTurnGroup {
  const turnId = `turn-${turnIndex}`
  const userEv = group.find(
    (e) =>
      e.gesture !== 'gate' &&
      (e.actor === 'Human Operator' || /用户|User/i.test(e.title || ''))
  )
  const firstEv = group[0]
  const baseTitle = userEv?.title || firstEv?.title || '任务执行回合'
  const title = baseTitle.startsWith('Turn #') ? baseTitle : `Turn #${turnIndex}: ${baseTitle}`

  const userContent =
    userEv?.delta ||
    (userEv?.payload?.text as string) ||
    (userEv?.payload?.prompt as string) ||
    (userEv?.payload?.content as string)
  const thinkEv = group.find((e) => e.gesture === 'think')
  const rawIntent = userContent || thinkEv?.delta || firstEv?.delta || baseTitle
  const intent = extractIntentSentence(rawIntent) || `第 ${turnIndex} 回合目标推进与执行`

  const hasGate = group.some((e) => e.status === 'gate' || e.gesture === 'gate')
  const hasRunning = group.some((e) => e.status === 'running')
  const hasCorrection = group.some((e) => e.isCorrectionBranch)
  const hasFailure = group.some(
    (e) =>
      e.status === 'failed' ||
      e.status === 'rejected' ||
      (typeof e.observation?.exitCode === 'number' && e.observation.exitCode !== 0)
  )

  let status: MacroTurnStatus = 'success'
  if (hasGate) {
    status = 'gate'
  } else if (hasRunning) {
    status = 'running'
  } else if (hasCorrection) {
    status = 'branching'
  } else if (hasFailure) {
    status = 'failed'
  } else {
    status = 'success'
  }

  // 计算工具调用计数分布 (只统计 Agent 实际调用的外部工具，排除人类用户输入与纯思考/门禁)
  const toolCounts: Record<string, number> = {}
  for (const ev of group) {
    if (
      ev.actor !== 'Human Operator' &&
      ev.gesture &&
      ev.gesture !== 'think' &&
      ev.gesture !== 'gate'
    ) {
      toolCounts[ev.gesture] = (toolCounts[ev.gesture] || 0) + 1
    }
  }

  // 耗时估算
  const timestamps = sift(group.map((e) => e.timestamp))
  let durationMs = 0
  if (timestamps.length >= 2) {
    durationMs = Math.max(0, Math.max(...timestamps) - Math.min(...timestamps))
  } else {
    const sumReported = group.reduce((acc, e) => {
      const ms =
        typeof e.observation?.durationMs === 'number'
          ? e.observation.durationMs
          : typeof e.payload?.durationMs === 'number'
            ? (e.payload.durationMs as number)
            : 0
      return acc + ms
    }, 0)
    durationMs = sumReported > 0 ? sumReported : Math.max(200, group.length * 350)
  }
  const totalDuration = formatDurationMs(durationMs)

  // Token 消耗提取与派生
  // 1. 扫描 group 内是否有由真实 message.usage 注入的 usage
  const evWithUsage = group.find((e) => e.usage || (e.payload?.usage as ExtractedUsage | undefined))
  const realUsage = evWithUsage?.usage || (evWithUsage?.payload?.usage as ExtractedUsage | undefined)

  // 2. 统计当前回合内所有外部工具产生的真实载荷 Token (prunable tools)
  let toolOutputs = 0
  for (const ev of group) {
    if (ev.actor !== 'Human Operator' && ev.gesture && ev.gesture !== 'think' && ev.gesture !== 'gate') {
      const toolTokens =
        (typeof ev.observation?.tokens === 'number' ? ev.observation.tokens : 0) ||
        (typeof ev.payload?.prunableTokens === 'number' ? (ev.payload.prunableTokens as number) : 0) ||
        Math.ceil(
          ((ev.observation?.output ? normalizeObservationOutput(ev.observation.output).join('\n').length : 0) +
            (ev.payload ? JSON.stringify(ev.payload).length : 0)) /
            4
        )
      toolOutputs += toolTokens
    }
  }

  let turnInput = 0
  let turnOutput = 0
  let turnTotal = 0
  let turnCacheRead = 0
  let turnReasoning = 0
  let turnConvHistory = 0

  if (realUsage) {
    turnInput = realUsage.input ?? 0
    turnOutput = realUsage.output ?? 0
    turnCacheRead = realUsage.cacheRead ?? 0
    turnReasoning = realUsage.reasoning ?? 0
    turnTotal = realUsage.total ?? (turnInput + turnOutput)
    turnConvHistory = Math.max(0, turnInput - toolOutputs)
  } else {
    // 启发式粗估计算
    let totalInChars = 0
    let totalOutChars = 0
    for (const ev of group) {
      const inChars = ev.payload ? JSON.stringify(ev.payload).length : 0
      const outChars =
        (ev.observation?.output ? normalizeObservationOutput(ev.observation.output).join('').length : 0) +
        (ev.delta?.length || 0)
      totalInChars += inChars
      totalOutChars += outChars
    }
    turnInput = Math.ceil(totalInChars / 4)
    turnOutput = Math.ceil(totalOutChars / 4)
    turnTotal = turnInput + turnOutput
    turnCacheRead = 0
    turnReasoning = 0
    turnConvHistory = Math.max(0, turnInput - toolOutputs)
  }

  const tokenBreakdown: TurnTokenBreakdown = {
    input: turnInput,
    output: turnOutput,
    total: turnTotal,
    prunable: toolOutputs,
    cacheRead: turnCacheRead,
    reasoningTokens: turnReasoning,
    systemPrompt: 0,
    toolOutputs,
    conversationHistory: turnConvHistory,
    provenance: realUsage ? 'counted' : 'estimated',
  }

  return {
    turnId,
    turnIndex,
    title,
    intent,
    status,
    totalDuration,
    durationMs,
    tokenBreakdown,
    toolCounts,
    subEvents: group,
    actor: group.find((e) => e.actor)?.actor || 'Pi (Coordinator)',
    hasCorrection,
    hasFailure,
    hasGate,
  }
}

/**
 * 核心转换函数 4：根据 Turn 边界聚合并派生宏观 MacroTurnGroup[] (Shape By Example)
 * - 依据 user 消息、跨轮根节点与阶段边界将原子 TelemetryEvent[] 聚合成 MacroTurnGroup 复合契约
 * - 统计回合内耗时、工具调用汇总芯片（read/bash/edit）、状态与核心意图摘要
 *
 * @example
 * ```ts
 * const turns = aggregateEventsIntoTurns(events)
 * // turns: [
 * //   { turnId: 'turn-1', turnIndex: 1, title: 'Turn #1: 用户需求指令', intent: '重构清洗流', toolCounts: { read: 2, bash: 1 }, ... }
 * // ]
 * ```
 */
export function aggregateEventsIntoTurns(events: TelemetryEvent[]): MacroTurnGroup[] {
  if (!events || events.length === 0) return []

  const groups: TelemetryEvent[][] = []
  let currentGroup: TelemetryEvent[] = []
  let currentTurnIndex = 1

  for (const ev of events) {
    if (isTurnStartBoundary(ev, currentGroup, currentTurnIndex)) {
      groups.push(currentGroup)
      currentGroup = [ev]
      currentTurnIndex++
    } else {
      currentGroup.push(ev)
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup)
  }

  return groups.map((g, idx) => buildMacroTurnGroup(g, idx + 1))
}

/**
 * 核心转换函数 5：将 MacroTurnGroup[] 映射为 React Flow 宏观复合节点和因果连接边
 * - 为每个 MacroTurn 生成优雅的 'turnNode' 自定义节点
 * - 支持 expandedTurnIds 展开态，展开态宽度增至 460px 并自动顺延平移后续节点
 * - 依次建立主干连接边，分支与异常状态高亮显示
 */
export function turnsToFlowNodesAndEdges(
  turns: MacroTurnGroup[],
  options?: FlowLayoutOptions | Set<string>,
  expandedTurnIds?: Set<string>
): {
  nodes: Node[]
  edges: Edge[]
} {
  const nodes: Node[] = []
  const edges: Edge[] = []

  const actualExpandedTurnIds: Set<string> =
    expandedTurnIds instanceof Set
      ? expandedTurnIds
      : options instanceof Set
        ? options
        : options?.expandedTurnIds instanceof Set
          ? options.expandedTurnIds
          : new Set<string>()

  const actualOptions: FlowLayoutOptions =
    options instanceof Set ? {} : (options ?? {})

  const START_X = 50
  const BASE_Y = actualOptions.baseY ?? 180
  const ROW_GAP = actualOptions.rowGap ?? 280
  const NODES_PER_ROW = actualOptions.nodesPerRow ?? 4
  const COLLAPSED_WIDTH = 320
  const EXPANDED_WIDTH = 460
  const STEP_X = actualOptions.stepX ?? 360
  const GAP_X = Math.max(20, STEP_X - COLLAPSED_WIDTH) // 默认为 360 - 320 = 40px

  // 按行划分，以便为展开态节点自适应累加 X 偏移，并为下一行留出纵向空间
  let currentY = BASE_Y

  for (let i = 0; i < turns.length; i += NODES_PER_ROW) {
    const rowTurns = turns.slice(i, i + NODES_PER_ROW)
    let currentX = START_X
    let rowHasExpanded = false

    for (let c = 0; c < rowTurns.length; c++) {
      const turn = rowTurns[c]
      const isExpanded = actualExpandedTurnIds.has(turn.turnId)
      if (isExpanded) {
        rowHasExpanded = true
      }
      const nodeWidth = isExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH

      nodes.push({
        id: turn.turnId,
        type: 'turnNode',
        position: { x: currentX, y: currentY },
        data: {
          ...turn,
          isExpanded,
          onToggleExpand: actualOptions.onToggleExpand,
          onDrillDown: actualOptions.onDrillDown,
        },
      })

      currentX += nodeWidth + GAP_X
    }

    currentY += rowHasExpanded ? ROW_GAP + 160 : ROW_GAP
  }

  for (let i = 1; i < turns.length; i++) {
    const prevTurn = turns[i - 1]
    const turn = turns[i]
    const isBranch = turn.status === 'branching' || prevTurn.status === 'branching'
    const isFail = turn.status === 'failed'
    const isGate = turn.status === 'gate'

    const strokeColor = isFail
      ? '#E11D48'
      : isBranch
        ? '#D97706'
        : isGate
          ? '#D97706'
          : '#8F887D'

    edges.push({
      id: `e-${prevTurn.turnId}-${turn.turnId}`,
      source: prevTurn.turnId,
      target: turn.turnId,
      type: 'smoothstep',
      animated: isBranch || turn.status === 'running',
      style: {
        stroke: strokeColor,
        strokeWidth: 2,
        strokeDasharray: isBranch ? '5 4' : undefined,
      },
    })
  }

  return { nodes, edges }
}

