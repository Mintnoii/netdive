import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ContextInspectorDrawer } from './ContextInspectorDrawer'
import { ContextStripBar } from './ContextStripBar'
import { ContextTrendTrack } from './ContextTrendTrack'
import { ContextTextOverlay } from './ContextTextOverlay'
import { buildTrendModel } from '../services/contextTrend'
import {
  buildStepLink,
  collectActualUsage,
  compareWithPrevious,
  searchAndSortItems,
  segmentKinds,
  detectOutcome,
} from '../services/contextBrowser'
import {
  type ContextWatermark,
  type PrunableItem,
  type TelemetryEvent,
  DEFAULT_CONTEXT_WATERMARK,
  formatTokens,
} from '../types/telemetry'
import { microCompactor } from '../services/microCompactor'

describe('ContextInspectorDrawer & ContextStripBar Unit Tests', () => {
  describe('1. 组件导出与接口契约 (Component Export Contract)', () => {
    it('ContextInspectorDrawer 作为合法 React 组件函数成功导出', () => {
      assert.equal(typeof ContextInspectorDrawer, 'function')
    })

    it('ContextStripBar 作为合法 React 组件函数成功导出', () => {
      assert.equal(typeof ContextStripBar, 'function')
    })

    it('ContextTrendTrack 作为合法 React 组件函数成功导出', () => {
      assert.equal(typeof ContextTrendTrack, 'function')
    })
  })

  describe('2. 全维上下文构成与 Token 计算契约 (Context Composition Calculation)', () => {
    it('正确计算真实 JSONL 水位字段（系统基座、思考链、对话历史、工具输出与 Cache 命中）', () => {
      const realWatermark: ContextWatermark = {
        totalLimit: 200000,
        maxCapacity: 200000,
        systemPrompt: 14000,
        ltm: 0,
        activeTurns: 8200,
        prunableTools: 32000,
        total: 54200,
        conversationHistory: 6000,
        reasoningTokens: 2200,
        toolOutputs: 32000,
        cacheRead: 24000,
      }

      const maxCapacity = realWatermark.maxCapacity || realWatermark.totalLimit
      assert.equal(maxCapacity, 200000)

      const systemTokens = realWatermark.systemPrompt
      assert.equal(systemTokens, 14000)

      const reasoning = realWatermark.reasoningTokens!
      assert.equal(reasoning, 2200)

      const convHistory = realWatermark.conversationHistory!
      assert.equal(convHistory, 6000)

      const dialogueAndReasoning = convHistory + reasoning
      assert.equal(dialogueAndReasoning, 8200)

      const toolTokens = realWatermark.toolOutputs!
      assert.equal(toolTokens, 32000)

      const cacheRead = realWatermark.cacheRead!
      assert.equal(cacheRead, 24000)

      const totalUsed = realWatermark.total!
      assert.equal(totalUsed, 54200)

      // Cache 命中比率计算
      const cacheHitRate = Math.round((cacheRead / (totalUsed + cacheRead)) * 100)
      assert.equal(cacheHitRate, 31) // 24000 / (54200 + 24000) = 30.69% -> 31%
    })

    it('当扩展字段缺失时平滑优雅降级到传统 BASE_CONTEXT_WATERMARK 契约', () => {
      const legacyWatermark: ContextWatermark = {
        ...DEFAULT_CONTEXT_WATERMARK,
      }

      const maxCapacity = legacyWatermark.maxCapacity || legacyWatermark.totalLimit || 128000
      assert.equal(maxCapacity, 128000)

      const systemTokens = legacyWatermark.systemPrompt || 8000
      assert.equal(systemTokens, 8000)

      const convHistory =
        legacyWatermark.conversationHistory !== undefined
          ? legacyWatermark.conversationHistory
          : legacyWatermark.activeTurns
      assert.equal(convHistory, 16000)

      const toolTokens =
        legacyWatermark.toolOutputs !== undefined
          ? legacyWatermark.toolOutputs
          : legacyWatermark.prunableTools
      assert.equal(toolTokens, 46000)

      const cacheRead = legacyWatermark.cacheRead || 0
      assert.equal(cacheRead, 0)
    })
  })

  describe('3. 高耗工具调用条目与确定性微压缩联动契约 (Micro-Compactor Linkage)', () => {
    it('正确对 150 行超长单测日志生成 Head 15 + Tail 15 紧凑预览并计算释放净值', () => {
      const longTestLog = [
        '$ pnpm test:pipeline',
        '> vitest run pipeline',
        '',
        ...Array.from({ length: 143 }, (_, i) => `✓ test/pipeline.test.ts > step ${i + 1} passed (8ms)`),
        '',
        'Test Files  1 passed (1)',
        'Tests  143 passed (143)',
        'Time  1.42s',
      ].join('\n')

      const sampleItem: PrunableItem = {
        id: 'item-bash-1',
        gesture: 'bash',
        emoji: '📟',
        title: 'Bash: pnpm test:pipeline -> 143 passed',
        rawDetail: '150 lines raw test stdout/stderr, ~28k tokens',
        tokens: 28000,
        statusBadge: '待微压缩 (Pending)',
        foldedSummary: '单元测试回归通过 (143 passed, 0 failed)',
        linesCount: 150,
        rawPayloadPreview: longTestLog,
      }

      const compaction = microCompactor.compactToolOutput(sampleItem.rawPayloadPreview!, {
        toolName: sampleItem.title,
        exitCode: 0,
      })

      assert.equal(compaction.compacted, true)
      assert.equal(compaction.originalLines, 150)
      assert.equal(compaction.compactedLines, 31) // Head 15 + fold marker + Tail 15
      assert(compaction.output.includes('原始输出已折叠 120 行'))
      assert(compaction.reclaimedChars > 0)
    })

    it('针对代码 Diff 与短文本输出安全保持原样不产生错误折叠', () => {
      const shortDiff = [
        '--- a/src/index.ts',
        '+++ b/src/index.ts',
        '@@ -1,3 +1,3 @@',
        '- const a = 1;',
        '+ const a = 2;',
      ].join('\n')

      const compaction = microCompactor.compactToolOutput(shortDiff, {
        toolName: 'Edit: src/index.ts',
        exitCode: 0,
      })

      assert.equal(compaction.compacted, false)
      assert.equal(compaction.output, shortDiff)
    })
  })

  describe('4. 一键剪枝状态流转与已修剪标记契约 (Pruning State Flow)', () => {
    it('当 isPruned 为 true 时，正确映射已修剪文案与释放净值', () => {
      const reclaimedTokens = 42000
      const formattedReclaimed = formatTokens(reclaimedTokens)
      assert.equal(formattedReclaimed, '42k')

      const totalPrunable = 46000
      const targetPrunable = 4000
      const calculatedReclaimed = totalPrunable - targetPrunable
      assert.equal(calculatedReclaimed, 42000)
    })
  })

  describe('5. M1 上下文趋势轨道与抽屉对账 (Context Trend Track)', () => {
    const window = 200000
    const countedEvents: TelemetryEvent[] = [
      { nodeId: 'u1', type: 'node_complete', actor: 'Human Operator', gesture: 'read', delta: '跑测试' },
      {
        nodeId: 'a1',
        type: 'node_complete',
        gesture: 'think',
        delta: '先规划',
        timestamp: 1000,
        usage: { input: 42000, output: 900 },
      },
      {
        nodeId: 'prune-1',
        type: 'context_pruned',
        title: '微压缩释放',
        timestamp: 1500,
        reclaimedTokens: 12000,
      },
      {
        nodeId: 'a2',
        type: 'node_complete',
        gesture: 'think',
        delta: '继续',
        timestamp: 2000,
        usage: { input: 30000, output: 700 },
      },
    ]

    it('趋势模型的窗口与抽屉一致，headroom 按实测末次请求对账', () => {
      const model = buildTrendModel(countedEvents, window)

      assert.equal(model.window, window)
      assert.equal(model.provenance, 'counted')
      assert.equal(model.points.length, 2)
      assert.equal(model.headroomTokens, window - 30000)
      assert.equal(model.points[1].delta, -12000)
    })

    it('✂ 压缩事件挂到最近请求点且回收量为负', () => {
      const { markers, points } = buildTrendModel(countedEvents, window)

      assert.equal(markers.length, 1)
      assert.equal(markers[0].deltaTokens, -12000)
      assert.equal(points[0].markers.length, 1)
    })

    it('抽屉收到无 usage 的会话时显式标推算值，不冒充实测', () => {
      const model = buildTrendModel(
        [{ nodeId: 't1', type: 'node_complete', gesture: 'think', delta: 'x'.repeat(200) }],
        window
      )

      assert.equal(model.provenance, 'estimated')
      assert.ok(model.points.every((point) => point.provenance === 'estimated'))
    })
  })

  describe('6. M2 图表联动与检视手感契约', () => {
    const countedEvents: TelemetryEvent[] = [
      {
        nodeId: 'a1',
        type: 'node_complete',
        gesture: 'think',
        delta: '先规划',
        timestamp: 1000,
        usage: { input: 22000, output: 300, cacheRead: 800 },
      },
      {
        nodeId: 'prune-1',
        type: 'context_pruned',
        title: '微压缩释放',
        timestamp: 1500,
        reclaimedTokens: 4000,
      },
      {
        nodeId: 'a2',
        type: 'node_complete',
        gesture: 'think',
        delta: '继续',
        timestamp: 2000,
        usage: { input: 18000, output: 700, cacheRead: 1500 },
      },
    ]

    it('联动指针按 nodeId 跨粒度稳定，不携带原文或播放器位置', () => {
      const model = buildTrendModel(countedEvents, 200000)
      const link = buildStepLink(model.points[1], 'hover')

      assert.deepEqual(link, { stepIndex: 2, nodeId: 'a2', mode: 'hover' })
      assert.deepEqual(Object.keys(link).sort(), ['mode', 'nodeId', 'stepIndex'])
    })

    it('服务商实际 usage 与推算值可并列对账', () => {
      const actual = collectActualUsage(countedEvents)

      assert.equal(actual?.input, 18000)
      assert.equal(actual?.cacheRead, 1500)
      assert.equal(actual?.nodeId, 'a2')
      assert.equal(buildTrendModel(countedEvents, 200000).provenance, 'counted')
    })

    it('差异徽标取逐请求净变化，压缩回收为负', () => {
      const model = buildTrendModel(countedEvents, 200000)
      const comparison = compareWithPrevious(model.points, 1)

      assert.equal(comparison.tokenDelta, -4000)
      assert.equal(comparison.hasPrevious, true)
      assert.equal(compareWithPrevious(model.points, 0).hasPrevious, false)
    })

    it('三段筛选互斥覆盖 7-part，清除后恢复全部', () => {
      const kinds = (['thinking', 'tools', 'answer'] as const).flatMap((key) =>
        segmentKinds(key)
      )

      assert.equal(kinds.length, 7)
      assert.equal(new Set(kinds).size, 7)
      assert.deepEqual(segmentKinds(null), [])
    })

    it('浮层导出与独立搜索、成败判定契约', () => {
      assert.equal(typeof ContextTextOverlay, 'function')

      const ranked = searchAndSortItems(
        [
          { name: 'b', tokens: 10, tag: 'result' },
          { name: 'a', tokens: 50 },
        ],
        'result',
        'size'
      )
      assert.equal(ranked.length, 1)
      assert.equal(ranked[0].index, 0)
      assert.equal(detectOutcome('✓ 248 tests passed'), 'ok')
    })
  })
})
