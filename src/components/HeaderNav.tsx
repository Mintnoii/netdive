import React from 'react'
import { Activity, History } from 'lucide-react'

export type StudioTab = 'live' | 'replay'

export interface HeaderNavProps {
  activeTab: StudioTab
  onChangeTab: (tab: StudioTab) => void
  bridgeConnected?: boolean
}

/**
 * NetDive Studio 顶层单页 Tab 导航栏
 * 在“实时控制台 (Live Console)”与“会话时光机 (Session Replay)”之间极简切换
 */
export const HeaderNav: React.FC<HeaderNavProps> = ({
  activeTab,
  onChangeTab,
  bridgeConnected = false,
}) => {
  return (
    <div className="flex items-center space-x-2">
      <div className="flex items-center p-0.5 bg-[#EFECE6] border border-[#E5E0D8] rounded-lg">
        {/* 实时控制台 Tab */}
        <button
          onClick={() => onChangeTab('live')}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
            activeTab === 'live'
              ? 'bg-[#1E2024] text-[#FBF9F5] shadow-xs'
              : 'text-[#6E685E] hover:text-[#1E2024] hover:bg-[#F7F5F0]'
          }`}
          title="实时拓扑、L1 确定性硬断言与 HITL 跨进程门禁"
        >
          <Activity className="w-3.5 h-3.5" />
          <span>实时控制台 (Live)</span>
          {bridgeConnected && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
          )}
        </button>

        {/* 会话时光机 Tab */}
        <button
          onClick={() => onChangeTab('replay')}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
            activeTab === 'replay'
              ? 'bg-[#1E2024] text-[#FBF9F5] shadow-xs'
              : 'text-[#6E685E] hover:text-[#1E2024] hover:bg-[#F7F5F0]'
          }`}
          title="消费本地 Pi/Claude JSONL 真实流水，时间轴无感回放与白盒因果复盘"
        >
          <History className="w-3.5 h-3.5" />
          <span>会话时光机 (Replay)</span>
        </button>
      </div>
    </div>
  )
}
