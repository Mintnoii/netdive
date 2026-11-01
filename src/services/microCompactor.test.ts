import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  MicroCompactor,
  microCompactor,
  formatCompactFoldMarker,
  isCompactionNeeded,
  compactToolLines,
  ProtocolPairingError,
  PrefixMutationError,
  type ConversationMessage,
  type ToolResultEnvelope,
} from './microCompactor'
import { createBridgeApp } from '../server/bridge'

describe('MicroCompactor Engine Unit Tests', () => {
  let compactor: MicroCompactor

  beforeEach(() => {
    compactor = new MicroCompactor()
  })

  // ===========================================================================
  // Rule 1: Local Deterministic Micro-Compaction (Zero Model Calls)
  // ===========================================================================
  describe('Rule 1: Local Deterministic Micro-Compaction', () => {
    it('does not compact short outputs (<= 40 lines and <= 1500 chars)', () => {
      const shortOutput = [
        'Line 1: Build started',
        'Line 2: Compiling assets',
        'Line 3: Finished in 120ms',
      ].join('\n')

      const result = compactor.compactToolOutput(shortOutput)
      assert.equal(result.compacted, false)
      assert.equal(result.output, shortOutput)
      assert.equal(result.reclaimedChars, 0)
      assert.equal(compactor.getAllWal().length, 0)
    })

    it('compacts output with lines > 40 keeping Head 15 + Tail 15 and inserting fold marker', () => {
      // 50 行输出
      const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}: test execution step ${i + 1}`)
      const rawText = lines.join('\n')

      const result = compactor.compactToolOutput(rawText, { exitCode: 0 })
      assert.equal(result.compacted, true)
      assert.ok(result.pointerId)
      assert.equal(result.exitCode, 0)

      const outputLines = result.output.split('\n')
      // Head 15 + 1 marker + Tail 15 = 31 lines
      assert.equal(outputLines.length, 31)

      // 验证头部 15 行
      for (let i = 0; i < 15; i++) {
        assert.equal(outputLines[i], `Line ${i + 1}: test execution step ${i + 1}`)
      }

      // 验证占位标记 (50 - 30 = 20 行折叠)
      const expectedMarker = formatCompactFoldMarker(20)
      assert.equal(outputLines[15], expectedMarker)
      assert.match(outputLines[15], /原始输出已折叠 20 行，保留前置入参及尾部退出判定/)

      // 验证尾部 15 行 (Lines 36..50)
      for (let i = 0; i < 15; i++) {
        assert.equal(outputLines[16 + i], `Line ${36 + i}: test execution step ${36 + i}`)
      }

      // 验证 Token/字符节约
      assert.ok(result.reclaimedChars > 0)
      assert.equal(result.originalLines, 50)
      assert.equal(result.compactedLines, 31)
    })

    it('reduces heavy 150-line stdout by ~80% token size with zero LLM calls', () => {
      const lines = Array.from({ length: 150 }, (_, i) => `[stdout:${i + 1}] running test assertion suite for package module`)
      const rawText = lines.join('\n')

      const result = compactor.compactToolOutput(rawText, { exitCode: 0 })
      assert.equal(result.compacted, true)
      assert.equal(result.originalLines, 150)
      assert.equal(result.compactedLines, 31)

      // 150 - 30 = 120 lines folded
      assert.ok(result.output.includes('原始输出已折叠 120 行'))

      const reductionRatio = result.reclaimedChars / result.originalChars
      assert.ok(reductionRatio >= 0.75, `Expected >= 75% reduction, got ${(reductionRatio * 100).toFixed(1)}%`)
    })

    it('compacts output with chars > 1500 even when lines <= 40', () => {
      // 35 行，但每行 55 字符 -> 1925 字符 (> 1500 字符)
      const lines = Array.from({ length: 35 }, (_, i) => `Line ${String(i + 1).padStart(2, '0')}: ${'x'.repeat(45)} end`)
      const rawText = lines.join('\n')
      assert.ok(rawText.length > 1500)
      assert.ok(lines.length <= 40)

      const result = compactor.compactToolOutput(rawText)
      assert.equal(result.compacted, true)
      // 35 - 30 = 5 lines folded
      assert.ok(result.output.includes('原始输出已折叠 5 行'))
      const outputLines = result.output.split('\n')
      assert.equal(outputLines.length, 31)
    })

    it('handles single giant line (> 1500 chars) deterministically', () => {
      const giantLine = `{"data": "${'A'.repeat(2500)}", "status": "ok"}`
      assert.ok(giantLine.length > 1500)

      const result = compactor.compactToolOutput(giantLine)
      assert.equal(result.compacted, true)
      assert.ok(result.output.includes('原始输出已折叠'))
      assert.ok(result.reclaimedChars > 0)
    })

    it('isCompactionNeeded accurately evaluates strings and arrays', () => {
      assert.equal(isCompactionNeeded('short text'), false)
      assert.equal(isCompactionNeeded(Array.from({ length: 20 }, () => 'line')), false)
      assert.equal(isCompactionNeeded(Array.from({ length: 45 }, () => 'line')), true)
      assert.equal(isCompactionNeeded('y'.repeat(1600)), true)
    })

    it('compactToolLines pure function operates deterministically', () => {
      const lines = Array.from({ length: 45 }, (_, i) => `item_${i}`)
      const compacted = compactToolLines(lines)
      assert.equal(compacted.compacted, true)
      assert.equal(compacted.foldedLinesCount, 15)
      assert.equal(compacted.compactedLines, 31)
    })
  })

  // ===========================================================================
  // Rule 2: Protocol Pairing Guard (API Contract Defense)
  // ===========================================================================
  describe('Rule 2: Protocol Pairing Guard', () => {
    it('validates paired OpenAI tool_calls and tool results successfully', () => {
      const messages: ConversationMessage[] = [
        {
          role: 'user',
          content: 'Run tests and check status',
        },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_bash_01',
              type: 'function',
              function: { name: 'bash', arguments: '{"command":"pnpm test"}' },
            },
            {
              id: 'call_read_02',
              type: 'function',
              function: { name: 'read', arguments: '{"path":"src/index.ts"}' },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_bash_01',
          content: 'Tests passed',
        },
        {
          role: 'tool',
          tool_call_id: 'call_read_02',
          content: 'export const main = 1',
        },
      ]

      const validation = compactor.validatePairing(messages)
      assert.equal(validation.valid, true)
      assert.equal(validation.errors.length, 0)
      assert.equal(validation.pairedCount, 2)
      assert.doesNotThrow(() => compactor.assertPairing(messages))
    })

    it('validates paired Anthropic tool_use and tool_result blocks', () => {
      const messages: ConversationMessage[] = [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_read_99',
              name: 'read',
              input: { file_path: 'package.json' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_read_99',
              content: '{"name":"netdive"}',
            },
          ],
        },
      ]

      const validation = compactor.validatePairing(messages)
      assert.equal(validation.valid, true)
      assert.equal(validation.pairedCount, 1)
      assert.doesNotThrow(() => compactor.assertPairing(messages))
    })

    it('detects missing tool_call_id on tool result (preventing HTTP 400)', () => {
      const invalidMessages: ConversationMessage[] = [
        {
          role: 'assistant',
          tool_calls: [
            { id: 'call_test_1', function: { name: 'test', arguments: '' } },
          ],
        },
        {
          role: 'tool',
          // 缺失 tool_call_id
          content: 'result content without id',
        },
      ]

      const validation = compactor.validatePairing(invalidMessages)
      assert.equal(validation.valid, false)
      assert.ok(validation.errors.some((e) => e.includes("missing required 'tool_call_id'")))

      assert.throws(
        () => compactor.assertPairing(invalidMessages),
        (err) => err instanceof ProtocolPairingError && err.validationResult.valid === false
      )
    })

    it('detects orphan tool result without preceding tool declaration', () => {
      const messagesWithOrphan: ConversationMessage[] = [
        {
          role: 'user',
          content: 'Hello',
        },
        {
          role: 'tool',
          tool_call_id: 'call_ghost_unannounced',
          content: 'orphaned result',
        },
      ]

      const validation = compactor.validatePairing(messagesWithOrphan)
      assert.equal(validation.valid, false)
      assert.ok(validation.errors.some((e) => e.includes("orphan tool_call_id 'call_ghost_unannounced'")))
    })

    it('detects unmatched tool call where model called tool but result was dropped', () => {
      const messagesWithUnmatchedCall: ConversationMessage[] = [
        {
          role: 'assistant',
          tool_calls: [
            { id: 'call_important_bash', function: { name: 'bash', arguments: 'ls' } },
          ],
        },
        // tool result dropped!
        {
          role: 'user',
          content: 'Next turn without tool result',
        },
      ]

      const validation = compactor.validatePairing(messagesWithUnmatchedCall)
      assert.equal(validation.valid, false)
      assert.ok(validation.errors.some((e) => e.includes("Unmatched tool_call 'call_important_bash'")))
      assert.equal(validation.unmatchedToolCalls[0], 'call_important_bash')
    })

    it('detects duplicate tool result for same tool_call_id', () => {
      const duplicateMessages: ConversationMessage[] = [
        {
          role: 'assistant',
          tool_calls: [{ id: 'call_dup', function: { name: 'bash', arguments: 'pwd' } }],
        },
        { role: 'tool', tool_call_id: 'call_dup', content: '/app' },
        { role: 'tool', tool_call_id: 'call_dup', content: '/app again' },
      ]

      const validation = compactor.validatePairing(duplicateMessages)
      assert.equal(validation.valid, false)
      assert.ok(validation.errors.some((e) => e.includes("duplicate tool result returned for tool_call_id 'call_dup'")))
    })

    it('ensureToolEnvelope preserves envelope contract keys while updating content', () => {
      const originalEnvelope: ToolResultEnvelope = {
        tool_call_id: 'call_123',
        type: 'tool_result',
        role: 'tool',
        content: 'Original raw heavy output',
        exitCode: 0,
      }

      const wrapped = compactor.ensureToolEnvelope(
        originalEnvelope,
        'Compact output',
        { pointerId: 'wal-call-1', exitCode: 0, compactSummary: 'Folded 20 lines' }
      )

      assert.equal(wrapped.tool_call_id, 'call_123')
      assert.equal(wrapped.tool_use_id, 'call_123')
      assert.equal(wrapped.content, 'Compact output')
      assert.equal(wrapped.pointerContext?.pointerId, 'wal-call-1')
    })
  })

  // ===========================================================================
  // Rule 3: Pointer-based Offline WAL Storage (Write-Ahead Log)
  // ===========================================================================
  describe('Rule 3: Pointer-based Offline WAL Storage', () => {
    it('stores full raw output in WAL registry when compaction occurs', () => {
      const lines = Array.from({ length: 50 }, (_, i) => `Log line ${i + 1}`)
      const rawText = lines.join('\n')

      const result = compactor.compactToolOutput(rawText, {
        toolCallId: 'call-bash-42',
        toolName: 'bash',
        exitCode: 0,
        summary: 'Unit test suite passed',
      })

      assert.ok(result.pointerId)
      assert.equal(result.pointerContext?.pointerId, result.pointerId)
      assert.equal(result.pointerContext?.exitCode, 0)
      assert.equal(result.pointerContext?.compactSummary, 'Unit test suite passed')

      // 验证通过 WAL 按 ID 检索全量原始输出
      const walEntry = compactor.getWal(result.pointerId)
      assert.ok(walEntry)
      assert.equal(walEntry.pointerId, result.pointerId)
      assert.equal(walEntry.rawOutput, rawText)
      assert.equal(walEntry.originalLines, 50)
      assert.equal(walEntry.compactedLines, 31)
      assert.equal(walEntry.toolCallId, 'call-bash-42')
      assert.equal(walEntry.toolName, 'bash')
    })

    it('replay method retrieves exact raw uncompacted output by pointerId', () => {
      const raw = Array.from({ length: 60 }, (_, i) => `Data dump ${i}`).join('\n')
      const result = compactor.compactToolOutput(raw)
      const pointerId = result.pointerId!

      const replayed = compactor.replay(pointerId)
      assert.equal(replayed, raw)
      assert.equal(compactor.replay('non-existent-pointer'), undefined)
    })

    it('getWalStats and clearWal operate cleanly', () => {
      const raw1 = Array.from({ length: 45 }, (_, i) => `A${i}`).join('\n')
      const raw2 = Array.from({ length: 55 }, (_, i) => `B${i}`).join('\n')

      compactor.compactToolOutput(raw1)
      compactor.compactToolOutput(raw2)

      const stats = compactor.getWalStats()
      assert.equal(stats.totalEntries, 2)
      assert.ok(stats.totalRawChars > stats.totalCompactedChars)
      assert.equal(stats.totalReclaimedChars, stats.totalRawChars - stats.totalCompactedChars)

      compactor.clearWal()
      assert.equal(compactor.getAllWal().length, 0)
      assert.equal(compactor.getWalStats().totalEntries, 0)
    })

    it('compactObservation injects pointerContext into TelemetryObservation', () => {
      const observation = {
        exitCode: 0,
        output: Array.from({ length: 50 }, (_, i) => `stdout line ${i + 1}`),
      }

      const compactedObs = compactor.compactObservation(observation, {
        nodeId: 'node-test-1',
        toolName: 'bash',
      })

      assert.ok(compactedObs.pointerId)
      assert.ok(compactedObs.compactSummary)
      assert.ok(compactedObs.pointerContext)
      assert.equal(compactedObs.output.length, 31)

      // WAL registry holds the raw output
      const raw = compactor.replay(compactedObs.pointerId!)
      assert.ok(raw)
      assert.equal(raw.split('\n').length, 50)
    })
  })

  // ===========================================================================
  // Rule 4: Prompt Cache Prefix Stability
  // ===========================================================================
  describe('Rule 4: Prompt Cache Prefix Stability', () => {
    it('creates stable prefix boundary and computes deterministic SHA-256 hash', () => {
      const systemPrompt = 'You are NetDive Autonomous Agent Coordinator.'
      const ltm = { user: 'Mintnoii', project: 'NetDive', branch: 'main' }

      const boundary = compactor.createPrefixBoundary(systemPrompt, ltm)
      assert.equal(boundary.systemPrompt, systemPrompt)
      assert.ok(boundary.prefixHash)
      assert.equal(boundary.prefixHash.length, 64)

      // 再次创建哈希完全相同
      const boundary2 = compactor.createPrefixBoundary(systemPrompt, ltm)
      assert.equal(boundary.prefixHash, boundary2.prefixHash)
      assert.equal(boundary.rawCanonical, boundary2.rawCanonical)
    })

    it('verifyPrefixStability returns stable for identical serialization', () => {
      const systemPrompt = 'System Prompt v1'
      const ltm = 'LTM Memory String'
      const b1 = compactor.createPrefixBoundary(systemPrompt, ltm)
      const b2 = compactor.createPrefixBoundary(systemPrompt, ltm)

      const check = compactor.verifyPrefixStability(b1, b2)
      assert.equal(check.stable, true)
      assert.doesNotThrow(() => compactor.assertPrefixStability(b1, b2))
    })

    it('throws PrefixMutationError when System Prompt or LTM is mutated (protecting Anthropic Cache)', () => {
      const bOriginal = compactor.createPrefixBoundary('Original System Prompt', 'Original LTM')
      const bMutatedSystem = compactor.createPrefixBoundary('Mutated System Prompt', 'Original LTM')
      const bMutatedLtm = compactor.createPrefixBoundary('Original System Prompt', 'Mutated LTM')

      const checkSystem = compactor.verifyPrefixStability(bOriginal, bMutatedSystem)
      assert.equal(checkSystem.stable, false)
      assert.ok(checkSystem.diffDetails)

      assert.throws(
        () => compactor.assertPrefixStability(bOriginal, bMutatedSystem),
        (err) => err instanceof PrefixMutationError
      )

      assert.throws(
        () => compactor.assertPrefixStability(bOriginal, bMutatedLtm),
        (err) => err instanceof PrefixMutationError
      )
    })

    it('compactConversation preserves System Prompt and LTM byte-for-byte while compacting tool turns', () => {
      const systemPrompt = 'IMMUTABLE_SYSTEM_PROMPT_PREFIX_BOUNDARY'
      const ltm = { memoryKey: 'SECURE_LTM_FACT_101' }

      const rawToolOutput = Array.from({ length: 60 }, (_, i) => `Test log output line ${i + 1}`).join('\n')

      const turns: ConversationMessage[] = [
        { role: 'user', content: 'Execute test suite' },
        {
          role: 'assistant',
          tool_calls: [{ id: 'call_test_1', function: { name: 'bash', arguments: 'pnpm test' } }],
        },
        {
          role: 'tool',
          tool_call_id: 'call_test_1',
          content: rawToolOutput,
        },
      ]

      const result = compactor.compactConversation(systemPrompt, ltm, turns)
      assert.equal(result.prefixStable, true)
      assert.equal(result.systemPrompt, systemPrompt)
      assert.equal(result.walRecordsCreated, 1)
      assert.ok(result.reclaimedChars > 0)

      // 验证工具结果已折叠
      const toolMsg = result.turns[2]
      assert.ok(typeof toolMsg.content === 'string')
      assert.ok(toolMsg.content.includes('原始输出已折叠 30 行'))
    })
  })

  // ===========================================================================
  // Integration: Bridge Server & useTelemetryStream
  // ===========================================================================
  describe('Integration with Bridge Server and useTelemetryStream', () => {
    it('Bridge Server POST /api/telemetry compacts heavy tool observation and returns pointerId', async () => {
      const bridgeApp = createBridgeApp({ microCompactor: compactor })
      const heavyOutput = Array.from({ length: 50 }, (_, i) => `Step ${i + 1}: assertion ok`)

      const res = await bridgeApp.app.request('/api/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          traceId: 'trace-bridge-compact-1',
          nodeId: 'node-compact-1',
          type: 'node_complete',
          gesture: 'bash',
          title: 'Bash heavy test',
          observation: {
            exitCode: 0,
            output: heavyOutput,
          },
        }),
      })

      assert.equal(res.status, 200)
      const data = await res.json()
      assert.equal(data.ok, true)
      assert.ok(data.pointerId)
      assert.ok(data.compactSummary)

      // 验证 Bridge WAL 端点通过 HTTP 获取原始条目
      const walRes = await bridgeApp.app.request(`/api/wal/${data.pointerId}`)
      assert.equal(walRes.status, 200)
      const walData = await walRes.json()
      assert.equal(walData.ok, true)
      assert.equal(walData.entry.originalLines, 50)
      assert.equal(walData.entry.compactedLines, 31)

      // 验证 Bridge Replay 端点回放全量原始内容
      const replayRes = await bridgeApp.app.request(`/api/wal/${data.pointerId}/replay`)
      assert.equal(replayRes.status, 200)
      const replayedText = await replayRes.text()
      assert.equal(replayedText, heavyOutput.join('\n'))
    })

    it('Bridge Server GET /api/wal returns registry stats and 404 for unknown pointer', async () => {
      const bridgeApp = createBridgeApp({ microCompactor: compactor })

      const notFoundRes = await bridgeApp.app.request('/api/wal/wal-unknown-404')
      assert.equal(notFoundRes.status, 404)

      const statsRes = await bridgeApp.app.request('/api/wal')
      assert.equal(statsRes.status, 200)
      const statsData = await statsRes.json()
      assert.ok(statsData.stats)
    })

    it('singleton microCompactor is exported and ready for application-wide use', () => {
      assert.ok(microCompactor instanceof MicroCompactor)
    })

    it('useTelemetryStream exports microCompactor instance', async () => {
      // 验证 useTelemetryStream 模块导出了全局单例 microCompactor
      const { microCompactor: hookCompactor } = await import('../hooks/useTelemetryStream')
      assert.ok(hookCompactor)
      assert.ok(hookCompactor instanceof MicroCompactor)
      assert.equal(typeof hookCompactor.compactToolOutput, 'function')
      assert.equal(typeof hookCompactor.validatePairing, 'function')
    })
  })
})
