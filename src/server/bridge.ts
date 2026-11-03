import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { tryit } from 'radash'
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, join } from 'pathe'
import { serve, type ServerType } from '@hono/node-server'
import { createNodeWebSocket, type NodeWebSocket } from '@hono/node-ws'
import { WebSocket } from 'ws'
import type {
  GateDecision,
  GatePromptPayload,
  TelemetryEvent,
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
 * 统一提取并规约 GatePromptPayload 强契约
 * 声明式解构，消除 45 行嵌套三元与 'key' in body 猜谜
 */
export function resolveGatePromptPayload(body: Record<string, unknown>): GatePromptPayload {
  const inner = (body.gatePayload as Partial<GatePromptPayload>) || {}
  const rawAction = (inner.proposedAction || body.proposedAction || {}) as Record<string, unknown>

  const gateId = String(inner.gateId || body.gateId || `gate-${Date.now()}`)
  const title = String(inner.title || body.title || '决策门禁待审 (HITL)')
  const riskLevel = (inner.riskLevel === 'critical' || body.riskLevel === 'critical') ? 'critical' : 'high'

  const command = String(rawAction.command || body.command || '')
  const diff = typeof rawAction.diff === 'string' ? rawAction.diff : typeof body.diff === 'string' ? body.diff : undefined
  const explanation = String(
    rawAction.explanation ||
    body.explanation ||
    'Agent 请求执行敏感动作，需人类操作员确认授权。'
  )

  const timestamp =
    typeof inner.timestamp === 'string'
      ? inner.timestamp
      : typeof body.timestamp === 'string'
        ? body.timestamp
        : new Date().toISOString()

  const sessionId = (inner.sessionId || body.sessionId || body.session_id) as string | undefined
  const sessionTitle = (inner.sessionTitle || body.sessionTitle) as string | undefined
  const project = (inner.project || body.project) as string | undefined
  const actor = (inner.actor || body.actor) as string | undefined

  return {
    gateId,
    title,
    riskLevel,
    proposedAction: {
      command,
      diff,
      explanation,
    },
    timestamp,
    sessionId: sessionId?.trim() || undefined,
    sessionTitle: sessionTitle?.trim() || undefined,
    project: project?.trim() || undefined,
    actor: actor?.trim() || undefined,
  }
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
   * 声明式集合过滤分发，消除命令式 for 循环与可变计数器
   */
  const broadcast = (data: TelemetryEvent | Record<string, unknown>): number => {
    const raw = typeof data === 'string' ? data : JSON.stringify(data)
    const activeClients = Array.from(wss.clients).filter((c) => c.readyState === WebSocket.OPEN)
    activeClients.forEach((client) => client.send(raw))
    return activeClients.length
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
    const [jsonErr, body] = await tryit(() => c.req.json<TelemetryEvent | { event: TelemetryEvent }>())()
    if (jsonErr || !body) {
      const message = jsonErr instanceof Error ? jsonErr.message : 'Failed to parse telemetry body'
      return c.json({ ok: false, error: message }, 400)
    }

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
  })

  // 3. Agent 协程门禁挂起请求 (POST /api/gate/prompt)
  // Agent 执行到敏感操作（如 git commit / rm / deploy）时调用，挂起并等待人类在前端放行或纠偏
  app.post('/api/gate/prompt', async (c) => {
    const [jsonErr, body] = await tryit(() => c.req.json<Record<string, unknown>>())()
    if (jsonErr || !body) {
      return c.json(
        {
          action: 'reject',
          feedback: `Invalid JSON body: ${jsonErr?.message || 'Empty payload'}`,
        } satisfies GateDecision,
        400
      )
    }

    const [processErr, decision] = await tryit(async () => {
      // 第一性契约直给归一化：消灭 45 行防御八股与属性猜谜
      const gatePayload = resolveGatePromptPayload(body)
      const decisionPromise = gateManager.registerGate(gatePayload)

      const nodeId = (typeof body.nodeId === 'string' && body.nodeId) || gatePayload.gateId
      const parentId = typeof body.parentId === 'string' ? body.parentId : undefined
      const isCorrectionBranch = Boolean(body.isCorrectionBranch)
      const observation = normalizeTelemetryObservation(body.observation)
      const actor = (typeof body.actor === 'string' ? body.actor : 'Human Operator') as TelemetryEvent['actor']
      const sessionId = gatePayload.sessionId || (typeof body.sessionId === 'string' ? body.sessionId : undefined)
      const traceId = (typeof body.traceId === 'string' && body.traceId) || sessionId || gatePayload.gateId

      // 广播 gate_prompt 遥测事件给前端画布，触发挂起与居中审批模态窗
      const promptEvent: TelemetryEvent = {
        traceId,
        sessionId,
        sessionTitle: gatePayload.sessionTitle,
        project: gatePayload.project,
        nodeId,
        parentId,
        type: 'gate_prompt',
        gesture: 'gate',
        actor,
        title: gatePayload.title,
        status: 'gate',
        gatePayload,
        isCorrectionBranch,
        observation,
        timestamp: Date.now(),
      }
      broadcast(promptEvent)

      // 协程挂起，等待 Web UI 人类决断
      return await decisionPromise
    })()

    if (processErr) {
      const message = processErr instanceof Error ? processErr.message : 'Gate prompt failed'
      return c.json(
        {
          action: 'reject',
          feedback: `Gate suspended error: ${message}`,
        } satisfies GateDecision,
        500
      )
    }

    // 返回人类裁决结果给 Agent HTTP 调用方
    return c.json(decision)
  })

  // 4. Web UI 人类决策放行/拦截/纠偏裁决 (POST /api/gate/resolve)
  app.post('/api/gate/resolve', async (c) => {
    const [parseErr, body] = await tryit(() => c.req.json<{ gateId?: string; decision?: GateDecision }>())()
    if (parseErr || !body) {
      return c.json({ ok: false, error: parseErr?.message || 'Failed to parse JSON body' }, 400)
    }

    if (!body.gateId || !body.decision || !body.decision.action) {
      return c.json({ ok: false, error: 'Missing gateId or valid decision ({ action })' }, 400)
    }

    const existingGate = gateManager.getGate(body.gateId)
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

    // 广播 gate_resolved 事件给所有客户端同步节点状态 (继承原会话 sessionId 与 project，严禁造假 traceId)
    const resolvedEvent: TelemetryEvent = {
      traceId: existingGate?.sessionId || body.gateId,
      sessionId: existingGate?.sessionId,
      sessionTitle: existingGate?.sessionTitle,
      project: existingGate?.project,
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

  // 9. 探测本地 Pi / Claude 真实存量会话，并快速提取人类意图真名 (GET /api/sessions/local)
  app.get('/api/sessions/local', (c) => {
    const limit = Number(c.req.query('limit') || 30)
    const baseDir = resolve(homedir(), '.pi/agent/sessions')

    if (!existsSync(baseDir)) {
      return c.json({ ok: true, sessions: [] })
    }

    const [err, entries] = tryit(() => {
      const folders = readdirSync(baseDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)

      const allFiles: {
        id: string
        fileName: string
        title: string
        lineCount: number
        folder: string
        fullPath: string
        mtime: number
        size: number
        project: string
      }[] = []

      for (const folder of folders) {
        const folderPath = join(baseDir, folder)
        const projectMatch =
          folder.match(/Desktop-([A-Za-z0-9_-]+)--/) ||
          folder.match(/workspaces-([A-Za-z0-9_-]+)--/)
        const project = projectMatch ? projectMatch[1] : folder.replace(/^-+|-+$/g, '')

        const files = readdirSync(folderPath).filter((f) => f.endsWith('.jsonl'))

        for (const f of files) {
          const p = join(folderPath, f)
          const st = statSync(p)
          const idMatch = f.match(/([0-9a-fA-F-]{36})\.jsonl$/)
          const id = idMatch ? idMatch[1] : f.replace(/\.jsonl$/, '')

          // 轻量快速流式探测前 20 行，精准提取人类首问意图或标题，并统计真实有效事件行数
          let sessionTitle = f.replace(/\.jsonl$/, '')
          let actualLineCount = 0

          try {
            const rawHead = readFileSync(p, 'utf-8')
            const allLines = rawHead.split(/\r?\n/).filter((l) => l.trim().length > 0)
            actualLineCount = allLines.length

            for (let i = 0; i < Math.min(allLines.length, 30); i++) {
              const line = allLines[i]
              try {
                const item = JSON.parse(line)
                if (item.type === 'session' && typeof item.title === 'string' && item.title.trim()) {
                  sessionTitle = item.title.trim()
                  break
                }
                if (item.type === 'message' && item.message?.role === 'user') {
                  const content = item.message.content
                  let text = ''
                  if (typeof content === 'string') {
                    text = content
                  } else if (Array.isArray(content)) {
                    text = content.map((c: { text?: string }) => c.text || '').join('')
                  }
                  if (text.trim()) {
                    const cleanFirstLine = text.trim().split(/\r?\n/)[0].trim()
                    if (cleanFirstLine && !cleanFirstLine.startsWith('{') && cleanFirstLine.length > 1) {
                      sessionTitle = cleanFirstLine.length > 38 ? `${cleanFirstLine.slice(0, 36)}...` : cleanFirstLine
                      break
                    }
                  }
                }
              } catch {
                // ignore
              }
            }
          } catch {
            // ignore
          }

          allFiles.push({
            id,
            fileName: f,
            title: sessionTitle,
            lineCount: actualLineCount,
            folder,
            fullPath: p,
            mtime: st.mtimeMs,
            size: st.size,
            project,
          })
        }
      }

      // 按修改时间倒序排序，取前 N 个
      return allFiles.sort((a, b) => b.mtime - a.mtime).slice(0, limit)
    })()

    if (err) {
      return c.json({ ok: false, error: err.message }, 500)
    }

    return c.json({
      ok: true,
      sessions: entries || [],
    })
  })

  // 10. 读取单个本地存量会话的完整因果拓扑 (GET /api/sessions/local/:id/transcript)
  app.get('/api/sessions/local/:id/transcript', (c) => {
    const sessionId = c.req.param('id')
    const baseDir = resolve(homedir(), '.pi/agent/sessions')

    if (!existsSync(baseDir)) {
      return c.json({ ok: false, error: 'Sessions directory not found' }, 404)
    }

    const [findErr, targetFile] = tryit(() => {
      const folders = readdirSync(baseDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)

      for (const folder of folders) {
        const folderPath = join(baseDir, folder)
        const match = readdirSync(folderPath).find(
          (f) => f.includes(sessionId) && f.endsWith('.jsonl')
        )
        if (match) {
          return join(folderPath, match)
        }
      }
      return null
    })()

    if (findErr || !targetFile || !existsSync(targetFile)) {
      return c.json({ ok: false, error: `Session transcript for ${sessionId} not found` }, 404)
    }

    // 全量读取并回传完整历史流水（不再暴力截断前 150 步，交由下游 transcriptParser 精准治理巨型二进制）
    const raw = readFileSync(targetFile, 'utf-8')
    return c.text(raw)
  })

  // 11. WebSocket 流式全双工端点 (/ws)
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
          const text = typeof event.data === 'string' ? event.data : event.data.toString()
          if (!text.trim().startsWith('{')) return

          const [jsonErr, data] = tryit(JSON.parse)(text) as [Error | undefined, Record<string, unknown>]
          if (jsonErr || !data || typeof data !== 'object') return

          if (data.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }))
            return
          }

          // 支持通过 WebSocket 直接下发 resolve_gate
          if (data.type === 'resolve_gate' && data.gateId && data.decision) {
            const gateIdStr = String(data.gateId)
            const existingGate = gateManager.getGate(gateIdStr)
            const success = gateManager.resolveGate(gateIdStr, data.decision as GateDecision)
            if (success) {
              broadcast({
                traceId: existingGate?.sessionId || gateIdStr,
                sessionId: existingGate?.sessionId,
                sessionTitle: existingGate?.sessionTitle,
                project: existingGate?.project,
                nodeId: gateIdStr,
                type: 'gate_resolved',
                gesture: 'gate',
                actor: 'Human Operator',
                gateDecision: data.decision as GateDecision,
                status: (data.decision as GateDecision).action === 'reject' ? 'rejected' : 'completed',
                timestamp: Date.now(),
              } satisfies TelemetryEvent)
            }
            return
          }

          // 支持通过 WebSocket 查询 WAL 离线日志记录
          if (data.type === 'get_wal' && data.pointerId) {
            const entry = microCompactor.getWal(String(data.pointerId))
            ws.send(JSON.stringify({ type: 'wal_entry', pointerId: data.pointerId, entry: entry || null }))
            return
          }

          // 支持通过 WebSocket 转发遥测事件
          if (data.type === 'telemetry' && data.event) {
            broadcast(data.event as TelemetryEvent)
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
