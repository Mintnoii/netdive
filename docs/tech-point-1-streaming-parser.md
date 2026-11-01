# NetDive 技术点 1 深度解构：契约驱动的流式拓扑解析 (Streaming Telemetry Parser)

> 本文档为 NetDive (潜网) 技术点 1 的教学与原理说明文档，旨在帮助人类完全吃透其底层设计、实现细节、测试剧本设计原则，并与个人知识库（Ghost 知识图谱）深度联动。

---

## 1. 对应 Ghost 知识库认知图谱

在深入代码之前，我们先回到你在 Ghost 知识库中沉淀的认知真源：

- 📖 **知识库卡片**：`wiki/learning/Agent 运行时透明度与可观测性.md`
- 📖 **知识库卡片**：`wiki/learning/Agent 端到端可观测性与生产评测闭环.md`
- 🎯 **第一性原理**：
  > “**控制论的状态可观测性定理**：一个动态系统能够被有效控制的前提是其内部状态可以通过外部输出完全重构。……缺乏轨迹级（Trajectory-level）拓扑追踪的 Agent 处于完全不可控的开环状态（Open-Loop）。”
  > “**以状态事件流作为唯一真相源**，将隐式的流程流转解耦为显式、正交且可审计的轨迹（Trajectory）。”

### 为什么要搞流式遥测？
在普通的 Chat 对话中，Agent 的内部思维、工具调用和子任务是“黑盒折叠”的。只有等最终回复生成完成，用户才能看到结果；如果中间卡在死循环或工具报错，用户完全无感知。  
**NetDive 的技术点 1，就是把 Agent 执行过程拆解成细粒度的「状态遥测事件流」，一边运行一边在浏览器中像流水线一样把因果树动态“长”出来。**

---

## 2. 核心架构与数据契约设计

数据契约是流式拓扑的灵魂。我们在 `src/types/telemetry.ts` 中定义了极简强类型事件：

```typescript
export interface TelemetryEvent {
  traceId: string             // 全局链路唯一标识 (分布式追踪)
  nodeId: string              // 当前节点唯一 ID
  parentId?: string           // 因果依赖父节点 ID (构建从左到右单向 DAG)
  type: TelemetryEventType    // 事件生命周期: node_start | node_stream | node_complete | gate_prompt | gate_resolved
  gesture: TelemetryGesture   // 六类基础操作手势: think | read | edit | bash | memory | gate
  actor: TelemetryActor       // 执行主体: Pi (Coordinator) | Claude 3.7 (Worker) | Human Operator
  title?: string              // 节点标题 (如：目标规划、代码重构)
  status?: TelemetryStatus    // running | completed | failed | gate
  delta?: string              // 流式打字增量内容 (Typewriter chunk)
  payload?: Record<string, unknown>
  observation?: TelemetryObservation // 工具环境执行结果反馈 (exitCode 与 output)
}
```

### 为什么事件类型分为 `node_start` / `node_stream` / `node_complete`？
这对应了 Agent 生命周期的三个物理阶段：
1. **`node_start`（节点诞生与挂载）**：
   - 包含 `nodeId`、`parentId`、`gesture`、`actor`；
   - 前端接收到时，立即在 React Flow 画布上挂载新卡片；
   - 如果有 `parentId`，立即自动生成一条由父指向子的动画连线（`animated: true`），呈现“因果流动”中；
2. **`node_stream`（打字机流式增量）**：
   - 不生成新节点，只包含当前节点的 `nodeId` 和增量文本 `delta`；
   - 前端高效将 `delta` 累加到节点的 `summary` 中，并保持光标呼吸闪烁动效；
3. **`node_complete`（因果落定）**：
   - 标记当前节点状态为 `completed`；
   - **核心细节**：将指向它的连线动画关闭（`animated: false`），视觉上表示该步骤已确定不可逆，主线继续向后推进。

---

## 3. 前端拓扑布局与 Hook 实现细节 (`useTelemetryStream.ts`)

### 3.1 坐标递增算法 (从左向右 LR 推进)
React Flow 默认需要显式 `x, y` 坐标。为了让节点像时间轴一样自然推进，布局算法遵循：
- 主干基准线：`y = 180`；
- 当新节点有 `parentId` 时：
  ```typescript
  const parentNode = prevNodes.find(n => n.id === event.parentId);
  const posX = parentNode ? parentNode.position.x + 280 : 50 + prevNodes.length * 280;
  const posY = parentNode ? parentNode.position.y : 180;
  ```
  每个节点水平间隔 `280px`（卡片宽 `220px`，留白 `60px`），保证连线平滑且排版疏密得体。

### 3.2 纯函数式打字机流式模拟
在 `useTelemetryStream.ts` 中，我们通过切片生成打字机动效：
```typescript
const text = item.fullSummary;
let cursor = 0;
while (cursor < text.length) {
  const nextChunk = text.slice(cursor, cursor + chunkSize); // 每次切 3~4 个字
  cursor += chunkSize;
  processEvent({ type: 'node_stream', delta: nextChunk, ... });
  await interruptibleSleep(chunkDelayMs); // 35ms 间隔
}
```
通过 `interruptibleSleep` 配合 `isCancelledRef`，支持在播放中随时重置或中断，杜绝异步悬挂内存泄漏。

---

## 4. 测试剧本设计理念 (`DEFAULT_TELEMETRY_SCENARIO`)

为什么技术点 1 的测试数据选择这 4 个节点？
```text
[1. Pi Coordinator: 目标规划与分解 (think)]
                   │
                   ▼ (平滑连线流动)
[2. Claude Worker: 代码重构实现 (edit)]
                   │
                   ▼ (平滑连线流动)
[3. Claude Worker: 单元测试执行 (bash)]
                   │
                   ▼ (平滑连线流动)
[4. Human Operator: 决策门禁待审 (gate)]
```

### 设计理念：
1. **多 Agent 协同演练**：涵盖主协调者（Pi）、执行工人（Claude Worker）和人类操作员（Human Operator）；
2. **六类工具手势覆盖**：涵盖思考规划（`think`）、代码编辑（`edit`）、命令执行（`bash`）和风控审批（`gate`）；
3. **真实场景闭环**：完全复刻全机真实开发工作流（规划 $\to$ 重构 $\to$ 单测 $\to$ Git 提交门禁）。

---

## 5. 极简复现与验证步骤

1. 打开浏览器访问 `http://localhost:5173/`；
2. 页面初始呈现静态 4 节点主干拓扑；
3. 点击顶部右侧「**播放流式事件**」按钮：
   - 画布瞬间清空；
   - `node-1` 挂载，打字机逐字输出；
   - `node-2` 向右长出，边带着流动动画，打字机逐字输出；
   - `node-3` 继续向右生长，边动画落定；
   - `node-4` 挂载并进入琥珀色门禁待审状态。
