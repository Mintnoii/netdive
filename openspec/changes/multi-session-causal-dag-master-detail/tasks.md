# Tasks: NetDive 多会话隔离、因果 DAG 自动建链与 Master-Detail 工作台重构

## 1. 契约定义与数据模型 (`src/types/telemetry.ts`)
- [x] 1.1 扩展 `TelemetryEvent` 契约，支持 `sessionId`、`sessionTitle`、`project` 可选字段。
- [x] 1.2 增加 `ActiveSessionItem` 契约，定义左侧会话列表项数据结构（`id`, `title`, `actors: string[]`, `status`, `nodeCount`, `updatedAt`, `project`）。
- [x] 1.3 编写纯函数 `resolveSessionId(event: Partial<TelemetryEvent>): string`，健壮提取稳定会话标识。
- [x] 1.4 编写纯函数 `resolveSessionTitle(event: Partial<TelemetryEvent>): string`，提取清晰的会话意图标题。

## 2. 会话隔离存储与因果拓扑状态机 (`src/hooks/useTelemetryStream.ts`)
- [x] 2.1 将单一扁平 nodes/edges 升级为多会话分流字典 `sessions: Record<string, SessionData>`。
- [x] 2.2 实现 `activeSessionId` 切换逻辑，并提供 `sessionsList` 派生列表（按更新时间倒序）。
- [x] 2.3 依据 OpenTelemetry Active Span 机制实现时序因果自动连线（显式 parent 优先，无 parentId 时在同一 session 内自动回退连接上一活跃节点）。
- [x] 2.4 计算节点在当前 session 画布上的 X/Y 坐标（主干向右顺延，自愈分支向右下沉）。
- [x] 2.5 导出 `selectSession(sessionId: string)`、`sessionsList`、`activeSessionId`、`activeSessionMeta` 给 UI 层消费。

## 3. UI 界面布局升级 (`src/components/SessionListSidebar.tsx` & `src/App.tsx`)
- [x] 3.1 新建 `src/components/SessionListSidebar.tsx` 左侧会话侧边栏组件：
  - 支持展开/折叠切换；
  - 列表项包含：状态指示灯（running/gate/completed）、会话意图标题、协同 Agent 标签（如 `Hermes ➔ Pi`）、步数统计与相对时间；
  - 选中项高亮并与当前活跃画布同步；
- [x] 3.2 改造 `src/App.tsx` 页面布局为 Master-Detail 三栏架构（左侧会话侧边栏 + 中间 DAG 画布 + 底部 Token 水位 + 右侧抽屉）；
- [x] 3.3 中间画布顶部渲染当前会话的面包屑详情条。

## 4. 上游宿主扩展协同 (`dotagents/extensions/pi-netdive-bridge/index.ts`)
- [x] 4.1 确保 Pi bridge 维护会话级稳定 `sessionId` 与 `lastToolCallId`，带上工程目录 `project`。

## 5. 单元测试与端到端验证
- [x] 5.1 编写 `src/hooks/useTelemetryStream.test.ts` 或对应测试用例：
  - 验证多个不同 sessionId 的事件进入后分别隔离在不同会话中，互不混流；
  - 验证缺失 parentId 的连续工具调用能够自动建立 Edge 连线，消灭孤岛；
  - 验证会话切换后能够正确获取对应的 nodes/edges。
- [x] 5.2 运行全量 `pnpm test` 保证 100% 绿灯通过。
