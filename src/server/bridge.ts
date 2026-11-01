import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve, type ServerType } from '@hono/node-server'
import { createNodeWebSocket, type NodeWebSocket } from '@hono/node-ws'
import { WebSocket } from 'ws'
import type {
  GateDecision,
  GatePromptPayload,
  TelemetryEvent,
} from '../types/telemetry'
import { GateManager } from '../services/gateManager'

export interface BridgeServerOptions {
  port?: number
  host?: string
  gateManager?: GateManager
}

export interface BridgeAppInstance {
  app: Hono
  gateManager: GateManager
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
export function createBridgeApp(options: { gateManager?: GateManager } = {}): BridgeAppInstance {
  const gateManager = options.gateManager || new GateManager()
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
      const event: TelemetryEvent = 'event' in body && body.event ? body.event : (body as TelemetryEvent)

      if (!event.type || !event.nodeId) {
        return c.json({ ok: false, error: 'Invalid telemetry event: nodeId and type are required' }, 400)
      }

      const normalizedEvent: TelemetryEvent = {
        ...event,
        timestamp: event.timestamp || Date.now(),
      }

      const delivered = broadcast(normalizedEvent)
      return c.json({
        ok: true,
        deliveredClients: delivered,
        nodeId: normalizedEvent.nodeId,
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
          }
      >()

      // 强契约解析门禁挂起载荷
      const rawPayload = 'gatePayload' in body && body.gatePayload ? body.gatePayload : body
      const gateId = rawPayload.gateId || `gate-${Date.now()}`
      const title = rawPayload.title || '决策门禁待审 (HITL)'
      const riskLevel = rawPayload.riskLevel || 'high'

      const proposedAction = rawPayload.proposedAction || {
        command: ('command' in body && typeof body.command === 'string' ? body.command : '') || '',
        diff: 'diff' in body && typeof body.diff === 'string' ? body.diff : undefined,
        explanation:
          ('explanation' in body && typeof body.explanation === 'string' ? body.explanation : '') ||
          'Agent 请求执行敏感动作，需人类操作员确认授权。',
      }

      const timestamp =
        ('timestamp' in rawPayload && typeof rawPayload.timestamp === 'string'
          ? rawPayload.timestamp
          : undefined) || new Date().toISOString()

      const gatePayload: GatePromptPayload = {
        gateId,
        title,
        riskLevel,
        proposedAction,
        timestamp,
      }

      // 注册到门禁协程挂起队列
      const decisionPromise = gateManager.registerGate(gatePayload)

      // 广播 gate_prompt 遥测事件给前端画布，触发挂起与居中审批模态窗
      const promptEvent: TelemetryEvent = {
        traceId: ('traceId' in body && body.traceId) || `trace-${gateId}`,
        nodeId: ('nodeId' in body && body.nodeId) || gateId,
        parentId: 'parentId' in body ? body.parentId : undefined,
        type: 'gate_prompt',
        gesture: 'gate',
        actor: ('actor' in body && body.actor) || 'Human Operator',
        title: gatePayload.title,
        status: 'gate',
        gatePayload,
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

  // 6. WebSocket 流式全双工端点 (/ws)
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
  const appInstance = createBridgeApp({ gateManager: options.gateManager })

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
