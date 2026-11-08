import React from 'react'
import { Activity } from 'lucide-react'

export type StudioTab = 'live' | 'lab'

export interface HeaderNavProps {
  activeTab: StudioTab
  onChangeTab: (tab: StudioTab) => void
  bridgeConnected?: boolean
}

/**
 * NetDive Studio 顶层单页 Tab 导航栏
 */
export const HeaderNav: React.FC<HeaderNavProps> = ({
  activeTab,
  onChangeTab,
  bridgeConnected = false,
}) => {
  return (
    <div className="flex items-center space-x-2">
      <div className="flex items-center p-0.5 bg-[#EFECE6] border border-[#E5E0D8] rounded-lg">
        {/* 执行控制台 Tab */}
        <button
          onClick={() => onChangeTab('live')}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
            activeTab === 'live'
              ? 'bg-[#1E2024] text-[#FBF9F5] shadow-xs'
              : 'text-[#6E685E] hover:text-[#1E2024] hover:bg-[#F7F5F0]'
          }`}
          title="执行拓扑、回溯时光机与操作拦截"
        >
          <Activity className="w-3.5 h-3.5 text-emerald-400" />
          <span className="font-semibold">执行控制台</span>
          {bridgeConnected && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
          )}
        </button>

        {/* 压缩沙盒 Tab */}
        <button
          onClick={() => onChangeTab('lab')}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
            activeTab === 'lab'
              ? 'bg-[#1E2024] text-[#FBF9F5] shadow-xs'
              : 'text-[#8E887E] hover:text-[#1E2024] hover:bg-[#F7F5F0]'
          }`}
          title="长上下文剪枝与微压缩沙盒实验台（非真实会话数据，仅本地试算）"
        >
          <span>压缩沙盒</span>
          <span className="text-[10px] px-1 py-0.2 rounded bg-[#E5E0D8] text-[#6E685E] scale-90">Sandbox</span>
        </button>
      </div>
    </div>
  )
}
