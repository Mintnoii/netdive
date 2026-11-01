import {
  ReactFlow,
  Controls,
  type Node,
  type Edge,
} from '@xyflow/react'
import { Play, RotateCcw, Loader2, Sparkles, ShieldAlert } from 'lucide-react'
import { AgentNode, type AgentNodeData } from './components/AgentNode'
import { GateApprovalModal } from './components/GateApprovalModal'
import { useTelemetryStream } from './hooks/useTelemetryStream'

// 注册自定义节点组件
const nodeTypes = {
  agentNode: AgentNode,
}

// 初始默认静态节点（从左到右主干推进预览）
const initialNodes: Node[] = [
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
const initialEdges: Edge[] = [
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
    currentPendingGate,
    resolveCurrentGate,
    triggerHitlGate,
    playStream,
    playSelfCorrectionStream,
    resetStream,
  } = useTelemetryStream({
    initialNodes,
    initialEdges,
  })

  return (
    <div className="h-screen w-screen flex flex-col bg-[#FBF9F5] text-[#1E2024]">
      {/* 顶部素雅工具条 */}
      <header className="h-12 border-b border-[#E5E0D8] bg-[#FBF9F5] px-5 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 font-semibold text-sm">
            <span className="w-2.5 h-2.5 rounded-full bg-[#1E2024]"></span>
            <span>NetDive</span>
            <span className="text-[10px] text-[#8F887D] font-mono px-1.5 py-0.5 rounded bg-[#F4F0EA] border border-[#E5E0D8]">
              Phase 4: Gate Suspension (HITL)
            </span>
          </div>
          <span className="text-xs text-[#8F887D]">|</span>
          <span className="text-xs text-[#5E6573]">
            单向因果主干 · ReAct 自愈分叉 · 决策门禁挂起 (HITL)
          </span>
        </div>

        {/* 右侧动作控制区 */}
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

          {/* 播放标准流式事件 */}
          <button
            onClick={() => playStream()}
            disabled={isPlaying}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border flex items-center space-x-1.5 transition-colors cursor-pointer ${
              isPlaying
                ? 'bg-[#E5E0D8] text-[#8F887D] border-[#D6D0C5] cursor-not-allowed'
                : 'bg-[#1E2024] text-[#FBF9F5] border-[#1E2024] hover:bg-[#34383F]'
            }`}
          >
            {isPlaying ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>正在流式解析...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>播放流式事件</span>
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
            onClick={resetStream}
            className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-[#E5E0D8] bg-white text-[#5E6573] hover:text-[#1E2024] hover:border-[#B5AFA4] flex items-center space-x-1 transition-colors cursor-pointer"
            title="重置画布为初始状态"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>重置</span>
          </button>
        </div>
      </header>

      {/* React Flow 极简画布区域 */}
      <div className="flex-1 w-full h-full relative paper-pattern">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={1.5}
        >
          <Controls className="!bg-white !border-[#E5E0D8] !shadow-xs" />
        </ReactFlow>
      </div>

      {/* 人类在环决策门禁审批模态窗 */}
      <GateApprovalModal
        payload={currentPendingGate}
        onResolve={resolveCurrentGate}
      />
    </div>
  )
}
