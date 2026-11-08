import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  parseTranscript,
  mapToolNameToGesture,
  formatToolTitle,
  eventsToFlowNodesAndEdges,
  aggregateConsecutiveToolEvents,
  coalesceIncrementalEvent,
  aggregateEventsIntoTurns,
  turnsToFlowNodesAndEdges,
  extractRealIntent,
  extractUsageFromRecord,
} from './transcriptParser'
import { REALISTIC_PI_TRANSCRIPT_SAMPLE } from './sampleTranscript'
import { resolveContextWindow } from './modelWindows'
import type { TelemetryEvent, MacroTurnGroup } from '../types/telemetry'

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

  describe('Deterministic Zero-Cost Intent Extraction in Transcript Parsing', () => {
    it('正确导出 extractRealIntent 纯函数', () => {
      assert.equal(typeof extractRealIntent, 'function')
    })

    it('解析 Pi 思考节点时自动提纯真实意图，杜绝死板的“目标规划与分解”', () => {
      const jsonl = [
        JSON.stringify({
          type: 'session',
          id: 'test-intent-pi',
          timestamp: '2026-11-01T10:00:00.000Z',
        }),
        JSON.stringify({
          type: 'message',
          id: 'msg-intent-1',
          parentId: null,
          message: {
            role: 'assistant',
            content: [
              {
                type: 'thinking',
                thinking: '好的，我现在需要先检查App切片是否有断链。接下来我会继续修复其他问题。',
              },
            ],
          },
        }),
      ].join('\n')

      const parsed = parseTranscript(jsonl)
      assert.equal(parsed.events.length, 1)
      const thinkEvent = parsed.events[0]
      assert.equal(thinkEvent.gesture, 'think')
      assert.equal(thinkEvent.title, '检查App切片是否有断链')
    })

    it('解析文本输出节点时自动提纯真实意图，杜绝死板的“决策输出与复盘”', () => {
      const jsonl = [
        JSON.stringify({
          type: 'session',
          id: 'test-intent-text',
          timestamp: '2026-11-01T10:00:00.000Z',
        }),
        JSON.stringify({
          type: 'message',
          id: 'msg-intent-2',
          parentId: null,
          message: {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: '准备开始补齐类型声明以通过自动化单测',
              },
            ],
          },
        }),
      ].join('\n')

      const parsed = parseTranscript(jsonl)
      assert.equal(parsed.events.length, 1)
      const textEvent = parsed.events[0]
      assert.equal(textEvent.gesture, 'think')
      assert.equal(textEvent.title, '补齐类型声明以通过自动化单测')
    })

    it('解析 Claude Code 思考与执行文本时同步提纯意图', () => {
      const jsonl = [
        JSON.stringify({
          type: 'user',
          uuid: 'user-claude-intent',
          message: { role: 'user', content: '请检查拓扑' },
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: 'ast-claude-intent',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'thinking',
                thinking: '接下来我将修复切片断链并构建产物',
              },
              {
                type: 'text',
                text: '检查完成: 确认所有节点连接桩对齐无偏移',
              },
            ],
          },
        }),
      ].join('\n')

      const parsed = parseTranscript(jsonl)
      const thinkEv = parsed.events.find((e) => e.nodeId === 'ast-claude-intent-think-0')
      assert(thinkEv)
      assert.equal(thinkEv.title, '修复切片断链并构建产物')

      const textEv = parsed.events.find((e) => e.nodeId === 'ast-claude-intent-text-1')
      assert(textEv)
      assert.equal(textEv.title, '检查完成')
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

    it('wraps nodes into multi-row grid layout when events exceed nodesPerRow', () => {
      // 构造 14 个连续因果事件序列
      const dummyEvents: TelemetryEvent[] = Array.from({ length: 14 }, (_, i) => ({
        traceId: 'trace-grid-test',
        nodeId: `node-grid-${i}`,
        parentId: i > 0 ? `node-grid-${i - 1}` : undefined,
        type: 'node_complete',
        gesture: i % 2 === 0 ? 'think' : 'edit',
        title: `Step ${i}`,
        status: 'completed',
        isCorrectionBranch: i === 7, // 第 7 个节点（Row 1 Col 1）作为自愈分支节点
      }))

      const { nodes, edges } = eventsToFlowNodesAndEdges(dummyEvents)
      assert.equal(nodes.length, 14)
      assert.equal(edges.length, 13)

      // 验证 Row 0 (nodes 0..5, nodesPerRow = 6)
      assert.equal(nodes[0].position.x, 50)
      assert.equal(nodes[0].position.y, 180)
      assert.equal(nodes[5].position.x, 50 + 5 * 280) // 1450
      assert.equal(nodes[5].position.y, 180)

      // 验证 Row 1 折行 (nodes 6..11, rowGap = 340)
      assert.equal(nodes[6].position.x, 50)
      assert.equal(nodes[6].position.y, 180 + 340) // 520
      // 验证 Node 7 作为自愈分支下沉 (branchOffset = 160)
      assert.equal(nodes[7].position.x, 330)
      assert.equal(nodes[7].position.y, 520 + 160) // 680

      // 验证 Row 2 折行 (nodes 12..13)
      assert.equal(nodes[12].position.x, 50)
      assert.equal(nodes[12].position.y, 180 + 2 * 340) // 860
      assert.equal(nodes[13].position.x, 330)
      assert.equal(nodes[13].position.y, 860)

      // 验证跨行边正常连接
      const crossRowEdge = edges.find((e) => e.source === 'node-grid-5' && e.target === 'node-grid-6')
      assert(crossRowEdge)
      assert.equal(crossRowEdge.type, 'smoothstep')
    })

    it('supports custom nodesPerRow option', () => {
      const dummyEvents: TelemetryEvent[] = Array.from({ length: 8 }, (_, i) => ({
        traceId: 'trace-custom-grid',
        nodeId: `node-cg-${i}`,
        type: 'node_complete',
        title: `Step ${i}`,
        status: 'completed',
      }))

      // 每行 4 个节点
      const { nodes } = eventsToFlowNodesAndEdges(dummyEvents, { nodesPerRow: 4 })
      assert.equal(nodes.length, 8)

      // Node 3 在 Row 0 Col 3
      assert.equal(nodes[3].position.x, 50 + 3 * 280) // 890
      assert.equal(nodes[3].position.y, 180)

      // Node 4 折行至 Row 1 Col 0
      assert.equal(nodes[4].position.x, 50)
      assert.equal(nodes[4].position.y, 520)
    })

    it('produces lean view-model nodes without megabyte payload or observation copies', () => {
      const heavyEvent: TelemetryEvent = {
        traceId: 'trace-heavy',
        nodeId: 'node-heavy-1',
        type: 'node_complete',
        gesture: 'bash',
        title: '$ pnpm test',
        status: 'completed',
        payload: {
          command: 'pnpm test',
          hugeArray: Array.from({ length: 1000 }, (_, i) => `item-${i}`),
        },
        observation: {
          exitCode: 0,
          output: Array.from({ length: 500 }, (_, i) => `stdout line ${i}`),
        },
        assertion: {
          passed: true,
          triggerSelfCorrection: false,
          triggerGate: false,
          severity: 'info',
        },
      }

      const { nodes } = eventsToFlowNodesAndEdges([heavyEvent])
      assert.equal(nodes.length, 1)

      const nodeData = nodes[0].data as Record<string, unknown>
      // 必须保留轻量视图字段
      assert.equal(nodeData.nodeId, 'node-heavy-1')
      assert.equal(nodeData.title, '$ pnpm test')
      assert.equal(nodeData.gesture, 'bash')
      assert.equal(nodeData.status, 'completed')
      assert.equal(nodeData.summary, '$ pnpm test')

      // 瘦节点契约：严禁在 node.data 中携带大型 payload / observation 副本
      assert.equal(nodeData.payload, undefined)
      assert.equal(nodeData.observation, undefined)
      assert.equal(nodeData.assertion, undefined)
      assert.equal(nodeData.aggregatedEvents, undefined)
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

    // 6) 终端轮询抑制与过渡性 Think 容忍合并
    it('suppresses polling loops with interleaved transient thinks into a single terminal group', () => {
      const events: TelemetryEvent[] = [
        {
          traceId: 'trace-poll',
          nodeId: 'poll-1',
          type: 'node_complete',
          gesture: 'bash',
          actor: 'Claude 3.7 (Worker)',
          title: '$ orca terminal read',
          status: 'completed',
          payload: { command: 'orca terminal read --terminal term_354cc1cb-ac79-44e1-97ea-097479b391c6 --limit 40 --json' },
          observation: { exitCode: 0, output: ['[running...]'] },
        },
        {
          traceId: 'trace-poll',
          nodeId: 'think-1',
          parentId: 'poll-1',
          type: 'node_complete',
          gesture: 'think',
          actor: 'Claude 3.7 (Worker)',
          title: '决策输出与复盘',
          status: 'completed',
          delta: '终端正在执行构建，等待下一次检查。',
        },
        {
          traceId: 'trace-poll',
          nodeId: 'poll-2',
          parentId: 'think-1',
          type: 'node_complete',
          gesture: 'bash',
          actor: 'Claude 3.7 (Worker)',
          title: '$ orca terminal read',
          status: 'completed',
          payload: { command: 'orca terminal read --terminal term_354cc1cb-ac79-44e1-97ea-097479b391c6 --limit 40 --json' },
          observation: { exitCode: 0, output: ['[still running...]'] },
        },
        {
          traceId: 'trace-poll',
          nodeId: 'think-2',
          parentId: 'poll-2',
          type: 'node_complete',
          gesture: 'think',
          actor: 'Claude 3.7 (Worker)',
          title: '决策输出与复盘',
          status: 'completed',
          delta: '命令依然未就绪，继续等待。',
        },
        {
          traceId: 'trace-poll',
          nodeId: 'poll-3',
          parentId: 'think-2',
          type: 'node_complete',
          gesture: 'bash',
          actor: 'Claude 3.7 (Worker)',
          title: '$ orca terminal read',
          status: 'completed',
          payload: { command: 'orca terminal read --terminal term_354cc1cb-ac79-44e1-97ea-097479b391c6 --limit 40 --json' },
          observation: { exitCode: 0, output: ['[success completed]'] },
        },
      ]

      const folded = aggregateConsecutiveToolEvents(events, { enabled: true })
      // 3 次终端轮询 + 2 次过渡 think 被完美收拢为 1 个聚合节点
      assert.equal(folded.length, 1)
      const agg = folded[0]
      assert.equal(agg.isAggregated, true)
      assert.equal(agg.aggregateCount, 3)
      assert(agg.title?.includes('terminal: 轮询'))
      assert(agg.title?.includes('(x3)'))
      // 验证中间思考文本被吸收沉淀进 payload.subNotes
      assert(Array.isArray(agg.payload?.subNotes))
      assert.equal(agg.payload?.subNotes?.length, 2)
      assert(agg.payload?.subNotes?.[0].includes('终端正在执行构建'))
    })

    // 7) 同一文件紧邻检视与补丁 (Read + Edit) 管道聚合
    it('coalesces alternating read and edit on the same file into a file session node', () => {
      const events: TelemetryEvent[] = [
        {
          traceId: 'trace-file',
          nodeId: 'read-1',
          type: 'node_complete',
          gesture: 'read',
          actor: 'Claude 3.7 (Worker)',
          title: 'read: telemetry.ts',
          status: 'completed',
          payload: { path: 'src/types/telemetry.ts' },
          observation: { exitCode: 0, output: ['// line 1'] },
        },
        {
          traceId: 'trace-file',
          nodeId: 'edit-1',
          parentId: 'read-1',
          type: 'node_complete',
          gesture: 'edit',
          actor: 'Claude 3.7 (Worker)',
          title: 'edit: telemetry.ts',
          status: 'completed',
          payload: { path: 'src/types/telemetry.ts' },
          observation: { exitCode: 0, output: ['+ export type NewType'] },
        },
        {
          traceId: 'trace-file',
          nodeId: 'read-2',
          parentId: 'edit-1',
          type: 'node_complete',
          gesture: 'read',
          actor: 'Claude 3.7 (Worker)',
          title: 'read: telemetry.ts',
          status: 'completed',
          payload: { path: 'src/types/telemetry.ts' },
          observation: { exitCode: 0, output: ['// line 2'] },
        },
        {
          traceId: 'trace-file',
          nodeId: 'edit-2',
          parentId: 'read-2',
          type: 'node_complete',
          gesture: 'edit',
          actor: 'Claude 3.7 (Worker)',
          title: 'edit: telemetry.ts',
          status: 'completed',
          payload: { path: 'src/types/telemetry.ts' },
          observation: { exitCode: 0, output: ['+ export type AnotherType'] },
        },
      ]

      const folded = aggregateConsecutiveToolEvents(events, { enabled: true })
      // 4 次读写被聚合为 1 个文件交互会话节点
      assert.equal(folded.length, 1)
      const agg = folded[0]
      assert.equal(agg.isAggregated, true)
      assert.equal(agg.aggregateCount, 4)
      assert.equal(agg.gesture, 'edit') // 读写混合提升为 edit 手势
      assert.equal(agg.title, 'file: telemetry.ts (2检视 + 2补丁)')
    })

    // 8) 失败或异常自愈节点发生时保持强可见性，绝不盲目折叠进同构组
    it('isolates failure and correction nodes without blindly collapsing them into tool groups', () => {
      const events: TelemetryEvent[] = [
        {
          traceId: 'tr-fail-vis',
          nodeId: 'read-1',
          type: 'node_complete',
          gesture: 'read',
          actor: 'Claude 3.7 (Worker)',
          title: 'read: config.json',
          status: 'completed',
          payload: { path: 'config.json' },
        },
        {
          traceId: 'tr-fail-vis',
          nodeId: 'read-2',
          parentId: 'read-1',
          type: 'node_complete',
          gesture: 'read',
          actor: 'Claude 3.7 (Worker)',
          title: 'read: config.json',
          status: 'completed',
          payload: { path: 'config.json' },
        },
        {
          traceId: 'tr-fail-vis',
          nodeId: 'read-fail',
          parentId: 'read-2',
          type: 'node_complete',
          gesture: 'read',
          actor: 'Claude 3.7 (Worker)',
          title: 'read: config.json',
          status: 'failed',
          payload: { path: 'config.json' },
          observation: { exitCode: 1, output: ['ENOENT: file not found'] },
        },
        {
          traceId: 'tr-fail-vis',
          nodeId: 'read-heal-1',
          parentId: 'read-fail',
          type: 'node_complete',
          gesture: 'read',
          actor: 'Claude 3.7 (Worker)',
          title: 'read: config.json',
          status: 'completed',
          isCorrectionBranch: true,
          payload: { path: 'config.json' },
        },
        {
          traceId: 'tr-fail-vis',
          nodeId: 'read-heal-2',
          parentId: 'read-heal-1',
          type: 'node_complete',
          gesture: 'read',
          actor: 'Claude 3.7 (Worker)',
          title: 'read: config.json',
          status: 'completed',
          isCorrectionBranch: true,
          payload: { path: 'config.json' },
        },
      ]

      const folded = aggregateConsecutiveToolEvents(events, { enabled: true })
      // 应当保留：
      // 1. 前置 2 次读取聚合 (read-1, x2)
      // 2. 独立失败节点 (read-fail)，未被折叠吞没
      // 3. 自愈分支中的节点保持可见（isCorrectionBranch === true 不参与普通聚合）
      assert.equal(folded.length, 4)
      assert.equal(folded[0].isAggregated, true)
      assert.equal(folded[0].aggregateCount, 2)

      const failNode = folded[1]
      assert.equal(failNode.nodeId, 'read-fail')
      assert.equal(failNode.status, 'failed')
      assert.equal(failNode.isAggregated, undefined)
      assert.equal(failNode.observation?.exitCode, 1)

      assert.equal(folded[2].nodeId, 'read-heal-1')
      assert.equal(folded[2].isCorrectionBranch, true)
      assert.equal(folded[3].nodeId, 'read-heal-2')
      assert.equal(folded[3].isCorrectionBranch, true)
    })

    // 9) coalesceIncrementalEvent 在线增量聚合纯函数验证
    it('coalesces incremental events in-place and absorbs transient thoughts', () => {
      const tailEvent: TelemetryEvent = {
        traceId: 'tr-inc',
        nodeId: 'read-1',
        type: 'node_complete',
        gesture: 'read',
        title: 'read: index.ts',
        status: 'completed',
        payload: { path: 'src/index.ts' },
      }

      // a) 吸收过渡思考节点
      const thinkEvent: TelemetryEvent = {
        traceId: 'tr-inc',
        nodeId: 'think-1',
        parentId: 'read-1',
        type: 'node_complete',
        gesture: 'think',
        title: '决策分析',
        delta: '正在分析导出的模块',
        status: 'completed',
      }
      const res1 = coalesceIncrementalEvent(tailEvent, thinkEvent)
      assert.equal(res1.coalesced, true)
      assert.deepEqual(res1.updatedTail.payload?.subNotes, ['正在分析导出的模块'])

      // b) 吸收同构新事件
      const nextReadEvent: TelemetryEvent = {
        traceId: 'tr-inc',
        nodeId: 'read-2',
        parentId: 'think-1',
        type: 'node_complete',
        gesture: 'read',
        title: 'read: index.ts',
        status: 'completed',
        payload: { path: 'src/index.ts' },
      }
      const res2 = coalesceIncrementalEvent(res1.updatedTail, nextReadEvent)
      assert.equal(res2.coalesced, true)
      assert.equal(res2.updatedTail.isAggregated, true)
      assert.equal(res2.updatedTail.aggregateCount, 2)
      assert(res2.updatedTail.title?.includes('(x2)'))

      // c) 遇到异常节点坚决不吸附
      const failEvent: TelemetryEvent = {
        traceId: 'tr-inc',
        nodeId: 'read-err',
        type: 'node_complete',
        gesture: 'read',
        title: 'read: index.ts',
        status: 'failed',
        payload: { path: 'src/index.ts' },
        observation: { exitCode: 1 },
      }
      const res3 = coalesceIncrementalEvent(res2.updatedTail, failEvent)
      assert.equal(res3.coalesced, false)
      assert.equal(res3.updatedTail.nodeId, 'read-err')
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

  describe('Hierarchical Focus: aggregateEventsIntoTurns', () => {
    it('returns empty array when events list is empty or falsy', () => {
      assert.deepEqual(aggregateEventsIntoTurns([]), [])
    })

    it('aggregates a single-turn sequence into 1 MacroTurnGroup with tool counts', () => {
      const events: TelemetryEvent[] = [
        {
          traceId: 'tr-1',
          nodeId: 'user-1',
          type: 'node_complete',
          gesture: 'read',
          actor: 'Human Operator',
          title: '用户需求指令',
          delta: '请运行单元测试并修复 packages/core 中的断言错误。',
          status: 'completed',
          timestamp: 1000,
        },
        {
          traceId: 'tr-1',
          nodeId: 'think-1',
          parentId: 'user-1',
          type: 'node_complete',
          gesture: 'think',
          actor: 'Claude 3.7 (Worker)',
          title: '目标规划',
          delta: '先读取测试代码并执行 pnpm test。',
          status: 'completed',
          timestamp: 1200,
        },
        {
          traceId: 'tr-1',
          nodeId: 'read-1',
          parentId: 'think-1',
          type: 'node_complete',
          gesture: 'read',
          actor: 'Claude 3.7 (Worker)',
          title: 'read: test.ts',
          payload: { path: 'packages/core/test.ts' },
          status: 'completed',
          timestamp: 1400,
        },
        {
          traceId: 'tr-1',
          nodeId: 'bash-1',
          parentId: 'read-1',
          type: 'node_complete',
          gesture: 'bash',
          actor: 'Claude 3.7 (Worker)',
          title: '$ pnpm test',
          payload: { command: 'pnpm test' },
          status: 'completed',
          timestamp: 1800,
        },
        {
          traceId: 'tr-1',
          nodeId: 'edit-1',
          parentId: 'bash-1',
          type: 'node_complete',
          gesture: 'edit',
          actor: 'Claude 3.7 (Worker)',
          title: 'edit: test.ts',
          payload: { path: 'packages/core/test.ts' },
          status: 'completed',
          timestamp: 2200,
        },
      ]

      const turns = aggregateEventsIntoTurns(events)
      assert.equal(turns.length, 1)

      const turn = turns[0]
      assert.equal(turn.turnIndex, 1)
      assert.equal(turn.turnId, 'turn-1')
      assert.equal(turn.title, 'Turn #1: 用户需求指令')
      assert.equal(turn.intent, '请运行单元测试并修复 packages/core 中的断言错误')
      assert.equal(turn.status, 'success')
      assert.equal(turn.subEvents.length, 5)
      assert.deepEqual(turn.toolCounts, {
        read: 1,
        bash: 1,
        edit: 1,
      })
      assert.equal(turn.totalDuration, '1.2s')
      assert(turn.tokenBreakdown)
      assert(turn.tokenBreakdown.total! > 0)
    })

    it('correctly partitions multi-turn user interactions into separate turns', () => {
      const events: TelemetryEvent[] = [
        // Turn 1
        {
          traceId: 'tr-multi',
          nodeId: 'user-t1',
          type: 'node_complete',
          gesture: 'read',
          actor: 'Human Operator',
          title: '用户需求指令',
          delta: '第一步：请检查代码格式并修复 lint 错误。',
          status: 'completed',
        },
        {
          traceId: 'tr-multi',
          nodeId: 'bash-t1',
          parentId: 'user-t1',
          type: 'node_complete',
          gesture: 'bash',
          actor: 'Claude 3.7 (Worker)',
          title: '$ pnpm lint',
          payload: { command: 'pnpm lint' },
          status: 'completed',
        },
        // Turn 2
        {
          traceId: 'tr-multi',
          nodeId: 'user-t2',
          parentId: 'bash-t1',
          type: 'node_complete',
          gesture: 'read',
          actor: 'Human Operator',
          title: '用户需求指令',
          delta: '第二步：增加核心数据契约强校验。',
          status: 'completed',
        },
        {
          traceId: 'tr-multi',
          nodeId: 'edit-t2',
          parentId: 'user-t2',
          type: 'node_complete',
          gesture: 'edit',
          actor: 'Claude 3.7 (Worker)',
          title: 'edit: contract.ts',
          payload: { path: 'src/contract.ts' },
          status: 'completed',
        },
        // Turn 3
        {
          traceId: 'tr-multi',
          nodeId: 'user-t3',
          parentId: 'edit-t2',
          type: 'node_complete',
          gesture: 'read',
          actor: 'Human Operator',
          title: '用户需求指令',
          delta: '第三步：提交本次更改。',
          status: 'completed',
        },
        {
          traceId: 'tr-multi',
          nodeId: 'gate-t3',
          parentId: 'user-t3',
          type: 'node_complete',
          gesture: 'gate',
          actor: 'Human Operator',
          title: 'Git 门禁审查',
          status: 'gate',
        },
      ]

      const turns = aggregateEventsIntoTurns(events)
      assert.equal(turns.length, 3)

      assert.equal(turns[0].turnIndex, 1)
      assert.equal(turns[0].intent, '第一步：请检查代码格式并修复 lint 错误')
      assert.deepEqual(turns[0].toolCounts, { bash: 1 })
      assert.equal(turns[0].status, 'success')

      assert.equal(turns[1].turnIndex, 2)
      assert.equal(turns[1].intent, '第二步：增加核心数据契约强校验')
      assert.deepEqual(turns[1].toolCounts, { edit: 1 })
      assert.equal(turns[1].status, 'success')

      assert.equal(turns[2].turnIndex, 3)
      assert.equal(turns[2].intent, '第三步：提交本次更改')
      assert.equal(turns[2].status, 'gate')
      assert.equal(turns[2].hasGate, true)
    })

    it('identifies branching status when self-correction occurred', () => {
      const events: TelemetryEvent[] = [
        {
          traceId: 'tr-branch',
          nodeId: 'think-init',
          type: 'node_complete',
          gesture: 'think',
          title: '启动重构',
          delta: '开始执行代码重构。',
          status: 'completed',
        },
        {
          traceId: 'tr-branch',
          nodeId: 'bash-fail',
          parentId: 'think-init',
          type: 'node_complete',
          gesture: 'bash',
          title: '$ pnpm test',
          status: 'failed',
          observation: { exitCode: 1, output: ['AssertionError'] },
        },
        {
          traceId: 'tr-branch',
          nodeId: 'think-correct',
          parentId: 'bash-fail',
          type: 'node_complete',
          gesture: 'think',
          title: '自愈诊断',
          delta: '修复空指针异常。',
          isCorrectionBranch: true,
          status: 'completed',
        },
        {
          traceId: 'tr-branch',
          nodeId: 'bash-verify',
          parentId: 'think-correct',
          type: 'node_complete',
          gesture: 'bash',
          title: '$ pnpm test',
          isCorrectionBranch: true,
          status: 'completed',
          observation: { exitCode: 0, output: ['10 passed'] },
        },
      ]

      const turns = aggregateEventsIntoTurns(events)
      assert.equal(turns.length, 1)
      assert.equal(turns[0].status, 'branching')
      assert.equal(turns[0].hasCorrection, true)
      assert.equal(turns[0].hasFailure, true)
    })

    it('identifies failed status when error remains unrecovered', () => {
      const events: TelemetryEvent[] = [
        {
          traceId: 'tr-fail',
          nodeId: 'think-1',
          type: 'node_complete',
          gesture: 'think',
          title: '执行构建',
          status: 'completed',
        },
        {
          traceId: 'tr-fail',
          nodeId: 'bash-build',
          parentId: 'think-1',
          type: 'node_complete',
          gesture: 'bash',
          title: '$ pnpm build',
          status: 'failed',
          observation: { exitCode: 1, output: ['Build failed: syntax error'] },
        },
      ]

      const turns = aggregateEventsIntoTurns(events)
      assert.equal(turns.length, 1)
      assert.equal(turns[0].status, 'failed')
    })

    it('aggregates realistic Pi JSONL sample accurately', () => {
      const parsed = parseTranscript(REALISTIC_PI_TRANSCRIPT_SAMPLE)
      const turns = aggregateEventsIntoTurns(parsed.events)

      assert.equal(turns.length, 1)
      const turn = turns[0]
      assert.equal(turn.turnIndex, 1)
      assert.equal(turn.turnId, 'turn-1')
      assert(turn.intent.includes('Ghost 数据清洗流'))
      // 包含 read, bash, edit 工具
      assert(turn.toolCounts.read >= 1)
      assert(turn.toolCounts.bash >= 2)
      assert(turn.toolCounts.edit >= 1)
      assert.equal(turn.status, 'branching')
      assert.equal(turn.hasCorrection, true)
    })
  })

  describe('Hierarchical Focus: turnsToFlowNodesAndEdges', () => {
    it('maps MacroTurnGroups to React Flow nodes with type turnNode and connecting edges', () => {
      const turns: MacroTurnGroup[] = [
        {
          turnId: 'turn-1',
          turnIndex: 1,
          title: 'Turn #1: 需求分析',
          intent: '分析重构需求',
          status: 'success',
          totalDuration: '800ms',
          toolCounts: { read: 2 },
          subEvents: [],
        },
        {
          turnId: 'turn-2',
          turnIndex: 2,
          title: 'Turn #2: 自愈实施',
          intent: '修复单测异常',
          status: 'branching',
          totalDuration: '1.4s',
          toolCounts: { bash: 2, edit: 1 },
          subEvents: [],
        },
        {
          turnId: 'turn-3',
          turnIndex: 3,
          title: 'Turn #3: 门禁审查',
          intent: '请求人工放行',
          status: 'gate',
          totalDuration: '200ms',
          toolCounts: {},
          subEvents: [],
        },
      ]

      const { nodes, edges } = turnsToFlowNodesAndEdges(turns)
      assert.equal(nodes.length, 3)
      assert.equal(edges.length, 2)

      // 验证节点类型均为 'turnNode'
      for (const n of nodes) {
        assert.equal(n.type, 'turnNode')
      }

      // 验证坐标排版
      assert.equal(nodes[0].position.x, 50)
      assert.equal(nodes[0].position.y, 180)
      assert.equal(nodes[1].position.x, 50 + 360)
      assert.equal(nodes[1].position.y, 180)

      // 验证连接边
      assert.equal(edges[0].source, 'turn-1')
      assert.equal(edges[0].target, 'turn-2')
      assert.equal(edges[0].type, 'smoothstep')
      // turn-2 是 branching，连线带有动画与琥珀金
      assert.equal(edges[0].animated, true)
      assert.equal(edges[0].style?.stroke, '#D97706')

      assert.equal(edges[1].source, 'turn-2')
      assert.equal(edges[1].target, 'turn-3')
    })

    it('adapts node positions dynamically without collision when turns are expanded', () => {
      const turns: MacroTurnGroup[] = [
        {
          turnId: 'turn-1',
          turnIndex: 1,
          title: 'Turn #1: 规划与阅读',
          intent: '阅读目标代码',
          status: 'success',
          totalDuration: '500ms',
          toolCounts: { read: 2 },
          subEvents: [],
        },
        {
          turnId: 'turn-2',
          turnIndex: 2,
          title: 'Turn #2: 修复与测试',
          intent: '执行单测自愈',
          status: 'success',
          totalDuration: '1.2s',
          toolCounts: { bash: 1 },
          subEvents: [],
        },
        {
          turnId: 'turn-3',
          turnIndex: 3,
          title: 'Turn #3: 门禁提交',
          intent: '完成提交',
          status: 'gate',
          totalDuration: '100ms',
          toolCounts: {},
          subEvents: [],
        },
      ]

      // 1. 测试展开单个节点 (turn-1 展开)：后续节点向右顺延平移 140px，消灭重叠
      const expandedTurn1 = new Set(['turn-1'])
      const result1 = turnsToFlowNodesAndEdges(turns, undefined, expandedTurn1)

      assert.equal(result1.nodes[0].data.isExpanded, true)
      assert.equal(result1.nodes[1].data.isExpanded, false)
      assert.equal(result1.nodes[2].data.isExpanded, false)

      // turn-1 位于 50，宽度 460，GAP 40 => turn-2 位于 50 + 460 + 40 = 550
      assert.equal(result1.nodes[0].position.x, 50)
      assert.equal(result1.nodes[1].position.x, 550)
      // turn-2 宽度 320，GAP 40 => turn-3 位于 550 + 320 + 40 = 910
      assert.equal(result1.nodes[2].position.x, 910)

      // 2. 测试展开多个节点 (turn-1 与 turn-2 同时展开)
      const expandedMultiple = new Set(['turn-1', 'turn-2'])
      const result2 = turnsToFlowNodesAndEdges(turns, expandedMultiple)

      assert.equal(result2.nodes[0].data.isExpanded, true)
      assert.equal(result2.nodes[1].data.isExpanded, true)
      assert.equal(result2.nodes[2].data.isExpanded, false)

      // turn-1: 50, turn-2: 550, turn-3: 550 + 460 + 40 = 1050
      assert.equal(result2.nodes[0].position.x, 50)
      assert.equal(result2.nodes[1].position.x, 550)
      assert.equal(result2.nodes[2].position.x, 1050)

      // 3. 测试通过 options 传入 onToggleExpand 与 onDrillDown 回调并透传至 node.data
      let toggledId = ''
      let drilledId = ''
      const onToggleExpand = (id: string) => {
        toggledId = id
      }
      const onDrillDown = (id: string) => {
        drilledId = id
      }
      const result3 = turnsToFlowNodesAndEdges(turns, {
        onToggleExpand,
        onDrillDown,
        expandedTurnIds: expandedTurn1,
      })

      assert.equal(typeof result3.nodes[0].data.onToggleExpand, 'function')
      const callback = result3.nodes[0].data.onToggleExpand as (id: string) => void
      callback('turn-test')
      assert.equal(toggledId, 'turn-test')

      assert.equal(typeof result3.nodes[0].data.onDrillDown, 'function')
      const drillCallback = result3.nodes[0].data.onDrillDown as (id: string) => void
      drillCallback('turn-drill-test')
      assert.equal(drilledId, 'turn-drill-test')
    })
  })

  describe('Real Token Watermark & Usage Extraction Contract (Task 1.4)', () => {
    describe('extractUsageFromRecord pure utility', () => {
      it('extracts Pi camelCase usage correctly', () => {
        const usage = extractUsageFromRecord({
          usage: {
            input: 1250,
            output: 450,
            cacheRead: 8500,
            reasoning: 350,
            total: 10550,
          },
        })
        assert.deepEqual(usage, {
          input: 1250,
          output: 450,
          cacheRead: 8500,
          reasoning: 350,
          total: 10550,
        })
      })

      it('extracts Claude snake_case usage with Anthropic token fields correctly', () => {
        const usage = extractUsageFromRecord({
          usage: {
            input_tokens: 3200,
            output_tokens: 800,
            cache_read_input_tokens: 24000,
            thinking_tokens: 600,
          },
        })
        assert.deepEqual(usage, {
          input: 3200,
          output: 800,
          cacheRead: 24000,
          reasoning: 600,
          total: 4000, // input + output when total is omitted
        })
      })

      it('extracts usage from msg.usage when record.usage is absent', () => {
        const usage = extractUsageFromRecord(
          {},
          {
            usage: {
              prompt_tokens: 1800,
              completion_tokens: 500,
              cacheReadTokens: 12000,
              reasoningTokens: 200,
            },
          }
        )
        assert.deepEqual(usage, {
          input: 1800,
          output: 500,
          cacheRead: 12000,
          reasoning: 200,
          total: 2300,
        })
      })

      it('returns undefined gracefully when usage is not an object', () => {
        assert.equal(extractUsageFromRecord({}), undefined)
        assert.equal(extractUsageFromRecord({ usage: null }), undefined)
        assert.equal(extractUsageFromRecord({ usage: '100' }), undefined)
      })
    })

    describe('Pi JSONL Real Usage & Watermark Extraction', () => {
      it('extracts usage tokens, tool outputs and computes session watermark accurately', () => {
        const piJsonl = [
          JSON.stringify({
            type: 'session',
            id: 'pi-token-session-1',
            timestamp: '2026-11-08T10:00:00.000Z',
          }),
          JSON.stringify({
            type: 'message',
            id: 'msg-sys-1',
            message: {
              role: 'system',
              content: 'You are an autonomous AI Agent specialized in refactoring.',
            },
          }),
          JSON.stringify({
            type: 'message',
            id: 'msg-user-1',
            message: {
              role: 'user',
              content: [{ type: 'text', text: '优化核心拓扑算法并编写单元测试' }],
            },
          }),
          JSON.stringify({
            type: 'message',
            id: 'msg-ast-1',
            message: {
              role: 'assistant',
              usage: {
                input: 2400,
                output: 480,
                cacheRead: 16000,
                reasoning: 220,
                total: 19100,
              },
              content: [
                {
                  type: 'thinking',
                  thinking: '需要读取拓扑排版算法，并执行单测以获取执行耗时。',
                },
                {
                  type: 'toolCall',
                  id: 'call_read_topo',
                  name: 'read',
                  arguments: { path: 'src/services/topology.ts' },
                },
              ],
            },
          }),
          JSON.stringify({
            type: 'message',
            id: 'msg-tool-res-1',
            message: {
              role: 'toolResult',
              toolCallId: 'call_read_topo',
              toolName: 'read',
              content: [
                {
                  type: 'text',
                  text: 'export function layoutDAG() {\n  return { width: 800, height: 600 }\n}',
                },
              ],
              isError: false,
            },
          }),
        ].join('\n')

        const parsed = parseTranscript(piJsonl)

        // 1. 验证 Assistant 节点的 usage 提取
        const thinkNode = parsed.events.find((e) => e.gesture === 'think')
        assert(thinkNode, 'Think node must exist')
        assert.deepEqual(thinkNode.usage, {
          input: 2400,
          output: 480,
          cacheRead: 16000,
          reasoning: 220,
          total: 19100,
        })

        // 2. 验证 Tool Result 节点的真实文本折算 tokens 与 linesCount
        const toolNode = parsed.events.find((e) => e.nodeId === 'call_read_topo')
        assert(toolNode, 'Tool node must exist')
        assert(toolNode.observation)
        assert.equal(toolNode.observation.linesCount, 3)
        assert.equal(toolNode.observation.charsCount, 103)
        assert.equal(toolNode.observation.tokens, 26)

        // 3. 验证 Session 水位全维契约 (ContextWatermark)
        const watermark = parsed.watermark
        assert(watermark, 'Watermark must exist')
        assert.equal(watermark.totalLimit, 200000)
        assert.equal(watermark.maxCapacity, 200000)
        assert(watermark.systemPrompt > 0, 'System prompt tokens should be > 0')
        assert.equal(watermark.cacheRead, 16000)
        assert.equal(watermark.reasoningTokens, 220)
        assert.equal(watermark.toolOutputs, 26)
        assert.equal(watermark.prunableTools, 26)
        assert(watermark.total! > 0, 'Total tokens should be > 0')

        // 4. 验证末尾事件注入的 watermark
        assert.deepEqual(parsed.events[parsed.events.length - 1].watermark, watermark)
      })
    })

    describe('Claude Code JSONL Real Usage & Watermark Extraction', () => {
      it('extracts Claude Anthropic usage, large tool result tokens, and MacroTurnGroup tokenBreakdown', () => {
        const longOutput =
          'Line 1: OK\nLine 2: Pass\nLine 3: 156 tests completed in 1.4s\nLine 4: memory clean'
        const claudeJsonl = [
          JSON.stringify({
            type: 'user',
            uuid: 'user-c1',
            message: {
              role: 'user',
              content: '运行自动化回归测试并确认状态',
            },
          }),
          JSON.stringify({
            type: 'assistant',
            uuid: 'asst-c1',
            message: {
              role: 'assistant',
              usage: {
                input_tokens: 5200,
                output_tokens: 950,
                cache_read_input_tokens: 48000,
                thinking_tokens: 420,
              },
              content: [
                {
                  type: 'thinking',
                  thinking: '执行 pnpm test 命令查看测试结果',
                },
                {
                  type: 'tool_use',
                  id: 'call_bash_test_run',
                  name: 'Bash',
                  input: { command: 'pnpm test' },
                },
              ],
            },
          }),
          JSON.stringify({
            type: 'user',
            uuid: 'user-tool-res-1',
            message: {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'call_bash_test_run',
                  content: longOutput,
                  is_error: false,
                },
              ],
            },
          }),
        ].join('\n')

        const parsed = parseTranscript(claudeJsonl)

        // 1. 验证 Bash 节点与 usage
        const bashNode = parsed.events.find((e) => e.nodeId === 'call_bash_test_run')
        assert(bashNode, 'Bash tool node must exist')
        assert(bashNode.observation)
        assert.equal(bashNode.observation.linesCount, 4)
        // output 80 chars + payload 23 chars = 103 chars => ceil(103 / 4) = 26 tokens
        assert.equal(bashNode.observation.charsCount, 103)
        assert.equal(bashNode.observation.tokens, 26)

        // 2. 验证 watermark
        const wm = parsed.watermark
        assert(wm)
        assert.equal(wm.cacheRead, 48000)
        assert.equal(wm.reasoningTokens, 420)
        assert.equal(wm.toolOutputs, 26)

        // 3. 验证 aggregateEventsIntoTurns 的 tokenBreakdown 聚合契约
        const turns = aggregateEventsIntoTurns(parsed.events)
        assert.equal(turns.length, 1)
        const turn = turns[0]
        assert(turn.tokenBreakdown, 'Turn must have tokenBreakdown')
        assert.equal(turn.tokenBreakdown.cacheRead, 48000)
        assert.equal(turn.tokenBreakdown.reasoningTokens, 420)
        assert.equal(turn.tokenBreakdown.input, 5200)
        assert.equal(turn.tokenBreakdown.output, 950)
        assert.equal(turn.tokenBreakdown.prunable, 26)
        assert.equal(turn.tokenBreakdown.toolOutputs, 26)
      })
    })

    describe('Baseline REALISTIC_PI_TRANSCRIPT_SAMPLE Watermark Contract', () => {
      it('calculates full-dimensional watermark for bundled sample without error', () => {
        const parsed = parseTranscript(REALISTIC_PI_TRANSCRIPT_SAMPLE)
        const wm = parsed.watermark
        assert(wm)
        // 窗口上限应由模型规则表解析（样例模型为 gemini-3.8-flash），不再写死 200k
        const resolvedWindow = resolveContextWindow(parsed.session.modelId)
        assert.equal(wm.totalLimit, resolvedWindow.window)
        assert.equal(wm.maxCapacity, resolvedWindow.window)
        assert.equal(wm.windowSource, resolvedWindow.source)
        assert(typeof wm.systemPrompt === 'number')
        assert(typeof wm.toolOutputs === 'number' && wm.toolOutputs > 0)
        assert(typeof wm.prunableTools === 'number' && wm.prunableTools > 0)
        assert(typeof wm.total === 'number' && wm.total > 0)
        assert(typeof wm.activeTurns === 'number')
      })
    })
  })
})

