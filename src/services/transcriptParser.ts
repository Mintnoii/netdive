/**
 * NetDive Transcript Parser Engine
 * 契约驱动的 Pi / Claude Code 会话历史 JSONL 解析引擎
 * 将本地或离线 JSONL 会话流水秒级规约为 NetDive 标准 TelemetryEvent[] 拓扑序列
 */

import { tryit, sift } from 'radash'
import { basename } from 'pathe'
import type { Node, Edge } from '@xyflow/react'
import type {
  TelemetryActor,
  TelemetryEvent,
  TelemetryGesture,
} from '../types/telemetry'
import { normalizeObservationOutput } from '../types/telemetry'
import type { AgentNodeData } from '../components/AgentNode'

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
}

/**
 * 将工具名称规约为 NetDive 标准手势类型
 */
export function mapToolNameToGesture(toolName?: string): TelemetryGesture {
  if (!toolName) return 'think'
  const name = toolName.toLowerCase()

  if (
    name === 'bash' ||
    name === 'exec' ||
    name === 'command' ||
    name === 'terminal' ||
    name === 'sh'
  ) {
    return 'bash'
  }

  if (
    name === 'edit' ||
    name === 'write' ||
    name === 'notebookedit' ||
    name === 'patch' ||
    name === 'apply_diff'
  ) {
    return 'edit'
  }

  if (
    name === 'read' ||
    name === 'grep' ||
    name === 'glob' ||
    name === 'find' ||
    name === 'source_check' ||
    name === 'fetch_content' ||
    name === 'web_search' ||
    name === 'websearch' ||
    name === 'webfetch'
  ) {
    return 'read'
  }

  if (
    name.startsWith('memory') ||
    name === 'scratchpad' ||
    name === 'honcho'
  ) {
    return 'memory'
  }

  if (
    name === 'gate' ||
    name === 'askuserquestion' ||
    name === 'approval' ||
    name === 'confirm'
  ) {
    return 'gate'
  }

  return 'think'
}

/**
 * 依据工具名与入参生成精炼的标题
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

/**
 * 核心：解析 Pi / Claude JSONL 文本为标准 TelemetryEvent[] 拓扑序列
 */
export function parseTranscript(jsonlText: string): ParsedTranscript {
  const lines = jsonlText.split(/\r?\n/)

  const session: SessionMetadata = {
    id: `session-${Date.now()}`,
    totalTurns: 0,
    totalTools: 0,
    format: 'generic',
  }

  const events: TelemetryEvent[] = []
  const toolCallEventMap = new Map<string, TelemetryEvent>()
  const idAliasMap = new Map<string, string>()

  let lastEventId: string | undefined
  let turnCounter = 0
  let isPiSession = false
  let isClaudeSession = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) {
      continue
    }

    const [err, record] = tryit(JSON.parse)(line) as [Error | undefined, Record<string, unknown>]
    if (err || !record || typeof record !== 'object') {
      continue
    }

    // 1. 先验探测：若本身已是 NetDive TelemetryEvent 单条记录
    if (
      typeof record.nodeId === 'string' &&
      typeof record.type === 'string' &&
      typeof record.traceId === 'string'
    ) {
      events.push(record as unknown as TelemetryEvent)
      lastEventId = record.nodeId
      continue
    }

    // 2. Pi 格式：session 头部元数据
    if (record.type === 'session') {
      isPiSession = true
      session.format = 'pi'
      if (typeof record.id === 'string') session.id = record.id
      if (typeof record.version === 'number' || typeof record.version === 'string') {
        session.version = record.version
      }
      if (typeof record.timestamp === 'string') session.timestamp = record.timestamp
      if (typeof record.cwd === 'string') {
        session.cwd = record.cwd
        session.cwdBase = basename(record.cwd)
      }
      continue
    }

    // 3. Pi 格式：model_change 记录
    if (record.type === 'model_change') {
      isPiSession = true
      session.format = 'pi'
      if (typeof record.provider === 'string') session.provider = record.provider
      if (typeof record.modelId === 'string') session.modelId = record.modelId
      continue
    }

    // 4. Claude Code 格式元数据：last-prompt / attachment
    if (record.type === 'last-prompt' && typeof record.sessionId === 'string') {
      isClaudeSession = true
      session.format = 'claude'
      session.id = record.sessionId
      session.sessionId = record.sessionId
      continue
    }

    if (record.type === 'attachment') {
      isClaudeSession = true
      session.format = 'claude'
      if (typeof record.sessionId === 'string') session.sessionId = record.sessionId
      if (typeof record.cwd === 'string') {
        session.cwd = record.cwd
        session.cwdBase = basename(record.cwd)
      }
      if (typeof record.gitBranch === 'string') session.gitBranch = record.gitBranch
      if (typeof record.version === 'string') session.version = record.version
      continue
    }

    // 5. Pi 消息格式：{"type":"message", "id":"...", "parentId":"...", "message":{...}}
    if (record.type === 'message' && record.message && typeof record.message === 'object') {
      isPiSession = true
      session.format = 'pi'
      const msg = record.message as Record<string, unknown>
      const role = String(msg.role || '')
      const msgId = typeof record.id === 'string' ? record.id : `msg-${++turnCounter}`
      const rawParentMsgId = typeof record.parentId === 'string' ? record.parentId : lastEventId
      const parentMsgId = (rawParentMsgId && idAliasMap.get(rawParentMsgId)) || rawParentMsgId

      // 5.1 用户输入 (User Turn)
      if (role === 'user') {
        turnCounter++
        const userText = extractTextContent(msg.content)
        const event: TelemetryEvent = {
          traceId: session.id,
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
        events.push(event)
        idAliasMap.set(msgId, msgId)
        lastEventId = msgId
        continue
      }

      // 5.2 助手回复 / 思考 / 工具调用 (Assistant Turn)
      if (role === 'assistant') {
        turnCounter++
        const content = msg.content

        if (Array.isArray(content)) {
          let stepParentId = parentMsgId

          for (let i = 0; i < content.length; i++) {
            const block = content[i]
            if (!block || typeof block !== 'object') continue
            const b = block as Record<string, unknown>

            // 思考块
            if (b.type === 'thinking' && typeof b.thinking === 'string') {
              const thinkNodeId = `${msgId}-think-${i}`
              const event: TelemetryEvent = {
                traceId: session.id,
                nodeId: thinkNodeId,
                parentId: stepParentId,
                type: 'node_complete',
                gesture: 'think',
                actor: (session.modelId || 'Pi (Coordinator)') as TelemetryActor,
                title: '目标规划与分解',
                status: 'completed',
                delta: b.thinking,
                timestamp: typeof record.timestamp === 'string' ? new Date(record.timestamp).getTime() : Date.now(),
              }
              events.push(event)
              idAliasMap.set(msgId, thinkNodeId)
              stepParentId = thinkNodeId
              lastEventId = thinkNodeId
              continue
            }

            // 文本输出块
            if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
              const textNodeId = `${msgId}-text-${i}`
              const event: TelemetryEvent = {
                traceId: session.id,
                nodeId: textNodeId,
                parentId: stepParentId,
                type: 'node_complete',
                gesture: 'think',
                actor: (session.modelId || 'Pi (Coordinator)') as TelemetryActor,
                title: '决策输出与复盘',
                status: 'completed',
                delta: b.text,
                timestamp: typeof record.timestamp === 'string' ? new Date(record.timestamp).getTime() : Date.now(),
              }
              events.push(event)
              idAliasMap.set(msgId, textNodeId)
              stepParentId = textNodeId
              lastEventId = textNodeId
              continue
            }

            // 工具调用块
            if (b.type === 'toolCall') {
              session.totalTools++
              const toolName = String(b.name || 'tool')
              const toolCallId = String(b.id || `${msgId}-tool-${i}`)
              const toolArgs = (b.arguments && typeof b.arguments === 'object' ? b.arguments : {}) as Record<string, unknown>
              const gesture = mapToolNameToGesture(toolName)
              const title = formatToolTitle(toolName, toolArgs)

              const event: TelemetryEvent = {
                traceId: session.id,
                nodeId: toolCallId,
                parentId: stepParentId,
                type: 'node_complete',
                gesture,
                actor: 'Claude 3.7 (Worker)',
                title,
                status: 'running',
                payload: toolArgs,
                delta: `调用 ${toolName}`,
                timestamp: typeof record.timestamp === 'string' ? new Date(record.timestamp).getTime() : Date.now(),
              }
              events.push(event)
              toolCallEventMap.set(toolCallId, event)
              idAliasMap.set(msgId, toolCallId)
              stepParentId = toolCallId
              lastEventId = toolCallId
              continue
            }
          }
        }
        continue
      }

      // 5.3 工具执行返回 (Tool Result Turn)
      if (role === 'toolResult') {
        const toolCallId = String(record.toolCallId || msg.toolCallId || '')
        const isError = Boolean(record.isError ?? msg.isError)
        const toolContent = msg.content ?? record.content
        const outputLines = normalizeObservationOutput(toolContent)
        const exitCode = isError ? 1 : 0

        const targetEvent = toolCallEventMap.get(toolCallId)
        if (targetEvent) {
          targetEvent.status = isError ? 'failed' : 'completed'
          targetEvent.isCorrectionBranch = isError
          targetEvent.observation = {
            exitCode,
            output: outputLines,
            command: (targetEvent.payload?.command as string) || undefined,
          }
          if (outputLines.length > 0) {
            targetEvent.delta = outputLines.slice(0, 3).join('\n')
          }
          if (typeof record.id === 'string') {
            idAliasMap.set(record.id, targetEvent.nodeId)
          }
          lastEventId = targetEvent.nodeId
        }
        continue
      }
    }

    // 6. Claude Code 消息格式：{"type":"user"|"assistant", "uuid":"...", "message":{...}}
    if (record.type === 'user' || record.type === 'assistant') {
      isClaudeSession = true
      session.format = 'claude'
      const msg = record.message as Record<string, unknown> | undefined
      if (!msg) continue

      const uuid = typeof record.uuid === 'string' ? record.uuid : `cl-${++turnCounter}`
      const rawParentUuid = typeof record.parentUuid === 'string' ? record.parentUuid : lastEventId
      const parentUuid = (rawParentUuid && idAliasMap.get(rawParentUuid)) || rawParentUuid

      // 6.1 Claude 工具执行返回：role === 'user' 且 content 中含有 tool_result
      if (record.type === 'user' && Array.isArray(msg.content)) {
        const toolResultBlock = msg.content.find(
          (b) => b && typeof b === 'object' && (b as Record<string, unknown>).type === 'tool_result'
        ) as Record<string, unknown> | undefined

        if (toolResultBlock) {
          const toolCallId = String(toolResultBlock.tool_use_id || '')
          const isError = Boolean(toolResultBlock.is_error)
          const outputLines = normalizeObservationOutput(toolResultBlock.content)
          const exitCode = isError ? 1 : 0

          const targetEvent = toolCallEventMap.get(toolCallId)
          if (targetEvent) {
            targetEvent.status = isError ? 'failed' : 'completed'
            targetEvent.isCorrectionBranch = isError
            targetEvent.observation = {
              exitCode,
              output: outputLines,
              command: (targetEvent.payload?.command as string) || undefined,
            }
            if (outputLines.length > 0) {
              targetEvent.delta = outputLines.slice(0, 3).join('\n')
            }
            idAliasMap.set(uuid, targetEvent.nodeId)
            lastEventId = targetEvent.nodeId
          }
          continue
        }

        // 普通用户提示词
        turnCounter++
        const userText = extractTextContent(msg.content)
        const event: TelemetryEvent = {
          traceId: session.id,
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
        events.push(event)
        idAliasMap.set(uuid, uuid)
        lastEventId = uuid
        continue
      }

      // 6.2 Claude 助手回复与工具调用
      if (record.type === 'assistant' && Array.isArray(msg.content)) {
        turnCounter++
        let stepParentId = parentUuid

        for (let i = 0; i < msg.content.length; i++) {
          const block = msg.content[i]
          if (!block || typeof block !== 'object') continue
          const b = block as Record<string, unknown>

          // 思考块
          if (b.type === 'thinking' && typeof b.thinking === 'string') {
            const thinkNodeId = `${uuid}-think-${i}`
            const event: TelemetryEvent = {
              traceId: session.id,
              nodeId: thinkNodeId,
              parentId: stepParentId,
              type: 'node_complete',
              gesture: 'think',
              actor: 'Claude 3.7 (Worker)',
              title: '内部推演与反思',
              status: 'completed',
              delta: b.thinking,
              timestamp: typeof record.timestamp === 'string' ? new Date(record.timestamp).getTime() : Date.now(),
            }
            events.push(event)
            idAliasMap.set(uuid, thinkNodeId)
            stepParentId = thinkNodeId
            lastEventId = thinkNodeId
            continue
          }

          // 文本块
          if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
            const textNodeId = `${uuid}-text-${i}`
            const event: TelemetryEvent = {
              traceId: session.id,
              nodeId: textNodeId,
              parentId: stepParentId,
              type: 'node_complete',
              gesture: 'think',
              actor: 'Claude 3.7 (Worker)',
              title: '模型执行分析',
              status: 'completed',
              delta: b.text,
              timestamp: typeof record.timestamp === 'string' ? new Date(record.timestamp).getTime() : Date.now(),
            }
            events.push(event)
            idAliasMap.set(uuid, textNodeId)
            stepParentId = textNodeId
            lastEventId = textNodeId
            continue
          }

          // Claude tool_use 块
          if (b.type === 'tool_use') {
            session.totalTools++
            const toolName = String(b.name || 'tool')
            const toolCallId = String(b.id || `${uuid}-tool-${i}`)
            const toolArgs = (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>
            const gesture = mapToolNameToGesture(toolName)
            const title = formatToolTitle(toolName, toolArgs)

            const event: TelemetryEvent = {
              traceId: session.id,
              nodeId: toolCallId,
              parentId: stepParentId,
              type: 'node_complete',
              gesture,
              actor: 'Claude 3.7 (Worker)',
              title,
              status: 'running',
              payload: toolArgs,
              delta: `执行 ${toolName}`,
              timestamp: typeof record.timestamp === 'string' ? new Date(record.timestamp).getTime() : Date.now(),
            }
            events.push(event)
            toolCallEventMap.set(toolCallId, event)
            idAliasMap.set(uuid, toolCallId)
            stepParentId = toolCallId
            lastEventId = toolCallId
            continue
          }
        }
        continue
      }
    }
  }

  // 终态兜底：若有仍处于 running 状态且未显式报错的 tool_use，标为 completed
  for (const event of events) {
    if (event.status === 'running') {
      event.status = 'completed'
      if (!event.observation) {
        event.observation = { exitCode: 0, output: [] }
      }
    }
  }

  session.totalTurns = turnCounter || events.length
  if (isPiSession) session.format = 'pi'
  else if (isClaudeSession) session.format = 'claude'

  return { session, events }
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

  if (ev.gesture === 'read') {
    const targetPath = (ev.payload?.path || ev.payload?.file_path || ev.payload?.filePath) as
      | string
      | undefined
    if (targetPath) {
      return `read:${basename(targetPath)}`
    }
    if (typeof ev.payload?.pattern === 'string') {
      return `read:pattern:${ev.payload.pattern}`
    }
    return 'read:general'
  }

  if (ev.gesture === 'edit') {
    const targetPath = (ev.payload?.path || ev.payload?.file_path || ev.payload?.filePath) as
      | string
      | undefined
    if (targetPath) {
      return `edit:${basename(targetPath)}`
    }
    return 'edit:general'
  }

  if (ev.gesture === 'bash') {
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

  if (gesture === 'read') {
    const targetPath = (group[0].payload?.path ||
      group[0].payload?.file_path ||
      group[0].payload?.filePath) as string | undefined
    if (targetPath) {
      return `read: ${basename(targetPath)} (x${count})`
    }
    if (typeof group[0].payload?.pattern === 'string') {
      return `rg "${group[0].payload.pattern}" (x${count})`
    }
    return `read: 连续读取 (x${count})`
  }

  if (gesture === 'edit') {
    const targetPath = (group[0].payload?.path ||
      group[0].payload?.file_path ||
      group[0].payload?.filePath) as string | undefined
    if (targetPath) {
      return `edit: ${basename(targetPath)} (x${count})`
    }
    return `edit: 连续编辑 (x${count})`
  }

  if (gesture === 'bash') {
    const commands = sift(
      group.map((e) => String(e.payload?.command || e.observation?.command || '').trim())
    )

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
 * 核心：智能聚合连续同构工具调用
 * - 将同手势、同目标的连续成功工具调用折叠为一个带有 (xN) 标记与聚合详情的主节点
 * - 绝对不折叠任何 exitCode !== 0 或 status === 'failed' 的单测/异常自愈节点
 * - 当 options.enabled 为 false 时，精确无损保留原始展开序列
 * - 自动重写后续节点的 parentId，确保因果 DAG 连接完整无断链
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
  let currentKey: string | null = null

  const flushGroup = () => {
    if (currentGroup.length === 0) return

    if (currentGroup.length === 1) {
      result.push(currentGroup[0])
    } else {
      const first = currentGroup[0]
      const count = currentGroup.length

      // 注册所有被吸收的子节点 ID 别名映射到聚合主节点 ID
      for (const item of currentGroup) {
        idAliasMap.set(item.nodeId, first.nodeId)
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

      const gesture = first.gesture || 'think'
      const title = formatAggregatedTitle(gesture, currentGroup)

      const aggEvent: TelemetryEvent = {
        ...first,
        nodeId: first.nodeId,
        parentId: first.parentId,
        title,
        status: 'completed',
        delta: `连续执行 ${count} 次 ${gesture} 调用已聚合`,
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
        },
        observation: {
          exitCode: 0,
          output: allOutputs,
          command: commands.length > 0 ? commands.join(' && ') : undefined,
          aggregatedCount: count,
        },
      }

      result.push(aggEvent)
    }

    currentGroup = []
    currentKey = null
  }

  for (const ev of events) {
    const key = getToolTargetKey(ev)
    if (key !== null && key === currentKey) {
      currentGroup.push(ev)
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

/**
 * 将解析出的 TelemetryEvent[] 序列计算为 React Flow 所需的 Node[] 与 Edge[]
 * 自动根据单向因果主干与自愈分叉计算水平布局与琥珀金分支线
 */
export function eventsToFlowNodesAndEdges(events: TelemetryEvent[]): {
  nodes: Node[]
  edges: Edge[]
} {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const nodeMap = new Map<string, Node>()

  let currentX = 50
  const STEP_X = 280
  const BASE_Y = 180
  const BRANCH_Y = 340

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    const parentNode = ev.parentId ? nodeMap.get(ev.parentId) : undefined

    let posX: number
    if (parentNode) {
      posX = Math.max(currentX, parentNode.position.x + STEP_X)
    } else {
      posX = currentX
    }
    currentX = posX + STEP_X

    const posY = ev.isCorrectionBranch ? BRANCH_Y : BASE_Y

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
      nodeSummary = ev.delta
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
      const outputLines = Array.isArray(ev.observation.output)
        ? ev.observation.output
        : [String(ev.observation.output)]
      nodeSummary = outputLines.slice(0, 3).join('\n')
    }

    const nodeData: AgentNodeData = {
      title: ev.title || '执行节点',
      actor: ev.actor || 'Pi (Coordinator)',
      gesture: ev.gesture || 'think',
      status: ev.status || 'completed',
      summary: nodeSummary,
      isCorrectionBranch: ev.isCorrectionBranch,
      observation: ev.observation,
      payload: ev.payload,
      assertion: ev.assertion,
      isAggregated: ev.isAggregated,
      aggregateCount: ev.aggregateCount,
      aggregatedEvents: ev.aggregatedEvents,
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
