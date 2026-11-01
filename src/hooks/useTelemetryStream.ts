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
} from '../types/telemetry'
import { BASE_CONTEXT_WATERMARK, formatTokens } from '../types/telemetry'
import { gateManager } from '../services/gateManager'
import { assertionEngine } from '../services/assertionEngine'
export { assertionEngine } from '../services/assertionEngine'
import {
  useBridgeConnection,
} from './useBridgeConnection'
export { useBridgeConnection, type UseBridgeConnectionReturn } from './useBridgeConnection'

export interface WatermarkDelta {
  activeTurns?: number
  prunableTools?: number
}

/**
 * 依据动作手势与执行观测结果计算单步 Token 水位动态增量
 */
export function getDynamicWatermarkDelta(item: {
  gesture?: TelemetryGesture
  observation?: TelemetryObservation
  status?: TelemetryStatus
  isGate?: boolean
  watermarkDelta?: WatermarkDelta
}): WatermarkDelta {
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
      const hasHeavyOutput = Boolean(
        item.observation?.output && item.observation.output.length > 0
      )
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
 * 从当前 React Flow 节点拓扑中动态提取可修剪的冗余工具调用条目
 * 仅捕获已完成的 bash/edit/read 工具调用（或携带 observation/payload 的节点）
 * 未完成（running）或纯 think/gate 节点不会进入修剪明细
 */
export function extractPrunableItems(nodes: Node[]): PrunableItem[] {
  return nodes
    .filter((node) => {
      const data = node.data as unknown as AgentNodeData | undefined
      if (!data || data.status === 'running') return false

      const isToolGesture =
        data.gesture === 'bash' ||
        data.gesture === 'edit' ||
        data.gesture === 'read'

      const hasObservation = Boolean(
        data.observation &&
          (typeof data.observation.exitCode === 'number' ||
            (data.observation.output && data.observation.output.length > 0))
      )

      const hasPayloadDiff = Boolean(data.payload?.diff)

      return isToolGesture || hasObservation || hasPayloadDiff
    })
    .map((node) => {
      const data = node.data as unknown as AgentNodeData

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
          (data.observation?.output && data.observation.output.length > 0) ||
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
          data.observation?.output?.some((l) => /fail|error|Assertion/i.test(l))

        if (isFailed) {
          const errorLines =
            data.observation?.output && data.observation.output.length > 0
              ? data.observation.output.map((line) => `✖ ${line}`)
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
        } else if (data.observation?.output && data.observation.output.length > 0) {
          rawPayloadPreview = [
            '$ pnpm test:pipeline',
            '> vitest run pipeline',
            ...data.observation.output.map((line) => `✓ ${line}`),
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
      if (data.observation?.output && data.observation.output.length > 0) {
        const outputPreview = data.observation.output.join(' | ')
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
   * 纯函数辅助：延时并支持随时中断与暂停
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
   * 处理单个强类型 TelemetryEvent，动态更新 React Flow 节点与连线
   */
  const processEvent = useCallback((event: TelemetryEvent) => {
    switch (event.type) {
      case 'node_start': {
        const assertion = event.assertion || assertionEngine.evaluate(event)
        let initialStatus = event.status || 'running'
        if (assertion.triggerGate && initialStatus !== 'rejected') {
          initialStatus = 'gate'
        }

        setNodes((prevNodes) => {
          // 若节点已存在则跳过新建，防止重复
          if (prevNodes.some((n) => n.id === event.nodeId)) return prevNodes

          // 计算新节点坐标：有父节点时沿 X 轴向右排布，否则按根节点序顺延
          const parentNode = event.parentId
            ? prevNodes.find((n) => n.id === event.parentId)
            : undefined

          const posX = parentNode
            ? parentNode.position.x + 280
            : 50 + prevNodes.length * 280

          // 树布局算法：主干沿 y=180，自愈分支沿 y=340 向右下方下沉
          const posY = event.isCorrectionBranch ? 340 : 180

          const newNode: Node = {
            id: event.nodeId,
            type: 'agentNode',
            position: { x: posX, y: posY },
            data: {
              title: event.title || '任务节点',
              actor: event.actor || 'Pi (Coordinator)',
              gesture: event.gesture || 'think',
              status: initialStatus,
              summary: event.delta || '',
              isCorrectionBranch: event.isCorrectionBranch,
              observation: event.observation,
              payload: event.payload,
              assertion,
            } satisfies AgentNodeData,
          }

          const nextNodes = [...prevNodes, newNode]
          nodesRef.current = nextNodes
          return nextNodes
        })

        // 若有父节点，动态追加平滑 Edge
        if (event.parentId) {
          setEdges((prevEdges) => {
            const edgeId = `e-${event.parentId}-${event.nodeId}`
            if (prevEdges.some((e) => e.id === edgeId)) return prevEdges

            // 判断是否属于自愈分支边：当前节点属于自愈分支，或父节点属于自愈分支（自愈完成连回主干）
            const parentNode = nodesRef.current.find((n) => n.id === event.parentId)
            const isParentCorrection = Boolean(
              (parentNode?.data as unknown as AgentNodeData)?.isCorrectionBranch
            )
            const isCurrentCorrection = Boolean(event.isCorrectionBranch)
            const isBranchEdge = isCurrentCorrection || isParentCorrection

            // 自愈分支边带有琥珀金色/分支线；主干边采用素雅墨灰平滑线
            const edgeStyle = isBranchEdge
              ? { stroke: '#D97706', strokeWidth: 1.5, strokeDasharray: '5 4' }
              : { stroke: '#8F887D', strokeWidth: 1.5 }

            const newEdge: Edge = {
              id: edgeId,
              source: event.parentId!,
              target: event.nodeId,
              type: 'smoothstep',
              animated: true,
              style: edgeStyle,
            }
            return [...prevEdges, newEdge]
          })
        }
        break
      }

      case 'node_stream': {
        setNodes((prevNodes) =>
          prevNodes.map((node) => {
            if (node.id !== event.nodeId) return node
            const currentData = node.data as unknown as AgentNodeData
            return {
              ...node,
              data: {
                ...currentData,
                summary: (currentData.summary || '') + (event.delta || ''),
                status: event.status || currentData.status,
                observation: event.observation ?? currentData.observation,
                isCorrectionBranch:
                  event.isCorrectionBranch ?? currentData.isCorrectionBranch,
              } satisfies AgentNodeData,
            }
          })
        )
        break
      }

      case 'node_complete': {
        // Tool execution observations are asserted through assertionEngine before deciding node status and topology branching
        const assertion = event.assertion || assertionEngine.evaluate(event)

        let targetStatus: TelemetryStatus = event.status || 'completed'
        if (assertion.triggerGate && targetStatus !== 'rejected') {
          targetStatus = 'gate'
        } else if (assertion.triggerSelfCorrection && targetStatus !== 'gate') {
          targetStatus = 'failed'
        }

        setNodes((prevNodes) =>
          prevNodes.map((node) => {
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
                  : currentData.summary,
                observation: event.observation ?? currentData.observation,
                payload: event.payload ?? currentData.payload,
                isCorrectionBranch:
                  event.isCorrectionBranch ?? currentData.isCorrectionBranch,
              } satisfies AgentNodeData,
            }
          })
        )

        // 节点收敛完成：停止动画；失败节点 (status === 'failed') 的边用红色警示
        const isFailed = targetStatus === 'failed'
        setEdges((prevEdges) =>
          prevEdges.map((edge) => {
            if (edge.target === event.nodeId) {
              return {
                ...edge,
                animated: false,
                style: isFailed
                  ? { stroke: '#DC2626', strokeWidth: 2 }
                  : edge.style,
              }
            }
            return edge
          })
        )

        // 动态累加或同步上下文 Token 水位
        if (event.watermark) {
          setWatermark(event.watermark)
        } else {
          const delta = getDynamicWatermarkDelta(event)
          if (delta.activeTurns || delta.prunableTools) {
            setWatermark((prev) => ({
              ...prev,
              activeTurns: prev.activeTurns + (delta.activeTurns ?? 0),
              prunableTools: prev.prunableTools + (delta.prunableTools ?? 0),
            }))
          }
        }
        break
      }

      case 'gate_prompt': {
        setNodes((prevNodes) =>
          prevNodes.map((node) => {
            if (node.id !== event.nodeId) return node
            const currentData = node.data as unknown as AgentNodeData
            return {
              ...node,
              data: {
                ...currentData,
                status: 'gate',
                summary: event.delta
                  ? (currentData.summary || '') + event.delta
                  : currentData.summary,
                observation: event.observation ?? currentData.observation,
                isCorrectionBranch:
                  event.isCorrectionBranch ?? currentData.isCorrectionBranch,
              } satisfies AgentNodeData,
            }
          })
        )

        // 门禁等待：停止指向门禁节点的 Edge 动画
        setEdges((prevEdges) =>
          prevEdges.map((edge) =>
            edge.target === event.nodeId ? { ...edge, animated: false } : edge
          )
        )

        // 门禁到达：更新上下文 Token 水位
        if (event.watermark) {
          setWatermark(event.watermark)
        } else {
          const delta = getDynamicWatermarkDelta(event)
          if (delta.activeTurns || delta.prunableTools) {
            setWatermark((prev) => ({
              ...prev,
              activeTurns: prev.activeTurns + (delta.activeTurns ?? 0),
              prunableTools: prev.prunableTools + (delta.prunableTools ?? 0),
            }))
          }
        }
        break
      }

      case 'gate_resolved': {
        const decision = event.gateDecision
        const isRejected = decision?.action === 'reject'
        const isModified = decision?.action === 'modify'
        const newStatus: TelemetryStatus = isRejected ? 'rejected' : 'completed'
        const steering = decision?.modifiedCommand || decision?.feedback

        setNodes((prevNodes) =>
          prevNodes.map((node) => {
            if (node.id !== event.nodeId) return node
            const currentData = node.data as unknown as AgentNodeData
            let updatedSummary = currentData.summary || ''
            if (isRejected) {
              updatedSummary = `${updatedSummary} [门禁已拦截: ${decision?.feedback || '人类操作员拒绝放行'}]`
            } else if (isModified) {
              updatedSummary = `${updatedSummary} [已热纠偏放行]`
            } else {
              updatedSummary = `${updatedSummary} [人类已批准放行]`
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
        )

        // 边线状态：若被拦截变为红色实线警示，否则取消动画保持稳态
        setEdges((prevEdges) =>
          prevEdges.map((edge) => {
            if (edge.target === event.nodeId) {
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
        )
        break
      }

      case 'context_pruned': {
        const reclaimed = event.reclaimedTokens ?? 42000
        setIsPruned(true)
        setReclaimedTokens(reclaimed)
        if (event.watermark) {
          setWatermark(event.watermark)
        } else {
          setWatermark((prev) => ({
            ...prev,
            prunableTools: Math.min(prev.prunableTools, 4000),
          }))
        }

        setNodes((prevNodes) =>
          prevNodes.map((node) => {
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
        )
        break
      }
    }
  }, [setNodes, setEdges, setWatermark])

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
        // 当桥接服务已连接时，将裁决结果同步发送至 Bridge Server 解除 Agent 协程挂起
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

    // 若 Bridge 已连接，向远端 Agent 与其它端同步 context_pruned 遥测事件
    if (bridge.isConnected) {
      bridge.sendTelemetry({
        traceId: `prune-trace-${Date.now()}`,
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
      // 停止上一轮并重设标志
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

      // 重设水位至安全基准状态 (total ~22k tokens, safe green)
      let currentWatermark: ContextWatermark = { ...BASE_CONTEXT_WATERMARK }
      setWatermark(currentWatermark)

      // 清空画布准备流式长出
      nodesRef.current = []
      setNodes([])
      setEdges([])

      const traceId = `trace-${Date.now()}`

      for (const item of scenario) {
        if (isCancelledRef.current) break
        if (!(await waitWhilePaused())) break

        // 1. 发射 node_start：节点从左向右生成，带有运行中动效与连线
        processEvent({
          traceId,
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

        // 稍作等待以呈现初始卡片挂载
        if (!(await interruptibleSleep(120))) break
        if (!(await waitWhilePaused())) break

        // 2. 打字机流式输出 summary
        const text = item.fullSummary
        let cursor = 0
        while (cursor < text.length) {
          if (isCancelledRef.current) break
          if (!(await waitWhilePaused())) break

          const nextChunk = text.slice(cursor, cursor + chunkSize)
          cursor += chunkSize

          processEvent({
            traceId,
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

        // 计算当前步骤产生的 Token 水位增量
        const delta = getDynamicWatermarkDelta(item)
        currentWatermark = {
          ...currentWatermark,
          activeTurns: currentWatermark.activeTurns + (delta.activeTurns ?? 0),
          prunableTools: currentWatermark.prunableTools + (delta.prunableTools ?? 0),
        }
        setWatermark(currentWatermark)

        // 3. 节点收尾或进入决策门禁挂起
        // Tool execution observations are asserted through assertionEngine before deciding node status and topology branching
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

        // Rule 2 (Fatal Failure Resonance) 或 Rule 3 (高危命令模式) 或显式 isGate 触发门禁拦截
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

          // 触发模态窗并挂起 Promise 协程
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

          // 模态窗关闭
          setCurrentPendingGate(null)

          if (isCancelledRef.current) break
          if (!(await waitWhilePaused())) break

          // 记录裁决事件更新节点与边
          processEvent({
            traceId,
            nodeId: item.nodeId,
            type: 'gate_resolved',
            gesture: item.gesture,
            actor: item.actor,
            gateDecision: decision,
            assertion,
            isCorrectionBranch: item.isCorrectionBranch,
          })

          // 若人类操作员选择拒绝拦截，整洁中止流式播放
          if (decision.action === 'reject') {
            setIsPlaying(false)
            setIsPaused(false)
            isPausedRef.current = false
            return
          }
        } else {
          // Rule 1: 非零 Exit Code -> 触发立即自愈分叉 (Self-Correction Branching)
          const finalStatus: TelemetryStatus = assertion.triggerSelfCorrection
            ? 'failed'
            : item.status || 'completed'

          processEvent({
            traceId,
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

        // 步骤间微间隔，呈现从左向右的因果推进节奏
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
      // 若当前已有挂起门禁则直接聚焦
      if (currentPendingGate) return

      // 寻找画布中的门禁节点或 node-4
      const existingGateNode = nodesRef.current.find(
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

      // 将目标节点置为门禁待审状态
      setNodes((prevNodes) =>
        prevNodes.map((node) => {
          if (node.id !== targetNodeId) return node
          const currentData = node.data as unknown as AgentNodeData
          return {
            ...node,
            data: {
              ...currentData,
              status: 'gate',
            } satisfies AgentNodeData,
          }
        })
      )

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
        nodeId: targetNodeId,
        type: 'gate_resolved',
        gesture: 'gate',
        actor: 'Human Operator',
        gateDecision: decision,
      })

      return decision
    },
    [currentPendingGate, processEvent, setNodes]
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
  }
}
