import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { TelemetryEvent } from '../types/telemetry'
import {
  CONTEXT_DETAIL_LIMITS,
  PROVENANCE_BADGES,
  ANNOTATION_BADGES,
  resolveAnnotations,
  buildProvenanceView,
  isStepBeforePrune,
  buildContextProjection,
  projectionNotice,
  resolveDetailWindow,
} from './contextProvenance'

const ev = (partial: Partial<TelemetryEvent>): TelemetryEvent => ({
  nodeId: 'node',
  type: 'node_complete',
  ...partial,
})

const usageEvent = (nodeId: string, input: number): TelemetryEvent =>
  ev({ nodeId, gesture: 'think', delta: '回复', usage: { input, output: 320, cacheRead: 1000 } })

const pruneEvent = (nodeId: string): TelemetryEvent =>
  ev({ nodeId, type: 'context_pruned', title: '微压缩释放', reclaimedTokens: 4000 })

describe('Context Provenance & Volume Governance (M3)', () => {
  describe('1. 正交标注不改写三态', () => {
    it('带 usage 只加 actualReported，三态字典保持三个键', () => {
      assert.deepEqual(resolveAnnotations([usageEvent('a1', 14000)]), ['actualReported'])
      assert.deepEqual(Object.keys(PROVENANCE_BADGES).sort(), ['counted', 'estimated', 'live'])
    })

    it('压缩剪枝只加 reconstructed', () => {
      assert.deepEqual(resolveAnnotations([ev({ nodeId: 'a1' }), pruneEvent('p1')]), [
        'reconstructed',
      ])
    })

    it('两类证据并存时按固定顺序返回，互不排斥', () => {
      const annotations = resolveAnnotations([usageEvent('a1', 14000), pruneEvent('p1')])

      assert.deepEqual(annotations, ['actualReported', 'reconstructed'])
      assert.deepEqual(Object.keys(ANNOTATION_BADGES).sort(), [
        'actualReported',
        'reconstructed',
      ])
    })

    it('空事件流返回空标注，不编造证据', () => {
      assert.deepEqual(resolveAnnotations([]), [])
      assert.deepEqual(buildProvenanceView([]), {
        annotations: [],
        actualReported: undefined,
      })
    })

    it('完整视图带最后一次服务商报告值', () => {
      const view = buildProvenanceView([usageEvent('a1', 14000), usageEvent('a2', 18000)])

      assert.deepEqual(view.annotations, ['actualReported'])
      assert.equal(view.actualReported?.input, 18000)
      assert.equal(view.actualReported?.nodeId, 'a2')
    })
  })

  describe('2. 压缩前步骤的近似重建判定', () => {
    it('请求之后有剪枝事件时判为压缩前旧步骤', () => {
      assert.equal(isStepBeforePrune([usageEvent('a1', 14000), pruneEvent('p1')], 'a1'), true)
    })

    it('剪枝之后的请求不标近似重建', () => {
      assert.equal(
        isStepBeforePrune([usageEvent('a1', 14000), pruneEvent('p1'), usageEvent('a2', 9000)], 'a2'),
        false
      )
    })

    it('找不到节点时返回 false，不抛错', () => {
      assert.equal(isStepBeforePrune([], 'missing'), false)
    })
  })

  describe('3. 精简投影与硬上限', () => {
    it('投影只留计数，返回体不含任何原文内容', () => {
      const projection = buildContextProjection([
        ev({ nodeId: 'u1', actor: 'Human Operator', gesture: 'read', delta: 'x'.repeat(20) }),
        ev({ nodeId: 't1', gesture: 'bash', observation: { output: ['y'.repeat(30)] } }),
        usageEvent('a1', 14000),
      ])

      assert.deepEqual(Object.keys(projection).sort(), [
        'commandCount',
        'contentChars',
        'eventCount',
        'fileOpCount',
        'stepCount',
        'turnCount',
      ])
      assert.equal(projection.eventCount, 3)
      assert.equal(projection.stepCount, 1)
      assert.equal(projection.turnCount, 1)
      assert.equal(projection.fileOpCount, 1)
      assert.equal(projection.commandCount, 1)
      assert.equal(projection.contentChars, 20 + 30 + 2)
      assert.ok(!Object.values(projection).some((value) => typeof value === 'string'))
    })

    it('未超限时不给降级文案', () => {
      assert.equal(projectionNotice(buildContextProjection([usageEvent('a1', 14000)])), null)
    })

    it('超限时列出各维度实际数与上限，不静默截断', () => {
      const events = Array.from({ length: CONTEXT_DETAIL_LIMITS.events + 5 }, (_, i) =>
        ev({ nodeId: `n${i}`, gesture: 'bash' })
      )
      const notice = projectionNotice(buildContextProjection(events))

      assert.ok(notice?.includes(`事件 ${CONTEXT_DETAIL_LIMITS.events + 5}/${CONTEXT_DETAIL_LIMITS.events}`))
      assert.ok(notice?.includes('不静默截断'))
    })

    it('按页补载取值窗口在触顶时返回可读提示', () => {
      assert.deepEqual(resolveDetailWindow(620, 500), {
        visible: 400,
        hasMore: true,
        notice: '已展示上限 400 条，剩余 220 条按需补载，明细不一次性灌入抽屉',
      })
    })

    it('未触顶时按已加载量展示，无提示', () => {
      assert.deepEqual(resolveDetailWindow(180, 100), {
        visible: 100,
        hasMore: true,
        notice: null,
      })
      assert.deepEqual(resolveDetailWindow(60, 100), {
        visible: 60,
        hasMore: false,
        notice: null,
      })
    })

    it('自定义上限可用于浮层每类条目分页', () => {
      const window = resolveDetailWindow(240, 240, CONTEXT_DETAIL_LIMITS.itemsPerPage)

      assert.equal(window.visible, 100)
      assert.equal(window.hasMore, true)
      assert.ok(window.notice?.includes('剩余 140 条按需补载'))
    })
  })
})
