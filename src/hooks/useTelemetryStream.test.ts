import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Node } from '@xyflow/react'
import type { AgentNodeData } from '../components/AgentNode'
import type { TelemetryEvent, ActiveSessionItem } from '../types/telemetry'
import {
  resolveCausalConnection,
  calculateNodePosition,
  createInitialSession,
  processEventForSession,
  processEventForSessions,
  useTelemetryStream,
  type SessionData,
} from './useTelemetryStream'
import {
  resolveSessionId,
  resolveSessionTitle,
  formatRelativeTime,
} from '../types/telemetry'

describe('useTelemetryStream & Causal DAG Multi-Session Engine', () => {
  describe('1. resolveCausalConnection 纯函数与 OpenTelemetry Active Span 契约', () => {
    it('首个节点作为根节点：无 parentId 且无 lastNodeId 时返回 isRoot: true 与 edge: undefined', () => {
      const event: Partial<TelemetryEvent> = {
        nodeId: 'node-root-1',
        title: '初始目标规划',
      }
      const existingNodes: Node[] = []
      const resolution = resolveCausalConnection(event, existingNodes, undefined)

      assert.equal(resolution.isRoot, true)
      assert.equal(resolution.effectiveParentId, undefined)
      assert.equal(resolution.edge, undefined)
    })

    it('无 parentId 时自动回退连接上一节点：OpenTelemetry Active Span 自动建链消灭孤岛', () => {
      const existingNodes: Node[] = [
        {
          id: 'node-step-1',
          type: 'agentNode',
          position: { x: 50, y: 180 },
          data: { title: 'Step 1' },
        },
      ]
      const event: Partial<TelemetryEvent> = {
        nodeId: 'node-step-2',
        title: 'Step 2 代码生成',
        status: 'running',
      }
      const resolution = resolveCausalConnection(event, existingNodes, 'node-step-1')

      assert.equal(resolution.isRoot, false)
      assert.equal(resolution.effectiveParentId, 'node-step-1')
      assert.ok(resolution.edge)
      assert.equal(resolution.edge?.id, 'e-node-step-1-node-step-2')
      assert.equal(resolution.edge?.source, 'node-step-1')
      assert.equal(resolution.edge?.target, 'node-step-2')
      assert.equal(resolution.edge?.type, 'smoothstep')
      assert.equal(resolution.edge?.animated, true)
      assert.deepEqual(resolution.edge?.style, { stroke: '#8F887D', strokeWidth: 1.5 })
    })

    it('有显式 parentId 时优先连接 parentId：即使传入不同的 lastNodeId 亦不被覆盖', () => {
      const existingNodes: Node[] = [
        {
          id: 'node-fork-parent',
          type: 'agentNode',
          position: { x: 50, y: 180 },
          data: { title: 'Parent Node' },
        },
        {
          id: 'node-unrelated-recent',
          type: 'agentNode',
          position: { x: 330, y: 180 },
          data: { title: 'Recent Node' },
        },
      ]
      const event: Partial<TelemetryEvent> = {
        nodeId: 'node-explicit-child',
        parentId: 'node-fork-parent',
        title: 'Child from Parent',
      }
      // 传入 node-unrelated-recent 作为 lastNodeId
      const resolution = resolveCausalConnection(
        event,
        existingNodes,
        'node-unrelated-recent'
      )

      assert.equal(resolution.isRoot, false)
      assert.equal(resolution.effectiveParentId, 'node-fork-parent')
      assert.ok(resolution.edge)
      assert.equal(resolution.edge?.source, 'node-fork-parent')
      assert.equal(resolution.edge?.target, 'node-explicit-child')
      assert.equal(resolution.edge?.id, 'e-node-fork-parent-node-explicit-child')
    })

    it('自愈分支 (isCorrectionBranch) 自动生成琥珀金色虚线分支边样式', () => {
      const existingNodes: Node[] = [
        {
          id: 'node-fail-origin',
          type: 'agentNode',
          position: { x: 50, y: 180 },
          data: { title: 'Failed Command', status: 'failed' },
        },
      ]
      const event: Partial<TelemetryEvent> = {
        nodeId: 'node-react-correction',
        parentId: 'node-fail-origin',
        isCorrectionBranch: true,
        title: 'ReAct 自愈诊断分叉',
      }
      const resolution = resolveCausalConnection(event, existingNodes, 'node-fail-origin')

      assert.equal(resolution.isRoot, false)
      assert.ok(resolution.edge)
      assert.deepEqual(resolution.edge?.style, {
        stroke: '#D97706',
        strokeWidth: 1.5,
        strokeDasharray: '5 4',
      })
    })

    it('失败节点 (failed status) 自动生成红色警示边样式', () => {
      const existingNodes: Node[] = [
        {
          id: 'node-prev',
          type: 'agentNode',
          position: { x: 50, y: 180 },
          data: { title: 'Prev Node' },
        },
      ]
      const event: Partial<TelemetryEvent> = {
        nodeId: 'node-err',
        status: 'failed',
        title: 'Error Command',
      }
      const resolution = resolveCausalConnection(event, existingNodes, 'node-prev')

      assert.equal(resolution.isRoot, false)
      assert.ok(resolution.edge)
      assert.deepEqual(resolution.edge?.style, {
        stroke: '#DC2626',
        strokeWidth: 2,
      })
    })

    it('防自环安全保护：当 parentId 或 lastNodeId 与 nodeId 相同，坚决不建自环连线', () => {
      const event: Partial<TelemetryEvent> = {
        nodeId: 'node-self-loop',
        parentId: 'node-self-loop',
      }
      const resolution = resolveCausalConnection(event, [], 'node-self-loop')

      assert.equal(resolution.isRoot, true)
      assert.equal(resolution.effectiveParentId, undefined)
      assert.equal(resolution.edge, undefined)
    })
  })

  describe('2. 多会话隔离存储与因果拓扑互不混流 (Multi-Session Isolation)', () => {
    it('不同 sessionId 的事件进入后分别属于不同会话，节点和连线互不混流', () => {
      let sessions: Record<string, SessionData> = {}

      // 会话 A 第一个事件
      const eventA1: TelemetryEvent = {
        traceId: 'trace-a',
        sessionId: 'session-ghost',
        sessionTitle: 'Ghost pipeline 重构',
        nodeId: 'ghost-1',
        type: 'node_start',
        actor: 'Pi (Coordinator)',
        gesture: 'think',
        title: 'Ghost 目标分解',
        project: 'ghost',
      }
      const resA1 = processEventForSessions(sessions, eventA1)
      sessions = resA1.nextSessions

      // 会话 B 第一个事件
      const eventB1: TelemetryEvent = {
        traceId: 'trace-b',
        sessionId: 'session-tachikoma',
        sessionTitle: 'Tachikoma 采集流水线',
        nodeId: 'tachi-1',
        type: 'node_start',
        actor: 'Hermes (Agent)',
        gesture: 'read',
        title: '读取待采集队列',
        project: 'tachikoma',
      }
      const resB1 = processEventForSessions(sessions, eventB1)
      sessions = resB1.nextSessions

      // 验证初次创建且相互独立
      assert.equal(Object.keys(sessions).length, 2)
      assert.ok(sessions['session-ghost'])
      assert.ok(sessions['session-tachikoma'])
      assert.equal(sessions['session-ghost'].nodes.length, 1)
      assert.equal(sessions['session-tachikoma'].nodes.length, 1)
      assert.equal(sessions['session-ghost'].nodes[0].id, 'ghost-1')
      assert.equal(sessions['session-tachikoma'].nodes[0].id, 'tachi-1')

      // 会话 A 第二个事件（缺失 parentId，依靠 Active Span 自动连 ghost-1）
      const eventA2: TelemetryEvent = {
        traceId: 'trace-a',
        sessionId: 'session-ghost',
        nodeId: 'ghost-2',
        type: 'node_complete',
        actor: 'Claude 3.7 (Worker)',
        gesture: 'edit',
        title: '替换 try-catch',
        status: 'completed',
      }
      const resA2 = processEventForSessions(sessions, eventA2)
      sessions = resA2.nextSessions

      // 会话 B 第二个事件（缺失 parentId，依靠 Active Span 自动连 tachi-1）
      const eventB2: TelemetryEvent = {
        traceId: 'trace-b',
        sessionId: 'session-tachikoma',
        nodeId: 'tachi-2',
        type: 'node_complete',
        actor: 'Hermes (Agent)',
        gesture: 'bash',
        title: '执行下载子进程',
        status: 'completed',
      }
      const resB2 = processEventForSessions(sessions, eventB2)
      sessions = resB2.nextSessions

      // 严格验证：会话 A 拓扑
      const ghostSession = sessions['session-ghost']
      assert.equal(ghostSession.nodes.length, 2)
      assert.equal(ghostSession.edges.length, 1)
      assert.equal(ghostSession.edges[0].id, 'e-ghost-1-ghost-2')
      assert.equal(ghostSession.edges[0].source, 'ghost-1')
      assert.equal(ghostSession.edges[0].target, 'ghost-2')
      // 绝无混入 B 的节点
      assert.ok(!ghostSession.nodes.some((n) => n.id.startsWith('tachi-')))
      assert.ok(!ghostSession.edges.some((e) => e.target.startsWith('tachi-')))

      // 严格验证：会话 B 拓扑
      const tachiSession = sessions['session-tachikoma']
      assert.equal(tachiSession.nodes.length, 2)
      assert.equal(tachiSession.edges.length, 1)
      assert.equal(tachiSession.edges[0].id, 'e-tachi-1-tachi-2')
      assert.equal(tachiSession.edges[0].source, 'tachi-1')
      assert.equal(tachiSession.edges[0].target, 'tachi-2')
      // 绝无混入 A 的节点
      assert.ok(!tachiSession.nodes.some((n) => n.id.startsWith('ghost-')))
      assert.ok(!tachiSession.edges.some((e) => e.target.startsWith('ghost-')))
    })

    it('高频交替乱序流 (A1, B1, A2, B2, A3, B3) 能够完美还原两条独立的因果主干 DAG', () => {
      let sessions: Record<string, SessionData> = {}

      const stream: TelemetryEvent[] = [
        {
          traceId: 'tr-a',
          sessionId: 'ses-a',
          nodeId: 'a1',
          type: 'node_complete',
          title: 'A1 Step',
        },
        {
          traceId: 'tr-b',
          sessionId: 'ses-b',
          nodeId: 'b1',
          type: 'node_complete',
          title: 'B1 Step',
        },
        {
          traceId: 'tr-a',
          sessionId: 'ses-a',
          nodeId: 'a2',
          type: 'node_complete',
          title: 'A2 Step',
        },
        {
          traceId: 'tr-b',
          sessionId: 'ses-b',
          nodeId: 'b2',
          type: 'node_complete',
          title: 'B2 Step',
        },
        {
          traceId: 'tr-a',
          sessionId: 'ses-a',
          nodeId: 'a3',
          type: 'node_complete',
          title: 'A3 Step',
        },
        {
          traceId: 'tr-b',
          sessionId: 'ses-b',
          nodeId: 'b3',
          type: 'node_complete',
          title: 'B3 Step',
        },
      ]

      for (const ev of stream) {
        sessions = processEventForSessions(sessions, ev).nextSessions
      }

      assert.equal(sessions['ses-a'].nodes.length, 3)
      assert.equal(sessions['ses-b'].nodes.length, 3)

      // 验证 A 会话连线: a1 -> a2 -> a3
      assert.equal(sessions['ses-a'].edges.length, 2)
      assert.equal(sessions['ses-a'].edges[0].id, 'e-a1-a2')
      assert.equal(sessions['ses-a'].edges[1].id, 'e-a2-a3')

      // 验证 B 会话连线: b1 -> b2 -> b3
      assert.equal(sessions['ses-b'].edges.length, 2)
      assert.equal(sessions['ses-b'].edges[0].id, 'e-b1-b2')
      assert.equal(sessions['ses-b'].edges[1].id, 'e-b2-b3')
    })

    it('多会话协同 Agent 与所属工程列表准确累加且排重', () => {
      let sessions: Record<string, SessionData> = {}

      const events: TelemetryEvent[] = [
        {
          traceId: 'tr-multi',
          sessionId: 'ses-team',
          nodeId: 'n1',
          type: 'node_complete',
          actor: 'Pi (Coordinator)',
          project: 'ghost',
        },
        {
          traceId: 'tr-multi',
          sessionId: 'ses-team',
          nodeId: 'n2',
          type: 'node_complete',
          actor: 'Claude 3.7 (Worker)',
        },
        {
          traceId: 'tr-multi',
          sessionId: 'ses-team',
          nodeId: 'n3',
          type: 'node_complete',
          actor: 'Pi (Coordinator)', // 重复执行者，排重
        },
      ]

      for (const ev of events) {
        sessions = processEventForSessions(sessions, ev).nextSessions
      }

      const team = sessions['ses-team']
      assert.deepEqual(team.actors, ['Pi (Coordinator)', 'Claude 3.7 (Worker)'])
      assert.equal(team.project, 'ghost')
      assert.equal(team.nodes.length, 3)
    })
  })

  describe('3. 会话切换、派生列表与活跃画布驱动 (Session Switching)', () => {
    it('sessionsList 按 updatedAt 倒序精准排序', () => {
      const now = Date.now()
      const sessions: Record<string, SessionData> = {
        s1: {
          id: 's1',
          title: '早先完成的会话',
          actors: ['Pi'],
          status: 'completed',
          updatedAt: now - 50_000,
          nodes: [{ id: 'n1', type: 'agentNode', position: { x: 0, y: 0 }, data: {} }],
          edges: [],
        },
        s2: {
          id: 's2',
          title: '刚刷新的活跃会话',
          actors: ['Claude'],
          status: 'running',
          updatedAt: now,
          nodes: [
            { id: 'n2', type: 'agentNode', position: { x: 0, y: 0 }, data: {} },
            { id: 'n3', type: 'agentNode', position: { x: 0, y: 0 }, data: {} },
          ],
          edges: [],
        },
      }

      const list: ActiveSessionItem[] = Object.values(sessions)
        .map((s) => ({
          id: s.id,
          title: s.title,
          actors: s.actors,
          status: s.status,
          nodeCount: s.nodes.length,
          updatedAt: s.updatedAt,
          project: s.project,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt)

      assert.equal(list.length, 2)
      assert.equal(list[0].id, 's2')
      assert.equal(list[0].nodeCount, 2)
      assert.equal(list[1].id, 's1')
      assert.equal(list[1].nodeCount, 1)
    })

    it('selectSession 切换后提取对应会话的 nodes 和 edges，实现画布视图隔离', () => {
      const sessionAlpha: SessionData = {
        id: 'alpha',
        title: 'Alpha 任务',
        actors: ['Pi'],
        status: 'completed',
        updatedAt: 1000,
        nodes: [
          { id: 'a1', type: 'agentNode', position: { x: 50, y: 180 }, data: {} },
          { id: 'a2', type: 'agentNode', position: { x: 330, y: 180 }, data: {} },
        ],
        edges: [
          { id: 'e-a1-a2', source: 'a1', target: 'a2', type: 'smoothstep' },
        ],
      }

      const sessionBeta: SessionData = {
        id: 'beta',
        title: 'Beta 任务',
        actors: ['Claude'],
        status: 'running',
        updatedAt: 2000,
        nodes: [
          { id: 'b1', type: 'agentNode', position: { x: 50, y: 180 }, data: {} },
        ],
        edges: [],
      }

      const sessions: Record<string, SessionData> = {
        alpha: sessionAlpha,
        beta: sessionBeta,
      }

      // 模拟 selectSession('alpha')
      let activeId = 'alpha'
      let activeCanvasNodes = sessions[activeId].nodes
      let activeCanvasEdges = sessions[activeId].edges
      assert.equal(activeCanvasNodes.length, 2)
      assert.equal(activeCanvasEdges.length, 1)
      assert.equal(activeCanvasNodes[0].id, 'a1')

      // 模拟 selectSession('beta')
      activeId = 'beta'
      activeCanvasNodes = sessions[activeId].nodes
      activeCanvasEdges = sessions[activeId].edges
      assert.equal(activeCanvasNodes.length, 1)
      assert.equal(activeCanvasEdges.length, 0)
      assert.equal(activeCanvasNodes[0].id, 'b1')
    })
  })

  describe('4. 决策门禁 (HITL) 与上下文剪枝在多会话中的状态流转', () => {
    it('gate_prompt 与 gate_resolved 正确推进会话内部生命周期', () => {
      let session = createInitialSession('ses-gate-test')

      // 触发门禁挂起
      const gatePromptEvent: TelemetryEvent = {
        traceId: 'tr-g',
        sessionId: 'ses-gate-test',
        nodeId: 'gate-node-1',
        type: 'gate_prompt',
        title: 'git commit 需审批',
      }
      session = processEventForSession(session, gatePromptEvent)
      assert.equal(session.status, 'gate')
      assert.equal(session.nodes.length, 1)
      const nodeDataBefore = session.nodes[0].data as unknown as AgentNodeData
      assert.equal(nodeDataBefore.status, 'gate')

      // 人类操作员放行 (approve)
      const gateResolveEvent: TelemetryEvent = {
        traceId: 'tr-g',
        sessionId: 'ses-gate-test',
        nodeId: 'gate-node-1',
        type: 'gate_resolved',
        gateDecision: { action: 'approve' },
      }
      session = processEventForSession(session, gateResolveEvent)
      assert.equal(session.status, 'completed')
      const nodeDataAfter = session.nodes[0].data as unknown as AgentNodeData
      assert.equal(nodeDataAfter.status, 'completed')
      assert.ok(nodeDataAfter.summary?.includes('[人类已批准放行]'))
    })

    it('context_pruned 剪枝事件正向折叠工具节点并同步 Token 水位', () => {
      let session = createInitialSession('ses-prune-test')

      // 添加一个带输出的工具执行节点
      const toolEvent: TelemetryEvent = {
        traceId: 'tr-p',
        sessionId: 'ses-prune-test',
        nodeId: 'bash-heavy',
        type: 'node_complete',
        gesture: 'bash',
        title: 'pnpm test',
        observation: { exitCode: 0, output: ['156 passed'] },
      }
      session = processEventForSession(session, toolEvent)

      // 剪枝
      const pruneEvent: TelemetryEvent = {
        traceId: 'tr-p',
        sessionId: 'ses-prune-test',
        nodeId: 'watermark',
        type: 'context_pruned',
        reclaimedTokens: 28000,
      }
      session = processEventForSession(session, pruneEvent)
      assert.equal(session.isPruned, true)
      assert.equal(session.reclaimedTokens, 28000)
      const prunedNodeData = session.nodes[0].data as unknown as AgentNodeData
      assert.equal(prunedNodeData.pruned, true)
    })
  })

  describe('5. 契约与工具函数鲁棒性 (Helpers & Edge Cases)', () => {
    it('resolveSessionId 提取规则优先级', () => {
      assert.equal(resolveSessionId({ sessionId: 'ses-explicit' }), 'ses-explicit')
      assert.equal(resolveSessionId({ payload: { sessionId: 'payload-ses' } }), 'payload-ses')
      assert.equal(resolveSessionId({ payload: { session_id: 'snake_ses' } }), 'snake_ses')
      assert.equal(resolveSessionId({}), 'default-session')
      assert.equal(resolveSessionId(undefined), 'default-session')
    })

    it('resolveSessionTitle 提取规则优先级', () => {
      assert.equal(
        resolveSessionTitle({ sessionTitle: '明确会话标题' }),
        '明确会话标题'
      )
      assert.equal(
        resolveSessionTitle({ payload: { taskTitle: '任务目标标题' } }),
        '任务目标标题'
      )
      assert.equal(
        resolveSessionTitle({ sessionId: 'ghost-123' }),
        '会话 ghost-123'
      )
      assert.equal(resolveSessionTitle({}), '未命名任务会话')
    })

    it('formatRelativeTime 阶梯式格式化', () => {
      const now = Date.now()
      assert.equal(formatRelativeTime(now - 5000), '刚刚')
      assert.equal(formatRelativeTime(now - 120_000), '2分钟前')
      assert.equal(formatRelativeTime(now - 7_200_000), '2小时前')
    })

    it('calculateNodePosition 主干顺延与自愈下沉坐标计算', () => {
      const existing: Node[] = [
        { id: 'p1', type: 'agentNode', position: { x: 50, y: 180 }, data: {} },
      ]
      // 主干顺延
      const mainPos = calculateNodePosition({ isCorrectionBranch: false }, 'p1', existing)
      assert.deepEqual(mainPos, { x: 330, y: 180 })

      // 自愈分支下沉
      const branchPos = calculateNodePosition({ isCorrectionBranch: true }, 'p1', existing)
      assert.deepEqual(branchPos, { x: 330, y: 340 })
    })

    it('useTelemetryStream hook 模块正确导出全部契约函数与单例', () => {
      assert.equal(typeof useTelemetryStream, 'function')
      assert.equal(typeof resolveCausalConnection, 'function')
    })
  })
})
