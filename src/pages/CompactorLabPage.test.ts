import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CompactorLabPage,
} from './CompactorLabPage'
import {
  SCENARIO_150_LINE_TEST_LOG,
  SCENARIO_AST_DIFF,
  SCENARIO_HEAVY_PACKAGE_JSON,
  PRESET_SCENARIOS,
  estimateTokens,
  type ScenarioPresetKey,
} from '../services/compactorLabScenarios'
import {
  MicroCompactor,
  compactToolLines,
  isCompactionNeeded,
  DEFAULT_MAX_LINES_THRESHOLD,
  DEFAULT_HEAD_LINES,
  DEFAULT_TAIL_LINES,
} from '../services/microCompactor'

describe('CompactorLabPage & Scenarios Unit Tests', () => {
  it('exports CompactorLabPage as a valid React component function', () => {
    assert.equal(typeof CompactorLabPage, 'function')
    assert.equal(CompactorLabPage.name, 'CompactorLabPage')
  })

  describe('estimateTokens utility', () => {
    it('returns 0 for empty or nullish strings', () => {
      assert.equal(estimateTokens(''), 0)
    })

    it('estimates tokens proportionally based on character length', () => {
      const sample = 'hello world test string' // 23 chars
      const estimated = estimateTokens(sample)
      assert.ok(estimated > 0)
      assert.equal(estimated, Math.max(1, Math.round(23 / 3.8)))
    })
  })

  describe('Preset Scenarios Contract & Compaction Calculations', () => {
    it('contains all 3 required scenario presets in PRESET_SCENARIOS', () => {
      const expectedKeys: Exclude<ScenarioPresetKey, '自定义输入 (Custom Input)'>[] = [
        '150 行超长单测日志 Dump (pnpm test)',
        '超大 AST 差异 Diff 补丁 (packages/core/pipeline.ts)',
        '巨型依赖清单读取 (package.json / tsconfig)',
      ]

      for (const key of expectedKeys) {
        assert.ok(key in PRESET_SCENARIOS, `Missing required preset key: ${key}`)
        assert.ok(typeof PRESET_SCENARIOS[key] === 'string' && PRESET_SCENARIOS[key].length > 0)
      }
    })

    describe("Scenario 1: '150 行超长单测日志 Dump (pnpm test)'", () => {
      it('has exactly 150 lines and triggers micro-compaction', () => {
        const lines = SCENARIO_150_LINE_TEST_LOG.split('\n')
        assert.equal(lines.length, 150)
        assert.ok(isCompactionNeeded(SCENARIO_150_LINE_TEST_LOG))
      })

      it('compacts 150 lines into 31 lines (Head 15 + fold marker + Tail 15) and reclaims > 70% tokens', () => {
        const compactor = new MicroCompactor({
          maxLinesThreshold: DEFAULT_MAX_LINES_THRESHOLD,
          headLinesCount: DEFAULT_HEAD_LINES,
          tailLinesCount: DEFAULT_TAIL_LINES,
        })

        const res = compactor.compactToolOutput(SCENARIO_150_LINE_TEST_LOG, {
          toolName: '150 行超长单测日志 Dump (pnpm test)',
          exitCode: 0,
        })

        assert.equal(res.compacted, true)
        assert.ok(res.pointerId)
        assert.equal(res.exitCode, 0)
        assert.equal(res.originalLines, 150)
        assert.equal(res.compactedLines, 31) // 15 + 1 + 15

        const outputLines = res.output.split('\n')
        assert.equal(outputLines.length, 31)

        // 验证头部 15 行
        const rawLines = SCENARIO_150_LINE_TEST_LOG.split('\n')
        for (let i = 0; i < 15; i++) {
          assert.equal(outputLines[i], rawLines[i])
        }

        // 验证折叠标记
        assert.ok(outputLines[15].includes('原始输出已折叠 120 行'))

        // 验证尾部 15 行
        for (let i = 0; i < 15; i++) {
          assert.equal(outputLines[16 + i], rawLines[150 - 15 + i])
        }

        // 验证节约字符数与节约率
        assert.ok(res.reclaimedChars > 0)
        const rawTokens = estimateTokens(SCENARIO_150_LINE_TEST_LOG)
        const compactedTokens = estimateTokens(res.output)
        const reclaimRatio = ((rawTokens - compactedTokens) / rawTokens) * 100
        assert.ok(reclaimRatio > 70, `Expected reclaim ratio > 70%, got ${reclaimRatio}%`)

        // 验证 WAL 原地回放 100% 原始文本
        const replayed = compactor.replay(res.pointerId)
        assert.equal(replayed, SCENARIO_150_LINE_TEST_LOG)
      })
    })

    describe("Scenario 2: '超大 AST 差异 Diff 补丁 (packages/core/pipeline.ts)'", () => {
      it('is a realistic unified diff with > 40 lines that compacts cleanly', () => {
        const rawText = SCENARIO_AST_DIFF
        const lines = rawText.split('\n')
        assert.ok(lines.length > DEFAULT_MAX_LINES_THRESHOLD)
        assert.ok(rawText.startsWith('diff --git'))

        const compaction = compactToolLines(rawText)
        assert.equal(compaction.compacted, true)
        assert.equal(compaction.compactedLines, 31)
        assert.ok(compaction.compactedText.includes('原始输出已折叠'))
      })
    })

    describe("Scenario 3: '巨型依赖清单读取 (package.json / tsconfig)'", () => {
      it('is a valid JSON payload with > 40 lines that compacts cleanly', () => {
        const rawText = SCENARIO_HEAVY_PACKAGE_JSON
        const parsed = JSON.parse(rawText)
        assert.equal(typeof parsed, 'object')
        assert.ok(parsed.dependencies)

        const lines = rawText.split('\n')
        assert.ok(lines.length > DEFAULT_MAX_LINES_THRESHOLD)

        const compaction = compactToolLines(rawText)
        assert.equal(compaction.compacted, true)
        assert.equal(compaction.compactedLines, 31)
      })
    })
  })

  describe('WAL Pointer Registration and Replay Fidelity', () => {
    it('creates distinct pointer IDs and lossless WAL retrieval for each scenario', () => {
      const compactor = new MicroCompactor({ pointerPrefix: 'wal-test-' })

      const res1 = compactor.compactToolOutput(SCENARIO_150_LINE_TEST_LOG)
      const res2 = compactor.compactToolOutput(SCENARIO_AST_DIFF)

      assert.ok(res1.pointerId)
      assert.ok(res2.pointerId)
      assert.notEqual(res1.pointerId, res2.pointerId)

      assert.equal(compactor.replay(res1.pointerId!), SCENARIO_150_LINE_TEST_LOG)
      assert.equal(compactor.replay(res2.pointerId!), SCENARIO_AST_DIFF)

      const stats = compactor.getWalStats()
      assert.equal(stats.totalEntries, 2)
      assert.ok(stats.totalReclaimedChars > 0)
    })
  })

  describe('Prompt Cache Prefix Stability Calculations', () => {
    it('creates byte-level invariant canonical representation and hashes', () => {
      const compactor = new MicroCompactor()
      const systemPrompt = 'System Prompt Test'
      const ltm = JSON.stringify({ key: 'value' })

      const b1 = compactor.createPrefixBoundary(systemPrompt, ltm)
      const b2 = compactor.createPrefixBoundary(systemPrompt, ltm)

      assert.equal(b1.prefixHash, b2.prefixHash)
      assert.equal(b1.rawCanonical, b2.rawCanonical)

      const verifySame = compactor.verifyPrefixStability(b1, b2)
      assert.equal(verifySame.stable, true)

      // 验证突变捕获
      const mutatedSystem = `${systemPrompt} [MUTATED]`
      const bMutated = compactor.createPrefixBoundary(mutatedSystem, ltm)
      const verifyDiff = compactor.verifyPrefixStability(b1, bMutated)
      assert.equal(verifyDiff.stable, false)
      assert.ok(verifyDiff.diffDetails?.includes('Byte mismatch'))
    })
  })
})
