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
})
