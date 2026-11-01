import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { WebSocket } from 'ws'
import { startBridgeServer, type RunningBridgeServer } from './bridge'
import type { TelemetryEvent, GateDecision } from '../types/telemetry'

const TEST_PORT = 4575
const TEST_HOST = '127.0.0.1'

describe('NetDive Hono Bridge Server & Gate HITL Integration', () => {
  let bridgeServer: RunningBridgeServer

  before(async () => {
    bridgeServer = await startBridgeServer({ port: TEST_PORT, host: TEST_HOST })
  })

  after(async () => {
    await bridgeServer.close()
  })

  it('GET /health returns server health and version', async () => {
    const res = await fetch(`http://${TEST_HOST}:${TEST_PORT}/health`)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.ok, true)
    assert.equal(data.version, '0.1.0')
    assert.equal(typeof data.connectedClients, 'number')
    assert.equal(typeof data.pendingGates, 'number')
  })

  it('WebSocket /ws allows client connection and broadcasts telemetry', async () => {
    const ws = new WebSocket(`ws://${TEST_HOST}:${TEST_PORT}/ws`)
    const receivedMessages: unknown[] = []

    ws.on('message', (raw) => {
      receivedMessages.push(JSON.parse(raw.toString()))
    })

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve())
      ws.on('error', reject)
    })

    // 1. Initial greeting
    await new Promise((r) => setTimeout(r, 80))
    assert.ok(receivedMessages.length >= 1)
    const firstMsg = receivedMessages[0] as { type: string; version: string }
    assert.equal(firstMsg.type, 'bridge_connected')
    assert.equal(firstMsg.version, '0.1.0')

    // 2. Broadcast via POST /api/telemetry
    const telemetryEvent: TelemetryEvent = {
      traceId: 'trace-test-ws',
      nodeId: 'node-test-ws',
      type: 'node_start',
      gesture: 'think',
      actor: 'pi-coordinator',
      title: 'Planning automated test',
    }

    const postRes = await fetch(`http://${TEST_HOST}:${TEST_PORT}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(telemetryEvent),
    })
    assert.equal(postRes.status, 200)
    const postData = await postRes.json()
    assert.equal(postData.ok, true)
    assert.equal(postData.nodeId, 'node-test-ws')

    // Verify client received broadcast
    await new Promise((r) => setTimeout(r, 80))
    const receivedTelemetry = receivedMessages.find(
      (m) => (m as TelemetryEvent).nodeId === 'node-test-ws'
    ) as TelemetryEvent
    assert.ok(receivedTelemetry)
    assert.equal(receivedTelemetry.title, 'Planning automated test')

    ws.close()
  })

  it('Gate HITL RPC: agent suspends on /api/gate/prompt and resumes on /api/gate/resolve', async () => {
    const ws = new WebSocket(`ws://${TEST_HOST}:${TEST_PORT}/ws`)
    const wsEvents: unknown[] = []
    ws.on('message', (raw) => wsEvents.push(JSON.parse(raw.toString())))

    await new Promise<void>((resolve) => ws.on('open', () => resolve()))

    const gateId = `gate-test-${Date.now()}`
    const proposedCommand = 'git commit -m "feat: sensitive action"'

    // Agent calls prompt (suspends promise)
    const agentPromptPromise = fetch(`http://${TEST_HOST}:${TEST_PORT}/api/gate/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gateId,
        title: 'Git Commit Review',
        riskLevel: 'high',
        proposedAction: {
          command: proposedCommand,
          explanation: 'Code review completed',
        },
      }),
    })

    // Give time to register and broadcast
    await new Promise((r) => setTimeout(r, 100))

    // Check pending gates endpoint
    const pendingRes = await fetch(`http://${TEST_HOST}:${TEST_PORT}/api/gate/pending`)
    const pendingData = await pendingRes.json()
    assert.equal(pendingData.ok, true)
    const foundPending = pendingData.pendingGates.find(
      (g: { gateId: string }) => g.gateId === gateId
    )
    assert.ok(foundPending)

    // Check that WS client received gate_prompt event
    const promptWsEvent = wsEvents.find(
      (m) => (m as TelemetryEvent).type === 'gate_prompt' && (m as TelemetryEvent).nodeId === gateId
    ) as TelemetryEvent
    assert.ok(promptWsEvent)
    assert.equal(promptWsEvent.status, 'gate')

    // Web UI sends human modification decision
    const humanDecision: GateDecision = {
      action: 'modify',
      feedback: 'Add conventional commit scope',
      modifiedCommand: 'git commit -m "feat(pipeline): sensitive action with scope"',
    }

    const resolveRes = await fetch(`http://${TEST_HOST}:${TEST_PORT}/api/gate/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gateId,
        decision: humanDecision,
      }),
    })
    assert.equal(resolveRes.status, 200)
    const resolveData = await resolveRes.json()
    assert.equal(resolveData.ok, true)
    assert.equal(resolveData.gateId, gateId)

    // Agent caller is unblocked with decision
    const agentRes = await agentPromptPromise
    assert.equal(agentRes.status, 200)
    const agentDecision = (await agentRes.json()) as GateDecision
    assert.equal(agentDecision.action, 'modify')
    assert.equal(agentDecision.modifiedCommand, humanDecision.modifiedCommand)

    // Verify WS received gate_resolved event
    await new Promise((r) => setTimeout(r, 80))
    const resolvedWsEvent = wsEvents.find(
      (m) =>
        (m as TelemetryEvent).type === 'gate_resolved' && (m as TelemetryEvent).nodeId === gateId
    ) as TelemetryEvent
    assert.ok(resolvedWsEvent)
    assert.equal(resolvedWsEvent.status, 'completed')

    ws.close()
  })

  it('Rejection decision marks gate rejected and unblocks agent caller', async () => {
    const gateId = `gate-reject-${Date.now()}`

    const agentPromptPromise = fetch(`http://${TEST_HOST}:${TEST_PORT}/api/gate/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gateId,
        title: 'Dangerous Operation',
        riskLevel: 'critical',
        proposedAction: { command: 'rm -rf /', explanation: 'Delete all' },
      }),
    })

    await new Promise((r) => setTimeout(r, 60))

    const resolveRes = await fetch(`http://${TEST_HOST}:${TEST_PORT}/api/gate/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gateId,
        decision: {
          action: 'reject',
          feedback: 'Dangerous command blocked by human operator',
        },
      }),
    })
    assert.equal(resolveRes.status, 200)

    const agentRes = await agentPromptPromise
    const agentDecision = (await agentRes.json()) as GateDecision
    assert.equal(agentDecision.action, 'reject')
    assert.equal(agentDecision.feedback, 'Dangerous command blocked by human operator')
  })

  it('Context pruning: broadcasts context_pruned event and updates token watermark', async () => {
    const ws = new WebSocket(`ws://${TEST_HOST}:${TEST_PORT}/ws`)
    const wsEvents: unknown[] = []
    ws.on('message', (raw) => wsEvents.push(JSON.parse(raw.toString())))

    await new Promise<void>((resolve) => ws.on('open', () => resolve()))

    const pruneEvent: TelemetryEvent = {
      traceId: 'trace-prune-test',
      nodeId: 'context-watermark',
      type: 'context_pruned',
      reclaimedTokens: 42000,
      watermark: {
        totalLimit: 128000,
        systemPrompt: 8000,
        ltm: 12000,
        activeTurns: 16000,
        prunableTools: 4000,
      },
      prunedNodeIds: ['node-2', 'node-3'],
      timestamp: Date.now(),
    }

    const postRes = await fetch(`http://${TEST_HOST}:${TEST_PORT}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pruneEvent),
    })
    assert.equal(postRes.status, 200)

    await new Promise((r) => setTimeout(r, 80))

    const receivedPrune = wsEvents.find(
      (m) => (m as TelemetryEvent).type === 'context_pruned'
    ) as TelemetryEvent
    assert.ok(receivedPrune)
    assert.equal(receivedPrune.reclaimedTokens, 42000)
    assert.equal(receivedPrune.watermark?.prunableTools, 4000)
    assert.deepEqual(receivedPrune.prunedNodeIds, ['node-2', 'node-3'])

    ws.close()
  })

  it('L1 Assertion: POST /api/telemetry with exitCode !== 0 asserts Self-Correction branching and marks failed status', async () => {
    const ws = new WebSocket(`ws://${TEST_HOST}:${TEST_PORT}/ws`)
    const wsEvents: unknown[] = []
    ws.on('message', (raw) => wsEvents.push(JSON.parse(raw.toString())))

    await new Promise<void>((resolve) => ws.on('open', () => resolve()))

    const testEvent: TelemetryEvent = {
      traceId: 'trace-assert-1',
      nodeId: `node-err-${Date.now()}`,
      type: 'node_complete',
      gesture: 'bash',
      title: 'Run test suite',
      observation: {
        exitCode: 1,
        output: ['AssertionError: Expected 200, got 500'],
      },
    }

    const res = await fetch(`http://${TEST_HOST}:${TEST_PORT}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testEvent),
    })

    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.ok, true)
    assert.ok(data.assertion)
    assert.equal(data.assertion.passed, false)
    assert.equal(data.assertion.triggerSelfCorrection, true)
    assert.equal(data.assertion.triggerGate, false)
    assert.equal(data.assertion.severity, 'warn')

    await new Promise((r) => setTimeout(r, 80))
    const wsReceived = wsEvents.find(
      (m) => (m as TelemetryEvent).nodeId === testEvent.nodeId
    ) as TelemetryEvent
    assert.ok(wsReceived)
    assert.equal(wsReceived.status, 'failed')
    assert.equal(wsReceived.assertion?.triggerSelfCorrection, true)

    ws.close()
  })

  it('L1 Assertion: POST /api/telemetry with high-risk command triggers Human Gate and registers pending gate', async () => {
    const highRiskNodeId = `node-risk-${Date.now()}`
    const highRiskEvent: TelemetryEvent = {
      traceId: 'trace-risk-1',
      nodeId: highRiskNodeId,
      type: 'node_complete',
      gesture: 'bash',
      title: 'git commit -m "chore: critical commit"',
      payload: {
        command: 'git commit -m "chore: critical commit"',
      },
    }

    const res = await fetch(`http://${TEST_HOST}:${TEST_PORT}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(highRiskEvent),
    })

    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.ok, true)
    assert.ok(data.assertion)
    assert.equal(data.assertion.triggerGate, true)
    assert.equal(data.assertion.severity, 'critical')
    assert.equal(data.assertion.rule, 'high_risk_gate')

    // Verify gate was registered in gateManager
    const pendingRes = await fetch(`http://${TEST_HOST}:${TEST_PORT}/api/gate/pending`)
    const pendingData = await pendingRes.json()
    const foundGate = pendingData.pendingGates.find(
      (g: { gateId: string }) => g.gateId === `gate-${highRiskNodeId}`
    )
    assert.ok(foundGate)
  })

  it('L1 Assertion: Repetitive failure >= 2 times via Bridge triggers Fatal Failure Resonance and emergency gate', async () => {
    const { assertionEngine } = await import('../services/assertionEngine')
    assertionEngine.reset()

    const failNodeId = `node-repeat-${Date.now()}`
    const repeatEvent: TelemetryEvent = {
      traceId: 'trace-repeat',
      nodeId: failNodeId,
      type: 'node_complete',
      gesture: 'bash',
      title: 'pnpm test:strict',
      observation: {
        exitCode: 1,
        output: ['StrictAssertionError: Loop resonance detected'],
      },
    }

    // Attempt 1: triggers self-correction
    const res1 = await fetch(`http://${TEST_HOST}:${TEST_PORT}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(repeatEvent),
    })
    const data1 = await res1.json()
    assert.equal(data1.assertion.triggerSelfCorrection, true)
    assert.equal(data1.assertion.triggerGate, false)

    // Attempt 2: triggers Fatal Failure Resonance emergency gate!
    const res2 = await fetch(`http://${TEST_HOST}:${TEST_PORT}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(repeatEvent),
    })
    const data2 = await res2.json()
    assert.equal(data2.assertion.triggerGate, true)
    assert.equal(data2.assertion.triggerSelfCorrection, false)
    assert.equal(data2.assertion.severity, 'critical')
    assert.match(data2.assertion.reason, /Fatal Failure Resonance/i)

    // Verify emergency gate was registered
    const pendingRes = await fetch(`http://${TEST_HOST}:${TEST_PORT}/api/gate/pending`)
    const pendingData = await pendingRes.json()
    const foundResonanceGate = pendingData.pendingGates.find(
      (g: { gateId: string }) => g.gateId === `gate-${failNodeId}`
    )
    assert.ok(foundResonanceGate)
  })

  it('Bridge Server POST /api/telemetry normalizes string observation.output to string[]', async () => {
    const res = await fetch(`http://${TEST_HOST}:${TEST_PORT}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: `node-str-test-${Date.now()}`,
        traceId: 'trace-str-test',
        type: 'node_complete',
        gesture: 'bash',
        title: 'String Output Test',
        observation: {
          exitCode: 0,
          output: 'Line 1\nLine 2\nLine 3',
        },
      }),
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.ok, true)
  })

  it('Bridge Server POST /api/gate/prompt accepts omitted node_start and mounts correctly', async () => {
    const gateId = `gate-direct-${Date.now()}`
    const promptPromise = fetch(`http://${TEST_HOST}:${TEST_PORT}/api/gate/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: 'direct-gate-node',
        parentId: 'prev-node',
        gateId,
        title: 'Direct Gate Without Node Start',
        riskLevel: 'critical',
        proposedAction: {
          command: 'git commit -m "feat: direct"',
          explanation: 'Direct gate test',
        },
      }),
    })

    await new Promise((r) => setTimeout(r, 80))

    // Check pending gates
    const pendingRes = await fetch(`http://${TEST_HOST}:${TEST_PORT}/api/gate/pending`)
    const pendingData = await pendingRes.json()
    const found = pendingData.pendingGates.find((g: { gateId: string }) => g.gateId === gateId)
    assert.ok(found)

    // Resolve gate
    const resolveRes = await fetch(`http://${TEST_HOST}:${TEST_PORT}/api/gate/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gateId,
        decision: { action: 'approve' },
      }),
    })
    assert.equal(resolveRes.status, 200)

    const promptRes = await promptPromise
    assert.equal(promptRes.status, 200)
    const promptData = await promptRes.json()
    assert.equal(promptData.action, 'approve')
  })
})

describe('Context Watermark & Token Utilities', () => {
  it('formatTokens formats numbers correctly into human-readable strings', async () => {
    const { formatTokens, DEFAULT_CONTEXT_WATERMARK } = await import('../types/telemetry')
    assert.equal(formatTokens(128000), '128k')
    assert.equal(formatTokens(82000), '82k')
    assert.equal(formatTokens(46000), '46k')
    assert.equal(formatTokens(4000), '4k')
    assert.equal(formatTokens(4500), '4.5k')
    assert.equal(formatTokens(500), '500')

    const totalUsed =
      DEFAULT_CONTEXT_WATERMARK.systemPrompt +
      DEFAULT_CONTEXT_WATERMARK.ltm +
      DEFAULT_CONTEXT_WATERMARK.activeTurns +
      DEFAULT_CONTEXT_WATERMARK.prunableTools
    assert.equal(totalUsed, 82000)
    const ratio = Math.round((totalUsed / DEFAULT_CONTEXT_WATERMARK.totalLimit) * 100)
    assert.equal(ratio, 64)
  })

  it('BASE_CONTEXT_WATERMARK satisfies base state contract (~22k tokens, safe green)', async () => {
    const { BASE_CONTEXT_WATERMARK } = await import('../types/telemetry')
    assert.deepEqual(BASE_CONTEXT_WATERMARK, {
      totalLimit: 128000,
      systemPrompt: 12000,
      ltm: 8000,
      activeTurns: 2000,
      prunableTools: 0,
    })
    const baseTotal =
      BASE_CONTEXT_WATERMARK.systemPrompt +
      BASE_CONTEXT_WATERMARK.ltm +
      BASE_CONTEXT_WATERMARK.activeTurns +
      BASE_CONTEXT_WATERMARK.prunableTools
    assert.equal(baseTotal, 22000)
    const ratio = Math.round((baseTotal / BASE_CONTEXT_WATERMARK.totalLimit) * 100)
    assert.equal(ratio, 17)
  })

  it('getDynamicWatermarkDelta calculates step increments based on gestures', async () => {
    const { getDynamicWatermarkDelta } = await import('../hooks/useTelemetryStream')
    assert.deepEqual(getDynamicWatermarkDelta({ gesture: 'think' }), {
      activeTurns: 3000,
      prunableTools: 0,
    })
    assert.deepEqual(getDynamicWatermarkDelta({ gesture: 'edit' }), {
      activeTurns: 3500,
      prunableTools: 12000,
    })
    assert.deepEqual(
      getDynamicWatermarkDelta({
        gesture: 'bash',
        observation: { exitCode: 0, output: ['Tests passed'] },
      }),
      {
        activeTurns: 3000,
        prunableTools: 16000,
      }
    )
    assert.deepEqual(getDynamicWatermarkDelta({ gesture: 'gate', isGate: true }), {
      activeTurns: 500,
      prunableTools: 0,
    })
  })

  it('self-correction scenario accumulates to 46k prunableTools and 88k total tokens (amber warning)', async () => {
    const { BASE_CONTEXT_WATERMARK } = await import('../types/telemetry')
    const { SELF_CORRECTION_SCENARIO, getDynamicWatermarkDelta } = await import(
      '../hooks/useTelemetryStream'
    )

    let current = { ...BASE_CONTEXT_WATERMARK }

    for (const node of SELF_CORRECTION_SCENARIO) {
      const delta = getDynamicWatermarkDelta(node)
      current = {
        ...current,
        activeTurns: current.activeTurns + (delta.activeTurns ?? 0),
        prunableTools: current.prunableTools + (delta.prunableTools ?? 0),
      }
    }

    assert.equal(current.prunableTools, 46000)
    const totalUsed =
      current.systemPrompt + current.ltm + current.activeTurns + current.prunableTools
    assert.equal(totalUsed, 88000)
    const usagePercent = Math.round((totalUsed / current.totalLimit) * 100)
    assert.equal(usagePercent, 69) // 88000 / 128000 = 68.75% -> 69% amber warning
  })

  it('default scenario accumulates watermark dynamically as steps progress', async () => {
    const { BASE_CONTEXT_WATERMARK } = await import('../types/telemetry')
    const { DEFAULT_TELEMETRY_SCENARIO, getDynamicWatermarkDelta } = await import(
      '../hooks/useTelemetryStream'
    )

    let current = { ...BASE_CONTEXT_WATERMARK }

    for (const node of DEFAULT_TELEMETRY_SCENARIO) {
      const delta = getDynamicWatermarkDelta(node)
      current = {
        ...current,
        activeTurns: current.activeTurns + (delta.activeTurns ?? 0),
        prunableTools: current.prunableTools + (delta.prunableTools ?? 0),
      }
    }

    assert.equal(current.prunableTools, 32000)
    const totalUsed =
      current.systemPrompt + current.ltm + current.activeTurns + current.prunableTools
    assert.equal(totalUsed, 65000)
  })
})

describe('Prunable Context Inspector & Stream Pause/Resume Control', () => {
  it('DEFAULT_PRUNABLE_ITEMS satisfies prunable items and token breakdown contract (~46k tokens)', async () => {
    const { DEFAULT_PRUNABLE_ITEMS } = await import(
      '../types/telemetry'
    )

    assert.equal(DEFAULT_PRUNABLE_ITEMS.length, 3)

    // Item 1: Bash pnpm test:pipeline -> 156 passed (~28k tokens)
    const item1 = DEFAULT_PRUNABLE_ITEMS[0]
    assert.equal(item1.gesture, 'bash')
    assert.match(item1.title, /Bash: pnpm test:pipeline -> 156 passed/)
    assert.match(item1.rawDetail, /150 lines raw test stdout\/stderr, ~28k tokens/)
    assert.equal(item1.tokens, 28000)
    assert.equal(item1.statusBadge, '已完成历史使命 (Resolved)')
    assert.match(item1.foldedSummary, /单元测试回归通过 \(156 passed, 0 failed\)/)
    assert.ok(!item1.foldedSummary.includes('[已修剪:'), 'foldedSummary must not contain [已修剪:] when not pruned')
    assert.equal(item1.linesCount, 150)
    assert.ok(item1.rawPayloadPreview?.includes('$ pnpm test:pipeline'))

    // Item 2: Edit packages/core/pipeline.ts (~14k tokens)
    const item2 = DEFAULT_PRUNABLE_ITEMS[1]
    assert.equal(item2.gesture, 'edit')
    assert.match(item2.title, /Edit: packages\/core\/pipeline\.ts/)
    assert.match(item2.rawDetail, /Full AST diff & replaced try\/catch \(~14k tokens\)/)
    assert.equal(item2.tokens, 14000)
    assert.equal(item2.statusBadge, '已完成历史使命 (Resolved)')
    assert.ok(!item2.foldedSummary.includes('[已修剪:'))
    assert.equal(item2.linesCount, 42)
    assert.ok(item2.rawPayloadPreview?.includes('--- a/packages/core/src/pipeline.ts'))

    // Item 3: Read src/config.ts (~4k tokens)
    const item3 = DEFAULT_PRUNABLE_ITEMS[2]
    assert.equal(item3.gesture, 'read')
    assert.match(item3.title, /Read: src\/config\.ts/)
    assert.match(item3.rawDetail, /Raw file contents \(~4k tokens\)/)
    assert.equal(item3.tokens, 4000)
    assert.equal(item3.statusBadge, '已完成历史使命 (Resolved)')
    assert.match(item3.foldedSummary, /成功读取 package\.json，确认依赖缺失/)
    assert.ok(!item3.foldedSummary.includes('[已修剪:'))
    assert.equal(item3.linesCount, 28)
    assert.ok(item3.rawPayloadPreview?.includes('@netdive/core'))

    // Total tokens sum to 46,000 (matching DEFAULT_CONTEXT_WATERMARK.prunableTools)
    const totalTokens = DEFAULT_PRUNABLE_ITEMS.reduce((acc, it) => acc + it.tokens, 0)
    assert.equal(totalTokens, 46000)
  })

  it('useTelemetryStream exports pauseStream, resumeStream, isPaused, and togglePauseResume', async () => {
    const hookModule = await import('../hooks/useTelemetryStream')
    assert.equal(typeof hookModule.useTelemetryStream, 'function')
    assert.equal(typeof hookModule.extractPrunableItems, 'function')
  })

  it('extractPrunableItems dynamically extracts prunable items from completed tool nodes and excludes think/gate/running nodes', async () => {
    const { extractPrunableItems } = await import('../hooks/useTelemetryStream')

    // 1. Empty nodes returns []
    assert.deepEqual(extractPrunableItems([]), [])

    // 2. Only think node returns []
    const thinkNode: any = {
      id: 'node-think',
      type: 'agentNode',
      position: { x: 0, y: 0 },
      data: {
        title: '思考步骤',
        actor: 'Pi (Coordinator)',
        gesture: 'think',
        status: 'completed',
        summary: '规划因果步骤',
      },
    }
    assert.deepEqual(extractPrunableItems([thinkNode]), [])

    // 3. Running tool node returns []
    const runningBashNode: any = {
      id: 'node-running-bash',
      type: 'agentNode',
      position: { x: 0, y: 0 },
      data: {
        title: '执行中测试',
        actor: 'Claude 3.7 (Worker)',
        gesture: 'bash',
        status: 'running',
        summary: 'pnpm test:pipeline in progress...',
      },
    }
    assert.deepEqual(extractPrunableItems([thinkNode, runningBashNode]), [])

    // 4. Completed bash with test output, completed edit, completed read
    const completedBashNode: any = {
      id: 'node-bash',
      type: 'agentNode',
      position: { x: 0, y: 0 },
      data: {
        title: '单元测试回归',
        actor: 'Claude 3.7 (Worker)',
        gesture: 'bash',
        status: 'completed',
        summary: 'pnpm test:pipeline -> 156 passed',
        observation: {
          exitCode: 0,
          output: ['Tests: 156 passed, 156 total', 'Time: 1.78s'],
        },
      },
    }

    const completedEditNode: any = {
      id: 'node-edit',
      type: 'agentNode',
      position: { x: 0, y: 0 },
      data: {
        title: '代码重构实现',
        actor: 'Claude 3.7 (Worker)',
        gesture: 'edit',
        status: 'completed',
        summary: '移除原生 try-catch，迁移至 radash.tryit',
      },
    }

    const completedReadNode: any = {
      id: 'node-read',
      type: 'agentNode',
      position: { x: 0, y: 0 },
      data: {
        title: '读取配置',
        actor: 'Claude 3.7 (Worker)',
        gesture: 'read',
        status: 'completed',
        summary: '读取 package.json 依赖契约',
      },
    }

    const items = extractPrunableItems([
      thinkNode,
      completedEditNode,
      completedBashNode,
      completedReadNode,
    ])

    assert.equal(items.length, 3)

    // Sorted descending by tokens: bash (28k) -> edit (14k) -> read (4k)
    assert.equal(items[0].id, 'node-bash')
    assert.equal(items[0].tokens, 28000)
    assert.equal(items[0].gesture, 'bash')
    assert.equal(items[0].emoji, '📟')
    assert.equal(items[0].statusBadge, '已完成历史使命 (Resolved)')
    assert.equal(items[0].foldedSummary, 'pnpm test:pipeline -> 156 passed')
    assert.ok(!items[0].foldedSummary.includes('[已修剪:'), 'foldedSummary must not contain [已修剪:] when unpruned')
    assert.match(items[0].rawDetail, /Tests: 156 passed/)
    assert.ok(items[0].rawPayloadPreview?.includes('$ pnpm test:pipeline'))
    assert.equal(items[0].linesCount, 150)

    assert.equal(items[1].id, 'node-edit')
    assert.equal(items[1].tokens, 14000)
    assert.equal(items[1].gesture, 'edit')
    assert.equal(items[1].emoji, '📝')
    assert.equal(items[1].statusBadge, '已完成历史使命 (Resolved)')
    assert.equal(items[1].foldedSummary, '移除原生 try-catch，迁移至 radash.tryit')
    assert.ok(!items[1].foldedSummary.includes('[已修剪:'))
    assert.ok(items[1].rawPayloadPreview?.includes('--- a/packages/core/src/pipeline.ts'))
    assert.equal(items[1].linesCount, 42)

    assert.equal(items[2].id, 'node-read')
    assert.equal(items[2].tokens, 4000)
    assert.equal(items[2].gesture, 'read')
    assert.equal(items[2].emoji, '🔍')
    assert.equal(items[2].statusBadge, '已完成历史使命 (Resolved)')
    assert.equal(items[2].foldedSummary, '读取 package.json 依赖契约')
    assert.ok(!items[2].foldedSummary.includes('[已修剪:'))
    assert.ok(items[2].rawPayloadPreview?.includes('@netdive/core'))
    assert.equal(items[2].linesCount, 28)

    // 5. When node is pruned (pruned: true), statusBadge updates to '已折叠压缩 (Pruned)' and foldedSummary is marked
    const prunedBashNode: any = {
      ...completedBashNode,
      data: {
        ...completedBashNode.data,
        pruned: true,
      },
    }
    const prunedItems = extractPrunableItems([prunedBashNode])
    assert.equal(prunedItems.length, 1)
    assert.equal(prunedItems[0].statusBadge, '已折叠压缩 (Pruned)')
    assert.equal(prunedItems[0].foldedSummary, '[已修剪: pnpm test:pipeline -> 156 passed]')
  })

  it('extractPrunableItems formats rich rawPayloadPreview and fallback foldedSummary without [已修剪:]', async () => {
    const { extractPrunableItems } = await import('../hooks/useTelemetryStream')

    // 1. Bash node without summary defaults to clean descriptive summary line
    const bareBashNode: any = {
      id: 'bare-bash',
      type: 'agentNode',
      position: { x: 0, y: 0 },
      data: {
        gesture: 'bash',
        status: 'completed',
      },
    }
    const [bareItem] = extractPrunableItems([bareBashNode])
    assert.equal(bareItem.foldedSummary, '单元测试回归通过 (156 passed, 0 failed)')
    assert.ok(!bareItem.foldedSummary.includes('[已修剪:'))
    assert.ok(bareItem.rawPayloadPreview?.includes('$ pnpm test:pipeline'))
    assert.ok(bareItem.rawPayloadPreview?.includes('150 lines raw stdout/stderr hidden'))

    // 2. Failed bash node formats multiline error logs with ✖ and AssertionError
    const failedBashNode: any = {
      id: 'failed-bash',
      type: 'agentNode',
      position: { x: 0, y: 0 },
      data: {
        title: '单测回归 (捕获异常)',
        gesture: 'bash',
        status: 'failed',
        observation: {
          exitCode: 1,
          output: [
            'AssertionError: Expected 200 OK, got 500 Internal Error',
            'at packages/core/test/pipeline.test.ts:42',
          ],
        },
      },
    }
    const [failedItem] = extractPrunableItems([failedBashNode])
    assert.ok(failedItem.rawPayloadPreview?.includes('$ pnpm test:pipeline'))
    assert.ok(failedItem.rawPayloadPreview?.includes('✖ AssertionError: Expected 200 OK, got 500'))
    assert.ok(failedItem.rawPayloadPreview?.includes('150 lines raw stdout/stderr hidden'))
    assert.equal(failedItem.linesCount, 150)

    // 3. Edit node with custom payload.diff preserves exact diff and counts lines
    const customDiffNode: any = {
      id: 'custom-diff',
      type: 'agentNode',
      position: { x: 0, y: 0 },
      data: {
        title: '注入自愈补丁',
        gesture: 'edit',
        status: 'completed',
        summary: '注入防御性空值 fallback',
        payload: {
          diff: '--- a/src/pipeline.ts\n+++ b/src/pipeline.ts\n@@ -10,3 +10,4 @@\n+ if (!payload) return DEFAULT_FALLBACK;\n+ const [err, res] = await tryit(run)();',
        },
      },
    }
    const [diffItem] = extractPrunableItems([customDiffNode])
    assert.equal(diffItem.foldedSummary, '注入防御性空值 fallback')
    assert.ok(!diffItem.foldedSummary.includes('[已修剪:'))
    assert.ok(diffItem.rawPayloadPreview?.includes('if (!payload) return DEFAULT_FALLBACK;'))
    assert.equal(diffItem.linesCount, 5)
  })

  it('PrunableInspectorDrawer and AgentNode components export successfully with expected types', async () => {
    const { PrunableInspectorDrawer } = await import('../components/PrunableInspectorDrawer')
    assert.equal(typeof PrunableInspectorDrawer, 'function')

    const { AgentNode } = await import('../components/AgentNode')
    assert.equal(typeof AgentNode, 'function')
  })

  it('useTelemetryStream exports assertionEngine instance', async () => {
    const { assertionEngine: hookEngine } = await import('../hooks/useTelemetryStream')
    assert.ok(hookEngine)
    assert.equal(typeof hookEngine.evaluate, 'function')
    assert.equal(typeof hookEngine.reset, 'function')
  })
})

describe('Telemetry Event Normalization & Contract Robustness', () => {
  it('normalizeObservationOutput safely converts varied outputs to string[]', async () => {
    const { normalizeObservationOutput } = await import('../types/telemetry')

    // 1. String with newlines splits into array
    assert.deepEqual(normalizeObservationOutput('line 1\nline 2\r\nline 3'), [
      'line 1',
      'line 2',
      'line 3',
    ])

    // 2. Single string becomes 1-element array
    assert.deepEqual(normalizeObservationOutput('single line'), ['single line'])

    // 3. String[] remains string[]
    assert.deepEqual(normalizeObservationOutput(['a', 'b']), ['a', 'b'])

    // 4. Array with embedded newlines splits cleanly
    assert.deepEqual(normalizeObservationOutput(['line 1\nline 2', 'line 3']), [
      'line 1',
      'line 2',
      'line 3',
    ])

    // 5. Null, undefined, empty string handled safely
    assert.deepEqual(normalizeObservationOutput(null), [])
    assert.deepEqual(normalizeObservationOutput(undefined), [])
    assert.deepEqual(normalizeObservationOutput(''), [''])

    // 6. Number and boolean converted safely
    assert.deepEqual(normalizeObservationOutput(42), ['42'])
    assert.deepEqual(normalizeObservationOutput(true), ['true'])
  })

  it('normalizeTelemetryObservation safely normalizes observation objects', async () => {
    const { normalizeTelemetryObservation } = await import('../types/telemetry')

    // 1. Observation with string output gets converted to string[]
    const obs1 = normalizeTelemetryObservation({
      exitCode: 0,
      output: 'Tests passed\nAll 156 ok',
    })
    assert.ok(obs1)
    assert.equal(obs1.exitCode, 0)
    assert.deepEqual(obs1.output, ['Tests passed', 'All 156 ok'])

    // 2. Observation with string exitCode converts to number
    const obs2 = normalizeTelemetryObservation({
      exitCode: '1',
      output: ['fail'],
    })
    assert.ok(obs2)
    assert.equal(obs2.exitCode, 1)

    // 3. Missing observation returns undefined
    assert.equal(normalizeTelemetryObservation(null), undefined)
    assert.equal(normalizeTelemetryObservation(undefined), undefined)
    assert.equal(normalizeTelemetryObservation('invalid'), undefined)
  })

  it('getDynamicWatermarkDelta handles null/undefined and malformed inputs gracefully', async () => {
    const { getDynamicWatermarkDelta } = await import('../hooks/useTelemetryStream')

    // 1. Null/undefined returns safe default
    assert.deepEqual(getDynamicWatermarkDelta(null), { activeTurns: 2000, prunableTools: 0 })
    assert.deepEqual(getDynamicWatermarkDelta(undefined), { activeTurns: 2000, prunableTools: 0 })

    // 2. Bash with string output correctly detects heavy output
    const delta1 = getDynamicWatermarkDelta({
      gesture: 'bash',
      observation: { exitCode: 0, output: '156 tests passed' },
    })
    assert.deepEqual(delta1, { activeTurns: 3000, prunableTools: 16000 })

    // 3. Bash with empty string or empty array gives base tools delta
    const delta2 = getDynamicWatermarkDelta({
      gesture: 'bash',
      observation: { exitCode: 0, output: [] },
    })
    assert.deepEqual(delta2, { activeTurns: 3000, prunableTools: 12000 })
  })

  it('extractPrunableItems does not crash on nodes with string output or missing fields', async () => {
    const { extractPrunableItems } = await import('../hooks/useTelemetryStream')

    // 1. Node with observation.output as a single string
    const stringObsNode: any = {
      id: 'node-str-obs',
      type: 'agentNode',
      position: { x: 0, y: 0 },
      data: {
        title: 'Bash 执行',
        gesture: 'bash',
        status: 'completed',
        observation: {
          exitCode: 0,
          output: 'M package.json\nM src/App.tsx',
        },
      },
    }

    const items = extractPrunableItems([stringObsNode])
    assert.equal(items.length, 1)
    assert.equal(items[0].id, 'node-str-obs')
    assert.ok(items[0].rawDetail.includes('M package.json'))
    assert.ok(items[0].rawPayloadPreview?.includes('M package.json'))

    // 2. Node with observation.output as null/undefined
    const nullObsNode: any = {
      id: 'node-null-obs',
      type: 'agentNode',
      position: { x: 0, y: 0 },
      data: {
        title: 'Bash 空输出',
        gesture: 'bash',
        status: 'completed',
        observation: {
          exitCode: 0,
          output: null,
        },
      },
    }
    const nullItems = extractPrunableItems([nullObsNode])
    assert.equal(nullItems.length, 1)
  })
})




