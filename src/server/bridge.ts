import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve, type ServerType } from '@hono/node-server'
import { createNodeWebSocket, type NodeWebSocket } from '@hono/node-ws'
import { WebSocket } from 'ws'
import type {
  GateDecision,
  GatePromptPayload,
  TelemetryEvent,
  TelemetryObservation,
} from '../types/telemetry'
import {
  normalizeTelemetryObservation,
} from '../types/telemetry'
import { GateManager } from '../services/gateManager'
import { AssertionEngine, assertionEngine as defaultAssertionEngine } from '../services/assertionEngine'
import { MicroCompactor, microCompactor as defaultMicroCompactor } from '../services/microCompactor'

export interface BridgeServerOptions {
  port?: number
  host?: string
  gateManager?: GateManager
  assertionEngine?: AssertionEngine
  microCompactor?: MicroCompactor
}

export interface BridgeAppInstance {
  app: Hono
  gateManager: GateManager
  assertionEngine: AssertionEngine
  microCompactor: MicroCompactor
  nodeWs: NodeWebSocket
  broadcast: (data: TelemetryEvent | Record<string, unknown>) => number
}

export interface RunningBridgeServer extends BridgeAppInstance {
  server: ServerType
  port: number
  host: string
  close: () => Promise<void>
}

/**
 * 创建 NetDive 本地桥接服务应用实例 (Hono + WebSocket)
 */
export function createBridgeApp(options: {
  gateManager?: GateManager
  assertionEngine?: AssertionEngine
  microCompactor?: MicroCompactor
} = {}): BridgeAppInstance {
  const gateManager = options.gateManager || new GateManager()
  const assertionEngine = options.assertionEngine || defaultAssertionEngine
  const microCompactor = options.microCompactor || defaultMicroCompactor
  const app = new Hono()

  // 跨域支持 (允许 Vite Web UI 与外部本地 Agent 进程直连)
  app.use('*', cors())

  // 挂载 Node.js 原生 WebSocket
  const nodeWs = createNodeWebSocket({ app })
  const { upgradeWebSocket, wss } = nodeWs

  /**
   * 广播事件至所有已建立连接且活跃的 Web UI WebSocket 客户端
   */
  const broadcast = (data: TelemetryEvent | Record<string, unknown>): number => {
    const raw = typeof data === 'string' ? data : JSON.stringify(data)
    let dispatched = 0
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(raw)
        dispatched++
      }
    }
    return dispatched
  }

  // 1. 服务健康检查与元数据探针
  app.get('/health', (c) => {
    return c.json({
      ok: true,
      version: '0.1.0',
      connectedClients: wss.clients.size,
      pendingGates: gateManager.getPendingGates().length,
    })
  })

  // 2. 外部 Agent 遥测流式事件摄入端点 (POST /api/telemetry)
  app.post('/api/telemetry', async (c) => {
    try {
      const body = await c.req.json<TelemetryEvent | { event: TelemetryEvent }>()
      const rawEvent: TelemetryEvent = 'event' in body && body.event ? body.event : (body as TelemetryEvent)

      if (!rawEvent || !rawEvent.type || !rawEvent.nodeId) {
        return c.json({ ok: false, error: 'Invalid telemetry event: nodeId and type are required' }, 400)
      }

      // 强契约规范化 TelemetryObservation
      const normalizedObs = normalizeTelemetryObservation(rawEvent.observation)
      const event: TelemetryEvent = {
        ...rawEvent,
        observation: normalizedObs,
      }

      // L1 确定性断言引擎判定 (L1 Deterministic Assertion)
      const assertion = event.assertion || assertionEngine.evaluate(event)

      // 在决定节点状态与拓扑分叉前进行断言介入
      let finalStatus = event.status
      let isCorrectionBranch = event.isCorrectionBranch
      let eventType = event.type
      let gatePayload = event.gatePayload

      if (assertion.triggerGate && finalStatus !== 'rejected' && finalStatus !== 'completed') {
        finalStatus = 'gate'
        if (!gatePayload && eventType !== 'gate_resolved') {
          const isResonance = Boolean(assertion.reason?.includes('Fatal Failure Resonance'))
          gatePayload = {
            gateId: `gate-${event.nodeId}`,
            title: isResonance
              ? '致命共振紧急门禁拦截 (Fatal Failure Resonance)'
              : (event.title || '高危命令安全门禁审查 (HITL)'),
            riskLevel: 'critical',
            proposedAction: {
              command:
                (typeof event.payload?.command === 'string' ? event.payload.command : undefined) ||
                event.title ||
                'High-Risk / Resonance Action',
              explanation: assertion.reason || 'L1 Assertion Engine 检测到需要人类决策门禁介入',
            },
            timestamp: new Date().toISOString(),
          }
          eventType = 'gate_prompt'
          gateManager.registerGate(gatePayload)
        }
      } else if (assertion.triggerSelfCorrection && finalStatus !== 'gate' && finalStatus !== 'completed') {
        finalStatus = 'failed'
      }

      // 微压缩引擎介入 (MicroCompactor Engine: Rule 1 & Rule 3)
      let observation = normalizedObs
      let pointerId = observation?.pointerId
      let compactSummary = observation?.compactSummary

      if (observation && observation.output && observation.output.length > 0) {
        const compactedObs = microCompactor.compactObservation(observation, {
          toolName: event.gesture,
          nodeId: event.nodeId,
        })
        observation = compactedObs
        pointerId = compactedObs.pointerId
        compactSummary = compactedObs.compactSummary
      }

      const normalizedEvent: TelemetryEvent = {
        ...event,
        type: eventType,
        status: finalStatus || event.status,
        isCorrectionBranch,
        assertion,
        observation,
        gatePayload,
        timestamp: event.timestamp || Date.now(),
      }

      const delivered = broadcast(normalizedEvent)
      return c.json({
        ok: true,
        deliveredClients: delivered,
        nodeId: normalizedEvent.nodeId,
        assertion,
        pointerId,
        compactSummary,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse telemetry body'
      return c.json({ ok: false, error: message }, 400)
    }
  })

  // 3. Agent 协程门禁挂起请求 (POST /api/gate/prompt)
  // Agent 执行到敏感操作（如 git commit / rm / deploy）时调用，挂起并等待人类在前端放行或纠偏
  app.post('/api/gate/prompt', async (c) => {
    try {
      const body = await c.req.json<
        | GatePromptPayload
        | {
            gatePayload?: GatePromptPayload
            gateId?: string
            title?: string
            riskLevel?: 'high' | 'critical'
            proposedAction?: { command: string; diff?: string; explanation: string }
            command?: string
            diff?: string
            explanation?: string
            traceId?: string
            nodeId?: string
            parentId?: string
            actor?: TelemetryEvent['actor']
            timestamp?: string
            observation?: TelemetryObservation
            isCorrectionBranch?: boolean
          }
      >()

      // 强契约解析门禁挂起载荷
      const rawPayload = 'gatePayload' in body && body.gatePayload ? body.gatePayload : body
      const gateId =
        rawPayload.gateId ||
        ('gateId' in body && typeof body.gateId === 'string' ? body.gateId : undefined) ||
        `gate-${Date.now()}`

      const title =
        rawPayload.title ||
        ('title' in body && typeof body.title === 'string' ? body.title : undefined) ||
        '决策门禁待审 (HITL)'

      const riskLevel =
        rawPayload.riskLevel ||
        ('riskLevel' in body && (body.riskLevel === 'high' || body.riskLevel === 'critical') ? body.riskLevel : undefined) ||
        'high'

      const rawAction =
        ('proposedAction' in rawPayload && rawPayload.proposedAction) ||
        ('proposedAction' in body && body.proposedAction) ||
        undefined

      const proposedAction = {
        command:
          (rawAction && typeof rawAction.command === 'string' ? rawAction.command : '') ||
          ('command' in body && typeof body.command === 'string' ? body.command : '') ||
          '',
        diff:
          (rawAction && typeof rawAction.diff === 'string' ? rawAction.diff : undefined) ||
          ('diff' in body && typeof body.diff === 'string' ? body.diff : undefined),
        explanation:
          (rawAction && typeof rawAction.explanation === 'string' ? rawAction.explanation : '') ||
          ('explanation' in body && typeof body.explanation === 'string' ? body.explanation : '') ||
          'Agent 请求执行敏感动作，需人类操作员确认授权。',
      }

      const timestamp =
        ('timestamp' in rawPayload && typeof rawPayload.timestamp === 'string'
          ? rawPayload.timestamp
          : undefined) ||
        ('timestamp' in body && typeof body.timestamp === 'string'
          ? body.timestamp
          : undefined) ||
        new Date().toISOString()

      const gatePayload: GatePromptPayload = {
        gateId,
        title,
        riskLevel,
        proposedAction,
        timestamp,
      }

      // 注册到门禁协程挂起队列
      const decisionPromise = gateManager.registerGate(gatePayload)

      const nodeId = ('nodeId' in body && typeof body.nodeId === 'string' && body.nodeId) || gateId
      const parentId = 'parentId' in body && typeof body.parentId === 'string' ? body.parentId : undefined
      const isCorrectionBranch = 'isCorrectionBranch' in body ? Boolean(body.isCorrectionBranch) : false
      const observation = normalizeTelemetryObservation('observation' in body ? body.observation : undefined)

      // 广播 gate_prompt 遥测事件给前端画布，触发挂起与居中审批模态窗
      const promptEvent: TelemetryEvent = {
        traceId: ('traceId' in body && typeof body.traceId === 'string' && body.traceId) || `trace-${gateId}`,
        nodeId,
        parentId,
        type: 'gate_prompt',
        gesture: 'gate',
        actor: ('actor' in body && body.actor) || 'Human Operator',
        title: gatePayload.title,
        status: 'gate',
        gatePayload,
        isCorrectionBranch,
        observation,
        timestamp: Date.now(),
      }
      broadcast(promptEvent)

      // 协程挂起，等待 Web UI 人类决断
      const decision: GateDecision = await decisionPromise

      // 返回人类裁决结果给 Agent HTTP 调用方
      return c.json(decision)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gate prompt failed'
      return c.json(
        {
          action: 'reject',
          feedback: `Gate suspended error: ${message}`,
        } satisfies GateDecision,
        500
      )
    }
  })

  // 4. Web UI 人类决策放行/拦截/纠偏裁决 (POST /api/gate/resolve)
  app.post('/api/gate/resolve', async (c) => {
    try {
      const body = await c.req.json<{ gateId?: string; decision?: GateDecision }>()

      if (!body.gateId || !body.decision || !body.decision.action) {
        return c.json({ ok: false, error: 'Missing gateId or valid decision ({ action })' }, 400)
      }

      const success = gateManager.resolveGate(body.gateId, body.decision)
      if (!success) {
        return c.json(
          {
            ok: false,
            message: `Gate ${body.gateId} not found or already settled`,
          },
          404
        )
      }

      // 广播 gate_resolved 事件给所有客户端同步节点状态
      const resolvedEvent: TelemetryEvent = {
        traceId: `trace-resolved-${body.gateId}`,
        nodeId: body.gateId,
        type: 'gate_resolved',
        gesture: 'gate',
        actor: 'Human Operator',
        gateDecision: body.decision,
        status: body.decision.action === 'reject' ? 'rejected' : 'completed',
        timestamp: Date.now(),
      }
      broadcast(resolvedEvent)

      return c.json({
        ok: true,
        gateId: body.gateId,
        decision: body.decision,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to resolve gate'
      return c.json({ ok: false, error: message }, 400)
    }
  })

  // 5. 获取当前待裁决门禁清单 (GET /api/gate/pending)
  app.get('/api/gate/pending', (c) => {
    return c.json({
      ok: true,
      pendingGates: gateManager.getPendingGates(),
    })
  })

  // 6. Write-Ahead Log (WAL) 离线日志全局统计与条目清单 (GET /api/wal)
  app.get('/api/wal', (c) => {
    return c.json({
      ok: true,
      stats: microCompactor.getWalStats(),
      entries: microCompactor.getAllWal(),
    })
  })

  // 7. Write-Ahead Log (WAL) 单个指针记录检视 (GET /api/wal/:pointerId)
  app.get('/api/wal/:pointerId', (c) => {
    const pointerId = c.req.param('pointerId')
    const entry = microCompactor.getWal(pointerId)
    if (!entry) {
      return c.json({ ok: false, error: `WAL entry "${pointerId}" not found` }, 404)
    }
    return c.json({
      ok: true,
      entry,
    })
  })

  // 8. Write-Ahead Log (WAL) 原始未压缩输出回放 (GET /api/wal/:pointerId/replay)
  app.get('/api/wal/:pointerId/replay', (c) => {
    const pointerId = c.req.param('pointerId')
    const raw = microCompactor.replay(pointerId)
    if (raw === undefined) {
      return c.json({ ok: false, error: `WAL entry "${pointerId}" not found` }, 404)
    }
    return c.text(raw)
  })

  // 9. WebSocket 流式全双工端点 (/ws)
  app.get(
    '/ws',
    upgradeWebSocket(() => {
      return {
        onOpen(_event, ws) {
          // 客户端连接成功后发送欢迎问候与当前待裁决门禁状态同步
          const pending = gateManager.getPendingGates()
          ws.send(
            JSON.stringify({
              type: 'bridge_connected',
              version: '0.1.0',
              pendingGates: pending,
              timestamp: Date.now(),
            })
          )
        },
        onMessage(event, ws) {
          try {
            const text = typeof event.data === 'string' ? event.data : event.data.toString()
            if (!text.trim().startsWith('{')) return

            const data = JSON.parse(text)
            if (data.type === 'ping') {
              ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }))
              return
            }

            // 支持通过 WebSocket 直接下发 resolve_gate
            if (data.type === 'resolve_gate' && data.gateId && data.decision) {
              const success = gateManager.resolveGate(data.gateId, data.decision)
              if (success) {
                broadcast({
                  traceId: `trace-resolved-${data.gateId}`,
                  nodeId: data.gateId,
                  type: 'gate_resolved',
                  gesture: 'gate',
                  actor: 'Human Operator',
                  gateDecision: data.decision,
                  status: data.decision.action === 'reject' ? 'rejected' : 'completed',
                  timestamp: Date.now(),
                } satisfies TelemetryEvent)
              }
              return
            }

            // 支持通过 WebSocket 查询 WAL 离线日志记录
            if (data.type === 'get_wal' && data.pointerId) {
              const entry = microCompactor.getWal(data.pointerId)
              ws.send(JSON.stringify({ type: 'wal_entry', pointerId: data.pointerId, entry: entry || null }))
              return
            }

            // 支持通过 WebSocket 转发遥测事件
            if (data.type === 'telemetry' && data.event) {
              broadcast(data.event)
            }
          } catch {
            // 忽略非标准或无效 WebSocket 帧
          }
        },
      }
    })
  )

  return {
    app,
    gateManager,
    assertionEngine,
    microCompactor,
    nodeWs,
    broadcast,
  }
}

/**
 * 启动 NetDive Local Sidecar Bridge 监听服务
 */
export function startBridgeServer(options: BridgeServerOptions = {}): Promise<RunningBridgeServer> {
  const port = options.port || Number(process.env.PORT || 4560)
  const host = options.host || process.env.HOST || '127.0.0.1'
  const appInstance = createBridgeApp({
    gateManager: options.gateManager,
    assertionEngine: options.assertionEngine,
    microCompactor: options.microCompactor,
  })

  return new Promise((resolve) => {
    const server = serve(
      {
        fetch: appInstance.app.fetch,
        port,
        hostname: host,
      },
      () => {
        appInstance.nodeWs.injectWebSocket(server)
        resolve({
          ...appInstance,
          server,
          port,
          host,
          close: () =>
            new Promise<void>((res, rej) => {
              server.close((err) => {
                if (err) rej(err)
                else res()
              })
            }),
        })
      }
    )
  })
}
