import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  STANDARD_GOVERNANCE_SCENARIO,
  computeSimulationSnapshot,
} from './contextGovernanceEngine'

describe('contextGovernanceEngine (Node test runner)', () => {
  it('应当包含标准的 9 步完整炼化流水线场景与置顶约束', () => {
    assert.strictEqual(STANDARD_GOVERNANCE_SCENARIO.steps.length, 9)
    assert.ok(STANDARD_GOVERNANCE_SCENARIO.pinned.userGoal.includes('RAG'))
    assert.ok(STANDARD_GOVERNANCE_SCENARIO.pinned.systemPrompt.includes('Knowledge Distiller'))
    assert.ok(STANDARD_GOVERNANCE_SCENARIO.pinned.registeredTools.length >= 4)
    assert.ok(STANDARD_GOVERNANCE_SCENARIO.pinned.hardConstraints.length >= 3)
  })

  it('单步快照计算应平稳步进并正确标识软边界与巨型输出', () => {
    const snap0 = computeSimulationSnapshot(STANDARD_GOVERNANCE_SCENARIO, 0)
    assert.strictEqual(snap0.currentStepIndex, 0)
    assert.strictEqual(snap0.currentStep.isSafeBoundary, false)
    assert.strictEqual(snap0.currentStep.hasLargePayload, false)

    // 步骤 4 为前半段定稿安全软边界
    const snap4 = computeSimulationSnapshot(STANDARD_GOVERNANCE_SCENARIO, 4)
    assert.strictEqual(snap4.currentStep.isSafeBoundary, true)

    // 步骤 5 为 186 张卡片向量比对巨型输出
    const snap5 = computeSimulationSnapshot(STANDARD_GOVERNANCE_SCENARIO, 5)
    assert.strictEqual(snap5.currentStepIndex, 5)
    assert.strictEqual(snap5.currentStep.hasLargePayload, true)
    assert.ok((snap5.currentStep.largePayloadLines ?? 0) > 1000)
    assert.ok(snap5.rawTokensTotal > 1500)
  })

  it('随着步骤推进应动态累积达成业务里程碑驱动前缀演进', () => {
    const snap0 = computeSimulationSnapshot(STANDARD_GOVERNANCE_SCENARIO, 0)
    const snap4 = computeSimulationSnapshot(STANDARD_GOVERNANCE_SCENARIO, 4)
    const snap8 = computeSimulationSnapshot(STANDARD_GOVERNANCE_SCENARIO, 8)

    assert.ok(snap4.pinnedDirectives.completedMilestones.length > snap0.pinnedDirectives.completedMilestones.length)
    assert.ok(snap8.pinnedDirectives.completedMilestones.length >= 8)
  })

  it('前半段打包精简生效时应大幅释放空间并登记台账', () => {
    const beforePrune = computeSimulationSnapshot(STANDARD_GOVERNANCE_SCENARIO, 4, {}, false)
    const afterPrune = computeSimulationSnapshot(STANDARD_GOVERNANCE_SCENARIO, 4, {}, true)

    assert.ok(afterPrune.optimizedTokensTotal < beforePrune.rawTokensTotal)
    assert.ok(afterPrune.reclaimedTokensTotal > 500)
    assert.strictEqual(afterPrune.contextState.offloadedLedger.records[0].pointerId, 'wal-stage-1-summary')
    // 台账记录的释放量与 budget 汇总应严格一致（都由真实计算得出）
    assert.strictEqual(
      afterPrune.contextState.offloadedLedger.records[0].reclaimedTokens,
      afterPrune.reclaimedTokensTotal
    )
  })

  it('掐头去尾与打包精简应按索引 ID 保存完整原文，支持精确取回', () => {
    const snap = computeSimulationSnapshot(STANDARD_GOVERNANCE_SCENARIO, 5, { 5: true }, true)
    const store = snap.contextState.offloadedLedger.backupStore

    // 掐头去尾的大输出原文按 ID 存回
    const bigBackup = store.get('wal-call-step-6')
    assert.ok(bigBackup, '应存在大输出备份记录')
    assert.strictEqual(bigBackup.type, 'large_tool_output')
    assert.strictEqual(bigBackup.stepIndex, 5)
    assert.ok(bigBackup.fullText.includes('ghost:vector-match'))
    assert.ok(bigBackup.fullText.includes('Process exited with code 0'))

    // 打包精简的前半段原文按 ID 存回
    const stageBackup = store.get('wal-stage-1-summary')
    assert.ok(stageBackup, '应存在前半段精简备份记录')
    assert.strictEqual(stageBackup.type, 'pruned_history')
    assert.ok(stageBackup.fullText.includes('扫描素材与 YAML 解析'))
    assert.ok(stageBackup.fullText.includes('大模型并发抽取三大核心卡'))

    // 台账中的每条指针都能在备份仓库里精确命中（无悬空指针）
    for (const rec of snap.contextState.offloadedLedger.records) {
      assert.ok(store.has(rec.pointerId), `台账指针 ${rec.pointerId} 应能按 ID 取回原文`)
    }
  })

  it('连续同构调用折叠为聚合节点时应消除重复 Schema 样板并登记台账', () => {
    const beforeCoalesce = computeSimulationSnapshot(STANDARD_GOVERNANCE_SCENARIO, 3, {}, false, false, { 3: false })
    const afterCoalesce = computeSimulationSnapshot(STANDARD_GOVERNANCE_SCENARIO, 3, {}, false, false, { 3: true })

    assert.ok(afterCoalesce.optimizedTokensTotal < beforeCoalesce.rawTokensTotal)
    assert.ok(afterCoalesce.reclaimedTokensTotal >= 700) // schemaOverheadTokens 380 * (3-1)
    const rec = afterCoalesce.contextState.offloadedLedger.records.find((r) => r.type === 'coalesced_calls')
    assert.ok(rec, '应登记一条同构折叠记录')
    assert.strictEqual(rec.compactedLines, 1)
    assert.ok(afterCoalesce.contextState.offloadedLedger.backupStore.has(rec.pointerId))
  })

  it('模拟注入时间戳时应导致前缀哈希突变并标记缓存失效', () => {
    const pristine = computeSimulationSnapshot(STANDARD_GOVERNANCE_SCENARIO, 2, {}, false, false)
    const mutated = computeSimulationSnapshot(STANDARD_GOVERNANCE_SCENARIO, 2, {}, false, true)

    assert.notStrictEqual(pristine.prefixHash, mutated.prefixHash)
    assert.strictEqual(pristine.contextState.staticPrefix.isCacheStable, true)
    assert.strictEqual(mutated.contextState.staticPrefix.isCacheStable, false)
  })

  it('单步超长输出掐头去尾应能精确减少 Token 水位并保留前缀哈希', () => {
    const beforeOpt = computeSimulationSnapshot(STANDARD_GOVERNANCE_SCENARIO, 5, { 5: false })
    const afterOpt = computeSimulationSnapshot(STANDARD_GOVERNANCE_SCENARIO, 5, { 5: true })

    assert.ok(afterOpt.optimizedTokensTotal < beforeOpt.rawTokensTotal)
    assert.ok(afterOpt.savedPercent > 40)
    assert.ok(afterOpt.reclaimedTokensTotal > 1000)
    assert.strictEqual(afterOpt.prefixHash, beforeOpt.prefixHash)
  })
})
