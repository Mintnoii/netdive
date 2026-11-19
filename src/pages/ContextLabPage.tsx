import React, { useState, useMemo, useCallback, useEffect } from 'react'
import {
  ReactFlow,
  Controls,
  ReactFlowProvider,
  useReactFlow,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type XYPosition,
} from '@xyflow/react'
import {
  Sparkles,
  X,
} from 'lucide-react'
import { AgentNodeMemo } from '../components/AgentNode'
import {
  STANDARD_GOVERNANCE_SCENARIO,
  computeSimulationSnapshot,
} from '../services/contextGovernanceEngine'
import { ContextBottomPanel } from '../components/ContextBottomPanel'
import { ContextNodeDrawer } from '../components/ContextNodeDrawer'

const nodeTypes = {
  agentNode: AgentNodeMemo,
}

// 9 步流畅连线拓扑
const FLOW_POSITIONS: Record<number, { x: number; y: number }> = {
  0: { x: 50, y: 140 },
  1: { x: 380, y: 140 },
  2: { x: 710, y: 140 },
  3: { x: 1040, y: 140 },
  4: { x: 1370, y: 140 },
  5: { x: 1700, y: 140 },
  6: { x: 2030, y: 140 },
  7: { x: 2360, y: 140 },
  8: { x: 2690, y: 140 },
}

/**
 * 独立的 ReactFlow 画布子组件，拥有自己专属的 ReactFlowProvider 上下文与 useNodesState 测量器
 */
const ContextFlowCanvas: React.FC<{
  nodes: Node[]
  edges: Edge[]
  currentStepIndex: number
  onNodeClick: (node: Node) => void
}> = ({ nodes: initialNodes, edges: initialEdges, currentStepIndex, onNodeClick }) => {
  const { fitView } = useReactFlow()
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  useEffect(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialNodes, initialEdges, setNodes, setEdges])

  useEffect(() => {
    const timer = setTimeout(() => {
      fitView({ padding: 0.2, duration: 300 })
    }, 60)
    return () => clearTimeout(timer)
  }, [currentStepIndex, initialNodes.length, fitView])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.3}
      maxZoom={1.5}
      nodesDraggable={true}
      nodesConnectable={false}
      elementsSelectable={true}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={(_event, node) => onNodeClick(node)}
    >
      <Controls className="!bg-white !border-[#E5E0D8] !shadow-xs" />
    </ReactFlow>
  )
}

/**
 * 上下文工程交互演练画布 (ContextLabPage)
 * 三大直观高光交互：
 * 1. 【误插时间戳模拟】演示固定提示词前缀哪怕动一个标点符号，大模型 90% 提示词缓存就会失效；
 * 2. 【前半段定稿：一键打包精简】在 Step 4 阶段收敛时将前 4 步历史草稿打包装箱，直接腾出 3200 Tokens；
 * 3. 【掐头去尾截断】在 Step 5 向量对撞削减 1800 行日志，并在清理流水账中随时凭唯一 ID 秒级调取原件。
 */
export const ContextLabPage: React.FC = () => {
  // 默认推进至 Step 5（向量增量对撞与超长输出截断），让用户一进入即可俯瞰前序主干与核心治理高潮，支持回溯推演
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(5)
  // 记录哪些步骤应用了掐头去尾 (默认演示开启第 5 步超长输出截断)
  const [appliedOptimizations, setAppliedOptimizations] = useState<Record<number, boolean>>({ 5: true })
  // 记录是否对前半段进行了打包精简
  const [prunedStageOne, setPrunedStageOne] = useState<boolean>(false)
  // 记录是否模拟了前缀时间戳突变
  const [isTimestampInjected, setIsTimestampInjected] = useState<boolean>(false)
  // 弹窗查看 WAL 原始日志全文
  const [inspectingRawOutput, setInspectingRawOutput] = useState<string | null>(null)
  // ContextState 底部面板展开/收起：默认折叠为底部简洁条，让大片画布完整呈现节点流程
  const [isBottomPanelOpen, setIsBottomPanelOpen] = useState<boolean>(false)
  // 右侧节点详情抽屉开关
  const [isNodeDrawerOpen, setIsNodeDrawerOpen] = useState<boolean>(false)
  // 记录哪些步骤的同构子调用被折叠为聚合节点（默认展开）
  const [coalescedSteps, setCoalescedSteps] = useState<Record<number, boolean>>({})
  // 用户拖动后的节点位置覆盖表（key = nodeId）
  const [nodePositions, setNodePositions] = useState<Record<string, XYPosition>>({})

  // 1. 计算当前推演状态
  const snapshot = useMemo(() => {
    return computeSimulationSnapshot(
      STANDARD_GOVERNANCE_SCENARIO,
      currentStepIndex,
      appliedOptimizations,
      prunedStageOne,
      isTimestampInjected,
      coalescedSteps
    )
  }, [currentStepIndex, appliedOptimizations, prunedStageOne, isTimestampInjected, coalescedSteps])

  const currentStep = snapshot.currentStep

  // 切换指定步骤的截断状态
  const toggleOptimization = useCallback((stepIdx: number) => {
    setAppliedOptimizations((prev) => ({
      ...prev,
      [stepIdx]: !prev[stepIdx],
    }))
  }, [])

  // 切换前半段打包精简状态
  const togglePruneStageOne = useCallback(() => {
    setPrunedStageOne((prev) => !prev)
  }, [])

  // 切换前缀时间戳模拟突变
  const toggleTimestampMutation = useCallback(() => {
    setIsTimestampInjected((prev) => !prev)
  }, [])

  // 切换某步骤同构调用的折叠/展开
  const toggleCoalesce = useCallback((stepIdx: number) => {
    setCoalescedSteps((prev) => ({ ...prev, [stepIdx]: !prev[stepIdx] }))
  }, [])

  // 按索引 ID 从 ContextState 备份仓库精确取回完整原文
  const handleInspectByPointer = useCallback((pointerId: string) => {
    const backup = snapshot.contextState.offloadedLedger.backupStore.get(pointerId)
    if (backup) {
      setInspectingRawOutput(
        `===== 索引 ID: ${backup.pointerId} | ${backup.title} | 完整原文 ${backup.tokens} Tokens =====\n\n${backup.fullText}`
      )
    }
  }, [snapshot.contextState.offloadedLedger.backupStore])

  // 按索引 ID 把抽离出去的原文还原放回上下文
  const handleRestoreByPointer = useCallback((pointerId: string) => {
    const backup = snapshot.contextState.offloadedLedger.backupStore.get(pointerId)
    if (!backup) return
    if (backup.type === 'pruned_history') {
      setPrunedStageOne(false)
    } else {
      setAppliedOptimizations((prev) => ({ ...prev, [backup.stepIndex]: false }))
    }
  }, [snapshot.contextState.offloadedLedger.backupStore])

  // 2. 将演练步骤动态映射为 React Flow 节点与连线
  const { nodes, edges } = useMemo(() => {
    const activeNodes: Node[] = []
    const activeEdges: Edge[] = []

    for (let i = 0; i <= currentStepIndex; i++) {
      const step = STANDARD_GOVERNANCE_SCENARIO.steps[i]
      const pos = FLOW_POSITIONS[i] || { x: i * 330 + 50, y: 140 }
      const isOptimized = Boolean(appliedOptimizations[i])
      const isSelected = i === currentStepIndex
      const isCompletedStep = i < currentStepIndex || (i === currentStepIndex && currentStepIndex === STANDARD_GOVERNANCE_SCENARIO.steps.length - 1)

      // 若前半段已打包精简，且节点属于前 4 步（Step 0~3），则在当前步骤到达 Step 4 之后呈现折叠态
      const isFoldedByStageOne = prunedStageOne && i < 4 && currentStepIndex >= 4

      // 是否处于同构折叠态
      const isCoalesced = Boolean(coalescedSteps[i] && step.consecutiveSubCalls?.length)
      const subCalls = step.consecutiveSubCalls || []

      if (subCalls.length > 0 && !isCoalesced) {
        // 展开态：主干位置渲染 3 个连续同构节点
        subCalls.forEach((sub, idx) => {
          const subId = `gov-step-${i}-sub-${idx}`
          const defaultSubPos = { x: pos.x, y: 140 + idx * 150 }
          const subPos = nodePositions[subId] ?? defaultSubPos
          activeNodes.push({
            id: subId,
            type: 'agentNode',
            position: subPos,
            width: 280,
            style: { width: 280 },
            selected: isSelected && idx === 0,
            data: {
              nodeId: `gov-step-${i}-sub-${idx}`,
              gesture: step.gesture,
              title: sub.title,
              summary: sub.summary,
              status: isCompletedStep ? 'completed' : 'running',
              actor: step.actor,
              command: `extract_concept #${idx + 1}`,
              onToggleCoalesce: idx === 0 ? () => toggleCoalesce(i) : undefined,
              subCallCount: subCalls.length,
            },
          })
          if (idx > 0) {
            activeEdges.push({
              id: `gov-edge-step-${i}-sub-${idx - 1}-${idx}`,
              source: `gov-step-${i}-sub-${idx - 1}`,
              target: `gov-step-${i}-sub-${idx}`,
              style: { stroke: '#7DD3FC', strokeWidth: 1.5, strokeDasharray: '4 3' },
            })
          }
        })
      } else {
        activeNodes.push({
          id: `gov-step-${i}`,
          type: 'agentNode',
          position: nodePositions[`gov-step-${i}`] ?? pos,
          width: 280,
          style: { width: 280 },
          selected: isSelected,
          data: {
            nodeId: `gov-step-${i}`,
            gesture: step.gesture,
            title: isFoldedByStageOne ? `[已打包精简] ${step.title}` : step.title,
            summary: isOptimized && step.hasLargePayload
              ? `[掐头去尾] 前后各留15行，中间 ${step.largePayloadLines} 行存入内存`
              : isFoldedByStageOne
              ? `已收敛至定稿卡片，前置草稿已归档为结构化摘要`
              : step.summary,
            status: isCompletedStep ? 'completed' : 'running',
            actor: step.actor,
            pruned: (isOptimized && step.hasLargePayload) || isFoldedByStageOne,
            reclaimedTokens: isFoldedByStageOne ? 800 : isOptimized ? 4200 : undefined,
            walPointerId: isFoldedByStageOne ? 'wal-stage-1-summary' : isOptimized ? `wal-call-step-${i + 1}` : undefined,
            command: step.gesture === 'bash' ? step.rawOutput?.split('\n')[0] : undefined,
            hasLargePayload: step.hasLargePayload,
            largePayloadLines: step.largePayloadLines,
            onToggleCompact: step.hasLargePayload ? () => toggleOptimization(i) : undefined,
            isAggregated: isCoalesced,
            aggregateCount: isCoalesced ? subCalls.length : undefined,
            onToggleCoalesce: isCoalesced ? () => toggleCoalesce(i) : undefined,
            isSafeBoundary: step.isSafeBoundary && i === 4,
            isStageOnePruned: prunedStageOne,
            onTogglePruneStageOne: i === 4 ? togglePruneStageOne : undefined,
          },
        })
      }

      if (i > 0) {
        const prevStep = STANDARD_GOVERNANCE_SCENARIO.steps[i - 1]
        const prevSubCount = prevStep.consecutiveSubCalls?.length || 0
        const prevCoalesced = Boolean(coalescedSteps[i - 1] && prevSubCount)
        const prevExitNodeId = prevSubCount > 0 && !prevCoalesced
          ? `gov-step-${i - 1}-sub-${prevSubCount - 1}`
          : `gov-step-${i - 1}`

        activeEdges.push({
          id: `gov-edge-${i - 1}-${i}`,
          source: prevExitNodeId,
          target: subCalls.length > 0 && !isCoalesced ? `gov-step-${i}-sub-0` : `gov-step-${i}`,
          animated: i === currentStepIndex,
          style: { stroke: '#8F887D', strokeWidth: 1.5 },
        })
      }
    }

    return { nodes: activeNodes, edges: activeEdges }
  }, [currentStepIndex, appliedOptimizations, prunedStageOne, coalescedSteps, nodePositions, toggleOptimization, togglePruneStageOne, toggleCoalesce])

  // 步进控制
  const handlePrev = useCallback(() => {
    setCurrentStepIndex((prev) => Math.max(0, prev - 1))
  }, [])

  const handleNext = useCallback(() => {
    setCurrentStepIndex((prev) => Math.min(STANDARD_GOVERNANCE_SCENARIO.steps.length - 1, prev + 1))
  }, [])

  const handleReset = useCallback(() => {
    setCurrentStepIndex(0)
    setAppliedOptimizations({})
    setPrunedStageOne(false)
    setIsTimestampInjected(false)
    setCoalescedSteps({})
    setNodePositions({})
    setIsNodeDrawerOpen(false)
  }, [])

  // 点击画布节点时的交互：打开右侧分析抽屉
  const handleNodeClick = useCallback((node: Node) => {
    const stepIdx = Number(node.id.replace('gov-step-', '').split('-')[0])
    if (!Number.isNaN(stepIdx)) {
      if (stepIdx <= currentStepIndex) {
        setIsNodeDrawerOpen(true)
      }
    }
  }, [currentStepIndex])

  return (
    <div className="flex flex-col h-full bg-[#FBF9F5] text-[#1E2024] overflow-hidden select-none font-sans relative">
      {/* 1. 顶栏：标题与当前执行节点概览 */}
      <div className="flex items-center justify-between px-6 py-2.5 border-b border-[#E5E0D8] bg-[#F7F5F0] z-20 shrink-0">
        <div className="flex items-center space-x-3">
          <span className="font-semibold text-sm tracking-tight text-[#1E2024]">
            上下文工程演练画布
          </span>
          <span className="text-xs text-[#8E887E]">|</span>
          <span className="text-xs text-[#6E685E] font-medium">
            当前节点 (第 {currentStepIndex + 1}/{snapshot.totalSteps} 步)：{currentStep.title}
          </span>
        </div>

        <button
          onClick={() => setIsNodeDrawerOpen(true)}
          className="px-2.5 py-1 rounded-lg bg-white border border-[#E5E0D8] text-[#1E2024] hover:bg-[#FAF8F5] text-xs font-semibold flex items-center space-x-1.5 shadow-2xs cursor-pointer transition-all"
          title="查看当前节点上下文治理建议与分析"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-600" />
          <span>节点治理分析</span>
        </button>
      </div>

      {/* 2. 核心 React Flow 画布主体 (采用独立 ReactFlowProvider 杜绝 store 污染与 visibility:hidden) */}
      <div className="flex-1 relative w-full min-h-[300px]">
        <ReactFlowProvider key={`ctx-provider-${currentStepIndex}`}>
          <ContextFlowCanvas
            nodes={nodes}
            edges={edges}
            currentStepIndex={currentStepIndex}
            onNodeClick={handleNodeClick}
          />
        </ReactFlowProvider>
      </div>

      {/* 3. 底部常驻 ContextState 状态面板 (默认折叠，支持一键展开完整指标) */}
      <ContextBottomPanel
        isOpen={isBottomPanelOpen}
        onToggle={() => setIsBottomPanelOpen(!isBottomPanelOpen)}
        contextState={snapshot.contextState}
        currentStepIndex={currentStepIndex}
        totalSteps={snapshot.totalSteps}
        onPrev={handlePrev}
        onNext={handleNext}
        onReset={handleReset}
        isTimestampInjected={isTimestampInjected}
        onToggleTimestampMutation={toggleTimestampMutation}
        onInspectWal={handleInspectByPointer}
        onRestoreWal={handleRestoreByPointer}
      />

      {/* 4. 右侧节点治理分析抽屉 */}
      <ContextNodeDrawer
        isOpen={isNodeDrawerOpen}
        onClose={() => setIsNodeDrawerOpen(false)}
        step={currentStep}
        isOptimized={Boolean(appliedOptimizations[currentStepIndex])}
        onToggleCompact={() => toggleOptimization(currentStepIndex)}
        onInspectRaw={(raw) => setInspectingRawOutput(raw)}
      />

      {/* 5. 查看 WAL 原始日志全文弹窗 */}
      {inspectingRawOutput && (
        <div className="fixed inset-0 z-50 bg-[#1E2024]/40 backdrop-blur-xs flex items-center justify-center p-4 select-text">
          <div className="bg-[#FAF8F5] border border-[#E5E0D8] rounded-xl shadow-xl max-w-3xl w-full max-h-[80vh] flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b border-[#EAE4D9] flex items-center justify-between bg-[#F2EDE4]">
              <span className="font-mono text-xs font-semibold text-[#1E2024]">
                WAL 内存备份完整原文
              </span>
              <button
                onClick={() => setInspectingRawOutput(null)}
                className="p-1 rounded text-[#8F887D] hover:text-[#1E2024] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <pre className="flex-1 p-5 overflow-auto text-xs font-mono text-[#2E2922] bg-white leading-relaxed whitespace-pre-wrap">
              {inspectingRawOutput}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
