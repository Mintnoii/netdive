/**
 * @file src/services/regressionCase.ts
 * @description 失败 trace 转回归用例的纯函数层。用例只冻结证据与基线，不保存完整 payload。
 */
import { sift, unique } from 'radash'
import type { ContextWatermark, TelemetryEvent } from '../types/telemetry'
import { normalizeObservationOutput } from '../types/telemetry'
import {
  buildContextHealthReport,
  resolveFailureKey,
  type ContextHealthReport,
  type PrefixStability,
} from './contextHealthReport'
import type { DemoScenario } from './regressionDemoScenarios'

export interface RegressionEvidence {
  nodeId: string
  title: string
  rule: string
  reason?: string
  command?: string
  outputHead: string[]
  pointerId?: string
}

export interface RegressionExpectation {
  rule: string
  description: string
}

export interface RegressionBaseline {
  peakTokens: number
  utilizationPercent: number
  compactionHits: number
  reclaimedChars: number
  prefixStatus: PrefixStability['status']
  failureTotal: number
  gateCount: number
}

export interface RegressionCase {
  id: string
  taskKey: string
  title: string
  sourceSessionId?: string
  createdAt: number
  evidence: RegressionEvidence[]
  expectations: RegressionExpectation[]
  baseline: RegressionBaseline
  reproPrompt?: string
}

export type RegressionCheckStatus = 'pass' | 'fail' | 'improved' | 'unknown'

export interface RegressionCheck {
  id: string
  label: string
  status: RegressionCheckStatus
  baseline: string
  challenger: string
  detail: string
  evidence: string[]
}

export interface RegressionComparison {
  caseId: string
  checks: RegressionCheck[]
  passedCount: number
  failedCount: number
}

export interface BuildRegressionCaseInput {
  events: TelemetryEvent[]
  watermark: ContextWatermark
  taskKey: string
  title?: string
  sourceSessionId?: string
  id?: string
  createdAt?: number
}

function isFailedEvent(event: TelemetryEvent): boolean {
  return (
    event.assertion?.passed === false ||
    event.status === 'failed' ||
    event.status === 'rejected'
  )
}

function resolveCommand(event: TelemetryEvent): string | undefined {
  const fromObservation = event.observation?.command
  if (typeof fromObservation === 'string' && fromObservation.trim()) return fromObservation
  const fromPayload = event.payload?.command
  return typeof fromPayload === 'string' && fromPayload.trim() ? fromPayload : undefined
}

export function buildEvidence(events: TelemetryEvent[]): RegressionEvidence[] {
  return sift(
    events.map((event) => {
      if (!isFailedEvent(event)) return null
      const rawTitle = event.title || event.nodeId
      const isMachineHash = /^(chatcmpl-|call_|toolu_|msg_|resp_|[0-9a-f]{8}-[0-9a-f]{4})/i.test(rawTitle)
      const title = isMachineHash
        ? (event.observation?.command ? `命令失败: ${event.observation.command}` : '模型响应异常')
        : rawTitle
      return {
        nodeId: event.nodeId,
        title,
        rule: resolveFailureKey(event),
        reason: event.assertion?.reason,
        command: resolveCommand(event),
        outputHead: normalizeObservationOutput(event.observation?.output).slice(0, 5),
        pointerId: event.observation?.pointerId,
      }
    })
  ).slice(0, 5)
}

function buildBaseline(report: ContextHealthReport): RegressionBaseline {
  return {
    peakTokens: report.overview.peakTokens,
    utilizationPercent: report.overview.utilizationPercent,
    compactionHits: report.compaction.hitCount,
    reclaimedChars: report.compaction.totalReclaimedChars,
    prefixStatus: report.prefix.status,
    failureTotal: report.failures.total,
    gateCount: report.gates.length,
  }
}

function formatExpectationDescription(rule: string): string {
  if (rule === 'non_zero_exit') return '命令执行退出码为 0，消灭未捕获异常'
  if (rule.startsWith('failed | ')) {
    const target = rule.replace('failed | ', '')
    return `消除 ${target} 异常，执行恢复顺畅`
  }
  return `消除失败指纹 ${rule}`
}

/**
 * 从回放事件与水位冻结一份回归用例。纯函数，时间由调用方传入。
 *
 * @example
 * ```ts
 * const item = buildRegressionCase({
 *   events, watermark, taskKey: 'ghost-distill', createdAt: 1732000000000
 * })
 * // { id: 'case-...', expectations: [...], baseline: {...} }
 * ```
 */
export function buildRegressionCase(input: BuildRegressionCaseInput): RegressionCase {
  const report = buildContextHealthReport(input.events, input.watermark)
  const createdAt = input.createdAt ?? 0
  const rules = unique(report.failures.groups.map((group) => group.rule))
  const id =
    input.id ??
    (input.sourceSessionId ? `case-${input.sourceSessionId}` : `case-${createdAt.toString(36)}`)

  const item: RegressionCase = {
    id,
    taskKey: input.taskKey.trim() || '未命名任务',
    title: input.title?.trim() || input.taskKey.trim() || '回归用例',
    sourceSessionId: input.sourceSessionId,
    createdAt,
    evidence: buildEvidence(input.events),
    expectations: rules.map((rule) => ({
      rule,
      description: formatExpectationDescription(rule),
    })),
    baseline: buildBaseline(report),
  }

  item.reproPrompt = generateReproPrompt(item)
  return item
}

/**
 * 为「仅针对被治理病灶」动态生成重跑 Prompt：准则与上方已治理病灶一一对应。
 */
export function buildTargetedReproPrompt(input: {
  title: string
  faults: Array<{ type: string; command?: string; cure: string }>
  trackingTag: string
}): string {
  const fingerprintLines = input.faults.length > 0
    ? input.faults.map((f, i) => `- 病灶 0${i + 1} ${f.type}${f.command ? ` ($ ${f.command})` : ''}: ${f.cure}`).join('\n')
    : '（待治理病灶后自动填入指纹 · 请先在下方「检出事故病灶」中点击治理）'
  const criteriaLines = input.faults.length > 0
    ? input.faults.map((f, i) => `- 病灶 0${i + 1} · ${f.type}：${f.cure}`).join('\n')
    : '（待治理病灶后自动填入对应验收准则）'

  return [
    `请针对以下回归测试用例重新执行任务，彻底修复已治理的故障：`,
    '',
    `【任务目标】${input.title}`,
    `【已治理病灶指纹】\n${fingerprintLines}`,
    `【验收通过准则】\n${criteriaLines}\n- 全局：峰值 Token 不超基线，前缀稳定，门禁拦截 = 0`,
    '',
    `<!-- [netdive-case: ${input.trackingTag}] -->`,
  ].join('\n')
}

/**
 * 规范化生成回归用例的唯一追踪标签，供终端重跑自动检索对账
 */
export function resolveCaseTrackingTag(caseItem: RegressionCase): string {
  if (caseItem.taskKey && caseItem.sourceSessionId && caseItem.sourceSessionId !== 'demo-session') {
    return `${caseItem.taskKey}#${caseItem.sourceSessionId.slice(0, 8)}`
  }
  return caseItem.taskKey || caseItem.id
}

/**
 * 为回归用例生成带唯一追踪标签的重跑 Prompt 模版
 */
export function generateReproPrompt(caseItem: RegressionCase): string {
  const failureLines = caseItem.evidence
    .map((e) => `- ${e.title}: ${e.rule}${e.command ? ` ($ ${e.command})` : ''}`)
    .join('\n')
  const expectationLines = caseItem.expectations
    .map((exp) => `- ${exp.description}`)
    .join('\n')
  const tag = resolveCaseTrackingTag(caseItem)

  return [
    `请针对以下回归测试用例重新执行任务，彻底修复已知故障：`,
    '',
    `【任务目标】${caseItem.title}`,
    `【已知故障指纹】\n${failureLines || '- 命令执行异常'}`,
    `【验收通过准则】\n${expectationLines || '- 退出码为 0，故障指纹完全消除'}`,
    '',
    `<!-- [netdive-case: ${tag}] -->`,
  ].join('\n')
}

/**
 * 从文本中提取回归用例标签标识
 */
export function extractCaseTag(text: string): string | null {
  const match = text.match(/<!--\s*\[netdive-case:\s*([^\]]+)\]\s*-->/)
  return match ? match[1].trim() : null
}

/**
 * 用对照会话报告与冻结基线逐项比较。
 */
export function compareRegressionCase(
  caseItem: RegressionCase,
  challenger: ContextHealthReport
): RegressionComparison {
  const checks: RegressionCheck[] = []

  caseItem.expectations.forEach((expectation) => {
    const group = challenger.failures.groups.find((item) => item.rule === expectation.rule)
    checks.push({
      id: `rule:${expectation.rule}`,
      label: `失败指纹 ${expectation.rule}`,
      status: group ? 'fail' : 'pass',
      baseline: '基线存在',
      challenger: group ? `仍出现 ${group.count} 次` : '已消失',
      detail: expectation.description,
      evidence: group?.nodeIds.slice(0, 3) ?? [],
    })
  })

  checks.push({
    id: 'failure-total',
    label: '失败节点总数',
    status: challenger.failures.total === 0 ? (caseItem.baseline.failureTotal > 0 ? 'improved' : 'pass') : 'fail',
    baseline: `${caseItem.baseline.failureTotal} 个`,
    challenger: `${challenger.failures.total} 个`,
    detail: '回归通过要求对照会话没有失败节点。',
    evidence: challenger.failures.groups[0]?.nodeIds.slice(0, 3) ?? [],
  })

  const peakStatus =
    challenger.overview.peakTokens < caseItem.baseline.peakTokens
      ? 'improved'
      : challenger.overview.peakTokens > caseItem.baseline.peakTokens
        ? 'fail'
        : 'pass'
  checks.push({
    id: 'peak-tokens',
    label: '峰值水位',
    status: peakStatus,
    baseline: `${caseItem.baseline.peakTokens}`,
    challenger: `${challenger.overview.peakTokens}`,
    detail: '峰值水位不应高于冻结基线。',
    evidence: [],
  })

  const reclaimStatus =
    challenger.compaction.totalReclaimedChars > caseItem.baseline.reclaimedChars
      ? 'fail'
      : challenger.compaction.totalReclaimedChars < caseItem.baseline.reclaimedChars
        ? 'improved'
        : 'pass'
  checks.push({
    id: 'reclaimed-chars',
    label: '压缩机会回收字符',
    status: reclaimStatus,
    baseline: `${caseItem.baseline.reclaimedChars}`,
    challenger: `${challenger.compaction.totalReclaimedChars}`,
    detail: '回收字符增长说明对照会话产生了更多可压缩输出。',
    evidence: challenger.compaction.topOpportunities[0]
      ? [challenger.compaction.topOpportunities[0].nodeId]
      : [],
  })

  const prefixStatus =
    challenger.prefix.status === 'unknown'
      ? 'unknown'
      : challenger.prefix.status === 'drifted'
        ? 'fail'
        : caseItem.baseline.prefixStatus === 'drifted'
          ? 'improved'
          : 'pass'
  checks.push({
    id: 'prefix-stability',
    label: '前缀稳定性',
    status: prefixStatus,
    baseline: caseItem.baseline.prefixStatus,
    challenger: challenger.prefix.status,
    detail: '固定前缀发生漂移会击穿 Prompt Cache。',
    evidence: challenger.prefix.hashes.slice(0, 2),
  })

  const gateStatus =
    challenger.gates.length > caseItem.baseline.gateCount
      ? 'fail'
      : challenger.gates.length < caseItem.baseline.gateCount
        ? 'improved'
        : 'pass'
  checks.push({
    id: 'gate-count',
    label: '门禁次数',
    status: gateStatus,
    baseline: `${caseItem.baseline.gateCount}`,
    challenger: `${challenger.gates.length}`,
    detail: '门禁次数增长说明引入了更多需要人工裁决的动作。',
    evidence: challenger.gates.slice(0, 3).map((gate) => gate.nodeId),
  })

  return {
    caseId: caseItem.id,
    checks,
    passedCount: checks.filter((item) => item.status === 'pass' || item.status === 'improved').length,
    failedCount: checks.filter((item) => item.status === 'fail').length,
  }
}

/**
 * 导出用例与对照结果为 Markdown。
 */
export function toRegressionMarkdown(
  caseItem: RegressionCase,
  comparison?: RegressionComparison
): string {
  const lines: string[] = [
    `# 回归用例：${caseItem.title}`,
    '',
    `任务标识 ${caseItem.taskKey} · 来源会话 ${caseItem.sourceSessionId || '未记录'}`,
    `基线峰值 ${caseItem.baseline.peakTokens} token · 失败 ${caseItem.baseline.failureTotal} 个 · 门禁 ${caseItem.baseline.gateCount} 次`,
    '',
    '## 冻结证据',
    ...caseItem.evidence.map(
      (item) =>
        `- ${item.nodeId} · ${item.rule} · ${item.command || item.title}${item.pointerId ? ` · ${item.pointerId}` : ''}`
    ),
    '',
    '## 期望',
    ...caseItem.expectations.map((item) => `- ${item.description}`),
  ]

  if (comparison) {
    lines.push('', '## 对照结果', `通过 ${comparison.passedCount} 项，失败 ${comparison.failedCount} 项。`)
    comparison.checks.forEach((check) => {
      lines.push(`- [${check.status}] ${check.label}：${check.baseline} → ${check.challenger}`)
    })
  }

  return lines.join('\n')
}

/**
 * 用例提纯流水线（Trace-to-Eval Pipeline）病灶靶向拆解步骤契约
 */
export interface PipelineStep {
  step: number
  targetFault?: string // 针对的病灶，如 "🎯 针对病灶 01 · L2 循环共振" 或 "📦 全案汇聚"
  name: string
  pill: string
  action: string
  outputSummary: string
  badgeTone: 'rose' | 'amber' | 'blue' | 'purple' | 'emerald'
  beforeLabel?: string
  beforeContent?: string
  afterLabel?: string
  afterContent?: string
  insightTip?: string
}

/**
 * 纯函数：根据当前会话检出的具体事故病灶，动态生成对症治理的提纯流水线步骤
 * 杜绝千篇一律的死板工序，真正做到“查出什么病灶，应用什么治理手段，最后合成考卷”
 */
export function resolvePipelineSteps(
  caseItem: RegressionCase | null,
  evidenceList: RegressionEvidence[],
  scenario?: DemoScenario
): PipelineStep[] {
  // 分支 A：若有场景真源定义，直接解构其针对各病灶的靶向治理手段
  if (scenario && scenario.faults && scenario.faults.length > 0) {
    const faultSteps: PipelineStep[] = scenario.faults.map((flt, idx) => {
      const m = flt.distillMethod
      return {
        step: idx + 1,
        targetFault: `🎯 靶向治理 · 病灶 0${idx + 1} [${flt.type}]`,
        name: m?.name || `针对 ${flt.type} 的特征提取`,
        pill: m?.pill || flt.type,
        action: m?.action || flt.summary,
        outputSummary: m?.outputSummary || `提取针对 ${flt.type} 的回归防线`,
        badgeTone: m?.badgeTone || (flt.badgeTone as any),
        beforeLabel: m?.beforeLabel || '事故现场原始数据',
        beforeContent: m?.beforeContent || flt.detail,
        afterLabel: m?.afterLabel || '对症提纯产物',
        afterContent: m?.afterContent || `生成验收标准：${flt.cureSummary || '消除异常'}`,
        insightTip: m?.insightTip || '针对特定故障场景的靶向提纯，杜绝泛化规则造成的误判。',
      }
    })

    // 追加最终的全案汇聚步骤——把上面各病灶提纯产物汇聚为完整回归用例 JSON
    const aggregatedExpectations = scenario.faults
      .map((f) => f.cureSummary || `消除 ${f.type}`)
      .map((s) => `"${s}"`)
      .join(',\n    ')
    const aggregationStep: PipelineStep = {
      step: faultSteps.length + 1,
      targetFault: '📦 全案汇聚 · 考卷合成',
      name: '三维防退化断言契约合成',
      pill: '防退化考卷',
      action: '把各病灶提纯产物汇聚为带追踪标签、基线指标与三维断言的标准化回归用例',
      outputSummary: `基线 ${caseItem?.baseline.peakTokens ?? scenario.watermark.total} tok · 消除全项已知病灶`,
      badgeTone: 'emerald',
      beforeLabel: '各病灶散落的提纯产物',
      beforeContent: `[
${scenario.faults.map((f, i) => `  {"from":"病灶 0${i + 1}","rule":"${f.type}"}`).join(',\n')}
]`,
      afterLabel: '提纯后 · 完整回归用例 JSON',
      afterContent: `{
  "caseId": "case-${scenario.id}",
  "trackingTag": "${scenario.project}#${scenario.id.slice(-8)}",
  "baseline": {
    "peakTokens": ${caseItem?.baseline.peakTokens ?? scenario.watermark.total},
    "failureTotal": ${scenario.faults.length},
    "prefixStatus": "drifted"
  },
  "expectations": [
    ${aggregatedExpectations}
  ],
  "assertions": {
    "maxPeakTokens": ${caseItem?.baseline.peakTokens ?? scenario.watermark.total},
    "gateCount": 0,
    "prefix": "stable"
  }
}`,
      insightTip: '三维验收防线杜绝了 Agent 靠更大的上下文膨胀或屏蔽报警来伪造及格，保证治愈具备工业级确定性。',
    }

    return [...faultSteps, aggregationStep]
  }

  // 分支 B：本地真实扫描会话（由证据动态识别病灶并对症治理）
  const ev = caseItem?.evidence ?? evidenceList
  const firstEv = ev[0]
  const hasLoop = ev.length >= 2 && (ev[0]?.command === ev[1]?.command || ev[0]?.rule === ev[1]?.rule)
  const pointerCount = ev.filter((item) => Boolean(item.pointerId)).length
  const rawOutputText = firstEv?.outputHead.length
    ? firstEv.outputHead.join('\n')
    : 'Command failed with exit code 1 (pid 8921, path /tmp/build-892/run.ts)'

  const steps: PipelineStep[] = []

  // 1. 若检出执行报错或退出码异常
  steps.push({
    step: 1,
    targetFault: `🎯 靶向治理 · 病灶 01 [${hasLoop ? 'L2 循环共振死锁' : 'L1 物理执行崩溃'}]`,
    name: hasLoop ? '因果 DAG 倒查切片与震荡识别' : '故障分级捕获与直接命令锚定',
    pill: hasLoop ? 'DAG 剪枝' : '命令锚定',
    action: '倒查执行因果树，截取最早暴露异常的 Run 节点与直接调用命令',
    outputSummary: `捕获 ${ev.length} 个异常节点，锁定 ${firstEv?.command ? `$ ${firstEv.command}` : firstEv?.title || '未命名命令'}`,
    badgeTone: 'rose',
    beforeLabel: '会话原始因果链',
    beforeContent: '会话包含数十步杂糅动作（规划、多轮读写与上下文组装），故障点深埋在调用流尾部。',
    afterLabel: '因果倒查切片',
    afterContent: `识别为 ${hasLoop ? 'L2 循环共振' : 'L1 物理执行崩溃'}，倒查截取最早异常节点 [${firstEv?.nodeId || 'node-fail'}] 与触发命令 ${firstEv?.command ? `$ ${firstEv.command}` : firstEv?.title || ''}。`,
    insightTip: '故障暴露点往往不是根因，倒查因果 DAG 能够过滤无关的前置探索噪声，锁定真正破坏环境的决策动作。',
  })

  // 2. 规范化指纹去噪
  steps.push({
    step: 2,
    targetFault: '🎯 靶向治理 · 病灶 02 [环境随机噪声干扰]',
    name: '规范化指纹去噪与签名收敛',
    pill: '正则模板化',
    action: '抹平动态临时路径、进程 PID 与时间戳随机噪声，收敛为统一规则签名',
    outputSummary: `提取唯一指纹: ${firstEv?.rule || 'non_zero_exit'}`,
    badgeTone: 'amber',
    beforeLabel: '去噪前原始报错堆栈',
    beforeContent: rawOutputText,
    afterLabel: '规范化规则签名',
    afterContent: `[${firstEv?.rule || 'non_zero_exit'}]`,
    insightTip: '抹平动态时间戳、易变临时路径（如 /tmp/xxx）与进程 PID，避免环境差异引发假性回归失败。',
  })

  // 3. 若有超长输出
  if (pointerCount > 0 || (firstEv && firstEv.outputHead.length > 5)) {
    steps.push({
      step: steps.length + 1,
      targetFault: '🎯 靶向治理 · 病灶 03 [超长证据载荷膨胀]',
      name: '证据载荷与 WAL 离线指针解耦',
      pill: '冷热分层',
      action: '用例只保留 Head 5 行诊断关键信息，巨型输出卸载为 WAL 离线物理指针',
      outputSummary: pointerCount > 0 ? `绑定 ${pointerCount} 个 WAL 指针，单用例体积 < 5KB` : '输出已做 Head 5 行轻量切片',
      badgeTone: 'blue',
      beforeLabel: '未优化原始 Payload',
      beforeContent: '工具返回的完整 stdout 动辄上万字符，若全量塞入用例库会导致本地存储迅速膨胀。',
      afterLabel: '冷热解耦瘦用例',
      afterContent: `瘦用例只冻结诊断所需的 Head 5 行摘要，完整原文字节卸载至离线存储: [${firstEv?.pointerId || 'wal-demo-pipe-01'}]，单用例 < 5KB。`,
      insightTip: '与上下文演练中的 Micro-Compactor 底层技术同构，实现零拷贝指针引用与冷热数据物理分离。',
    })
  }

  // 4. 全案汇聚
  steps.push({
    step: steps.length + 1,
    targetFault: '📦 全案汇聚 · 考卷合成',
    name: '三维断言契约合成',
    pill: '防退化考卷',
    action: '合成功能指纹消除、Token 资源防膨胀与治理门禁归零 3 类确定性验收指标',
    outputSummary: `基线 Tokens: ${caseItem?.baseline.peakTokens ?? 24000} · 期望消除 ${ev.length} 项指纹`,
    badgeTone: 'emerald',
    beforeLabel: '传统单一及格标准',
    beforeContent: '只看最终答案对不对，容易奖励 Agent 注释掉单测、跳过验证等走捷径投机行为。',
    afterLabel: '三维立体验收断言',
    afterContent: `1. 功能正确: 失败指纹 [${firstEv?.rule || 'non_zero_exit'}] 必须消除\n2. 资源防退化: 峰值 Tokens 不得超过基线 (${caseItem?.baseline.peakTokens ?? 24000} tok)\n3. 过程治理: 人机门禁拦截次数 == 0`,
    insightTip: '三维验收防线杜绝了 Agent 靠更大的上下文膨胀或屏蔽报警来伪造及格。',
  })

  return steps
}

/**
 * 纯函数：针对演示用例构造一份全绿通过且指标显著改善的修复版对账报告 (Challenger Report)
 * 供演示或面试时一键模拟重跑对账，秒级展现全绿对账差异
 */
export function createDemoChallengerReport(caseItem?: RegressionCase): ContextHealthReport {
  const baseTokens = caseItem?.baseline.peakTokens ?? 38400
  // 模拟修复后：Token 降低 63%、没有失败组、前缀稳定、门禁为 0
  const improvedTokens = Math.max(8000, Math.round(baseTokens * 0.37))

  return {
    overview: {
      eventCount: 8,
      turnCount: 2,
      peakTokens: improvedTokens,
      window: 200000,
      headroomTokens: 200000 - improvedTokens,
      utilizationPercent: Math.round((improvedTokens / 200000) * 100),
      provenance: 'counted',
    },
    parts: [
      { kind: 'system', tokens: 3200, percent: 22, itemCount: 1 },
      { kind: 'tools', tokens: 2100, percent: 15, itemCount: 6 },
      { kind: 'results', tokens: 4800, percent: 34, itemCount: 4 },
      { kind: 'chat', tokens: 4100, percent: 29, itemCount: 3 },
    ],
    compaction: {
      scannedCount: 6,
      hitCount: 0,
      totalRawChars: 24000,
      totalReclaimedChars: 0,
      topOpportunities: [],
    },
    prefix: {
      status: 'stable',
      hashCount: 1,
      hashes: ['sha256-demo-prefix-fixed'],
    },
    failures: {
      total: 0,
      groups: [],
    },
    gates: [],
    repeatedCalls: [],
    suggestions: [],
  }
}

