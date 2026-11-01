# Architecture Design: NetDive (潜网)

## 1. 系统全景架构 (System Architecture)

```text
 ┌────────────────────────────────────────────────────────┐
 │            dotagents Runtime / Agent Harness           │
 │  (Pi Agent / Claude Worker / Codex / Ghost Pipeline)   │
 └──────────────────────────┬─────────────────────────────┘
                            │ (Lifecycle Hooks: onToolCall, onThought, onGate)
                            ▼
 ┌────────────────────────────────────────────────────────┐
 │         NetDive Telemetry Bridge (Local Sidecar)       │
 │   - Event Streamer (node_start / node_stream / done)   │
 │   - Promise Suspension Gate Registry (Promise-based)   │
 │   - WebSocket Server (127.0.0.1:4560)                  │
 └──────────────────────────▲─────────────────────────────┘
                            │ WebSocket (Bi-directional RPC)
                            ▼
 ┌────────────────────────────────────────────────────────┐
 │           NetDive Web UI (Paper/Editorial Minimal)      │
 │  ┌──────────────────────────────────────────────────┐  │
 │  │ 1. Left-to-Right DAG Canvas (@xyflow/react)      │  │
 │  │    - Main Trunk: Think ──► Edit ──► Join ──► Done│  │
 │  │    - Self-Correction Branch (向下分叉，自愈并回) │  │
 │  └──────────────────────────────────────────────────┘  │
 │  ┌──────────────────────────┐ ┌─────────────────────┐  │
 │  │ 2. Decision Gate Modal   │ │ 3. Cognition Drawer │  │
 │  │    - Proposed Action Diff│ │    - Hidden CoT     │  │
 │  │    - Steering Injection  │ │    - Context Strip  │  │
 │  └──────────────────────────┘ └─────────────────────┘  │
 └────────────────────────────────────────────────────────┘
```

## 2. 核心技术点实现原理精讲

### 2.1 契约驱动的流式拓扑解析 (Streaming Telemetry Parser)
Agent 的 ReAct 循环不是一次性成图，而是连续的流式数据包：
```typescript
export interface TelemetryEvent {
  traceId: string
  nodeId: string
  parentId?: string
  type: 'node_start' | 'node_stream' | 'node_complete' | 'gate_prompt' | 'gate_resolved'
  gesture: 'think' | 'read' | 'edit' | 'bash' | 'memory' | 'gate'
  actor: 'pi-coordinator' | 'claude-worker'
  delta?: string // 流式打字内容
  payload?: Record<string, unknown>
  observation?: {
    exitCode: number
    output: string[]
  }
}
```
前端维护 `nodeMap`，收到 `node_start` 即在 React Flow 中追加节点；收到 `parentId` 自动创建从左至右的平滑 Edge。

### 2.2 动态自愈分叉原理 (Self-Correction Branching)
当单测或命令执行失败（`exitCode !== 0`）时，Agent 触发自我反省：
- 创建自愈节点（`gesture: 'edit'`，标题：“自愈分叉：自动修复依赖”）；
- 自愈节点在坐标布局中自动偏移到报错节点的正下方（Y 轴增加，X 轴向右推进）；
- 修复成功后，下一个主干节点将父节点重新连接回自愈节点，形成优雅的闭环菱形/旁路自愈拓扑。

### 2.3 零侵入门禁挂起与参数热纠偏 (Promise-based Suspension RPC)
```typescript
class GateRegistry {
  private resolvers = new Map<string, (res: GateResolution) => void>()

  async intercept(gateId: string, command: string): Promise<GateResolution> {
    // 广播到前端 UI
    wsServer.broadcast({ type: 'gate_prompt', gateId, command })
    // 协程挂起，保留 resolve 句柄
    return new Promise(resolve => this.resolvers.set(gateId, resolve))
  }

  resolve(gateId: string, resolution: GateResolution) {
    const fn = this.resolvers.get(gateId)
    if (fn) {
      fn(resolution) // 唤醒后台协程
      this.resolvers.delete(gateId)
    }
  }
}
```

### 2.4 界面设计风格准则 (Paper & Ink Minimalist)
- **纸张色盘**：底色 Warm Paper `#FBF9F5`，卡片表面 `#FFFFFF`，侧边栏 `#F4F0EA`；
- **排版墨水**：主字体采用精致的系统黑体，文本颜色采用炭墨黑 `#1E2024` 与中灰 `#6B7280`，告别刺眼高对比度；
- **视觉层级**：从左向右（LR）单向流动，主线清晰，无多余光效。
