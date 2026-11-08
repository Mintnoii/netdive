import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CompactorLabPage } from './CompactorLabPage'
import * as scenariosModule from '../services/compactorLabScenarios'
import { estimateTokens, SANDBOX_PLACEHOLDER } from '../services/compactorLabScenarios'
import {
  MicroCompactor,
  compactToolLines,
  isCompactionNeeded,
  DEFAULT_MAX_LINES_THRESHOLD,
  DEFAULT_HEAD_LINES,
  DEFAULT_TAIL_LINES,
} from '../services/microCompactor'

describe('CompactorLabPage & Sandbox Unit Tests', () => {
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

  describe('compactorLabScenarios Module Sandbox Contract', () => {
    it('exports SANDBOX_PLACEHOLDER with at most 10 lines', () => {
      assert.equal(typeof SANDBOX_PLACEHOLDER, 'string')
      const lines = SANDBOX_PLACEHOLDER.split('\n')
      assert.ok(lines.length <= 10, `Expected <= 10 lines, got ${lines.length}`)
      assert.ok(lines.length > 0)
    })

    it('does not export deprecated fake preset scenario constants', () => {
      const exportedKeys = Object.keys(scenariosModule)
      const deprecatedKey = ['PRESET', 'SCENARIOS'].join('_')
      assert.equal(
        exportedKeys.includes(deprecatedKey),
        false,
        `Module should not export ${deprecatedKey}`
      )
    })
  })

  describe('compactToolLines & MicroCompactor Boundary Contracts', () => {
    it('does not compact short outputs (<= 40 lines and <= 1500 chars)', () => {
      const shortLog = Array.from({ length: 30 }, (_, i) => `log line ${i + 1}`).join('\n')
      assert.equal(isCompactionNeeded(shortLog), false)
      const res = compactToolLines(shortLog)
      assert.equal(res.compacted, false)
      assert.equal(res.compactedLines, 30)
      assert.equal(res.compactedText, shortLog)
    })

    it('compacts when line count > 40, retaining Head 15 + fold marker + Tail 15', () => {
      const linesCount = 80
      const longLog = Array.from({ length: linesCount }, (_, i) => `item index ${i + 1}`).join('\n')
      assert.ok(isCompactionNeeded(longLog))

      const res = compactToolLines(longLog, {
        maxLinesThreshold: DEFAULT_MAX_LINES_THRESHOLD,
        headLinesCount: DEFAULT_HEAD_LINES,
        tailLinesCount: DEFAULT_TAIL_LINES,
      })

      assert.equal(res.compacted, true)
      assert.equal(res.originalLines, linesCount)
      assert.equal(res.compactedLines, 31) // 15 + 1 + 15
      assert.ok(res.compactedText.includes('原始输出已折叠'))
      assert.ok(res.compactedText.includes('50 行')) // 80 - 30 = 50 lines folded

      const outputLines = res.compactedText.split('\n')
      const rawLines = longLog.split('\n')

      // 验证头部 15 行
      for (let i = 0; i < 15; i++) {
        assert.equal(outputLines[i], rawLines[i])
      }
      // 验证折叠标记位于第 16 行 (索引 15)
      assert.ok(outputLines[15].includes('原始输出已折叠'))
      // 验证尾部 15 行
      for (let i = 0; i < 15; i++) {
        assert.equal(outputLines[16 + i], rawLines[linesCount - 15 + i])
      }
    })

    it('compacts when char count > 1500 even if line count <= 40', () => {
      const longLine = 'A'.repeat(2000)
      assert.ok(isCompactionNeeded(longLine))
      const res = compactToolLines(longLine)
      assert.equal(res.compacted, true)
      assert.ok(res.compactedText.includes('原始输出已折叠'))
    })
  })

  describe('WAL Pointer Registration & Replay Fidelity (wal-lab-* prefix)', () => {
    it('creates wal-lab-* pointer IDs and achieves 100% lossless raw retrieval', () => {
      const compactor = new MicroCompactor({ pointerPrefix: 'wal-lab-' })
      const sampleText = Array.from({ length: 60 }, (_, i) => `sample line ${i + 1}`).join('\n')

      const result = compactor.compactToolOutput(sampleText, {
        toolName: 'sandbox-test',
        exitCode: 0,
      })

      assert.equal(result.compacted, true)
      assert.ok(result.pointerId)
      assert.ok(
        result.pointerId.startsWith('wal-lab-'),
        `Expected pointerId to start with wal-lab-, got ${result.pointerId}`
      )

      const replayed = compactor.replay(result.pointerId)
      assert.equal(replayed, sampleText)

      const walEntries = compactor.getAllWal()
      assert.equal(walEntries.length, 1)
      assert.equal(walEntries[0].pointerId, result.pointerId)
      assert.equal(walEntries[0].originalLines, 60)
      assert.equal(walEntries[0].compactedLines, 31)

      const stats = compactor.getWalStats()
      assert.equal(stats.totalEntries, 1)
      assert.ok(stats.totalReclaimedChars > 0)
    })
  })

  describe('Prompt Cache Prefix Stability Verification', () => {
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
