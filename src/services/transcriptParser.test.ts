import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  parseTranscript,
  mapToolNameToGesture,
  formatToolTitle,
  eventsToFlowNodesAndEdges,
  aggregateConsecutiveToolEvents,
} from './transcriptParser'
import { REALISTIC_PI_TRANSCRIPT_SAMPLE } from './sampleTranscript'
import type { TelemetryEvent } from '../types/telemetry'

describe('NetDive Transcript Parser Engine', () => {
  describe('Tool name to Gesture & Title formatting', () => {
    it('maps known tool names to correct TelemetryGesture', () => {
      assert.equal(mapToolNameToGesture('bash'), 'bash')
      assert.equal(mapToolNameToGesture('Bash'), 'bash')
      assert.equal(mapToolNameToGesture('exec'), 'bash')
      assert.equal(mapToolNameToGesture('terminal'), 'bash')
      assert.equal(mapToolNameToGesture('read'), 'read')
      assert.equal(mapToolNameToGesture('Read'), 'read')
      assert.equal(mapToolNameToGesture('grep'), 'read')
      assert.equal(mapToolNameToGesture('glob'), 'read')
      assert.equal(mapToolNameToGesture('find'), 'read')
      assert.equal(mapToolNameToGesture('edit'), 'edit')
      assert.equal(mapToolNameToGesture('Edit'), 'edit')
      assert.equal(mapToolNameToGesture('write'), 'edit')
      assert.equal(mapToolNameToGesture('memory_write'), 'memory')
      assert.equal(mapToolNameToGesture('scratchpad'), 'memory')
      assert.equal(mapToolNameToGesture('gate'), 'gate')
      assert.equal(mapToolNameToGesture('askuserquestion'), 'gate')
      assert.equal(mapToolNameToGesture('unknown_tool'), 'think')
      assert.equal(mapToolNameToGesture(undefined), 'think')
    })

    it('formats tool titles cleanly and defensively', () => {
      assert.equal(
        formatToolTitle('bash', { command: 'pnpm test:pipeline' }),
        '$ pnpm test:pipeline'
      )
      assert.equal(
        formatToolTitle('read', { path: 'packages/core/src/pipeline.ts' }),
        'read: pipeline.ts'
      )
      assert.equal(
        formatToolTitle('edit', { file_path: 'C:\\Users\\netdive\\src\\App.tsx' }),
        'edit: App.tsx'
      )
      assert.equal(
        formatToolTitle('grep', { pattern: 'TelemetryEvent' }),
        'rg "TelemetryEvent"'
      )
      assert.equal(formatToolTitle('custom_tool'), '工具调用: custom_tool')
    })
  })

  describe('Pi Agent JSONL Transcript Parsing', () => {
    it('parses realistic Pi session transcript into causal DAG nodes', () => {
      const parsed = parseTranscript(REALISTIC_PI_TRANSCRIPT_SAMPLE)

      // 验证元数据
      assert.equal(parsed.session.format, 'pi')
      assert.equal(parsed.session.id, '01a195f4-beb3-75a8-9165-bffa1e306b28')
      assert.equal(parsed.session.cwd, 'C:\\Users\\wangqing\\Desktop\\Ghost')
      assert.equal(parsed.session.cwdBase, 'Ghost')
      assert.equal(parsed.session.provider, 'magpie')
      assert.equal(parsed.session.modelId, 'antigravity/gemini-3.8-flash')
      assert(parsed.events.length >= 7)

      // 验证节点 1：用户需求输入
      const userEvent = parsed.events[0]
      assert.equal(userEvent.actor, 'Human Operator')
      assert.equal(userEvent.gesture, 'read')
      assert.equal(userEvent.status, 'completed')
      assert(userEvent.delta?.includes('重构 Ghost 数据清洗流'))

      // 验证工具调用 1：read pipeline.ts
      const readTool = parsed.events.find((e) => e.nodeId === 'call_read_pipeline')
      assert(readTool, 'readTool node must exist')
      assert.equal(readTool.gesture, 'read')
      assert.equal(readTool.status, 'completed')
      assert.equal(readTool.observation?.exitCode, 0)
      assert((readTool.observation?.output?.length ?? 0) > 0)

      // 验证工具调用 2：失败的测试 (exitCode = 1, isCorrectionBranch = true)
      const failBashTool = parsed.events.find((e) => e.nodeId === 'call_bash_test_initial')
      assert(failBashTool, 'failBashTool must exist')
      assert.equal(failBashTool.gesture, 'bash')
      assert.equal(failBashTool.status, 'failed')
      assert.equal(failBashTool.isCorrectionBranch, true)
      assert.equal(failBashTool.observation?.exitCode, 1)

      // 验证工具调用 3：自愈编辑 edit
      const editTool = parsed.events.find((e) => e.nodeId === 'call_edit_pipeline')
      assert(editTool, 'editTool must exist')
      assert.equal(editTool.gesture, 'edit')
      assert.equal(editTool.status, 'completed')

      // 验证工具调用 4：验证通过的测试 (exitCode = 0)
      const passBashTool = parsed.events.find((e) => e.nodeId === 'call_bash_test_verify')
      assert(passBashTool, 'passBashTool must exist')
      assert.equal(passBashTool.gesture, 'bash')
      assert.equal(passBashTool.status, 'completed')
      assert.equal(passBashTool.observation?.exitCode, 0)
    })

    it('preserves causal parent-child links across Pi session turns', () => {
      const parsed = parseTranscript(REALISTIC_PI_TRANSCRIPT_SAMPLE)

      for (let i = 1; i < parsed.events.length; i++) {
        const ev = parsed.events[i]
        assert(ev.parentId, `Event ${ev.nodeId} must have a parentId`)
        const parent = parsed.events.find((e) => e.nodeId === ev.parentId)
        assert(parent, `Parent node ${ev.parentId} must exist in events list`)
      }
    })

    it('parses real local Pi session JSONL from disk if available', () => {
      const realPath =
        'C:/Users/wangqing/.pi/agent/sessions/--C--Users-wangqing-Desktop-netdive--/2026-11-01T07-13-27-219Z_01a195f4-beb3-75a8-9165-bffa1e306b28.jsonl'
      if (!fs.existsSync(realPath)) return

      const raw = fs.readFileSync(realPath, 'utf-8')
      const parsed = parseTranscript(raw)

      assert.equal(parsed.session.format, 'pi')
      assert.equal(parsed.session.id, '01a195f4-beb3-75a8-9165-bffa1e306b28')
      assert(parsed.events.length > 5, 'Must extract real events from session')
      const { nodes, edges } = eventsToFlowNodesAndEdges(parsed.events)
      assert.equal(nodes.length, parsed.events.length)
      assert(edges.length > 0)
    })
  })

  describe('Claude Code JSONL Transcript Parsing', () => {
    it('parses Claude Code session JSONL format accurately', () => {
      const claudeJsonl = [
        JSON.stringify({
          type: 'last-prompt',
          leafUuid: 'uuid-leaf-1',
          sessionId: 'claude-session-8899',
        }),
        JSON.stringify({
          type: 'attachment',
          sessionId: 'claude-session-8899',
          cwd: 'C:\\Users\\wangqing\\Desktop\\netdive',
          gitBranch: 'main',
          version: '2.1.316',
        }),
        JSON.stringify({
          type: 'user',
          uuid: 'user-turn-1',
          parentUuid: null,
          message: {
            role: 'user',
            content: '实现 NetDive 会话时光机并编写单元测试',
          },
          timestamp: '2026-11-01T10:00:00.000Z',
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: 'asst-turn-1',
          parentUuid: 'user-turn-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'thinking',
                thinking: '分析工单需求，提取 transcriptParser 服务与对应单测文件。',
              },
              {
                type: 'tool_use',
                id: 'call_bash_check_test',
                name: 'Bash',
                input: {
                  command: 'pnpm test',
                },
              },
            ],
          },
          timestamp: '2026-11-01T10:00:02.000Z',
        }),
        JSON.stringify({
          type: 'user',
          uuid: 'tool-res-1',
          parentUuid: 'asst-turn-1',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'call_bash_check_test',
                content: '70 tests passed (2.2s)',
                is_error: false,
              },
            ],
          },
          timestamp: '2026-11-01T10:00:05.000Z',
        }),
      ].join('\n')

      const parsed = parseTranscript(claudeJsonl)

      assert.equal(parsed.session.format, 'claude')
      assert.equal(parsed.session.id, 'claude-session-8899')
      assert.equal(parsed.session.cwdBase, 'netdive')
      assert.equal(parsed.session.gitBranch, 'main')

      // 验证工具调用已通过 tool_result 配对为 completed
      const bashEvent = parsed.events.find((e) => e.nodeId === 'call_bash_check_test')
      assert(bashEvent)
      assert.equal(bashEvent.gesture, 'bash')
      assert.equal(bashEvent.status, 'completed')
      assert.equal(bashEvent.observation?.exitCode, 0)
      assert.deepEqual(bashEvent.observation?.output, ['70 tests passed (2.2s)'])
    })
  })

  describe('Direct TelemetryEvent & Resilience Edge Cases', () => {
    it('passes through pre-existing TelemetryEvent records', () => {
      const rawEvents: TelemetryEvent[] = [
        {
          traceId: 'trace-1',
          nodeId: 'node-test-1',
          type: 'node_complete',
          gesture: 'think',
          title: '预设节点',
          status: 'completed',
        },
      ]
      const jsonl = rawEvents.map((e) => JSON.stringify(e)).join('\n')
      const parsed = parseTranscript(jsonl)

      assert.equal(parsed.events.length, 1)
      assert.equal(parsed.events[0].nodeId, 'node-test-1')
    })

    it('skips malformed JSON lines, comments, and empty lines gracefully', () => {
      const noisyJsonl = [
        '',
        '   ',
        '# 这是一个注释行',
        '// 这是另一个注释',
        '{ invalid json string here',
        '{"type":"session","id":"noisy-sess"}',
        'not a json at all',
      ].join('\n')

      const parsed = parseTranscript(noisyJsonl)
      assert.equal(parsed.session.id, 'noisy-sess')
    })
  })

  describe('eventsToFlowNodesAndEdges Layout Calculation', () => {
    it('computes correct positions and smoothstep edges for causal DAG', () => {
      const parsed = parseTranscript(REALISTIC_PI_TRANSCRIPT_SAMPLE)
      const { nodes, edges } = eventsToFlowNodesAndEdges(parsed.events)

      assert.equal(nodes.length, parsed.events.length)
      assert(edges.length >= parsed.events.length - 1)

      // 检查首节点
      assert.equal(nodes[0].position.x, 50)
      assert.equal(nodes[0].position.y, 180)

      // 检查后续节点水平递增
      assert.equal(nodes[1].position.x, 330)

      // 检查自愈失败节点（isCorrectionBranch === true）位于分支 Y 轴 (340)
      const failNode = nodes.find((n) => n.id === 'call_bash_test_initial')
      assert(failNode)
      assert.equal(failNode.position.y, 340)

      // 检查自愈分支边带有琥珀金色
      const branchEdge = edges.find((e) => e.target === 'call_bash_test_initial')
      assert(branchEdge)
      assert.equal(branchEdge.style?.stroke, '#D97706')
    })
  })

  describe('Consecutive Tool Call Aggregation & Folding', () => {
    // 1) Consecutive read of the same file folds into a single aggregated event with count = N.
    it('folds consecutive reads of the same file into a single aggregated event with count = N', () => {
      const events: TelemetryEvent[] = [
        {
          traceId: 'trace-fold-1',
          nodeId: 'read-1',
          type: 'node_complete',
          gesture: 'read',
          actor: 'Claude 3.7 (Worker)',
          title: 'read: useTelemetryStream.ts',
          status: 'completed',
          payload: { path: 'src/hooks/useTelemetryStream.ts', offset: 1, limit: 50 },
          observation: { exitCode: 0, output: ['export function useTelemetryStream() {'] },
        },
        {
          traceId: 'trace-fold-1',
          nodeId: 'read-2',
          parentId: 'read-1',
          type: 'node_complete',
          gesture: 'read',
          actor: 'Claude 3.7 (Worker)',
          title: 'read: useTelemetryStream.ts',
          status: 'completed',
          payload: { path: 'src/hooks/useTelemetryStream.ts', offset: 51, limit: 50 },
          observation: { exitCode: 0, output: ['  const [events, setEvents] = useState([])'] },
        },
        {
          traceId: 'trace-fold-1',
          nodeId: 'read-3',
          parentId: 'read-2',
          type: 'node_complete',
          gesture: 'read',
          actor: 'Claude 3.7 (Worker)',
          title: 'read: useTelemetryStream.ts',
          status: 'completed',
          payload: { path: 'src/hooks/useTelemetryStream.ts', offset: 101, limit: 50 },
          observation: { exitCode: 0, output: ['  return { events }', '}'] },
        },
      ]

      const folded = aggregateConsecutiveToolEvents(events, { enabled: true })

      assert.equal(folded.length, 1)
      const agg = folded[0]
      assert.equal(agg.nodeId, 'read-1')
      assert.equal(agg.gesture, 'read')
      assert.equal(agg.title, 'read: useTelemetryStream.ts (x3)')
      assert.equal(agg.isAggregated, true)
      assert.equal(agg.aggregateCount, 3)
      assert.equal(agg.aggregatedEvents?.length, 3)
      assert.equal(agg.status, 'completed')
      assert.deepEqual(agg.observation?.output, [
        'export function useTelemetryStream() {',
        '  const [events, setEvents] = useState([])',
        '  return { events }',
        '}',
      ])
    })

    // 2) Consecutive bash calls fold properly.
    it('folds consecutive bash calls properly into command groups', () => {
      const events: TelemetryEvent[] = [
        {
          traceId: 'trace-bash-1',
          nodeId: 'bash-1',
          type: 'node_complete',
          gesture: 'bash',
          actor: 'Claude 3.7 (Worker)',
          title: '$ orca orchestration check',
          status: 'completed',
          payload: { command: 'orca orchestration check --terminal term_1' },
          observation: { exitCode: 0, output: ['{"ok": true, "messages": []}'] },
        },
        {
          traceId: 'trace-bash-1',
          nodeId: 'bash-2',
          parentId: 'bash-1',
          type: 'node_complete',
          gesture: 'bash',
          actor: 'Claude 3.7 (Worker)',
          title: '$ orca orchestration check',
          status: 'completed',
          payload: { command: 'orca orchestration check --terminal term_2' },
          observation: { exitCode: 0, output: ['{"ok": true, "messages": []}'] },
        },
        {
          traceId: 'trace-bash-1',
          nodeId: 'bash-3',
          parentId: 'bash-2',
          type: 'node_complete',
          gesture: 'bash',
          actor: 'Claude 3.7 (Worker)',
          title: '$ orca orchestration check',
          status: 'completed',
          payload: { command: 'orca orchestration check --terminal term_3' },
          observation: { exitCode: 0, output: ['{"ok": true, "messages": []}'] },
        },
      ]

      const folded = aggregateConsecutiveToolEvents(events, { enabled: true })

      assert.equal(folded.length, 1)
      const agg = folded[0]
      assert.equal(agg.nodeId, 'bash-1')
      assert.equal(agg.gesture, 'bash')
      assert.equal(agg.title, 'bash: orca 命令组 (x3)')
      assert.equal(agg.isAggregated, true)
      assert.equal(agg.aggregateCount, 3)
      assert.equal(agg.aggregatedEvents?.length, 3)
      assert.equal(
        agg.observation?.command,
        'orca orchestration check --terminal term_1 && orca orchestration check --terminal term_2 && orca orchestration check --terminal term_3'
      )
    })

    // 3) A failure in the sequence prevents folding of that error node, keeping self-correction visible.
    it('prevents folding of error/failure nodes and keeps self-correction branch isolated and visible', () => {
      const events: TelemetryEvent[] = [
        // 2 successful bash calls before
        {
          traceId: 'trace-err-1',
          nodeId: 'bash-init-1',
          type: 'node_complete',
          gesture: 'bash',
          title: '$ pnpm lint',
          status: 'completed',
          payload: { command: 'pnpm lint' },
          observation: { exitCode: 0, output: ['lint passed'] },
        },
        {
          traceId: 'trace-err-1',
          nodeId: 'bash-init-2',
          parentId: 'bash-init-1',
          type: 'node_complete',
          gesture: 'bash',
          title: '$ pnpm check',
          status: 'completed',
          payload: { command: 'pnpm check' },
          observation: { exitCode: 0, output: ['types ok'] },
        },
        // Failed tool call (exitCode = 1, isCorrectionBranch = true)
        {
          traceId: 'trace-err-1',
          nodeId: 'bash-fail',
          parentId: 'bash-init-2',
          type: 'node_complete',
          gesture: 'bash',
          title: '$ pnpm test:pipeline',
          status: 'failed',
          isCorrectionBranch: true,
          payload: { command: 'pnpm test:pipeline' },
          observation: { exitCode: 1, output: ['FAIL test/pipeline.test.ts'] },
        },
        // Single edit node for self-correction
        {
          traceId: 'trace-err-1',
          nodeId: 'edit-self-correct',
          parentId: 'bash-fail',
          type: 'node_complete',
          gesture: 'edit',
          title: 'edit: pipeline.ts',
          status: 'completed',
          payload: { path: 'packages/core/src/pipeline.ts' },
          observation: { exitCode: 0, output: ['1 occurrence replaced'] },
        },
        // 2 successful bash calls after self-correction
        {
          traceId: 'trace-err-1',
          nodeId: 'bash-verify-1',
          parentId: 'edit-self-correct',
          type: 'node_complete',
          gesture: 'bash',
          title: '$ pnpm test:pipeline',
          status: 'completed',
          payload: { command: 'pnpm test:pipeline' },
          observation: { exitCode: 0, output: ['156 passed'] },
        },
        {
          traceId: 'trace-err-1',
          nodeId: 'bash-verify-2',
          parentId: 'bash-verify-1',
          type: 'node_complete',
          gesture: 'bash',
          title: '$ pnpm build',
          status: 'completed',
          payload: { command: 'pnpm build' },
          observation: { exitCode: 0, output: ['built in 500ms'] },
        },
      ]

      const folded = aggregateConsecutiveToolEvents(events, { enabled: true })

      // 应当得到 4 个节点：
      // 1: 聚合 bash 组 (bash-init-1, x2)
      // 2: 独立错误节点 bash-fail (保留 failed 状态与 isCorrectionBranch，未被折叠吞没)
      // 3: 独立编辑节点 edit-self-correct (单个节点不折叠)
      // 4: 聚合 bash 组 (bash-verify-1, x2)
      assert.equal(folded.length, 4)

      const group1 = folded[0]
      assert.equal(group1.nodeId, 'bash-init-1')
      assert.equal(group1.isAggregated, true)
      assert.equal(group1.aggregateCount, 2)

      const failNode = folded[1]
      assert.equal(failNode.nodeId, 'bash-fail')
      assert.equal(failNode.status, 'failed')
      assert.equal(failNode.isCorrectionBranch, true)
      assert.equal(failNode.isAggregated, undefined)
      assert.equal(failNode.observation?.exitCode, 1)

      const editNode = folded[2]
      assert.equal(editNode.nodeId, 'edit-self-correct')
      assert.equal(editNode.isAggregated, undefined)

      const group2 = folded[3]
      assert.equal(group2.nodeId, 'bash-verify-1')
      assert.equal(group2.isAggregated, true)
      assert.equal(group2.aggregateCount, 2)

      // 检查因果链连接：
      // failNode.parentId 应当连接到 group1.nodeId ('bash-init-1')
      assert.equal(failNode.parentId, 'bash-init-1')
      // editNode.parentId 应当连接到 failNode.nodeId ('bash-fail')
      assert.equal(editNode.parentId, 'bash-fail')
      // group2.parentId 应当连接到 editNode.nodeId ('edit-self-correct')
      assert.equal(group2.parentId, 'edit-self-correct')
    })

    // 4) Toggling enabled: false preserves the exact expanded list.
    it('preserves exact expanded event list when enabled is false', () => {
      const events: TelemetryEvent[] = [
        {
          traceId: 'trace-disabled',
          nodeId: 'read-1',
          type: 'node_complete',
          gesture: 'read',
          title: 'read: useTelemetryStream.ts',
          status: 'completed',
          payload: { path: 'src/hooks/useTelemetryStream.ts' },
        },
        {
          traceId: 'trace-disabled',
          nodeId: 'read-2',
          parentId: 'read-1',
          type: 'node_complete',
          gesture: 'read',
          title: 'read: useTelemetryStream.ts',
          status: 'completed',
          payload: { path: 'src/hooks/useTelemetryStream.ts' },
        },
      ]

      const unFolded = aggregateConsecutiveToolEvents(events, { enabled: false })
      assert.equal(unFolded.length, 2)
      assert.equal(unFolded[0].nodeId, 'read-1')
      assert.equal(unFolded[1].nodeId, 'read-2')
      assert.equal(unFolded[0].isAggregated, undefined)
    })

    // 5) Graph layout and parentId causal links after aggregation
    it('updates downstream parentId causal DAG links and calculates Flow nodes/edges accurately', () => {
      const events: TelemetryEvent[] = [
        {
          traceId: 'trace-dag',
          nodeId: 'user-prompt',
          type: 'node_complete',
          gesture: 'read',
          actor: 'Human Operator',
          title: '需求指令',
          status: 'completed',
        },
        {
          traceId: 'trace-dag',
          nodeId: 'read-a',
          parentId: 'user-prompt',
          type: 'node_complete',
          gesture: 'read',
          actor: 'Claude 3.7 (Worker)',
          title: 'read: App.tsx',
          status: 'completed',
          payload: { path: 'src/App.tsx' },
        },
        {
          traceId: 'trace-dag',
          nodeId: 'read-b',
          parentId: 'read-a',
          type: 'node_complete',
          gesture: 'read',
          actor: 'Claude 3.7 (Worker)',
          title: 'read: App.tsx',
          status: 'completed',
          payload: { path: 'src/App.tsx' },
        },
        {
          traceId: 'trace-dag',
          nodeId: 'think-final',
          parentId: 'read-b', // 原指向被聚合吸收的 read-b
          type: 'node_complete',
          gesture: 'think',
          actor: 'Claude 3.7 (Worker)',
          title: '总结推演',
          status: 'completed',
        },
      ]

      const folded = aggregateConsecutiveToolEvents(events, { enabled: true })
      assert.equal(folded.length, 3)

      const thinkNode = folded.find((e) => e.nodeId === 'think-final')
      assert(thinkNode)
      // 关键断言：thinkNode 的 parentId 应当自动重定向为聚合主节点 read-a，而不是丢失孤立
      assert.equal(thinkNode.parentId, 'read-a')

      const { nodes, edges } = eventsToFlowNodesAndEdges(folded)
      assert.equal(nodes.length, 3)
      assert.equal(edges.length, 2)

      const edgeToThink = edges.find((e) => e.target === 'think-final')
      assert(edgeToThink)
      assert.equal(edgeToThink.source, 'read-a')
    })
  })

  describe('Session Replay Timeline & Camera Tracking Mechanics', () => {
    it('calculates preserved step index with exact progressRatio when toggling folding', () => {
      // 模拟未折叠大序列 (50 步) 与折叠后小序列 (20 步)
      const prevTotal = 50
      const nextTotal = 20

      // 1. 中间位置 (50% 进度)
      const prevStepMid = 25
      const ratioMid = prevStepMid / prevTotal
      const nextStepMid = Math.max(1, Math.min(nextTotal, Math.round(ratioMid * nextTotal)))
      assert.equal(ratioMid, 0.5)
      assert.equal(nextStepMid, 10)
      assert.equal(nextStepMid / nextTotal, 0.5)

      // 2. 起始位置 (第一步)
      const prevStepStart = 1
      const ratioStart = prevStepStart / prevTotal
      const nextStepStart = Math.max(1, Math.min(nextTotal, Math.round(ratioStart * nextTotal)))
      assert.equal(nextStepStart, 1)

      // 3. 终点位置 (100% 进度)
      const prevStepEnd = 50
      const ratioEnd = prevStepEnd / prevTotal
      const nextStepEnd = Math.max(1, Math.min(nextTotal, Math.round(ratioEnd * nextTotal)))
      assert.equal(ratioEnd, 1.0)
      assert.equal(nextStepEnd, 20)

      // 4. 反向切换：从折叠 (20 步) 切回未折叠 (50 步)
      const foldedStep = 10
      const foldedTotal = 20
      const unfoldedTotal = 50
      const foldedRatio = foldedStep / foldedTotal
      const unfoldedStep = Math.max(
        1,
        Math.min(unfoldedTotal, Math.round(foldedRatio * unfoldedTotal))
      )
      assert.equal(foldedRatio, 0.5)
      assert.equal(unfoldedStep, 25)
      assert.equal(unfoldedStep / unfoldedTotal, 0.5)
    })

    it('exports SessionReplayPage component wrapped with ReactFlowProvider', async () => {
      const { SessionReplayPage } = await import('../pages/SessionReplayPage')
      assert.equal(typeof SessionReplayPage, 'function')
    })
  })
})
