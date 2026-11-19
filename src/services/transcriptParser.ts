/**
 * @file src/services/transcriptParser.ts
 * @description NetDive Transcript Parser Engine：Pi / Claude Code JSONL 会话流水解析编排层。
 *
 * 分层契约：
 * 1. 本文件只负责「协议分发 + 事件聚合 + 拓扑排版」，不再承载协议字段映射细节；
 * 2. 共享解析原语收敛于 `protocols/shared.ts`，协议适配器分别位于 `protocols/pi.ts` / `protocols/claude.ts`；
 * 3. 对外公共 API（手势映射、标题格式化、usage 提取等）由本文件统一转出，保持调用方零改动。
 */

import { tryit, sift, unique , isString } from 'radash'
import { basename } from 'pathe'
import type { Node, Edge } from '@xyflow/react'
import type {
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
import { normalizeObservationOutput } from '../types/telemetry'
import { AGENT_NODE_WIDTH, type AgentNodeData } from '../components/AgentNode'
import { resolveContextWindow, effectiveContextWindow } from './modelWindows'
import { deriveNodeFacets, estimateFacetTokens } from './nodeFacets'
import { NEUTRAL_EDGE_STROKE, TONE_STROKE, TURN_FAILED_EDGE_STROKE } from './statusTone'
import {
  FLOW_LAYOUT,
  TURN_GRID,
  createFlowEdge,
  isBranchEdgeBetween,
  wrapGridPosition,
} from './flowLayout'
import {
  handleSystemMessage,
  mapSectionKeyToPartKind,
  safeDecodeUri,
  type ExtractedUsage,
  type ParserContext,
  type SessionMetadata,
} from './protocols/shared'
import { handlePiMessage, handlePiMetadata } from './protocols/pi'
import { handleClaudeMessage, handleClaudeMetadata } from './protocols/claude'

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

// 对外公共 API 转出：调用方继续从 transcriptParser 引入，无需感知协议分层
export {
  mapToolNameToGesture,
  formatToolTitle,
  extractUsageFromRecord,
} from './protocols/shared'
export type { ExtractedUsage, ParserContext, SessionMetadata } from './protocols/shared'
export { extractRealIntent } from './agentNodeLOD'

/** 完整 Transcript 解析结果 */
export interface ParsedTranscript {
  session: SessionMetadata
  events: TelemetryEvent[]
  watermark?: ContextWatermark
}











































/**
 * 对单条已反序列化的会话 JSON 对象执行流式分发解析
 */
function processTranscriptRecord(record: Record<string, unknown>, ctx: ParserContext): void {
  // 1. 先验探测：若本身已是 NetDive TelemetryEvent 单条记录
  if (
    isString(record.nodeId) &&
    isString(record.type) &&
    isString(record.traceId)
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
  const effective = effectiveContextWindow(resolvedWindow, totalTokens)

  const watermark: ContextWatermark = {
    totalLimit: effective.window,
    maxCapacity: effective.window,
    windowSource: resolvedWindow.source,
    windowClamped: effective.clamped,
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
    window: watermark.maxCapacity ?? watermark.totalLimit,
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
      if (isString(ev.payload?.pattern)) {
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
    if (isString(group[0].payload?.pattern)) {
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


  // 遵循第一性真实性：取消粗暴硬截断，全量保留因果事件，依托多行流式网格与折叠聚合自然收敛 DOM 压力
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    const parentNode = ev.parentId ? nodeMap.get(ev.parentId) : undefined

    // 多行折行网格坐标统一由 flowLayout 单一真源提供
    const position = wrapGridPosition(i, ev.isCorrectionBranch, options)

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
    } else if (ev.delta && isString(ev.delta)) {
      nodeSummary = ev.delta.length > 300 ? `${ev.delta.slice(0, 300)}...` : ev.delta
    } else if (ev.payload) {
      if (isString(ev.payload.command)) {
        nodeSummary = `$ ${ev.payload.command}`
      } else if (isString(ev.payload.path)) {
        nodeSummary = `文件: ${ev.payload.path}`
      } else if (isString(ev.payload.pattern)) {
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

    const facets = deriveNodeFacets(ev)
    const toolTokens =
      (typeof ev.observation?.tokens === 'number' ? ev.observation.tokens : 0) ||
      (typeof ev.payload?.prunableTokens === 'number' ? (ev.payload.prunableTokens as number) : 0) ||
      estimateFacetTokens(facets)

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
      pruned: ev.pruned,
      reclaimedTokens: ev.reclaimedTokens || (ev.payload?.reclaimedTokens as number | undefined),
      walPointerId: (ev.payload?.walPointerId as string) || (ev.payload?.pointerId as string) || undefined,
      prunableTokens: toolTokens || undefined,
      ...facets,
    }

    const node: Node = {
      id: ev.nodeId,
      type: 'agentNode',
      position,
      data: nodeData,
      width: AGENT_NODE_WIDTH,
      height: 140,
      initialWidth: AGENT_NODE_WIDTH,
      initialHeight: 140,
    }

    nodes.push(node)
    nodeMap.set(ev.nodeId, node)

    // 构建因果边 (严格校验首尾节点均在当前集合中存在，杜绝悬空边与多余残留)
    if (ev.parentId && nodeMap.has(ev.parentId) && nodeMap.has(ev.nodeId)) {
      const isBranchEdge = isBranchEdgeBetween(ev, parentNode)
      edges.push(
        createFlowEdge({
          source: ev.parentId,
          target: ev.nodeId,
          isBranchEdge,
          // 回放为静态态：仅自愈分支保持流动感，与终态语义一致
          animated: isBranchEdge,
        })
      )
    }
  }

  return { nodes, edges }
}

/**
 * 提取精炼的核心意图首句
 */
function extractIntentSentence(text?: string): string {
  if (!text) return ''
  // 1. 若包含 URL 编码的中文字符（如 %E8%85%BE%E8%AE%AF），统一走共享安全解码原语
  const decoded = safeDecodeUri(text)

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

  const START_X = FLOW_LAYOUT.startX
  const BASE_Y = actualOptions.baseY ?? TURN_GRID.baseY
  const ROW_GAP = actualOptions.rowGap ?? TURN_GRID.rowGap
  const NODES_PER_ROW = actualOptions.nodesPerRow ?? TURN_GRID.nodesPerRow
  const COLLAPSED_WIDTH = 320
  const EXPANDED_WIDTH = 460
  const STEP_X = actualOptions.stepX ?? TURN_GRID.stepX
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
        width: nodeWidth,
        height: 120,
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
      ? TURN_FAILED_EDGE_STROKE
      : isBranch || isGate
        ? TONE_STROKE.branching
        : NEUTRAL_EDGE_STROKE

    edges.push({
      id: `e-${prevTurn.turnId}-${turn.turnId}`,
      source: prevTurn.turnId,
      target: turn.turnId,
      type: 'smoothstep',
      animated: isBranch || turn.status === 'running',
      zIndex: 10,
      style: {
        stroke: strokeColor,
        strokeWidth: 2,
        strokeDasharray: isBranch ? '5 4' : undefined,
      },
    })
  }

  return { nodes, edges }
}

