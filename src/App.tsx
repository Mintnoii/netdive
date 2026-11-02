import { useState } from 'react'
import {
  ReactFlow,
  Controls,
  type Node,
  type Edge,
} from '@xyflow/react'
import { Play, Pause, RotateCcw, Sparkles, ShieldAlert, FolderGit2 } from 'lucide-react'
import { AgentNode, type AgentNodeData } from './components/AgentNode'
import { GateApprovalModal } from './components/GateApprovalModal'
import { ContextStripBar } from './components/ContextStripBar'
import { PrunableInspectorDrawer } from './components/PrunableInspectorDrawer'
import { NodeContextMenu } from './components/NodeContextMenu'
import { HeaderNav, type StudioTab } from './components/HeaderNav'
import { SessionListSidebar } from './components/SessionListSidebar'
import { SessionReplayPage } from './pages/SessionReplayPage'
import { CompactorLabPage } from './pages/CompactorLabPage'
import { useTelemetryStream } from './hooks/useTelemetryStream'
import { formatRelativeTime } from './types/telemetry'

// 注册自定义节点组件
const nodeTypes = {
  agentNode: AgentNode,
}

// 初始默认静态节点（从左到右主干推进预览，供离线沙盒展示）
const defaultMockNodes: Node[] = [
  {
    id: 'node-1',
    type: 'agentNode',
    position: { x: 50, y: 180 },
    data: {
      title: '目标规划与分解',
      actor: 'Pi (Coordinator)',
      gesture: 'think',
      status: 'completed',
      summary: '分解重构 Ghost pipeline 异常处理任务',
    } satisfies AgentNodeData,
  },
  {
    id: 'node-2',
    type: 'agentNode',
    position: { x: 330, y: 180 },
    data: {
      title: '代码重构实现',
      actor: 'Claude 3.7 (Worker)',
      gesture: 'edit',
      status: 'completed',
      summary: '替换原生 try-catch 为 radash.tryit',
    } satisfies AgentNodeData,
  },
  {
    id: 'node-3',
    type: 'agentNode',
    position: { x: 610, y: 180 },
    data: {
      title: '单元测试执行',
      actor: 'Claude 3.7 (Worker)',
      gesture: 'bash',
      status: 'completed',
      summary: 'pnpm test:pipeline -> 156 passed',
    } satisfies AgentNodeData,
  },
  {
    id: 'node-4',
    type: 'agentNode',
    position: { x: 890, y: 180 },
    data: {
      title: '决策门禁待审',
      actor: 'Human Operator',
      gesture: 'gate',
      status: 'gate',
      summary: 'git commit 需人类确认',
    } satisfies AgentNodeData,
  },
]

// 初始默认连线
const defaultMockEdges: Edge[] = [
  {
    id: 'e1-2',
    source: 'node-1',
    target: 'node-2',
    type: 'smoothstep',
    style: { stroke: '#8F887D', strokeWidth: 1.5 },
  },
  {
    id: 'e2-3',
    source: 'node-2',
    target: 'node-3',
    type: 'smoothstep',
    style: { stroke: '#8F887D', strokeWidth: 1.5 },
  },
  {
    id: 'e3-4',
    source: 'node-3',
    target: 'node-4',
    type: 'smoothstep',
    style: { stroke: '#8F887D', strokeWidth: 1.5 },
  },
]

export default function App() {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    isPlaying,
    isPaused,
    pauseStream,
    resumeStream,
    currentPendingGate,
    resolveCurrentGate,
    triggerHitlGate,
    playStream,
    playSelfCorrectionStream,
    resetStream,
    clearCanvas,
    bridge,
    watermark,
    isPruned,
    reclaimedTokens,
    pruneContext,
    prunableItems,
    sessionsList,
    activeSessionId,
    activeSessionMeta,
    selectSession,
  } = useTelemetryStream({
    initialNodes: defaultMockNodes,
    initialEdges: defaultMockEdges,
  })

  const [activeTab, setActiveTab] = useState<StudioTab>('live')
  const [isInspectorOpen, setIsInspectorOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    node: Node
  } | null>(null)

  return (
    <div className="h-screen w-screen flex flex-col bg-[#FBF9F5] text-[#1E2024] overflow-hidden">
      {/* 顶部素雅工具条 */}
      <header className="h-12 border-b border-[#E5E0D8] bg-[#FBF9F5] px-5 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 font-semibold text-sm">
            <span className="w-2.5 h-2.5 rounded-full bg-[#1E2024]"></span>
            <span>NetDive</span>
            <span className="text-[10px] text-[#8F887D] font-mono px-1.5 py-0.5 rounded bg-[#F4F0EA] border border-[#E5E0D8]">
              Studio
            </span>
          </div>

          <HeaderNav
            activeTab={activeTab}
            onChangeTab={setActiveTab}
            bridgeConnected={bridge.isConnected}
          />

          {activeTab === 'live' && (
            <>
              <span className="text-xs text-[#8F887D]">|</span>
              <span className="text-xs text-[#5E6573] hidden lg:inline">
                单向因果主干 · ReAct 自愈分叉 · 决策门禁 (HITL) · 上下文剪枝热力图
              </span>

              {/* Bridge 状态指示胶囊 */}
              <div
                className={`ml-2 px-2.5 py-0.5 text-[11px] font-mono rounded-full border flex items-center space-x-1.5 transition-colors ${
                  bridge.isConnected
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                    : 'bg-[#F4F0EA] text-[#6E685E] border-[#E5E0D8]'
                }`}
                title={
                  bridge.isConnected
                    ? '已连接至 Local Sidecar Bridge (127.0.0.1:4560)，实时工作流遥测与双向门禁已就绪'
                    : '当前运行于离线演示沙盒 (Demo Sandbox)，无需本地服务即可完整交互体验；启动本地 pnpm server 即可自动升级为实时控制台'
                }
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    bridge.isConnected
                      ? 'bg-emerald-500 animate-pulse'
                      : 'bg-amber-500/80'
                  }`}
                />
                <span className="font-sans font-medium text-[11px]">
                  {bridge.isConnected
                    ? '工作流在线 (Live Bridge)'
                    : '演示沙盒 (Demo Sandbox)'}
                </span>
              </div>
            </>
          )}

          {activeTab === 'replay' && (
            <span className="text-xs text-[#8F887D] hidden lg:inline">
              | 会话时序回溯 · 连续工具折叠 · 零侵入嗅探
            </span>
          )}

          {activeTab === 'lab' && (
            <span className="text-xs text-[#8F887D] hidden lg:inline">
              | 确定性微压缩 (Head 15 + Tail 15) · WAL 指针回放 · Prompt Cache 字节级保真
            </span>
          )}
        </div>

        {/* 右侧动作控制区 */}
        {activeTab === 'live' ? (
          <div className="flex items-center space-x-2.5">
            <div className="text-xs font-mono text-[#8F887D] mr-2">
              节点数: <span className="text-[#1E2024] font-semibold">{nodes.length}</span> / 边数: <span className="text-[#1E2024] font-semibold">{edges.length}</span>
            </div>

            {/* 触发决策门禁 (HITL) 独立测试按钮 */}
            <button
              onClick={() => triggerHitlGate()}
              disabled={currentPendingGate !== null}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border flex items-center space-x-1.5 transition-colors cursor-pointer ${
                currentPendingGate !== null
                  ? 'bg-amber-100 text-amber-900 border-amber-300 cursor-not-allowed'
                  : 'bg-white text-[#1E2024] border-[#E5E0D8] hover:border-[#1E2024] hover:bg-[#F4F0EA]'
              }`}
              title="手动触发决策门禁挂起并唤起审批模态窗"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
              <span>触发决策门禁 (HITL)</span>
            </button>

            {/* 播放 / 暂停 / 继续流式事件 */}
            <button
              onClick={() => {
                if (!isPlaying) {
                  playStream()
                } else if (isPaused) {
                  resumeStream()
                } else {
                  pauseStream()
                }
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border flex items-center space-x-1.5 transition-colors cursor-pointer ${
                !isPlaying
                  ? 'bg-[#1E2024] text-[#FBF9F5] border-[#1E2024] hover:bg-[#34383F]'
                  : isPaused
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100 hover:border-emerald-400 shadow-2xs'
                    : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100 hover:border-amber-400'
              }`}
              title={
                !isPlaying
                  ? '播放端到端流式遥测因果主干'
                  : isPaused
                    ? '继续执行已暂停的流式事件'
                    : '暂停流式事件执行'
              }
            >
              {!isPlaying ? (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>
                    {activeSessionId === 'default-session'
                      ? '播放沙盒流式'
                      : activeSessionId === 'self-correction-session'
                        ? '播放自愈流式'
                        : '重放当前会话 (Replay)'}
                  </span>
                </>
              ) : isPaused ? (
                <>
                  <Play className="w-3.5 h-3.5 fill-current text-emerald-700" />
                  <span>继续执行 (Resume)</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse ml-0.5" />
                </>
              ) : (
                <>
                  <Pause className="w-3.5 h-3.5 fill-current text-amber-700" />
                  <span>暂停流式 (Pause)</span>
                </>
              )}
            </button>

            {/* 注入自愈分叉剧本 */}
            <button
              onClick={() => playSelfCorrectionStream()}
              disabled={isPlaying}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border flex items-center space-x-1.5 transition-colors cursor-pointer ${
                isPlaying
                  ? 'bg-[#E5E0D8] text-[#8F887D] border-[#D6D0C5] cursor-not-allowed'
                  : 'bg-[#FCFAF6] text-amber-900 border-amber-300/80 hover:bg-amber-100/70 hover:border-amber-400'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-700" />
              <span>注入单测异常与自愈</span>
            </button>

            {/* 重置 */}
            <button
              onClick={() => {
                setContextMenu(null)
                resetStream()
              }}
              className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-[#E5E0D8] bg-white text-[#5E6573] hover:text-[#1E2024] hover:border-[#B5AFA4] flex items-center space-x-1 transition-colors cursor-pointer"
              title="重置画布为初始状态"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>重置</span>
            </button>

            {/* 清空画布 */}
            <button
              onClick={() => {
                setContextMenu(null)
                clearCanvas()
              }}
              className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-[#E5E0D8] bg-white text-[#8F887D] hover:text-[#DC2626] hover:border-[#FCA5A5] flex items-center space-x-1 transition-colors cursor-pointer"
              title="清空当前画布所有节点，准备接收纯净的外部 Agent 实时流"
            >
              <span>清空</span>
            </button>
          </div>
        ) : activeTab === 'replay' ? (
          <div className="text-xs text-[#8F887D] font-mono hidden md:block">
            离线会话解析 · 0% 侵入式嗅探 · 因果拓扑时光回溯
          </div>
        ) : (
          <div className="text-xs text-[#8F887D] font-mono hidden md:block">
            确定性微压缩 · 零 LLM 开销 · 90% Prompt Cache 守护
          </div>
        )}
      </header>

      {/* 视图内容区：状态隔离且不丢失 Live 状态 */}
      {activeTab === 'live' ? (
        <div className="flex-1 flex w-full min-h-0 overflow-hidden">
          {/* 左侧任务会话侧边栏 (Master) */}
          <SessionListSidebar
            sessions={sessionsList}
            activeSessionId={activeSessionId}
            onSelectSession={(sid) => {
              setContextMenu(null)
              selectSession(sid)
            }}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
          />

          {/* 中间核心工作区 (Detail) */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
            {/* 当前会话面包屑详情条 */}
            <div className="h-9 px-4 border-b border-[#E5E0D8] bg-[#FAF8F5]/90 backdrop-blur-xs flex items-center justify-between text-xs shrink-0 select-none">
              <div className="flex items-center space-x-2.5 min-w-0">
                <div className="flex items-center space-x-1.5 font-medium text-[#1E2024] truncate">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#1E2024] shrink-0" />
                  <span className="font-semibold truncate max-w-xs md:max-w-md">
                    {activeSessionMeta?.title || '未命名任务会话'}
                  </span>
                </div>

                <span className="text-[#D5CDBD]">·</span>

                {/* 协同 Agent 标签 */}
                <div className="flex items-center space-x-1 shrink-0">
                  {activeSessionMeta?.actors && activeSessionMeta.actors.length > 0 ? (
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
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onNodeContextMenu={(event, node) => {
                    event.preventDefault()
                    setContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      node,
                    })
                  }}
                  onPaneClick={() => setContextMenu(null)}
                  onMoveStart={() => setContextMenu(null)}
                  fitView
                  fitViewOptions={{ padding: 0.2 }}
                  minZoom={0.2}
                  maxZoom={1.5}
                >
                  <Controls className="!bg-white !border-[#E5E0D8] !shadow-xs" />
                </ReactFlow>
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
                    setIsInspectorOpen(true)
                    setContextMenu(null)
                  }}
                />
              )}

              {/* 侧边栏抽屉 */}
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
      ) : activeTab === 'replay' ? (
        <div className="flex-1 flex flex-col w-full min-h-0 overflow-hidden">
          <SessionReplayPage />
        </div>
      ) : (
        <div className="flex-1 flex flex-col w-full min-h-0 overflow-hidden">
          <CompactorLabPage />
        </div>
      )}
    </div>
  )
}
