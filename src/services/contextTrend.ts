/**
 * NetDive Context Trend & Event Track (M1)
 *
 * 从 TelemetryEvent[] 事件流派生逐请求上下文体量。事件流是唯一真相源，
 * parser 已把 message.usage 挂到每条 assistant 事件上，这里按请求去重即可，
 * 不在 ParsedTranscript 里重复存一份投影。
 *
 * 纯函数层：趋势柱几何、有符号增量、Step/Turn 双粒度、✂ 事件定位、headroom 推算。
 */
import { sift, unique } from 'radash'
import type { TelemetryEvent } from '../types/telemetry'
import { normalizeObservationOutput } from '../types/telemetry'

export type TrendGranularity = 'step' | 'turn'
export type TrendMode = 'total' | 'delta'
export type TrendEventKind = 'compact' | 'prune'
export type TrendProvenance = 'counted' | 'estimated'

/** 无 usage 会话的估算起点，与 transcriptParser 的系统提示词兜底值同源，属推算值 */
export const ESTIMATED_BASE_TOKENS = 12000

const CHARS_PER_TOKEN = 4
const SUMMARY_LIMIT = 72
const HEADROOM_SAMPLE = 4

/** 上下文净变化事件，deltaTokens 为负表示回收 */
export interface TrendMarker {
  nodeId: string
  kind: TrendEventKind
  deltaTokens: number
  pointIndex: number
  timestamp?: number
  source: string
}

/** 单步摘要三行：开启该轮的用户输入、本轮新加入内容、模型回复 */
export interface StepSummary {
  user: string
  input: string
  response: string
}

/** 一次模型请求的上下文体量点 */
export interface TrendPoint {
  nodeId: string
  stepIndex: number
  turnIndex: number
  tokens: number
  delta: number
  output: number
  cacheRead: number
  timestamp?: number
  provenance: TrendProvenance
  summary: StepSummary
  markers: TrendMarker[]
}

/** 完整趋势模型，抽屉与轨道组件共用 */
export interface TrendModel {
  points: TrendPoint[]
  turnPoints: TrendPoint[]
  markers: TrendMarker[]
  maxTokens: number
  window: number
  headroomTokens: number
  headroomRequests: number | null
  provenance: TrendProvenance
}

export interface TrendGeometry {
  width: number
  height: number
  padding?: number
}

export interface TrendBar {
  x: number
  y: number
  width: number
  height: number
  point: TrendPoint
  negative: boolean
}

const TOOL_GESTURES: Readonly<Record<string, true>> = {
  bash: true,
  edit: true,
  read: true,
  memory: true,
  gate: true,
}

const clip = (text: string): string =>
  text.trim().replace(/\s+/g, ' ').slice(0, SUMMARY_LIMIT) || '无'

const isUserEvent = (event: TelemetryEvent): boolean => event.actor === 'Human Operator'

const isToolEvent = (event: TelemetryEvent): boolean =>
  Boolean(event.gesture && TOOL_GESTURES[event.gesture])

const isUsageEvent = (event: TelemetryEvent): boolean => (event.usage?.input ?? 0) > 0

const isModelReplyEvent = (event: TelemetryEvent): boolean =>
  event.gesture === 'think' && Boolean(event.delta?.trim())

const usageKey = (event: TelemetryEvent): string =>
  `${event.timestamp ?? 0}:${event.usage?.input ?? 0}:${event.usage?.output ?? 0}`

const eventChars = (event: TelemetryEvent): number =>
  (event.delta?.length ?? 0) +
  normalizeObservationOutput(event.observation?.output).join('\n').length

/** 相对上一个点的有符号增量，首个请求没有前序，记 0 */
export const attachDelta = (points: TrendPoint[]): TrendPoint[] =>
  points.map((point, index) => ({
    ...point,
    delta: index === 0 ? 0 : point.tokens - points[index - 1].tokens,
  }))

/** 按用户轮次聚合，每轮取最后一次请求作为该轮的窗口体量 */
export const aggregateByTurn = (points: TrendPoint[]): TrendPoint[] =>
  attachDelta(
    sift(
      unique(points.map((point) => point.turnIndex)).map((turnIndex) =>
        points.filter((point) => point.turnIndex === turnIndex).at(-1)
      )
    )
  )

/** 剩余窗口与按最近数次增量推算的可容纳请求数，无增长趋势时返回 null */
export const estimateHeadroom = (
  points: TrendPoint[],
  window: number
): { tokens: number; requests: number | null } => {
  const last = points.at(-1)
  if (!last) return { tokens: Math.max(0, window), requests: null }

  const tokens = Math.max(0, window - last.tokens)
  const sample = points.slice(-HEADROOM_SAMPLE)
  const growths = sample
    .slice(1)
    .map((point, index) => point.tokens - sample[index].tokens)
    .filter((delta) => delta > 0)

  if (growths.length === 0) return { tokens, requests: null }
  const average = growths.reduce((sum, delta) => sum + delta, 0) / growths.length
  return { tokens, requests: Math.max(0, Math.floor(tokens / average)) }
}

interface ScanState {
  points: TrendPoint[]
  markers: TrendMarker[]
  turnIndex: number
  lastUserText: string
  lastToolTitle: string
  cumulativeTokens: number
  lastUsageKey: string
}

const initialScan = (): ScanState => ({
  points: [],
  markers: [],
  turnIndex: 0,
  lastUserText: '无用户指令记录',
  lastToolTitle: '无新增工具结果',
  cumulativeTokens: ESTIMATED_BASE_TOKENS,
  lastUsageKey: '',
})

/**
 * 单次扫描事件流，同时产出请求点、✂ 事件与三行步骤摘要。
 *
 * @example
 * ```ts
 * // [Input Shape - TelemetryEvent[] 片段]:
 * // [{ nodeId: 'u1', actor: 'Human Operator', delta: '跑测试', gesture: 'read' },
 * //  { nodeId: 'a1', gesture: 'think', delta: '开始', usage: { input: 14000, output: 320 } },
 * //  { nodeId: 'a2', gesture: 'think', delta: '继续', usage: { input: 14000, output: 320 } }]
 * // a1 与 a2 是同一条 assistant 消息的两个 block，连续相同 usage 折叠为一个请求点
 *
 * const { points, markers } = scanEvents(events, 'counted')
 * // points.length === 1；points[0].tokens === 14000；points[0].provenance === 'counted'
 * // points[0].summary.user === '跑测试'
 * ```
 */
export const scanEvents = (
  events: TelemetryEvent[],
  provenance: TrendProvenance
): Pick<TrendModel, 'points' | 'markers'> => {
  const state = events.reduce<ScanState>((acc, event) => {
    const next: ScanState = { ...acc }

    if (isUserEvent(event)) {
      next.turnIndex = acc.turnIndex + 1
      next.lastUserText = clip(event.delta ?? event.title ?? '')
    }
    if (isToolEvent(event)) {
      next.lastToolTitle = clip(event.title ?? '')
    }

    if (event.type === 'context_pruned') {
      next.markers = [
        ...acc.markers,
        {
          nodeId: event.nodeId,
          kind: event.contextPruned ? 'compact' : 'prune',
          deltaTokens: -(event.contextPruned?.reclaimedTokens ?? event.reclaimedTokens ?? 0),
          pointIndex: Math.max(0, acc.points.length - 1),
          timestamp: event.timestamp,
          source: event.title ?? '上下文剪枝',
        },
      ]
    }

    const shouldEmit =
      provenance === 'counted'
        ? isUsageEvent(event) && usageKey(event) !== acc.lastUsageKey
        : isModelReplyEvent(event)

    if (shouldEmit) {
      const cumulative = acc.cumulativeTokens + eventChars(event) / CHARS_PER_TOKEN
      const tokens =
        provenance === 'counted' ? (event.usage?.input ?? 0) : Math.ceil(cumulative)

      next.points = [
        ...acc.points,
        {
          nodeId: event.nodeId,
          stepIndex: acc.points.length + 1,
          turnIndex: acc.turnIndex,
          tokens,
          delta: 0,
          output: event.usage?.output ?? 0,
          cacheRead: event.usage?.cacheRead ?? 0,
          timestamp: event.timestamp,
          provenance,
          summary: {
            user: acc.lastUserText,
            input: acc.lastToolTitle,
            response: clip(event.delta ?? event.title ?? ''),
          },
          markers: [],
        },
      ]
      next.cumulativeTokens = cumulative
      next.lastUsageKey = usageKey(event)
    }

    return next
  }, initialScan())

  const points = state.points.map((point, index) => ({
    ...point,
    markers: state.markers.filter((marker) => marker.pointIndex === index),
  }))

  return { points: attachDelta(points), markers: state.markers }
}

/**
 * 构建完整趋势模型。有 usage 走实测路径，无 usage 走字符量启发式推算并标 estimated。
 *
 * @example
 * ```ts
 * const model = buildTrendModel(events, 200000)
 * // { points: [3 个请求点], turnPoints: [2 个回合点], maxTokens: 42000,
 * //   window: 200000, headroomTokens: 158000, headroomRequests: 11, provenance: 'counted' }
 * ```
 */
export const buildTrendModel = (events: TelemetryEvent[], window: number): TrendModel => {
  const provenance: TrendProvenance = events.some(isUsageEvent) ? 'counted' : 'estimated'
  const { points, markers } = scanEvents(events, provenance)
  const headroom = estimateHeadroom(points, window)

  return {
    points,
    turnPoints: aggregateByTurn(points),
    markers,
    maxTokens: Math.max(1, ...points.map((point) => point.tokens)),
    window,
    headroomTokens: headroom.tokens,
    headroomRequests: headroom.requests,
    provenance,
  }
}

/**
 * 纯 SVG 柱几何。total 以底部为基线按窗口体量归一化；delta 以中线为基线，负值向下延伸。
 *
 * @example
 * ```ts
 * buildTrendBars(points, 'delta', { width: 600, height: 80 })
 * // [{ x: 0, y: 40, width: 12, height: 0, point, negative: false }, ...]
 * ```
 */
export const buildTrendBars = (
  points: TrendPoint[],
  mode: TrendMode,
  geometry: TrendGeometry
): TrendBar[] => {
  const { width, height, padding = 8 } = geometry
  const slot = points.length > 0 ? width / points.length : width
  const barWidth = Math.max(2, Math.min(14, slot - 2))
  const isTotal = mode === 'total'
  const peak = isTotal
    ? Math.max(1, ...points.map((point) => point.tokens))
    : Math.max(1, ...points.map((point) => Math.abs(point.delta)))
  const scale = isTotal
    ? (height - padding * 2) / peak
    : (height / 2 - padding) / peak
  const baseline = isTotal ? height - padding : height / 2

  return points.map((point, index) => {
    const value = isTotal ? point.tokens : point.delta
    const barHeight = Math.max(0, Math.abs(value) * scale)
    return {
      x: index * slot + (slot - barWidth) / 2,
      y: isTotal || value >= 0 ? baseline - barHeight : baseline,
      width: barWidth,
      height: barHeight,
      point,
      negative: value < 0,
    }
  })
}
