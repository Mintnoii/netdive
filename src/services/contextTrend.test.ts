import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { TelemetryEvent } from '../types/telemetry'
import {
  buildTrendModel,
  buildTrendBars,
  attachDelta,
  aggregateByTurn,
  estimateHeadroom,
  scanEvents,
  ESTIMATED_BASE_TOKENS,
  type TrendPoint,
} from './contextTrend'

const ev = (partial: Partial<TelemetryEvent>): TelemetryEvent => ({
  nodeId: 'node',
  type: 'node_complete',
  ...partial,
})

const user = (nodeId: string, text: string): TelemetryEvent =>
  ev({ nodeId, actor: 'Human Operator', gesture: 'read', delta: text })

const assistant = (nodeId: string, input: number, timestamp: number, text = '模型回复'): TelemetryEvent =>
  ev({
    nodeId,
    gesture: 'think',
    delta: text,
    timestamp,
    usage: { input, output: 320, cacheRead: 1000 },
  })

const point = (tokens: number, delta: number, turnIndex = 1): TrendPoint => ({
  nodeId: `p-${tokens}`,
  stepIndex: 1,
  turnIndex,
  tokens,
  delta,
  output: 0,
  cacheRead: 0,
  provenance: 'counted',
  summary: { user: '无', input: '无', response: '无' },
  markers: [],
})

describe('Context Trend & Event Track (M1)', () => {
  describe('1. 逐请求体量与事件流去重', () => {
    it('同一条 assistant 消息的多个 block 折叠为一个请求点，tokens 与 usage.input 逐条对齐', () => {
      const events = [
        user('u1', '跑一下测试'),
        assistant('a1-think', 14000, 1000, '先规划'),
        assistant('a1-text', 14000, 1000, '开始执行'),
        assistant('a2', 18000, 2000),
        assistant('a3', 22000, 3000),
      ]

      const model = buildTrendModel(events, 200000)

      assert.equal(model.provenance, 'counted')
      assert.equal(model.points.length, 3)
      assert.deepEqual(
        model.points.map((p) => p.tokens),
        [14000, 18000, 22000]
      )
      assert.equal(model.points[0].summary.user, '跑一下测试')
      assert.equal(model.points[0].summary.response, '先规划')
      assert.equal(model.maxTokens, 22000)
    })

    it('首个请求无前序增量记 0，其后按有符号差值计算', () => {
      const events = [
        assistant('a1', 14000, 1000),
        assistant('a2', 18000, 2000),
        assistant('a3', 13000, 3000),
      ]
      const { points } = scanEvents(events, 'counted')

      assert.deepEqual(
        points.map((p) => p.delta),
        [0, 4000, -5000]
      )
      assert.equal(attachDelta(points)[2].delta, -5000)
    })

    it('缺 usage 时走字符量启发式推算并显式标 estimated', () => {
      const events = [
        user('u1', '调研一下'),
        ev({ nodeId: 't1', gesture: 'think', delta: 'x'.repeat(400) }),
        ev({ nodeId: 't2', gesture: 'think', delta: 'y'.repeat(400) }),
      ]

      const model = buildTrendModel(events, 200000)

      assert.equal(model.provenance, 'estimated')
      assert.equal(model.points.length, 2)
      assert.equal(model.points[0].tokens, ESTIMATED_BASE_TOKENS + 100)
      assert.equal(model.points[1].tokens, ESTIMATED_BASE_TOKENS + 200)
      assert.ok(model.points.every((p) => p.provenance === 'estimated'))
    })
  })

  describe('2. Step / Turn 双粒度与 headroom', () => {
    it('按用户轮次聚合时每轮取最后一次请求', () => {
      const events = [
        user('u1', '第一轮'),
        assistant('a1', 14000, 1000),
        user('u2', '第二轮'),
        assistant('a2', 18000, 2000),
        assistant('a3', 22000, 3000),
      ]
      const model = buildTrendModel(events, 200000)

      assert.equal(model.points.length, 3)
      assert.equal(model.turnPoints.length, 2)
      assert.deepEqual(
        model.turnPoints.map((p) => p.tokens),
        [14000, 22000]
      )
      assert.equal(aggregateByTurn(model.points)[1].delta, 8000)
    })

    it('剩余窗口与可容纳请求数按最近增量手算一致，无增长趋势时返回 null', () => {
      const points = [point(10000, 0), point(14000, 4000), point(18000, 4000), point(22000, 4000)]
      const headroom = estimateHeadroom(points, 100000)

      assert.equal(headroom.tokens, 78000)
      assert.equal(headroom.requests, 19)

      assert.deepEqual(estimateHeadroom([], 100000), { tokens: 100000, requests: null })
      assert.deepEqual(estimateHeadroom([point(10000, 0)], 100000), {
        tokens: 90000,
        requests: null,
      })
    })
  })

  describe('3. ✂ 压缩剪枝事件定位', () => {
    it('context_pruned 事件挂到最近请求点，deltaTokens 为负并保留回收来源', () => {
      const events = [
        assistant('a1', 14000, 1000),
        assistant('a2', 22000, 2000),
        ev({
          nodeId: 'prune-1',
          type: 'context_pruned',
          title: '微压缩释放',
          timestamp: 2500,
          reclaimedTokens: 9000,
        }),
        assistant('a3', 13000, 3000),
      ]
      const model = buildTrendModel(events, 200000)

      assert.equal(model.markers.length, 1)
      assert.equal(model.markers[0].kind, 'prune')
      assert.equal(model.markers[0].deltaTokens, -9000)
      assert.equal(model.markers[0].source, '微压缩释放')
      assert.equal(model.points[1].markers.length, 1)
      assert.equal(model.points[2].delta, -9000)
    })

    it('带 contextPruned 负载的事件判为 compact', () => {
      const event = ev({
        nodeId: 'compact-1',
        type: 'context_pruned',
        contextPruned: {
          before: { totalLimit: 200000, systemPrompt: 0, ltm: 0, activeTurns: 0, prunableTools: 0 },
          after: { totalLimit: 200000, systemPrompt: 0, ltm: 0, activeTurns: 0, prunableTools: 0 },
          reclaimedTokens: 42000,
        },
      })
      const { markers } = scanEvents([assistant('a1', 50000, 1000), event], 'counted')

      assert.equal(markers[0].kind, 'compact')
      assert.equal(markers[0].deltaTokens, -42000)
    })
  })

  describe('4. 纯 SVG 柱几何', () => {
    it('total 模式以底部为基线按峰值归一化', () => {
      const points = [point(100, 0), point(200, 100)]
      const bars = buildTrendBars(points, 'total', { width: 100, height: 60, padding: 10 })

      assert.equal(bars[0].height, 20)
      assert.equal(bars[0].y, 30)
      assert.equal(bars[1].height, 40)
      assert.equal(bars[1].y, 10)
      assert.equal(bars[1].width, 14)
    })

    it('delta 模式以中线为基线，负值向下延伸', () => {
      const points = [point(100, 0), point(200, 100), point(150, -50)]
      const bars = buildTrendBars(points, 'delta', { width: 90, height: 60, padding: 10 })

      assert.equal(bars[0].y, 30)
      assert.equal(bars[1].y, 10)
      assert.equal(bars[2].y, 30)
      assert.equal(bars[2].height, 10)
      assert.equal(bars[2].negative, true)
    })
  })

  describe('5. 空输入与契约降级', () => {
    it('空事件流返回空模型且不抛错', () => {
      const model = buildTrendModel([], 200000)

      assert.deepEqual(model.points, [])
      assert.deepEqual(model.turnPoints, [])
      assert.deepEqual(model.markers, [])
      assert.equal(model.maxTokens, 1)
      assert.equal(model.headroomRequests, null)
    })

    it('有 usage 但只有工具事件时不产生请求点', () => {
      const events = [ev({ nodeId: 't1', gesture: 'bash', title: '$ pnpm test' })]
      const model = buildTrendModel(events, 200000)

      assert.equal(model.points.length, 0)
      assert.equal(model.provenance, 'estimated')
    })
  })
})
