import React, { useEffect, useMemo, useRef, useState } from 'react'
import { formatTokens } from '../types/telemetry'
import {
  buildTrendBars,
  type TrendGranularity,
  type TrendMode,
  type TrendModel,
  type TrendPoint,
} from '../services/contextTrend'

export interface ContextTrendTrackProps {
  model: TrendModel
  /** 抽屉下发的聚焦请求节点 ID，跨 Step / Turn 粒度稳定 */
  activeNodeId?: string | null
  pinnedNodeId?: string | null
  onHoverStep?: (point: TrendPoint | null) => void
  onPinStep?: (point: TrendPoint) => void
  onClearPin?: () => void
}

const SVG_HEIGHT = 76
const PADDING = 8
const BAR_FILL = '#818CF8'
const BAR_SELECTED = '#4338CA'
const BAR_PINNED = '#312E81'
const BAR_NEGATIVE = '#10B981'

/**
 * 上下文体量趋势轨道（纯 SVG，不引第三方图表库）
 *
 * 每个请求一根柱，✂ 固定在该请求上；总量/增量与步骤/回合切换只改变视图密度，
 * 不改事件流。点选只传 TrendPoint 指针，完整原文仍留在 eventsMap / WAL。
 */
export const ContextTrendTrack: React.FC<ContextTrendTrackProps> = ({
  model,
  activeNodeId,
  pinnedNodeId,
  onHoverStep,
  onPinStep,
  onClearPin,
}) => {
  const [mode, setMode] = useState<TrendMode>('total')
  const [granularity, setGranularity] = useState<TrendGranularity>('step')
  const [width, setWidth] = useState(1000)
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const nextWidth = Math.round(entries[0]?.contentRect.width ?? 0)
      if (nextWidth > 0) setWidth(nextWidth)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const points = granularity === 'step' ? model.points : model.turnPoints
  const bars = useMemo(
    () => buildTrendBars(points, mode, { width, height: SVG_HEIGHT, padding: PADDING }),
    [points, mode, width]
  )

  const matchedIndex = activeNodeId ? points.findIndex((p) => p.nodeId === activeNodeId) : -1
  const activeIndex = matchedIndex >= 0 ? matchedIndex : points.length - 1
  const activePoint = points[activeIndex]
  const baseline = mode === 'total' ? SVG_HEIGHT - PADDING : SVG_HEIGHT / 2
  const reclaimed = activePoint?.markers.reduce((sum, marker) => sum - marker.deltaTokens, 0) ?? 0
  const isCounted = model.provenance === 'counted'

  const switchClass = (active: boolean): string =>
    `px-1.5 h-[18px] rounded text-[10px] leading-none border cursor-pointer transition-colors ${
      active
        ? 'bg-[#1E2024] text-[#FBF9F5] border-[#1E2024]'
        : 'bg-white text-[#5E6573] border-[#DCD5C9] hover:border-[#B5AFA4]'
    }`

  if (points.length === 0 || !activePoint) {
    return (
      <div className="flex items-center gap-2 h-[54px] text-[11px] text-[#8F887D]">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
        该会话未留存逐请求体量，趋势不可推算。窗口构成仍可查看，数据源为当前快照。
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 select-none">
      {/* 控制行：来源、密度切换、剩余窗口 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-semibold text-[#5E6573]">上下文体量趋势</span>
        <span
          className={`inline-flex items-center gap-1 h-[18px] rounded-full px-2 text-[10px] ${
            isCounted ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}
          title={isCounted ? '来自真实 message.usage' : '会话未记录 usage，按字符量启发式推算'}
        >
          <span className={`w-1 h-1 rounded-full ${isCounted ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          {isCounted ? '实测 usage' : '推算值'}
        </span>

        <div className="flex items-center gap-0.5">
          <button type="button" className={switchClass(mode === 'total')} onClick={() => setMode('total')}>
            总量
          </button>
          <button type="button" className={switchClass(mode === 'delta')} onClick={() => setMode('delta')}>
            增量
          </button>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className={switchClass(granularity === 'step')}
            onClick={() => {
              setGranularity('step')
              onClearPin?.()
              onHoverStep?.(null)
            }}
          >
            步骤
          </button>
          <button
            type="button"
            className={switchClass(granularity === 'turn')}
            onClick={() => {
              setGranularity('turn')
              onClearPin?.()
              onHoverStep?.(null)
            }}
          >
            回合
          </button>
        </div>

        <div className="flex-1" />

        <span className="text-[10px] text-[#8F887D] whitespace-nowrap">
          剩余 {formatTokens(model.headroomTokens)}
          {model.headroomRequests !== null
            ? ` · 推算还可容纳 ~${model.headroomRequests} 次请求`
            : ' · 暂无增长趋势，次数不推算'}
        </span>
        <span className="text-[10px] text-[#A8A29E] whitespace-nowrap">
          {pinnedNodeId !== null
            ? `已固定第 ${points.find((p) => p.nodeId === pinnedNodeId)?.stepIndex ?? '?'} 次 · Esc 取消`
            : '悬停预览 · 点击固定'}
        </span>
      </div>

      {/* 纯 SVG 柱阵 */}
      <svg
        ref={svgRef}
        width="100%"
        height={SVG_HEIGHT}
        viewBox={`0 0 ${width} ${SVG_HEIGHT}`}
        role="img"
        aria-label="逐请求上下文体量趋势"
        className="block rounded-sm bg-[#F4F0EA]"
      >
        <line
          x1={0}
          x2={width}
          y1={baseline}
          y2={baseline}
          stroke="#D6D0C5"
          strokeWidth={1}
          strokeDasharray={mode === 'delta' ? '3 3' : undefined}
        />
        {bars.map((bar, index) => {
          const { point } = bar
          return (
            <g
              key={`${point.nodeId}-${index}`}
              onMouseEnter={() => onHoverStep?.(point)}
              onMouseLeave={() => onHoverStep?.(null)}
              onClick={() => {
                onHoverStep?.(null)
                onPinStep?.(point)
              }}
              className="cursor-pointer"
            >
              <title>
                {`第 ${point.stepIndex} 次请求 · 输入 ${formatTokens(point.tokens)} tokens`}
                {point.delta !== 0
                  ? ` · ${point.delta > 0 ? '新增' : '回收'} ${formatTokens(Math.abs(point.delta))}`
                  : ''}
                {point.markers.length > 0 ? ' · 含压缩剪枝事件' : ''}
              </title>
              <rect
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                rx={1}
                fill={
                  bar.negative
                    ? BAR_NEGATIVE
                    : point.nodeId === pinnedNodeId
                      ? BAR_PINNED
                      : index === activeIndex
                        ? BAR_SELECTED
                        : BAR_FILL
                }
                opacity={index === activeIndex ? 1 : 0.78}
              />
              {point.nodeId === pinnedNodeId && (
                <circle
                  cx={bar.x + bar.width / 2}
                  cy={Math.max(4, bar.y - 9)}
                  r={2}
                  fill="#B45309"
                />
              )}
              {point.markers.length > 0 && (
                <text
                  x={bar.x + bar.width / 2}
                  y={Math.max(9, bar.y - 2)}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#B45309"
                >
                  ✂
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* 选中请求的实证明细与三行步骤摘要 */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 grid grid-cols-[42px_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[10px] leading-[14px]">
          <span className="text-[#A8A29E]">User</span>
          <span className="truncate text-[#5E6573]">{activePoint.summary.user}</span>
          <span className="text-[#A8A29E]">In</span>
          <span className="truncate text-[#5E6573]">{activePoint.summary.input}</span>
          <span className="text-[#A8A29E]">Response</span>
          <span className="truncate text-[#5E6573]">{activePoint.summary.response}</span>
        </div>

        <div className="shrink-0 text-right text-[10px] leading-[14px] text-[#5E6573]">
          <div>
            第 {activePoint.stepIndex} 次 · 输入 {formatTokens(activePoint.tokens)}
            {mode === 'delta' && activePoint.delta !== 0 && (
              <span className={activePoint.delta < 0 ? 'text-emerald-700' : 'text-indigo-700'}>
                {' '}
                ({activePoint.delta > 0 ? '+' : '−'}
                {formatTokens(Math.abs(activePoint.delta))})
              </span>
            )}
          </div>
          <div className="text-[#A8A29E]">
            输出 {formatTokens(activePoint.output)} · 缓存 {formatTokens(activePoint.cacheRead)}
          </div>
          {reclaimed > 0 && (
            <div className="text-emerald-700">✂ 回收 {formatTokens(reclaimed)}</div>
          )}
        </div>
      </div>
    </div>
  )
}
