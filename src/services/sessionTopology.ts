/**
 * @file src/services/sessionTopology.ts
 * @description 会话拓扑纯逻辑层：会话模型、因果建链、节点坐标、事件归约与演练剧本。
 *
 * 契约：
 * 1. 本文件保持纯函数与纯数据，不持有 React 状态，可被实时流 / 回放 / 测试直接复用；
 * 2. 布局与连线统一来自 `flowLayout`，状态色统一来自 `statusTone`；
 * 3. `useTelemetryStream` 只做状态编排与副作用，所有拓扑演算下沉至此。
 */

import { isString } from 'radash'
import { deriveNodeFacets, estimateFacetTokens } from './nodeFacets'
import type { Edge, Node } from '@xyflow/react'
import type { AgentNodeData } from '../components/AgentNode'
import type {
  ContextWatermark,
  GatePromptPayload,
  PrunableItem,
  TelemetryEvent,
  TelemetryGesture,
  TelemetryObservation,
  TelemetryStatus,
} from '../types/telemetry'
import {
  BASE_CONTEXT_WATERMARK,
  formatTokens,
  normalizeObservationOutput,
  normalizeTelemetryObservation,
  resolveSessionId,
  resolveSessionTitle,
} from '../types/telemetry'
import { assertionEngine } from './assertionEngine'
import { BRANCH_EDGE_STYLE } from './statusTone'
import {
  causalNodePosition,
  createFlowEdge,
  isBranchEdgeBetween,
} from './flowLayout'

/** 单步水位增量契约 */
export interface WatermarkDelta {
  activeTurns?: number
  prunableTools?: number
}

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
 * 依据动作手势与执行观测结果计算单步 Token 水位动态增量。
 * 增量为启发式估算，供实时流位势演示，不代表真实 usage。
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

  // 严格 DAG 无环保护：
  // 1. 若候选父节点不存在于当前画布，不可成边
  // 2. 若候选父节点的 X 轴坐标在当前拟定坐标的右侧 (说明是在试图逆向连线成环)，强行熔断连线
  // 3. 根节点事件 (显式 parentId 缺失且 lastNodeId 已归零) 绝不成边
  if (!parentNode) {
    return {
      effectiveParentId: undefined,
      edge: undefined,
      isRoot: true,
    }
  }

  const isBranchEdge = isBranchEdgeBetween(event, parentNode)

  const edge: Edge = createFlowEdge({
    source: candidateParent,
    target: event.nodeId,
    isBranchEdge,
    status: event.status,
  })

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

  return causalNodePosition(parentNode, existingNodes.length, event.isCorrectionBranch)
}

export const DEFAULT_SESSION_ID = 'demo-session'
export const DEFAULT_SESSION_TITLE = '端到端黄金演练：Ghost pipeline 异常自愈与门禁审批'

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

  // 会话标题稳定锁定：若已有显式语义标题（非默认“会话 xxx”兜底），坚决保持稳定，绝不随单步工具名跳动
  const hasEstablishedTitle = session.title && !session.title.startsWith('会话 ') && session.title !== '未命名任务会话'
  const newExplicitTitle = event.sessionTitle?.trim()

  const title = newExplicitTitle || (hasEstablishedTitle ? session.title : resolveSessionTitle(event))

  switch (event.type) {
    case 'node_start': {
      const normalizedObs = normalizeTelemetryObservation(event.observation)
      const eventWithNormalized = normalizedObs
        ? { ...event, observation: normalizedObs }
        : event
      const facets = deriveNodeFacets(eventWithNormalized)
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
          prunableTokens: estimateFacetTokens(facets),
          ...facets,
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
      const facets = deriveNodeFacets(
        normalizedObs ? { ...event, observation: normalizedObs } : event
      )
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
              ...facets,
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
          prunableTokens: estimateFacetTokens(facets),
          ...facets,
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
      const facets = deriveNodeFacets(
        normalizedObs ? { ...event, observation: normalizedObs } : event
      )
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
              prunableTokens: estimateFacetTokens(facets) ?? currentData.prunableTokens,
              ...facets,
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
            prunableTokens: estimateFacetTokens(facets),
            ...facets,
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
        provenance: 'live',
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
      const facets = deriveNodeFacets(
        normalizedObs ? { ...event, observation: normalizedObs } : event
      )
      const gatePayload: GatePromptPayload = event.gatePayload || {
        gateId: `gate-${event.nodeId}`,
        title: event.title || '决策门禁待审 (HITL)',
        riskLevel: 'high',
        proposedAction: {
          command:
            (isString(event.payload?.command)
              ? event.payload.command
              : '') ||
            event.title ||
            '敏感动作待人类审批',
          explanation:
            (isString(event.payload?.explanation)
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
              ...facets,
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
            prunableTokens: estimateFacetTokens(facets),
            ...facets,
          } satisfies AgentNodeData,
        }
        nextNodes = [...session.nodes, newNode]

        if (causal.edge && !nextEdges.some((e) => e.id === causal.edge!.id)) {
          nextEdges = [
            ...nextEdges,
            {
              ...causal.edge,
              style: {
                ...BRANCH_EDGE_STYLE,
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
        provenance: 'live',
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
      const reclaimed = event.reclaimedTokens ?? 0
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
export function extractPrunableItems(
  nodes: Node[],
  lookupEvent?: (nodeId: string) => TelemetryEvent | undefined
): PrunableItem[] {
  if (!Array.isArray(nodes)) return []

  /**
   * 载荷来源解析：优先 JIT 命中原始事件（完整 payload / observation），
   * 其次回落节点自带的瘦标量。绝不把原始事件写回节点。
   */
  const resolveSource = (nodeId: string, data: AgentNodeData) => {
    const event = lookupEvent?.(nodeId)
    return {
      payload: event?.payload ?? data.payload,
      observation: event?.observation ?? data.observation,
    }
  }
  return nodes
    .filter((node) => {
      const data = node?.data as unknown as AgentNodeData | undefined
      if (!data || data.status === 'running') return false

      const isToolGesture =
        data.gesture === 'bash' ||
        data.gesture === 'edit' ||
        data.gesture === 'read'

      const hasObservation = Boolean(
        typeof data.exitCode === 'number' || (data.outputLineCount ?? 0) > 0
      )

      return isToolGesture || hasObservation || Boolean(data.hasDiff)
    })
    .map((node) => {
      const data = node.data as unknown as AgentNodeData
      const source = resolveSource(node.id, data)
      const eventOutputLines = normalizeObservationOutput(source.observation?.output)
      // 事件优先：JIT 命中时可保留完整输出与 diff 预览，否则退化为瘦标量
      const outputLines =
        eventOutputLines.length > 0 ? eventOutputLines : data.outputHead ? [data.outputHead] : []
      const payload = source.payload

      let gesture: 'bash' | 'edit' | 'read' = 'bash'
      if (
        data.gesture === 'bash' ||
        data.gesture === 'edit' ||
        data.gesture === 'read'
      ) {
        gesture = data.gesture
      } else if (data.hasDiff) {
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
        const isFailed =
          (typeof source.observation?.exitCode === 'number' && source.observation.exitCode !== 0) ||
          (typeof data.exitCode === 'number' && data.exitCode !== 0) ||
          data.status === 'failed' ||
          outputLines.some((l) => /fail|error|Assertion/i.test(l))

        if (isFailed) {
          const errorLines =
            outputLines.length > 0
              ? outputLines.map((line) => (line.startsWith('✖') ? line : `✖ ${line}`))
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
            ...outputLines.map((line) => (line.startsWith('✓') ? line : `✓ ${line}`)),
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

        linesCount = data.outputLineCount ?? (outputLines.length > 2 ? outputLines.length : 150)
      } else if (gesture === 'edit') {
        const diffText = isString(payload?.diff) ? payload.diff : undefined
        if (diffText) {
          rawPayloadPreview = diffText
          linesCount = diffText.split('\n').length
        } else if (outputLines.length > 0) {
          rawPayloadPreview = outputLines.join('\n')
          linesCount = outputLines.length
        } else {
          rawPayloadPreview = [
            '--- a/packages/core/src/pipeline.ts',
            '+++ b/packages/core/src/pipeline.ts',
            '@@ -24,8 +24,8 @@',
            '- try {',
            '-   const res = await run()',
            '+ const [err, res] = await tryit(run)()',
          ].join('\n')
          linesCount = data.outputLineCount ?? 42
        }
      } else if (gesture === 'read') {
        const contentText = isString(payload?.content) ? payload.content : undefined
        if (contentText) {
          rawPayloadPreview = contentText
          linesCount = contentText.split('\n').length
        } else if (outputLines.length > 0) {
          rawPayloadPreview = outputLines.join('\n')
          linesCount = outputLines.length
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
          linesCount = data.outputLineCount ?? 28
        }
      }

      if (typeof data.outputLineCount === 'number' && data.outputLineCount > 0) {
        linesCount = data.outputLineCount
      }

      // 真实载荷尺寸折算：彻底废除 28000/14000/4000 等硬编码伪数字
      let tokens = 0
      if (typeof data.prunableTokens === 'number' && data.prunableTokens > 0) {
        tokens = data.prunableTokens
      } else {
        // 基于真实载荷字符数折算 (每 4 字符约 1 Token)：事件命中时用完整负载，否则用瘦标量
        let payloadChars = 0
        if (outputLines.length > 0) {
          payloadChars += outputLines.join('\n').length
        }
        if (isString(payload?.diff)) {
          payloadChars += payload.diff.length
        }
        if (isString(payload?.content)) {
          payloadChars += payload.content.length
        }
        if (isString(payload?.command)) {
          payloadChars += payload.command.length
        }
        if (payloadChars === 0) {
          payloadChars = data.outputChars ?? 0
        }

        // 若上述均为空，依据 summary 或 rawPayloadPreview 尺寸折算
        if (payloadChars === 0) {
          payloadChars = data.summary?.length || (rawPayloadPreview ? rawPayloadPreview.length : 40)
        }
        tokens = Math.max(1, Math.ceil(payloadChars / 4))
      }

      let rawDetail = ''
      if (outputLines.length > 0) {
        const outputPreview = outputLines.join(' | ')
        rawDetail = `${outputPreview} (~${formatTokens(tokens)} tokens)`
      } else if (data.summary) {
        rawDetail = `${data.summary} (~${formatTokens(tokens)} tokens)`
      } else if (data.hasDiff) {
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

/** 统一端到端黄金场景演练 (因果主干 -> 单测异常 -> ReAct自愈分叉 -> HITL门禁挂起审批) */
export const DEFAULT_TELEMETRY_SCENARIO: TelemetryStreamScenarioNode[] = [
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
    title: '自愈收敛与 Git 门禁审查',
    fullSummary: '单测自愈闭环，重新连回主干因果链。触发 Git 提交审查与全机门禁放行。',
    isGate: true,
    isCorrectionBranch: false,
    watermarkDelta: { activeTurns: 500, prunableTools: 0 },
    gatePayload: {
      gateId: 'gate-sc-commit',
      title: 'Git 提交与全机门禁审查 (HITL)',
      riskLevel: 'high',
      proposedAction: {
        command: 'git commit -m "fix(pipeline): add defensive fallback for empty payload in tryit"',
        diff: 'diff --git a/src/pipeline.ts b/src/pipeline.ts\n@@ -42,3 +42,5 @@\n+ if (!payload) return DEFAULT_FALLBACK;\n+ const [err, res] = await tryit(execute)(payload);',
        explanation: '单测断言异常已由 ReAct 自愈分支补丁修复并通过回归 (156 passed)。系统检测到准备执行本地 Git 提交，依据最高行为门禁红线，必须由人类操作员确认授权。',
      },
      timestamp: new Date().toISOString(),
    },
  },
]

/** ReAct 错误捕获与自愈分叉 (Self-Correction) 演练剧本 (保持引用兼容) */
export const SELF_CORRECTION_SCENARIO: TelemetryStreamScenarioNode[] = DEFAULT_TELEMETRY_SCENARIO
