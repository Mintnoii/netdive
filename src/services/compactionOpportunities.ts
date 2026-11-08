import { sift, sort, sum } from 'radash'
import type { TelemetryEvent, TelemetryGesture } from '../types/telemetry'
import { normalizeObservationOutput } from '../types/telemetry'
import type { MicroCompactorOptions } from './microCompactor'
import {
  isCompactionNeeded,
  compactToolLines,
  formatCompactFoldMarker,
  DEFAULT_HEAD_LINES,
  DEFAULT_TAIL_LINES,
} from './microCompactor'

/**
 * 遥测事件本地微压缩机会契约 (CompactionOpportunity)
 * 记录单条工具调用输出在微压缩算法下的折叠潜力、节省量与保留首尾上下文
 *
 * @example
 * ```json
 * {
 *   "nodeId": "node-101",
 *   "toolName": "Bash: pnpm test",
 *   "gesture": "bash",
 *   "originalLines": 50,
 *   "originalChars": 2500,
 *   "willCompact": true,
 *   "compactedLines": 31,
 *   "compactedChars": 1200,
 *   "reclaimedChars": 1300,
 *   "reclaimedPercent": 52,
 *   "pointerId": "wal-call-1",
 *   "compactSummary": "输出已折叠 20 行",
 *   "headLines": ["Line 1", "Line 2"],
 *   "tailLines": ["Line 49", "Line 50"],
 *   "foldMarker": "[... 原始输出已折叠 20 行，保留前置入参及尾部退出判定 ...]",
 *   "compactedText": "Line 1\n...\nLine 50"
 * }
 * ```
 */
export interface CompactionOpportunity {
  nodeId: string
  toolName: string
  gesture: TelemetryGesture
  originalLines: number
  originalChars: number
  willCompact: boolean
  compactedLines: number
  compactedChars: number
  reclaimedChars: number
  reclaimedPercent: number // 0~100 整数，相对 originalChars
  pointerId?: string // 存在即表示 bridge 已真实折叠并留了 WAL 指针
  compactSummary?: string
  headLines: string[] // 折叠保留下来的头部原文行
  tailLines: string[] // 折叠保留下来的尾部原文行
  foldMarker?: string // 折叠标记行（未触发折叠时为空）
  compactedText: string // 折叠后全文（未触发时等于原文）
}

/**
 * 遥测事件微压缩潜力综合剖析结果契约 (CompactionAnalysis)
 * 汇总多节点扫描量、命中折叠数与整体字符节省指标
 *
 * @example
 * ```json
 * {
 *   "opportunities": [],
 *   "scannedCount": 10,
 *   "hitCount": 2,
 *   "totalRawChars": 5000,
 *   "totalReclaimedChars": 2600
 * }
 * ```
 */
export interface CompactionAnalysis {
  opportunities: CompactionOpportunity[] // 仅包含 willCompact 为 true 且 reclaimedChars > 0 的条目，按 reclaimedChars 降序
  scannedCount: number // 扫描到的带 output 的事件数
  hitCount: number // 命中折叠条件的条目数
  totalRawChars: number // 命中条目的原始字符之和
  totalReclaimedChars: number // 命中条目的释放字符之和
}

/**
 * 纯函数：深度剖析遥测事件流中的潜在微压缩机会 (Zero-Side-Effect Analysis)
 * 纯算法计算，绝不写入任何状态或离线 WAL 注册表
 *
 * @param events 遥测事件序列
 * @param options 微压缩阈值与行数配置选项
 * @returns 压缩潜力剖析汇总报表
 *
 * @example
 * ```ts
 * const report = analyzeCompactionOpportunities(events, {
 *   maxLinesThreshold: 40,
 *   maxCharsThreshold: 1500,
 * })
 * console.log(`扫描 ${report.scannedCount} 个输出，命中 ${report.hitCount} 个可压缩项`)
 * ```
 */
export function analyzeCompactionOpportunities(
  events: TelemetryEvent[],
  options?: MicroCompactorOptions
): CompactionAnalysis {
  if (!events || events.length === 0) {
    return {
      opportunities: [],
      scannedCount: 0,
      hitCount: 0,
      totalRawChars: 0,
      totalReclaimedChars: 0,
    }
  }

  // 1. 过滤掉没有 observation.output 且输出为空的事件
  const candidateEvents = sift(
    events.map((event) => {
      const rawOutput = event.observation?.output
      if (rawOutput === undefined || rawOutput === null) {
        return null
      }
      const normalizedLines = normalizeObservationOutput(rawOutput)
      if (
        normalizedLines.length === 0 ||
        (normalizedLines.length === 1 && normalizedLines[0] === '')
      ) {
        return null
      }
      return {
        event,
        normalizedLines,
      }
    })
  )

  const headCount = options?.headLinesCount ?? DEFAULT_HEAD_LINES
  const tailCount = options?.tailLinesCount ?? DEFAULT_TAIL_LINES
  const minLinesToFold = headCount + tailCount

  // 2. 判定并提取命中条目
  const rawOpportunities = sift(
    candidateEvents.map(({ event, normalizedLines }): CompactionOpportunity | null => {
      const willCompact = isCompactionNeeded(normalizedLines, options)
      if (!willCompact) {
        return null
      }

      const compaction = compactToolLines(normalizedLines, options)
      const originalLines = compaction.originalLines
      const originalChars = compaction.originalChars
      const compactedLines = compaction.compactedLines
      const compactedChars = compaction.compactedChars
      const reclaimedChars = Math.max(0, originalChars - compactedChars)

      if (!compaction.compacted || reclaimedChars <= 0) {
        return null
      }

      const reclaimedPercent =
        originalChars > 0 ? Math.round((reclaimedChars / originalChars) * 100) : 0

      const canSliceHeadTail = normalizedLines.length > minLinesToFold
      const headLines = canSliceHeadTail ? normalizedLines.slice(0, headCount) : []
      const tailLines = canSliceHeadTail ? normalizedLines.slice(-tailCount) : []
      const foldMarker = canSliceHeadTail
        ? formatCompactFoldMarker(compaction.foldedLinesCount)
        : undefined

      const toolName = (event.title || 'tool').slice(0, 80)
      const gesture = event.gesture ?? 'bash'

      return {
        nodeId: event.nodeId,
        toolName,
        gesture,
        originalLines,
        originalChars,
        willCompact: true,
        compactedLines,
        compactedChars,
        reclaimedChars,
        reclaimedPercent,
        pointerId: event.observation?.pointerId,
        compactSummary: event.observation?.compactSummary,
        headLines,
        tailLines,
        foldMarker,
        compactedText: compaction.compactedText,
      }
    })
  )

  // 3. 按 reclaimedChars 降序排序
  const sortedOpportunities = sort(
    rawOpportunities,
    (opp) => opp.reclaimedChars,
    true
  )

  // 4. 汇总统计指标
  const scannedCount = candidateEvents.length
  const hitCount = sortedOpportunities.length
  const totalRawChars = sum(sortedOpportunities, (opp) => opp.originalChars)
  const totalReclaimedChars = sum(sortedOpportunities, (opp) => opp.reclaimedChars)

  return {
    opportunities: sortedOpportunities,
    scannedCount,
    hitCount,
    totalRawChars,
    totalReclaimedChars,
  }
}
