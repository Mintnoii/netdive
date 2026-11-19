import React, { useState, useMemo, useRef } from 'react'
import { isString } from 'radash'
import {
  FolderKanban,
  ChevronLeft,
  ChevronRight,
  Search,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  Loader2,
  FolderGit2,
  UploadCloud,
  FileCode,
  Sparkles,
} from 'lucide-react'
import type { ActiveSessionItem, TelemetryStatus } from '../types/telemetry'
import { formatRelativeTime } from '../types/telemetry'

export type SessionTabCategory = 'live' | 'demo'

export interface SessionListSidebarProps {
  sessions: ActiveSessionItem[]
  activeSessionId: string
  onSelectSession: (sessionId: string) => void
  onCategoryChange?: (category: SessionTabCategory) => void
  onImportJsonl?: (fileContent: string, fileName: string) => void
  importInputRef?: React.RefObject<HTMLInputElement | null>
  isCollapsed?: boolean
  onToggleCollapse?: () => void
  bridgeConnected?: boolean
}

/** 状态图标映射 */
function StatusIndicator({ status }: { status: TelemetryStatus }) {
  switch (status) {
    case 'running':
      return <Loader2 className="w-3.5 h-3.5 text-indigo-600 animate-spin shrink-0" />
    case 'gate':
      return <ShieldAlert className="w-3.5 h-3.5 text-amber-600 animate-pulse shrink-0" />
    case 'failed':
      return <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
    case 'rejected':
      return <AlertCircle className="w-3.5 h-3.5 text-red-700 shrink-0" />
    default:
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
  }
}

export const SessionListSidebar: React.FC<SessionListSidebarProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onImportJsonl,
  importInputRef,
  isCollapsed = false,
  onToggleCollapse,
  bridgeConnected = false,
}) => {
  const [query, setQuery] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const localFileInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = importInputRef ?? localFileInputRef

  // 稳定过滤列表：按标题、角色、工程搜索
  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter((s) =>
      s.title.toLowerCase().includes(q) ||
      s.actors.some((a) => a.toLowerCase().includes(q)) ||
      (s.project && s.project.toLowerCase().includes(q))
    )
  }, [sessions, query])

  const handleFileProcess = (file: File) => {
    if (!onImportJsonl) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = isString(e.target?.result) ? e.target.result : ''
      if (text.trim()) {
        onImportJsonl(text, file.name)
      }
    }
    reader.readAsText(file)
  }

  const handleDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileProcess(e.dataTransfer.files[0])
    }
  }

  const handleDragOver = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  if (isCollapsed) {
    return (
      <aside className="w-12 border-r border-[#E5E0D8] bg-[#FAF8F5] flex flex-col items-center py-3 select-none shrink-0 transition-all">
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded hover:bg-[#EDE8DF] text-[#6E685E] hover:text-[#1E2024] transition-colors cursor-pointer mb-4"
          title="展开会话列表"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <div className="flex-1 flex flex-col items-center space-y-2 overflow-y-auto w-full px-1">
          {sessions.map((s) => {
            const isActive = s.id === activeSessionId
            return (
              <button
                key={s.id}
                onClick={() => onSelectSession(s.id)}
                className={`w-9 h-9 rounded-md flex items-center justify-center transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[#1E2024] text-white shadow-xs'
                    : 'bg-[#F2ECE1] text-[#6E685E] hover:bg-[#E8E1D5] hover:text-[#1E2024]'
                }`}
                title={`${s.title} (${s.nodeCount} 步)`}
              >
                <FolderKanban className="w-4 h-4" />
              </button>
            )
          })}
        </div>
      </aside>
    )
  }

  return (
    <aside
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`w-64 border-r border-[#E5E0D8] bg-[#FAF8F5] flex flex-col select-none shrink-0 transition-all relative ${
        isDragging ? 'ring-2 ring-indigo-500 bg-indigo-50/20' : ''
      }`}
    >
      {/* 拖拽吸附遮罩提示 */}
      {isDragging && (
        <div className="absolute inset-0 z-20 bg-indigo-50/90 backdrop-blur-xs flex flex-col items-center justify-center p-4 text-center border-2 border-dashed border-indigo-400 m-1 rounded-lg">
          <UploadCloud className="w-8 h-8 text-indigo-600 mb-2 animate-bounce" />
          <span className="text-xs font-semibold text-indigo-900">松开鼠标导入 .jsonl 会话</span>
          <span className="text-[10px] text-indigo-700 font-mono mt-0.5">支持 Pi / Claude Code 会话账本</span>
        </div>
      )}

      {/* 隐藏的文件输入组件 */}
      <input
        ref={fileInputRef}
        id="netdive-jsonl-input"
        type="file"
        accept=".jsonl,.json"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleFileProcess(e.target.files[0])
          }
        }}
      />

      {/* 侧边栏头部 */}
      <div className="h-10 px-3 border-b border-[#E5E0D8] flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-1.5 text-xs font-semibold text-[#1E2024]">
          <Sparkles className="w-3.5 h-3.5 text-amber-600" />
          <span>精选案卷</span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[#EAE4D9] text-[#5C5549]">
            {sessions.length}
          </span>
        </div>

        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="p-1 rounded hover:bg-[#EDE8DF] text-[#8F887D] hover:text-[#1E2024] transition-colors cursor-pointer"
            title="收起会话列表"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* 搜索框 */}
      <div className="p-2 border-b border-[#E5E0D8] shrink-0 bg-[#FAF8F5]">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-[#8F887D] absolute left-2.5 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索会话意图或 Agent..."
            className="w-full pl-8 pr-2 py-1 text-xs bg-[#F4F0EA] border border-[#E5E0D8] rounded-md text-[#1E2024] placeholder-[#8F887D] focus:outline-none focus:border-[#1E2024] transition-colors"
          />
        </div>
      </div>

      {/* 会话列表项 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {filteredSessions.length === 0 ? (
          <div className="py-8 text-center text-xs font-mono px-2 text-[#8F887D]">
            未找到匹配的精选案卷
          </div>
        ) : (
          filteredSessions.map((session) => {
            const isSelected = session.id === activeSessionId
            const isLiveRunning = session.status === 'running'
            const isGateWaiting = session.status === 'gate'

            return (
              <div
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                  isLiveRunning
                    ? isSelected
                      ? 'bg-indigo-50/90 border-indigo-500 shadow-xs ring-2 ring-indigo-400/30'
                      : 'bg-indigo-50/40 border-indigo-200/80 hover:bg-indigo-50 hover:border-indigo-300'
                    : isGateWaiting
                      ? isSelected
                        ? 'bg-amber-50 border-amber-500 shadow-xs ring-2 ring-amber-400/30'
                        : 'bg-amber-50/40 border-amber-200 hover:bg-amber-50'
                      : isSelected
                        ? 'bg-white border-[#1E2024] shadow-xs ring-1 ring-[#1E2024]/10'
                        : 'bg-[#FCFAF6] border-[#E8E1D5] hover:bg-white hover:border-[#D5CDBD]'
                }`}
              >
                {/* 状态与标题 */}
                <div className="flex items-start space-x-2 mb-1.5">
                  <StatusIndicator status={session.status} />
                  <div
                    className="text-xs font-semibold text-[#1E2024] truncate flex-1 leading-snug flex items-center space-x-1"
                    title={session.title}
                  >
                    <span className="truncate">{session.title}</span>
                  </div>

                  {/* 活跃执行态专属动态胶囊 */}
                  {isLiveRunning && (
                    <span className="shrink-0 text-[9px] font-mono font-semibold px-1.5 py-0.2 rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200 flex items-center space-x-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
                      <span>LIVE</span>
                    </span>
                  )}
                  {isGateWaiting && (
                    <span className="shrink-0 text-[9px] font-mono font-semibold px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 border border-amber-300 animate-pulse">
                      待审
                    </span>
                  )}
                </div>

                {/* 协同 Agent 标签 */}
                <div className="flex items-center flex-wrap gap-1 mb-1.5">
                  {session.actors.map((actor, idx) => (
                    <span
                      key={idx}
                      className="text-[9px] font-mono px-1 py-0.2 rounded bg-[#EAE4D9] text-[#3D3831] border border-[#D5CDBD]"
                    >
                      {actor.replace(/\s*\([^)]*\)/g, '')}
                    </span>
                  ))}
                  {session.project && (
                    <span
                      className="text-[9px] font-mono px-1 py-0.2 rounded bg-amber-50 text-amber-900 border border-amber-200/80 flex items-center space-x-0.5"
                      title={`所属工程: ${session.project}`}
                    >
                      <FolderGit2 className="w-2.5 h-2.5 inline mr-0.5 text-amber-700" />
                      <span>{session.project}</span>
                    </span>
                  )}
                </div>

                {/* 底部：步数与相对时间 */}
                <div className="flex items-center justify-between text-[10px] text-[#8F887D] font-mono pt-1 border-t border-[#F0EBE1]">
                  <span>{session.nodeCount} 步节点</span>
                  <span>{formatRelativeTime(session.updatedAt)}</span>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* 底部：导入本地 .jsonl 会话常驻操作区与状态条 */}
      <div className="p-2 border-t border-[#E5E0D8] bg-[#FAF8F5] shrink-0 space-y-1.5">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full py-1.5 px-2 rounded-md border border-dashed border-[#C5BDAF] bg-white hover:bg-[#F4F0EA] hover:border-[#1E2024] text-[#5C5549] hover:text-[#1E2024] text-xs font-medium flex items-center justify-center space-x-1.5 transition-all cursor-pointer shadow-2xs"
          title="点击选择本地 ~/.pi/agent/sessions/*.jsonl 文件，或直接拖拽进本侧边栏"
        >
          <FileCode className="w-3.5 h-3.5 text-indigo-600" />
          <span>导入本地账本 (.jsonl)</span>
        </button>

        {/* 轻量底座运行模式指示 */}
        <div className="flex items-center justify-between px-1 text-[10px] font-mono text-[#8F887D]">
          <span className="flex items-center space-x-1">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                bridgeConnected ? 'bg-emerald-500 animate-pulse' : 'bg-[#A8A29E]'
              }`}
            />
            <span>{bridgeConnected ? 'Bridge 监听就绪 (4560)' : '纯离线复盘模式'}</span>
          </span>
          <span title="本地零外网，完全在客户端解析">Local-First</span>
        </div>
      </div>
    </aside>
  )
}
