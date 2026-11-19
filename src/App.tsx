import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react'
import {
  ReactFlow,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  applyNodeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react'
import {
  FolderGit2,
  Copy,
  Check,
  Layers,
  GitCommit,
  FileCode,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  X,
  HelpCircle,
  Compass,
} from 'lucide-react'
import { AgentNodeMemo } from './components/AgentNode'
import { TurnNodeMemo } from './components/TurnNode'
import { GateApprovalModal } from './components/GateApprovalModal'
import { extractPrunableItems } from './services/sessionTopology'
import { minimapNodeFill, minimapNodeStroke } from './services/statusTone'
import { ContextStripBar } from './components/ContextStripBar'
import { ContextInspectorDrawer } from './components/ContextInspectorDrawer'
import { NodeDetailsDrawer } from './components/NodeDetailsDrawer'
import { TurnDetailsDrawer } from './components/TurnDetailsDrawer'
import { StateTimelineScrubber } from './components/StateTimelineScrubber'
import { NodeContextMenu } from './components/NodeContextMenu'
import { HeaderNav, type StudioTab } from './components/HeaderNav'
import { SessionListSidebar } from './components/SessionListSidebar'
import { ContextHealthReportDrawer } from './components/ContextHealthReportDrawer'
import { buildContextHealthReport } from './services/contextHealthReport'
import { SHOWCASE_SCENARIOS } from './fixtures/showcaseSessions'
// 非首屏页面按需加载，首屏承担会话回放
const OverviewPage = lazy(() =>
  import('./pages/OverviewPage').then((mod) => ({ default: mod.OverviewPage }))
)
const ContextLabPage = lazy(() =>
  import('./pages/ContextLabPage').then((mod) => ({ default: mod.ContextLabPage }))
)
const RegressionPage = lazy(() =>
  import('./pages/RegressionPage').then((mod) => ({ default: mod.RegressionPage }))
)
const ShowcasePage = lazy(() =>
  import('./pages/ShowcasePage').then((mod) => ({ default: mod.ShowcasePage }))
)
import { useTelemetryStream } from './hooks/useTelemetryStream'
import {
  formatRelativeTime,
  copySessionDiagnosticToClipboard,
  type ActiveSessionItem,
  type TelemetryEvent,
  type MacroTurnGroup,
  BASE_CONTEXT_WATERMARK,
} from './types/telemetry'
import {
  parseTranscript,
  aggregateConsecutiveToolEvents,
  eventsToFlowNodesAndEdges,
  aggregateEventsIntoTurns,
  turnsToFlowNodesAndEdges,
} from './services/transcriptParser'

// 注册自定义节点组件
const nodeTypes = {
  agentNode: AgentNodeMemo,
  turnNode: TurnNodeMemo,
}

// 初始默认因果事件流（涵盖 思考 -> 实现 -> 异常单测 -> ReAct 自愈分叉 -> 自愈回归 -> 门禁审批 完整闭环）
const defaultMockEvents: TelemetryEvent[] = [
  {
    traceId: 'demo-session',
    nodeId: 'node-sc-1',
    type: 'node_complete',
    gesture: 'think',
    actor: 'Pi (Coordinator)',
    title: '任务拆解与编排',
    status: 'completed',
    delta: '编排 Ghost 核心数据清洗管道重构，派发 Claude Worker 协程并启动单测观测守护。',
  },
  {
    traceId: 'demo-session',
    nodeId: 'node-sc-2',
    parentId: 'node-sc-1',
    type: 'node_complete',
    gesture: 'edit',
    actor: 'Claude 3.7 (Worker)',
    title: '代码重构实现',
    status: 'completed',
    delta: '重构数据清洗管道，移除命令式 try-catch 胶水，迁移至 radash.tryit 强契约封装。',
  },
  {
    traceId: 'demo-session',
    nodeId: 'node-sc-3',
    parentId: 'node-sc-2',
    type: 'node_complete',
    gesture: 'bash',
    actor: 'Claude 3.7 (Worker)',
    title: '单测回归 (捕获异常)',
    status: 'failed',
    delta: '执行 pnpm test:pipeline -> 捕获断言异常：1 failed, 155 passed。检测到空输入逃逸。',
    observation: {
      exitCode: 1,
      output: [
        'AssertionError: Expected 200 OK, got 500 Internal Error',
        'at packages/core/test/pipeline.test.ts:42',
      ],
    },
  },
  {
    traceId: 'demo-session',
    nodeId: 'node-sc-4',
    parentId: 'node-sc-3',
    type: 'node_complete',
    gesture: 'think',
    actor: 'Claude 3.7 (Worker)',
    title: 'ReAct 自愈诊断分叉',
    status: 'completed',
    delta: '捕获单测 exit: 1 异常堆栈，诊断定位 radash.tryit 在空 payload 输入时未做默认兜底回退。',
    isCorrectionBranch: true,
  },
  {
    traceId: 'demo-session',
    nodeId: 'node-sc-5',
    parentId: 'node-sc-4',
    type: 'node_complete',
    gesture: 'edit',
    actor: 'Claude 3.7 (Worker)',
    title: '自愈补丁实施',
    status: 'completed',
    delta: '注入防御性空值 fallback，完善 pipeline 边界强契约校验，消除脏数据逃逸风险。',
    isCorrectionBranch: true,
  },
  {
    traceId: 'demo-session',
    nodeId: 'node-sc-6',
    parentId: 'node-sc-5',
    type: 'node_complete',
    gesture: 'bash',
    actor: 'Claude 3.7 (Worker)',
    title: '自愈回归验证',
    status: 'completed',
    delta: '重新执行 pnpm test:pipeline -> 156 passed, 0 failed (1.78s) 单测全部通过！',
    isCorrectionBranch: true,
    observation: {
      exitCode: 0,
      output: ['Tests: 156 passed, 156 total', 'Time: 1.78s'],
    },
  },
  {
    traceId: 'demo-session',
    nodeId: 'node-sc-7',
    parentId: 'node-sc-6',
    type: 'node_complete',
    gesture: 'gate',
    actor: 'Human Operator',
    title: '自愈收敛与 Git 门禁审查',
    status: 'gate',
    delta: '单测自愈闭环，重新连回主干因果链。触发 Git 提交审查与全机门禁放行。',
  },
]

// 默认画布网格排版参数：单行容纳 8 步，使微观拓扑（通常 6~8 步）在一行内自然舒展展开，彻底消除反向逆行大框
const CANVAS_FLOW_GRID_OPTIONS = {
  nodesPerRow: 8,
  branchOffset: 160,
  rowGap: 340,
}

// 初始默认静态节点与连线（由 defaultMockEvents 直出）
const initialDefaultFlow = eventsToFlowNodesAndEdges(defaultMockEvents, CANVAS_FLOW_GRID_OPTIONS)
const defaultMockNodes: Node[] = initialDefaultFlow.nodes
const defaultMockEdges: Edge[] = initialDefaultFlow.edges

/**
 * 画布视口控制器子组件 (CanvasViewportController)
 * 挂载于 ReactFlowProvider / ReactFlow 内部，拥有 useReactFlow 上下文
 * 在首屏加载、翻页切片、折叠切换、重置及会话切换时自动居中聚焦 fitView，根治白屏与视口飘走
 */
interface CanvasViewportControllerProps {
  activeSessionId: string
  viewMode: 'turns' | 'flat'
  activeDrilldownTurnId: string | null
  isFoldingEnabled: boolean
  resetKey: number
}

function CanvasViewportController({
  activeSessionId,
  viewMode,
  activeDrilldownTurnId,
  isFoldingEnabled,
  resetKey,
}: CanvasViewportControllerProps) {
  const { fitView } = useReactFlow()
  const isInitialRef = useRef(true)

  useEffect(() => {
    // 无论是初次挂载、切会话、切换视图、进入/退出下钻还是折叠切换，等 React Flow 完成 DOM 布局后平滑聚焦
    const timer = setTimeout(() => {
      fitView({ padding: 0.2, minZoom: 0.65, duration: isInitialRef.current ? 0 : 300 })
      isInitialRef.current = false
    }, 50)
    return () => clearTimeout(timer)
  }, [
    activeSessionId,
    viewMode,
    activeDrilldownTurnId,
    isFoldingEnabled,
    resetKey,
    fitView,
  ])

  return null
}

/**
 * 按需加载占位：与 Paper & Ink 视觉同源，避免懒加载瞬间白屏
 */
const PageLoadingHint: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex-1 flex items-center justify-center text-xs font-mono text-[#8F887D]">
    {label}...
  </div>
)

/**
 * 5 大精选工业级案卷：涵盖双焦回合、死循环自愈、微压缩与人机门禁，开箱即可完整演练
 */
const CURATED_SESSIONS: ActiveSessionItem[] = [
  {
    id: 'demo-session',
    title: 'Ghost 管道重构与自愈闭环',
    actors: ['Pi (Coordinator)', 'Claude 3.7 (Worker)'],
    status: 'completed',
    nodeCount: 8,
    updatedAt: Date.now() - 1000 * 60 * 5,
    project: 'Ghost',
  },
  {
    id: 'hierarchical-focus',
    title: '宏微双焦复合回合编排与微观下钻',
    actors: ['Human Operator', 'Pi (Coordinator)', 'Claude 3.7'],
    status: 'completed',
    nodeCount: 12,
    updatedAt: Date.now() - 1000 * 60 * 20,
    project: 'NetDive',
  },
  {
    id: 'loop-resonance',
    title: '死循环检测与确定性自动熔断',
    actors: ['Claude 3.7 (Worker)'],
    status: 'failed',
    nodeCount: 10,
    updatedAt: Date.now() - 1000 * 60 * 45,
    project: 'Core',
  },
  {
    id: 'micro-compactor',
    title: '长上下文确定性微压缩与缓存保护',
    actors: ['Vite', 'TypeScript Worker'],
    status: 'completed',
    nodeCount: 7,
    updatedAt: Date.now() - 1000 * 60 * 90,
    project: 'NetDive',
  },
  {
    id: 'hitl-gate',
    title: '高危命令拦截与跨进程人机门禁',
    actors: ['Pi (Coordinator)', 'Human Operator'],
    status: 'gate',
    nodeCount: 5,
    updatedAt: Date.now() - 1000 * 60 * 180,
    project: 'Bebop',
  },
]

function MainFlowCanvas() {
  const {
    onEdgesChange,
    isPlaying,
    currentPendingGate,
    resolveCurrentGate,
    resetStream,
    bridge,
    watermark,
    setWatermark,
    activeSessionId,
    setActiveSessionId,
    activeSessionMeta,
  } = useTelemetryStream({
    initialNodes: defaultMockNodes,
    initialEdges: defaultMockEdges,
  })

  // 顶层路由与 URL 路径状态监听
  const [routePath, setRoutePath] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return window.location.pathname.toLowerCase() + window.location.hash.toLowerCase()
    }
    return '/'
  })

  useEffect(() => {
    const handleRouteChange = () => {
      const fullPath = window.location.pathname.toLowerCase() + window.location.hash.toLowerCase()
      setRoutePath(fullPath)
      const hash = window.location.hash.toLowerCase()
      if (hash.includes('regression')) {
        setActiveTab('regression')
      } else if (hash.includes('context') || hash.includes('lab')) {
        setActiveTab('context')
      } else if (!hash || hash === '#' || hash === '#live') {
        setActiveTab('live')
      }
    }
    window.addEventListener('popstate', handleRouteChange)
    window.addEventListener('hashchange', handleRouteChange)
    return () => {
      window.removeEventListener('popstate', handleRouteChange)
      window.removeEventListener('hashchange', handleRouteChange)
    }
  }, [])

  // 顶层路由判定：当前路径是否为 /showcase 独立演示路由
  const isShowcaseRoute = useMemo(() => {
    return (
      routePath === '/showcase' ||
      routePath.startsWith('/showcase/') ||
      routePath.includes('#showcase') ||
      routePath.includes('#/showcase')
    )
  }, [routePath])

  // Studio 内部子 Tab：'overview' (主页概览) | 'live' (会话回放) | 'regression' (测试对比) | 'context' (上下文演练)
  const [activeTab, setActiveTab] = useState<StudioTab>(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.toLowerCase()
      if (hash.includes('live')) return 'live'
      if (hash.includes('regression')) return 'regression'
      if (hash.includes('context') || hash.includes('lab')) return 'context'
      if (hash.includes('overview')) return 'overview'
    }
    // 默认首选概览主页，让用户第一眼看明白各个模块是干嘛的
    return 'overview'
  })

  const handleTabChange = useCallback((tab: StudioTab) => {
    setActiveTab(tab)
    setIsHealthReportOpen(false)
    setIsInspectorOpen(false)
    if (typeof window !== 'undefined') {
      window.location.hash = tab === 'overview' ? '' : `#${tab}`
    }
  }, [])
  const [isInspectorOpen, setIsInspectorOpen] = useState(false)
  const [selectedDetailsNode, setSelectedDetailsNode] = useState<Node | null>(null)
  // 仅记录被人类拖动过的节点位移，避免把整份派生节点镜像回状态
  const [positionOverrides, setPositionOverrides] = useState<Record<string, XYPosition>>({})
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedTurnForDrawer, setSelectedTurnForDrawer] = useState<MacroTurnGroup | null>(null)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isDiagnosticCopied, setIsDiagnosticCopied] = useState(false)
  const [isHealthReportOpen, setIsHealthReportOpen] = useState(false)
  const [isGuideOpen, setIsGuideOpen] = useState(false)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  // 追踪节点拖拽排版交互：区分物理拖拽排版与单纯点击查看详情
  const hasNodeDraggedRef = useRef(false)
  const dragFinishedTimeRef = useRef(0)
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null)

  // 双焦视图模式：'turns' (宏观回合) | 'flat' (全量流水)
  const [viewMode, setViewMode] = useState<'turns' | 'flat'>('turns')

  // 微观下钻选中的 Turn ID (为 null 时处于宏观总览态)
  const [activeDrilldownTurnId, setActiveDrilldownTurnId] = useState<string | null>(null)

  // 用户手动导入的外部/本地账本
  const [importedSessions, setImportedSessions] = useState<ActiveSessionItem[]>([])

  // 缓存当前会话的原始事件流水 (rawEvents)，作为同构折叠与拓扑重算的单一真理源。
  // 首屏默认装载精选案卷（defaultMockEvents），保证开箱即有完整因果 DAG 与水位呈现，彻底告别灰色死屏
  const [rawEvents, setRawEvents] = useState<TelemetryEvent[]>(defaultMockEvents)
  const [resetKey, setResetKey] = useState<number>(0)

  // 复盘诊断报告由纯函数从事件流与水位派生，抽屉与导出共用同一对象
  const healthReport = useMemo(
    () => buildContextHealthReport(rawEvents, watermark),
    [rawEvents, watermark]
  )

  // 维护全局 eventsMap，用于点击节点时按需 JIT 取出原始 TelemetryEvent 渲染详情
  const eventsMap = useMemo(() => {
    const map = new Map<string, TelemetryEvent>()
    for (const ev of rawEvents) {
      map.set(ev.nodeId, ev)
    }
    return map
  }, [rawEvents])

  // 时光回溯状态机 (仅在非 running 态展示与交互)
  const [timelineStep, setTimelineStep] = useState<number>(0)
  const [isTimelinePlaying, setIsTimelinePlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1)
  const [isFoldingEnabled, setIsFoldingEnabled] = useState(true)
  const playbackTimerRef = useRef<number | null>(null)

  // 1. 将原始流水聚合为宏观回合
  const macroTurns = useMemo(() => {
    if (!rawEvents || rawEvents.length === 0) return []
    return aggregateEventsIntoTurns(rawEvents)
  }, [rawEvents])

  // 当仅存在 1 个交互回合（没有其他回合可对比聚合）时，直给呈现微观微观层级，消灭多余的一步点击！
  const shouldAutoDrilldown = macroTurns.length === 1 && !activeDrilldownTurnId
  const effectiveActiveDrilldownTurnId = shouldAutoDrilldown
    ? macroTurns[0].turnId
    : activeDrilldownTurnId

  // 当前活跃的下钻 Turn 对象
  const activeTurn = useMemo(() => {
    if (!effectiveActiveDrilldownTurnId) return null
    return macroTurns.find((t) => t.turnId === effectiveActiveDrilldownTurnId) || null
  }, [macroTurns, effectiveActiveDrilldownTurnId])

  const activeTurnIndex = useMemo(() => {
    if (!activeTurn) return -1
    return macroTurns.findIndex((t) => t.turnId === activeTurn.turnId)
  }, [macroTurns, activeTurn])

  // 当前下钻 Turn 的内部所有事件（全量连贯因果流，绝不切片断链）
  const currentTurnAllEvents = useMemo(() => {
    return activeTurn?.subEvents || []
  }, [activeTurn])

  // 2. 依据当前视图模式 (Macro Turns / Micro Drilldown / Flat Trace) 派生 React Flow 节点与边
  const { derivedNodes, derivedEdges } = useMemo(() => {
    if (!rawEvents || rawEvents.length === 0) {
      return { derivedNodes: [], derivedEdges: [] }
    }

    if (viewMode === 'turns') {
      if (effectiveActiveDrilldownTurnId && activeTurn) {
        // 微观下钻模式：支持在回合内部对连续同构工具调用进行智能折叠
        // 确保微观内部因果边 100% 连贯，绝不分页断链
        const displayTurnEvents = aggregateConsecutiveToolEvents(currentTurnAllEvents, {
          enabled: isFoldingEnabled,
        })
        const { nodes: microNodes, edges: microEdges } = eventsToFlowNodesAndEdges(
          displayTurnEvents,
          CANVAS_FLOW_GRID_OPTIONS
        )
        return { derivedNodes: microNodes, derivedEdges: microEdges }
      }

      // 宏观回合总览模式：渲染 Macro Turn 卡片 DAG
      const { nodes: turnNodes, edges: turnEdges } = turnsToFlowNodesAndEdges(macroTurns, {
        onDrillDown: (turnId) => {
          setActiveDrilldownTurnId(turnId)
        },
      })
      return { derivedNodes: turnNodes, derivedEdges: turnEdges }
    }

    // 全量流水模式 (Flat Trace)：平铺呈现原子工具调用，并支持连续同构调用折叠
    const displayEvents = aggregateConsecutiveToolEvents(rawEvents, { enabled: isFoldingEnabled })
    const { nodes: fn, edges: fe } = eventsToFlowNodesAndEdges(
      displayEvents,
      CANVAS_FLOW_GRID_OPTIONS
    )
    return { derivedNodes: fn, derivedEdges: fe }
  }, [rawEvents, viewMode, effectiveActiveDrilldownTurnId, activeTurn, currentTurnAllEvents, macroTurns, isFoldingEnabled])

  // 派生结果直喂画布：不再回写 hook 内部 nodes 状态，消除每次事件的二次渲染
  const totalNodesCount = derivedNodes.length

  // 剪枝机会：节点只提供瘦标量，完整载荷按 nodeId 从 eventsMap JIT 取回
  const prunableItems = useMemo(
    () => extractPrunableItems(derivedNodes, (nodeId) => eventsMap.get(nodeId)),
    [derivedNodes, eventsMap]
  )

  // 当前时间轴截断渲染的节点集合
  const visibleNodes = useMemo(() => {
    if (totalNodesCount === 0) return []
    const step = timelineStep > 0 ? Math.min(timelineStep, totalNodesCount) : totalNodesCount
    return derivedNodes.slice(0, step).map((node) => {
      const override = positionOverrides[node.id]
      const isSelected = node.id === selectedNodeId
      if (!override && node.selected === isSelected) return node
      return {
        ...node,
        position: override ?? node.position,
        selected: isSelected,
      }
    })
  }, [derivedNodes, timelineStep, totalNodesCount, positionOverrides, selectedNodeId])

  // 受控当前画布节点状态：通过 React Flow 官方 applyNodeChanges 驱动，保证拖拽期间尺寸与 dragging 状态完备
  const [activeFlowNodes, setActiveFlowNodes] = useState<Node[]>([])

  useEffect(() => {
    setActiveFlowNodes(visibleNodes)
  }, [visibleNodes])

  /**
   * 画布节点变更吸收器：使用 React Flow 官方 applyNodeChanges 纯函数
   * 完整保留 dragging 与 measured 尺寸，确保 EdgeRenderer 实时根据 Handle 计算坐标，彻底根除连线看不见的问题
   */
  const handleFlowNodesChange = useCallback((changes: NodeChange[]) => {
    setActiveFlowNodes((currentNodes) => applyNodeChanges(changes, currentNodes))
  }, [])

  // 当前时间轴截断渲染的边集合：
  // 关键优化：边只取决于连接拓扑与截断步数，绝不依赖 positionOverrides！
  // 保持 visibleEdges 数组引用稳定，杜绝拖拽过程中 React Flow 逐帧全量重构 SVG 导致连线闪烁和消失
  const visibleEdges = useMemo(() => {
    if (totalNodesCount === 0) return []
    const step = timelineStep > 0 ? Math.min(timelineStep, totalNodesCount) : totalNodesCount
    const slicedNodeIds = new Set(derivedNodes.slice(0, step).map((n) => n.id))
    return derivedEdges.filter((e) => slicedNodeIds.has(e.source) && slicedNodeIds.has(e.target))
  }, [derivedNodes, derivedEdges, timelineStep, totalNodesCount])

  // 判断当前选中的会话是否处于活跃运行/待审批状态
  const isCurrentSessionActive = activeSessionMeta?.status === 'running' || activeSessionMeta?.status === 'gate'

  // 当会话切换、视图切换、下钻切换或节点更新时，重置时间轴当前步数至最新步
  useEffect(() => {
    if (!isPlaying) {
      setTimelineStep(totalNodesCount)
      setIsTimelinePlaying(false)
    }
  }, [totalNodesCount, isPlaying, viewMode, activeDrilldownTurnId])

  // 时间轴自动回放定时器驱动
  useEffect(() => {
    if (!isTimelinePlaying) {
      if (playbackTimerRef.current) {
        clearInterval(playbackTimerRef.current)
        playbackTimerRef.current = null
      }
      return
    }

    const intervalMs = Math.max(250, Math.floor(1000 / playbackSpeed))
    playbackTimerRef.current = window.setInterval(() => {
      setTimelineStep((prev) => {
        const next = (prev || 0) + 1
        if (next >= totalNodesCount) {
          setIsTimelinePlaying(false)
          return totalNodesCount
        }
        return next
      })
    }, intervalMs)

    return () => {
      if (playbackTimerRef.current) {
        clearInterval(playbackTimerRef.current)
        playbackTimerRef.current = null
      }
    }
  }, [isTimelinePlaying, playbackSpeed, totalNodesCount])

  // 监听 Esc 键快捷关闭详情抽屉与退出下钻
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedDetailsNode) {
          setSelectedDetailsNode(null)
          setSelectedNodeId(null)
          return
        }
        if (selectedTurnForDrawer) {
          setSelectedTurnForDrawer(null)
          return
        }
        if (activeDrilldownTurnId) {
          setActiveDrilldownTurnId(null)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedDetailsNode, selectedTurnForDrawer, activeDrilldownTurnId])

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    node: Node
  } | null>(null)

  // 侧边栏案卷列表：精选案卷为核心，用户手动导入的会话置顶合并
  const displaySessionsList: ActiveSessionItem[] = useMemo(() => {
    return [...importedSessions, ...CURATED_SESSIONS]
  }, [importedSessions])

  // 若当前处于 /showcase 独立展示路由，全屏呈现自包含展示页，不渲染工作台顶栏、侧边栏、执行控制台与压缩沙盒
  if (isShowcaseRoute) {
    return (
      <div className="h-screen w-screen flex flex-col bg-[#FBF9F5] text-[#1E2024] overflow-hidden">
        <Suspense fallback={<PageLoadingHint label="正在装载演示沙盒" />}>
          <ShowcasePage />
        </Suspense>
      </div>
    )
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#FBF9F5] text-[#1E2024] overflow-hidden">
      {/* 顶部素雅工具条 (Clean Minimal Header) */}
      <header className="h-11 border-b border-[#E5E0D8] bg-[#FBF9F5] px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3.5">
          <span className="font-bold text-base tracking-tight text-[#1E2024] select-none">NetDive</span>

          <HeaderNav
            activeTab={activeTab}
            onChangeTab={handleTabChange}
            bridgeConnected={bridge.isConnected}
          />
        </div>

        {/* 右侧轻量状态与帮助指引 */}
        <div className="flex items-center space-x-2.5">
          <div
            className={`flex items-center space-x-1.5 px-2 py-0.5 rounded text-[11px] font-mono border ${
              bridge.isConnected
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-[#F2EDE4] text-[#706A5F] border-[#DCD5C9]'
            }`}
            title={
              bridge.isConnected
                ? 'Bridge 伴生服务已联通 (127.0.0.1:4560)：支持自动扫描本地会话与实时门禁挂起'
                : '纯本地离线复盘模式：无需启动伴生后台，随时拖入 .jsonl 或点选案卷'
            }
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                bridge.isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-[#9E978C]'
              }`}
            />
            <span>{bridge.isConnected ? 'Bridge 4560 就绪' : '本地离线模式'}</span>
          </div>

          <button
            onClick={() => setIsGuideOpen(true)}
            className="px-2 py-0.5 rounded border border-[#DCD5C9] bg-white hover:bg-[#F4F0EA] text-[#5C5549] hover:text-[#1E2024] text-xs flex items-center space-x-1 transition-colors cursor-pointer"
            title="查看 NetDive 三步复盘操作指南"
          >
            <HelpCircle className="w-3.5 h-3.5 text-amber-600" />
            <span className="font-medium">复盘指南</span>
          </button>
        </div>
      </header>

      {/* 视图内容区：状态隔离且不丢失 Live 状态 */}
      {activeTab === 'overview' ? (
        <div className="flex-1 flex flex-col w-full min-h-0 overflow-hidden">
          <Suspense fallback={<PageLoadingHint label="正在装载项目概览" />}>
            <OverviewPage
              onNavigate={handleTabChange}
              bridgeConnected={bridge.isConnected}
            />
          </Suspense>
        </div>
      ) : activeTab === 'live' ? (
        <div className="flex-1 flex w-full min-h-0 overflow-hidden">
          {/* 左侧任务会话侧边栏 (Master) */}
          <SessionListSidebar
            sessions={displaySessionsList}
            activeSessionId={activeSessionId}
            importInputRef={importInputRef}
            bridgeConnected={bridge.isConnected}
            onSelectSession={async (sid) => {
              setContextMenu(null)
              setIsHealthReportOpen(false)
              setSelectedDetailsNode(null)
              setSelectedNodeId(null)
              setSelectedTurnForDrawer(null)
              setActiveDrilldownTurnId(null)

              // 1. 已是当前会话且画布已有事件时无需重复加载
              if (activeSessionId === sid && totalNodesCount > 0) return

              // 2. 立即激活选中状态 (侧边栏高亮即时生效)
              setActiveSessionId(sid)

              // 3. 默认 Ghost 重构案卷
              if (sid === 'demo-session' || sid === 'default-session') {
                setRawEvents(defaultMockEvents)
                setWatermark(BASE_CONTEXT_WATERMARK)
                return
              }

              // 4. 精选 Showcase 场景直通（宏微双焦 / 死循环自愈 / 微压缩 / 人机门禁）
              const scenario = SHOWCASE_SCENARIOS.find((sc) => sc.id === sid)
              if (scenario) {
                setRawEvents(scenario.events)
                setWatermark(BASE_CONTEXT_WATERMARK)
                return
              }

              // 5. 真实本地/导入会话：从本地 Bridge 取物理账本现场解析
              const text = await bridge.fetchSessionTranscript(sid)
              if (text && text.trim()) {
                const parsed = parseTranscript(text)
                setRawEvents(parsed.events)
                setWatermark(parsed.watermark || BASE_CONTEXT_WATERMARK)
              }
            }}
            onImportJsonl={(content, fileName) => {
              setContextMenu(null)
              setIsHealthReportOpen(false)
              setSelectedDetailsNode(null)
              setSelectedNodeId(null)
              setSelectedTurnForDrawer(null)
              setActiveDrilldownTurnId(null)
              const parsed = parseTranscript(content)
              const newSid = parsed.session.sessionId || parsed.session.id || `imported-${Date.now()}`
              const displayTitle = fileName ? fileName.replace(/\.jsonl$/i, '') : (parsed.events[0]?.title || '导入的本地账本')
              const displayActors = parsed.session.agentName ? [parsed.session.agentName] : ['Local Agent']
              const newSessionItem: ActiveSessionItem = {
                id: newSid,
                title: displayTitle,
                actors: displayActors,
                status: 'completed',
                nodeCount: parsed.events.length,
                updatedAt: Date.now(),
                project: parsed.session.cwdBase || '本地账本',
              }
              setImportedSessions((prev) => [newSessionItem, ...prev.filter((s) => s.id !== newSid)])
              setActiveSessionId(newSid)
              setRawEvents(parsed.events)
              setWatermark(parsed.watermark || BASE_CONTEXT_WATERMARK)
            }}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
          />

          {/* 中间核心工作区 (Detail) */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
            {/* 当前会话面包屑详情条 */}
            <div className="h-9 px-4 border-b border-[#E5E0D8] bg-[#FAF8F5]/90 backdrop-blur-xs flex items-center justify-between text-xs shrink-0 select-none">
              <div className="flex items-center space-x-2 min-w-0">
                <div className="flex items-center space-x-1.5 font-medium text-[#1E2024] truncate">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${activeSessionId === 'live-waiting' ? 'bg-amber-500 animate-pulse' : 'bg-[#1E2024]'}`} />
                  <span className="font-semibold truncate max-w-xs md:max-w-md">
                    {activeSessionId === 'live-waiting'
                      ? '等待外部 Agent 连接接入中...'
                      : totalNodesCount === 0
                        ? '尚未选择会话'
                        : (displaySessionsList.find((s) => s.id === activeSessionId)?.title || activeSessionMeta?.title || '未命名任务会话')}
                  </span>
                </div>

                {/* 📋 一键复制诊断现场（紧随标题之后） */}
                {activeSessionId !== 'live-waiting' && (
                  <button
                    onClick={async () => {
                      const currentItem = displaySessionsList.find((s) => s.id === activeSessionId) || activeSessionMeta
                      const res = await copySessionDiagnosticToClipboard({
                        sessionMeta: currentItem,
                        nodes: derivedNodes,
                      })
                      if (res.success) {
                        setIsDiagnosticCopied(true)
                        setTimeout(() => setIsDiagnosticCopied(false), 2000)
                      }
                    }}
                    className={`ml-1 px-1.5 py-0.5 rounded border flex items-center space-x-1 transition-all cursor-pointer ${
                      isDiagnosticCopied
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300 shadow-2xs'
                        : 'bg-white text-[#5C5549] border-[#E5E0D8] hover:bg-[#F4F0EA] hover:text-[#1E2024]'
                    }`}
                    title="复制当前会话的 Markdown 诊断报告，方便向 AI 提问与交流"
                  >
                    {isDiagnosticCopied ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600" />
                        <span className="text-[10px] font-sans font-medium text-emerald-700">已复制</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3 text-[#8F887D]" />
                        <span className="text-[10px] font-sans">复制现场</span>
                      </>
                    )}
                  </button>
                )}

                {/* 复盘诊断报告入口：空会话禁用，避免展示伪造指标 */}
                {rawEvents.length > 0 && (
                  <button
                    onClick={() => setIsHealthReportOpen((open) => !open)}
                    className={`px-1.5 py-0.5 rounded border flex items-center space-x-1 transition-all cursor-pointer ${
                      isHealthReportOpen
                        ? 'bg-amber-50 text-amber-800 border-amber-300 shadow-2xs'
                        : 'bg-white text-[#5C5549] border-[#E5E0D8] hover:bg-[#F4F0EA] hover:text-[#1E2024]'
                    }`}
                    title="基于当前会话生成上下文诊断与优化建议"
                  >
                    <ClipboardList className="w-3 h-3 text-[#8F887D]" />
                    <span className="text-[10px] font-sans">复盘诊断</span>
                  </button>
                )}

                <span className="text-[#D5CDBD]">·</span>

                {/* 协同 Agent 标签 */}
                <div className="flex items-center space-x-1 shrink-0">
                  {activeSessionId === 'live-waiting' ? (
                    <span className="text-[10px] font-mono text-amber-800 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                      待命监听
                    </span>
                  ) : activeSessionMeta?.actors && activeSessionMeta.actors.length > 0 ? (
                    activeSessionMeta.actors.map((actor, idx) => (
                      <span
                        key={idx}
                        className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#EAE4D9] text-[#3D3831] border border-[#D5CDBD]"
                      >
                        {actor.replace(/\s*\([^)]*\)/g, '')}
                      </span>
                    ))
                  ) : (
                    <span className="text-[10px] font-mono text-[#8F887D]">单 Agent 独立执行</span>
                  )}

                  {activeSessionMeta?.project && (
                    <span
                      className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-50 text-amber-900 border border-amber-200 flex items-center space-x-0.5"
                      title={`所属工程: ${activeSessionMeta.project}`}
                    >
                      <FolderGit2 className="w-2.5 h-2.5 inline mr-0.5 text-amber-700" />
                      <span>{activeSessionMeta.project}</span>
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-3 text-[11px] font-mono text-[#8F887D] shrink-0 ml-2">
                {/* 宏观回合 / 全量流水 双焦视图切换控件 */}
                <div className="inline-flex items-center p-0.5 rounded-lg bg-[#EAE4D9]/60 border border-[#D5CDBD]">
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('turns')
                      setActiveDrilldownTurnId(null)
                    }}
                    className={`px-2 py-0.5 text-[11px] font-sans font-medium rounded-md transition-all cursor-pointer flex items-center space-x-1.5 ${
                      viewMode === 'turns'
                        ? 'bg-white text-[#1E2024] shadow-2xs font-semibold'
                        : 'text-[#5C5549] hover:text-[#1E2024]'
                    }`}
                    title="宏观回合模式：按交互回合聚合呈现主干因果拓扑，支持点击下钻微观细节"
                  >
                    <Layers className="w-3 h-3 text-amber-700" />
                    <span>宏观回合</span>
                    {macroTurns.length > 0 && (
                      <span className="text-[10px] font-mono px-1 py-0.2 rounded-full bg-[#EAE4D9] text-[#3D3831] font-bold">
                        {macroTurns.length}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('flat')
                      setActiveDrilldownTurnId(null)
                    }}
                    className={`px-2 py-0.5 text-[11px] font-sans font-medium rounded-md transition-all cursor-pointer flex items-center space-x-1.5 ${
                      viewMode === 'flat'
                        ? 'bg-white text-[#1E2024] shadow-2xs font-semibold'
                        : 'text-[#5C5549] hover:text-[#1E2024]'
                    }`}
                    title="全量流水模式：平铺呈现每一项底层原子工具调用与状态"
                  >
                    <GitCommit className="w-3 h-3 text-[#1E2024]" />
                    <span>全量流水</span>
                  </button>
                </div>

                <span className="text-[#D5CDBD]">·</span>

                <span className="flex items-center space-x-1">
                  <span className="text-[#1E2024] font-medium">
                    {viewMode === 'turns'
                      ? activeDrilldownTurnId
                        ? `${currentTurnAllEvents.length} 步`
                        : `${macroTurns.length} 回合`
                      : `${totalNodesCount} 步`}
                  </span>
                  <span>{viewMode === 'turns' && !activeDrilldownTurnId ? '复合节点' : '原子节点'}</span>
                </span>
                <span className="text-[#D5CDBD]">·</span>
                <span>{activeSessionMeta ? formatRelativeTime(activeSessionMeta.updatedAt) : '刚刚'}</span>
              </div>
            </div>

            {/* 主体画布与侧边栏抽屉协同 Push 布局 */}
            <main className="flex-1 flex w-full min-h-0 overflow-hidden relative">
              <div className="flex-1 h-full relative paper-pattern min-w-0 transition-all duration-300">
                {totalNodesCount === 0 ? (
                  activeSessionId === 'live-waiting' ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center select-none z-10 pointer-events-none">
                      <div className="w-12 h-12 rounded-2xl bg-white border border-[#E5E0D8] shadow-sm flex items-center justify-center mb-3 text-emerald-600">
                        <span className="w-3 h-3 rounded-full bg-emerald-500 animate-ping" />
                      </div>
                      <h4 className="text-sm font-semibold text-[#1E2024]">正在监听本地实时工作流...</h4>
                      <p className="text-xs text-[#8F887D] max-w-xs mt-1.5 font-mono leading-relaxed">
                        启动本地 Agent (Pi / Hermes) 触发执行，或在左下角导入本地会话文件 (.jsonl)
                      </p>
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center select-none z-10">
                      <div className="w-12 h-12 rounded-2xl bg-white border border-[#E5E0D8] shadow-sm flex items-center justify-center mb-3 text-[#5C5549]">
                        <FileCode className="w-5 h-5" />
                      </div>
                      <h4 className="text-sm font-semibold text-[#1E2024]">还没有可复盘的会话</h4>
                      <p className="text-xs text-[#8F887D] max-w-xs mt-1.5 leading-relaxed">
                        从左侧选择本地会话，或直接导入 .jsonl 账本开始复盘。
                      </p>
                      <button
                        type="button"
                        onClick={() => importInputRef.current?.click()}
                        className="mt-4 px-3 py-1.5 rounded-md bg-[#1E2024] text-[#FBF9F5] text-xs font-medium cursor-pointer pointer-events-auto"
                      >
                        导入 .jsonl
                      </button>
                    </div>
                  )
                ) : null}

                <ReactFlow
                  nodes={activeFlowNodes}
                  edges={visibleEdges}
                  nodeTypes={nodeTypes}
                  onNodesChange={handleFlowNodesChange}
                  onEdgesChange={onEdgesChange}
                  nodeDragThreshold={3}
                  onPointerDown={(e) => {
                    pointerDownPosRef.current = { x: e.clientX, y: e.clientY }
                  }}
                  onNodeDragStart={() => {
                    hasNodeDraggedRef.current = false
                  }}
                  onNodeDrag={() => {
                    hasNodeDraggedRef.current = true
                    dragFinishedTimeRef.current = Date.now()
                  }}
                  onNodeDragStop={(_event, node) => {
                    hasNodeDraggedRef.current = true
                    dragFinishedTimeRef.current = Date.now()
                    setTimeout(() => {
                      hasNodeDraggedRef.current = false
                    }, 500)
                    // 固化保存最终位置覆盖，确保时光切片回放依然保留排版位置
                    if (node.position) {
                      setPositionOverrides((prev) => ({
                        ...prev,
                        [node.id]: node.position,
                      }))
                    }
                  }}
                  onNodeClick={(event, node) => {
                    // 像素级位移防误触：只要位移超过 5px，或处于拖拽后 500ms 内，坚决不触发点击展开抽屉
                    const dist = pointerDownPosRef.current
                      ? Math.hypot(
                          event.clientX - pointerDownPosRef.current.x,
                          event.clientY - pointerDownPosRef.current.y
                        )
                      : 0
                    if (dist > 5 || hasNodeDraggedRef.current || Date.now() - dragFinishedTimeRef.current < 500) {
                      return
                    }

                    if (node.type === 'turnNode') {
                      const turn = macroTurns.find((t) => t.turnId === node.id)
                      if (turn) {
                        setSelectedTurnForDrawer(turn)
                      }
                    } else {
                      setSelectedNodeId(node.id)
                      setSelectedDetailsNode(node)
                    }
                  }}
                  onNodeContextMenu={(event, node) => {
                    event.preventDefault()
                    setContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      node,
                    })
                  }}
                  onPaneClick={() => {
                    setContextMenu(null)
                  }}
                  onMoveStart={() => setContextMenu(null)}
                  fitView
                  fitViewOptions={{ padding: 0.2, minZoom: 0.65 }}
                  minZoom={0.65}
                  maxZoom={1.5}
                >
                  <Controls className="!bg-white !border-[#E5E0D8] !shadow-xs" />
                  <MiniMap
                    className="!bg-[#FAF8F5] !border-[#E5E0D8] !rounded-xl !shadow-xs hidden md:block"
                    maskColor="rgba(245, 240, 230, 0.45)"
                    maskStrokeColor="#D5CDBD"
                    maskStrokeWidth={1}
                    nodeStrokeWidth={1.5}
                    nodeStrokeColor={(n) => minimapNodeStroke(n)}
                    nodeColor={(n) => minimapNodeFill(n)}
                    zoomable
                    pannable
                  />
                  <CanvasViewportController
                    activeSessionId={activeSessionId}
                    viewMode={viewMode}
                    activeDrilldownTurnId={activeDrilldownTurnId}
                    isFoldingEnabled={isFoldingEnabled}
                    resetKey={resetKey}
                  />
                </ReactFlow>

                {/* 微观下钻悬浮面包屑与横向穿梭控制条 */}
                {viewMode === 'turns' && effectiveActiveDrilldownTurnId && activeTurn && (
                  <div className="absolute top-3 left-4 z-10 flex items-center space-x-2 bg-white/95 backdrop-blur-xs border border-[#E5E0D8] rounded-xl px-3 py-1.5 shadow-sm text-xs select-none animate-in fade-in duration-150">
                    {macroTurns.length > 1 && (
                      <>
                        <button
                          type="button"
                          onClick={() => setActiveDrilldownTurnId(null)}
                          className="flex items-center space-x-1.5 text-[#5C5549] hover:text-[#1E2024] hover:bg-[#F4F0EA] px-2 py-1 rounded-lg transition-colors cursor-pointer font-medium"
                          title="返回宏观回合大盘 (按 Esc)"
                        >
                          <Layers className="w-3.5 h-3.5 text-[#8F887D]" />
                          <span>全部回合</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[#EAE4D9] text-[#3D3831] font-semibold">
                            {macroTurns.length}
                          </span>
                        </button>

                        <ChevronRight className="w-3.5 h-3.5 text-[#C5BDAF] shrink-0" />
                      </>
                    )}

                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-[#1E2024] text-white tracking-wider shrink-0">
                        Turn #{activeTurn.turnIndex}
                      </span>
                      <span className="font-semibold text-[#1E2024] max-w-[240px] truncate" title={activeTurn.intent || activeTurn.title}>
                        {activeTurn.intent || activeTurn.title}
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-[#FAF8F5] text-[#5C5549] border border-[#E5E0D8]">
                        {derivedNodes.length} 步因果拓扑
                        {isFoldingEnabled && derivedNodes.length !== currentTurnAllEvents.length && (
                          <span className="text-[#8F887D] ml-1">
                            (已折叠 / 原始 {currentTurnAllEvents.length} 步)
                          </span>
                        )}
                      </span>
                    </div>

                    {macroTurns.length > 1 && (
                      <>
                        <div className="w-[1px] h-4 bg-[#E5E0D8] mx-1 shrink-0" />

                        <div className="flex items-center space-x-1">
                          <button
                            type="button"
                            disabled={activeTurnIndex <= 0}
                            onClick={() => {
                              if (activeTurnIndex > 0) {
                                setActiveDrilldownTurnId(macroTurns[activeTurnIndex - 1].turnId)
                              }
                            }}
                            className="px-2 py-1 text-[11px] font-mono rounded-lg border border-[#E5E0D8] bg-[#FAF8F5] text-[#5C5549] hover:bg-[#F4F0EA] hover:text-[#1E2024] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors flex items-center space-x-1"
                            title={activeTurnIndex > 0 ? `切换至上一回合: Turn #${macroTurns[activeTurnIndex - 1].turnIndex}` : '已是首个回合'}
                          >
                            <ChevronLeft className="w-3 h-3" />
                            <span>上个回合</span>
                          </button>

                          <button
                            type="button"
                            disabled={activeTurnIndex >= macroTurns.length - 1}
                            onClick={() => {
                              if (activeTurnIndex < macroTurns.length - 1) {
                                setActiveDrilldownTurnId(macroTurns[activeTurnIndex + 1].turnId)
                              }
                            }}
                            className="px-2 py-1 text-[11px] font-mono rounded-lg border border-[#E5E0D8] bg-[#FAF8F5] text-[#5C5549] hover:bg-[#F4F0EA] hover:text-[#1E2024] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors flex items-center space-x-1"
                            title={activeTurnIndex < macroTurns.length - 1 ? `切换至下一回合: Turn #${macroTurns[activeTurnIndex + 1].turnIndex}` : '已是末尾回合'}
                          >
                            <span>下个回合</span>
                            <ChevronRight className="w-3 h-3" />
                          </button>

                          <button
                            type="button"
                            onClick={() => setActiveDrilldownTurnId(null)}
                            className="p-1 rounded-lg text-[#8F887D] hover:text-[#1E2024] hover:bg-[#F4F0EA] transition-colors cursor-pointer ml-1"
                            title="退出微观下钻 (Esc)"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* 节点右键高密度引用与快捷操作菜单 */}
              {contextMenu && (
                <NodeContextMenu
                  x={contextMenu.x}
                  y={contextMenu.y}
                  node={contextMenu.node}
                  sessionMeta={activeSessionMeta}
                  onClose={() => setContextMenu(null)}
                  onInspect={() => {
                    if (contextMenu.node.type === 'turnNode') {
                      const turn = macroTurns.find((t) => t.turnId === contextMenu.node.id)
                      if (turn) setSelectedTurnForDrawer(turn)
                    } else {
                      setSelectedNodeId(contextMenu.node.id)
                      setSelectedDetailsNode(contextMenu.node)
                    }
                    setContextMenu(null)
                  }}
                />
              )}

              {/* 节点执行详情抽屉 (Node Details Drawer: JIT 无损还原原始数据) */}
              {selectedDetailsNode && (
                <NodeDetailsDrawer
                  isOpen={Boolean(selectedDetailsNode)}
                  node={selectedDetailsNode}
                  event={selectedNodeId ? eventsMap.get(selectedNodeId) : undefined}
                  onClose={() => {
                    setSelectedDetailsNode(null)
                    setSelectedNodeId(null)
                  }}
                />
              )}

              {/* 宏观回合微观深潜瀑布抽屉 (Turn Details Drawer) */}
              {selectedTurnForDrawer && (
                <TurnDetailsDrawer
                  isOpen={Boolean(selectedTurnForDrawer)}
                  turn={selectedTurnForDrawer}
                  onDrillDown={(turnId) => {
                    setActiveDrilldownTurnId(turnId)
                    setSelectedTurnForDrawer(null)
                  }}
                  onClose={() => setSelectedTurnForDrawer(null)}
                />
              )}
            </main>

            {/* 统一因果时间轴 (仅在非活跃运行态展示；活跃运行态自动隐藏，防止与实时流冲突) */}
            {totalNodesCount > 0 && activeSessionId !== 'live-waiting' && !isCurrentSessionActive && (
              <StateTimelineScrubber
                currentStep={timelineStep > 0 ? timelineStep : Math.max(1, totalNodesCount)}
                totalSteps={Math.max(1, totalNodesCount)}
                isPlaying={isTimelinePlaying}
                playbackSpeed={playbackSpeed}
                isFoldingEnabled={isFoldingEnabled}
                isFoldingVisible={viewMode === 'flat' || !!effectiveActiveDrilldownTurnId}
                unitLabel={viewMode === 'turns' && !activeDrilldownTurnId ? '回合' : '步'}
                onResetCanvas={() => {
                  setContextMenu(null)
                  setIsHealthReportOpen(false)
                  setSelectedDetailsNode(null)
                  setSelectedNodeId(null)
                  setSelectedTurnForDrawer(null)
                  setActiveDrilldownTurnId(null)
                  setIsTimelinePlaying(false)
                  resetStream()
                  setRawEvents([])
                  setResetKey((k) => k + 1)
                }}
                onTogglePlay={() => {
                  if (isTimelinePlaying) {
                    setIsTimelinePlaying(false)
                  } else {
                    if (timelineStep >= totalNodesCount) {
                      setTimelineStep(1)
                    }
                    setIsTimelinePlaying(true)
                  }
                }}
                onStepBack={() => {
                  setIsTimelinePlaying(false)
                  setTimelineStep((s) => Math.max(1, (s || totalNodesCount) - 1))
                }}
                onStepForward={() => {
                  setIsTimelinePlaying(false)
                  setTimelineStep((s) => Math.min(totalNodesCount, (s || totalNodesCount) + 1))
                }}
                onSpeedChange={() => {
                  const speeds = [1, 2, 4]
                  setPlaybackSpeed((prev) => speeds[(speeds.indexOf(prev) + 1) % speeds.length])
                }}
                onToggleFolding={() => setIsFoldingEnabled((f) => !f)}
                onSeekStep={(step) => {
                  setIsTimelinePlaying(false)
                  setTimelineStep(step)
                }}
              />
            )}

            {/* 底部 Token 水位与剪枝分布条 (Context Token Strip & Pruning) */}
            <ContextStripBar
              watermark={watermark}
              events={rawEvents}
              prunableItems={prunableItems}
              isInspectorOpen={isInspectorOpen}
              onInspect={() => setIsInspectorOpen((open) => !open)}
            />
          </div>

          {/* 人类在环决策门禁审批模态窗 */}
          <GateApprovalModal
            payload={currentPendingGate}
            onResolve={resolveCurrentGate}
          />
        </div>
      ) : activeTab === 'regression' ? (
        <div className="flex-1 flex flex-col w-full min-h-0 overflow-hidden">
          <Suspense fallback={<PageLoadingHint label="正在装载回归工作台" />}>
            <RegressionPage
              events={rawEvents}
              watermark={watermark}
              sessionId={activeSessionId}
              sessionTitle={displaySessionsList.find((s) => s.id === activeSessionId)?.title}
              localSessions={bridge.localSessions}
              onFetchTranscript={bridge.fetchSessionTranscript}
              onRefreshLocalSessions={bridge.fetchLocalSessions}
            />
          </Suspense>
        </div>
      ) : (
        <div className="flex-1 flex flex-col w-full min-h-0 overflow-hidden">
          <Suspense fallback={<PageLoadingHint label="正在装载上下文演进实验台" />}>
            <ContextLabPage />
          </Suspense>
        </div>
      )}

      {/* 底部上下文水位明细抽屉 (Context Inspector Bottom Sheet：固定视口底部悬浮 Sheet) */}
      {isInspectorOpen && (
        <ContextInspectorDrawer
          isOpen={isInspectorOpen}
          onClose={() => setIsInspectorOpen(false)}
          watermark={watermark}
          events={rawEvents}
          sessionTitle={activeSessionMeta?.title}
          sessionId={activeSessionId}
        />
      )}

      {/* 复盘诊断报告抽屉：与水位检查器并列，便于对照画布节点看证据 */}
      <ContextHealthReportDrawer
        isOpen={isHealthReportOpen && activeTab === 'live'}
        onClose={() => setIsHealthReportOpen(false)}
        report={healthReport}
        sessionTitle={displaySessionsList.find((s) => s.id === activeSessionId)?.title}
      />

      {/* 复盘操作指引弹窗 (Quick Guide Modal) */}
      {isGuideOpen && (
        <div className="fixed inset-0 z-50 bg-[#1E2024]/40 backdrop-blur-xs flex items-center justify-center p-4 select-none animate-in fade-in duration-150">
          <div className="bg-[#FAF8F5] border border-[#E5E0D8] rounded-xl shadow-xl max-w-xl w-full p-5 text-[#1E2024] relative">
            <button
              onClick={() => setIsGuideOpen(false)}
              className="absolute top-4 right-4 p-1 rounded-md text-[#8F887D] hover:text-[#1E2024] hover:bg-[#EAE4D9] transition-colors cursor-pointer"
              title="关闭指南"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center space-x-2 mb-1">
              <Compass className="w-5 h-5 text-amber-600" />
              <h3 className="text-base font-bold text-[#1E2024]">NetDive 三步上手指南</h3>
            </div>
            <p className="text-xs text-[#706A5F] mb-4">
              纯本地运行的 AI Agent 执行过程与 Token 消耗可视化复盘工具
            </p>

            <div className="space-y-3 text-xs">
              {/* 第一步 */}
              <div className="p-3 bg-white border border-[#E5E0D8] rounded-lg">
                <div className="flex items-center space-x-2 font-semibold text-[#1E2024] mb-1">
                  <span className="w-4 h-4 rounded-full bg-indigo-100 text-indigo-800 text-[10px] flex items-center justify-center font-mono">1</span>
                  <span>看执行步骤与报错分支</span>
                </div>
                <p className="text-[#5C5549] leading-relaxed">
                  画布以流程图还原 Agent 执行过程。蓝色节点代表正常步骤，琥珀色分支代表单测或命令报错后的重试与修复。点击任一节点右侧滑出详细输入输出。
                </p>
              </div>

              {/* 第二步 */}
              <div className="p-3 bg-white border border-[#E5E0D8] rounded-lg">
                <div className="flex items-center space-x-2 font-semibold text-[#1E2024] mb-1">
                  <span className="w-4 h-4 rounded-full bg-amber-100 text-amber-800 text-[10px] flex items-center justify-center font-mono">2</span>
                  <span>查 Token 水位与超长输出</span>
                </div>
                <p className="text-[#5C5549] leading-relaxed">
                  点击底部彩色水位条，展开查看系统提示词、长期记忆与工具输出等各类内容的 Token 占比；快速定位哪次调用塞爆了上下文。
                </p>
              </div>

              {/* 第三步 */}
              <div className="p-3 bg-white border border-[#E5E0D8] rounded-lg">
                <div className="flex items-center space-x-2 font-semibold text-[#1E2024] mb-1">
                  <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-800 text-[10px] flex items-center justify-center font-mono">3</span>
                  <span>导出现场与测试对比</span>
                </div>
                <p className="text-[#5C5549] leading-relaxed">
                  点击顶部的「复制现场」可一键将当前步骤生成诊断报告；切换至顶部「测试对比」，把失败记录存为用例，改完提示词或代码重跑后验证是否彻底修复。
                </p>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-[#EAE4D9] flex items-center justify-between">
              <span className="text-[11px] text-[#8F887D] font-mono">
                💡 侧边栏可随时拖入本地 ~/.pi/agent/sessions/*.jsonl
              </span>
              <button
                onClick={() => setIsGuideOpen(false)}
                className="px-4 py-1.5 rounded-lg bg-[#1E2024] text-white hover:bg-[#32363D] text-xs font-semibold transition-colors cursor-pointer"
              >
                开始复盘
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  return (
    <ReactFlowProvider>
      <MainFlowCanvas />
    </ReactFlowProvider>
  )
}
