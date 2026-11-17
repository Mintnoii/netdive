import React, { useState, useMemo, useEffect } from 'react'
import {
  ReactFlow,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  useNodesState,
  useEdgesState,
} from '@xyflow/react'
import {
  Play,
  Pause,
  RotateCcw,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Layers,
  GitCommit,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Scissors,
  Database,
  Sparkles,
} from 'lucide-react'
import type { Node } from '@xyflow/react'
import { SHOWCASE_SCENARIOS, type ShowcaseScenario } from '../fixtures/showcaseSessions'
import { AgentNode } from '../components/AgentNode'
import { TurnNode } from '../components/TurnNode'
import { minimapNodeFill, minimapNodeStroke } from '../services/statusTone'
import { NodeDetailsDrawer } from '../components/NodeDetailsDrawer'
import { TurnDetailsDrawer } from '../components/TurnDetailsDrawer'
import {
  eventsToFlowNodesAndEdges,
  aggregateEventsIntoTurns,
  turnsToFlowNodesAndEdges,
} from '../services/transcriptParser'
import type { TelemetryEvent, MacroTurnGroup } from '../types/telemetry'

const nodeTypes = {
  agentNode: AgentNode,
  turnNode: TurnNode,
}

const FlowCanvas: React.FC<{
  events: TelemetryEvent[]
  viewMode: 'turns' | 'flat'
  activeDrilldownTurnId: string | null
  onNodeClick: (node: Node) => void
  onDrillDown: (turnId: string) => void
}> = ({
  events,
  viewMode,
  activeDrilldownTurnId,
  onNodeClick,
  onDrillDown,
}) => {
  const { fitView } = useReactFlow()

  const flowData = useMemo(() => {
    if (viewMode === 'turns') {
      const macroTurns = aggregateEventsIntoTurns(events)
      if (activeDrilldownTurnId) {
        const targetTurn = macroTurns.find((t) => t.turnId === activeDrilldownTurnId)
        if (targetTurn && targetTurn.subEvents.length > 0) {
          return eventsToFlowNodesAndEdges(targetTurn.subEvents, {
            nodesPerRow: 4,
            stepX: 340,
            rowGap: 180,
          })
        }
      }
      return turnsToFlowNodesAndEdges(macroTurns, {
        nodesPerRow: 3,
        stepX: 380,
        rowGap: 240,
        onDrillDown,
      })
    }

    return eventsToFlowNodesAndEdges(events, {
      nodesPerRow: 4,
      stepX: 340,
      rowGap: 180,
    })
  }, [events, viewMode, activeDrilldownTurnId, onDrillDown])

  const [nodes, setNodes, onNodesChange] = useNodesState(flowData.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowData.edges)

  // 同步事件流推进产生的节点与边，杜绝悬空无用边
  useEffect(() => {
    setNodes(flowData.nodes)
    setEdges(flowData.edges)
  }, [flowData, setNodes, setEdges])

  useEffect(() => {
    const timer = setTimeout(() => {
      fitView({ padding: 0.2, duration: 400 })
    }, 50)
    return () => clearTimeout(timer)
  }, [events.length, viewMode, activeDrilldownTurnId, fitView])

  return (
    <div className="w-full h-full relative paper-pattern">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => {
          onNodeClick(node)
        }}
        minZoom={0.5}
        maxZoom={1.5}
        fitView
        defaultEdgeOptions={{
          animated: true,
          style: { stroke: '#8F887D', strokeWidth: 1.5 },
        }}
      >
        <Controls className="!bg-white !border-[#E5E0D8] !shadow-xs !text-[#1E2024]" />
        <MiniMap
          className="!bg-[#FAF8F5] !border-[#E5E0D8] !rounded-xl !shadow-xs hidden md:block"
          maskColor="rgba(245, 240, 230, 0.45)"
          maskStrokeColor="#D5CDBD"
          maskStrokeWidth={1}
          nodeStrokeWidth={1.5}
          nodeStrokeColor={(n) => minimapNodeStroke(n)}
          nodeColor={(n) => minimapNodeFill(n)}
        />
      </ReactFlow>
    </div>
  )
}

/**
 * NetDive 独立 Showcase 演示页面
 * 自包含、零后端服务依赖、与全局 Warm Paper 温暖信纸审美契约 100% 对齐
 */
export const ShowcasePage: React.FC = () => {
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(
    SHOWCASE_SCENARIOS[0].id
  )
  // 计算该场景中门禁节点的初始位置，若存在 gate 则默认停在 gate 处等待用户确认
  const getInitialStepForScenario = (sc: ShowcaseScenario) => {
    const gateIndex = sc.events.findIndex((e) => e.gesture === 'gate')
    if (gateIndex !== -1) {
      return gateIndex + 1
    }
    return sc.events.length
  }

  const [currentStep, setCurrentStep] = useState<number>(() => {
    return getInitialStepForScenario(SHOWCASE_SCENARIOS[0])
  })
  const [isPlaying, setIsPlaying] = useState<boolean>(false)
  const [selectedDetailsNode, setSelectedDetailsNode] = useState<Node | null>(null)
  const [selectedTurnForDrawer, setSelectedTurnForDrawer] = useState<MacroTurnGroup | null>(null)
  const [isScenarioBannerExpanded, setIsScenarioBannerExpanded] = useState<boolean>(false)
  const [isGateHandled, setIsGateHandled] = useState<boolean>(false)
  const [gateUserChoice, setGateUserChoice] = useState<'approved' | 'rejected' | null>(null)
  const [viewMode, setViewMode] = useState<'turns' | 'flat'>('turns')
  const [activeDrilldownTurnId, setActiveDrilldownTurnId] = useState<string | null>(null)

  const activeScenario = useMemo(() => {
    return (
      SHOWCASE_SCENARIOS.find((s) => s.id === selectedScenarioId) ||
      SHOWCASE_SCENARIOS[0]
    )
  }, [selectedScenarioId])

  // 建立 nodeId 到 TelemetryEvent 的 O(1) 索引映射，供抽屉 JIT 零损还原详情
  const eventsMap = useMemo(() => {
    return new Map(activeScenario.events.map((e) => [e.nodeId, e]))
  }, [activeScenario.events])

  // 切换场景时重置
  const handleSelectScenario = (scenario: ShowcaseScenario) => {
    setSelectedScenarioId(scenario.id)
    setCurrentStep(getInitialStepForScenario(scenario))
    setIsPlaying(false)
    setSelectedDetailsNode(null)
    setSelectedTurnForDrawer(null)
    setIsGateHandled(false)
    setGateUserChoice(null)
    setActiveDrilldownTurnId(null)
    // 双焦架构默认进入宏观回合视图，其他场景默认展示全量流水
    setViewMode(scenario.id === 'hierarchical-focus' ? 'turns' : 'flat')
  }

  // 截取当前步骤可见的事件
  const visibleEvents = useMemo(() => {
    return activeScenario.events.slice(0, currentStep)
  }, [activeScenario, currentStep])

  // 计算当前可视的宏观回合
  const macroTurns = useMemo(() => {
    return aggregateEventsIntoTurns(visibleEvents)
  }, [visibleEvents])

  const activeDrilldownTurn = useMemo(() => {
    if (!activeDrilldownTurnId) return null
    return macroTurns.find((t) => t.turnId === activeDrilldownTurnId) || null
  }, [macroTurns, activeDrilldownTurnId])

  // 时光机播放轮询：当遇到门禁且尚未处理时，自动暂停播放等待用户点击
  useEffect(() => {
    if (!isPlaying) return

    const timer = setInterval(() => {
      setCurrentStep((prev) => {
        // 检查下一步是否是门禁节点
        const nextEvent = activeScenario.events[prev]
        if (nextEvent && nextEvent.gesture === 'gate' && !isGateHandled) {
          setIsPlaying(false)
          return prev + 1
        }
        if (prev >= activeScenario.events.length) {
          setIsPlaying(false)
          return prev
        }
        return prev + 1
      })
    }, 1200)

    return () => clearInterval(timer)
  }, [isPlaying, activeScenario.events, isGateHandled])

  // 检查当前是否有挂起的门禁节点
  const pendingGateNode = useMemo(() => {
    return visibleEvents.find((e) => e.gesture === 'gate' && e.status === 'gate')
  }, [visibleEvents])

  // 用户点击“允许执行”或“拒绝并说明原因”
  const handleApproveGate = () => {
    setIsGateHandled(true)
    setGateUserChoice('approved')
    // 门禁批准后，自动推进到后续恢复/执行节点
    if (currentStep < activeScenario.events.length) {
      setCurrentStep((prev) => prev + 1)
      setIsPlaying(true)
    }
  }

  const handleRejectGate = () => {
    setIsGateHandled(true)
    setGateUserChoice('rejected')
    // 拒绝后同样让后续纠偏节点呈现（或者推进 1 步展示接收指令）
    if (currentStep < activeScenario.events.length) {
      setCurrentStep((prev) => prev + 1)
      setIsPlaying(true)
    }
  }

  return (
    <div className="flex flex-col w-full h-full bg-[#FBF9F5] text-[#1E2024] select-none overflow-hidden">
      {/* 顶部场景切换卡片导引 (Warm Paper 顶栏) */}
      <header className="px-6 py-3 border-b border-[#E5E0D8] bg-[#F7F5F0]/90 backdrop-blur z-10 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-sm font-bold text-[#1E2024] tracking-tight">
            NetDive AI 行为可视化与安全拦截
          </h1>
          <p className="text-xs text-[#6E685E] mt-0.5">
            实时查看 AI 执行过程，自动拦截死循环与高危操作
          </p>
        </div>

        {/* 3 套场景切换 Tab */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
          {SHOWCASE_SCENARIOS.map((sc) => {
            const isSelected = sc.id === activeScenario.id
            return (
              <button
                key={sc.id}
                onClick={() => handleSelectScenario(sc)}
                className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer border ${
                  isSelected
                    ? 'bg-white border-[#1E2024] text-[#1E2024] shadow-xs font-semibold'
                    : 'bg-[#F2EFE9] border-[#E5E0D8] text-[#6E685E] hover:text-[#1E2024] hover:bg-white'
                }`}
              >
                <span
                  className={`px-1.5 py-0.2 text-[10px] rounded border ${
                    isSelected
                      ? 'bg-amber-100 text-amber-900 border-amber-300'
                      : 'bg-white text-[#8F887D] border-[#E5E0D8]'
                  }`}
                >
                  {sc.tag}
                </span>
                <span>{sc.title}</span>
              </button>
            )
          })}
        </div>
      </header>

      {/* 场景痛点与效果横幅条 (紧凑横排，不挤占画布，支持点击折叠/展开详细说明) */}
      <div className="border-b border-[#E5E0D8] bg-[#FAF8F5]/95 backdrop-blur-xs px-6 py-2 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs select-none shrink-0">
        <div className="flex-1 flex flex-wrap items-center gap-x-4 gap-y-1.5 min-w-0">
          <div className="flex items-center space-x-1.5 shrink-0">
            <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-semibold flex items-center space-x-1">
              <span>🚨 痛点</span>
            </span>
            <span className="text-[#5E6573] truncate max-w-xs md:max-w-md lg:max-w-xl" title={activeScenario.problem}>
              {activeScenario.problem}
            </span>
          </div>

          <div className="hidden lg:flex items-center space-x-1.5 shrink-0">
            <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold flex items-center space-x-1">
              <span>⚡ 解法</span>
            </span>
            <span className="text-[#5E6573] truncate max-w-xs md:max-w-md lg:max-w-xl" title={activeScenario.solution}>
              {activeScenario.solution}
            </span>
          </div>
        </div>

        {/* 核心指标量化卡片胶囊 */}
        <div className="flex items-center space-x-2 shrink-0">
          {activeScenario.metrics.tokenEntropyReduction && (
            <div className="px-2 py-0.5 rounded-lg bg-white border border-[#E5E0D8] shadow-2xs flex items-center space-x-1.5">
              <span className="text-[10px] text-[#8F887D]">节省 Token:</span>
              <span className="text-emerald-700 font-mono font-bold">{activeScenario.metrics.tokenEntropyReduction}</span>
            </div>
          )}
          {activeScenario.metrics.cacheHitRate && (
            <div className="px-2 py-0.5 rounded-lg bg-white border border-[#E5E0D8] shadow-2xs flex items-center space-x-1.5">
              <span className="text-[10px] text-[#8F887D]">指标:</span>
              <span className="text-sky-700 font-mono font-bold">{activeScenario.metrics.cacheHitRate}</span>
            </div>
          )}
          {activeScenario.metrics.assertionLatency && (
            <div className="px-2 py-0.5 rounded-lg bg-white border border-[#E5E0D8] shadow-2xs flex items-center space-x-1.5">
              <span className="text-[10px] text-[#8F887D]">断言耗时:</span>
              <span className="text-amber-800 font-mono font-bold">{activeScenario.metrics.assertionLatency}</span>
            </div>
          )}
          {activeScenario.metrics.loopDetectionSteps && (
            <div className="px-2 py-0.5 rounded-lg bg-white border border-[#E5E0D8] shadow-2xs flex items-center space-x-1.5">
              <span className="text-[10px] text-[#8F887D]">熔断步数:</span>
              <span className="text-purple-700 font-mono font-bold">{activeScenario.metrics.loopDetectionSteps}</span>
            </div>
          )}
          <button
            onClick={() => setIsScenarioBannerExpanded((prev) => !prev)}
            className="p-1 text-[#8F887D] hover:text-[#1E2024] hover:bg-[#F2EFE9] rounded transition cursor-pointer flex items-center space-x-0.5 text-[11px]"
            title={isScenarioBannerExpanded ? '收起场景详情' : '展开场景完整痛点与解法'}
          >
            <span>{isScenarioBannerExpanded ? '收起' : '详情'}</span>
            {isScenarioBannerExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* 展开的场景详细痛点与解法折叠卡 */}
      {isScenarioBannerExpanded && (
        <div className="px-6 py-3 border-b border-[#E5E0D8] bg-[#F4F0EA]/80 backdrop-blur-xs grid grid-cols-1 md:grid-cols-2 gap-4 text-xs animate-in slide-in-from-top-2 duration-150 shrink-0">
          <div className="p-3 rounded-xl bg-white border border-[#E5E0D8] shadow-2xs">
            <div className="text-rose-700 font-semibold mb-1 flex items-center space-x-1">
              <span>🚨 遇到的问题与控制论矛盾</span>
            </div>
            <p className="text-[#5E6573] leading-relaxed text-[11px]">
              {activeScenario.problem}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-white border border-[#E5E0D8] shadow-2xs">
            <div className="text-emerald-700 font-semibold mb-1 flex items-center space-x-1">
              <span>⚡ NetDive 解决方案与技术机制</span>
            </div>
            <p className="text-[#5E6573] leading-relaxed text-[11px]">
              {activeScenario.solution}
            </p>
          </div>
        </div>
      )}

      {/* 主体画布：100% 满幅视界 + 抽屉浮动协同 */}
      <main className="flex-1 w-full min-h-0 relative overflow-hidden flex">
        {/* React Flow 画布 */}
        <div className="flex-1 h-full relative">
          <ReactFlowProvider key={selectedScenarioId}>
            <FlowCanvas
              key={selectedScenarioId}
              events={visibleEvents}
              viewMode={viewMode}
              activeDrilldownTurnId={activeDrilldownTurnId}
              onNodeClick={(node) => {
                if (node.type === 'turnNode') {
                  const turn = macroTurns.find((t) => t.turnId === node.id)
                  if (turn) {
                    setSelectedTurnForDrawer(turn)
                    setSelectedDetailsNode(null)
                  }
                } else {
                  setSelectedDetailsNode(node)
                  setSelectedTurnForDrawer(null)
                }
              }}
              onDrillDown={(turnId) => {
                setActiveDrilldownTurnId(turnId)
                setSelectedTurnForDrawer(null)
              }}
            />
          </ReactFlowProvider>

          {/* 宏观回合 / 全量流水 双焦视图切换开关 */}
          <div className="absolute top-4 right-4 z-20 inline-flex items-center p-0.5 rounded-xl bg-white/95 backdrop-blur-md border border-[#E5E0D8] shadow-sm text-xs select-none">
            <button
              type="button"
              onClick={() => {
                setViewMode('turns')
                setActiveDrilldownTurnId(null)
              }}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-all cursor-pointer flex items-center space-x-1.5 ${
                viewMode === 'turns'
                  ? 'bg-[#1E2024] text-white shadow-2xs font-semibold'
                  : 'text-[#6E685E] hover:text-[#1E2024]'
              }`}
              title="宏观回合模式：按交互回合聚合呈现主干因果拓扑，支持点击下钻微观细节"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>宏观回合</span>
              {macroTurns.length > 0 && (
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full font-bold ${
                    viewMode === 'turns' ? 'bg-white/20 text-white' : 'bg-[#EAE4D9] text-[#3D3831]'
                  }`}
                >
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
              className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-all cursor-pointer flex items-center space-x-1.5 ${
                viewMode === 'flat'
                  ? 'bg-[#1E2024] text-white shadow-2xs font-semibold'
                  : 'text-[#6E685E] hover:text-[#1E2024]'
              }`}
              title="全量流水模式：平铺呈现每一项底层原子工具调用与状态"
            >
              <GitCommit className="w-3.5 h-3.5" />
              <span>全量流水</span>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full font-bold ${
                  viewMode === 'flat' ? 'bg-white/20 text-white' : 'bg-[#EAE4D9] text-[#3D3831]'
                }`}
              >
                {visibleEvents.length}
              </span>
            </button>
          </div>

          {/* 微观下钻悬浮面包屑导航 */}
          {viewMode === 'turns' && activeDrilldownTurnId && (
            <div className="absolute top-4 left-4 z-20 flex items-center space-x-2 bg-white/95 backdrop-blur-md border border-[#E5E0D8] rounded-xl px-3 py-1.5 shadow-md text-xs select-none animate-in fade-in duration-200">
              <button
                type="button"
                onClick={() => setActiveDrilldownTurnId(null)}
                className="flex items-center space-x-1.5 text-[#5C5549] hover:text-[#1E2024] hover:bg-[#F4F0EA] px-2 py-1 rounded-lg transition-colors cursor-pointer font-medium"
                title="返回宏观回合大盘"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>全部回合</span>
              </button>
              <span className="text-[#D5CDBD]">/</span>
              <span className="font-semibold text-[#1E2024] truncate max-w-[200px] md:max-w-xs">
                {activeDrilldownTurn?.title || '回合微观调用'}
              </span>
              {activeDrilldownTurn && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200 shrink-0">
                  {activeDrilldownTurn.subEvents.length} 步微观调用
                </span>
              )}
            </div>
          )}

          {/* 微压缩专属优化过程悬浮对比条 (当处于 micro-compactor 场景时置顶醒目展示) */}
          {activeScenario.id === 'micro-compactor' && (
            <div className="absolute bottom-4 left-4 z-20 max-w-lg p-3 rounded-xl bg-white/95 backdrop-blur-md border border-[#E5E0D8] shadow-lg text-xs select-none animate-in fade-in duration-300">
              <div className="flex items-center justify-between pb-1.5 border-b border-[#F0EBE1] mb-2">
                <div className="flex items-center space-x-1.5 font-bold text-[#1E2024]">
                  <Scissors className="w-3.5 h-3.5 text-amber-600" />
                  <span>Micro-Compactor 确定性优化过程</span>
                </div>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 font-semibold">
                  Token 节约 86.5%
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center font-mono text-[10px] mb-2">
                <div className="p-1.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-900">
                  <div className="font-bold">Head 15 行</div>
                  <div className="text-[9px] text-emerald-700">保留前置入参</div>
                </div>
                <div className="p-1.5 rounded bg-amber-50 border border-amber-200 text-amber-900">
                  <div className="font-bold">折叠 1,470 行</div>
                  <div className="text-[9px] text-amber-700">存入 WAL 指针</div>
                </div>
                <div className="p-1.5 rounded bg-purple-50 border border-purple-200 text-purple-900">
                  <div className="font-bold">Tail 15 行</div>
                  <div className="text-[9px] text-purple-700">保留退出状态</div>
                </div>
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono text-[#5C5549] bg-[#FAF8F5] p-2 rounded border border-[#E5E0D8]">
                <div className="flex items-center space-x-1">
                  <Database className="w-3 h-3 text-purple-600" />
                  <span>WAL 存根: wal-lab-tsc-01</span>
                </div>
                <span className="text-emerald-700 font-bold">86.5k → 1.3k Token</span>
              </div>
              <p className="text-[10px] text-[#8F887D] mt-1.5 flex items-center space-x-1">
                <Sparkles className="w-3 h-3 text-amber-600 shrink-0" />
                <span>点击画布中任一剪枝节点，可一键展开并 100% 字节无损还原 1,500 行原始日志。</span>
              </p>
            </div>
          )}

          {/* 门禁处理后的状态反馈横幅 */}
          {isGateHandled && gateUserChoice && (
            <div className="absolute top-4 left-4 p-3 rounded-xl bg-white/95 border border-[#E5E0D8] shadow-md backdrop-blur-md z-20 flex items-center space-x-2 animate-in fade-in duration-200">
              {gateUserChoice === 'approved' ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-xs text-[#1E2024] font-medium">已批准放行，AI 继续执行后续步骤</span>
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span className="text-xs text-[#1E2024] font-medium">已拒绝该操作，AI 已接收纠偏指令</span>
                </>
              )}
            </div>
          )}
          {pendingGateNode && !isGateHandled && (
            <div className="absolute top-4 left-4 right-4 md:right-auto md:w-96 p-4 rounded-xl bg-white/95 border-2 border-amber-500 shadow-xl backdrop-blur-md z-20 animate-in fade-in slide-in-from-top-4 duration-300">
              <div className="flex items-center space-x-2 text-amber-700 mb-2">
                <ShieldAlert className="w-5 h-5 animate-pulse text-amber-600" />
                <h3 className="text-sm font-bold text-[#1E2024]">
                  操作已暂停，需要您确认
                </h3>
              </div>
              <p className="text-xs text-[#5E6573] mb-3 leading-relaxed">
                {pendingGateNode.delta}
              </p>
              {pendingGateNode.assertion && (
                <div className="mb-3 p-2 bg-[#FBF9F5] border border-amber-200 rounded text-[11px] font-mono text-amber-900">
                  <div className="text-[#8F887D]">触发规则: {pendingGateNode.assertion.rule}</div>
                  <div className="font-semibold text-amber-800">原因: {pendingGateNode.assertion.reason}</div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleApproveGate}
                  className="flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition flex items-center justify-center space-x-1 cursor-pointer shadow-xs"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>允许执行</span>
                </button>
                <button
                  onClick={handleRejectGate}
                  className="flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition flex items-center justify-center space-x-1 cursor-pointer shadow-xs"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>拒绝并说明原因</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 节点执行详情抽屉 (JIT 零损还原原始载荷与观测输出) */}
        {selectedDetailsNode && (
          <NodeDetailsDrawer
            isOpen={Boolean(selectedDetailsNode)}
            node={selectedDetailsNode}
            event={selectedDetailsNode.id ? eventsMap.get(selectedDetailsNode.id) : undefined}
            onClose={() => setSelectedDetailsNode(null)}
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

      {/* 底部时光机控制台 (Scrubber & Controller - Warm Paper 暖色风格) */}
      <footer className="h-12 border-t border-[#E5E0D8] bg-[#F7F5F0] px-6 flex items-center justify-between gap-6 z-10 shrink-0">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-[#1E2024] hover:bg-[#32363D] text-[#FBF9F5] transition cursor-pointer shadow-xs"
          >
            {isPlaying ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>暂停</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>播放回放</span>
              </>
            )}
          </button>
          <button
            onClick={() => {
              setCurrentStep(1)
              setIsPlaying(false)
              setIsGateHandled(false)
              setGateUserChoice(null)
            }}
            className="flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs bg-white border border-[#E5E0D8] hover:bg-[#F2EFE9] text-[#5C5549] transition cursor-pointer shadow-2xs"
            title="回到第 1 步"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>重置</span>
          </button>
        </div>

        {/* 进度拖拽条 */}
        <div className="flex-1 flex items-center space-x-3">
          <span className="text-xs font-mono text-[#6E685E] shrink-0">
            第 {currentStep} 步 / 共 {activeScenario.events.length} 步
          </span>
          <input
            type="range"
            min={1}
            max={activeScenario.events.length}
            value={currentStep}
            onChange={(e) => {
              setCurrentStep(Number(e.target.value))
              setIsPlaying(false)
            }}
            className="flex-1 h-1.5 bg-[#E5E0D8] rounded-lg appearance-none cursor-pointer accent-[#1E2024]"
          />
        </div>
      </footer>
    </div>
  )
}
