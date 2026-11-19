import { useState, useEffect, useRef, useCallback } from 'react'
import { tryit , isString } from 'radash'
import type {
  GateDecision,
  GatePromptPayload,
  TelemetryEvent,
} from '../types/telemetry'
import {
  DEFAULT_BRIDGE_HTTP_URL,
  DEFAULT_BRIDGE_WS_URL,
} from '../config/bridge'
import { httpJson, httpPostSilent, httpText } from '../utils/http'
import type { LocalSessionEntry } from '../services/localSessionScanner'

export { DEFAULT_BRIDGE_HTTP_URL, DEFAULT_BRIDGE_WS_URL }
export type { LocalSessionEntry }

export type BridgeConnectionStatus = 'connected' | 'connecting' | 'disconnected'

/**
 * WebSocket 下行帧统一契约（拓扑事件与门禁信令共用同一信封）
 * type 放宽为 string：信令帧（bridge_connected 等）不属于 TelemetryEventType
 */
type BridgeFrame = Omit<Partial<TelemetryEvent>, 'type'> & {
  type?: string
  gateId?: string
  gatePayload?: GatePromptPayload
  gateDecision?: GateDecision
  pendingGates?: GatePromptPayload[]
}

export interface UseBridgeConnectionOptions {
  wsUrl?: string
  httpUrl?: string
  enabled?: boolean
  reconnectIntervalMs?: number
  onEvent?: (event: TelemetryEvent) => void
  onGatePrompt?: (payload: GatePromptPayload) => void
  onGateResolved?: (gateId: string, decision: GateDecision) => void
}

export interface UseBridgeConnectionReturn {
  status: BridgeConnectionStatus
  isConnected: boolean
  isConnecting: boolean
  wsUrl: string
  httpUrl: string
  pendingGates: GatePromptPayload[]
  localSessions: LocalSessionEntry[]
  resolveGate: (gateId: string, decision: GateDecision) => Promise<boolean>
  sendTelemetry: (event: TelemetryEvent) => Promise<boolean>
  fetchLocalSessions: () => Promise<LocalSessionEntry[]>
  fetchSessionTranscript: (id: string) => Promise<string | null>
  reconnect: () => void
}

const DEFAULT_WS_URL = DEFAULT_BRIDGE_WS_URL
const DEFAULT_HTTP_URL = DEFAULT_BRIDGE_HTTP_URL
const DEFAULT_RECONNECT_INTERVAL_MS = 3000

/**
 * NetDive Local Sidecar Bridge 连接与流式双向通信 Hook
 */
export function useBridgeConnection(
  options: UseBridgeConnectionOptions = {}
): UseBridgeConnectionReturn {
  const {
    wsUrl = DEFAULT_WS_URL,
    httpUrl = DEFAULT_HTTP_URL,
    enabled = true,
    reconnectIntervalMs = DEFAULT_RECONNECT_INTERVAL_MS,
    onEvent,
    onGatePrompt,
    onGateResolved,
  } = options

  const [status, setStatus] = useState<BridgeConnectionStatus>('disconnected')
  const [pendingGates, setPendingGates] = useState<GatePromptPayload[]>([])
  const [localSessions, setLocalSessions] = useState<LocalSessionEntry[]>([])
  const [reconnectTrigger, setReconnectTrigger] = useState<number>(0)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const isManuallyClosedRef = useRef<boolean>(false)

  // 回调引用保鲜，避免因父级闭包重建导致 WebSocket 频繁断连重连
  const onEventRef = useRef(onEvent)
  const onGatePromptRef = useRef(onGatePrompt)
  const onGateResolvedRef = useRef(onGateResolved)

  useEffect(() => {
    onEventRef.current = onEvent
    onGatePromptRef.current = onGatePrompt
    onGateResolvedRef.current = onGateResolved
  }, [onEvent, onGatePrompt, onGateResolved])

  // 生命周期管理：组件挂载连接，卸载清理，以及重连调度
  useEffect(() => {
    if (!enabled) {
      if (wsRef.current) {
        isManuallyClosedRef.current = true
        wsRef.current.close()
        wsRef.current = null
      }
      return
    }

    isManuallyClosedRef.current = false

    const scheduleReconnect = () => {
      if (!isManuallyClosedRef.current && enabled) {
        reconnectTimerRef.current = window.setTimeout(() => {
          setupSocket()
        }, reconnectIntervalMs)
      }
    }

    const setupSocket = () => {
      if (wsRef.current) {
        isManuallyClosedRef.current = true
        wsRef.current.close()
        wsRef.current = null
      }
      isManuallyClosedRef.current = false

      {
        const socket = new WebSocket(wsUrl)
        wsRef.current = socket

        socket.onopen = () => {
          setStatus('connected')
        }

        socket.onmessage = (event: MessageEvent) => {
          const raw = isString(event.data) ? event.data : ''
          // 非 JSON 帧（心跳 / 二进制）直接丢弃，不做异常吞没
          if (!raw.trim().startsWith('{')) return

          const [parseErr, frame] = tryit(JSON.parse)(raw) as [
            Error | undefined,
            BridgeFrame | undefined,
          ]
          if (parseErr || !frame) {
            console.warn('[NetDive Bridge] 丢弃无法解析的消息帧:', parseErr?.message)
            return
          }

          const { type, nodeId, gateId, gatePayload, gateDecision, pendingGates } = frame

          {
            // 1. 服务端上线同步初始状态 (历史存量门禁记录于状态中，绝不主动弹出遮罩阻断用户)
            if (type === 'bridge_connected') {
              setPendingGates(pendingGates ?? [])
              return
            }

            // 2. 门禁挂起事件 (HITL 审批模态窗唤醒)
            if (type === 'gate_prompt') {
              if (gatePayload) {
                onGatePromptRef.current?.(gatePayload)
              }
              onEventRef.current?.(frame as TelemetryEvent)
              return
            }

            // 3. 门禁放行/拦截/热纠偏裁决事件
            if (type === 'gate_resolved') {
              const resolvedGateId = nodeId || gateId
              if (resolvedGateId && gateDecision) {
                onGateResolvedRef.current?.(resolvedGateId, gateDecision)
              }
              onEventRef.current?.(frame as TelemetryEvent)
              return
            }

            // 4. 标准流式拓扑与系统事件 (node_start / node_stream / node_complete / context_pruned)
            if (type && (nodeId || type === 'context_pruned')) {
              onEventRef.current?.(frame as TelemetryEvent)
            }
          }
        }

        socket.onerror = () => {
          // 静默处理，交给 onclose 触发降级与重连
        }

        socket.onclose = () => {
          wsRef.current = null
          setStatus('disconnected')
          scheduleReconnect()
        }
      }
    }

    setupSocket()

    return () => {
      isManuallyClosedRef.current = true
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [enabled, wsUrl, reconnectIntervalMs, reconnectTrigger])

  /**
   * 将前端人类裁决通过 HTTP POST /api/gate/resolve 转发给 Bridge Server
   */
  const resolveGate = useCallback(
    async (gateId: string, decision: GateDecision): Promise<boolean> => {
      const delivered = await httpPostSilent(`${httpUrl}/api/gate/resolve`, {
        gateId,
        decision,
      })

      if (!delivered) {
        console.warn(`[NetDive Bridge] 门禁 ${gateId} 裁决未送达，Bridge 可能已离线`)
      }

      return delivered
    },
    [httpUrl]
  )

  /**
   * 发射遥测事件至 Bridge Server
   */
  const sendTelemetry = useCallback(
    async (event: TelemetryEvent): Promise<boolean> => {
      // 优先通过活动 WebSocket 秒级下发
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'telemetry', event }))
        return true
      }

      // 兜底降级走 HTTP POST
      return await httpPostSilent(`${httpUrl}/api/telemetry`, event)
    },
    [httpUrl]
  )

  /**
   * 拉取本地 Pi 存量会话列表 (默认扫描最近活跃的 50 条)
   * 优先尝试同源 Vite /api（开发中间件直通），兜底尝试 4560 Bridge 端口
   */
  const fetchLocalSessions = useCallback(async (): Promise<LocalSessionEntry[]> => {
    let [err, data] = await httpJson<{ ok: boolean; sessions?: LocalSessionEntry[] }>(
      '/api/sessions/local?limit=50',
      { timeoutMs: 15000 }
    )

    if (err || !data?.ok || !data.sessions) {
      ;[err, data] = await httpJson<{ ok: boolean; sessions?: LocalSessionEntry[] }>(
        `${httpUrl}/api/sessions/local?limit=50`,
        { timeoutMs: 15000 }
      )
    }

    if (err || !data?.ok || !data.sessions) {
      return []
    }

    setLocalSessions(data.sessions)
    return data.sessions
  }, [httpUrl])

  /**
   * 拉取单个本地会话的完整 JSONL 文本内容
   */
  const fetchSessionTranscript = useCallback(
    async (id: string): Promise<string | null> => {
      let [err, text] = await httpText(`/api/sessions/local/${id}/transcript`)

      if (err || text === null) {
        ;[err, text] = await httpText(`${httpUrl}/api/sessions/local/${id}/transcript`)
      }

      if (err || text === null) {
        if (err) console.warn(`[NetDive Bridge] 会话 ${id} 转录拉取失败:`, err.message)
        return null
      }

      return text
    },
    [httpUrl]
  )

  // 组件挂载即主动拉取一次本地存量会话（不强制依赖 WebSocket 握手成功），仅在真正连接成功时刷新
  useEffect(() => {
    fetchLocalSessions()
  }, [fetchLocalSessions])

  useEffect(() => {
    if (status === 'connected') {
      fetchLocalSessions()
    }
  }, [status, fetchLocalSessions])

  const manualReconnect = useCallback(() => {
    setReconnectTrigger((prev) => prev + 1)
  }, [])

  return {
    status,
    isConnected: status === 'connected',
    isConnecting: status === 'connecting',
    wsUrl,
    httpUrl,
    pendingGates,
    localSessions,
    resolveGate,
    sendTelemetry,
    fetchLocalSessions,
    fetchSessionTranscript,
    reconnect: manualReconnect,
  }
}
