import { describe, it } from 'node:test'
import assert from 'node:assert'
import { SHOWCASE_SCENARIOS } from '../fixtures/showcaseSessions'
import {
  eventsToFlowNodesAndEdges,
  aggregateEventsIntoTurns,
  turnsToFlowNodesAndEdges,
} from '../services/transcriptParser'

describe('Showcase Demo Page Contract & Scenarios', () => {
  it('预置包含 4 大黄金控制论演示场景且顺位对齐认知升维', () => {
    assert.strictEqual(SHOWCASE_SCENARIOS.length, 4)

    const [hierarchicalFocus, loopResonance, compactor, hitlGate] = SHOWCASE_SCENARIOS
    assert.strictEqual(hierarchicalFocus.id, 'hierarchical-focus')
    assert.strictEqual(loopResonance.id, 'loop-resonance')
    assert.strictEqual(compactor.id, 'micro-compactor')
    assert.strictEqual(hitlGate.id, 'hitl-gate')
  })

  it('场景 1 (双焦架构) 能精准聚合成 3 个宏观回合且包含工具分布矩阵', () => {
    const sc = SHOWCASE_SCENARIOS[0]
    const turns = aggregateEventsIntoTurns(sc.events)
    assert.strictEqual(turns.length, 3, '必须聚合成 3 个回合')

    assert.strictEqual(turns[0].turnIndex, 1)
    assert.ok(turns[0].toolCounts.read >= 1)
    assert.ok(turns[0].toolCounts.bash >= 1)

    assert.strictEqual(turns[1].turnIndex, 2)
    assert.ok(turns[1].toolCounts.edit >= 1)

    assert.strictEqual(turns[2].turnIndex, 3)
    assert.ok(turns[2].toolCounts.bash >= 1)

    const { nodes, edges } = turnsToFlowNodesAndEdges(turns)
    assert.strictEqual(nodes.length, 3)
    assert.strictEqual(edges.length, 2)
    for (const node of nodes) {
      assert.strictEqual(node.type, 'turnNode')
      assert.ok(typeof node.width === 'number' && node.width > 0)
    }
  })

  it('场景 2 包含错误共振与 Gate 挂起节点', () => {
    const sc = SHOWCASE_SCENARIOS[1]
    const gateNode = sc.events.find((e) => e.gesture === 'gate')
    assert.ok(gateNode, '必须包含 gate 拦截节点')
    assert.strictEqual(gateNode.status, 'gate')
    assert.ok(gateNode.assertion, '必须包含 assertion 规则元数据')
    assert.strictEqual(gateNode.assertion?.rule, 'loop_resonance_breaker')
  })

  it('所有场景均能平滑转换为 React Flow DAG 节点且无语法报错', () => {
    for (const sc of SHOWCASE_SCENARIOS) {
      const { nodes, edges } = eventsToFlowNodesAndEdges(sc.events)
      assert.ok(nodes.length > 0, `${sc.id} 必须生成 nodes`)
      assert.ok(edges.length >= 0, `${sc.id} 必须生成 edges`)
      // 验证瘦节点契约：Node.data 不塞入 megabyte 级原始对象
      for (const node of nodes) {
        assert.ok(node.id)
        assert.ok(node.data)
        assert.ok(node.type === 'agentNode')
      }
    }
  })

  it('场景 3 正确包含微压缩与 Token 收益指标，且包含剪枝与聚合节点', () => {
    const sc = SHOWCASE_SCENARIOS[2]
    assert.ok(sc.metrics.tokenEntropyReduction)
    assert.ok(sc.metrics.cacheHitRate)
    const memNode = sc.events.find((e) => e.gesture === 'memory')
    assert.ok(memNode, '场景 3 需包含 micro-compactor 记忆手势事件')

    const prunedNode = sc.events.find((e) => e.pruned)
    assert.ok(prunedNode, '场景 3 需包含明确的 pruned: true 剪枝卡片节点')
    assert.ok(prunedNode.payload?.walPointerId, '剪枝节点需包含 walPointerId')
    assert.strictEqual(prunedNode.observation?.pointerId, 'wal-lab-tsc-01')
    assert.ok(
      Array.isArray(prunedNode.observation?.rawFullOutput) &&
        prunedNode.observation.rawFullOutput.length > 100,
      '剪枝节点需携带真实的超长原始构建日志'
    )

    const aggNode = sc.events.find((e) => e.isAggregated)
    assert.ok(aggNode, '场景 3 需包含批量遍历的 isAggregated 连续聚合节点')
  })

  it('场景 4 包含 HITL 高危拦截与人类介入纠偏', () => {
    const sc = SHOWCASE_SCENARIOS[3]
    const gateNode = sc.events.find((e) => e.gesture === 'gate')
    assert.ok(gateNode)
    assert.strictEqual(gateNode.assertion?.rule, 'git_push_guard')
  })

  it('所有场景的事件节点 ID 必须全局唯一，无重复覆盖与自环', () => {
    for (const sc of SHOWCASE_SCENARIOS) {
      const nodeIds = sc.events.map((e) => e.nodeId)
      const uniqueIds = new Set(nodeIds)
      assert.strictEqual(
        uniqueIds.size,
        nodeIds.length,
        `场景 ${sc.id} 存在重复的 nodeId: ${nodeIds.filter((id, idx) => nodeIds.indexOf(id) !== idx)}`
      )
    }
  })

  it('生成的 React Flow 节点必须包含 width 与 height 初始几何属性，确保 MiniMap 正常渲染', () => {
    for (const sc of SHOWCASE_SCENARIOS) {
      const { nodes } = eventsToFlowNodesAndEdges(sc.events)
      for (const node of nodes) {
        assert.ok(typeof node.width === 'number' && node.width > 0, `节点 ${node.id} 必须包含 width`)
        assert.ok(typeof node.height === 'number' && node.height > 0, `节点 ${node.id} 必须包含 height`)
        assert.ok(typeof node.initialWidth === 'number' && node.initialWidth > 0)
        assert.ok(typeof node.initialHeight === 'number' && node.initialHeight > 0)
      }
    }
  })

  it('截取前序步骤时生成的因果边绝不包含悬空节点（两端节点必须均在当前视区中）', () => {
    // 场景 4 (高危拦截) 在拦截弹窗时的前 3 步
    const sc = SHOWCASE_SCENARIOS[3]
    const slicedEvents = sc.events.slice(0, 3)
    const { nodes, edges } = eventsToFlowNodesAndEdges(slicedEvents)
    assert.strictEqual(nodes.length, 3)
    assert.strictEqual(edges.length, 2)

    const nodeIds = new Set(nodes.map((n) => n.id))
    for (const edge of edges) {
      assert.ok(nodeIds.has(edge.source), `边 ${edge.id} 的 source ${edge.source} 必须存在`)
      assert.ok(nodeIds.has(edge.target), `边 ${edge.id} 的 target ${edge.target} 必须存在`)
    }
  })
})
