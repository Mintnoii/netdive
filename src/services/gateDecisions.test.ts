/**
 * @file src/services/gateDecisions.test.ts
 * @description 门禁裁决信封纯函数契约测试
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_REJECT_FEEDBACK,
  buildApproveDecision,
  buildModifyDecision,
  buildRejectDecision,
} from './gateDecisions'

describe('Gate Decision 信封契约', () => {
  it('批准放行只携带 approve 语义', () => {
    assert.deepEqual(buildApproveDecision(), { action: 'approve' })
  })

  it('热纠偏必须回传 modifiedCommand 给 Agent', () => {
    const decision = buildModifyDecision('  git commit --amend  ')
    assert.equal(decision.action, 'modify')
    assert.equal(decision.modifiedCommand, 'git commit --amend', '首尾空白必须裁剪')
    assert.equal(decision.feedback, decision.modifiedCommand)
  })

  it('拒绝时保留人类理由', () => {
    assert.deepEqual(buildRejectDecision('风险太高'), {
      action: 'reject',
      feedback: '风险太高',
    })
  })

  it('拒绝时未填理由给出确定性兜底文案', () => {
    assert.deepEqual(buildRejectDecision('   '), {
      action: 'reject',
      feedback: DEFAULT_REJECT_FEEDBACK,
    })
  })
})
