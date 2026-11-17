/**
 * @file src/services/protocols/claude.ts
 * @description Claude Code 会话协议适配器：把 Claude JSONL 记录映射为标准化遥测事件。
 *
 * 契约：
 * 1. 只处理 Claude 专有字段结构（last-prompt / attachment / user / assistant 内容块）；
 * 2. 手势字典、标题格式化、上下文记账等原语一律复用 `protocols/shared.ts`；
 * 3. 脏文本解码统一走 `safeDecodeUri`，杜绝分支内嵌套 try/catch。
 */

import { basename } from 'pathe'
import { isString } from 'radash'
import type { TelemetryEvent } from '../../types/telemetry'
import { normalizeObservationOutput } from '../../types/telemetry'
import { extractRealIntent } from '../agentNodeLOD'
import {
  extractTextContent,
  extractUsageFromRecord,
  formatToolTitle,
  mapToolNameToGesture,
  recordToolCallToPrompt,
  safeDecodeUri,
  updateToolResultInPrompt,
  type ParserContext,
} from './shared'

/**
 * 处理 Claude Code 会话头部及附件元数据
 */
export function handleClaudeMetadata(record: Record<string, unknown>, ctx: ParserContext): boolean {
  if (record.type === 'last-prompt' && isString(record.sessionId)) {
    ctx.isClaudeSession = true
    ctx.session.format = 'claude'
    ctx.session.id = record.sessionId
    ctx.session.sessionId = record.sessionId
    return true
  }

  if (record.type === 'attachment') {
    ctx.isClaudeSession = true
    ctx.session.format = 'claude'
    if (isString(record.sessionId)) ctx.session.sessionId = record.sessionId
    if (isString(record.cwd)) {
      ctx.session.cwd = record.cwd
      ctx.session.cwdBase = basename(record.cwd)
    }
    if (isString(record.gitBranch)) ctx.session.gitBranch = record.gitBranch
    if (isString(record.version)) ctx.session.version = record.version
    return true
  }

  return false
}

/**
 * 处理 Claude Code 用户轮次（包含 tool_result 回包或需求输入）
 */
export function handleClaudeUserMessage(
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
  userText = safeDecodeUri(userText)

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
    timestamp: isString(record.timestamp) ? new Date(record.timestamp).getTime() : Date.now(),
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
export function handleClaudeAssistantMessage(
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
  const timestamp = isString(record.timestamp) ? new Date(record.timestamp).getTime() : Date.now()

  for (let i = 0; i < msg.content.length; i++) {
    const block = msg.content[i]
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>

    if (b.type === 'thinking' && isString(b.thinking)) {
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

    if (b.type === 'text' && isString(b.text) && b.text.trim()) {
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
export function handleClaudeMessage(record: Record<string, unknown>, ctx: ParserContext): boolean {
  if (record.type !== 'user' && record.type !== 'assistant') {
    return false
  }

  ctx.isClaudeSession = true
  ctx.session.format = 'claude'
  const msg = record.message as Record<string, unknown> | undefined
  if (!msg) return false

  const uuid = isString(record.uuid) ? record.uuid : `cl-${++ctx.turnCounter}`
  const rawParentUuid = isString(record.parentUuid) ? record.parentUuid : ctx.lastEventId
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
