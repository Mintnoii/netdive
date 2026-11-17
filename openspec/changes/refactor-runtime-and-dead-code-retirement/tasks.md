# Tasks: 运行时收敛、死代码清退与逻辑隐患收口

> 起点基线：`pnpm test` 314 pass / 0 fail；`pnpm build` 通过（首屏 684.5 KB 单 chunk）；`pnpm exec oxlint` 11 warning。
> 每批结束必须重跑三件套，并对 UI 相关批次做浏览器目视核对。

## 1. 批次 A：死重量清退与工具链
- [x] 1.1 删除 `src/pages/SessionReplayPage.tsx` 并清理 `transcriptParser.test.ts` 中的专属断言
- [x] 1.2 README 架构图与核心能力段改为真实「执行控制台 + 压缩沙盒 + Sandbox」三入口，回放归位到顶部时间轴
- [x] 1.3 AGENTS.md 目录映射同步删除 `pages/SessionReplayPage.tsx`
- [x] 1.4 `package.json` 的 `test` 脚本改 glob `tsx --test "src/**/*.test.ts"`，新增用例不再手工登记
- [x] 1.5 移除零调用方导出 `toBridgeWsUrl` / `resolveBridgeBaseUrl`

## 2. 批次 B：渲染性能
- [x] 2.1 `AgentNode` 包 `React.memo`，比较器限定 `id` / `selected` / `data` 引用
- [x] 2.2 `TurnNode` 同构 memo 化
- [x] 2.3 `App.tsx` 删除「派生 nodes/edges → setNodes」回写 effect，派生结果直喂 `<ReactFlow>`
- [x] 2.4 浏览器核对：ShowcasePage 与实时画布节点渲染、拖拽与选中不回归

## 3. 批次 C：拓扑构建单源 + 首屏分包
- [x] 3.1 新增 `src/services/flowLayout.ts`：`eventsToFlowGraph` 统一坐标、连线、分支样式与状态映射
- [x] 3.2 `transcriptParser.eventsToFlowNodesAndEdges` 退化为 `flowLayout` 薄封装，回放断言全绿
- [x] 3.3 实时流侧改用同一连线/坐标规则，删除对偶边语义实现
- [x] 3.4 `ShowcasePage` / `CompactorLabPage` 改 `React.lazy` + `Suspense`
- [x] 3.5 记录首屏 chunk 变化并与 684.5 KB 对账

## 4. 批次 D：hook 拆分与逻辑收口
- [x] 4.1 抽出 `services/sessionTopology.ts`（会话模型、因果建链、坐标、归约、演练剧本纯逻辑层）
- [ ] 4.2 抽出 `useReplayEngine`（剧本播放、暂停、步进）—— 编排闭包与状态强耦合，留待下批
- [ ] 4.3 抽出 `useGateOrchestration`（门禁挂起/裁决编排）—— 同上，留待下批
- [x] 4.4 `useTelemetryStream` 从 1993 行瘦身至 915 行，仅保留状态编排与副作用，对外 API 不变
- [x] 4.5 断言引擎失败指纹纳入 `sessionId`，计数改「连续失败、成功清零」，配 LRU 上限
- [x] 4.6 `walRegistry` 加容量上限（FIFO 淘汰）并保留统计口径
- [x] 4.7 `/api/gate/prompt` 增加服务端兜底超时（默认 5 分钟，超时返回 `timeout` 裁决信封）
- [x] 4.8 补充契约测试：跨会话不串味、连续失败计数衰减、WAL 上限、服务端门禁超时

## 5. 收口校验
- [x] 5.1 `pnpm test` 全绿（起点 314，只增不减）
- [x] 5.2 `pnpm build` 零类型错误且首屏包体回落
- [x] 5.3 `pnpm exec oxlint` 告警低于 11
- [x] 5.4 无 `SessionReplayPage` 残留引用；README 与真实页面一致
- [x] 5.5 人类拍板后提交（严禁 Agent 擅自 commit）

## 6. 本轮实测结果
- `pnpm test` **318 pass / 0 fail**（新增 4 条逻辑收口契约 + 1 条 WAL 上限契约）
- `pnpm build` 零类型错误；首屏 `index-*.js` 由 **684.5 KB → 625.4 KB**（gzip 210 → 189 KB），
  并拆出 `CompactorLabPage` 27.8 KB / `ShowcasePage` 33.9 KB / `telemetry` 18.6 KB 三个按需 chunk
- `pnpm exec oxlint` 仍为 11 warning（未增；已删除的「派生回写」effect 本身未被该规则标记）
- 浏览器实测：8 节点 / 7 边渲染正常、选中态注入生效、小地图 8 色块、水位条两段配色正常
- 遗留：`useTelemetryStream` 内的回放引擎与门禁编排闭包仍与状态强耦合，4.2 / 4.3 留待下一批
