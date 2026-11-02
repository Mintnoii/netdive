import React, { useState, useMemo } from 'react'
import {
  Layers,
  ChevronLeft,
  ChevronRight,
  Search,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  Loader2,
  FolderGit2,
} from 'lucide-react'
import type { ActiveSessionItem, TelemetryStatus } from '../types/telemetry'
import { formatRelativeTime } from '../types/telemetry'

export interface SessionListSidebarProps {
  sessions: ActiveSessionItem[]
  activeSessionId: string
  onSelectSession: (sessionId: string) => void
  isCollapsed?: boolean
  onToggleCollapse?: () => void
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
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const [query, setQuery] = useState('')

  // 搜索过滤与时序倒序
  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter((s) =>
      s.title.toLowerCase().includes(q) ||
      s.actors.some((a) => a.toLowerCase().includes(q)) ||
      (s.project && s.project.toLowerCase().includes(q))
    )
  }, [sessions, query])

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
                <Layers className="w-4 h-4" />
              </button>
            )
          })}
        </div>
      </aside>
    )
  }

  return (
    <aside className="w-64 border-r border-[#E5E0D8] bg-[#FAF8F5] flex flex-col select-none shrink-0 transition-all">
      {/* 侧边栏头部 */}
      <div className="h-10 px-3 border-b border-[#E5E0D8] flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-1.5 text-xs font-semibold text-[#1E2024]">
          <Layers className="w-3.5 h-3.5 text-[#5C5549]" />
          <span>任务会话</span>
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
      <div className="p-2 border-b border-[#E5E0D8] shrink-0">
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
          <div className="py-8 text-center text-xs text-[#8F887D] font-mono">
            未找到匹配的会话
          </div>
        ) : (
          filteredSessions.map((session) => {
            const isActive = session.id === activeSessionId
            return (
              <div
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                  isActive
                    ? 'bg-white border-[#1E2024] shadow-xs ring-1 ring-[#1E2024]/10'
                    : 'bg-[#FCFAF6] border-[#E8E1D5] hover:bg-white hover:border-[#D5CDBD]'
                }`}
              >
                {/* 状态与标题 */}
                <div className="flex items-start space-x-2 mb-1.5">
                  <StatusIndicator status={session.status} />
                  <div
                    className="text-xs font-semibold text-[#1E2024] truncate flex-1 leading-snug"
                    title={session.title}
                  >
                    {session.title}
                  </div>
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
    </aside>
  )
}
