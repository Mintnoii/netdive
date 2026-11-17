# Proposal: 运行时收敛、死代码清退与逻辑隐患收口 (Runtime Convergence & Dead Code Retirement)

## 1. 痛点背景 (Problem Statement)

上一轮（`refactor-aesthetic-base-convergence`）把网络底座、空 catch、命令式 IO、协议分层、状态色五件事收敛完毕。这一轮处理审计剩下的四类欠账，它们分属「死重量」「体感性能」「架构重复」「逻辑隐患」：

1. **死页面 800 行**：`pages/SessionReplayPage.tsx` 在生产代码里零引用（`App.tsx` 只挂了 `CompactorLabPage` / `ShowcasePage`），仅剩 `transcriptParser.test.ts:1144` 一条「能 import 出组件」的断言维持存活。README 与架构图仍宣称「页面 2 会话时光机」，与实际两页形态不符，属对外口径硬伤。
2. **渲染体感**：`AgentNode` / `TurnNode` 均为裸 `React.FC` 无 `memo`，长会话每来一条遥测即全量重渲染；`App.tsx:367` 又把 `useMemo` 派生的 nodes/edges 用 `useEffect` 回写进 React Flow 状态，每次事件必然多一轮渲染（oxlint 5 条 `set-state-in-effect` 中最关键一条）。
3. **双轨拓扑重复**：实时流 `useTelemetryStream.ts:257-775`（519 行）与回放 `transcriptParser.ts:875-1000`（126 行）各自实现节点坐标、连线样式、分支判定、状态映射，同调 `calculateNodePosition` 却各自维护边语义。
4. **逻辑隐患三条**：断言引擎失败计数跨会话串味且只增不减；`walRegistry` 无上限；服务端 `/api/gate/prompt` 自身无超时兜底。

附带零碎：`pnpm test` 硬编码 20 个测试文件（本轮新增用例需手改脚本）、上一轮新加的 `toBridgeWsUrl` / `resolveBridgeBaseUrl` 零调用方、`pnpm lint` 在本机被环境钩子改写成 eslint 而不可用。

## 2. 目标与非目标

### 2.1 目标
- 清退死页面，并把对外文档口径改成「两页 + 时间轴回放」的真实形态；
- 节点组件 `memo` 化 + 去掉派生结果回写状态的双渲染；
- 抽出 `services/flowLayout.ts` 作为 events → nodes/edges 唯一实现，实时与回放共用；
- 三条逻辑隐患按「会话隔离 + 有界 + 显式超时」收口；
- 测试脚本改 glob，新增用例不再手工登记。

### 2.2 非目标
- 不改门禁裁决契约，不动 `demoOnly` 隔离语义；
- 不重设计视觉，不改交互流程；
- 不为通过测试放宽任何既有断言；删除 `SessionReplayPage` 时同步删除其专属断言（属资产清退，非断言放宽）。

## 3. 分批规格

### 批次 A：死重量清退与工具链（P0，零风险）
- 删除 `pages/SessionReplayPage.tsx` 及其专属测试断言；
- README / AGENTS.md 架构图改为真实两页形态（执行控制台 + 压缩沙盒 + Sandbox），回放能力归位到顶部时间轴；
- `package.json` 的 `test` 改 `tsx --test "src/**/*.test.ts"`；
- 移除零调用方导出 `toBridgeWsUrl` / `resolveBridgeBaseUrl`（YAGNI）。

### 批次 B：渲染性能（P1，用户可体感）
- `AgentNode` / `TurnNode` 包 `React.memo`，比较粒度限定在 `id` / `selected` / `data` 引用；
- `App.tsx` 删除「派生 → setNodes」回写 effect，派生结果直喂 `<ReactFlow>`，交互态由 `onNodesChange` 合并，消除每次事件的二次渲染。

### 批次 C：拓扑构建单源 + 首屏分包（P1）
- 新增 `services/flowLayout.ts`：`eventsToFlowGraph(events, options)` 唯一实现（坐标、连线、分支样式、状态映射），回放侧 `eventsToFlowNodesAndEdges` 退化为薄封装；
- 实时侧 `processEventForSession` 复用同一套连线与坐标规则，消除对偶边语义；
- `ShowcasePage` / `CompactorLabPage` 改 `React.lazy` + `Suspense`，首屏包体回落。

### 批次 D：hook 拆分与逻辑收口（P1）
- `useTelemetryStream` 拆为 `useSessionTopology`（会话 reducer）/ `useReplayEngine`（剧本播放）/ `useGateOrchestration`（门禁编排），对外 API 不变；
- 断言引擎失败指纹纳入 `sessionId`，计数改为「连续失败」语义（成功即清零）且带 LRU 上限；
- `walRegistry` 加容量上限（FIFO 淘汰），超限时保留统计口径；
- `/api/gate/prompt` 增加服务端兜底超时（默认 5 分钟，超时返回显式 `timeout` 裁决信封，与客户端契约一致）。

## 4. 验收标准

1. `pnpm test` 全绿（起点 314，允许只增不减）；
2. `pnpm build` 零类型错误，首屏 chunk 较起点（684.5 KB）明显回落；
3. `pnpm exec oxlint` 告警数低于起点 11 条（`set-state-in-effect` 应显著减少）；
4. `src/` 下无对 `SessionReplayPage` 的引用，README 架构图与真实页面一致；
5. 新增 `flowLayout` 单测覆盖：分支边样式、坐标单调性、聚合节点连线。

## 5. 风险与回滚

| 风险 | 缓解 |
| :--- | :--- |
| 删除回放页面丢失能力 | 回放核心（JSONL 解析、聚合折叠、时间轴）全部保留在服务层与主控制台，删的只是未接线的页面壳 |
| memo 比较器写错导致节点不刷新 | 比较器只拦「data 引用未变」的重渲染；状态更新均产生新 data 对象，配 ShowcasePage 目视核对 |
| 去 effect 回写后节点拖拽行为变化 | 保留 `onNodesChange` 受控合并；批次 B 单独提交，出问题可单点回滚 |
| 双轨合并引入回归 | 批次 C 之前先把 `flowLayout` 用现有回放断言固化，再让实时侧迁移 |
| hook 拆分破坏对外 API | `useTelemetryStream` 保持同一返回契约，仅内部拆分，314 断言作为安全网 |
