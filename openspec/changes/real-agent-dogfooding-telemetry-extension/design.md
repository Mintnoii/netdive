# Architecture Design: real-agent-dogfooding-telemetry-extension

## 1. 跨进程端到端拓扑 (End-to-End Pipeline)

```text
 ┌────────────────────────────────────────────────────────┐
 │           本地真实运行环境 (Local CLI / Harness)          │
 │                                                        │
 │   ┌──────────────────────┐   ┌──────────────────────┐  │
 │   │  Pi Coding Agent     │   │  Claude Worker       │  │
 │   │  (~/.pi/agent/ext/)  │   │  (Orca Dispatcher)   │  │
 │   └──────────┬───────────┘   └──────────┬───────────┘  │
 └──────────────┼──────────────────────────┼──────────────┘
                │                          │
                ▼ (HTTP Post & SSE / JSON) ▼
 ┌────────────────────────────────────────────────────────┐
 │        NetDive Hono Bridge Server (127.0.0.1:4560)     │
 │   - /api/telemetry (分发至活跃 WebSocket 画布)          │
 │   - /api/gate/prompt (Promise 协程挂起与放行决议返回)     │
 └──────────────────────────▲─────────────────────────────┘
                            │ WebSocket
                            ▼
 ┌────────────────────────────────────────────────────────┐
 │        NetDive 前端可视化工作台 (浏览器画布 5173)         │
 └────────────────────────────────────────────────────────┘
```

## 2. 核心技术实现机制

### 2.1 Pi 扩展生命周期钩子适配
编写轻量 Pi 插件 `netdive-tracer.ts`：
```typescript
import { type ExtensionAPI } from '@earendil-works/pi-coding-agent'

export default function netdiveTracer(api: ExtensionAPI) {
  const BRIDGE_URL = 'http://127.0.0.1:4560'

  // 1. 捕获思考与工具调用开始
  api.on('tool_call_start', async (event) => {
    fetch(`${BRIDGE_URL}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        traceId: api.sessionId,
        nodeId: `node-${event.callId}`,
        type: 'node_start',
        gesture: event.toolName,
        title: `执行工具: ${event.toolName}`,
      }),
    }).catch(() => null) // 静默失败，绝不影响主流程
  })

  // 2. 敏感工具决策门禁拦截 (Human-in-the-Loop)
  api.on('before_tool_execute', async (event) => {
    if (event.toolName === 'bash' && event.input.command.includes('git commit')) {
      const res = await fetch(`${BRIDGE_URL}/api/gate/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gateId: `gate-${event.callId}`,
          title: 'Git 提交审查',
          riskLevel: 'high',
          proposedAction: { command: event.input.command },
        }),
      })
      const decision = await res.json()
      if (decision.action === 'reject') {
        throw new Error(`人类操作员拒绝执行: ${decision.feedback || '拦截'}`)
      }
    }
  })
}
```
