import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { TelemetryEvent } from '../types/telemetry'
import { microCompactor } from './microCompactor'
import { analyzeCompactionOpportunities } from './compactionOpportunities'

/**
 * 契约安全工厂函数：构造符合 TelemetryEvent 契约的测试遥测事件
 * 零类型断言绕过，纯强类型工厂构造
 */
function createTestEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  const defaultEvent: TelemetryEvent = {
    nodeId: `node-${Math.random().toString(36).slice(2, 8)}`,
    type: 'node_complete',
    gesture: 'bash',
    title: 'Bash: runner command',
    status: 'completed',
  }
  return {
    ...defaultEvent,
    ...overrides,
  }
}

describe('compactionOpportunities Service', () => {
  // 用例 1: 边界 40 行、1500 字符的输出不命中
  it('does not hit compaction opportunities on boundary 40 lines and 1500 characters', () => {
    // 构造恰好 40 行、包含 39 个换行符且总长度恰好 1500 字符的输出
    // 1500 - 39 = 1461 字符: 21 行 37 字符 + 19 行 36 字符
    const lines37 = Array.from({ length: 21 }, () => 'x'.repeat(37))
    const lines36 = Array.from({ length: 19 }, () => 'y'.repeat(36))
    const boundaryLines = [...lines37, ...lines36]
    const rawText = boundaryLines.join('\n')

    assert.equal(boundaryLines.length, 40)
    assert.equal(rawText.length, 1500)

    const event = createTestEvent({
      observation: { output: boundaryLines },
    })

    const analysis = analyzeCompactionOpportunities([event])
    assert.equal(analysis.scannedCount, 1)
    assert.equal(analysis.hitCount, 0)
    assert.equal(analysis.opportunities.length, 0)
    assert.equal(analysis.totalRawChars, 0)
    assert.equal(analysis.totalReclaimedChars, 0)
  })

  // 用例 2: 41 行与 1501 字符的输出命中，且保留首尾与折叠标记
  it('hits compaction opportunities on 41 lines and 1501 chars with preserved head/tail lines and fold marker', () => {
    // 构造恰好 41 行、包含 40 个换行符且总长度恰好 1501 字符的输出
    // 1501 - 40 = 1461 字符: 26 行 36 字符 + 15 行 35 字符
    const lines36 = Array.from({ length: 26 }, () => 'a'.repeat(36))
    const lines35 = Array.from({ length: 15 }, () => 'b'.repeat(35))
    const lines = [...lines36, ...lines35]
    const rawText = lines.join('\n')

    assert.equal(lines.length, 41)
    assert.equal(rawText.length, 1501)

    const event = createTestEvent({
      observation: { output: lines },
    })

    const analysis = analyzeCompactionOpportunities([event])
    assert.equal(analysis.scannedCount, 1)
    assert.equal(analysis.hitCount, 1)
    assert.equal(analysis.opportunities.length, 1)

    const opp = analysis.opportunities[0]
    assert.ok(opp)
    assert.equal(opp.willCompact, true)
    assert.ok(opp.headLines.length <= 15)
    assert.ok(opp.tailLines.length <= 15)
    assert.equal(opp.headLines.length, 15)
    assert.equal(opp.tailLines.length, 15)
    assert.ok(opp.foldMarker)
    assert.match(opp.foldMarker, /原始输出已折叠/)
    assert.ok(opp.reclaimedChars > 0)
    assert.equal(analysis.totalRawChars, opp.originalChars)
    assert.equal(analysis.totalReclaimedChars, opp.reclaimedChars)
  })

  // 用例 3: 零副作用验证，调用前后 microCompactor.getWalStats().totalEntries 保持不变
  it('guarantees zero side-effects: microCompactor.getWalStats().totalEntries remains untouched before and after', () => {
    const beforeStats = microCompactor.getWalStats()
    const heavyLines = Array.from(
      { length: 80 },
      (_, i) => `Execution log line ${i + 1}: processed chunk data`
    )
    const event = createTestEvent({
      observation: { output: heavyLines },
    })

    const analysis = analyzeCompactionOpportunities([event])
    assert.equal(analysis.hitCount, 1)
    assert.ok(analysis.totalReclaimedChars > 0)

    const afterStats = microCompactor.getWalStats()
    assert.equal(afterStats.totalEntries, beforeStats.totalEntries)
    assert.equal(afterStats.totalRawChars, beforeStats.totalRawChars)
    assert.equal(afterStats.totalCompactedChars, beforeStats.totalCompactedChars)
    assert.equal(afterStats.totalReclaimedChars, beforeStats.totalReclaimedChars)
  })

  // 用例 4: opportunities 按 reclaimedChars 降序排序
  it('sorts opportunities in descending order by reclaimedChars', () => {
    const smallLines = Array.from({ length: 45 }, () => 'small log line payload')
    const largeLines = Array.from(
      { length: 160 },
      () => 'large heavy log line chunk with extensive execution traces'
    )
    const mediumLines = Array.from({ length: 80 }, () => 'medium log line chunk')

    const smallEvent = createTestEvent({
      nodeId: 'node-small',
      observation: { output: smallLines },
    })
    const largeEvent = createTestEvent({
      nodeId: 'node-large',
      observation: { output: largeLines },
    })
    const mediumEvent = createTestEvent({
      nodeId: 'node-medium',
      observation: { output: mediumLines },
    })

    // 乱序传入 (small, large, medium)
    const analysis = analyzeCompactionOpportunities([smallEvent, largeEvent, mediumEvent])
    assert.equal(analysis.scannedCount, 3)
    assert.equal(analysis.hitCount, 3)
    assert.equal(analysis.opportunities.length, 3)

    const [first, second, third] = analysis.opportunities
    assert.equal(first.nodeId, 'node-large')
    assert.equal(second.nodeId, 'node-medium')
    assert.equal(third.nodeId, 'node-small')
    assert.ok(first.reclaimedChars >= second.reclaimedChars)
    assert.ok(second.reclaimedChars >= third.reclaimedChars)
  })

  // 用例 5: 透出 pointerId 与 compactSummary，且条目仍计入统计
  it('transparently passes through pointerId and compactSummary from observation while still counting in metrics', () => {
    const customPointerId = 'wal-call-bridge-42'
    const customSummary = '上游 bridge 伴生已完成预压缩'
    const event = createTestEvent({
      nodeId: 'node-pointer-test',
      title: 'Bash: build production bundle',
      observation: {
        output: Array.from({ length: 60 }, (_, i) => `Compiled module #${i + 1}`).join('\n'),
        pointerId: customPointerId,
        compactSummary: customSummary,
      },
    })

    const analysis = analyzeCompactionOpportunities([event])
    assert.equal(analysis.scannedCount, 1)
    assert.equal(analysis.hitCount, 1)
    assert.equal(analysis.opportunities.length, 1)

    const opp = analysis.opportunities[0]
    assert.equal(opp.pointerId, customPointerId)
    assert.equal(opp.compactSummary, customSummary)
    assert.equal(opp.nodeId, 'node-pointer-test')
    assert.ok(opp.reclaimedChars > 0)
    assert.equal(analysis.totalRawChars, opp.originalChars)
    assert.equal(analysis.totalReclaimedChars, opp.reclaimedChars)
  })

  // 用例 6: 空输入返回零值统计结构
  it('returns empty analysis summary when given empty input array', () => {
    const analysis = analyzeCompactionOpportunities([])
    assert.deepEqual(analysis, {
      opportunities: [],
      scannedCount: 0,
      hitCount: 0,
      totalRawChars: 0,
      totalReclaimedChars: 0,
    })
  })

  // 用例 7: 过滤无 observation.output 或输出为空的事件
  it('sifts out events without observation.output or with empty output', () => {
    const noObsEvent = createTestEvent({ nodeId: 'node-no-obs' })
    const emptyOutputEvent = createTestEvent({
      nodeId: 'node-empty-output',
      observation: { output: [] },
    })
    const emptyStringEvent = createTestEvent({
      nodeId: 'node-empty-string',
      observation: { output: '' },
    })
    const validEvent = createTestEvent({
      nodeId: 'node-valid',
      observation: { output: ['line 1', 'line 2'] },
    })

    const analysis = analyzeCompactionOpportunities([
      noObsEvent,
      emptyOutputEvent,
      emptyStringEvent,
      validEvent,
    ])
    assert.equal(analysis.scannedCount, 1)
    assert.equal(analysis.hitCount, 0)
    assert.equal(analysis.opportunities.length, 0)
  })

  // 用例 8: 遵循自定义 MicroCompactorOptions 阈值
  it('respects custom MicroCompactorOptions thresholds', () => {
    const lines = Array.from({ length: 15 }, (_, i) => `Custom test line ${i + 1}`)
    const event = createTestEvent({ observation: { output: lines } })

    // 默认阈值 (40 行) 下不触发压缩
    const defaultAnalysis = analyzeCompactionOpportunities([event])
    assert.equal(defaultAnalysis.hitCount, 0)

    // 自定义阈值 (maxLinesThreshold: 10, headLinesCount: 4, tailLinesCount: 4) 下触发压缩
    const customAnalysis = analyzeCompactionOpportunities([event], {
      maxLinesThreshold: 10,
      headLinesCount: 4,
      tailLinesCount: 4,
    })
    assert.equal(customAnalysis.hitCount, 1)
    assert.equal(customAnalysis.opportunities[0].headLines.length, 4)
    assert.equal(customAnalysis.opportunities[0].tailLines.length, 4)
  })
})
