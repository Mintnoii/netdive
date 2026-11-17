/**
 * @file src/services/flowLayout.test.ts
 * @description 拓扑布局与连线语义单一真源契约测试
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Node } from '@xyflow/react'
import {
  FLOW_LAYOUT,
  causalNodePosition,
  createFlowEdge,
  isBranchEdgeBetween,
  resolveFlowEdgeStyle,
  wrapGridPosition,
} from './flowLayout'
import { BRANCH_EDGE_STYLE, FAILED_EDGE_STROKE, NEUTRAL_EDGE_STROKE } from './statusTone'

/** 构造最小节点桩件 */
function nodeAt(id: string, x: number, y: number, isBranch = false): Node {
  return { id, position: { x, y }, data: { isCorrectionBranch: isBranch } }
}

describe('Flow Layout 单一真源契约', () => {
  describe('回放侧折行网格 wrapGridPosition', () => {
    it('首节点落在起点，主干逐列右移', () => {
      assert.deepEqual(wrapGridPosition(0, false), { x: FLOW_LAYOUT.startX, y: FLOW_LAYOUT.baseY })
      assert.deepEqual(wrapGridPosition(2, false), {
        x: FLOW_LAYOUT.startX + 2 * FLOW_LAYOUT.stepX,
        y: FLOW_LAYOUT.baseY,
      })
    })

    it('满一行后折行，X 归零且 Y 下移一个行距', () => {
      const perRow = FLOW_LAYOUT.nodesPerRow
      const wrapped = wrapGridPosition(perRow, false)
      assert.equal(wrapped.x, FLOW_LAYOUT.startX)
      assert.equal(wrapped.y, FLOW_LAYOUT.baseY + FLOW_LAYOUT.rowGap)
    })

    it('自愈分支在同一行基础上下沉固定偏移', () => {
      const main = wrapGridPosition(1, false)
      const branch = wrapGridPosition(1, true)
      assert.equal(branch.x, main.x)
      assert.equal(branch.y, main.y + FLOW_LAYOUT.branchOffset)
    })

    it('支持场景级参数覆盖', () => {
      assert.deepEqual(wrapGridPosition(3, false, { nodesPerRow: 2, stepX: 100, rowGap: 50 }), {
        x: FLOW_LAYOUT.startX + 100,
        y: FLOW_LAYOUT.baseY + 50,
      })
    })
  })

  describe('实时侧因果坐标 causalNodePosition', () => {
    it('无父节点时按既有节点数铺续', () => {
      assert.deepEqual(causalNodePosition(undefined, 0), {
        x: FLOW_LAYOUT.startX,
        y: FLOW_LAYOUT.baseY,
      })
      assert.deepEqual(causalNodePosition(undefined, 3), {
        x: FLOW_LAYOUT.startX + 3 * FLOW_LAYOUT.stepX,
        y: FLOW_LAYOUT.baseY,
      })
    })

    it('有父节点时沿父节点右移一个步距，坐标严格单调递增', () => {
      const parent = nodeAt('p', 330, 180)
      const child = causalNodePosition(parent, 1)
      assert.equal(child.x, 330 + FLOW_LAYOUT.stepX)
      assert.ok(child.x > parent.position.x, '子节点必须位于父节点右侧')
    })

    it('自愈分支下沉，且与主干同 X', () => {
      const parent = nodeAt('p', 330, 180)
      const main = causalNodePosition(parent, 1, false)
      const branch = causalNodePosition(parent, 1, true)
      assert.equal(branch.x, main.x)
      assert.equal(branch.y, main.y + FLOW_LAYOUT.branchOffset)
    })
  })

  describe('连线样式优先级与动画语义', () => {
    it('样式优先级：自愈分支 > 失败 > 常规', () => {
      assert.deepEqual(resolveFlowEdgeStyle(true, 'failed'), BRANCH_EDGE_STYLE)
      assert.deepEqual(resolveFlowEdgeStyle(false, 'failed'), {
        stroke: FAILED_EDGE_STROKE,
        strokeWidth: 2,
      })
      assert.deepEqual(resolveFlowEdgeStyle(false, 'completed'), {
        stroke: NEUTRAL_EDGE_STROKE,
        strokeWidth: 1.5,
      })
    })

    it('createFlowEdge 生成标准 smoothstep 边，运行中或无状态时流动', () => {
      const running = createFlowEdge({ source: 'a', target: 'b', status: 'running' })
      assert.equal(running.id, 'e-a-b')
      assert.equal(running.type, 'smoothstep')
      assert.equal(running.animated, true)

      const stateless = createFlowEdge({ source: 'a', target: 'b' })
      assert.equal(stateless.animated, true)

      const done = createFlowEdge({ source: 'a', target: 'b', status: 'completed' })
      assert.equal(done.animated, false)
    })

    it('回放侧可显式覆盖动画语义', () => {
      const branchStatic = createFlowEdge({
        source: 'a',
        target: 'b',
        isBranchEdge: true,
        animated: false,
      })
      assert.equal(branchStatic.animated, false)
      assert.deepEqual(branchStatic.style, BRANCH_EDGE_STYLE)
    })
  })

  describe('分支边判定 isBranchEdgeBetween', () => {
    it('当前事件或父节点任一处于自愈分支即成分支边', () => {
      assert.equal(isBranchEdgeBetween({ isCorrectionBranch: true }), true)
      assert.equal(
        isBranchEdgeBetween({ isCorrectionBranch: false }, nodeAt('p', 0, 0, true)),
        true
      )
      assert.equal(isBranchEdgeBetween({ isCorrectionBranch: false }, nodeAt('p', 0, 0, false)), false)
      assert.equal(isBranchEdgeBetween({}), false)
    })
  })
})
