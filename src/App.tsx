import { useState, useEffect, useRef, useMemo } from 'react'
import {
  ReactFlow,
  Controls,
  ReactFlowProvider,
  type Node,
  type Edge,
} from '@xyflow/react'
import { FolderGit2, Copy, Check } from 'lucide-react'
import { AgentNode, type AgentNodeData } from './components/AgentNode'
import { GateApprovalModal } from './components/GateApprovalModal'
import { ContextStripBar } from './components/ContextStripBar'
import { PrunableInspectorDrawer } from './components/PrunableInspectorDrawer'
import { NodeDetailsDrawer } from './components/NodeDetailsDrawer'
import { StateTimelineScrubber } from './components/StateTimelineScrubber'
import { NodeContextMenu } from './components/NodeContextMenu'
import { HeaderNav, type StudioTab } from './components/HeaderNav'
import { SessionListSidebar } from './components/SessionListSidebar'
import { CompactorLabPage } from './pages/CompactorLabPage'
import { useTelemetryStream } from './hooks/useTelemetryStream'
import { formatRelativeTime, copySessionDiagnosticToClipboard, type ActiveSessionItem, BASE_CONTEXT_WATERMARK } from './types/telemetry'
import { parseTranscript, aggregateConsecutiveToolEvents, eventsToFlowNodesAndEdges } from './services/transcriptParser'

// 注册自定义节点组件
const nodeTypes = {
  agentNode: AgentNode,
}

// 初始默认静态节点（从左到右主干推进预览，呈现思考 -> 实现 -> 异常自愈 -> 门禁审批的完整链路）
const defaultMockNodes: Node[] = [
  {
    id: 'node-sc-1',
    type: 'agentNode',
    position: { x: 50, y: 180 },
    data: {
      title: '任务拆解与编排',
      actor: 'Pi (Coordinator)',
      gesture: 'think',
      status: 'completed',
      summary: '编排 Ghost 核心数据清洗管道重构，派发 Claude Worker 协程并启动单测观测守护。',
    } satisfies AgentNodeData,
  },
  {
    id: 'node-sc-2',
    type: 'agentNode',
    position: { x: 330, y: 180 },
    data: {
      title: '代码重构实现',
      actor: 'Claude 3.7 (Worker)',
      gesture: 'edit',
      status: 'completed',
      summary: '重构数据清洗管道，移除命令式 try-catch 胶水，迁移至 radash.tryit 强契约封装。',
    } satisfies AgentNodeData,
  },
  {
    id: 'node-sc-3',
    type: 'agentNode',
    position: { x: 610, y: 180 },
    data: {
      title: '单测回归 (捕获异常)',
      actor: 'Claude 3.7 (Worker)',
      gesture: 'bash',
      status: 'failed',
      summary: '执行 pnpm test:pipeline -> 捕获断言异常：1 failed, 155 passed。检测到空输入逃逸。',
      observation: {
        exitCode: 1,
        output: [
          'AssertionError: Expected 200 OK, got 500 Internal Error',
          'at packages/core/test/pipeline.test.ts:42',
        ],
      },
    } satisfies AgentNodeData,
  },
  {
    id: 'node-sc-4',
    type: 'agentNode',
    position: { x: 890, y: 340 },
    data: {
      title: 'ReAct 自愈诊断分叉',
      actor: 'Claude 3.7 (Worker)',
      gesture: 'think',
      status: 'completed',
      summary: '捕获单测 exit: 1 异常堆栈，诊断定位 radash.tryit 在空 payload 输入时未做默认兜底回退。',
      isCorrectionBranch: true,
    } satisfies AgentNodeData,
  },
  {
    id: 'node-sc-5',
    type: 'agentNode',
    position: { x: 1170, y: 340 },
    data: {
      title: '自愈补丁实施',
      actor: 'Claude 3.7 (Worker)',
      gesture: 'edit',
      status: 'completed',
      summary: '注入防御性空值 fallback，完善 pipeline 边界强契约校验，消除脏数据逃逸风险。',
      isCorrectionBranch: true,
    } satisfies AgentNodeData,
  },
  {
    id: 'node-sc-6',
    type: 'agentNode',
    position: { x: 1450, y: 340 },
    data: {
      title: '自愈回归验证',
      actor: 'Claude 3.7 (Worker)',
      gesture: 'bash',
      status: 'completed',
      summary: '重新执行 pnpm test:pipeline -> 156 passed, 0 failed (1.78s) 单测全部通过！',
      isCorrectionBranch: true,
      observation: {
        exitCode: 0,
        output: ['Tests: 156 passed, 156 total', 'Time: 1.78s'],
      },
    } satisfies AgentNodeData,
  },
  {
    id: 'node-sc-7',
    type: 'agentNode',
    position: { x: 1730, y: 180 },
    data: {
      title: '自愈收敛与 Git 门禁审查',
      actor: 'Human Operator',
      gesture: 'gate',
      status: 'gate',
      summary: '单测自愈闭环，重新连回主干因果链。触发 Git 提交审查与全机门禁放行。',
    } satisfies AgentNodeData,
  },
]

// 初始默认连线
const defaultMockEdges: Edge[] = [
  {
    id: 'e-node-sc-1-node-sc-2',
    source: 'node-sc-1',
    target: 'node-sc-2',
    type: 'smoothstep',
    style: { stroke: '#8F887D', strokeWidth: 1.5 },
  },
  {
    id: 'e-node-sc-2-node-sc-3',
    source: 'node-sc-2',
    target: 'node-sc-3',
    type: 'smoothstep',
    style: { stroke: '#8F887D', strokeWidth: 1.5 },
  },
  {
    id: 'e-node-sc-3-node-sc-4',
    source: 'node-sc-3',
    target: 'node-sc-4',
    type: 'smoothstep',
    style: { stroke: '#D97706', strokeWidth: 1.5, strokeDasharray: '5 4' },
  },
  {
    id: 'e-node-sc-4-node-sc-5',
    source: 'node-sc-4',
    target: 'node-sc-5',
    type: 'smoothstep',
    style: { stroke: '#D97706', strokeWidth: 1.5, strokeDasharray: '5 4' },
  },
  {
    id: 'e-node-sc-5-node-sc-6',
    source: 'node-sc-5',
    target: 'node-sc-6',
    type: 'smoothstep',
    style: { stroke: '#D97706', strokeWidth: 1.5, strokeDasharray: '5 4' },
  },
  {
    id: 'e-node-sc-6-node-sc-7',
    source: 'node-sc-6',
    target: 'node-sc-7',
    type: 'smoothstep',
    style: { stroke: '#8F887D', strokeWidth: 1.5 },
  },
]

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
    isPruned,
    reclaimedTokens,
    pruneContext,
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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isDiagnosticCopied, setIsDiagnosticCopied] = useState(false)

  // 窗口化分页常数：DOM 节点安全视口窗口（Window Size = 50）
  const WINDOW_SIZE = 50

  // 时光回溯状态机 (仅在非 running 态展示与交互)
  const [timelineStep, setTimelineStep] = useState<number>(0)
  const [isTimelinePlaying, setIsTimelinePlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1)
  const [isFoldingEnabled, setIsFoldingEnabled] = useState(true)
  const playbackTimerRef = useRef<number | null>(null)
  const totalNodesCount = nodes.length

  // 判断当前选中的会话是否处于活跃运行/待审批状态
  const isCurrentSessionActive = activeSessionMeta?.status === 'running' || activeSessionMeta?.status === 'gate'

  // 1. 核心工业级滑动窗口投影 (Sliding Window Focus)
  // 当会话节点超过 50 个时，以当前时间轴焦点 (timelineStep) 为中心，向前滑动提取连贯的 50 个节点视口
  // 保证真实总步数 100% 存在，同时 DOM 节点数恒定锁死在 <= 50，彻底杜绝任何千步级长链路卡死！
  const { windowNodes, windowEdges, windowStart, windowEnd } = useMemo(() => {
    if (totalNodesCount <= WINDOW_SIZE) {
      return {
        windowNodes: nodes,
        windowEdges: edges,
        windowStart: 1,
        windowEnd: totalNodesCount,
      }
    }

    const currentFocus = timelineStep > 0 ? timelineStep : totalNodesCount
    // 计算滑动窗口区间 [start, end]
    const halfWindow = Math.floor(WINDOW_SIZE / 2)
    let start = Math.max(0, currentFocus - halfWindow)
    let end = start + WINDOW_SIZE

    if (end > totalNodesCount) {
      end = totalNodesCount
      start = Math.max(0, end - WINDOW_SIZE)
    }

    const sliced = nodes.slice(start, end)
    const slicedIds = new Set(sliced.map((n) => n.id))
    const slicedEdges = edges.filter(
      (e) => slicedIds.has(e.source) && slicedIds.has(e.target)
    )

    return {
      windowNodes: sliced,
      windowEdges: slicedEdges,
      windowStart: start + 1,
      windowEnd: end,
    }
  }, [nodes, edges, timelineStep, totalNodesCount])

  // 1. 彻底移除外部频繁手搓的 setCenter 运镜，杜绝主线程重排死锁，完全交由 ReactFlow 原生 fitView 矩阵引擎托管

  // 2. 当会话切换或节点更新时，重置时间轴当前步数至最新步
  useEffect(() => {
    if (!isPlaying) {
      setTimelineStep(totalNodesCount)
      setIsTimelinePlaying(false)
    }
  }, [totalNodesCount, isPlaying])

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
  }, [bridge.localSessions])

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

              // 1. 若已经是当前会话，无需重复加载
              if (activeSessionId === sid) return

              // 2. 立即激活选中状态 (侧边栏高亮即时生效)
              setActiveSessionId(sid)

              // 3. 演示沙盒会话直通
              if (sid === 'demo-session' || sid === 'default-session') {
                setNodes(defaultMockNodes)
                setEdges(defaultMockEdges)
                setWatermark(BASE_CONTEXT_WATERMARK)
                return
              }

              // 4. 真实本地会话：直取该 sid 的物理账本，现场解析直给，彻底消灭错位与空状态
              const text = await bridge.fetchSessionTranscript(sid)
              if (text && text.trim()) {
                const parsed = parseTranscript(text)
                const events = aggregateConsecutiveToolEvents(parsed.events, { enabled: isFoldingEnabled })
                const { nodes: flowNodes, edges: flowEdges } = eventsToFlowNodesAndEdges(events)

                setNodes(flowNodes)
                setEdges(flowEdges)
                setWatermark(BASE_CONTEXT_WATERMARK)
              }
            }}
            onImportJsonl={(content) => {
              const parsed = parseTranscript(content)
              const events = aggregateConsecutiveToolEvents(parsed.events, { enabled: true })
              const { nodes: flowNodes, edges: flowEdges } = eventsToFlowNodesAndEdges(events)
              setActiveSessionId(parsed.session.sessionId || `session-${Date.now()}`)
              setNodes(flowNodes)
              setEdges(flowEdges)
              setWatermark(BASE_CONTEXT_WATERMARK)
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
                        nodes,
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

              <div className="flex items-center space-x-2 text-[11px] font-mono text-[#8F887D] shrink-0 ml-2">
                <span className="flex items-center space-x-1">
                  <span className="text-[#1E2024] font-medium">
                    {activeSessionMeta?.nodeCount ?? nodes.length}
                  </span>
                  <span>步节点</span>
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
                  nodes={windowNodes}
                  edges={windowEdges}
                  nodeTypes={nodeTypes}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onNodeClick={(_event, node) => {
                    setSelectedDetailsNode(node)
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
                  fitViewOptions={{ padding: 0.2 }}
                  minZoom={0.2}
                  maxZoom={1.5}
                >
                  <Controls className="!bg-white !border-[#E5E0D8] !shadow-xs" />
                </ReactFlow>

                {/* 长链路滑动窗口状态浮标与快速翻页胶囊 (当总节点 > 50 时展示) */}
                {totalNodesCount > WINDOW_SIZE && (
                  <div className="absolute top-3 right-4 z-10 flex items-center space-x-2 bg-white/95 backdrop-blur-xs border border-[#E5E0D8] rounded-lg p-1.5 shadow-xs text-xs font-mono text-[#5C5549] select-none">
                    <button
                      onClick={() => {
                        const target = Math.max(1, (timelineStep || totalNodesCount) - WINDOW_SIZE)
                        setTimelineStep(target)
                      }}
                      disabled={windowStart <= 1}
                      className="px-2 py-0.5 rounded bg-[#F4F0EA] hover:bg-[#EAE4D9] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                      title="向前翻滚 50 步窗口"
                    >
                      ◀ 上 50 步
                    </button>
                    <span className="text-[11px] px-1">
                      视口窗口: <strong className="text-[#1E2024]">{windowStart}</strong> - <strong className="text-[#1E2024]">{windowEnd}</strong> (共 {totalNodesCount} 步)
                    </span>
                    <button
                      onClick={() => {
                        const target = Math.min(totalNodesCount, (timelineStep || totalNodesCount) + WINDOW_SIZE)
                        setTimelineStep(target)
                      }}
                      disabled={windowEnd >= totalNodesCount}
                      className="px-2 py-0.5 rounded bg-[#F4F0EA] hover:bg-[#EAE4D9] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                      title="向后翻滚 50 步窗口"
                    >
                      下 50 步 ▶
                    </button>
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
                    setSelectedDetailsNode(contextMenu.node)
                    setContextMenu(null)
                  }}
                />
              )}

              {/* 节点执行详情抽屉 (Node Details Drawer) */}
              {selectedDetailsNode && (
                <NodeDetailsDrawer
                  isOpen={Boolean(selectedDetailsNode)}
                  node={selectedDetailsNode}
                  onClose={() => setSelectedDetailsNode(null)}
                />
              )}

              {/* 侧边栏上下文剪枝抽屉 */}
              {isInspectorOpen && (
                <PrunableInspectorDrawer
                  isOpen={isInspectorOpen}
                  onClose={() => setIsInspectorOpen(false)}
                  isPruned={isPruned}
                  reclaimedTokens={reclaimedTokens}
                  onPrune={pruneContext}
                  items={prunableItems}
                  watermark={watermark}
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
                onResetCanvas={() => {
                  setContextMenu(null)
                  setIsTimelinePlaying(false)
                  resetStream()
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
              isPruned={isPruned}
              reclaimedTokens={reclaimedTokens}
              onPrune={pruneContext}
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
