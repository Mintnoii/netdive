import React from 'react'
import { Activity, Layers, Sliders } from 'lucide-react'

export type StudioTab = 'live' | 'lab' | 'context'

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
        {/* 会话回放 Tab */}
        <button
          onClick={() => onChangeTab('live')}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
            activeTab === 'live'
              ? 'bg-[#1E2024] text-[#FBF9F5] shadow-xs'
              : 'text-[#6E685E] hover:text-[#1E2024] hover:bg-[#F7F5F0]'
          }`}
          title="本地 JSONL 因果拓扑与上下文复盘，可选接入实时桥接"
        >
          <Activity className="w-3.5 h-3.5 text-emerald-400" />
          <span className="font-semibold">会话回放</span>
          {bridgeConnected && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
          )}
        </button>

        {/* 上下文演进实验台 Tab */}
        <button
          onClick={() => onChangeTab('context')}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
            activeTab === 'context'
              ? 'bg-[#1E2024] text-[#FBF9F5] shadow-xs'
              : 'text-[#6E685E] hover:text-[#1E2024] hover:bg-[#F7F5F0]'
          }`}
          title="通用上下文工程演练：固化置顶约束、软边界感知、巨型输出截断与前缀缓存保真"
        >
          <Layers className="w-3.5 h-3.5 text-amber-500" />
          <span className="font-semibold">上下文演练</span>
          <span className="text-[10px] px-1 py-0.2 rounded bg-amber-100 text-amber-800 scale-90">Lab</span>
        </button>

        {/* 压缩沙盒 Tab */}
        <button
          onClick={() => onChangeTab('lab')}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
            activeTab === 'lab'
              ? 'bg-[#1E2024] text-[#FBF9F5] shadow-xs'
              : 'text-[#8E887E] hover:text-[#1E2024] hover:bg-[#F7F5F0]'
          }`}
          title="长上下文剪枝与微压缩沙盒实验台（纯本地算法试算）"
        >
          <Sliders className="w-3.5 h-3.5 text-sky-400" />
          <span>算法沙盒</span>
          <span className="text-[10px] px-1 py-0.2 rounded bg-[#E5E0D8] text-[#6E685E] scale-90">Sandbox</span>
        </button>
      </div>
    </div>
  )
}
