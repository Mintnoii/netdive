/**
 * @file src/hooks/useTelemetryStream.ts
 * @description 遥测流状态编排层：持有 React 状态、驱动回放与门禁编排。
 *
 * 契约：
 * 1. 拓扑演算（会话模型、因果建链、坐标、归约）已下沉至 `services/sessionTopology`；
 * 2. 本 hook 只负责状态生命周期、副作用与对外 API，不再承载纯逻辑算法；
 * 3. 对外导出保持不变，调用方无需感知内部分层。
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { isString, tryit } from 'radash'
import { useNodesState, useEdgesState, type Node, type Edge } from '@xyflow/react'
import type { AgentNodeData } from '../components/AgentNode'
import type {
  ContextWatermark,
  GateDecision,
  GatePromptPayload,
  TelemetryEvent,
  TelemetryStatus,
  ActiveSessionItem,
} from '../types/telemetry'
import { BASE_CONTEXT_WATERMARK } from '../types/telemetry'
import { gateManager } from '../services/gateManager'
import { assertionEngine } from '../services/assertionEngine'
import { microCompactor } from '../services/microCompactor'
import {
  DEFAULT_SESSION_ID,
  DEFAULT_SESSION_TITLE,
  DEFAULT_TELEMETRY_SCENARIO,
  SELF_CORRECTION_SCENARIO,
  calculateNodePosition,
  createInitialSession,
  extractPrunableItems,
  getDynamicWatermarkDelta,
  processEventForSession,
  processEventForSessions,
  resolveCausalConnection,
  type CausalChainResolution,
  type SessionData,
  type TelemetryStreamScenarioNode,
  type WatermarkDelta,
} from '../services/sessionTopology'
import { useBridgeConnection } from './useBridgeConnection'

export {
  DEFAULT_SESSION_ID,
  DEFAULT_SESSION_TITLE,
  DEFAULT_TELEMETRY_SCENARIO,
  SELF_CORRECTION_SCENARIO,
  calculateNodePosition,
  createInitialSession,
  extractPrunableItems,
  getDynamicWatermarkDelta,
  processEventForSession,
  processEventForSessions,
  resolveCausalConnection,
  assertionEngine,
  microCompactor,
}
export type {
  CausalChainResolution,
  SessionData,
  TelemetryStreamScenarioNode,
  WatermarkDelta,
}
export { microCompactor as MicroCompactorEngine } from '../services/microCompactor'
export { MicroCompactor } from '../services/microCompactor'
export { useBridgeConnection, type UseBridgeConnectionReturn } from './useBridgeConnection'

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
      dict[DEFAULT_SESSION_ID] = createInitialSession(
        DEFAULT_SESSION_ID,
        undefined,
        initialNodes,
        initialEdges,
        initialWatermark
      )
    }
    return dict
  })

  const [activeSessionId, setActiveSessionId] = useState<string>(DEFAULT_SESSION_ID)
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

  // 节点引用同步 (只更新不可变 Ref，严禁在 Effect 内部倒灌回写 sessionsRef 引发无限级联渲染死锁)
  const nodesRef = useRef<Node[]>(nodes)
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

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
      } else if (sessionId === 'live-waiting') {
        // 切入暂无实时会话的待命就绪状态
        setNodes([])
        setEdges([])
        nodesRef.current = []
        setWatermark(BASE_CONTEXT_WATERMARK)
        setIsPruned(false)
        setReclaimedTokens(0)
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
      // 演示流（demoOnly）绝不允许抢占真实活跃画布，只落在侧边会话列表待人工选择
      const shouldAutoActivate =
        !event.demoOnly &&
        (!currentActiveId ||
          (currentActiveId === DEFAULT_SESSION_ID &&
            (!currentSessions[DEFAULT_SESSION_ID] ||
              currentSessions[DEFAULT_SESSION_ID].nodes.length === 0)))

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
          // 真门禁优先：演示门禁在演示会话内可正常展演，但绝不抢占真实门禁
          setCurrentPendingGate((current) => {
            if (!current) return gatePayload
            if (current.demoOnly && !gatePayload.demoOnly) return gatePayload
            if (!current.demoOnly && gatePayload.demoOnly) return current
            return gatePayload
          })
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
      // 演示门禁只在用户正主动浏览该演示会话时才弹窗，绝不打断真实活跃工作流
      if (
        gatePayload.demoOnly &&
        gatePayload.sessionId !== activeSessionIdRef.current
      ) {
        return
      }

      // 真门禁绝对优先：演示门禁绝不抢占真实门禁的审批模态窗，反之真门禁可顶掉演示门禁
      setCurrentPendingGate((current) => {
        if (!current) return gatePayload
        if (current.demoOnly && !gatePayload.demoOnly) return gatePayload
        if (!current.demoOnly && gatePayload.demoOnly) return current
        return gatePayload
      })
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
   * 导入外部解析好的离线会话 (从 JSONL 文本导入)
   * 遵循 Master-Detail 第一性原则：全系统只保留当前激活的那一份完整 Nodes/Edges，严禁在字典里累积全量节点导致内存击穿
   */
  const importParsedSession = useCallback(
    (parsed: {
      session: { sessionId: string; title?: string; cwdBase?: string; modelId?: string; mtime?: number }
      nodes: Node[]
      edges: Edge[]
      rawEvents: TelemetryEvent[]
    }) => {
      const sid = parsed.session.sessionId || `session-${Date.now()}`
      const title = parsed.session.title || `会话 ${sid}`
      const project = parsed.session.cwdBase
      const actors = Array.from(
        new Set(
          parsed.rawEvents
            .map((e) => e.actor)
            .filter((a): a is string => Boolean(a))
        )
      )

      // 仅保留当前会话的物理节点，清空旧会话的巨型节点数组以释放 V8 堆内存
      const prunedSessionsDict: Record<string, SessionData> = {}
      for (const [key, s] of Object.entries(sessionsRef.current)) {
        prunedSessionsDict[key] = {
          ...s,
          nodes: key === sid ? parsed.nodes : [],
          edges: key === sid ? parsed.edges : [],
        }
      }

      const newSession: SessionData = {
        id: sid,
        title,
        actors: actors.length > 0 ? actors : ['Pi (Coordinator)'],
        status: parsed.rawEvents.some((e) => e.status === 'failed')
          ? 'failed'
          : 'completed',
        updatedAt: (parsed.session as { mtime?: number }).mtime || Date.now(),
        project,
        nodes: parsed.nodes,
        edges: parsed.edges,
        lastNodeId: parsed.nodes[parsed.nodes.length - 1]?.id,
        watermark: BASE_CONTEXT_WATERMARK,
        isPruned: false,
        reclaimedTokens: 0,
      }

      prunedSessionsDict[sid] = newSession
      sessionsRef.current = prunedSessionsDict
      setSessions(prunedSessionsDict)

      // 立即挂载当前唯一活跃节点的 DOM 画布
      setActiveSessionId(sid)
      activeSessionIdRef.current = sid
      setNodes(parsed.nodes)
      setEdges(parsed.edges)
      nodesRef.current = parsed.nodes
      setWatermark(BASE_CONTEXT_WATERMARK)
      setIsPruned(false)
      setReclaimedTokens(0)
      setCurrentPendingGate(null)
    },
    [setNodes, setEdges, setWatermark]
  )


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

      const activeId = activeSessionIdRef.current || DEFAULT_SESSION_ID
      const currentTargetSession = sessionsRef.current[activeId]

      // 智能识别：如果是演练剧本则播放黄金全流程；若选中了外部真实会话则就地逐步回放该会话
      let sessionId = DEFAULT_SESSION_ID
      let sessionTitle = DEFAULT_SESSION_TITLE
      let stepsToPlay = scenario
      let targetProject = 'ghost'

      if (
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
            fullSummary: isString(data.summary) ? data.summary : '执行记录',
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
          provenance: 'live',
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

          const [gateErr, resolvedDecision] = await tryit(() => gateManager.registerGate(payload))()
          const decision: GateDecision = gateErr
            ? { action: 'reject', feedback: gateErr.message || 'Gate cancelled' }
            : (resolvedDecision ?? { action: 'approve' })

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
      const [gateErr, resolvedDecision] = await tryit(() => gateManager.registerGate(payload))()
      const decision: GateDecision = gateErr
        ? { action: 'reject', feedback: gateErr.message || 'Gate cancelled' }
        : (resolvedDecision ?? { action: 'approve' })

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

  // 派生已排序的活跃会话列表与当前活跃会话元数据 (基于轻量元数据模型，即便旧会话节点被释放也完整保留列表卡片)
  const sessionsList: ActiveSessionItem[] = useMemo(() => {
    return Object.values(sessions)
      .map((s) => ({
        id: s.id,
        title: s.title,
        actors: s.actors,
        status: s.status,
        nodeCount: s.nodes.length || 1,
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
    importParsedSession,
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
    resetWatermark,
    prunableItems,
    assertionEngine,
    microCompactor,
    sessions,
    sessionsList,
    activeSessionId,
    setActiveSessionId,
    activeSessionMeta,
    selectSession,
    resolveCausalConnection,
  }
}
