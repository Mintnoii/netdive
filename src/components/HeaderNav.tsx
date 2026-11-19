import React from 'react'
import { Home, Activity, FlaskConical, Layers } from 'lucide-react'

export type StudioTab = 'overview' | 'live' | 'regression' | 'context'

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
        {/* 概览主页 Tab */}
        <button
          onClick={() => onChangeTab('overview')}
          className={`group flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
            activeTab === 'overview'
              ? 'bg-[#1E2024] text-white shadow-xs'
              : 'text-[#5C5549] hover:text-[#1E2024] hover:bg-[#F7F5F0]'
          }`}
          title="系统概览与各模块使用说明"
        >
          <Home
            className={`w-3.5 h-3.5 transition-colors ${
              activeTab === 'overview' ? 'text-amber-400' : 'text-[#7A7265] group-hover:text-[#1E2024]'
            }`}
          />
          <span className="font-semibold">概览</span>
        </button>

        {/* 会话回放 Tab */}
        <button
          onClick={() => onChangeTab('live')}
          className={`group flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
            activeTab === 'live'
              ? 'bg-[#1E2024] text-white shadow-xs'
              : 'text-[#5C5549] hover:text-[#1E2024] hover:bg-[#F7F5F0]'
          }`}
          title="查看 Agent 执行流程图，支持时间轴倒带与人工审批"
        >
          <Activity
            className={`w-3.5 h-3.5 transition-colors ${
              activeTab === 'live' ? 'text-emerald-400' : 'text-emerald-600/80 group-hover:text-emerald-600'
            }`}
          />
          <span className="font-semibold">会话回放</span>
          {bridgeConnected && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
          )}
        </button>

        {/* 用例提纯 Tab */}
        <button
          onClick={() => onChangeTab('regression')}
          className={`group flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
            activeTab === 'regression'
              ? 'bg-[#1E2024] text-white shadow-xs'
              : 'text-[#5C5549] hover:text-[#1E2024] hover:bg-[#F7F5F0]'
          }`}
          title="从失败会话中提纯测试用例与断言基线，终端重跑后一键对账验收"
        >
          <FlaskConical
            className={`w-3.5 h-3.5 transition-colors ${
              activeTab === 'regression' ? 'text-indigo-400' : 'text-indigo-600/80 group-hover:text-indigo-600'
            }`}
          />
          <span className="font-semibold">用例提纯</span>
          <span
            className={`text-[10px] px-1 py-0.2 rounded font-mono font-medium scale-90 border ${
              activeTab === 'regression'
                ? 'bg-indigo-950/70 text-indigo-200 border-indigo-700/60'
                : 'bg-indigo-50 text-indigo-700 border-indigo-200/80'
            }`}
          >
            New
          </span>
        </button>

        {/* 上下文演练 Tab */}
        <button
          onClick={() => onChangeTab('context')}
          className={`group flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
            activeTab === 'context'
              ? 'bg-[#1E2024] text-white shadow-xs'
              : 'text-[#5C5549] hover:text-[#1E2024] hover:bg-[#F7F5F0]'
          }`}
          title="模拟长对话、提示词与超长工具输出，测试 Token 水位、截断压缩与缓存优化"
        >
          <Layers
            className={`w-3.5 h-3.5 transition-colors ${
              activeTab === 'context' ? 'text-amber-400' : 'text-amber-600/80 group-hover:text-amber-600'
            }`}
          />
          <span className="font-semibold">上下文演练</span>
          <span
            className={`text-[10px] px-1 py-0.2 rounded font-mono font-medium scale-90 border ${
              activeTab === 'context'
                ? 'bg-amber-950/70 text-amber-200 border-amber-700/60'
                : 'bg-amber-50 text-amber-800 border-amber-200/80'
            }`}
          >
            Lab
          </span>
        </button>
      </div>
    </div>
  )
}
