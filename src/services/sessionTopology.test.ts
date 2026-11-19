/**
 * @file src/services/sessionTopology.test.ts
 * @description 会话拓扑纯逻辑层契约测试（会话归约 / 因果建链 / 剪枝提取 / 水位映射 / 瘦节点）
 */

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { Node } from '@xyflow/react'
import type { AgentNodeData } from '../components/AgentNode'
import type { TelemetryEvent } from '../types/telemetry'
import { assertionEngine } from './assertionEngine'
import {
  DEFAULT_SESSION_ID,
  calculateNodePosition,
  createInitialSession,
  extractPrunableItems,
  getDynamicWatermarkDelta,
  processEventForSession,
  processEventForSessions,
  resolveCausalConnection,
} from './sessionTopology'
import { FLOW_LAYOUT } from './flowLayout'

/** 构造标准遥测事件 */
function makeEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    nodeId: 'node-1',
    sessionId: 'session-a',
    type: 'node_complete',
    gesture: 'bash',
    actor: 'Pi (Coordinator)',
    title: '跑单测',
    status: 'completed',
    timestamp: 1_700_000_000_000,
    ...overrides,
  }
}

describe('Session Topology 纯逻辑层契约', () => {
  beforeEach(() => {
    assertionEngine.clearHistory()
  })

  describe('会话模型 createInitialSession', () => {
    it('无事件时使用默认会话标识与标题', () => {
      const session = createInitialSession('session-a')
      assert.equal(session.id, 'session-a')
      assert.deepEqual(session.nodes, [])
      assert.deepEqual(session.edges, [])
      assert.ok(session.title.length > 0)
    })

    it('携带事件时优先采用显式会话标题与工程名', () => {
      const session = createInitialSession(
        'session-b',
        makeEvent({ sessionTitle: 'Ghost 管道重构', project: 'ghost' })
      )
      assert.equal(session.title, 'Ghost 管道重构')
      assert.equal(session.project, 'ghost')
      assert.deepEqual(session.actors, ['Pi (Coordinator)'])
    })
  })

  describe('因果建链 resolveCausalConnection', () => {
    it('无父节点时判定为根节点', () => {
      const res = resolveCausalConnection(makeEvent({ status: 'running' }), [], undefined)
      assert.equal(res.isRoot, true)
      assert.equal(res.edge, undefined)
    })

    it('父节点不存在时熔断连线，杜绝悬空边', () => {
      const res = resolveCausalConnection(
        makeEvent({ parentId: 'ghost-parent', status: 'running' }),
        [],
        undefined
      )
      assert.equal(res.edge, undefined)
    })

    it('父节点存在时生成标准 smoothstep 因果边', () => {
      const parent = { id: 'p-1', position: { x: 0, y: 0 }, data: {} } as Node
      const res = resolveCausalConnection(
        makeEvent({ parentId: 'p-1', nodeId: 'c-1', status: 'running' }),
        [parent],
        undefined
      )
      assert.equal(res.effectiveParentId, 'p-1')
      assert.equal(res.edge?.id, 'e-p-1-c-1')
      assert.equal(res.edge?.type, 'smoothstep')
    })
  })

  describe('事件归约 processEventForSession', () => {
    it('首条事件建节点，节点坐标落在起点', () => {
      const session = createInitialSession('session-a')
      const next = processEventForSession(session, makeEvent({ nodeId: 'n-1' }))

      assert.equal(next.nodes.length, 1)
      assert.equal(next.nodes[0].id, 'n-1')
      assert.deepEqual(next.nodes[0].position, { x: 50, y: 180 })
      assert.equal(next.lastNodeId, 'n-1')
    })

    it('带父节点的事件同时建节点与因果边', () => {
      let session = createInitialSession('session-a')
      session = processEventForSession(session, makeEvent({ nodeId: 'n-1' }))
      session = processEventForSession(
        session,
        makeEvent({ nodeId: 'n-2', parentId: 'n-1', status: 'running' })
      )

      assert.equal(session.nodes.length, 2)
      assert.ok(session.edges.some((e) => e.id === 'e-n-1-n-2'))
      assert.ok(session.nodes[1].position.x > session.nodes[0].position.x)
    })

    it('同 nodeId 重复事件更新既有节点而不新建', () => {
      let session = createInitialSession('session-a')
      session = processEventForSession(session, makeEvent({ nodeId: 'n-1', status: 'running' }))
      session = processEventForSession(
        session,
        makeEvent({ nodeId: 'n-1', status: 'completed', delta: ' 完成' })
      )

      assert.equal(session.nodes.length, 1)
      const data = session.nodes[0].data as unknown as AgentNodeData
      assert.equal(data.status, 'completed')
      assert.match(data.summary ?? '', /完成/)
    })

    it('非零退出码判定为失败，显式自愈标记的节点下沉为分支', () => {
      let session = createInitialSession('session-a')
      session = processEventForSession(
        session,
        makeEvent({
          nodeId: 'n-fail',
          gesture: 'bash',
          status: 'failed',
          isCorrectionBranch: true,
          observation: { exitCode: 1, output: ['✖ 3 tests failed'] },
        })
      )

      const node = session.nodes[0]
      assert.equal(node.position.y, FLOW_LAYOUT.baseY + FLOW_LAYOUT.branchOffset, '自愈分支节点必须下沉')
      const data = node.data as unknown as AgentNodeData
      assert.equal(data.status, 'failed')
      assert.equal(data.isCorrectionBranch, true)
    })
  })

  describe('多会话隔离 processEventForSessions', () => {
    it('不同 sessionId 的事件互不混流', () => {
      const first = processEventForSessions({}, makeEvent({ sessionId: 's-1', nodeId: 'a-1' }))
      const second = processEventForSessions(
        first.nextSessions,
        makeEvent({ sessionId: 's-2', nodeId: 'b-1' })
      )

      assert.equal(Object.keys(second.nextSessions).length, 2)
      assert.equal(second.nextSessions['s-1'].nodes.length, 1)
      assert.equal(second.nextSessions['s-2'].nodes.length, 1)
      assert.equal(second.nextSessions['s-1'].nodes[0].id, 'a-1')
    })

    it('无 nodeId 的纯通知事件在空会话中不生成空会话', () => {
      const ghost = processEventForSessions(
        {},
        makeEvent({ sessionId: 's-3', nodeId: 'ghost', type: 'gate_resolved', gesture: 'gate' })
      )
      assert.equal(ghost.updatedSession.nodes.length, 0)
    })
  })

  describe('瘦节点契约 (AGENTS.md §3.3)', () => {
    it('实时轨道建出的节点 data 不携带 observation / payload 大对象', () => {
      const session = processEventForSession(
        createInitialSession('session-a'),
        makeEvent({
          nodeId: 'n-heavy',
          observation: { exitCode: 0, output: Array.from({ length: 50 }, (_, i) => `line ${i}`) },
          payload: { command: 'pnpm test', diff: 'x'.repeat(500) },
        })
      )

      const data = session.nodes[0].data as unknown as AgentNodeData
      assert.equal(data.observation, undefined, '节点严禁携带完整 observation')
      assert.equal(data.payload, undefined, '节点严禁携带完整 payload')
    })
  })

  describe('剪枝条目提取 extractPrunableItems', () => {
    it('跳过运行中节点，保留已完成工具调用并给出摘要', () => {
      const items = extractPrunableItems([
        {
          id: 'n-run',
          position: { x: 0, y: 0 },
          data: { gesture: 'bash', status: 'running', title: '运行中' },
        } as Node,
        {
          id: 'n-done',
          position: { x: 0, y: 0 },
          data: { gesture: 'bash', status: 'completed', title: '跑单测', summary: '$ pnpm test' },
        } as Node,
      ])

      assert.equal(items.length, 1)
      assert.equal(items[0].id, 'n-done')
      assert.equal(items[0].gesture, 'bash')
    })

    it('空数组安全返回', () => {
      assert.deepEqual(extractPrunableItems([]), [])
    })
  })

  describe('水位增量 getDynamicWatermarkDelta', () => {
    it('按手势映射增量，重输出工具给出更高 prunable', () => {
      const heavy = getDynamicWatermarkDelta({
        gesture: 'bash',
        observation: { output: ['a', 'b', 'c'] },
      })
      const idle = getDynamicWatermarkDelta({ gesture: 'think' })

      assert.ok((heavy.prunableTools ?? 0) > (idle.prunableTools ?? 0))
      assert.ok((idle.activeTurns ?? 0) >= 0)
      assert.deepEqual(getDynamicWatermarkDelta(undefined), { activeTurns: 2000, prunableTools: 0 })
    })
  })

  describe('坐标纯函数 calculateNodePosition', () => {
    it('沿父节点顺延，缺父节点时按节点数铺续', () => {
      const parent = { id: 'p', position: { x: 330, y: 180 }, data: {} } as Node
      assert.deepEqual(calculateNodePosition({}, 'p', [parent]), {
        x: 330 + FLOW_LAYOUT.stepX,
        y: 180,
      })
      assert.deepEqual(calculateNodePosition({ isCorrectionBranch: true }, undefined, []), {
        x: 50,
        y: FLOW_LAYOUT.baseY + FLOW_LAYOUT.branchOffset,
      })
    })
  })

  it('默认会话标识常量保持稳定', () => {
    assert.equal(DEFAULT_SESSION_ID, 'demo-session')
  })
})
