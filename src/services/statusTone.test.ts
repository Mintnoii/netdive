/**
 * @file src/services/statusTone.test.ts
 * @description 状态语义色单一真源契约测试
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_FAILED_STROKE,
  BRANCH_EDGE_STYLE,
  TONE_FILL,
  TONE_STROKE,
  isInputOnlyTurn,
  minimapNodeFill,
  minimapNodeStroke,
  resolveAgentTone,
  resolveNodeTone,
  resolveTurnTone,
} from './statusTone'

describe('Status Tone 单一真源契约', () => {
  it('原子节点色调按 失败 > 门禁 > 自愈 > 聚合 > 运行中 > 完成 优先级判定', () => {
    assert.equal(resolveAgentTone({ status: 'failed' } as never), 'failed')
    assert.equal(resolveAgentTone({ status: 'gate', isCorrectionBranch: true } as never), 'gate')
    assert.equal(resolveAgentTone({ isCorrectionBranch: true } as never), 'branching')
    assert.equal(resolveAgentTone({ isAggregated: true } as never), 'aggregated')
    assert.equal(resolveAgentTone({ pruned: true } as never), 'pruned')
    assert.equal(resolveAgentTone({ status: 'running' } as never), 'running')
    assert.equal(resolveAgentTone({ status: 'completed' } as never), 'success')
    assert.equal(resolveAgentTone(undefined), 'success')
  })

  it('纯人类输入回合判定为 inputOnly，不误判带工具回合', () => {
    assert.equal(isInputOnlyTurn({ toolCounts: {}, subEvents: [{ actor: 'Human Operator' }] } as never), true)
    assert.equal(isInputOnlyTurn({ toolCounts: { bash: 1 }, subEvents: [] } as never), false)
    assert.equal(
      isInputOnlyTurn({ toolCounts: {}, subEvents: [{ actor: 'Pi' }, { actor: 'Pi' }] } as never),
      false
    )
  })

  it('回合色调查表直给，未知状态回落 success', () => {
    assert.equal(resolveTurnTone({ toolCounts: { bash: 2 }, status: 'failed' } as never), 'failed')
    assert.equal(resolveTurnTone({ toolCounts: { bash: 2 }, status: 'branching' } as never), 'branching')
    assert.equal(resolveTurnTone({ toolCounts: { bash: 2 }, status: 'unknown-status' } as never), 'success')
    assert.equal(resolveTurnTone({ toolCounts: {}, subEvents: [] } as never), 'inputOnly')
  })

  it('节点色调统一入口识别回合节点与原子节点', () => {
    assert.equal(
      resolveNodeTone({ id: 'turn-1', type: 'turnNode', data: { toolCounts: { bash: 1 }, status: 'gate' } }),
      'gate'
    )
    assert.equal(resolveNodeTone({ id: 'node-1', data: { status: 'gate' } }), 'gate')
  })

  it('小地图描边：原子失败单独加深，其余走字典', () => {
    assert.equal(minimapNodeStroke({ id: 'node-1', data: { status: 'failed' } }), AGENT_FAILED_STROKE)
    assert.equal(minimapNodeStroke({ id: 'turn-1', data: { toolCounts: { bash: 1 }, status: 'failed' } }), TONE_STROKE.failed)
    assert.equal(minimapNodeStroke({ id: 'node-2', data: { status: 'gate' } }), TONE_STROKE.gate)
  })

  it('小地图填充与分支连线样式取自同一字典', () => {
    assert.equal(minimapNodeFill({ id: 'node-3', data: { status: 'completed' } }), TONE_FILL.success)
    assert.equal(BRANCH_EDGE_STYLE.stroke, TONE_STROKE.branching)
    assert.equal(BRANCH_EDGE_STYLE.strokeDasharray, '5 4')
  })
})
