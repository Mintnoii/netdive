/**
 * @file src/services/protocols/pi.ts
 * @description Pi 会话协议适配器：把 Pi JSONL 记录映射为标准化遥测事件。
 *
 * 契约：
 * 1. 只处理 Pi 专有字段结构（session / model_change / message / toolResult）；
 * 2. 手势字典、标题格式化、上下文记账等原语一律复用 `protocols/shared.ts`；
 * 3. 脏文本解码统一走 `safeDecodeUri`，杜绝分支内嵌套 try/catch。
 */

import { basename } from 'pathe'
import { isString } from 'radash'
import type { TelemetryActor, TelemetryEvent } from '../../types/telemetry'
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
 * 处理 Pi 会话头部及模型变更元数据
 */
export function handlePiMetadata(record: Record<string, unknown>, ctx: ParserContext): boolean {
  if (record.type === 'session') {
    ctx.isPiSession = true
    ctx.session.format = 'pi'
    if (isString(record.id)) ctx.session.id = record.id
    if (typeof record.version === 'number' || isString(record.version)) {
      ctx.session.version = record.version
    }
    if (isString(record.timestamp)) ctx.session.timestamp = record.timestamp
    if (isString(record.cwd)) {
      ctx.session.cwd = record.cwd
      ctx.session.cwdBase = basename(record.cwd)
    }
    return true
  }

  if (record.type === 'model_change') {
    ctx.isPiSession = true
    ctx.session.format = 'pi'
    if (isString(record.provider)) ctx.session.provider = record.provider
    if (isString(record.modelId)) ctx.session.modelId = record.modelId
    return true
  }

  return false
}

/**
 * 处理 Pi 用户轮次消息
 */
export function handlePiUserMessage(
  record: Record<string, unknown>,
  msg: Record<string, unknown>,
  msgId: string,
  parentMsgId: string | undefined,
  ctx: ParserContext
): void {
  ctx.turnCounter++
  let userText = extractTextContent(msg.content)

  // 若用户输入包含 URL 编码的中文路径（如 %E8%85%BE...），安全解码为可读文本
  userText = safeDecodeUri(userText)

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
    timestamp: isString(record.timestamp) ? new Date(record.timestamp).getTime() : Date.now(),
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
 * 处理 Pi 助手回复、思考及工具调用
 */
export function handlePiAssistantMessage(
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
  const timestamp = isString(record.timestamp) ? new Date(record.timestamp).getTime() : Date.now()

  for (let i = 0; i < content.length; i++) {
    const block = content[i]
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>

    if (b.type === 'thinking' && isString(b.thinking)) {
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

    if (b.type === 'text' && isString(b.text) && b.text.trim()) {
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
export function handlePiToolResult(
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
    if (isString(record.id)) {
      ctx.idAliasMap.set(record.id, targetEvent.nodeId)
    }
    ctx.lastEventId = targetEvent.nodeId
  }

  updateToolResultInPrompt(ctx, toolCallId, outputLines)
}

/**
 * 处理 Pi 协议消息分发
 */
export function handlePiMessage(record: Record<string, unknown>, ctx: ParserContext): boolean {
  if (record.type !== 'message' || !record.message || typeof record.message !== 'object') {
    return false
  }

  ctx.isPiSession = true
  ctx.session.format = 'pi'
  const msg = record.message as Record<string, unknown>
  const role = String(msg.role || '')
  const msgId = isString(record.id) ? record.id : `msg-${++ctx.turnCounter}`
  const rawParentMsgId = isString(record.parentId) ? record.parentId : ctx.lastEventId
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
