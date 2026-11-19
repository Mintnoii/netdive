/**
 * @file src/services/contextHealthReport.ts
 * @description 会话复盘诊断报告纯函数层。所有结论来自事件流与水位快照，零副作用、零模型调用。
 *
 * 契约：
 * 1. buildContextHealthReport 是唯一报告构造器，组件只负责渲染；
 * 2. 每条建议必须携带至少一个证据指针，禁止无证据的泛泛而谈；
 * 3. Markdown 序列化与抽屉渲染共用同一份报告对象。
 */
import { group, sift, sort, sum, unique } from 'radash'
import type { ContextPartKind, ContextWatermark, TelemetryEvent } from '../types/telemetry'
import { formatTokens } from '../types/telemetry'
import { analyzeCompactionOpportunities, type CompactionOpportunity } from './compactionOpportunities'
import { buildTrendModel, type TrendProvenance } from './contextTrend'
import { aggregateConsecutiveToolEvents } from './transcriptParser'
import { computePrefixHash } from './microCompactor'
import { FALLBACK_CONTEXT_WINDOW } from './modelWindows'

export type ReportSeverity = 'high' | 'medium' | 'low' | 'info'

export interface ReportEvidence {
  nodeId?: string
  label: string
  value?: string
}

export interface ReportSuggestion {
  id: string
  severity: ReportSeverity
  title: string
  detail: string
  action: string
  evidence: ReportEvidence[]
  metrics?: Record<string, number | string>
}

export interface ReportPart {
  kind: ContextPartKind
  tokens: number
  percent: number
  itemCount: number
  topItem?: string
}

export interface PrefixStability {
  status: 'stable' | 'drifted' | 'unknown'
  hashCount: number
  hashes: string[]
}

export interface FailureGroup {
  rule: string
  count: number
  nodeIds: string[]
  reason?: string
}

export interface GateRecord {
  nodeId: string
  title?: string
  riskLevel?: string
}

export interface RepeatedCallGroup {
  key: string
  count: number
  nodeId: string
}

export interface ContextHealthReport {
  overview: {
    eventCount: number
    turnCount: number
    peakTokens: number
    window: number
    headroomTokens: number
    utilizationPercent: number
    provenance: TrendProvenance
  }
  parts: ReportPart[]
  compaction: {
    scannedCount: number
    hitCount: number
    totalRawChars: number
    totalReclaimedChars: number
    topOpportunities: CompactionOpportunity[]
  }
  prefix: PrefixStability
  failures: {
    total: number
    groups: FailureGroup[]
  }
  gates: GateRecord[]
  repeatedCalls: RepeatedCallGroup[]
  suggestions: ReportSuggestion[]
}

const PART_KINDS: ContextPartKind[] = [
  'system',
  'tools',
  'skills',
  'memory',
  'files',
  'results',
  'chat',
]

const PREFIX_KINDS: ContextPartKind[] = ['system', 'tools', 'memory']

const SEVERITY_ORDER: Record<ReportSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
  info: 3,
}

function resolveWindow(watermark: ContextWatermark): number {
  return Math.max(
    1,
    watermark.prompt?.window || watermark.totalLimit || FALLBACK_CONTEXT_WINDOW
  )
}

function buildParts(watermark: ContextWatermark): ReportPart[] {
  const parts = watermark.prompt?.parts ?? []
  const promptTokens = Math.max(
    1,
    watermark.prompt?.tokens || sum(parts, (part) => part.tokens) || 1
  )

  return PART_KINDS.map((kind) => {
    const part = parts.find((item) => item.kind === kind)
    const topItem = sort(part?.items ?? [], (item) => item.tokens, true)[0]
    return {
      kind,
      tokens: part?.tokens ?? 0,
      percent: Math.round(((part?.tokens ?? 0) / promptTokens) * 100),
      itemCount: part?.items?.length ?? 0,
      topItem: topItem?.name,
    }
  })
}

function canonicalPrefix(event: TelemetryEvent): string {
  const parts = event.watermark?.prompt?.parts ?? []
  return PREFIX_KINDS.flatMap((kind) =>
    parts
      .filter((part) => part.kind === kind)
      .flatMap((part) =>
        part.items.map(
          (item) => `${kind}:${item.name}:${item.tokens}:${item.content ?? ''}`
        )
      )
  ).join('\n')
}

function buildPrefixStability(events: TelemetryEvent[]): PrefixStability {
  const hashes = unique(
    sift(events.map((event) => (event.watermark?.prompt ? computePrefixHash(canonicalPrefix(event)) : null)))
  )
  return {
    status: hashes.length === 0 ? 'unknown' : hashes.length === 1 ? 'stable' : 'drifted',
    hashCount: hashes.length,
    hashes,
  }
}

function buildFailures(events: TelemetryEvent[]): { total: number; groups: FailureGroup[] } {
  const failed = sift(
    events.filter(
      (event) =>
        event.assertion?.passed === false ||
        event.status === 'failed' ||
        event.status === 'rejected'
    )
  )
  const grouped = group(
    failed,
    (event) => event.assertion?.rule || event.assertion?.reason || event.status || 'unknown'
  )
  const groups = sort(
    Object.entries(grouped).map(([rule, items]) => ({
      rule,
      count: items?.length ?? 0,
      nodeIds: (items ?? []).map((item) => item.nodeId),
      reason: items?.[0]?.assertion?.reason,
    })),
    (item) => item.count,
    true
  )
  return { total: failed.length, groups }
}

function buildGates(events: TelemetryEvent[]): GateRecord[] {
  const gateEvents = unique(
    sift(
      events.map((event) =>
        event.gatePayload || event.type === 'gate_prompt' || event.status === 'gate'
          ? event
          : null
      )
    ),
    (event) => event.nodeId
  )
  return gateEvents.map((event) => ({
    nodeId: event.nodeId,
    title: event.gatePayload?.title || event.title,
    riskLevel: event.gatePayload?.riskLevel,
  }))
}

function buildRepeatedCalls(events: TelemetryEvent[]): RepeatedCallGroup[] {
  return sift(
    aggregateConsecutiveToolEvents(events).map((event) =>
      event.isAggregated && (event.aggregateCount ?? 1) >= 2
        ? {
            key: event.title || event.nodeId,
            count: event.aggregateCount ?? 2,
            nodeId: event.nodeId,
          }
        : null
    )
  )
}

function buildSuggestions(
  report: Omit<ContextHealthReport, 'suggestions'>
): ReportSuggestion[] {
  const suggestions: ReportSuggestion[] = []
  const { overview, compaction, prefix, failures, gates, repeatedCalls } = report

  const topOpportunity = compaction.topOpportunities[0]
  if (topOpportunity) {
    suggestions.push({
      id: 'compaction-output',
      severity: compaction.totalReclaimedChars >= 3000 ? 'high' : 'medium',
      title: '长工具输出值得先折叠',
      detail: `命中 ${compaction.hitCount} 处压缩阈值，预计回收 ${formatTokens(compaction.totalReclaimedChars)} 字符。`,
      action: '把完整输出写入文件，只回传首尾关键行和退出码；命中项优先处理。',
      evidence: [
        { nodeId: topOpportunity.nodeId, label: topOpportunity.toolName, value: `${topOpportunity.reclaimedChars} 字符` },
        ...(topOpportunity.pointerId ? [{ label: 'WAL 指针', value: topOpportunity.pointerId }] : []),
      ],
      metrics: { hitCount: compaction.hitCount, reclaimedChars: compaction.totalReclaimedChars },
    })
  }

  if (overview.utilizationPercent >= 65) {
    suggestions.push({
      id: 'context-budget',
      severity: overview.utilizationPercent >= 85 ? 'high' : 'medium',
      title: '上下文峰值接近窗口上限',
      detail: `峰值 ${formatTokens(overview.peakTokens)}，窗口 ${formatTokens(overview.window)}，占用 ${overview.utilizationPercent}%。`,
      action: '在子任务完成的安全边界做一次历史打包精简，避免把固定前置骨架一起裁掉。',
      evidence: [{ label: '水位来源', value: overview.provenance }],
      metrics: { peakTokens: overview.peakTokens, window: overview.window },
    })
  }

  if (overview.provenance === 'estimated') {
    suggestions.push({
      id: 'usage-confidence',
      severity: 'info',
      title: '水位来自推算而非实测',
      detail: '这条会话没有真实 usage，峰值由字符量启发式推算。',
      action: '接入宿主 usage 上报后再做容量决策，当前数值只用于相对比较。',
      evidence: [{ label: '数据来源', value: 'estimated' }],
    })
  }

  if (prefix.status === 'drifted') {
    suggestions.push({
      id: 'prefix-drift',
      severity: 'high',
      title: '固定前缀发生了漂移',
      detail: `检测到 ${prefix.hashCount} 个不同的前缀哈希，Prompt Cache 会被击穿。`,
      action: '把时间戳、随机 ID 和进度文案移出 System Prompt，只放在动态工作区。',
      evidence: prefix.hashes.slice(0, 2).map((hash) => ({ label: '前缀哈希', value: hash })),
      metrics: { hashCount: prefix.hashCount },
    })
  } else if (prefix.status === 'unknown') {
    suggestions.push({
      id: 'prefix-unknown',
      severity: 'low',
      title: '缺少前缀快照，无法判定缓存稳定性',
      detail: '事件流中没有携带 watermark.prompt 的快照。',
      action: '让解析器保留每步上下文装配快照，下一次回放即可判定。',
      evidence: [{ label: '快照数量', value: '0' }],
    })
  }

  const repeatedFailure = failures.groups.find((item) => item.count >= 2)
  if (repeatedFailure) {
    suggestions.push({
      id: 'repeat-failure',
      severity: 'high',
      title: '同一失败反复出现',
      detail: `规则 ${repeatedFailure.rule} 命中 ${repeatedFailure.count} 次，应当触发共振熔断。`,
      action: '先修根因再重跑，避免继续用同一条错误指纹消耗 token。',
      evidence: repeatedFailure.nodeIds.slice(0, 3).map((nodeId) => ({ nodeId, label: repeatedFailure.rule })),
      metrics: { count: repeatedFailure.count },
    })
  } else if (failures.groups.length > 0) {
    const first = failures.groups[0]
    suggestions.push({
      id: 'failure-review',
      severity: 'medium',
      title: '存在失败节点未形成自愈闭环',
      detail: `共 ${failures.total} 个失败节点，集中在 ${first.rule}。`,
      action: '确认补丁通过后是否有回归节点连回主干。',
      evidence: first.nodeIds.slice(0, 2).map((nodeId) => ({ nodeId, label: first.rule })),
      metrics: { total: failures.total },
    })
  }

  if (gates.length > 0) {
    suggestions.push({
      id: 'gate-review',
      severity: 'medium',
      title: '本次会话包含高危审批',
      detail: `共 ${gates.length} 次门禁请求，审批窗口已保留命令与裁决结果。`,
      action: '把裁决记录导出留档，后台 Agent 场景尤其需要复核。',
      evidence: gates.slice(0, 3).map((gate) => ({ nodeId: gate.nodeId, label: gate.title || '决策门禁' })),
      metrics: { count: gates.length },
    })
  }

  const repeatedCall = repeatedCalls.find((item) => item.count >= 3)
  if (repeatedCall) {
    suggestions.push({
      id: 'repeated-call',
      severity: 'medium',
      title: '连续同构调用可以合并',
      detail: `${repeatedCall.key} 连续执行 ${repeatedCall.count} 次，重复携带 Tool Schema。`,
      action: '合并成一次批量调用，或在参数里一次传入多个目标。',
      evidence: [{ nodeId: repeatedCall.nodeId, label: repeatedCall.key }],
      metrics: { count: repeatedCall.count },
    })
  }

  return sort(suggestions, (item) => SEVERITY_ORDER[item.severity])
}

/**
 * 从事件流与水位生成结构化复盘诊断报告。
 *
 * @example
 * ```ts
 * const report = buildContextHealthReport(events, watermark)
 * // { overview: {...}, parts: [...], suggestions: [{ id: 'compaction-output', ... }] }
 * ```
 */
export function buildContextHealthReport(
  events: TelemetryEvent[],
  watermark: ContextWatermark,
  options?: { maxOpportunities?: number }
): ContextHealthReport {
  const window = resolveWindow(watermark)
  const trend = events.length > 0 ? buildTrendModel(events, window) : null
  const peakTokens = Math.max(
    trend?.maxTokens ?? 0,
    watermark.prompt?.tokens ?? 0,
    watermark.total ?? 0
  )
  const compaction = analyzeCompactionOpportunities(events)
  const prefix = buildPrefixStability(events)
  const failures = buildFailures(events)
  const gates = buildGates(events)
  const repeatedCalls = buildRepeatedCalls(events)

  const base: Omit<ContextHealthReport, 'suggestions'> = {
    overview: {
      eventCount: events.length,
      turnCount: trend?.turnPoints.length ?? 0,
      peakTokens,
      window,
      headroomTokens: trend?.headroomTokens ?? window,
      utilizationPercent: peakTokens === 0 ? 0 : Math.round((peakTokens / window) * 100),
      provenance: trend?.provenance ?? 'estimated',
    },
    parts: buildParts(watermark),
    compaction: {
      scannedCount: compaction.scannedCount,
      hitCount: compaction.hitCount,
      totalRawChars: compaction.totalRawChars,
      totalReclaimedChars: compaction.totalReclaimedChars,
      topOpportunities: compaction.opportunities.slice(0, options?.maxOpportunities ?? 5),
    },
    prefix,
    failures,
    gates,
    repeatedCalls,
  }

  return { ...base, suggestions: buildSuggestions(base) }
}

/**
 * 把报告序列化为确定性 Markdown。相同报告输入必然得到相同文本。
 */
export function toMarkdownReport(report: ContextHealthReport): string {
  const lines: string[] = [
    '# 会话复盘诊断报告',
    '',
    `峰值水位 ${formatTokens(report.overview.peakTokens)} / ${formatTokens(report.overview.window)}，占用 ${report.overview.utilizationPercent}%，数据来源 ${report.overview.provenance}。`,
    `事件 ${report.overview.eventCount} 条，回合 ${report.overview.turnCount} 个，剩余空间 ${formatTokens(report.overview.headroomTokens)}。`,
    '',
    '## 上下文构成',
    ...report.parts.map(
      (part) => `- ${part.kind}：${part.percent}% (${formatTokens(part.tokens)}${part.topItem ? `，最大项 ${part.topItem}` : ''})`
    ),
    '',
    '## 压缩机会',
    `扫描 ${report.compaction.scannedCount} 项，命中 ${report.compaction.hitCount} 项，预计回收 ${formatTokens(report.compaction.totalReclaimedChars)} 字符。`,
    ...report.compaction.topOpportunities.map(
      (opp) => `- ${opp.nodeId} ${opp.toolName}：回收 ${opp.reclaimedChars} 字符${opp.pointerId ? `，指针 ${opp.pointerId}` : ''}`
    ),
    '',
    '## 前缀稳定性',
    `${report.prefix.status}，快照哈希 ${report.prefix.hashCount} 个。`,
    '',
    '## 失败与门禁',
    `失败节点 ${report.failures.total} 个，门禁 ${report.gates.length} 次。`,
    ...report.failures.groups.map((item) => `- ${item.rule}：${item.count} 次 (${item.nodeIds.slice(0, 3).join(', ')})`),
    '',
    '## 建议清单',
    ...report.suggestions.map(
      (item, index) =>
        `${index + 1}. [${item.severity}] ${item.title}\n   ${item.detail}\n   动作 ${item.action}\n   证据 ${item.evidence.map((e) => e.nodeId || e.value).filter(Boolean).join(', ')}`
    ),
  ]
  return lines.join('\n')
}
