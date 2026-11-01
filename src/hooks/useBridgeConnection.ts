import { useState, useEffect, useRef, useCallback } from 'react'
import type {
  GateDecision,
  GatePromptPayload,
  TelemetryEvent,
} from '../types/telemetry'

export type BridgeConnectionStatus = 'connected' | 'connecting' | 'disconnected'

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
  resolveGate: (gateId: string, decision: GateDecision) => Promise<boolean>
  sendTelemetry: (event: TelemetryEvent) => Promise<boolean>
  reconnect: () => void
}

const DEFAULT_WS_URL = 'ws://127.0.0.1:4560/ws'
const DEFAULT_HTTP_URL = 'http://127.0.0.1:4560'
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

      try {
        const socket = new WebSocket(wsUrl)
        wsRef.current = socket

        socket.onopen = () => {
          setStatus('connected')
        }

        socket.onmessage = (event: MessageEvent) => {
          try {
            const raw = typeof event.data === 'string' ? event.data : ''
            if (!raw.trim().startsWith('{')) return

            const data = JSON.parse(raw)

            // 1. 服务端上线同步初始状态
            if (data.type === 'bridge_connected') {
              if (Array.isArray(data.pendingGates)) {
                for (const gate of data.pendingGates) {
                  onGatePromptRef.current?.(gate)
                }
              }
              return
            }

            // 2. 门禁挂起事件 (HITL 审批模态窗唤醒)
            if (data.type === 'gate_prompt') {
              if (data.gatePayload) {
                onGatePromptRef.current?.(data.gatePayload)
              }
              onEventRef.current?.(data as TelemetryEvent)
              return
            }

            // 3. 门禁放行/拦截/热纠偏裁决事件
            if (data.type === 'gate_resolved') {
              const gateId = data.nodeId || data.gateId
              if (gateId && data.gateDecision) {
                onGateResolvedRef.current?.(gateId, data.gateDecision)
              }
              onEventRef.current?.(data as TelemetryEvent)
              return
            }

            // 4. 标准流式拓扑与系统事件 (node_start / node_stream / node_complete / context_pruned)
            if (data.type && (data.nodeId || data.type === 'context_pruned')) {
              onEventRef.current?.(data as TelemetryEvent)
            }
          } catch {
            // 忽略非标准或无效消息帧
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
      } catch {
        wsRef.current = null
        scheduleReconnect()
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
      try {
        const response = await fetch(`${httpUrl}/api/gate/resolve`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ gateId, decision }),
        })

        if (!response.ok) {
          console.warn(`[NetDive Bridge] Gate ${gateId} resolve rejected with status: ${response.status}`)
          return false
        }
        return true
      } catch (err) {
        console.warn(`[NetDive Bridge] Network error resolving gate ${gateId}:`, err)
        return false
      }
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
      try {
        const response = await fetch(`${httpUrl}/api/telemetry`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(event),
        })
        return response.ok
      } catch (err) {
        console.warn('[NetDive Bridge] Network error sending telemetry:', err)
        return false
      }
    },
    [httpUrl]
  )

  const manualReconnect = useCallback(() => {
    setReconnectTrigger((prev) => prev + 1)
  }, [])

  return {
    status,
    isConnected: status === 'connected',
    isConnecting: status === 'connecting',
    wsUrl,
    httpUrl,
    resolveGate,
    sendTelemetry,
    reconnect: manualReconnect,
  }
}
