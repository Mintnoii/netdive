import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ContextWatermark, TelemetryEvent } from '../types/telemetry'
import { BASE_CONTEXT_WATERMARK } from '../types/telemetry'
import {
  buildContextHealthReport,
  toMarkdownReport,
  type ContextHealthReport,
} from './contextHealthReport'

function createEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    nodeId: `node-${Math.random().toString(36).slice(2, 8)}`,
    type: 'node_complete',
    gesture: 'bash',
    status: 'completed',
    ...overrides,
  }
}

function createWatermark(systemContent: string): ContextWatermark {
  return {
    ...BASE_CONTEXT_WATERMARK,
    prompt: {
      tokens: 24000,
      window: 128000,
      parts: [
        {
          kind: 'system',
          tokens: 12000,
          items: [{ name: 'system.md', tokens: 12000, content: systemContent }],
        },
        {
          kind: 'tools',
          tokens: 8000,
          items: [{ name: 'tool_schema', tokens: 8000, content: 'tools-v1' }],
        },
      ],
    },
  }
}

function hasSuggestion(report: ContextHealthReport, id: string): boolean {
  return report.suggestions.some((item) => item.id === id)
}

describe('contextHealthReport Service', () => {
  it('reports an honest empty state without fabricated metrics', () => {
    const report = buildContextHealthReport([], BASE_CONTEXT_WATERMARK)

    assert.equal(report.overview.eventCount, 0)
    assert.equal(report.overview.peakTokens, 0)
    assert.equal(report.overview.utilizationPercent, 0)
    assert.equal(report.prefix.status, 'unknown')
    assert.equal(report.compaction.hitCount, 0)
    assert.equal(hasSuggestion(report, 'compaction-output'), false)
  })

  it('turns oversized tool output into an evidenced compaction suggestion', () => {
    const lines = Array.from({ length: 41 }, (_, idx) => `line-${idx}-${'x'.repeat(40)}`)
    const event = createEvent({
      nodeId: 'node-long-output',
      title: 'Bash: pnpm test',
      observation: { output: lines, pointerId: 'wal-call-7' },
    })

    const report = buildContextHealthReport([event], createWatermark('stable'))

    assert.equal(report.compaction.hitCount, 1)
    assert.ok(report.compaction.totalReclaimedChars > 0)
    const suggestion = report.suggestions.find((item) => item.id === 'compaction-output')
    assert.ok(suggestion)
    assert.equal(suggestion.evidence[0]?.nodeId, 'node-long-output')
    assert.ok(suggestion.evidence.some((item) => item.value === 'wal-call-7'))
  })

  it('detects prefix drift from watermark snapshots', () => {
    const first = createEvent({
      nodeId: 'node-prefix-1',
      watermark: createWatermark('system-v1'),
    })
    const second = createEvent({
      nodeId: 'node-prefix-2',
      watermark: createWatermark('system-v2-timestamp'),
    })

    const report = buildContextHealthReport([first, second], createWatermark('system-v1'))

    assert.equal(report.prefix.status, 'drifted')
    assert.equal(report.prefix.hashCount, 2)
    assert.equal(hasSuggestion(report, 'prefix-drift'), true)
  })

  it('flags repeated failure fingerprints and gate records', () => {
    const failures = [
      createEvent({
        nodeId: 'node-fail-1',
        status: 'failed',
        assertion: { passed: false, triggerSelfCorrection: true, triggerGate: false, severity: 'warn', rule: 'non_zero_exit', failureCount: 1 },
      }),
      createEvent({
        nodeId: 'node-fail-2',
        status: 'failed',
        assertion: { passed: false, triggerSelfCorrection: true, triggerGate: false, severity: 'warn', rule: 'non_zero_exit', failureCount: 2 },
      }),
    ]
    const gate = createEvent({
      nodeId: 'node-gate-1',
      type: 'gate_prompt',
      status: 'gate',
      gatePayload: {
        gateId: 'gate-1',
        title: 'Git 提交门禁',
        demoOnly: false,
        riskLevel: 'high',
        proposedAction: { command: 'git commit', explanation: '高危动作' },
        timestamp: '2026-11-19T00:00:00.000Z',
      },
    })

    const report = buildContextHealthReport([...failures, gate], createWatermark('stable'))

    assert.equal(report.failures.total, 2)
    assert.equal(report.failures.groups[0]?.count, 2)
    assert.equal(report.gates.length, 1)
    assert.equal(hasSuggestion(report, 'repeat-failure'), true)
    assert.equal(hasSuggestion(report, 'gate-review'), true)
  })

  it('serializes a deterministic Markdown report with evidence', () => {
    const event = createEvent({
      nodeId: 'node-evidence',
      title: 'Bash: pnpm build',
      observation: { output: Array.from({ length: 41 }, (_, i) => `build-${i}-${'y'.repeat(40)}`) },
    })

    const report = buildContextHealthReport([event], createWatermark('stable'))
    const markdown = toMarkdownReport(report)

    assert.equal(markdown, toMarkdownReport(report))
    assert.match(markdown, /^# 会话复盘诊断报告/)
    assert.match(markdown, /## 上下文构成/)
    assert.match(markdown, /## 压缩机会/)
    assert.match(markdown, /## 建议清单/)
    assert.match(markdown, /node-evidence/)
  })
})
