/**
 * NetDive Context Provenance & Volume Governance (M3)
 *
 * 可信度标注与体积治理的纯函数层。事件流是唯一真相源：
 * - provenance 三态（counted / estimated / live）由 parser 与实时流写入，本层不改写；
 * - 正交标注（actualReported / reconstructed）从事件流派生，不在 parser 与 stream 两处重复写同一事实；
 * - 投影只留计数摘要，完整原文在类别展开时按需取，硬上限超限给可读文案，绝不静默截断。
 */
import { sift } from 'radash'
import type {
  ActualUsageReport,
  ContextAnnotation,
  ContextProvenanceView,
  TelemetryEvent,
} from '../types/telemetry'
import { normalizeObservationOutput } from '../types/telemetry'
import { collectActualUsage } from './contextBrowser'

/** 明细投影硬上限。数值参考 dsh-context 的分流策略，按 NetDive 会话规模适配 */
export const CONTEXT_DETAIL_LIMITS = {
  steps: 1500,
  turns: 300,
  events: 400,
  fileOps: 400,
  commands: 400,
  itemsPerPage: 100,
} as const

export interface ProvenanceBadge {
  label: string
  cls: string
  borderCls: string
  dotCls: string
  title: string
}

/** 三态徽标字典，水位条与抽屉共用一份，杜绝多头维护 */
export const PROVENANCE_BADGES: Record<'counted' | 'estimated' | 'live', ProvenanceBadge> = {
  counted: {
    label: '实测 Counted',
    cls: 'bg-emerald-50 text-emerald-700',
    borderCls: 'border-emerald-200',
    dotCls: 'bg-emerald-500',
    title: '来自真实 usage（JSONL 的 message.usage）',
  },
  estimated: {
    label: '估算 Estimated',
    cls: 'bg-amber-50 text-amber-800',
    borderCls: 'border-amber-300',
    dotCls: 'bg-amber-500',
    title: '该会话 JSONL 未记录 usage，Token 按字符量启发式粗估',
  },
  live: {
    label: '实时 Live',
    cls: 'bg-indigo-50 text-indigo-800',
    borderCls: 'border-indigo-300',
    dotCls: 'bg-indigo-500',
    title: '由实时流增量与手势启发式推算，非真实 usage',
  },
}

/** 正交标注徽标字典，与三态同一渲染形状 */
export const ANNOTATION_BADGES: Record<ContextAnnotation, ProvenanceBadge> = {
  actualReported: {
    label: '服务商实际值',
    cls: 'bg-sky-50 text-sky-700',
    borderCls: 'border-sky-200',
    dotCls: 'bg-sky-500',
    title: '事件流含 message.usage，窗口装配值旁可并列对照服务商报告值',
  },
  reconstructed: {
    label: '近似重建',
    cls: 'bg-amber-50 text-amber-700',
    borderCls: 'border-amber-300',
    dotCls: 'bg-amber-500',
    title: '检测到压缩剪枝事件，此前步骤的明细按事件摘要近似重建，非原始装配快照',
  },
}

/** 精简投影，只留计数，绝不带 content / payload；stepCount 为带 usage 的事件数，趋势请求点另按连续相同 usage 折叠 */
export interface ContextProjection {
  eventCount: number
  stepCount: number
  turnCount: number
  fileOpCount: number
  commandCount: number
  contentChars: number
}

export interface DetailWindow {
  visible: number
  hasMore: boolean
  notice: string | null
}

/**
 * 从事件流派生正交标注。实际值可用与服务商标注互不排斥，压缩事件才触发重建标注。
 *
 * @example
 * ```ts
 * // [Input Shape - TelemetryEvent[] 片段]:
 * // [{ nodeId: 'a1', usage: { input: 14000, output: 320 } },
 * //  { nodeId: 'p1', type: 'context_pruned', reclaimedTokens: 4000 }]
 * resolveAnnotations(events)
 * // ['actualReported', 'reconstructed']
 * ```
 */
export const resolveAnnotations = (events: TelemetryEvent[]): ContextAnnotation[] =>
  sift<ContextAnnotation>([
    events.some((event) => (event.usage?.input ?? 0) > 0) && 'actualReported',
    events.some((event) => event.type === 'context_pruned') && 'reconstructed',
  ])

/** 完整可信度视图，带最后一次服务商报告值 */
export const buildProvenanceView = (events: TelemetryEvent[]): ContextProvenanceView => {
  const actual: ActualUsageReport | null = collectActualUsage(events)
  return {
    annotations: resolveAnnotations(events),
    actualReported: actual ?? undefined,
  }
}

/**
 * 该请求之后发生过压缩剪枝，说明它属于压缩前旧步骤，明细只能是事件摘要重建。
 *
 * @example
 * ```ts
 * isStepBeforePrune([{ nodeId: 'a1' }, { nodeId: 'p1', type: 'context_pruned' }], 'a1')
 * // true
 * ```
 */
export const isStepBeforePrune = (events: TelemetryEvent[], nodeId: string): boolean => {
  const index = events.findIndex((event) => event.nodeId === nodeId)
  if (index < 0) return false
  return events.slice(index + 1).some((event) => event.type === 'context_pruned')
}

/** 精简投影，纯计数派生，返回体里没有任何原文 */
export const buildContextProjection = (events: TelemetryEvent[]): ContextProjection => ({
  eventCount: events.length,
  stepCount: events.filter((event) => (event.usage?.input ?? 0) > 0).length,
  turnCount: events.filter((event) => event.actor === 'Human Operator').length,
  fileOpCount: events.filter((event) => event.gesture === 'read' || event.gesture === 'edit').length,
  commandCount: events.filter((event) => event.gesture === 'bash').length,
  contentChars: events.reduce(
    (sum, event) =>
      sum + (event.delta?.length ?? 0) +
      normalizeObservationOutput(event.observation?.output).join('\n').length,
    0
  ),
})

/** 任一维度超限时给可读降级文案，不静默截断 */
export const projectionNotice = (projection: ContextProjection): string | null => {
  const rows: Array<[string, number, number]> = [
    ['步骤', projection.stepCount, CONTEXT_DETAIL_LIMITS.steps],
    ['回合', projection.turnCount, CONTEXT_DETAIL_LIMITS.turns],
    ['事件', projection.eventCount, CONTEXT_DETAIL_LIMITS.events],
    ['文件操作', projection.fileOpCount, CONTEXT_DETAIL_LIMITS.fileOps],
    ['命令', projection.commandCount, CONTEXT_DETAIL_LIMITS.commands],
  ]
  const exceeded = rows.filter(([, count, limit]) => count > limit)
  if (exceeded.length === 0) return null

  return `明细投影上限 ${exceeded
    .map(([name, count, limit]) => `${name} ${count}/${limit}`)
    .join(' · ')}，超出部分按需补载，不静默截断`
}

/**
 * 按页补载的取值窗口。触到硬上限时返回可读提示，UI 必须显示它。
 *
 * @example
 * ```ts
 * resolveDetailWindow(620, 500)
 * // { visible: 400, hasMore: true,
 * //   notice: '已展示上限 400 条，剩余 220 条按需补载，明细不一次性灌入抽屉' }
 * ```
 */
export const resolveDetailWindow = (
  total: number,
  loaded: number,
  limit: number = CONTEXT_DETAIL_LIMITS.events
): DetailWindow => {
  const visible = Math.min(total, loaded, limit)
  return {
    visible,
    hasMore: total > visible,
    notice:
      loaded >= limit && total > limit
        ? `已展示上限 ${limit} 条，剩余 ${total - limit} 条按需补载，明细不一次性灌入抽屉`
        : null,
  }
}
