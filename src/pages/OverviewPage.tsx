import React, { useState, useRef, useEffect } from 'react'
import {
  PlayCircle,
  FlaskConical,
  Layers,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Scissors,
  Activity,
  ZoomIn,
  ZoomOut,
  Search,
  ShieldAlert,
  Bookmark,
  Split,
  Zap,
} from 'lucide-react'
import type { StudioTab } from '../components/HeaderNav'

interface OverviewPageProps {
  onNavigate: (tab: StudioTab) => void
  bridgeConnected?: boolean
}

/** 演示小画布使用的 Mock 步骤数据契约 */
interface MockStepItem {
  id: string
  gesture: 'think' | 'read' | 'edit' | 'bash'
  label: string
  billboard: string
  actor: string
  summary: string
  duration: string
}

interface MockTurnData {
  turnId: string
  title: string
  summary: string
  tokens: string
  duration: string
  toolCounts: { think: number; read: number; edit: number; bash: number }
  steps: MockStepItem[]
}

const MOCK_TURN_DEMO: MockTurnData = {
  turnId: 'Turn 01',
  title: '数据清洗管道重构与单测回归',
  summary: '重构命令式 try-catch 胶水为 radash 强契约纯函数，跑通全量单元测试。',
  tokens: '14.2k Tokens',
  duration: '4.8s',
  toolCounts: { think: 1, read: 1, edit: 1, bash: 1 },
  steps: [
    {
      id: 'step-1',
      gesture: 'think',
      label: '规划清洗流转边界',
      billboard: '🎯 规划清洗边界',
      actor: 'Pi · Coordinator',
      summary: '定位胶水代码，派发重构任务',
      duration: '0.4s',
    },
    {
      id: 'step-2',
      gesture: 'read',
      label: '检视 pipeline.ts 契约',
      billboard: '📄 检视 pipeline.ts',
      actor: 'Claude · Worker',
      summary: '排查隐蔽副作用与命令式游标',
      duration: '1.2s',
    },
    {
      id: 'step-3',
      gesture: 'edit',
      label: '消除防御八股与胶水',
      billboard: '⚡ radash 契约重构',
      actor: 'Claude · Worker',
      summary: '消除嵌套 try-catch 与胶水',
      duration: '2.1s',
    },
    {
      id: 'step-4',
      gesture: 'bash',
      label: '运行单测 146/146 全绿',
      billboard: '$ pnpm test:all',
      actor: 'Claude · Worker',
      summary: '确认 146 个用例全绿零破坏',
      duration: '4.8s',
    },
  ],
}

/**
 * NetDive 产品主页 (Overview / Landing Page)
 * 核心定位：AI Agent 执行过程与长任务调用链路可观测台
 * 1. Hero 区域：直击痛点的大气标题，并给出三大核心模块直达卡片
 * 2. Section 01（会话回放）：左文右图，右侧装载支持原生滚轮缩放与宏微双焦下钻的交互小画布
 * 3. Section 02（测试对比）：左右同屏回归差异对比
 * 4. Section 03（上下文演练）：7 维正交水位测绘与确定性微压缩
 */
export const OverviewPage: React.FC<OverviewPageProps> = ({
  onNavigate,
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(1)
  const [drilldownMode, setDrilldownMode] = useState<'macro' | 'micro'>('macro')

  // 远景视口判定（当缩小至 85% 以下时触发语义化 LOD 标牌模式，突出大字号小标题，隐藏长文本）
  const isFarZoom = zoomLevel < 0.85

  // 画布容器 Ref，用于原生绑定 wheel 事件以阻止页面滚动
  const canvasContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = canvasContainerRef.current
    if (!el) return

    const handleWheel = (e: WheelEvent) => {
      // 关键：彻底阻止外层主页面跟随滚动，保证在画布内部只触发缩放
      e.preventDefault()
      e.stopPropagation()

      if (e.deltaY < 0) {
        setZoomLevel((prev) => Math.min(1.25, Number((prev + 0.08).toFixed(2))))
      } else {
        setZoomLevel((prev) => Math.max(0.7, Number((prev - 0.08).toFixed(2))))
      }
    }

    // 显式以 passive: false 绑定，保证 preventDefault 生效
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', handleWheel)
    }
  }, [])

  return (
    <div className="flex-1 w-full overflow-y-auto bg-[#FBF9F5] text-[#1E2024] select-text">
      {/* ========================================================================= */}
      {/* 1. HERO SECTION：以 NetDive 为核心的大气标题 + 三大核心功能入口卡片        */}
      {/* ========================================================================= */}
      <section className="relative w-full border-b border-[#E5E0D8] bg-white pt-12 pb-14 sm:pt-16 sm:pb-16 px-6 sm:px-10 lg:px-16 overflow-hidden">
        {/* 背景柔和细微点阵装饰 */}
        <div className="absolute inset-0 bg-[radial-gradient(#E8E2D6_1px,transparent_1px)] [background-size:24px_24px] opacity-40 pointer-events-none" />

        <div className="max-w-5xl mx-auto space-y-8 relative text-center">
          {/* 大标题：NetDive 项目名与简练定位句 */}
          <div className="space-y-3">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-[#1E2024] tracking-tight">
              NetDive
            </h1>
            <p className="text-base sm:text-lg text-[#5C5549] max-w-xl mx-auto leading-relaxed">
              把长任务执行过程转化为看得清的调用步骤，支持宏微双焦回放、同屏测试对比与上下文微压缩。
            </p>
          </div>

          {/* 三大核心功能入口卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-2 text-left">
            {/* 模块 1：会话回放 */}
            <div
              onClick={() => onNavigate('live')}
              className="p-5 rounded-2xl bg-[#FAF8F5] border border-[#E5E0D8] hover:border-[#1E2024] hover:bg-white hover:shadow-md transition-all cursor-pointer group shadow-2xs flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                    <Layers className="w-4.5 h-4.5" />
                  </div>
                  <span className="text-[10px] font-mono text-[#8F887D] tracking-wider uppercase font-semibold">
                    01 / REPLAY
                  </span>
                </div>
                <h3 className="text-base font-bold text-[#1E2024] mb-1.5 flex items-center justify-between">
                  <span>会话回放</span>
                  <ArrowRight className="w-4 h-4 text-[#8F887D] group-hover:translate-x-1 group-hover:text-[#1E2024] transition-all" />
                </h3>
                <p className="text-xs text-[#5C5549] leading-relaxed">
                  百次工具调用自动聚类为业务大回合，支持宏微双焦下钻展开每一步思考、代码修改与终端命令。
                </p>
              </div>
              <div className="pt-4 flex items-center text-xs font-semibold text-emerald-700 group-hover:text-emerald-800">
                <span>进入工作台</span>
                <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </div>

            {/* 模块 2：用例提纯 */}
            <div
              onClick={() => onNavigate('regression')}
              className="p-5 rounded-2xl bg-[#FAF8F5] border border-[#E5E0D8] hover:border-[#1E2024] hover:bg-white hover:shadow-md transition-all cursor-pointer group shadow-2xs flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-800 flex items-center justify-center">
                    <FlaskConical className="w-4.5 h-4.5" />
                  </div>
                  <span className="text-[10px] font-mono text-[#8F887D] tracking-wider uppercase font-semibold">
                    02 / REGRESSION
                  </span>
                </div>
                <h3 className="text-base font-bold text-[#1E2024] mb-1.5 flex items-center justify-between">
                  <span>用例提纯</span>
                  <ArrowRight className="w-4 h-4 text-[#8F887D] group-hover:translate-x-1 group-hover:text-[#1E2024] transition-all" />
                </h3>
                <p className="text-xs text-[#5C5549] leading-relaxed">
                  从失败会话捕获故障特征与断言指纹，提纯为回归测试用例，并在优化重跑后一键对账验收。
                </p>
              </div>
              <div className="pt-4 flex items-center text-xs font-semibold text-indigo-700 group-hover:text-indigo-800">
                <span>进入工作台</span>
                <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </div>

            {/* 模块 3：上下文演练 */}
            <div
              onClick={() => onNavigate('context')}
              className="p-5 rounded-2xl bg-[#FAF8F5] border border-[#E5E0D8] hover:border-[#1E2024] hover:bg-white hover:shadow-md transition-all cursor-pointer group shadow-2xs flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center">
                    <Activity className="w-4.5 h-4.5" />
                  </div>
                  <span className="text-[10px] font-mono text-[#8F887D] tracking-wider uppercase font-semibold">
                    03 / CONTEXT
                  </span>
                </div>
                <h3 className="text-base font-bold text-[#1E2024] mb-1.5 flex items-center justify-between">
                  <span>上下文演练</span>
                  <ArrowRight className="w-4 h-4 text-[#8F887D] group-hover:translate-x-1 group-hover:text-[#1E2024] transition-all" />
                </h3>
                <p className="text-xs text-[#5C5549] leading-relaxed">
                  7 维正交测绘系统词、历史对话与工具返回的水位占比，Head/Tail 微压缩长输出并保真 KV 缓存。
                </p>
              </div>
              <div className="pt-4 flex items-center text-xs font-semibold text-amber-700 group-hover:text-amber-800">
                <span>进入工作台</span>
                <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 2. SECTION 01: 会话回放 (左侧说明，右侧交互小画布 + 六大动作色标)            */}
      {/* ========================================================================= */}
      <section
        id="feature-replay"
        className="w-full py-16 sm:py-24 px-6 sm:px-10 lg:px-16 border-b border-[#E5E0D8] bg-[#FAF8F5]"
      >
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          {/* 左侧说明 */}
          <div className="lg:col-span-5 space-y-4">
            <div className="space-y-1.5">
              <span className="text-xs font-mono font-bold tracking-wider text-emerald-700 uppercase">
                01 / SESSION REPLAY
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-[#1E2024] tracking-tight">
                宏微双焦看清长任务调用链路
              </h2>
            </div>

            <p className="text-sm text-[#5C5549] leading-relaxed">
              长任务上百次工具调用平铺成网令人眼花，纯文本日志又晦涩难查。NetDive 宏观聚合大回合屏蔽噪音，微观一键下钻查看每一步代码与命令。
            </p>

            {/* 核心亮点列表（还原带丸子图标徽章的精致卡片样式） */}
            <div className="space-y-3 pt-1 text-xs text-[#4A443B]">
              <div className="flex items-start space-x-3">
                <div className="p-1.5 rounded-lg bg-emerald-100 text-emerald-800 shrink-0 mt-0.5">
                  <Layers className="w-3.5 h-3.5" />
                </div>
                <div>
                  <strong className="text-[#1E2024] font-bold block mb-0.5">宏微双焦设计</strong>
                  <span className="text-[#6B6357] leading-relaxed">
                    长任务自动聚类为业务大回合，点击卡片直接下钻展开单步明细。
                  </span>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <div className="p-1.5 rounded-lg bg-emerald-100 text-emerald-800 shrink-0 mt-0.5">
                  <Search className="w-3.5 h-3.5" />
                </div>
                <div>
                  <strong className="text-[#1E2024] font-bold block mb-0.5">单步调用审查</strong>
                  <span className="text-[#6B6357] leading-relaxed">
                    点击节点弹出抽屉，细查提示词上下文、入参、终端输出及代码改动。
                  </span>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <div className="p-1.5 rounded-lg bg-emerald-100 text-emerald-800 shrink-0 mt-0.5">
                  <ShieldAlert className="w-3.5 h-3.5" />
                </div>
                <div>
                  <strong className="text-[#1E2024] font-bold block mb-0.5">人机门禁与高危拦截</strong>
                  <span className="text-[#6B6357] leading-relaxed">
                    死循环报错或高危命令（如提交代码、删库）毫秒级物理挂起，由人类确认放行。
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={() => onNavigate('live')}
                className="px-5 py-2.5 rounded-xl bg-[#1E2024] hover:bg-[#32363D] text-white text-xs font-semibold flex items-center space-x-2 shadow-xs transition-all cursor-pointer"
              >
                <span>进入会话回放工作台</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 右侧展示窗：可交互小画布 + 底部 6 大标准动作色标 */}
          <div className="lg:col-span-7 rounded-2xl bg-white border border-[#E5E0D8] shadow-md overflow-hidden flex flex-col">
            {/* macOS 风格视窗控制条 + 工具栏 */}
            <div className="px-4 py-3 bg-[#F2EDE4] border-b border-[#E5E0D8] flex flex-wrap items-center justify-between gap-2 select-none">
              <div className="flex items-center space-x-2.5">
                <span className="w-3 h-3 rounded-full bg-rose-400" />
                <span className="w-3 h-3 rounded-full bg-amber-400" />
                <span className="w-3 h-3 rounded-full bg-emerald-400" />
                <span className="font-mono text-xs font-semibold text-[#1E2024] ml-1.5 flex items-center space-x-1.5">
                  <Layers className="w-3.5 h-3.5 text-amber-600" />
                  <span>宏微双焦执行流交互演示</span>
                </span>
              </div>

              {/* 模式切换 + 缩放控制器 */}
              <div className="flex items-center space-x-2">
                {/* 宏微双焦切换 */}
                <div className="flex items-center space-x-1 bg-white/90 p-0.5 rounded-lg border border-[#E0D9CE] text-xs">
                  <button
                    onClick={() => setDrilldownMode('macro')}
                    title="宏观回合模式：长任务自动聚类为业务大回合，屏蔽调用噪音"
                    className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer text-[11px] flex items-center space-x-1 ${
                      drilldownMode === 'macro'
                        ? 'bg-[#1E2024] text-white shadow-xs'
                        : 'text-[#5C5549] hover:text-[#1E2024]'
                    }`}
                  >
                    <Layers className="w-3 h-3 text-amber-400" />
                    <span>宏观 (Turn)</span>
                  </button>
                  <button
                    onClick={() => setDrilldownMode('micro')}
                    title="微观步骤模式：深入展开单步思考与命令 (支持滚轮缩放与小标题标牌)"
                    className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer text-[11px] flex items-center space-x-1 ${
                      drilldownMode === 'micro'
                        ? 'bg-[#1E2024] text-white shadow-xs'
                        : 'text-[#5C5549] hover:text-[#1E2024]'
                    }`}
                  >
                    <Activity className="w-3 h-3 text-sky-400" />
                    <span>微观 (Step)</span>
                  </button>
                </div>

                {/* 缩放控制器 */}
                <div className="flex items-center space-x-1 bg-white/90 px-1.5 py-0.5 rounded-lg border border-[#E0D9CE] text-[11px] font-mono text-[#5C5549]">
                  <button
                    onClick={() => setZoomLevel((prev) => Math.max(0.7, Number((prev - 0.15).toFixed(2))))}
                    className="p-1 hover:bg-[#F2EDE4] rounded cursor-pointer text-[#4A443B]"
                    title="缩小画布"
                  >
                    <ZoomOut className="w-3 h-3" />
                  </button>
                  <span
                    onClick={() => setZoomLevel(1)}
                    title="点击重置缩放为 100%"
                    className="w-9 text-center font-bold text-[#1E2024] cursor-pointer hover:text-amber-800 transition-colors"
                  >
                    {Math.round(zoomLevel * 100)}%
                  </span>
                  <button
                    onClick={() => setZoomLevel((prev) => Math.min(1.25, Number((prev + 0.15).toFixed(2))))}
                    className="p-1 hover:bg-[#F2EDE4] rounded cursor-pointer text-[#4A443B]"
                    title="放大画布"
                  >
                    <ZoomIn className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>

            {/* 交互小画布容器（原生 wheel 拦截，保证滚动只缩放画布，页面不滚动） */}
            <div
              ref={canvasContainerRef}
              className="relative min-h-[340px] p-6 bg-[#FAF8F5] overflow-hidden flex flex-col justify-center items-center select-none"
              style={{
                backgroundImage: 'radial-gradient(#D8D1C3 1px, transparent 1px)',
                backgroundSize: '18px 18px',
                overscrollBehavior: 'contain',
              }}
            >
              {/* 随缩放比例平滑变换的主体 */}
              <div
                className="transition-transform duration-200 ease-out origin-center w-full flex justify-center py-2"
                style={{ transform: `scale(${zoomLevel})` }}
              >
                {drilldownMode === 'macro' ? (
                  /* 宏观模式：单个高质感 Turn 卡片，始终保持完整信息，点击即可下钻 */
                  <div
                    onClick={() => setDrilldownMode('micro')}
                    className="w-full max-w-[420px] rounded-xl border border-[#DDD6CA] bg-white p-4 shadow-[2px_2px_0px_#DDD6CA] hover:shadow-[4px_4px_0px_#B8AF9F] hover:border-[#1E2024] transition-all cursor-pointer group"
                  >
                    {/* 顶部：回合序号、状态与性能 */}
                    <div className="flex items-center justify-between pb-2 border-b border-[#F0EBE1] text-xs">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-[#FAF8F5] border border-[#DDD6CA] text-[#1E2024]">
                          {MOCK_TURN_DEMO.turnId}
                        </span>
                        <span className="font-semibold text-[#1E2024]">
                          {MOCK_TURN_DEMO.title}
                        </span>
                      </div>

                      <span className="flex items-center space-x-1 text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-mono font-semibold">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span>完成</span>
                      </span>
                    </div>

                    {/* 摘要说明：宏观始终保持完整描述 */}
                    <div className="py-2.5 text-xs text-[#5C5549] leading-relaxed">
                      {MOCK_TURN_DEMO.summary}
                    </div>

                    {/* 工具手势收敛清单 */}
                    <div className="py-2 px-2.5 rounded-lg bg-[#FAF8F5] border border-[#EDE7DD] flex flex-wrap items-center justify-between gap-y-1 text-[11px] font-mono">
                      <span className="text-[#7A7265]">收敛底层调用 (4 次)：</span>
                      <div className="flex items-center space-x-2 text-[#4A443B]">
                        <span className="flex items-center space-x-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                          <span>think 1</span>
                        </span>
                        <span className="flex items-center space-x-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                          <span>read 1</span>
                        </span>
                        <span className="flex items-center space-x-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                          <span>edit 1</span>
                        </span>
                        <span className="flex items-center space-x-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          <span>bash 1</span>
                        </span>
                      </div>
                    </div>

                    {/* 底部：指标与醒目的下钻触发按钮 */}
                    <div className="mt-2.5 pt-2 border-t border-[#F0EBE1] flex items-center justify-between text-[11px] font-mono">
                      <div className="text-[#8F887D] space-x-2">
                        <span>{MOCK_TURN_DEMO.tokens}</span>
                        <span>•</span>
                        <span>{MOCK_TURN_DEMO.duration}</span>
                      </div>

                      <span className="inline-flex items-center space-x-1 text-emerald-700 font-semibold text-[11px] group-hover:translate-x-0.5 transition-transform">
                        <span>点击下钻微观步骤</span>
                        <ArrowRight className="w-3 h-3 text-emerald-600" />
                      </span>
                    </div>
                  </div>
                ) : (
                  /* 微观模式：清晰展示 4 个单步步骤卡片，带因果连线与自适应小标题标牌 */
                  <div className="relative w-full max-w-[500px]">
                    {/* 因果连线 SVG 拓扑层（基于 500x216 真实像素坐标系，纤细连线与微型小箭头） */}
                    <svg
                      className="absolute inset-0 w-full h-full pointer-events-none z-0"
                      viewBox="0 0 500 216"
                      preserveAspectRatio="none"
                    >
                      <defs>
                        <marker
                          id="micro-flow-arrow"
                          viewBox="0 0 6 6"
                          refX="4.5"
                          refY="3"
                          markerWidth="4"
                          markerHeight="4"
                          orient="auto-start-reverse"
                        >
                          <path d="M 0 1 L 4.5 3 L 0 5 z" fill="#A8A093" />
                        </marker>
                      </defs>

                      {/* 01 -> 02 横向因果边 */}
                      <path
                        d="M 234 49 L 263 49"
                        stroke="#B8B0A2"
                        strokeWidth="1"
                        strokeDasharray="3 2"
                        markerEnd="url(#micro-flow-arrow)"
                      />

                      {/* 02 -> 03 跨行 S 型平滑因果边 */}
                      <path
                        d="M 383 99 C 383 118, 117 98, 117 115"
                        fill="none"
                        stroke="#B8B0A2"
                        strokeWidth="1"
                        strokeDasharray="3 2"
                        markerEnd="url(#micro-flow-arrow)"
                      />

                      {/* 03 -> 04 横向因果边 */}
                      <path
                        d="M 234 167 L 263 167"
                        stroke="#B8B0A2"
                        strokeWidth="1"
                        strokeDasharray="3 2"
                        markerEnd="url(#micro-flow-arrow)"
                      />
                    </svg>

                    {/* 节点网格 */}
                    <div className="grid grid-cols-2 gap-x-8 gap-y-5 relative z-10">
                      {MOCK_TURN_DEMO.steps.map((step, idx) => {
                        const gestureDot =
                          step.gesture === 'think'
                            ? 'bg-purple-500'
                            : step.gesture === 'read'
                            ? 'bg-sky-500'
                            : step.gesture === 'edit'
                            ? 'bg-blue-500'
                            : 'bg-emerald-500'

                        return (
                          <div
                            key={step.id}
                            className={`rounded-xl border border-[#E5E0D8] bg-white shadow-2xs hover:border-[#1E2024] transition-all relative ${
                              isFarZoom ? 'p-2.5' : 'p-3'
                            }`}
                          >
                            {/* React Flow 桩点 (Handles)：微缩轻巧小点 */}
                            {idx === 0 && (
                              <div className="absolute -right-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#A8A093] border border-white" />
                            )}
                            {idx === 1 && (
                              <>
                                <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#A8A093] border border-white" />
                                <div className="absolute left-1/2 -bottom-1 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[#A8A093] border border-white" />
                              </>
                            )}
                            {idx === 2 && (
                              <>
                                <div className="absolute left-1/2 -top-1 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[#A8A093] border border-white" />
                                <div className="absolute -right-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#A8A093] border border-white" />
                              </>
                            )}
                            {idx === 3 && (
                              <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#A8A093] border border-white" />
                            )}

                            {/* 头部：去掉厚重矩形丸子，改用轻巧状态圆点 + 动作名 */}
                            <div className="flex items-center justify-between mb-1 text-[10px] font-mono">
                              <span className="flex items-center space-x-1.5 font-bold uppercase text-[#1E2024]">
                                <span className={`w-1.5 h-1.5 rounded-full ${gestureDot}`} />
                                <span>{step.gesture}</span>
                              </span>
                              <span className="text-[#8F887D]">
                                {step.duration}
                              </span>
                            </div>

                            {isFarZoom ? (
                              /* 远景模式：隐藏两行长 summary，大字号醒目呈现核心小标题标牌 */
                              <div className="py-1">
                                <div className="text-xs sm:text-sm font-bold text-[#1E2024] font-sans leading-snug tracking-tight">
                                  {step.billboard}
                                </div>
                                <div className="text-[10px] text-[#8F887D] font-mono mt-0.5">
                                  {step.actor}
                                </div>
                              </div>
                            ) : (
                              /* 正常视距模式：完整呈现标题、执行者与两行正文摘要 */
                              <>
                                <div className="text-xs font-bold text-[#1E2024] truncate">
                                  {step.label}
                                </div>
                                <div className="text-[10px] text-[#8F887D] font-mono mb-1">
                                  {step.actor}
                                </div>
                                <p className="text-[11px] text-[#5C5549] line-clamp-2 leading-relaxed">
                                  {step.summary}
                                </p>
                              </>
                            )}

                            <span className="absolute bottom-1.5 right-2 text-[10px] font-mono text-[#C0B8AC]">
                              0{idx + 1}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 底部：精简 6 大动作语义图例，去丸子化更通透 */}
            <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#EDE7DD]">
              <div className="flex flex-wrap items-center justify-between gap-y-1 gap-x-3 text-[11px] font-mono text-[#6B6357]">
                <span className="text-[#8F887D] font-medium">动作语义：</span>
                <span className="flex items-center space-x-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                  <span>think 思考</span>
                </span>
                <span className="flex items-center space-x-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                  <span>read 查阅</span>
                </span>
                <span className="flex items-center space-x-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  <span>edit 修改</span>
                </span>
                <span className="flex items-center space-x-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span>bash 终端</span>
                </span>
                <span className="flex items-center space-x-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-fuchsia-500" />
                  <span>memory 记忆</span>
                </span>
                <span className="flex items-center space-x-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  <span>gate 门禁</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 3. SECTION 02: 失败用例提纯与回归验收 (右文左图，对称排版)                    */}
      {/* ========================================================================= */}
      <section
        id="feature-diff"
        className="w-full py-16 sm:py-24 px-6 sm:px-10 lg:px-16 border-b border-[#E5E0D8] bg-white"
      >
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
          {/* 左侧对比视窗模拟 */}
          <div className="lg:col-span-7 order-2 lg:order-1 rounded-2xl bg-white border border-[#E5E0D8] shadow-md overflow-hidden">
            <div className="px-4 py-3 bg-[#F2EDE4] border-b border-[#E5E0D8] flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="w-3 h-3 rounded-full bg-rose-400" />
                <span className="w-3 h-3 rounded-full bg-amber-400" />
                <span className="w-3 h-3 rounded-full bg-emerald-400" />
                <span className="ml-2 font-mono text-[11px] text-[#7A7265]">
                  Trace-to-Eval Benchmark Diff
                </span>
              </div>
              <span className="font-mono text-[10px] text-indigo-800 bg-indigo-100 px-2 py-0.5 rounded font-medium">
                Eval Bench
              </span>
            </div>

            <div className="p-6 bg-[#FAF8F5] space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {/* 左边：旧版失败用例 */}
                <div className="p-3.5 bg-white rounded-xl border border-rose-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-rose-700 flex items-center space-x-1">
                      <XCircle className="w-3.5 h-3.5" />
                      <span>改动前 · 失败基准</span>
                    </span>
                    <span className="font-mono text-[10px] text-rose-600 bg-rose-50 px-1.5 py-0.2 rounded border border-rose-200">
                      FAILED
                    </span>
                  </div>
                  <div className="space-y-1 text-[#6B6357] text-[11px] font-mono">
                    <div>执行步骤: 14 步</div>
                    <div>耗时统计: 48.2s</div>
                    <div>Token 消耗: 42,600</div>
                    <div className="text-rose-600 font-semibold pt-1">
                      × 单测报错死循环 (退出码 1)
                    </div>
                  </div>
                </div>

                {/* 右边：重跑成功用例 */}
                <div className="p-3.5 bg-white rounded-xl border border-emerald-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-emerald-700 flex items-center space-x-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>修复后 · 重新运行</span>
                    </span>
                    <span className="font-mono text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                      PASSED
                    </span>
                  </div>
                  <div className="space-y-1 text-[#6B6357] text-[11px] font-mono">
                    <div>执行步骤: 6 步</div>
                    <div>耗时统计: 19.4s</div>
                    <div>Token 消耗: 15,200</div>
                    <div className="text-emerald-600 font-semibold pt-1">
                      ✓ 单测全绿，退出码正常为 0
                    </div>
                  </div>
                </div>
              </div>

              {/* 差异对账指示带 */}
              <div className="p-3 bg-white rounded-xl border border-[#EDE7DD] flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-[#7A7265]">改动效果对比汇总：</span>
                <div className="flex items-center space-x-3 font-mono text-[11px] font-semibold">
                  <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    步数 -58%
                  </span>
                  <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    耗时 -60%
                  </span>
                  <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    Token -64%
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 右侧说明 */}
          <div className="lg:col-span-5 order-1 lg:order-2 space-y-4">
            <div className="space-y-1.5">
              <span className="text-xs font-mono font-bold tracking-wider text-indigo-700 uppercase">
                02 / REGRESSION BENCH
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-[#1E2024] tracking-tight">
                失败用例提纯与回归验收
              </h2>
            </div>

            <p className="text-sm text-[#5C5549] leading-relaxed">
              调优提示词或代码最怕隐性功能翻车。将翻车会话通过 4 步流水线白盒萃取为标准化测试用例，并在重跑后逐项核对指纹与水位，确保模型只进化不退化。
            </p>

            {/* 核心亮点列表 */}
            <div className="space-y-3 pt-1 text-xs text-[#4A443B]">
              <div className="flex items-start space-x-3">
                <div className="p-1.5 rounded-lg bg-indigo-100 text-indigo-800 shrink-0 mt-0.5">
                  <Bookmark className="w-3.5 h-3.5" />
                </div>
                <div>
                  <strong className="text-[#1E2024] font-bold block mb-0.5">4 步提纯流水线</strong>
                  <span className="text-[#6B6357] leading-relaxed">
                    故障分级、指纹降噪、WAL 载荷剥离与三维断言合成，彻底白盒化。
                  </span>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <div className="p-1.5 rounded-lg bg-indigo-100 text-indigo-800 shrink-0 mt-0.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </div>
                <div>
                  <strong className="text-[#1E2024] font-bold block mb-0.5">冷热分层与 WAL 指针</strong>
                  <span className="text-[#6B6357] leading-relaxed">
                    巨型日志卸载为 WAL 离线指针，单用例体积 &lt; 5KB，秒级加载与对账。
                  </span>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <div className="p-1.5 rounded-lg bg-indigo-100 text-indigo-800 shrink-0 mt-0.5">
                  <Split className="w-3.5 h-3.5" />
                </div>
                <div>
                  <strong className="text-[#1E2024] font-bold block mb-0.5">三维确定性对账</strong>
                  <span className="text-[#6B6357] leading-relaxed">
                    指纹消除、Token 水位防退化与门禁次数归零全项核验，支持一键模拟重跑。
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={() => onNavigate('regression')}
                className="px-5 py-2.5 rounded-xl bg-white hover:bg-[#F4F0EA] border border-[#DCD5C9] text-[#1E2024] text-xs font-semibold flex items-center space-x-2 shadow-xs transition-all cursor-pointer"
              >
                <span>进入用例提纯工作台</span>
                <ArrowRight className="w-3.5 h-3.5 text-[#5C5549]" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 4. SECTION 03: 上下文演练 (突出 7 维测绘与微压缩)                           */}
      {/* ========================================================================= */}
      <section
        id="feature-context"
        className="w-full py-16 sm:py-24 px-6 sm:px-10 lg:px-16 border-b border-[#E5E0D8] bg-[#FAF8F5]"
      >
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
          {/* 左侧说明 */}
          <div className="lg:col-span-5 space-y-4">
            <div className="space-y-1.5">
              <span className="text-xs font-mono font-bold tracking-wider text-amber-700 uppercase">
                03 / CONTEXT LAB
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-[#1E2024] tracking-tight">
                正交测绘上下文水位与微压缩
              </h2>
            </div>

            <p className="text-sm text-[#5C5549] leading-relaxed">
              长任务万行输出会导致注意力稀释与显存膨胀，随手加时间戳更会破坏 KV 缓存。NetDive 提供 7 维水位剖析与确定性微压缩，推演最佳降噪方案。
            </p>

            {/* 核心亮点列表 */}
            <div className="space-y-3 pt-1 text-xs text-[#4A443B]">
              <div className="flex items-start space-x-3">
                <div className="p-1.5 rounded-lg bg-amber-100 text-amber-800 shrink-0 mt-0.5">
                  <Activity className="w-3.5 h-3.5" />
                </div>
                <div>
                  <strong className="text-[#1E2024] font-bold block mb-0.5">7 维正交测绘</strong>
                  <span className="text-[#6B6357] leading-relaxed">
                    拆解系统词、历史对话、工具结果与代码占比，定位谁在膨胀。
                  </span>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <div className="p-1.5 rounded-lg bg-amber-100 text-amber-800 shrink-0 mt-0.5">
                  <Scissors className="w-3.5 h-3.5" />
                </div>
                <div>
                  <strong className="text-[#1E2024] font-bold block mb-0.5">Head/Tail 微压缩</strong>
                  <span className="text-[#6B6357] leading-relaxed">
                    截取前 15 行环境与后 15 行结果，中间折叠省 80% Token。
                  </span>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <div className="p-1.5 rounded-lg bg-amber-100 text-amber-800 shrink-0 mt-0.5">
                  <Zap className="w-3.5 h-3.5" />
                </div>
                <div>
                  <strong className="text-[#1E2024] font-bold block mb-0.5">前缀缓存保真</strong>
                  <span className="text-[#6B6357] leading-relaxed">
                    校验系统提示词稳定前缀，避免击穿厂商 KV 缓存。
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={() => onNavigate('context')}
                className="px-5 py-2.5 rounded-xl bg-white hover:bg-[#F4F0EA] border border-[#DCD5C9] text-[#1E2024] text-xs font-semibold flex items-center space-x-2 shadow-xs transition-all cursor-pointer"
              >
                <span>进入上下文演练台</span>
                <ArrowRight className="w-3.5 h-3.5 text-[#5C5549]" />
              </button>
            </div>
          </div>

          {/* 右侧展示窗：整合容量水位与微压缩终端 */}
          <div className="lg:col-span-7 space-y-4">
            {/* 上部：容量水位条 */}
            <div className="rounded-2xl bg-white border border-[#E5E0D8] shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 bg-[#F2EDE4] border-b border-[#E5E0D8] flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  <span className="ml-1 font-mono text-[11px] text-[#7A7265]">
                    Context Token Capacity
                  </span>
                </div>
                <span className="font-mono text-[10px] text-amber-800 bg-amber-100 px-2 py-0.5 rounded font-medium">
                  KV Cache: 98.2%
                </span>
              </div>

              <div className="p-4 space-y-3 bg-[#FAF8F5]">
                <div className="flex items-center justify-between text-xs text-[#7A7265]">
                  <span className="font-semibold text-[#1E2024]">Token 容量使用率 (32%)</span>
                  <span className="font-mono text-[11px]">42,000 / 128,000 Tokens</span>
                </div>

                <div className="h-3 w-full bg-[#E5E0D8] rounded-full overflow-hidden flex">
                  <div className="bg-purple-500 h-full" style={{ width: '30%' }} title="系统提示词 30%" />
                  <div className="bg-sky-500 h-full" style={{ width: '25%' }} title="对话历史 25%" />
                  <div className="bg-emerald-500 h-full" style={{ width: '35%' }} title="工具返回 35%" />
                  <div className="bg-[#DDD6CA] h-full" style={{ width: '10%' }} title="剩余可用" />
                </div>
              </div>
            </div>

            {/* 下部：终端微视窗截断 */}
            <div className="rounded-2xl bg-[#1E2024] border border-[#2E333D] shadow-md overflow-hidden text-white font-mono">
              <div className="px-4 py-2.5 bg-[#15171B] border-b border-[#2E333D] flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2">
                  <span className="text-[11px] text-[#A0A6B2]">
                    bash — Head 15 + Tail 15 Micro-Compactor
                  </span>
                </div>
                <span className="text-[10px] text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/80">
                  -86% Token 节省
                </span>
              </div>

              <div className="p-4 space-y-2 text-xs">
                <div className="text-[#CBD5E1]">
                  <span className="text-emerald-400">$</span> pnpm run build:all --target=esnext
                </div>

                <div className="text-emerald-300 text-[11px] space-y-0.5">
                  <div>[Head 01] turbo 2.4.1 [pipeline: build:all]</div>
                  <div>[Head 02] Packages in scope: @netdive/core, @netdive/web</div>
                  <div>[Head 03] Compiling src/ast.ts (AST node visitor)...</div>
                </div>

                {/* 折叠区域存根 */}
                <div className="py-1.5 px-3 rounded-lg bg-[#2D3139] text-[#CBD5E1] flex items-center justify-between border border-[#3E4451] my-1.5">
                  <span className="flex items-center space-x-2 text-[11px]">
                    <Scissors className="w-3.5 h-3.5 text-amber-400" />
                    <span>已折叠 1,420 行编译细节 (生成 WAL 存根指针)</span>
                  </span>
                  <span className="text-amber-300 text-[10px] bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/80">
                    抽屉可随时一键还原
                  </span>
                </div>

                <div className="text-emerald-300 text-[11px] space-y-0.5">
                  <div>[Tail 14] Test Suites: 4 passed, 4 total</div>
                  <div>[Tail 15] Tests: 146 passed, 146 total (100% green)</div>
                  <div className="text-emerald-400 font-semibold">
                    ✓ Full pipeline execution completed in 840ms
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 5. BOTTOM CTA & FOOTER：现代开阔的收尾区                                     */}
      {/* ========================================================================= */}
      <section className="w-full bg-[#1E2024] text-white py-16 px-6 sm:px-10 lg:px-16">
        <div className="max-w-4xl mx-auto text-center space-y-6">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            看清 Agent 执行全貌，让黑盒过程透明化
          </h2>
          <p className="text-sm text-[#A0A6B2] max-w-xl mx-auto leading-relaxed">
            告别盲人摸象式的终端日志猜测，在宏微双焦步骤图与上下文演练中全面掌握系统状态。
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              onClick={() => onNavigate('live')}
              className="px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-[#1E2024] font-bold text-sm flex items-center space-x-2 shadow-sm transition-all cursor-pointer"
            >
              <PlayCircle className="w-4 h-4 text-[#1E2024]" />
              <span>进入会话回放工作台</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={() => onNavigate('context')}
              className="px-5 py-3 rounded-xl bg-[#2D3139] hover:bg-[#383E48] text-white font-mono text-xs flex items-center space-x-2 border border-[#454B57] transition-all cursor-pointer"
            >
              <Activity className="w-3.5 h-3.5 text-amber-400" />
              <span>探索上下文演练台</span>
            </button>
          </div>

          <div className="pt-8 border-t border-[#2E333D] flex flex-col sm:flex-row items-center justify-between text-xs text-[#707684] gap-2">
            <span>NetDive — Agent Execution Observability Studio</span>
            <span>纯本地运行 · 零外网依赖 · 隐私零上传</span>
          </div>
        </div>
      </section>
    </div>
  )
}
