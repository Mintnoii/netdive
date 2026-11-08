import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ContextItem, TelemetryEvent } from '../types/telemetry'
import type { TrendPoint } from './contextTrend'
import {
  buildStepLink,
  resolveStepEvents,
  collectActualUsage,
  compareWithPrevious,
  searchAndSortItems,
  segmentKinds,
  sourceChipOf,
  detectOutcome,
  detectFileRefs,
  classifyMarkdownLines,
  countLines,
} from './contextBrowser'

const ev = (partial: Partial<TelemetryEvent>): TelemetryEvent => ({
  nodeId: 'node',
  type: 'node_complete',
  ...partial,
})

const point = (stepIndex: number, nodeId: string, delta = 0): TrendPoint => ({
  nodeId,
  stepIndex,
  turnIndex: 1,
  tokens: 14000 + stepIndex * 1000,
  delta,
  output: 320,
  cacheRead: 1000,
  provenance: 'counted',
  summary: { user: '无', input: '无', response: '无' },
  markers: [],
})

const item = (name: string, tokens: number, tag?: string, content?: string): ContextItem => ({
  name,
  tokens,
  tag,
  content,
})

describe('Context Browser & Step Link (M2)', () => {
  describe('1. 联动契约与瘦节点', () => {
    it('联动指针严格只有三个字段，不携带原文、payload 或播放器位置', () => {
      const link = buildStepLink(point(3, 'a3'), 'hover')

      assert.deepEqual(link, { stepIndex: 3, nodeId: 'a3', mode: 'hover' })
      assert.deepEqual(Object.keys(link).sort(), ['mode', 'nodeId', 'stepIndex'])
    })

    it('步骤事件摘要只给定位与尺寸，绝不返回 content', () => {
      const events = [
        ev({ nodeId: 't1', gesture: 'bash', title: '$ pnpm test', delta: 'x'.repeat(40) }),
        ev({ nodeId: 't2', gesture: 'read', title: '查看文件', observation: { output: ['y'.repeat(60)] } }),
        ev({ nodeId: 'a1', gesture: 'think', delta: '回复', usage: { input: 14000 } }),
      ]

      const digests = resolveStepEvents(events, point(1, 'a1'))

      assert.equal(digests.length, 2)
      assert.deepEqual(
        digests.map((d) => d.nodeId),
        ['t1', 't2']
      )
      assert.equal(digests[0].chars, 40)
      assert.equal(digests[1].chars, 60)
      assert.ok(digests.every((d) => !('content' in d) && !('payload' in d)))
    })

    it('定位不到请求事件时返回空摘要，不抛错', () => {
      assert.deepEqual(resolveStepEvents([], point(1, 'missing')), [])
    })
  })

  describe('2. 估算与实际值并列、净变化对账', () => {
    it('取事件流里最后一次服务商 usage', () => {
      const events = [
        ev({ nodeId: 'a1', usage: { input: 12000, output: 300, cacheRead: 800 } }),
        ev({ nodeId: 'a2', usage: { input: 18000, output: 700, cacheRead: 1500 } }),
      ]

      const actual = collectActualUsage(events)

      assert.deepEqual(actual, {
        input: 18000,
        output: 700,
        cacheRead: 1500,
        nodeId: 'a2',
      })
    })

    it('无 usage 会话返回 null，不编造实际值', () => {
      assert.equal(collectActualUsage([ev({ nodeId: 't1' })]), null)
    })

    it('首个请求无前序，压缩后的请求给出负净变化', () => {
      const points = [point(1, 'a1', 0), point(2, 'a2', 4000), point(3, 'a3', -9000)]

      assert.deepEqual(compareWithPrevious(points, 0), {
        tokenDelta: 0,
        eventCount: 0,
        hasPrevious: false,
      })
      assert.deepEqual(compareWithPrevious(points, 2), {
        tokenDelta: -9000,
        eventCount: 2,
        hasPrevious: true,
      })
    })
  })

  describe('3. 检视手感纯函数', () => {
    const items = [
      item('src/app.ts', 4200, 'read'),
      item('bash', 900, 'result', '✓ 248 tests passed'),
      item('AGENTS.md', 1500, 'read'),
    ]

    it('独立搜索命中名称与来源标签，结果保留原索引', () => {
      const ranked = searchAndSortItems(items, 'read', 'name')

      assert.equal(ranked.length, 2)
      assert.deepEqual(ranked.map((r) => r.index), [2, 0])
      assert.equal(ranked[0].item.name, 'AGENTS.md')
    })

    it('按体量排序时大条目在前', () => {
      const ranked = searchAndSortItems(items, '', 'size')

      assert.deepEqual(ranked.map((r) => r.item.name), ['src/app.ts', 'AGENTS.md', 'bash'])
    })

    it('三段筛选互斥且覆盖 7-part 全部类别', () => {
      const all = ['thinking', 'tools', 'answer'] as const
      const kinds = all.flatMap((segment) => segmentKinds(segment))

      assert.equal(kinds.length, 7)
      assert.equal(new Set(kinds).size, 7)
      assert.deepEqual(kinds, [
        'system',
        'skills',
        'memory',
        'tools',
        'results',
        'files',
        'chat',
      ])
      assert.deepEqual(segmentKinds(null), [])
    })

    it('来源芯片取自真实 tag，缺失时标未标注', () => {
      assert.equal(sourceChipOf(items[1]), 'result')
      assert.equal(sourceChipOf(item('无标签', 10)), '未标注来源')
    })

    it('工具结果成败按输出里的真实标记判定', () => {
      assert.equal(detectOutcome('✓ 248 tests passed'), 'ok')
      assert.equal(detectOutcome('AssertionError: expected 1'), 'error')
      assert.equal(detectOutcome('普通输出'), 'unknown')
      assert.equal(detectOutcome(undefined), 'unknown')
    })

    it('文件引用按出现顺序去重，尺寸与 token 为字符量推算', () => {
      const refs = detectFileRefs('读取 src/app.ts 与 src/app.ts，另见 AGENTS.md 和 logo.png')

      assert.deepEqual(
        refs.map((r) => r.path),
        ['src/app.ts', 'AGENTS.md', 'logo.png']
      )
      assert.equal(refs[0].ext, 'ts')
      assert.equal(refs[0].tokens, Math.ceil(refs[0].chars / 4))
    })

    it('Markdown 行级分类覆盖标题、列表、引用与代码块', () => {
      const lines = classifyMarkdownLines('# 标题\n- 条目\n> 引用\n```\nconst a = 1\n```\n正文')

      assert.deepEqual(
        lines.map((l) => l.kind),
        ['heading', 'list', 'quote', 'code', 'code', 'code', 'text']
      )
    })

    it('行数统计对空内容返回 0', () => {
      assert.equal(countLines('a\nb\nc'), 3)
      assert.equal(countLines(undefined), 0)
    })
  })
})
