import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import {
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from '@xyflow/react'
import type { AgentNodeData } from '../components/AgentNode'
import type {
  GateDecision,
  GatePromptPayload,
  TelemetryEvent,
  TelemetryGesture,
  TelemetryObservation,
  TelemetryStatus,
  ContextWatermark,
  PrunableItem,
  ActiveSessionItem,
} from '../types/telemetry'
import {
  BASE_CONTEXT_WATERMARK,
  formatTokens,
  normalizeObservationOutput,
  normalizeTelemetryObservation,
  resolveSessionId,
  resolveSessionTitle,
} from '../types/telemetry'
import { gateManager } from '../services/gateManager'
import { assertionEngine } from '../services/assertionEngine'
export { assertionEngine } from '../services/assertionEngine'
export { microCompactor, MicroCompactor } from '../services/microCompactor'
import { microCompactor } from '../services/microCompactor'
import {
  useBridgeConnection,
} from './useBridgeConnection'
export { useBridgeConnection, type UseBridgeConnectionReturn } from './useBridgeConnection'

export interface WatermarkDelta {
  activeTurns?: number
  prunableTools?: number
}

/** 单个会话的数据隔离模型 */
export interface SessionData {
  id: string
  title: string
  actors: string[]
  status: TelemetryStatus
  updatedAt: number
  project?: string
  nodes: Node[]
  edges: Edge[]
  lastNodeId?: string
  watermark?: ContextWatermark
  isPruned?: boolean
  reclaimedTokens?: number
}

/** 因果链解析结果契约 */
export interface CausalChainResolution {
  effectiveParentId?: string
  edge?: Edge
  isRoot: boolean
}

/**
 * 依据动作手势与执行观测结果计算单步 Token 水位动态增量
 */
export function getDynamicWatermarkDelta(item?: {
  gesture?: TelemetryGesture
  observation?: TelemetryObservation
  status?: TelemetryStatus
  isGate?: boolean
  watermarkDelta?: WatermarkDelta
} | null): WatermarkDelta {
  if (!item) {
    return { activeTurns: 2000, prunableTools: 0 }
  }
  if (item.watermarkDelta) {
    return item.watermarkDelta
  }
  if (item.isGate || item.gesture === 'gate') {
    return { activeTurns: 500, prunableTools: 0 }
  }
  switch (item.gesture) {
    case 'think':
      return { activeTurns: 3000, prunableTools: 0 }
    case 'read':
      return { activeTurns: 1500, prunableTools: 8000 }
    case 'edit':
      return { activeTurns: 3500, prunableTools: 12000 }
    case 'bash': {
      const outputLines = normalizeObservationOutput(item.observation?.output)
      const hasHeavyOutput = outputLines.length > 0
      return {
        activeTurns: 3000,
        prunableTools: hasHeavyOutput ? 16000 : 12000,
      }
    }
    case 'memory':
      return { activeTurns: 2000, prunableTools: 1000 }
    default:
      return { activeTurns: 2000, prunableTools: 0 }
  }
}

/**
 * 依据 OpenTelemetry Active Span 模式解析时序因果建链
 * 显式 parentId 优先，缺失时自动回退同一 session 的上一活跃节点 (lastNodeId)
 * 无任何 parent 时作为根节点 (isRoot = true)
 */
export function resolveCausalConnection(
  event: Partial<TelemetryEvent>,
  existingNodes: Node[] = [],
  lastNodeId?: string
): CausalChainResolution {
  const explicitParent = event.parentId?.trim()
  const fallbackParent = lastNodeId?.trim()

  const candidateParent =
    explicitParent && explicitParent !== event.nodeId
      ? explicitParent
      : fallbackParent && fallbackParent !== event.nodeId
        ? fallbackParent
        : undefined

  if (!candidateParent || !event.nodeId) {
    return {
      effectiveParentId: undefined,
      edge: undefined,
      isRoot: true,
    }
  }

  const parentNode = existingNodes.find((n) => n.id === candidateParent)
  const isParentCorrection = Boolean(
    (parentNode?.data as unknown as AgentNodeData)?.isCorrectionBranch
  )
  const isCurrentCorrection = Boolean(event.isCorrectionBranch)
  const isBranchEdge = isCurrentCorrection || isParentCorrection

  const edgeStyle = isBranchEdge
    ? { stroke: '#D97706', strokeWidth: 1.5, strokeDasharray: '5 4' }
    : event.status === 'failed'
      ? { stroke: '#DC2626', strokeWidth: 2 }
      : { stroke: '#8F887D', strokeWidth: 1.5 }

  const edge: Edge = {
    id: `e-${candidateParent}-${event.nodeId}`,
    source: candidateParent,
    target: event.nodeId,
    type: 'smoothstep',
    animated: event.status === 'running' || !event.status,
    style: edgeStyle,
  }

  return {
    effectiveParentId: candidateParent,
    edge,
    isRoot: false,
  }
}

/**
 * 计算节点在当前 session 画布上的 X/Y 坐标
 * 主干向右顺延，自愈分支向右下沉
 */
export function calculateNodePosition(
  event: Partial<TelemetryEvent>,
  effectiveParentId: string | undefined,
  existingNodes: Node[]
): { x: number; y: number } {
  const parentNode = effectiveParentId
    ? existingNodes.find((n) => n.id === effectiveParentId)
    : undefined

  const posX = parentNode
    ? parentNode.position.x + 280
    : 50 + existingNodes.length * 280

  const posY = event.isCorrectionBranch ? 340 : 180
  return { x: posX, y: posY }
}

export const DEFAULT_SESSION_ID = 'default-session'
export const DEFAULT_SESSION_TITLE = 'Ghost pipeline 异常治理与因果拓扑'
export const SELF_CORRECTION_SESSION_ID = 'self-correction-session'
export const SELF_CORRECTION_SESSION_TITLE = 'Ghost pipeline 单测自愈分叉演练'

/**
 * 构建初始 Session 模型
 */
export function createInitialSession(
  id: string,
  event?: Partial<TelemetryEvent>,
  initialNodes: Node[] = [],
  initialEdges: Edge[] = [],
  initialWatermark: ContextWatermark = BASE_CONTEXT_WATERMARK
): SessionData {
  const title = event
    ? resolveSessionTitle(event)
    : id === DEFAULT_SESSION_ID
      ? DEFAULT_SESSION_TITLE
      : id === SELF_CORRECTION_SESSION_ID
        ? SELF_CORRECTION_SESSION_TITLE
        : `会话 ${id}`

  const actor = event?.actor
    ? [event.actor]
    : initialNodes.length > 0
      ? ['Pi (Coordinator)', 'Claude 3.7 (Worker)', 'Human Operator']
      : []

  const lastNodeId = initialNodes[initialNodes.length - 1]?.id

  return {
    id,
    title,
    actors: actor,
    status:
      event?.status ||
      (initialNodes.some(
        (n) => (n.data as unknown as AgentNodeData)?.status === 'gate'
      )
        ? 'gate'
        : 'completed'),
    updatedAt: event?.timestamp || Date.now(),
    project: event?.project || (id === 'default-session' ? 'ghost' : undefined),
    nodes: initialNodes,
    edges: initialEdges,
    lastNodeId,
    watermark: event?.watermark || initialWatermark,
    isPruned: false,
    reclaimedTokens: 0,
  }
}

/**
 * 单个 Session 的状态机推进纯函数 (零副作用)
 */
export function processEventForSession(
  session: SessionData,
  event: TelemetryEvent
): SessionData {
  const updatedAt = event.timestamp || Date.now()
  const project = event.project || session.project
  const actors =
    event.actor && !session.actors.includes(event.actor)
      ? [...session.actors, event.actor]
      : session.actors

  const title =
    event.sessionTitle?.trim() ||
    (session.title.startsWith('会话 ') && (event.sessionTitle || event.title)
      ? resolveSessionTitle(event)
      : session.title)

  switch (event.type) {
    case 'node_start': {
      const normalizedObs = normalizeTelemetryObservation(event.observation)
      const eventWithNormalized = normalizedObs
        ? { ...event, observation: normalizedObs }
        : event
      const assertion =
        event.assertion || assertionEngine.evaluate(eventWithNormalized)
      let initialStatus: TelemetryStatus = event.status || 'running'
      if (assertion.triggerGate && initialStatus !== 'rejected') {
        initialStatus = 'gate'
      }

      const exists = session.nodes.some((n) => n.id === event.nodeId)
      if (exists) {
        return {
          ...session,
          title,
          actors,
          project,
          updatedAt,
          status: initialStatus,
          lastNodeId: event.nodeId,
        }
      }

      const causal = resolveCausalConnection(
        event,
        session.nodes,
        session.lastNodeId
      )
      const position = calculateNodePosition(
        event,
        causal.effectiveParentId,
        session.nodes
      )

      const newNode: Node = {
        id: event.nodeId,
        type: 'agentNode',
        position,
        data: {
          title: event.title || '任务节点',
          actor: event.actor || 'Pi (Coordinator)',
          gesture: event.gesture || 'think',
          status: initialStatus,
          summary: event.delta || '',
          isCorrectionBranch: event.isCorrectionBranch,
          observation: normalizedObs,
          payload: event.payload,
          assertion,
        } satisfies AgentNodeData,
      }

      const edges =
        causal.edge && !session.edges.some((e) => e.id === causal.edge!.id)
          ? [...session.edges, causal.edge]
          : session.edges

      return {
        ...session,
        title,
        actors,
        project,
        updatedAt,
        status: initialStatus,
        nodes: [...session.nodes, newNode],
        edges,
        lastNodeId: event.nodeId,
      }
    }

    case 'node_stream': {
      const normalizedObs = normalizeTelemetryObservation(event.observation)
      const exists = session.nodes.some((n) => n.id === event.nodeId)
      const status = event.status || session.status

      if (exists) {
        const nextNodes = session.nodes.map((node) => {
          if (node.id !== event.nodeId) return node
          const currentData = node.data as unknown as AgentNodeData
          return {
            ...node,
            data: {
              ...currentData,
              summary: (currentData.summary || '') + (event.delta || ''),
              status: event.status || currentData.status,
              observation: normalizedObs ?? currentData.observation,
              isCorrectionBranch:
                event.isCorrectionBranch ?? currentData.isCorrectionBranch,
            } satisfies AgentNodeData,
          }
        })

        return {
          ...session,
          title,
          actors,
          project,
          updatedAt,
          status,
          nodes: nextNodes,
          lastNodeId: event.nodeId,
        }
      }

      // 宿主直接流式投递（跳过 node_start）
      const causal = resolveCausalConnection(
        event,
        session.nodes,
        session.lastNodeId
      )
      const position = calculateNodePosition(
        event,
        causal.effectiveParentId,
        session.nodes
      )

      const newNode: Node = {
        id: event.nodeId,
        type: 'agentNode',
        position,
        data: {
          title: event.title || '任务节点',
          actor: event.actor || 'Pi (Coordinator)',
          gesture: event.gesture || 'think',
          status: event.status || 'running',
          summary: event.delta || '',
          isCorrectionBranch: event.isCorrectionBranch,
          observation: normalizedObs,
          payload: event.payload,
        } satisfies AgentNodeData,
      }

      const edges =
        causal.edge && !session.edges.some((e) => e.id === causal.edge!.id)
          ? [...session.edges, causal.edge]
          : session.edges

      return {
        ...session,
        title,
        actors,
        project,
        updatedAt,
        status: event.status || 'running',
        nodes: [...session.nodes, newNode],
        edges,
        lastNodeId: event.nodeId,
      }
    }

    case 'node_complete': {
      const normalizedObs = normalizeTelemetryObservation(event.observation)
      const eventWithNormalized = normalizedObs
        ? { ...event, observation: normalizedObs }
        : event
      const assertion =
        event.assertion || assertionEngine.evaluate(eventWithNormalized)

      let targetStatus: TelemetryStatus = event.status || 'completed'
      if (assertion.triggerGate && targetStatus !== 'rejected') {
        targetStatus = 'gate'
      } else if (assertion.triggerSelfCorrection && targetStatus !== 'gate') {
        targetStatus = 'failed'
      }

      const exists = session.nodes.some((n) => n.id === event.nodeId)
      let nextNodes: Node[]
      let nextEdges = session.edges

      if (exists) {
        nextNodes = session.nodes.map((node) => {
          if (node.id !== event.nodeId) return node
          const currentData = node.data as unknown as AgentNodeData
          return {
            ...node,
            data: {
              ...currentData,
              status: targetStatus,
              assertion,
              summary: event.delta
                ? (currentData.summary || '') + event.delta
                : ((event.payload?.summary as string | undefined) ||
                  (event.payload?.plan as string | undefined) ||
                  currentData.summary),
              observation: normalizedObs ?? currentData.observation,
              payload: event.payload ?? currentData.payload,
              isCorrectionBranch:
                event.isCorrectionBranch ?? currentData.isCorrectionBranch,
            } satisfies AgentNodeData,
          }
        })
      } else {
        const causal = resolveCausalConnection(
          event,
          session.nodes,
          session.lastNodeId
        )
        const position = calculateNodePosition(
          event,
          causal.effectiveParentId,
          session.nodes
        )

        const newNode: Node = {
          id: event.nodeId,
          type: 'agentNode',
          position,
          data: {
            title: event.title || '任务节点',
            actor: event.actor || 'Pi (Coordinator)',
            gesture: event.gesture || 'think',
            status: targetStatus,
            summary:
              (event.payload?.summary as string | undefined) ||
              (event.payload?.plan as string | undefined) ||
              event.delta ||
              '',
            isCorrectionBranch: event.isCorrectionBranch,
            observation: normalizedObs,
            payload: event.payload,
            assertion,
          } satisfies AgentNodeData,
        }
        nextNodes = [...session.nodes, newNode]

        if (causal.edge && !nextEdges.some((e) => e.id === causal.edge!.id)) {
          nextEdges = [...nextEdges, { ...causal.edge, animated: false }]
        }
      }

      // 边动画收敛与错误标红
      nextEdges = nextEdges.map((edge) => {
        if (edge.target === event.nodeId) {
          return {
            ...edge,
            animated: false,
            style:
              targetStatus === 'failed'
                ? { stroke: '#DC2626', strokeWidth: 2 }
                : edge.style,
          }
        }
        return edge
      })

      // 水位计算
      const delta = getDynamicWatermarkDelta(event)
      const watermark = event.watermark || {
        ...session.watermark!,
        activeTurns:
          (session.watermark?.activeTurns ?? 0) + (delta.activeTurns ?? 0),
        prunableTools:
          (session.watermark?.prunableTools ?? 0) + (delta.prunableTools ?? 0),
      }

      return {
        ...session,
        title,
        actors,
        project,
        updatedAt,
        status: targetStatus,
        nodes: nextNodes,
        edges: nextEdges,
        lastNodeId: event.nodeId,
        watermark,
      }
    }

    case 'gate_prompt': {
      const normalizedObs = normalizeTelemetryObservation(event.observation)
      const gatePayload: GatePromptPayload = event.gatePayload || {
        gateId: `gate-${event.nodeId}`,
        title: event.title || '决策门禁待审 (HITL)',
        riskLevel: 'high',
        proposedAction: {
          command:
            (typeof event.payload?.command === 'string'
              ? event.payload.command
              : '') ||
            event.title ||
            '敏感动作待人类审批',
          explanation:
            (typeof event.payload?.explanation === 'string'
              ? event.payload.explanation
              : '') || '检测到敏感操作，等待人类批准放行',
        },
        timestamp: new Date().toISOString(),
      }

      const exists = session.nodes.some((n) => n.id === event.nodeId)
      let nextNodes: Node[]
      let nextEdges = session.edges

      if (exists) {
        nextNodes = session.nodes.map((node) => {
          if (node.id !== event.nodeId) return node
          const currentData = node.data as unknown as AgentNodeData
          return {
            ...node,
            data: {
              ...currentData,
              status: 'gate',
              summary: event.delta
                ? (currentData.summary || '') + event.delta
                : ((event.payload?.summary as string | undefined) ||
                  gatePayload.proposedAction?.command ||
                  currentData.summary),
              observation: normalizedObs ?? currentData.observation,
              isCorrectionBranch:
                event.isCorrectionBranch ?? currentData.isCorrectionBranch,
            } satisfies AgentNodeData,
          }
        })
      } else {
        const causal = resolveCausalConnection(
          event,
          session.nodes,
          session.lastNodeId
        )
        const position = calculateNodePosition(
          event,
          causal.effectiveParentId,
          session.nodes
        )

        const newNode: Node = {
          id: event.nodeId,
          type: 'agentNode',
          position,
          data: {
            title: event.title || gatePayload.title || '决策门禁待审 (HITL)',
            actor: event.actor || 'Human Operator',
            gesture: 'gate',
            status: 'gate',
            summary:
              (event.payload?.summary as string | undefined) ||
              gatePayload.proposedAction?.command ||
              '敏感动作待人类审批',
            isCorrectionBranch: event.isCorrectionBranch,
            observation: normalizedObs,
            payload: event.payload,
          } satisfies AgentNodeData,
        }
        nextNodes = [...session.nodes, newNode]

        if (causal.edge && !nextEdges.some((e) => e.id === causal.edge!.id)) {
          nextEdges = [
            ...nextEdges,
            {
              ...causal.edge,
              style: {
                stroke: '#D97706',
                strokeWidth: 1.5,
                strokeDasharray: '4 4',
              },
            },
          ]
        }
      }

      const delta = getDynamicWatermarkDelta(event)
      const watermark = event.watermark || {
        ...session.watermark!,
        activeTurns:
          (session.watermark?.activeTurns ?? 0) + (delta.activeTurns ?? 0),
        prunableTools:
          (session.watermark?.prunableTools ?? 0) + (delta.prunableTools ?? 0),
      }

      return {
        ...session,
        title,
        actors,
        project,
        updatedAt,
        status: 'gate',
        nodes: nextNodes,
        edges: nextEdges,
        lastNodeId: event.nodeId,
        watermark,
      }
    }

    case 'gate_resolved': {
      const decision = event.gateDecision || { action: 'approve' }
      const isRejected = decision?.action === 'reject'
      const isModified = decision?.action === 'modify'
      const newStatus: TelemetryStatus = isRejected ? 'rejected' : 'completed'
      const steering = decision?.modifiedCommand || decision?.feedback

      const nextNodes = session.nodes.map((node) => {
        const isTargetNode =
          node.id === event.nodeId ||
          node.id === event.nodeId.replace(/^gate-/, '') ||
          `gate-${node.id}` === event.nodeId
        if (!isTargetNode) return node
        const currentData = node.data as unknown as AgentNodeData
        let updatedSummary = currentData.summary || ''
        if (isRejected) {
          if (!updatedSummary.includes('[门禁已拦截:')) {
            updatedSummary = `${updatedSummary} [门禁已拦截: ${decision?.feedback || '人类操作员拒绝放行'}]`
          }
        } else if (isModified) {
          if (!updatedSummary.includes('[已热纠偏放行]')) {
            updatedSummary = `${updatedSummary} [已热纠偏放行]`
          }
        } else {
          if (!updatedSummary.includes('[人类已批准放行]')) {
            updatedSummary = `${updatedSummary} [人类已批准放行]`
          }
        }

        return {
          ...node,
          data: {
            ...currentData,
            status: newStatus,
            summary: updatedSummary,
            humanSteering: isModified ? steering : currentData.humanSteering,
          } satisfies AgentNodeData,
        }
      })

      const nextEdges = session.edges.map((edge) => {
        const isTargetEdge =
          edge.target === event.nodeId ||
          edge.target === event.nodeId.replace(/^gate-/, '') ||
          `gate-${edge.target}` === event.nodeId
        if (isTargetEdge) {
          return {
            ...edge,
            animated: false,
            style: isRejected
              ? { stroke: '#DC2626', strokeWidth: 2 }
              : edge.style,
          }
        }
        return edge
      })

      return {
        ...session,
        title,
        actors,
        project,
        updatedAt,
        status: newStatus,
        nodes: nextNodes,
        edges: nextEdges,
      }
    }

    case 'context_pruned': {
      const reclaimed = event.reclaimedTokens ?? 42000
      const nextNodes = session.nodes.map((node) => {
        const currentData = node.data as unknown as AgentNodeData
        const isPrunable = event.prunedNodeIds
          ? event.prunedNodeIds.includes(node.id)
          : currentData.gesture === 'bash' ||
            currentData.gesture === 'edit' ||
            currentData.gesture === 'read' ||
            Boolean(currentData.observation)
        if (isPrunable) {
          return {
            ...node,
            data: {
              ...currentData,
              pruned: true,
            } satisfies AgentNodeData,
          }
        }
        return node
      })

      const watermark = event.watermark || {
        ...session.watermark!,
        prunableTools: Math.min(session.watermark?.prunableTools ?? 0, 4000),
      }

      return {
        ...session,
        isPruned: true,
        reclaimedTokens: reclaimed,
        nodes: nextNodes,
        watermark,
        updatedAt,
      }
    }

    default:
      return session
  }
}

/**
 * 驱动多会话隔离字典的状态机处理函数
 */
export function processEventForSessions(
  sessions: Record<string, SessionData>,
  event: TelemetryEvent,
  initialWatermark: ContextWatermark = BASE_CONTEXT_WATERMARK
): {
  nextSessions: Record<string, SessionData>
  sessionId: string
  updatedSession: SessionData
} {
  const sid = resolveSessionId(event)
  const currentSession =
    sessions[sid] || createInitialSession(sid, event, [], [], initialWatermark)
  const updatedSession = processEventForSession(currentSession, event)

  // 纯通知事件且无有效节点时，绝不生成空会话
  if (
    updatedSession.nodes.length === 0 &&
    (event.type === 'gate_resolved' || event.type === 'context_pruned')
  ) {
    return {
      nextSessions: sessions,
      sessionId: sid,
      updatedSession,
    }
  }

  return {
    nextSessions: {
      ...sessions,
      [sid]: updatedSession,
    },
    sessionId: sid,
    updatedSession,
  }
}

/**
 * 从当前 React Flow 节点拓扑中动态提取可修剪的冗余工具调用条目
 */
export function extractPrunableItems(nodes: Node[]): PrunableItem[] {
  if (!Array.isArray(nodes)) return []
  return nodes
    .filter((node) => {
      const data = node?.data as unknown as AgentNodeData | undefined
      if (!data || data.status === 'running') return false

      const isToolGesture =
        data.gesture === 'bash' ||
        data.gesture === 'edit' ||
        data.gesture === 'read'

      const outputLines = normalizeObservationOutput(data.observation?.output)
      const hasObservation = Boolean(
        data.observation &&
          (typeof data.observation.exitCode === 'number' || outputLines.length > 0)
      )

      const hasPayloadDiff = Boolean(data.payload?.diff)
      return isToolGesture || hasObservation || hasPayloadDiff
    })
    .map((node) => {
      const data = node.data as unknown as AgentNodeData
      const outputLines = normalizeObservationOutput(data.observation?.output)

      let gesture: 'bash' | 'edit' | 'read' = 'bash'
      if (
        data.gesture === 'bash' ||
        data.gesture === 'edit' ||
        data.gesture === 'read'
      ) {
        gesture = data.gesture
      } else if (data.payload?.diff) {
        gesture = 'edit'
      }

      const emoji =
        gesture === 'bash' ? '📟' : gesture === 'edit' ? '📝' : '🔍'

      const title =
        data.title ||
        (gesture === 'bash'
          ? 'Bash 执行'
          : gesture === 'edit'
            ? '代码编辑'
            : '读取文件')

      let tokens = 0
      if (gesture === 'bash') {
        const hasTestOutput = Boolean(
          outputLines.length > 0 ||
            (data.summary &&
              /test|passed|failed|回归|单测|156/i.test(data.summary)) ||
            (data.title && /test|测试/i.test(data.title))
        )
        tokens = hasTestOutput ? 28000 : 16000
      } else if (gesture === 'edit') {
        tokens = 14000
      } else if (gesture === 'read') {
        tokens = 4000
      } else {
        tokens = 8000
      }

      const isNodePruned = Boolean(data.pruned)
      const statusBadge = isNodePruned
        ? '已折叠压缩 (Pruned)'
        : '已完成历史使命 (Resolved)'

      const rawSummary = data.summary
        ? data.summary.replace(/^\[已修剪:\s*/, '').replace(/\]$/, '').trim()
        : ''

      const cleanSummary =
        rawSummary ||
        (gesture === 'bash'
          ? '单元测试回归通过 (156 passed, 0 failed)'
          : gesture === 'edit'
            ? `${title} 重构应用成功`
            : `${title} 内容读取完成`)

      const foldedSummary = isNodePruned
        ? `[已修剪: ${cleanSummary}]`
        : cleanSummary

      let rawPayloadPreview = ''
      let linesCount = 0

      if (gesture === 'bash') {
        linesCount = 150
        const isFailed =
          data.observation?.exitCode !== 0 ||
          data.status === 'failed' ||
          outputLines.some((l) => /fail|error|Assertion/i.test(l))

        if (isFailed) {
          const errorLines =
            outputLines.length > 0
              ? outputLines.map((line) => `✖ ${line}`)
              : [
                  '✖ AssertionError: Expected 200 OK, got 500',
                  '  at test/pipeline.test.ts:42',
                ]
          rawPayloadPreview = [
            '$ pnpm test:pipeline',
            '> vitest run pipeline',
            ...errorLines,
            '  ... (150 lines raw stdout/stderr hidden)',
          ].join('\n')
        } else if (outputLines.length > 0) {
          rawPayloadPreview = [
            '$ pnpm test:pipeline',
            '> vitest run pipeline',
            ...outputLines.map((line) => `✓ ${line}`),
            '  ... (150 lines raw stdout/stderr hidden)',
          ].join('\n')
        } else {
          rawPayloadPreview = [
            '$ pnpm test:pipeline',
            '> vitest run pipeline',
            '✓ test/pipeline.test.ts (156 tests passed)',
            '  ✓ pipeline initialization (12ms)',
            '  ✓ radash.tryit error capture contract (8ms)',
            '  ✓ defensive fallback on empty payload (5ms)',
            '  ... (150 lines raw stdout/stderr hidden)',
          ].join('\n')
        }
      } else if (gesture === 'edit') {
        linesCount = 42
        if (data.payload?.diff && typeof data.payload.diff === 'string') {
          rawPayloadPreview = data.payload.diff
          linesCount = data.payload.diff.split('\n').length
        } else {
          rawPayloadPreview = [
            '--- a/packages/core/src/pipeline.ts',
            '+++ b/packages/core/src/pipeline.ts',
            '@@ -24,8 +24,8 @@',
            '- try {',
            '-   const res = await run()',
            '+ const [err, res] = await tryit(run)()',
          ].join('\n')
        }
      } else if (gesture === 'read') {
        linesCount = 28
        if (data.payload?.content && typeof data.payload.content === 'string') {
          rawPayloadPreview = data.payload.content
          linesCount = data.payload.content.split('\n').length
        } else {
          rawPayloadPreview = [
            '{',
            '  "name": "@netdive/core",',
            '  "version": "0.1.0",',
            '  "dependencies": {',
            '    "pathe": "^0.2.0",',
            '    "radash": "^12.1.0"',
            '  }',
            '}',
          ].join('\n')
        }
      }

      let rawDetail = ''
      if (outputLines.length > 0) {
        const outputPreview = outputLines.join(' | ')
        rawDetail = `${outputPreview} (~${formatTokens(tokens)} tokens)`
      } else if (data.summary) {
        rawDetail = `${data.summary} (~${formatTokens(tokens)} tokens)`
      } else if (data.payload?.diff) {
        rawDetail = `Diff payload (~${formatTokens(tokens)} tokens)`
      } else {
        rawDetail = `Raw ${gesture} trace (~${formatTokens(tokens)} tokens)`
      }

      return {
        id: node.id,
        gesture,
        emoji,
        title,
        rawDetail,
        tokens,
        statusBadge,
        foldedSummary,
        rawPayloadPreview,
        linesCount,
      }
    })
    .sort((a, b) => b.tokens - a.tokens)
}

export interface TelemetryStreamScenarioNode {
  nodeId: string
  parentId?: string
  actor: TelemetryEvent['actor']
  gesture: TelemetryEvent['gesture']
  title: string
  fullSummary: string
  status?: TelemetryStatus
  isGate?: boolean
  gatePayload?: GatePromptPayload
  isCorrectionBranch?: boolean
  observation?: TelemetryObservation
  watermarkDelta?: WatermarkDelta
}

/** 默认端到端高保真模拟遥测剧本 (主干因果全链路) */
export const DEFAULT_TELEMETRY_SCENARIO: TelemetryStreamScenarioNode[] = [
  {
    nodeId: 'node-1',
    actor: 'Pi (Coordinator)',
    gesture: 'think',
    title: '目标规划与分解',
    fullSummary: '分析 Ghost pipeline 异常治理任务，规划 4 阶段流式因果拓扑主干。',
    watermarkDelta: { activeTurns: 3000, prunableTools: 0 },
  },
  {
    nodeId: 'node-2',
    parentId: 'node-1',
    actor: 'Claude 3.7 (Worker)',
    gesture: 'edit',
    title: '代码重构实现',
    fullSummary: '移除原生 try-catch 胶水样板，引入 radash.tryit 强契约封装。',
    watermarkDelta: { activeTurns: 3500, prunableTools: 14000 },
  },
  {
    nodeId: 'node-3',
    parentId: 'node-2',
    actor: 'Claude 3.7 (Worker)',
    gesture: 'bash',
    title: '自动化单元测试回归',
    fullSummary: '执行 pnpm test:pipeline -> 156 passed, 0 failed (1.82s) 测试通过。',
    watermarkDelta: { activeTurns: 3500, prunableTools: 18000 },
    observation: {
      exitCode: 0,
      output: [
        'Tests: 156 passed, 156 total',
        'Time: 1.82s',
      ],
    },
  },
  {
    nodeId: 'node-4',
    parentId: 'node-3',
    actor: 'Human Operator',
    gesture: 'gate',
    title: 'Git 提交与发布门禁',
    fullSummary: '检测到代码提交敏感动作，触发全机门禁审查，协程挂起等待确认。',
    isGate: true,
    watermarkDelta: { activeTurns: 1000, prunableTools: 0 },
    gatePayload: {
      gateId: 'gate-default-commit',
      title: 'Git 提交与全机门禁审查 (HITL)',
      riskLevel: 'high',
      proposedAction: {
        command: 'git commit -m "feat(pipeline): complete Ghost pipeline refactor with radash.tryit"',
        diff: 'diff --git a/src/pipeline.ts b/src/pipeline.ts\n- try { run() } catch (e) { ... }\n+ const [err, res] = await tryit(run)();',
        explanation: '单元测试已全量回归通过 (156 passed)。系统检测到准备执行本地 Git 提交，依据最高行为门禁红线，必须由人类操作员确认授权。',
      },
      timestamp: new Date().toISOString(),
    },
  },
]

/** ReAct 错误捕获与自愈分叉 (Self-Correction) 演练剧本 */
export const SELF_CORRECTION_SCENARIO: TelemetryStreamScenarioNode[] = [
  {
    nodeId: 'node-sc-1',
    actor: 'Pi (Coordinator)',
    gesture: 'think',
    title: '任务拆解与编排',
    fullSummary: '编排 Ghost 核心数据清洗管道重构，派发 Claude Worker 协程并启动单测观测守护。',
    watermarkDelta: { activeTurns: 3000, prunableTools: 0 },
  },
  {
    nodeId: 'node-sc-2',
    parentId: 'node-sc-1',
    actor: 'Claude 3.7 (Worker)',
    gesture: 'edit',
    title: '代码重构实现',
    fullSummary: '重构数据清洗管道，移除命令式 try-catch 胶水，迁移至 radash.tryit 强契约封装。',
    watermarkDelta: { activeTurns: 3500, prunableTools: 12000 },
  },
  {
    nodeId: 'node-sc-3',
    parentId: 'node-sc-2',
    actor: 'Claude 3.7 (Worker)',
    gesture: 'bash',
    title: '单测回归 (捕获异常)',
    fullSummary: '执行 pnpm test:pipeline -> 捕获断言异常：1 failed, 155 passed。检测到空输入逃逸。',
    status: 'failed',
    watermarkDelta: { activeTurns: 3500, prunableTools: 16000 },
    observation: {
      exitCode: 1,
      output: [
        'AssertionError: Expected 200 OK, got 500 Internal Error',
        'at packages/core/test/pipeline.test.ts:42',
      ],
    },
  },
  {
    nodeId: 'node-sc-4',
    parentId: 'node-sc-3',
    actor: 'Claude 3.7 (Worker)',
    gesture: 'think',
    title: 'ReAct 自愈诊断分叉',
    fullSummary: '捕获单测 exit: 1 异常堆栈，诊断定位 radash.tryit 在空 payload 输入时未做默认兜底回退。',
    isCorrectionBranch: true,
    watermarkDelta: { activeTurns: 3000, prunableTools: 0 },
  },
  {
    nodeId: 'node-sc-5',
    parentId: 'node-sc-4',
    actor: 'Claude 3.7 (Worker)',
    gesture: 'edit',
    title: '自愈补丁实施',
    fullSummary: '注入防御性空值 fallback，完善 pipeline 边界强契约校验，消除脏数据逃逸风险。',
    isCorrectionBranch: true,
    watermarkDelta: { activeTurns: 3500, prunableTools: 8000 },
  },
  {
    nodeId: 'node-sc-6',
    parentId: 'node-sc-5',
    actor: 'Claude 3.7 (Worker)',
    gesture: 'bash',
    title: '自愈回归验证',
    fullSummary: '重新执行 pnpm test:pipeline -> 156 passed, 0 failed (1.78s) 单测全部通过！',
    isCorrectionBranch: true,
    status: 'completed',
    watermarkDelta: { activeTurns: 3000, prunableTools: 10000 },
    observation: {
      exitCode: 0,
      output: [
        'Tests: 156 passed, 156 total',
        'Time: 1.78s',
      ],
    },
  },
  {
    nodeId: 'node-sc-7',
    parentId: 'node-sc-6',
    actor: 'Human Operator',
    gesture: 'gate',
    title: '自愈收敛与门禁放行',
    fullSummary: '单测自愈闭环，重新连回主干因果链。触发 Git 提交审查与全机门禁放行。',
    isGate: true,
    isCorrectionBranch: false,
    watermarkDelta: { activeTurns: 500, prunableTools: 0 },
    gatePayload: {
      gateId: 'gate-sc-commit',
      title: 'ReAct 自愈收敛与 Git 门禁审查',
      riskLevel: 'high',
      proposedAction: {
        command: 'git commit -m "fix(pipeline): add defensive fallback for empty payload in tryit"',
        diff: 'diff --git a/src/pipeline.ts b/src/pipeline.ts\n@@ -42,3 +42,5 @@\n+ if (!payload) return DEFAULT_FALLBACK;\n+ const [err, res] = await tryit(execute)(payload);',
        explanation: '单测断言异常已由 ReAct 自愈分支补丁修复并通过回归 (156 passed)。申请合并主干并提交代码。',
      },
      timestamp: new Date().toISOString(),
    },
  },
]

export interface UseTelemetryStreamOptions {
  initialNodes?: Node[]
  initialEdges?: Edge[]
  chunkSize?: number
  chunkDelayMs?: number
  stepPauseMs?: number
  bridgeEnabled?: boolean
  bridgeWsUrl?: string
  bridgeHttpUrl?: string
  initialWatermark?: ContextWatermark
}

export function useTelemetryStream(options: UseTelemetryStreamOptions = {}) {
  const {
    initialNodes = [],
    initialEdges = [],
    chunkSize = 3,
    chunkDelayMs = 35,
    stepPauseMs = 350,
    bridgeEnabled = true,
    bridgeWsUrl,
    bridgeHttpUrl,
    initialWatermark = BASE_CONTEXT_WATERMARK,
  } = options

  // 多会话隔离状态字典与当前激活会话
  const [sessions, setSessions] = useState<Record<string, SessionData>>(() => {
    const dict: Record<string, SessionData> = {}
    if (initialNodes.length > 0) {
      dict['default-session'] = createInitialSession(
        'default-session',
        undefined,
        initialNodes,
        initialEdges,
        initialWatermark
      )
    }
    return dict
  })

  const [activeSessionId, setActiveSessionId] = useState<string>('default-session')
  const sessionsRef = useRef<Record<string, SessionData>>(sessions)
  const activeSessionIdRef = useRef<string>(activeSessionId)

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  // 当前激活会话的画布节点与连线状态
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [isPlaying, setIsPlaying] = useState<boolean>(false)
  const [isPaused, setIsPaused] = useState<boolean>(false)
  const [currentPendingGate, setCurrentPendingGate] =
    useState<GatePromptPayload | null>(null)

  // 上下文 Token 水位分布与剪枝折叠状态
  const [watermark, setWatermark] = useState<ContextWatermark>(initialWatermark)
  const [isPruned, setIsPruned] = useState<boolean>(false)
  const [reclaimedTokens, setReclaimedTokens] = useState<number>(0)

  // 节点引用同步，确保在回调与 Edge 计算中能实时获取最新节点拓扑
  const nodesRef = useRef<Node[]>(nodes)
  useEffect(() => {
    nodesRef.current = nodes
    const activeId = activeSessionIdRef.current
    if (activeId && sessionsRef.current[activeId]) {
      const cur = sessionsRef.current[activeId]
      if (cur.nodes !== nodes || cur.edges !== edges) {
        sessionsRef.current = {
          ...sessionsRef.current,
          [activeId]: {
            ...cur,
            nodes,
            edges,
          },
        }
      }
    }
  }, [nodes, edges])

  // 模拟播放的中断与暂停生命周期守卫
  const isCancelledRef = useRef<boolean>(false)
  const isPausedRef = useRef<boolean>(false)
  const pauseResolverRef = useRef<(() => void) | null>(null)

  /**
   * 检查并在暂停状态下挂起协程，调用 resumeStream 时立即唤醒恢复
   */
  const waitWhilePaused = useCallback(async () => {
    if (isCancelledRef.current) return false
    if (!isPausedRef.current) return true
    await new Promise<void>((resolve) => {
      pauseResolverRef.current = resolve
    })
    return !isCancelledRef.current
  }, [])

  /**
   * 延时并支持随时中断与暂停
   */
  const interruptibleSleep = useCallback(
    async (ms: number) => {
      if (!(await waitWhilePaused())) return false

      const notCancelled = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          resolve(!isCancelledRef.current)
        }, ms)
        if (isCancelledRef.current) {
          clearTimeout(timer)
          resolve(false)
        }
      })
      if (!notCancelled || isCancelledRef.current) return false
      return await waitWhilePaused()
    },
    [waitWhilePaused]
  )

  /**
   * 暂停当前流式播放
   */
  const pauseStream = useCallback(() => {
    isPausedRef.current = true
    setIsPaused(true)
  }, [])

  /**
   * 恢复当前流式播放
   */
  const resumeStream = useCallback(() => {
    isPausedRef.current = false
    setIsPaused(false)
    if (pauseResolverRef.current) {
      const resolve = pauseResolverRef.current
      pauseResolverRef.current = null
      resolve()
    }
  }, [])

  /**
   * 切换流式播放的暂停与继续状态
   */
  const togglePauseResume = useCallback(() => {
    if (isPausedRef.current) {
      resumeStream()
    } else {
      pauseStream()
    }
  }, [pauseStream, resumeStream])

  /**
   * 切换当前激活展示的会话
   */
  const selectSession = useCallback(
    (sessionId: string) => {
      setActiveSessionId(sessionId)
      activeSessionIdRef.current = sessionId

      const target = sessionsRef.current[sessionId]
      if (target) {
        setNodes(target.nodes)
        setEdges(target.edges)
        nodesRef.current = target.nodes
        if (target.watermark) {
          setWatermark(target.watermark)
        }
        setIsPruned(target.isPruned || false)
        setReclaimedTokens(target.reclaimedTokens || 0)

        // 切换会话纯粹切换拓扑视图，绝不主动弹出模态窗阻断用户浏览
        setCurrentPendingGate(null)
      }
    },
    [setNodes, setEdges, setWatermark]
  )

  /**
   * 处理单个强类型 TelemetryEvent，按 session 隔离存储并驱动活跃画布
   */
  const processEvent = useCallback(
    (event: TelemetryEvent) => {
      if (!event || typeof event !== 'object' || !event.type) return

      const currentSessions = sessionsRef.current
      const currentActiveId = activeSessionIdRef.current

      const { nextSessions, sessionId, updatedSession } = processEventForSessions(
        currentSessions,
        event,
        initialWatermark
      )

      sessionsRef.current = nextSessions
      setSessions(nextSessions)

      // 若当前未激活有效会话（如初次接收外部实时流），自动激活第一个到来的会话
      const shouldAutoActivate =
        !currentActiveId ||
        (currentActiveId === 'default-session' &&
          (!currentSessions['default-session'] ||
            currentSessions['default-session'].nodes.length === 0))

      const activeIdToUse = shouldAutoActivate ? sessionId : currentActiveId
      if (shouldAutoActivate && activeIdToUse !== currentActiveId) {
        setActiveSessionId(activeIdToUse)
        activeSessionIdRef.current = activeIdToUse
      }

      // 命中活跃会话时，驱动画布更新
      if (sessionId === activeIdToUse) {
        setNodes(updatedSession.nodes)
        setEdges(updatedSession.edges)
        nodesRef.current = updatedSession.nodes

        if (updatedSession.watermark) {
          setWatermark(updatedSession.watermark)
        }
        if (updatedSession.isPruned !== undefined) {
          setIsPruned(updatedSession.isPruned)
        }
        if (updatedSession.reclaimedTokens !== undefined) {
          setReclaimedTokens(updatedSession.reclaimedTokens)
        }

        if (event.type === 'gate_prompt') {
          const gatePayload: GatePromptPayload = event.gatePayload || {
            gateId: `gate-${event.nodeId}`,
            title: event.title || '决策门禁待审 (HITL)',
            riskLevel: 'high',
            proposedAction: {
              command:
                (typeof event.payload?.command === 'string'
                  ? event.payload.command
                  : '') ||
                event.title ||
                '敏感动作待人类审批',
              explanation:
                (typeof event.payload?.explanation === 'string'
                  ? event.payload.explanation
                  : '') || '检测到敏感操作，等待人类批准放行',
            },
            timestamp: new Date().toISOString(),
          }
          setCurrentPendingGate(gatePayload)
        } else if (event.type === 'gate_resolved') {
          setCurrentPendingGate(null)
        }
      }
    },
    [setNodes, setEdges, setWatermark, initialWatermark]
  )

  // 接入 Local Sidecar Bridge (HTTP/WebSocket 实时遥测与门禁联动)
  const bridge = useBridgeConnection({
    enabled: bridgeEnabled,
    wsUrl: bridgeWsUrl,
    httpUrl: bridgeHttpUrl,
    onEvent: (event) => {
      processEvent(event)
    },
    onGatePrompt: (gatePayload) => {
      setCurrentPendingGate(gatePayload)
    },
    onGateResolved: (gateId) => {
      if (currentPendingGate?.gateId === gateId) {
        setCurrentPendingGate(null)
      }
    },
  })

  /**
   * 人类操作员裁决当前挂起的决策门禁
   */
  const resolveCurrentGate = useCallback(
    async (decision: GateDecision) => {
      if (currentPendingGate) {
        const gateId = currentPendingGate.gateId
        if (bridge.isConnected) {
          await bridge.resolveGate(gateId, decision)
        }
        gateManager.resolveGate(gateId, decision)
        setCurrentPendingGate(null)
      }
    },
    [currentPendingGate, bridge]
  )

  /**
   * 停止当前播放并重置画布与上下文水位
   */
  const resetStream = useCallback(() => {
    isCancelledRef.current = true
    isPausedRef.current = false
    setIsPaused(false)
    if (pauseResolverRef.current) {
      const resolve = pauseResolverRef.current
      pauseResolverRef.current = null
      resolve()
    }
    gateManager.clear('Stream reset')
    assertionEngine.reset()
    setCurrentPendingGate(null)
    setIsPlaying(false)
    setIsPruned(false)
    setReclaimedTokens(0)
    setWatermark(BASE_CONTEXT_WATERMARK)
    nodesRef.current = initialNodes
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialNodes, initialEdges, setNodes, setEdges])

  // 在 Live Bridge 连通状态下，支持一键清空画布以接收干净的外部 Agent 流
  const clearCanvas = useCallback(() => {
    resetStream()
    const activeId = activeSessionIdRef.current
    if (activeId && sessionsRef.current[activeId]) {
      const emptySession: SessionData = {
        ...sessionsRef.current[activeId],
        nodes: [],
        edges: [],
        lastNodeId: undefined,
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [activeId]: emptySession,
      }
      setSessions(sessionsRef.current)
    }
    setNodes([])
    setEdges([])
  }, [resetStream, setNodes, setEdges])

  /**
   * 一键执行上下文剪枝：将冗余工具调用折叠压缩为摘要，释放 Token 水位
   */
  const pruneContext = useCallback(() => {
    const currentPrunable = watermark.prunableTools
    const targetPrunable = Math.min(currentPrunable, 4000)
    const reclaimed = Math.max(0, currentPrunable - targetPrunable) || 42000

    setIsPruned(true)
    setReclaimedTokens(reclaimed)
    setWatermark((prev) => ({
      ...prev,
      prunableTools: targetPrunable,
    }))

    setNodes((prevNodes) =>
      prevNodes.map((node) => {
        const currentData = node.data as unknown as AgentNodeData
        const isPrunable =
          currentData.gesture === 'bash' ||
          currentData.gesture === 'edit' ||
          currentData.gesture === 'read' ||
          Boolean(currentData.observation)
        if (isPrunable) {
          return {
            ...node,
            data: {
              ...currentData,
              pruned: true,
            } satisfies AgentNodeData,
          }
        }
        return node
      })
    )

    if (bridge.isConnected) {
      const currentActiveSid = activeSessionIdRef.current || 'default-session'
      bridge.sendTelemetry({
        traceId: currentActiveSid,
        sessionId: currentActiveSid,
        nodeId: 'context-watermark',
        type: 'context_pruned',
        watermark: {
          ...watermark,
          prunableTools: targetPrunable,
        },
        reclaimedTokens: reclaimed,
        timestamp: Date.now(),
      })
    }
  }, [watermark, bridge, setNodes])

  /**
   * 重置上下文水位至初始基准
   */
  const resetWatermark = useCallback(() => {
    setIsPruned(false)
    setReclaimedTokens(0)
    setWatermark(BASE_CONTEXT_WATERMARK)
  }, [])

  /**
   * 停止当前流式播放 (保留当前已生成的节点状态)
   */
  const stopStream = useCallback(() => {
    isCancelledRef.current = true
    isPausedRef.current = false
    setIsPaused(false)
    if (pauseResolverRef.current) {
      const resolve = pauseResolverRef.current
      pauseResolverRef.current = null
      resolve()
    }
    gateManager.clear('Stream stopped')
    setCurrentPendingGate(null)
    setIsPlaying(false)
  }, [])

  /**
   * 播放流式事件剧本：从左至右逐个长出节点，遇到门禁挂起协程等待人类决断
   */
  const playStream = useCallback(
    async (scenario = DEFAULT_TELEMETRY_SCENARIO) => {
      isCancelledRef.current = false
      isPausedRef.current = false
      setIsPaused(false)
      if (pauseResolverRef.current) {
        const resolve = pauseResolverRef.current
        pauseResolverRef.current = null
        resolve()
      }
      gateManager.clear('New stream started')
      assertionEngine.reset()
      setCurrentPendingGate(null)
      setIsPlaying(true)
      setIsPruned(false)
      setReclaimedTokens(0)

      let currentWatermark: ContextWatermark = { ...BASE_CONTEXT_WATERMARK }
      setWatermark(currentWatermark)

      const isCorrection = scenario === SELF_CORRECTION_SCENARIO
      const activeId = activeSessionIdRef.current || DEFAULT_SESSION_ID
      const currentTargetSession = sessionsRef.current[activeId]

      // 智能识别：如果是自愈流则播放自愈剧本；如果选中了外部真实会话则就地回放该会话节点；否则播放沙盒
      let sessionId = DEFAULT_SESSION_ID
      let sessionTitle = DEFAULT_SESSION_TITLE
      let stepsToPlay = scenario
      let targetProject = 'ghost'

      if (isCorrection) {
        sessionId = SELF_CORRECTION_SESSION_ID
        sessionTitle = SELF_CORRECTION_SESSION_TITLE
        stepsToPlay = SELF_CORRECTION_SCENARIO
        targetProject = 'ghost'
      } else if (
        activeId !== DEFAULT_SESSION_ID &&
        currentTargetSession &&
        currentTargetSession.nodes.length > 0
      ) {
        sessionId = activeId
        sessionTitle = currentTargetSession.title
        targetProject = currentTargetSession.project || 'agent'
        // 从当前真实会话节点中提取可逐步时序回放的 steps 清单
        stepsToPlay = currentTargetSession.nodes.map((n, idx) => {
          const data = n.data as unknown as AgentNodeData
          const prevNode = idx > 0 ? currentTargetSession.nodes[idx - 1] : undefined
          return {
            nodeId: n.id,
            parentId: prevNode?.id,
            gesture: data.gesture || 'think',
            actor: data.actor || 'Agent',
            title: data.title || n.id,
            fullSummary: typeof data.summary === 'string' ? data.summary : '执行记录',
            observation: data.observation,
            isCorrectionBranch: Boolean(data.isCorrectionBranch),
          }
        })
      }

      const traceId = sessionId

      setActiveSessionId(sessionId)
      activeSessionIdRef.current = sessionId

      nodesRef.current = []
      setNodes([])
      setEdges([])

      for (const item of stepsToPlay) {
        if (isCancelledRef.current) break
        if (!(await waitWhilePaused())) break

        processEvent({
          traceId,
          sessionId,
          sessionTitle,
          project: targetProject,
          nodeId: item.nodeId,
          parentId: item.parentId,
          type: 'node_start',
          gesture: item.gesture,
          actor: item.actor,
          title: item.title,
          status: 'running',
          delta: '',
          isCorrectionBranch: item.isCorrectionBranch,
          observation: item.observation,
        })

        if (!(await interruptibleSleep(120))) break
        if (!(await waitWhilePaused())) break

        const text = item.fullSummary
        let cursor = 0
        while (cursor < text.length) {
          if (isCancelledRef.current) break
          if (!(await waitWhilePaused())) break

          const nextChunk = text.slice(cursor, cursor + chunkSize)
          cursor += chunkSize

          processEvent({
            traceId,
            sessionId,
            sessionTitle,
            project: 'ghost',
            nodeId: item.nodeId,
            type: 'node_stream',
            gesture: item.gesture,
            actor: item.actor,
            delta: nextChunk,
            isCorrectionBranch: item.isCorrectionBranch,
          })

          if (!(await interruptibleSleep(chunkDelayMs))) break
        }

        if (isCancelledRef.current) break
        if (!(await waitWhilePaused())) break

        const delta = getDynamicWatermarkDelta(item)
        currentWatermark = {
          ...currentWatermark,
          activeTurns: currentWatermark.activeTurns + (delta.activeTurns ?? 0),
          prunableTools: currentWatermark.prunableTools + (delta.prunableTools ?? 0),
        }
        setWatermark(currentWatermark)

        const commandToCheck =
          item.gatePayload?.proposedAction?.command ||
          (item.gesture === 'bash' ? item.title : undefined)

        const assertion = assertionEngine.evaluate({
          gesture: item.gesture,
          observation: item.observation,
          command: commandToCheck,
          title: item.title,
          status: item.status,
          payload: item.gatePayload ? { proposedAction: item.gatePayload.proposedAction } : undefined,
        })

        const requiresGate = Boolean(item.isGate || assertion.triggerGate)

        if (requiresGate) {
          const payload: GatePromptPayload = item.gatePayload || {
            gateId: `gate-${item.nodeId}`,
            title: assertion.reason?.includes('Fatal Failure Resonance')
              ? '致命共振紧急门禁拦截 (Fatal Failure Resonance)'
              : item.title || '决策门禁待审 (HITL)',
            riskLevel: assertion.severity === 'critical' ? 'critical' : 'high',
            proposedAction: {
              command: commandToCheck || item.title || 'emergency_stop',
              explanation: assertion.reason || item.fullSummary,
            },
            timestamp: new Date().toISOString(),
          }

          processEvent({
            traceId,
            sessionId,
            sessionTitle,
            project: 'ghost',
            nodeId: item.nodeId,
            type: 'gate_prompt',
            gesture: item.gesture,
            actor: item.actor,
            isCorrectionBranch: item.isCorrectionBranch,
            observation: item.observation,
            assertion,
            gatePayload: payload,
            watermark: currentWatermark,
          })

          setCurrentPendingGate(payload)

          let decision: GateDecision
          try {
            decision = await gateManager.registerGate(payload)
          } catch (err) {
            decision = {
              action: 'reject',
              feedback: err instanceof Error ? err.message : 'Gate cancelled',
            }
          }

          setCurrentPendingGate(null)

          if (isCancelledRef.current) break
          if (!(await waitWhilePaused())) break

          processEvent({
            traceId,
            sessionId,
            sessionTitle,
            project: 'ghost',
            nodeId: item.nodeId,
            type: 'gate_resolved',
            gesture: item.gesture,
            actor: item.actor,
            gateDecision: decision,
            assertion,
            isCorrectionBranch: item.isCorrectionBranch,
          })

          if (decision.action === 'reject') {
            setIsPlaying(false)
            setIsPaused(false)
            isPausedRef.current = false
            return
          }
        } else {
          const finalStatus: TelemetryStatus = assertion.triggerSelfCorrection
            ? 'failed'
            : item.status || 'completed'

          processEvent({
            traceId,
            sessionId,
            sessionTitle,
            project: 'ghost',
            nodeId: item.nodeId,
            type: 'node_complete',
            gesture: item.gesture,
            actor: item.actor,
            status: finalStatus,
            assertion,
            isCorrectionBranch: item.isCorrectionBranch,
            observation: item.observation,
            watermark: currentWatermark,
          })
        }

        if (!(await interruptibleSleep(stepPauseMs))) break
        if (!(await waitWhilePaused())) break
      }

      setIsPlaying(false)
      setIsPaused(false)
      isPausedRef.current = false
    },
    [chunkSize, chunkDelayMs, stepPauseMs, interruptibleSleep, waitWhilePaused, processEvent, setNodes, setEdges]
  )

  /**
   * 播放自愈剧本：ReAct 错误捕获与自愈分叉拓扑演练
   */
  const playSelfCorrectionStream = useCallback(async () => {
    await playStream(SELF_CORRECTION_SCENARIO)
  }, [playStream])

  /**
   * 直接手动触发决策门禁挂起 (HITL 快速演练)
   */
  const triggerHitlGate = useCallback(
    async (customPayload?: GatePromptPayload) => {
      if (currentPendingGate) return

      const activeId = activeSessionIdRef.current
      const currentSession = sessionsRef.current[activeId]
      const currentNodes = currentSession ? currentSession.nodes : nodesRef.current

      const existingGateNode = currentNodes.find(
        (n) =>
          (n.data as unknown as AgentNodeData)?.status === 'gate' ||
          n.id === 'node-4' ||
          n.id === 'node-sc-7'
      )
      const targetNodeId = existingGateNode ? existingGateNode.id : 'node-4'

      const payload: GatePromptPayload = customPayload || {
        gateId: `gate-hitl-${Date.now()}`,
        title: 'Git 提交与发布门禁审查 (HITL)',
        riskLevel: 'high',
        proposedAction: {
          command: 'git commit -m "feat(pipeline): complete Ghost pipeline refactor with radash.tryit"',
          diff: 'diff --git a/src/pipeline.ts b/src/pipeline.ts\n- try { run() } catch (e) { ... }\n+ const [err, res] = await tryit(run)();',
          explanation: '检测到代码提交敏感动作，触发全机门禁审查。依据最高系统行为门禁，本地 Commit 严禁擅自执行，必须由人类拍板。',
        },
        timestamp: new Date().toISOString(),
      }

      processEvent({
        traceId: activeId,
        sessionId: activeId,
        nodeId: targetNodeId,
        type: 'gate_prompt',
        gesture: 'gate',
        actor: 'Human Operator',
        title: payload.title,
        gatePayload: payload,
      })

      setCurrentPendingGate(payload)
      let decision: GateDecision
      try {
        decision = await gateManager.registerGate(payload)
      } catch (err) {
        decision = {
          action: 'reject',
          feedback: err instanceof Error ? err.message : 'Gate cancelled',
        }
      }

      setCurrentPendingGate(null)

      processEvent({
        traceId: `hitl-trace-${Date.now()}`,
        sessionId: activeId,
        nodeId: targetNodeId,
        type: 'gate_resolved',
        gesture: 'gate',
        actor: 'Human Operator',
        gateDecision: decision,
      })

      return decision
    },
    [currentPendingGate, processEvent]
  )

  // 组件卸载时安全清理定时器与中断标志
  useEffect(() => {
    return () => {
      isCancelledRef.current = true
      isPausedRef.current = false
      if (pauseResolverRef.current) {
        pauseResolverRef.current()
        pauseResolverRef.current = null
      }
      gateManager.clear('Component unmounted')
    }
  }, [])

  // 动态提取当前 DAG 画布上已完成的冗余工具调用条目
  const prunableItems = useMemo(() => {
    return extractPrunableItems(nodes)
  }, [nodes])

  // 派生已排序的活跃会话列表与当前活跃会话元数据 (仅展示包含真实节点的有效会话)
  const sessionsList: ActiveSessionItem[] = useMemo(() => {
    return Object.values(sessions)
      .filter((s) => s.nodes.length > 0)
      .map((s) => ({
        id: s.id,
        title: s.title,
        actors: s.actors,
        status: s.status,
        nodeCount: s.nodes.length,
        updatedAt: s.updatedAt,
        project: s.project,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [sessions])

  const activeSessionMeta = useMemo(() => {
    const current = sessions[activeSessionId]
    if (!current) return undefined
    return {
      id: current.id,
      title: current.title,
      actors: current.actors,
      status: current.status,
      nodeCount: current.nodes.length,
      updatedAt: current.updatedAt,
      project: current.project,
    } satisfies ActiveSessionItem
  }, [sessions, activeSessionId])

  return {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    setNodes,
    setEdges,
    processEvent,
    playStream,
    playSelfCorrectionStream,
    triggerHitlGate,
    resetStream,
    clearCanvas,
    stopStream,
    isPlaying,
    isPaused,
    pauseStream,
    resumeStream,
    togglePauseResume,
    currentPendingGate,
    resolveCurrentGate,
    bridge,
    watermark,
    setWatermark,
    isPruned,
    reclaimedTokens,
    pruneContext,
    resetWatermark,
    prunableItems,
    assertionEngine,
    microCompactor,
    sessions,
    sessionsList,
    activeSessionId,
    activeSessionMeta,
    selectSession,
    resolveCausalConnection,
  }
}
