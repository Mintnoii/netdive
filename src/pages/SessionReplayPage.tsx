import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  ReactFlow,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Node,
} from '@xyflow/react'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  Upload,
  FileText,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
  X,
  FastForward,
  Copy,
  Check,
  Layers,
  Focus,
} from 'lucide-react'
import { AgentNode } from '../components/AgentNode'
import {
  parseTranscript,
  aggregateConsecutiveToolEvents,
  eventsToFlowNodesAndEdges,
  type ParsedTranscript,
} from '../services/transcriptParser'
import { REALISTIC_PI_TRANSCRIPT_SAMPLE } from '../services/sampleTranscript'
import type { TelemetryEvent } from '../types/telemetry'
import { formatNodeSummary, normalizeObservationOutput } from '../types/telemetry'

const nodeTypes = {
  agentNode: AgentNode,
}

const SessionReplayContent: React.FC = () => {
  const [copiedPayload, setCopiedPayload] = useState(false)
  const [copiedSummary, setCopiedSummary] = useState(false)

  const copyPayload = () => {
    if (activeEvent?.payload) {
      navigator.clipboard.writeText(JSON.stringify(activeEvent.payload, null, 2))
      setCopiedPayload(true)
      setTimeout(() => setCopiedPayload(false), 1500)
    }
  }

  const copySummary = (text: string) => {
    if (text) {
      navigator.clipboard.writeText(text)
      setCopiedSummary(true)
      setTimeout(() => setCopiedSummary(false), 1500)
    }
  }

  // 1. Transcript 原始文本与解析结果
  const [transcriptText, setTranscriptText] = useState<string>(
    REALISTIC_PI_TRANSCRIPT_SAMPLE
  )
  const [fileName, setFileName] = useState<string>('realistic-pi-sample.jsonl')
  const [isDragging, setIsDragging] = useState<boolean>(false)
  const [isFoldingEnabled, setIsFoldingEnabled] = useState<boolean>(true)

  // 2. 解析 Transcript 流水
  const parsed: ParsedTranscript = useMemo(() => {
    return parseTranscript(transcriptText)
  }, [transcriptText])

  // 3. 聚合连续同构工具调用 (Folding)
  const displayedEvents: TelemetryEvent[] = useMemo(() => {
    return aggregateConsecutiveToolEvents(parsed.events, { enabled: isFoldingEnabled })
  }, [parsed.events, isFoldingEnabled])

  const totalEvents = displayedEvents.length

  // 4. 时间轴与播放状态
  const [currentStep, setCurrentStep] = useState<number>(totalEvents)
  const [isPlaying, setIsPlaying] = useState<boolean>(false)
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1) // 1x, 2x, 4x
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(true)

  // 纯声明式派生有效步长，消除在 effect 中同步 setState 的级联渲染白屏隐患
  const effectiveStep = Math.min(currentStep, totalEvents)

  // 5. 当前切片展示的事件序列
  const currentEvents: TelemetryEvent[] = useMemo(() => {
    if (effectiveStep <= 0) return []
    return displayedEvents.slice(0, effectiveStep)
  }, [displayedEvents, effectiveStep])

  // 6. 换算为 React Flow 的 Nodes & Edges
  const { nodes: targetNodes, edges: targetEdges } = useMemo(() => {
    return eventsToFlowNodesAndEdges(currentEvents)
  }, [currentEvents])

  const [nodes, setNodes, onNodesChange] = useNodesState(targetNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(targetEdges)

  // 同步 Flow 节点变化
  useEffect(() => {
    setNodes(targetNodes)
    setEdges(targetEdges)
  }, [targetNodes, targetEdges, setNodes, setEdges])

  // 6. React Flow 实例与视口控制
  const { setCenter } = useReactFlow()

  // 选中的节点数据
  const activeEvent: TelemetryEvent | undefined = selectedNodeId
    ? displayedEvents.find((e) => e.nodeId === selectedNodeId)
    : effectiveStep > 0 && effectiveStep <= displayedEvents.length
      ? displayedEvents[effectiveStep - 1]
      : undefined

  // 7. 播放器定时器驱动与平滑倍速切换
  const timerRef = useRef<number | null>(null)

  const stopPlayback = useCallback(() => {
    setIsPlaying(false)
  }, [])

  const startPlayback = useCallback(() => {
    // 恢复播放时清除手动点选锁定，恢复镜头自动跟随
    setSelectedNodeId(null)

    // 若已经走到终点，从第 1 步重新开始
    if (effectiveStep >= totalEvents) {
      setCurrentStep(1)
    }
    setIsPlaying(true)
  }, [effectiveStep, totalEvents])

  // 监听 isPlaying、playbackSpeed、totalEvents
  // 倍速变更时仅无缝重启定时步频，绝不重置 step 或产生滑块抖动
  useEffect(() => {
    if (!isPlaying) {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      return
    }

    const intervalMs = Math.max(150, Math.floor(800 / playbackSpeed))

    if (timerRef.current) {
      clearInterval(timerRef.current)
    }

    timerRef.current = window.setInterval(() => {
      setCurrentStep((prev) => {
        if (prev >= totalEvents) {
          setIsPlaying(false)
          return totalEvents
        }
        return prev + 1
      })
    }, intervalMs)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [isPlaying, playbackSpeed, totalEvents])

  // 8. 自动平滑运镜跟踪 (Auto-Pan Camera Tracking)
  // 当回放处于播放中且用户未手动选中特定节点时，平滑运镜 (duration: 300) 居中当前最新步骤节点
  useEffect(() => {
    if (!isPlaying || selectedNodeId) return

    const latestNode = targetNodes[targetNodes.length - 1]
    if (!latestNode) return

    const nodeCenterX = latestNode.position.x + 115
    const nodeCenterY = latestNode.position.y + 60

    setCenter(nodeCenterX, nodeCenterY, { duration: 300 })
  }, [isPlaying, selectedNodeId, effectiveStep, targetNodes, setCenter])

  // 用户显式请求恢复镜头跟随
  const handleResumeFollow = useCallback(() => {
    setSelectedNodeId(null)
    const latestNode = targetNodes[targetNodes.length - 1]
    if (latestNode) {
      setCenter(latestNode.position.x + 115, latestNode.position.y + 60, { duration: 300 })
    }
  }, [targetNodes, setCenter])

  // 9. 切换折叠聚合 (Folding) 并精准维持进度百分比
  const handleToggleFolding = useCallback(() => {
    setIsPlaying(false)
    const nextFolding = !isFoldingEnabled
    const nextEvents = aggregateConsecutiveToolEvents(parsed.events, {
      enabled: nextFolding,
    })
    const nextTotal = nextEvents.length

    // 精确保留当前进度比例 (progressRatio = prevStep / prevTotal)，避免滑块位置突跳
    if (totalEvents > 0 && nextTotal > 0) {
      const progressRatio = effectiveStep / totalEvents
      const nextStep = Math.max(1, Math.min(nextTotal, Math.round(progressRatio * nextTotal)))
      setCurrentStep(nextStep)
    } else if (nextTotal > 0) {
      setCurrentStep(nextTotal)
    }

    setIsFoldingEnabled(nextFolding)
  }, [isFoldingEnabled, parsed.events, totalEvents, effectiveStep])

  // 10. 倍速切换无缝步进
  const handleSpeedChange = useCallback(() => {
    const speeds = [1, 2, 4]
    const nextIndex = (speeds.indexOf(playbackSpeed) + 1) % speeds.length
    setPlaybackSpeed(speeds[nextIndex])
  }, [playbackSpeed])

  // 7. 处理本地文件拖拽与选择上传
  const handleFileUpload = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = typeof e.target?.result === 'string' ? e.target.result : ''
      if (text.trim()) {
        stopPlayback()
        setTranscriptText(text)
        setFileName(file.name)
        const newParsed = parseTranscript(text)
        const folded = aggregateConsecutiveToolEvents(newParsed.events, {
          enabled: isFoldingEnabled,
        })
        setCurrentStep(folded.length)
        setSelectedNodeId(null)
      }
    }
    reader.readAsText(file)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0])
    }
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const loadSample = () => {
    stopPlayback()
    setTranscriptText(REALISTIC_PI_TRANSCRIPT_SAMPLE)
    setFileName('realistic-pi-sample.jsonl')
    const sampleParsed = parseTranscript(REALISTIC_PI_TRANSCRIPT_SAMPLE)
    const folded = aggregateConsecutiveToolEvents(sampleParsed.events, {
      enabled: isFoldingEnabled,
    })
    setCurrentStep(folded.length)
    setSelectedNodeId(null)
  }

  return (
    <div className="h-full w-full flex flex-col bg-[#FBF9F5] text-[#1E2024] overflow-hidden">
      {/* 顶部控制栏 */}
      <header className="border-b border-[#E5E0D8] bg-[#FBF9F5] px-5 py-2.5 flex items-center justify-between shrink-0 gap-4">
        {/* 左侧：会话元数据 & 文件状态 */}
        <div className="flex items-center space-x-3 min-w-0">
          <div className="flex items-center space-x-2 shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-[#1E2024]" />
            <span className="font-semibold text-sm">会话时光机 (Session Replay)</span>
          </div>

          <span className="text-xs text-[#8F887D]">|</span>

          {/* 会话文件胶囊 */}
          <div className="flex items-center space-x-2 text-xs font-mono bg-white border border-[#E5E0D8] px-2.5 py-1 rounded-md shadow-2xs truncate">
            <FileText className="w-3.5 h-3.5 text-[#8F887D] shrink-0" />
            <span className="font-medium text-[#1E2024] truncate" title={fileName}>
              {fileName}
            </span>
            <span className="text-[#8F887D]">·</span>
            <span className="text-emerald-700 font-semibold shrink-0">
              {parsed.session.format.toUpperCase()}
            </span>
            {parsed.session.cwdBase && (
              <>
                <span className="text-[#8F887D]">·</span>
                <span className="text-[#6E685E] shrink-0">{parsed.session.cwdBase}</span>
              </>
            )}
            {parsed.session.modelId && (
              <>
                <span className="text-[#8F887D]">·</span>
                <span className="text-[#8F887D] shrink-0">{parsed.session.modelId}</span>
              </>
            )}
          </div>

          {/* 加载默认样本快捷按钮 */}
          <button
            onClick={loadSample}
            className="px-2.5 py-1 text-xs font-medium rounded-md border border-[#E5E0D8] bg-[#F4F0EA] text-[#5E6573] hover:text-[#1E2024] hover:bg-white transition-colors cursor-pointer shrink-0 flex items-center space-x-1"
            title="重新加载内置的真实 Pi Agent 会话样本"
          >
            <Sparkles className="w-3 h-3 text-amber-600" />
            <span>加载真实样本</span>
          </button>
        </div>

        {/* 右侧：文件上传入口 & 抽屉切换 */}
        <div className="flex items-center space-x-2 shrink-0">
          <label className="px-3 py-1 text-xs font-medium rounded-md border border-[#E5E0D8] bg-white text-[#1E2024] hover:border-[#1E2024] hover:bg-[#F4F0EA] transition-colors cursor-pointer flex items-center space-x-1.5 shadow-2xs">
            <Upload className="w-3.5 h-3.5 text-[#5E6573]" />
            <span>载入本地 JSONL</span>
            <input
              type="file"
              accept=".jsonl,.txt,.json"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleFileUpload(e.target.files[0])
                }
              }}
            />
          </label>

          <button
            onClick={() => setIsInspectorOpen((open) => !open)}
            className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer flex items-center space-x-1 ${
              isInspectorOpen
                ? 'bg-[#1E2024] text-white border-[#1E2024]'
                : 'bg-white text-[#5E6573] border-[#E5E0D8] hover:text-[#1E2024]'
            }`}
            title="切换步骤因果检查器"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>节点检查器</span>
          </button>
        </div>
      </header>

      {/* 时间轴播放与进度条区域 */}
      <div className="bg-[#FAF7F2] border-b border-[#E5E0D8] px-5 py-2.5 flex items-center space-x-4 shrink-0">
        {/* 播放控制按钮簇 */}
        <div className="flex items-center space-x-1.5 shrink-0">
          {/* 重置到开头 */}
          <button
            onClick={() => {
              stopPlayback()
              setCurrentStep(1)
            }}
            className="p-1.5 rounded-md border border-[#E5E0D8] bg-white text-[#5E6573] hover:text-[#1E2024] hover:border-[#B5AFA4] cursor-pointer transition-colors"
            title="回到第 1 步"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* 单步后退 */}
          <button
            onClick={() => {
              stopPlayback()
              setCurrentStep(Math.max(1, effectiveStep - 1))
            }}
            disabled={effectiveStep <= 1}
            className={`p-1.5 rounded-md border transition-colors cursor-pointer ${
              effectiveStep <= 1
                ? 'border-[#EAE6DF] bg-[#F7F5F0] text-[#B5AFA4] cursor-not-allowed'
                : 'border-[#E5E0D8] bg-white text-[#5E6573] hover:text-[#1E2024]'
            }`}
            title="单步后退"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>

          {/* 播放 / 暂停 */}
          <button
            onClick={() => {
              if (isPlaying) {
                stopPlayback()
              } else {
                startPlayback()
              }
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border flex items-center space-x-1.5 transition-colors cursor-pointer shadow-2xs ${
              isPlaying
                ? 'bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200'
                : 'bg-[#1E2024] text-[#FBF9F5] border-[#1E2024] hover:bg-[#34383F]'
            }`}
          >
            {isPlaying ? (
              <>
                <Pause className="w-3.5 h-3.5 fill-current text-amber-800" />
                <span>暂停 (Pause)</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>时光回放 (Play)</span>
              </>
            )}
          </button>

          {/* 单步前进 */}
          <button
            onClick={() => {
              stopPlayback()
              setCurrentStep(Math.min(totalEvents, effectiveStep + 1))
            }}
            disabled={effectiveStep >= totalEvents}
            className={`p-1.5 rounded-md border transition-colors cursor-pointer ${
              effectiveStep >= totalEvents
                ? 'border-[#EAE6DF] bg-[#F7F5F0] text-[#B5AFA4] cursor-not-allowed'
                : 'border-[#E5E0D8] bg-white text-[#5E6573] hover:text-[#1E2024]'
            }`}
            title="单步前进"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>

          {/* 倍速切换 */}
          <button
            onClick={handleSpeedChange}
            className="px-2 py-1 text-xs font-mono font-medium rounded-md border border-[#E5E0D8] bg-white text-[#5E6573] hover:text-[#1E2024] cursor-pointer transition-colors flex items-center space-x-1"
            title="点击切换回放倍速 (平滑无缝调整)"
          >
            <FastForward className="w-3 h-3 text-[#8F887D]" />
            <span>{playbackSpeed}x</span>
          </button>

          {/* 折叠聚合连续调用开关 */}
          <button
            onClick={handleToggleFolding}
            className={`px-2.5 py-1 text-xs font-mono font-medium rounded-md border transition-all cursor-pointer flex items-center space-x-1.5 shadow-2xs shrink-0 ${
              isFoldingEnabled
                ? 'bg-[#1E2024] text-[#FBF9F5] border-[#1E2024] hover:bg-[#34383F]'
                : 'bg-white text-[#5E6573] border-[#E5E0D8] hover:text-[#1E2024]'
            }`}
            title="聚合连续同构工具调用，保持主干拓扑清晰简洁"
          >
            <span
              className={`w-3.5 h-3.5 rounded flex items-center justify-center border text-[9px] font-bold ${
                isFoldingEnabled
                  ? 'bg-emerald-500 border-emerald-400 text-white'
                  : 'border-[#B5AFA4] bg-white text-transparent'
              }`}
            >
              ✓
            </span>
            <span>{isFoldingEnabled ? '[√] 聚合连续调用 (Folding)' : '[ ] 聚合连续调用 (Folding)'}</span>
          </button>
        </div>

        {/* 时间轴进度滑块 */}
        <div className="flex-1 flex items-center space-x-3 min-w-0">
          <input
            type="range"
            min={1}
            max={totalEvents || 1}
            value={effectiveStep}
            onChange={(e) => {
              stopPlayback()
              setCurrentStep(Number(e.target.value))
            }}
            className="flex-1 h-1.5 bg-[#E5E0D8] rounded-lg appearance-none cursor-pointer accent-[#1E2024]"
          />

          <div className="text-xs font-mono tabular-nums text-[#5E6573] shrink-0 w-24 text-right select-none">
            <span className="font-semibold text-[#1E2024]">{effectiveStep}</span>
            <span className="mx-1 text-[#8F887D]">/</span>
            <span>{totalEvents}</span> 步
          </div>
        </div>

        {/* 当前步概要展示（固定宽度 w-72，绝不随文字增减挤压左侧进度条） */}
        {activeEvent && (
          <div className="hidden xl:flex items-center space-x-2 text-xs border border-[#E5E0D8] bg-white px-2.5 py-1 rounded-md shrink-0 w-72 shadow-2xs">
            <span className="font-mono text-[#8F887D] shrink-0">[{activeEvent.gesture}]</span>
            <span className="font-medium text-[#1E2024] truncate flex-1" title={activeEvent.title}>
              {activeEvent.title}
            </span>
            {activeEvent.isCorrectionBranch && (
              <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-amber-100 text-amber-800 border border-amber-300 shrink-0">
                自愈
              </span>
            )}
          </div>
        )}
      </div>

      {/* 主体画布与检查器协同 Push 布局 */}
      <main className="flex-1 flex w-full min-h-0 overflow-hidden relative">
        {/* ReactFlow 拓扑画布 (支持直接拖拽本地文件进入) */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`flex-1 h-full relative paper-pattern min-w-0 transition-all duration-300 ${
            isDragging ? 'ring-4 ring-amber-400/50 bg-amber-50/20' : ''
          }`}
        >
          {isDragging && (
            <div className="absolute inset-0 z-50 bg-[#FBF9F5]/90 flex flex-col items-center justify-center pointer-events-none border-2 border-dashed border-amber-500 m-4 rounded-xl">
              <Upload className="w-12 h-12 text-amber-600 animate-bounce mb-3" />
              <p className="text-base font-semibold text-[#1E2024]">松开鼠标立即加载会话 JSONL</p>
              <p className="text-xs text-[#8F887D] mt-1">支持 Pi Agent 与 Claude Code 本地转录流水</p>
            </div>
          )}

          {/* 用户手动点选暂停自动运镜时的恢复跟随提示胶囊 */}
          {selectedNodeId && (
            <button
              onClick={handleResumeFollow}
              className="absolute top-4 left-4 z-10 bg-white/95 backdrop-blur-xs border border-amber-300 px-2.5 py-1 rounded-md text-xs font-mono text-amber-900 shadow-xs flex items-center space-x-1.5 hover:bg-amber-50 transition-colors cursor-pointer"
              title="用户手动点选已暂停镜头自动跟随，点击恢复跟随最新步"
            >
              <Focus className="w-3.5 h-3.5 text-amber-700" />
              <span>节点已锁定 (已暂停自动运镜) · 点击恢复跟随</span>
            </button>
          )}

          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_event, node: Node) => {
              setSelectedNodeId(node.id)
              setIsInspectorOpen(true)
            }}
            onPaneClick={() => {
              setSelectedNodeId(null)
            }}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.15}
            maxZoom={1.5}
          >
            <Controls className="!bg-white !border-[#E5E0D8] !shadow-xs" />
          </ReactFlow>

          {/* 左下角画布快捷说明 */}
          <div className="absolute bottom-4 left-4 z-10 bg-white/90 backdrop-blur-xs border border-[#E5E0D8] px-3 py-1.5 rounded-lg text-xs font-mono text-[#6E685E] shadow-xs flex items-center space-x-3 pointer-events-none">
            <span className="flex items-center space-x-1">
              <span className="w-2 h-2 rounded-full bg-[#1E2024]" />
              <span>主干因果推进</span>
            </span>
            <span className="flex items-center space-x-1 text-amber-800">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span>ReAct 自愈分叉</span>
            </span>
            <span className="text-[#8F887D]">| 拖拽 *.jsonl 到画布可直接解析</span>
          </div>
        </div>

        {/* 右侧步骤因果检查器 (Step Inspector) */}
        {isInspectorOpen && activeEvent && (
          <aside className="w-96 shrink-0 h-full border-l border-[#E5E0D8] bg-[#FAF8F5] flex flex-col shadow-lg z-20 overflow-hidden">
            {/* 检查器 Header */}
            <div className="h-12 border-b border-[#E5E0D8] px-4 flex items-center justify-between bg-white shrink-0">
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-[#1E2024]" />
                <span className="font-semibold text-xs text-[#1E2024]">节点因果检查器</span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#F4F0EA] text-[#6E685E] border border-[#E5E0D8]">
                  ID: {activeEvent.nodeId.slice(0, 14)}
                </span>
              </div>
              <button
                onClick={() => setIsInspectorOpen(false)}
                className="p-1 rounded-md text-[#8F887D] hover:text-[#1E2024] hover:bg-[#F4F0EA] cursor-pointer"
                title="关闭检查器"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 检查器内容滚动区 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
              {/* 节点标题与状态徽章 */}
              <div className="bg-white p-3 rounded-lg border border-[#E5E0D8] space-y-2 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-[#8F887D] uppercase">
                    {activeEvent.actor}
                  </span>
                  <div className="flex items-center space-x-1.5">
                    {activeEvent.status === 'completed' && (
                      <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-300">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span>已完成</span>
                      </span>
                    )}
                    {activeEvent.status === 'failed' && (
                      <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-50 text-rose-800 border border-rose-300">
                        <AlertTriangle className="w-3 h-3 text-rose-600" />
                        <span>单测或命令失败</span>
                      </span>
                    )}
                    {activeEvent.isCorrectionBranch && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-900 border border-amber-300">
                        自愈分叉
                      </span>
                    )}
                  </div>
                </div>

                <div className="font-semibold text-sm text-[#1E2024]">{activeEvent.title}</div>

                {activeEvent.timestamp && (
                  <div className="flex items-center space-x-1 text-[11px] text-[#8F887D] font-mono">
                    <Clock className="w-3 h-3" />
                    <span>{new Date(activeEvent.timestamp).toLocaleTimeString()}</span>
                  </div>
                )}
              </div>

              {/* 思考或输入概要 */}
              {(activeEvent.delta || activeEvent.payload) && (() => {
                const summaryContent = formatNodeSummary(activeEvent.delta || activeEvent.payload)
                return (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-mono font-medium text-[#6E685E]">
                      <span>{activeEvent.gesture === 'think' ? '思考与规划链路 (Thought)' : '节点摘要 (Summary)'}</span>
                      <button
                        onClick={() => copySummary(summaryContent)}
                        className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] text-[#8F887D] hover:text-[#1E2024] hover:bg-[#EAE5DC] transition-colors cursor-pointer"
                        title="复制摘要内容"
                      >
                        {copiedSummary ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span className="text-emerald-700">已复制</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>复制摘要</span>
                          </>
                        )}
                      </button>
                    </div>
                    <div className="p-3 bg-white border border-[#E5E0D8] rounded-lg text-[#1E2024] whitespace-pre-wrap leading-relaxed font-mono text-xs max-h-48 overflow-y-auto select-all">
                      {summaryContent}
                    </div>
                  </div>
                )
              })()}

              {/* 连续调用聚合明细列表 (Aggregate Breakdown List) */}
              {activeEvent.isAggregated &&
                activeEvent.aggregatedEvents &&
                activeEvent.aggregatedEvents.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-mono font-medium text-[#6E685E]">
                      <span className="flex items-center space-x-1.5">
                        <Layers className="w-3.5 h-3.5 text-amber-700" />
                        <span>连续调用聚合分解 ({activeEvent.aggregatedEvents.length} 次执行)</span>
                      </span>
                      <span className="text-[10px] text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                        x{activeEvent.aggregatedEvents.length} 折叠
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {activeEvent.aggregatedEvents.map((sub, idx) => (
                        <div
                          key={sub.nodeId || idx}
                          className="bg-white border border-[#E5E0D8] rounded-lg p-3 space-y-2 shadow-2xs"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-1.5 min-w-0">
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-[#F4F0EA] text-[#6E685E] border border-[#E5E0D8]">
                                #{idx + 1}
                              </span>
                              <span
                                className="font-semibold text-xs text-[#1E2024] truncate"
                                title={sub.title}
                              >
                                {sub.title}
                              </span>
                            </div>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 shrink-0">
                              {sub.status === 'completed' ? 'exit: 0' : sub.status}
                            </span>
                          </div>

                          {sub.payload && Object.keys(sub.payload).length > 0 && (
                            <div className="space-y-1">
                              <div className="text-[10px] font-mono text-[#8F887D]">调用入参 (Payload):</div>
                              <pre className="p-2 bg-[#F4F0EA] border border-[#E5E0D8] rounded text-[#1E2024] font-mono text-[10px] overflow-x-auto leading-normal select-all max-h-32">
                                {JSON.stringify(sub.payload, null, 2)}
                              </pre>
                            </div>
                          )}

                          {sub.observation && (
                            <div className="space-y-1">
                              <div className="text-[10px] font-mono text-[#8F887D]">观测输出 (Observation):</div>
                              <div className="p-2 bg-[#1E2024] text-[#FBF9F5] rounded font-mono text-[10px] max-h-28 overflow-y-auto space-y-0.5 select-all">
                                {normalizeObservationOutput(sub.observation.output).map((line, lIdx) => (
                                  <div key={lIdx} className="leading-tight">
                                    {line}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {/* 工具调用入参 Payload */}
              {activeEvent.payload && Object.keys(activeEvent.payload).length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-mono font-medium text-[#6E685E]">
                    <span>工具调用参数 (Tool Arguments)</span>
                    <button
                      onClick={copyPayload}
                      className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] text-[#8F887D] hover:text-[#1E2024] hover:bg-[#EAE5DC] transition-colors cursor-pointer"
                      title="复制完整 JSON 参数"
                    >
                      {copiedPayload ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span className="text-emerald-700">已复制</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>复制参数</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="p-3 bg-[#F4F0EA] border border-[#E5E0D8] rounded-lg text-[#1E2024] font-mono text-[11px] overflow-x-auto leading-normal select-all">
                    {JSON.stringify(activeEvent.payload, null, 2)}
                  </pre>
                </div>
              )}

              {/* 执行观测与输出 (Observation) */}
              {activeEvent.observation && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-mono font-medium text-[#6E685E]">
                    <span>执行观测结果 (Observation)</span>
                    {typeof activeEvent.observation.exitCode === 'number' && (
                      <span
                        className={`px-1.5 py-0.2 rounded font-mono text-[10px] ${
                          activeEvent.observation.exitCode === 0
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        ExitCode: {activeEvent.observation.exitCode}
                      </span>
                    )}
                  </div>
                  <div className="p-3 bg-[#1E2024] text-[#FBF9F5] rounded-lg font-mono text-[11px] max-h-56 overflow-y-auto space-y-1">
                    {normalizeObservationOutput(activeEvent.observation.output).map((line, idx) => (
                      <div key={idx} className="leading-tight">
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </main>
    </div>
  )
}

export const SessionReplayPage: React.FC = () => {
  return (
    <ReactFlowProvider>
      <SessionReplayContent />
    </ReactFlowProvider>
  )
}
export default SessionReplayPage
