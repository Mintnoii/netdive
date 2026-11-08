import { useState, useEffect, useRef, useMemo } from 'react'
import {
  ReactFlow,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type Edge,
} from '@xyflow/react'
import {
  FolderGit2,
  Copy,
  Check,
  Layers,
  GitCommit,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react'
import { AgentNode, type AgentNodeData } from './components/AgentNode'
import { TurnNode, type TurnNodeData } from './components/TurnNode'
import { GateApprovalModal } from './components/GateApprovalModal'
import { ContextStripBar } from './components/ContextStripBar'
import { ContextInspectorDrawer } from './components/ContextInspectorDrawer'
import { NodeDetailsDrawer } from './components/NodeDetailsDrawer'
import { TurnDetailsDrawer } from './components/TurnDetailsDrawer'
import { StateTimelineScrubber } from './components/StateTimelineScrubber'
import { NodeContextMenu } from './components/NodeContextMenu'
import { HeaderNav, type StudioTab } from './components/HeaderNav'
import { SessionListSidebar } from './components/SessionListSidebar'
import { CompactorLabPage } from './pages/CompactorLabPage'
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
  agentNode: AgentNode,
  turnNode: TurnNode,
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

// 初始默认静态节点与连线（由 defaultMockEvents 直出）
const initialDefaultFlow = eventsToFlowNodesAndEdges(defaultMockEvents)
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

function MainFlowCanvas() {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    isPlaying,
    setNodes,
    setEdges,
    currentPendingGate,
    resolveCurrentGate,
    resetStream,
    bridge,
    watermark,
    setWatermark,
    prunableItems,
    sessionsList,
    activeSessionId,
    setActiveSessionId,
    activeSessionMeta,
  } = useTelemetryStream({
    initialNodes: defaultMockNodes,
    initialEdges: defaultMockEdges,
  })

  const [activeTab, setActiveTab] = useState<StudioTab>('live')
  const [isInspectorOpen, setIsInspectorOpen] = useState(false)
  const [selectedDetailsNode, setSelectedDetailsNode] = useState<Node | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedTurnForDrawer, setSelectedTurnForDrawer] = useState<MacroTurnGroup | null>(null)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isDiagnosticCopied, setIsDiagnosticCopied] = useState(false)

  // 双焦视图模式：'turns' (宏观回合) | 'flat' (全量流水)
  const [viewMode, setViewMode] = useState<'turns' | 'flat'>('turns')

  // 微观下钻选中的 Turn ID (为 null 时处于宏观总览态)
  const [activeDrilldownTurnId, setActiveDrilldownTurnId] = useState<string | null>(null)

  // 缓存当前会话的原始事件流水 (rawEvents)，作为同构折叠与拓扑重算的单一真理源
  const [rawEvents, setRawEvents] = useState<TelemetryEvent[]>(defaultMockEvents)
  const [resetKey, setResetKey] = useState<number>(0)

  // 初次加载时，若本地存在真实会话，自动优先激活首个真实会话，不再默认停留在演示沙盒
  const hasAutoSwitchedRef = useRef(false)
  useEffect(() => {
    if (!hasAutoSwitchedRef.current && bridge.localSessions.length > 0) {
      hasAutoSwitchedRef.current = true
      const firstRealSession = bridge.localSessions[0]
      setActiveSessionId(firstRealSession.id)
      bridge.fetchSessionTranscript(firstRealSession.id).then((text) => {
        if (text && text.trim()) {
          const parsed = parseTranscript(text)
          setRawEvents(parsed.events)
          setWatermark(parsed.watermark || BASE_CONTEXT_WATERMARK)
        }
      })
    }
  }, [bridge.localSessions, bridge, setActiveSessionId, setWatermark])

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
        const { nodes: microNodes, edges: microEdges } = eventsToFlowNodesAndEdges(displayTurnEvents)
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
    const { nodes: fn, edges: fe } = eventsToFlowNodesAndEdges(displayEvents)
    return { derivedNodes: fn, derivedEdges: fe }
  }, [rawEvents, viewMode, effectiveActiveDrilldownTurnId, activeTurn, currentTurnAllEvents, macroTurns, isFoldingEnabled])

  // 当派生节点与边变更时，同步更新至 React Flow 状态
  useEffect(() => {
    if (derivedNodes.length > 0) {
      setNodes(derivedNodes)
      setEdges(derivedEdges)
    }
  }, [derivedNodes, derivedEdges, setNodes, setEdges])

  const totalNodesCount = nodes.length

  // 当前时间轴截断渲染的节点与边（根据 timelineStep 进行时光切片回放）
  const { visibleNodes, visibleEdges } = useMemo(() => {
    if (totalNodesCount === 0) {
      return { visibleNodes: [], visibleEdges: [] }
    }
    // 0 或 >= totalNodesCount 表示呈现全量最新态
    const step = timelineStep > 0 ? Math.min(timelineStep, totalNodesCount) : totalNodesCount
    const sliced = nodes.slice(0, step)
    const slicedIds = new Set(sliced.map((n) => n.id))
    const slicedEdges = edges.filter(
      (e) => slicedIds.has(e.source) && slicedIds.has(e.target)
    )
    return { visibleNodes: sliced, visibleEdges: slicedEdges }
  }, [nodes, edges, timelineStep, totalNodesCount])

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

  // 稳定静态的本地会话列表模型：绝对单一依赖 bridge.localSessions，绝不随内存状态动态篡改导致重排与错位
  const displaySessionsList: ActiveSessionItem[] = useMemo(() => {
    // 1. 保留沙盒演示会话
    const demoItems = sessionsList.filter((s) => s.id === 'demo-session' || s.id === 'default-session')

    // 2. 本地真实会话 100% 严格使用扫描到的物理文件元数据与真实行数步数
    const localItems: ActiveSessionItem[] = bridge.localSessions.map((ls) => {
      // 仅提取运行中状态
      const memSession = sessionsList.find((s) => s.id === ls.id)
      return {
        id: ls.id,
        title: ls.title || ls.fileName,
        actors: ['Pi (Harness)'],
        status: memSession?.status || 'completed',
        nodeCount: ls.lineCount || memSession?.nodeCount || 1, // 真实行数/步数，彻底消灭 size/2000 的虚标！
        updatedAt: ls.mtime,
        project: ls.project,
      }
    })

    return [...demoItems, ...localItems]
  }, [bridge.localSessions, sessionsList])

  return (
    <div className="h-screen w-screen flex flex-col bg-[#FBF9F5] text-[#1E2024] overflow-hidden">
      {/* 顶部素雅工具条 (Clean Minimal Header) */}
      <header className="h-11 border-b border-[#E5E0D8] bg-[#FBF9F5] px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3.5">
          <span className="font-bold text-base tracking-tight text-[#1E2024] select-none">NetDive</span>

          <HeaderNav
            activeTab={activeTab}
            onChangeTab={setActiveTab}
            bridgeConnected={bridge.isConnected}
          />
        </div>
      </header>

      {/* 视图内容区：状态隔离且不丢失 Live 状态 */}
      {activeTab === 'live' ? (
        <div className="flex-1 flex w-full min-h-0 overflow-hidden">
          {/* 左侧任务会话侧边栏 (Master) */}
          <SessionListSidebar
            sessions={displaySessionsList}
            activeSessionId={activeSessionId}
            onSelectSession={async (sid) => {
              setContextMenu(null)
              setSelectedDetailsNode(null)
              setSelectedNodeId(null)
              setSelectedTurnForDrawer(null)
              setActiveDrilldownTurnId(null)

              // 1. 若已经是当前会话，无需重复加载
              if (activeSessionId === sid) return

              // 2. 立即激活选中状态 (侧边栏高亮即时生效)
              setActiveSessionId(sid)

              // 3. 演示沙盒会话直通
              if (sid === 'demo-session' || sid === 'default-session') {
                setRawEvents(defaultMockEvents)
                setWatermark(BASE_CONTEXT_WATERMARK)
                return
              }

              // 4. 真实本地会话：直取该 sid 的物理账本，现场解析直给，彻底消灭错位与空状态
              const text = await bridge.fetchSessionTranscript(sid)
              if (text && text.trim()) {
                const parsed = parseTranscript(text)
                setRawEvents(parsed.events)
                setWatermark(parsed.watermark || BASE_CONTEXT_WATERMARK)
              }
            }}
            onImportJsonl={(content) => {
              setContextMenu(null)
              setSelectedDetailsNode(null)
              setSelectedNodeId(null)
              setSelectedTurnForDrawer(null)
              setActiveDrilldownTurnId(null)
              const parsed = parseTranscript(content)
              setActiveSessionId(parsed.session.sessionId || parsed.session.id || `session-${Date.now()}`)
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
                {activeSessionId === 'live-waiting' && nodes.length === 0 ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center select-none z-10 pointer-events-none">
                    <div className="w-12 h-12 rounded-2xl bg-white border border-[#E5E0D8] shadow-sm flex items-center justify-center mb-3 text-emerald-600">
                      <span className="w-3 h-3 rounded-full bg-emerald-500 animate-ping" />
                    </div>
                    <h4 className="text-sm font-semibold text-[#1E2024]">正在监听本地实时工作流...</h4>
                    <p className="text-xs text-[#8F887D] max-w-xs mt-1.5 font-mono leading-relaxed">
                      启动本地 Agent (Pi / Hermes) 触发执行，或在左下角导入本地会话文件 (.jsonl)
                    </p>
                  </div>
                ) : null}

                <ReactFlow
                  nodes={visibleNodes}
                  edges={visibleEdges}
                  nodeTypes={nodeTypes}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onNodeClick={(_event, node) => {
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
                    nodeStrokeColor={(n) => {
                      const isTurn = n.type === 'turnNode' || n.id.startsWith('turn-') || Boolean((n.data as Record<string, unknown>)?.turnId)
                      if (isTurn) {
                        const turnData = n.data as unknown as TurnNodeData | undefined
                        const toolEntries = Object.entries(turnData?.toolCounts || {})
                        const subEventsCount = turnData?.subEvents?.length || 0
                        const isInputOnly =
                          toolEntries.length === 0 &&
                          (subEventsCount <= 1 ||
                            (turnData?.subEvents &&
                              turnData.subEvents.every(
                                (e) => e.actor === 'Human Operator' || /用户|User/i.test(e.title || '')
                              )))

                        // 用户取消回合：小地图使用更低饱和更弱化的中冷灰 (#78716C stone-500) 描边
                        if (isInputOnly) return '#78716C'

                        const status = (turnData?.status || (n as unknown as { status?: string }).status)
                        switch (status) {
                          case 'failed':
                            return '#F43F5E'
                          case 'gate':
                            return '#F59E0B'
                          case 'branching':
                            return '#D97706'
                          case 'running':
                            return '#6366F1'
                          case 'success':
                          default:
                            return '#10B981'
                        }
                      }
                      const nodeData = n.data as unknown as AgentNodeData
                      if (nodeData?.status === 'failed' || nodeData?.status === 'rejected') return '#EF4444'
                      if (nodeData?.status === 'gate') return '#F59E0B'
                      if (nodeData?.isCorrectionBranch) return '#D97706'
                      if (nodeData?.isAggregated) return '#B5AFA4'
                      if (nodeData?.status === 'running') return '#6366F1'
                      return '#10B981'
                    }}
                    nodeColor={(n) => {
                      const isTurn = n.type === 'turnNode' || n.id.startsWith('turn-') || Boolean((n.data as Record<string, unknown>)?.turnId)
                      // 1. 宏观回合节点 (TurnNode)：根据回合执行状态精准映射，告别大黑块
                      if (isTurn) {
                        const turnData = n.data as unknown as TurnNodeData | undefined
                        const toolEntries = Object.entries(turnData?.toolCounts || {})
                        const subEventsCount = turnData?.subEvents?.length || 0
                        const isInputOnly =
                          toolEntries.length === 0 &&
                          (subEventsCount <= 1 ||
                            (turnData?.subEvents &&
                              turnData.subEvents.every(
                                (e) => e.actor === 'Human Operator' || /用户|User/i.test(e.title || '')
                              )))

                        // 用户取消回合：小地图使用更灰更沉静的底色 (#D6D3D1 stone-300)
                        if (isInputOnly) return '#D6D3D1'

                        const status = (turnData?.status || (n as unknown as { status?: string }).status)
                        switch (status) {
                          case 'failed':
                            return '#FFE4E6' // rose-100 (单测异常/失败)
                          case 'gate':
                            return '#FEF3C7' // amber-100 (门禁待审)
                          case 'branching':
                            return '#FEF9C3' // yellow-100 (自愈闭环分支)
                          case 'running':
                            return '#E0E7FF' // indigo-100 (运行中)
                          case 'success':
                          default:
                            return '#D1FAE5' // emerald-100 (完成)
                        }
                      }

                      // 2. 微观执行节点 (AgentNode)：优先根据状态（失败/门禁/聚合/自愈/完成）映射画布真实色彩
                      const nodeData = n.data as unknown as AgentNodeData
                      if (nodeData?.status === 'failed' || nodeData?.status === 'rejected') {
                        return '#FEE2E2' // red-100 (执行失败/拦截)
                      }
                      if (nodeData?.status === 'gate') {
                        return '#FEF3C7' // amber-100 (待审)
                      }
                      if (nodeData?.isCorrectionBranch) {
                        return '#FEF9C3' // amber-50 / yellow-100 (自愈分支)
                      }
                      if (nodeData?.isAggregated) {
                        return '#EAE4D9' // 聚合卡片特有的素雅叠纸暖灰 (#EAE4D9)
                      }
                      if (nodeData?.status === 'running') {
                        return '#E0E7FF' // indigo-100 (运行中)
                      }
                      if (nodeData?.pruned) {
                        return '#F5F5F4' // stone-100 (已修剪)
                      }

                      // 3. 正常完成状态下，根据六大手势语义映射对应手势色阶底色
                      switch (nodeData?.gesture) {
                        case 'read':
                          return '#E0F2FE' // sky-100 (代码检视)
                        case 'bash':
                          return '#D1FAE5' // emerald-100 (终端执行)
                        case 'edit':
                          return '#DBEAFE' // blue-100 (文件修改)
                        case 'memory':
                          return '#F3E8FF' // purple-100 (记忆存取)
                        case 'gate':
                          return '#FEF3C7' // amber-100 (门禁)
                        case 'think':
                        default:
                          return '#EEF2FF' // indigo-50 (推理思考)
                      }
                    }}
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
            {activeSessionId !== 'live-waiting' && !isCurrentSessionActive && (
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
                  setSelectedDetailsNode(null)
                  setSelectedNodeId(null)
                  setSelectedTurnForDrawer(null)
                  setActiveDrilldownTurnId(null)
                  setIsTimelinePlaying(false)
                  resetStream()
                  setRawEvents(defaultMockEvents)
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
      ) : (
        <div className="flex-1 flex flex-col w-full min-h-0 overflow-hidden">
          <CompactorLabPage />
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
