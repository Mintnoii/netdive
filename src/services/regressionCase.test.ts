import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AssertionResult, ContextWatermark, TelemetryEvent } from '../types/telemetry'
import { BASE_CONTEXT_WATERMARK } from '../types/telemetry'
import { buildContextHealthReport } from './contextHealthReport'
import {
  buildRegressionCase,
  compareRegressionCase,
  toRegressionMarkdown,
  resolvePipelineSteps,
  createDemoChallengerReport,
} from './regressionCase'
import { DEFAULT_SEED_CASE } from './regressionCaseStore'

function createEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    nodeId: `node-${Math.random().toString(36).slice(2, 8)}`,
    type: 'node_complete',
    gesture: 'bash',
    status: 'completed',
    ...overrides,
  }
}

const watermark: ContextWatermark = {
  ...BASE_CONTEXT_WATERMARK,
  prompt: {
    tokens: 24000,
    window: 128000,
    parts: [
      { kind: 'system', tokens: 12000, items: [{ name: 'system.md', tokens: 12000, content: 'v1' }] },
    ],
  },
}

const failureAssertion: AssertionResult = {
  passed: false,
  triggerSelfCorrection: true,
  triggerGate: false,
  severity: 'warn',
  rule: 'non_zero_exit',
  failureCount: 1,
}

const failedEvent = createEvent({
  nodeId: 'node-fail-baseline',
  title: 'Bash: pnpm test',
  status: 'failed',
  assertion: failureAssertion,
  observation: {
    command: 'pnpm test',
    output: ['FAIL test/a.test.ts', 'expected 1 got 2'],
    pointerId: 'wal-call-9',
  },
})

describe('regressionCase Service', () => {
  it('freezes failure evidence and baseline metrics into a case', () => {
    const item = buildRegressionCase({
      events: [failedEvent],
      watermark,
      taskKey: 'ghost-distill',
      sourceSessionId: 'session-base',
      createdAt: 1732000000000,
    })

    assert.equal(item.taskKey, 'ghost-distill')
    assert.equal(item.sourceSessionId, 'session-base')
    assert.equal(item.evidence[0]?.nodeId, 'node-fail-baseline')
    assert.equal(item.evidence[0]?.rule, 'non_zero_exit')
    assert.equal(item.evidence[0]?.command, 'pnpm test')
    assert.equal(item.evidence[0]?.pointerId, 'wal-call-9')
    assert.deepEqual(item.expectations.map((e) => e.rule), ['non_zero_exit'])
    assert.equal(item.baseline.failureTotal, 1)
  })

  it('passes when the frozen failure disappears in the challenger', () => {
    const item = buildRegressionCase({
      events: [failedEvent],
      watermark,
      taskKey: 'ghost-distill',
      createdAt: 1,
    })
    const challenger = buildContextHealthReport([createEvent()], watermark)
    const comparison = compareRegressionCase(item, challenger)

    const ruleCheck = comparison.checks.find((check) => check.id === 'rule:non_zero_exit')
    assert.equal(ruleCheck?.status, 'pass')
    assert.equal(ruleCheck?.challenger, '已消失')
    assert.equal(comparison.checks.find((check) => check.id === 'failure-total')?.status, 'improved')
    assert.equal(comparison.failedCount, 0)
  })

  it('fails when the same failure fingerprint returns', () => {
    const item = buildRegressionCase({
      events: [failedEvent],
      watermark,
      taskKey: 'ghost-distill',
      createdAt: 1,
    })
    const repeat = createEvent({
      nodeId: 'node-fail-challenger',
      status: 'failed',
      assertion: { ...failureAssertion, failureCount: 2 },
    })
    const challenger = buildContextHealthReport([repeat], watermark)
    const comparison = compareRegressionCase(item, challenger)

    const ruleCheck = comparison.checks.find((check) => check.id === 'rule:non_zero_exit')
    assert.equal(ruleCheck?.status, 'fail')
    assert.deepEqual(ruleCheck?.evidence, ['node-fail-challenger'])
    assert.ok(comparison.failedCount >= 2)
  })

  it('serializes case and comparison into deterministic Markdown', () => {
    const item = buildRegressionCase({
      events: [failedEvent],
      watermark,
      taskKey: 'ghost-distill',
      createdAt: 1,
    })
    const challenger = buildContextHealthReport([createEvent()], watermark)
    const markdown = toRegressionMarkdown(item, compareRegressionCase(item, challenger))

    assert.equal(markdown, toRegressionMarkdown(item, compareRegressionCase(item, challenger)))
    assert.match(markdown, /^# 回归用例/)
    assert.match(markdown, /## 冻结证据/)
    assert.match(markdown, /## 期望/)
    assert.match(markdown, /## 对照结果/)
    assert.match(markdown, /node-fail-baseline/)
  })

  it('resolves targeted pipeline steps dynamically from case, evidence, and scenario', () => {
    const steps = resolvePipelineSteps(DEFAULT_SEED_CASE, DEFAULT_SEED_CASE.evidence)
    assert.equal(steps.length, 4)
    assert.equal(steps[0].step, 1)
    assert.match(steps[0].name, /因果 DAG|故障分级/)
    assert.equal(steps[1].step, 2)
    assert.match(steps[1].name, /指纹去噪/)
    assert.equal(steps[2].step, 3)
    assert.match(steps[2].name, /证据载荷|WAL/)
    assert.equal(steps[3].step, 4)
    assert.match(steps[3].name, /三维.*断言/)
    assert.ok(steps[0].targetFault)
  })

  it('createDemoChallengerReport generates a clean fix report that passes all expectations', () => {
    const challenger = createDemoChallengerReport(DEFAULT_SEED_CASE)
    const comparison = compareRegressionCase(DEFAULT_SEED_CASE, challenger)
    assert.equal(comparison.failedCount, 0)
    assert.ok(comparison.passedCount >= 4)
    const peakCheck = comparison.checks.find((c) => c.id === 'peak-tokens')
    assert.equal(peakCheck?.status, 'improved')
    const failureCheck = comparison.checks.find((c) => c.id === 'failure-total')
    assert.equal(failureCheck?.status, 'improved')
  })
})
