/**
 * NetDive Context Browser & Step Link (M2)
 *
 * 图表与上下文浏览器的联动契约，以及内容检视所需的纯函数。
 * 本层只处理指针与摘要，完整原文留在 prompt.parts / WAL，展开时 JIT 取，
 * 绝不把 content 塞进联动状态、node.data 或 React 状态树常驻。
 *
 * 诚实边界：NetDive 事件流没有 DSH 那种 assistant 消息内 Thinking/Tools/Answer
 * 分段标签，也没有图片缩略图与物理尺寸。三段筛选按既有 7-part 分类派生，
 * 文件引用卡只展示事件流里真实出现的文本引用与字符量推算。
 */
import { unique } from 'radash'
import type {
  ContextItem,
  ContextPartKind,
  TelemetryEvent,
} from '../types/telemetry'
import { normalizeObservationOutput } from '../types/telemetry'
import type { TrendPoint } from './contextTrend'

export type StepLinkMode = 'hover' | 'pinned'

/** 严格三字段的联动指针，不含任何原文、payload 或播放器位置 */
export interface StepLink {
  stepIndex: number
  nodeId: string
  mode: StepLinkMode
}

/** 步骤前的事件摘要，只保留定位与尺寸信息 */
export interface StepEventDigest {
  nodeId: string
  title: string
  gesture: string
  chars: number
}

export interface RankedItem {
  item: ContextItem
  index: number
}

export interface FileRef {
  path: string
  ext: string
  chars: number
  tokens: number
}

export interface ActualUsage {
  input: number
  output: number
  cacheRead: number
  nodeId: string
}

export type Outcome = 'ok' | 'error' | 'unknown'
export type ItemSort = 'size' | 'name'
export type ReplySegment = 'thinking' | 'tools' | 'answer'
export type MarkdownLineKind = 'heading' | 'list' | 'code' | 'quote' | 'text'

/** 三段视图按 7-part 分类互斥派生，不冒充 assistant 消息内的原生分段 */
export const REPLY_SEGMENTS: Readonly<
  Record<ReplySegment, { label: string; kinds: ContextPartKind[] }>
> = {
  thinking: { label: '思考与提示', kinds: ['system', 'skills', 'memory'] },
  tools: { label: '工具', kinds: ['tools', 'results', 'files'] },
  answer: { label: '对话', kinds: ['chat'] },
}

const ERROR_MARKERS = ['AssertionError', 'failed', '✖', 'Error:', 'error:']
const OK_MARKERS = ['✓', 'passed', 'OK', 'success']
const FILE_REF_PATTERN = /[\w./\\-]+\.(?:tsx|ts|jsx|js|md|json|png|jpe?g|webp|gif|log|ya?ml)\b/g
const DEFAULT_DIGEST_LIMIT = 6
const DEFAULT_FILE_REF_LIMIT = 6
const CHARS_PER_TOKEN = 4

/**
 * 构造联动指针。契约里只有三个字段，天然无法携带原文或播放器位置。
 *
 * @example
 * ```ts
 * buildStepLink(point, 'hover')
 * // { stepIndex: 3, nodeId: 'a3', mode: 'hover' }
 * ```
 */
export const buildStepLink = (point: TrendPoint, mode: StepLinkMode): StepLink => ({
  stepIndex: point.stepIndex,
  nodeId: point.nodeId,
  mode,
})

/**
 * 取该请求之前的事件摘要，用于 hover 预览「本轮新加入了什么」。
 * 返回体不含 content / payload，完整原文在浮层展开时才按需取。
 *
 * @example
 * ```ts
 * resolveStepEvents(events, point)
 * // [{ nodeId: 't1', title: '$ pnpm test', gesture: 'bash', chars: 240 }]
 * ```
 */
export const resolveStepEvents = (
  events: TelemetryEvent[],
  point: TrendPoint,
  limit = DEFAULT_DIGEST_LIMIT
): StepEventDigest[] => {
  const index = events.findIndex((event) => event.nodeId === point.nodeId)
  if (index < 0) return []

  return events.slice(Math.max(0, index - limit), index).map((event) => ({
    nodeId: event.nodeId,
    title: event.title ?? '未命名事件',
    gesture: event.gesture ?? 'unknown',
    chars:
      (event.delta?.length ?? 0) +
      normalizeObservationOutput(event.observation?.output).join('\n').length,
  }))
}

/** 取事件流里最后一次服务商报告的 usage，供估算值并列对照 */
export const collectActualUsage = (events: TelemetryEvent[]): ActualUsage | null => {
  const last = events.filter((event) => (event.usage?.input ?? 0) > 0).at(-1)
  if (!last?.usage) return null

  return {
    input: last.usage.input ?? 0,
    output: last.usage.output ?? 0,
    cacheRead: last.usage.cacheRead ?? 0,
    nodeId: last.nodeId,
  }
}

/** 较上一请求的净变化，首个请求没有前序 */
export const compareWithPrevious = (
  points: TrendPoint[],
  activeIndex: number
): { tokenDelta: number; eventCount: number; hasPrevious: boolean } => ({
  tokenDelta: points[activeIndex]?.delta ?? 0,
  eventCount: Math.max(0, activeIndex),
  hasPrevious: activeIndex > 0,
})

/** 每类独立搜索与排序，返回结果保留原索引供浮层展开态复用 */
export const searchAndSortItems = (
  items: ContextItem[],
  query: string,
  sortBy: ItemSort
): RankedItem[] => {
  const needle = query.trim().toLowerCase()
  const ranked = items.map((item, index) => ({ item, index }))
  const matched = needle
    ? ranked.filter(({ item }) =>
        `${item.name} ${item.tag ?? ''}`.toLowerCase().includes(needle)
      )
    : ranked

  return [...matched].sort((a, b) =>
    sortBy === 'size'
      ? b.item.tokens - a.item.tokens
      : a.item.name.localeCompare(b.item.name)
  )
}

/** 三段筛选，点空段返回全部 7 类 */
export const segmentKinds = (segment: ReplySegment | null): ContextPartKind[] =>
  segment ? REPLY_SEGMENTS[segment].kinds : []

/** 条目来源芯片，取自 JSONL 里真实记录的 tag，不造插件命名空间 */
export const sourceChipOf = (item: ContextItem): string => item.tag?.trim() || '未标注来源'

/** 工具结果成败判定，基于输出里真实存在的标记，未命中时返回 unknown */
export const detectOutcome = (content?: string): Outcome => {
  if (!content) return 'unknown'
  if (ERROR_MARKERS.some((marker) => content.includes(marker))) return 'error'
  if (OK_MARKERS.some((marker) => content.includes(marker))) return 'ok'
  return 'unknown'
}

/** 从条目原文里识别文件引用，尺寸与 token 均为按字符量推算 */
export const detectFileRefs = (
  content?: string,
  limit = DEFAULT_FILE_REF_LIMIT
): FileRef[] => {
  if (!content) return []
  const matches = content.match(FILE_REF_PATTERN) ?? []

  return unique(matches)
    .slice(0, limit)
    .map((path) => {
      const ext = path.slice(path.lastIndexOf('.') + 1)
      return {
        path,
        ext,
        chars: content.length,
        tokens: Math.ceil(content.length / CHARS_PER_TOKEN),
      }
    })
}

/** Markdown 行级分类，纯声明式，不引第三方渲染库 */
export const classifyMarkdownLines = (
  content: string
): Array<{ text: string; kind: MarkdownLineKind }> => {
  let inCodeBlock = false

  return content.split('\n').map((text) => {
    if (text.startsWith('```')) {
      inCodeBlock = !inCodeBlock
      return { text, kind: 'code' as MarkdownLineKind }
    }
    if (inCodeBlock) return { text, kind: 'code' as MarkdownLineKind }
    if (/^#{1,6}\s/.test(text)) return { text, kind: 'heading' as MarkdownLineKind }
    if (/^\s*[-*+]\s/.test(text) || /^\s*\d+\.\s/.test(text)) {
      return { text, kind: 'list' as MarkdownLineKind }
    }
    if (text.startsWith('>')) return { text, kind: 'quote' as MarkdownLineKind }
    return { text, kind: 'text' as MarkdownLineKind }
  })
}

/** 行数，供浮层工具栏显示 */
export const countLines = (content?: string): number =>
  content ? content.split('\n').length : 0
