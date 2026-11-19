# Changelog

## 未发布 — 失败 trace 转回归用例落地 (2026-11-19)

把复盘数据推进到验证环节。规约见 `openspec/changes/trace-to-regression-case/`。

### 变更

- 新增 `src/services/regressionCase.ts`：从失败节点冻结证据与基线，导入新会话后逐项对照失败指纹、失败总数、峰值水位、回收字符、前缀稳定性与门禁次数；
- 新增 `regressionCaseStore`，用例落在 localStorage，刷新不丢，支持删除与 Markdown 导出；
- 新增独立页面 `RegressionPage` 与 HeaderNav「回归工作台」Tab，页面与回放平级；
- 新增 5 项契约单测，浏览器实测创建用例、刷新保留、导入对照会话并得到检查结果；
- 真实本地数据测试暴露了失败指纹塌缩问题：本地会话大多没有 `assertion.rule`，全部归并成 `failed`。已改为按「状态 + 命令或标题」归一化指纹，长命令压成单行并截断到 120 字符；
- 抽样 40 个 `~/.pi/agent/sessions/*.jsonl` 实测：同会话复现全部命中，跨会话对照能区分具体失败，模拟移除某条失败后对应检查变为通过；
- 新增 `docs/SESSION_DATA_DIRECTIONS.md`，记录六类会话数据二次利用方向与推荐顺序。

### 校验

`pnpm test` 378 pass / 0 fail；`pnpm build` 零类型错误；真实本地会话 40 个抽样验证通过。

## 未发布 — 会话复盘诊断报告落地 (2026-11-19)

把回放数据从「能看」推进到「能给出改法」。规约见 `openspec/changes/context-health-report/`。

### 变更

- 新增 `src/services/contextHealthReport.ts`：纯函数报告构造器与 Markdown 序列化，复用趋势、压缩机会、重复调用折叠和前缀哈希，结论全部来自规则与阈值；
- 建议清单覆盖长输出折叠、水位逼近上限、水位来源推算、前缀漂移、重复失败、门禁记录和连续同构调用，每条带证据 nodeId 与量化收益；
- 新增 `ContextHealthReportDrawer`，会话面包屑提供「复盘诊断」入口，空会话禁用，支持复制 Markdown 报告；
- 新增 5 项契约单测，覆盖空会话、压缩建议、前缀漂移、失败共振与门禁、Markdown 确定性；
- README 与 INTERVIEW 文档同步报告口径。

### 校验

`pnpm test` 373 pass / 0 fail；`pnpm build` 零类型错误；浏览器实测空态禁用、有会话时报告与抽屉可用。

## 未发布 — 首屏切换到复盘空态 (2026-11-19)

把「复盘优先」从文档口径落到首屏行为。

### 变更

- `HeaderNav` 第一个 Tab 从「执行控制台」改为「会话回放」，tooltip 明确本地 JSONL 复盘与可选桥接；
- `App.tsx` 的 `rawEvents` 初始值改为空数组，首屏不再默认渲染内置演示图；空态提供「导入 .jsonl」主按钮，从左侧会话列表选择真实会话后自动解析；空态下再次点击当前会话也会补载账本；
- 时间轴重置改为回到复盘空态；演示会话保留为侧边栏里的显式入口；
- `SessionListSidebar` 新增 `importInputRef`，让空态按钮复用同一条文件导入链路；
- README 的架构矩阵与上手说明同步改成回放优先。

### 校验

`pnpm test` 368 pass / 0 fail；`pnpm build` 零类型错误。

## 未发布 — 上下文工程演练画布与文档收口 (2026-11-19)

新增第三个独立入口 Context Lab，把上下文治理从「只能看水位」推进到「可以动手演练」。

### 变更

- `src/services/contextGovernanceEngine.ts` 定义 `ContextState` 四层真源（预算 / 固定前缀 / 工作区 / 清理流水账），场景取 9 步 Ghost 炼化流水线；
- `src/pages/ContextLabPage.tsx` 与 `ContextBottomPanel.tsx` 落地四种交互：掐头去尾、打包精简、折叠同构调用、按 ID 从 `backupStore` 取回或还原；另加动态时间戳导致前缀哈希突变的教学反例；
- `AgentNode` 支持同构子节点展开 / `×3` 聚合与手动位置覆盖，主干连线随展开状态切换出口；
- 文档收口：README 补齐 Context Lab 入口与文档导航，修正测试数为 368、静态检查为 11 warning；`POSITIONING.md` 删除尚未落地的 W3C Trace Context 口径并补充真实使用边界；新增 `docs/INTERVIEW.md` 面试讲述与简历素材，定位改为会话复盘优先、实时与门禁作为可选通道。

### 校验

`pnpm test` 368 pass / 0 fail；`pnpm build` 零类型错误；`pnpm exec oxlint` 11 warning 未增。规约见 `openspec/changes/context-governance-lab/`。

## 未发布 — 瘦节点视图模型落地 (2026-11-17)

第四轮收敛，修的是「项目自己的门禁条款被自己的代码违反」：`AGENTS.md §3.3` 明令禁止把完整 stdout / payload 塞进画布节点，但只有回放路径遵守，实时路径一直违规。这一版把两条轨道拉齐。

### 变更

- **新增 `src/services/nodeFacets.ts`**：`deriveNodeFacets(event)` 把渲染真正需要的字段抽成扁平标量（`command` / `filePath` / `pattern` / `exitCode` / `outputHead` / `outputLineCount` / `outputChars` / `hasDiff`），实时流与回放两条轨道共用。
- **节点不再携带大对象**：`sessionTopology` 三处建节点分支与 `transcriptParser` 回放侧统一改走 facets，`node.data` 里不再出现 `observation` / `payload`；长会话内存不再随工具输出线性膨胀，`AgentNodeMemo` 的比较器也真正生效。
- **详情一律 JIT**：`NodeDetailsDrawer` 删除 `nodeData` 兜底，只从 `eventsMap` 取原始事件；浏览器实测失败节点的完整 `AssertionError` 堆栈仍可查看。
- **剪枝面板保持完整预览**：`extractPrunableItems(nodes, lookupEvent?)` 支持按 nodeId 回取事件，`App` 传入 `eventsMap`，瘦节点下依然能显示原始 diff 与输出首尾。
- **判定单源**：`TurnNode` 删除本地 `isInputOnlyTurn` 复算，改用 `resolveTurnTone(turn)`，与小地图配色同源。
- **常量拆名**：新增 `TURN_GRID`（360 / 4 / 280）与 `FLOW_LAYOUT`（280 / 6 / 340）显式区分，消除同名不同值误用。

### 测试

- 新增 `flowLayout.test.ts`（11）锁住坐标单调、折行边界、分支下沉与连线样式优先级；
- 新增 `sessionTopology.test.ts`（17）覆盖会话归约、因果建链、多会话隔离、剪枝提取与瘦节点反向断言；
- 新增 `gateManager.test.ts`（9）与 `gateDecisions.test.ts`（4）：门禁挂起 / 裁决 / 超时 / 替换 / 订阅，以及裁决信封构造。

### 校验

`pnpm test` 359 pass / 0 fail；`pnpm build` 零类型错误；`pnpm exec oxlint` 11 warning 未增。规约见 `openspec/changes/refactor-lean-node-view-model/`。

## 未发布 — 运行时收敛、死代码清退与逻辑隐患收口 (2026-11-17)

第三轮结构性收敛。清掉一个从未接线的 800 行页面、把造拓扑的逻辑收成单一实现、让首屏分包，并修掉三条会误伤真实使用的逻辑隐患。

### 移除

- `pages/SessionReplayPage.tsx`（800 行）：生产代码零引用的历史页面壳，回放能力早已并入主控制台时间轴；连带清理三条已下线页面的陈旧截图。
- 零调用方导出 `toBridgeWsUrl` / `resolveBridgeBaseUrl`（YAGNI）。

### 新增

- **`src/services/flowLayout.ts`**：坐标、折行网格、连线样式与动画语义单一真源，实时流与回放共用；回放侧与实时侧不再各写一套边语义。
- **`src/services/sessionTopology.ts`**：会话模型、因果建链、节点坐标、事件归约与演练剧本的纯逻辑层（1125 行），`useTelemetryStream` 从 1993 行瘦至 915 行，只留状态编排与副作用。
- **`React.lazy` 按需加载**：`CompactorLabPage` / `ShowcasePage` 拆出独立 chunk，首屏 `index-*.js` 由 684.5 KB 降到 625.4 KB（gzip 210 → 189 KB）。
- **节点渲染守卫**：`AgentNodeMemo` / `TurnNodeMemo`，只在 data 引用、选中态或 id 变化时重渲染。

### 修复

- **画布双渲染**：删除「派生 nodes/edges → setNodes」回写 effect，派生结果直喂 `<ReactFlow>`，拖拽位移改由轻量覆盖表承载，选中态由 `selectedNodeId` 单向注入。
- **断言引擎跨会话串味**：失败指纹纳入 `sessionId` 作用域，A 会话的失败不再推动 B 会话熔断。
- **失败计数语义**：由「累计失败」改为「连续失败」，同一目标重试成功即清零，避免修好后仍被历史计数推向熔断。
- **失败指纹表有界**：新增 `maxTrackedSignatures`（默认 500，FIFO 淘汰），常驻进程内存不再单调增长。
- **WAL 无上限**：新增 `maxWalEntries`（默认 500，FIFO 淘汰），统计口径如实反映存活条目。
- **门禁无限挂起**：`GateManager` 增加兜底超时（默认 5 分钟），无人裁决时按安全策略返回 `reject` 裁决信封，与客户端 `timeout` 语义对齐。

### 校验

`pnpm test` 318 pass / 0 fail；`pnpm build` 零类型错误；`pnpm exec oxlint` 11 warning 未增。规约见 `openspec/changes/refactor-runtime-and-dead-code-retirement/`。

## 未发布 — 编码审美底座收敛与反模式清洗 (2026-11-17)

按 MIND.md 维度 3 与 SYSTEM_PROMPT 门禁 1 做的一轮结构性收敛。不动功能语义，只消维护成本：底座单点化、空 catch 清零、命令式 IO 剥离、双协议适配拆分、展示层色值收敛。

### 新增

- **`src/config/bridge.ts`**：桥接端口/主机/端点单一真源，`4560` 字面量从此只出现在这里；`resolveBridgePort` 支持 `PORT`/`HOST` 覆盖。
- **`src/utils/http.ts`**：全仓唯一网络请求入口，`httpFetch` / `httpJson` / `httpText` / `httpPostSilent` 一律返回 `[err, data]` 并内建超时；12 处散落 `fetch` 收敛至此。
- **`src/services/localSessionScanner.ts`**：本地存量会话扫描纯函数（`scanLocalSessions` / `readLocalTranscript`），以 `pathe` + `radash` 替代 4 层嵌套 `for` 与 11 处 sync fs 混排。
- **`src/services/protocols/{shared,pi,claude}.ts`**：Pi / Claude 协议适配器分层，`transcriptParser.ts` 从 2315 行降到 1395 行，只留「分发 + 聚合 + 排版」。
- **`src/services/statusTone.ts`**：画布状态语义色单一真源（`TONE_STROKE` / `TONE_FILL` / `BRANCH_EDGE_STYLE`），小地图配色 `switch` 从 App 与 Showcase 两处内联逻辑下沉为纯函数。
- **`writeClipboard`**：剪贴板单一原语，替代 `telemetry.ts` 里两份近乎重复的实现。

### 修复与清理

- 非测试代码原生 `catch { /* ignore */ }` 清零（原 9 处），全部改 `radash.tryit` 解构 + 显式降级语义；`safeDecodeUri` 替掉 3 处 catch 内套 catch 的 URI 自愈。
- 105 处 `typeof x === 'string'` 收敛为 `radash.isString`。
- 删除 Vite 模板残留死资产 `react.svg` / `vite.svg` / `hero.png`。

### 校验

`pnpm test` 314 pass / 0 fail（新增 `localSessionScanner` 9 条与 `statusTone` 6 条契约用例）；`pnpm build` 零类型错误；`pnpm exec oxlint` 告警维持 11 条未增。规约见 `openspec/changes/refactor-aesthetic-base-convergence/`。

## 未发布 — 门禁契约收口与演示沙盒隔离 (2026-11-17)

这一版修的是最要命的一处语义漏洞：SDK 客户端读错了裁决字段，人类点「拒绝」也被当成批准，审批门禁在最通用的调用路径上形同虚设。同时把演示通路与真实工作流物理隔开。

### 修复

- **`reporter.gate()` 裁决解读回归**：改为解析服务端统一信封 `{ action, feedback, modifiedCommand }`，`reject` 正确回归 `rejected`，`modify` 回传人类改写的命令。此前读 `body.decision` 恒为 `undefined`，永远落`|| 'approved'`。
- **审批载荷字段对齐**：上报 `command / explanation / diff`，与 `resolveGatePromptPayload` 的归一化契约一致。此前发 `action / summary / diffPayload`，审批窗里命令为空。
- **等待裁决超时显式化**：新增 `gateTimeoutMs`（默认 5 分钟），超时返回 `timeout` 而不是静默放行；通信失败也不再谎报已批准。

### 新增

- **`demoOnly` 演示沙盒隔离**：遥测与门禁带该标记时，服务端强隔离到 `demo-` 会话命名空间，旁路 L1 断言（不写失败指纹、不触发共振熔断），UI 不自动抢占真实画布，演示门禁也不抢占真实审批模态窗。`createReporter` 默认开启。
- **真实视口虚拟化**：画布开启 `onlyRenderVisibleElements`，只渲染视口内元素。
- **回归用例** `src/client/reporter.gate.test.ts`：在线拒绝、批准、热纠偏、超时、demo 隔离、断言旁路 6 条契约用例，测试总数 299。
- **门禁开关**：宿主扩展 `pi-netdive-bridge` 的高危命令拦截改为默认关闭（`NETDIVE_GATE_ENABLED` 未设时全放行，只观测不拦截），需物理拦截时显式开闸；`pnpm test:workflow` 演练流改用独立会话 ID，不再落入默认会话。

### 文档

- README 与 POSITIONING 口径对账：测试徽章 233 → 299；`OpenTelemetry 标准兼容` 改为实际做法的 `Active Span 式因果建链`；去掉并不存在的 Monaco 双列 Diff 描述。

## v0.2.0 — 上下文窗口观测 (2026-11-08)

这一版把上下文观测从「一条静态水位色条」做成可读、可查、可对账的窗口面板，并把此前混淆真值与估算的假动作清掉。

### 新增

- **七类上下文档位**：`ContextPrompt { tokens, window, parts }`，按 `system / tools / skills / memory / files / results / chat` 采集，每 part 带 `items[{ tag, name, tokens, n, content }]`。解析层做严格对账，非 free 分块的 Token 之和等于 `watermark.total`。
- **Treemap 构成图**：`d3-hierarchy` 的 squarified 布局，按请求序列语义排序，系统提示词与工具定义固定在最左侧；面积下限重排保证小分类始终可见；剩余空间为斜纹块。
- **独立文本浮层**：点瓦片或清单行打开，逐条折叠、原文与压缩预览双视图、复制、100 条分页、`initialItemIndex` 单条定位。
- **压缩机会剖析**：`analyzeCompactionOpportunities` 纯函数（零副作用，不写 WAL）+ 预演浮层三段对照 + `GET /api/wal` 真实统计对账 + `pointerId` 原文回放。
- **数据来源三态**：`ContextWatermark.provenance`，`counted / estimated / live` 在水位条与抽屉以同款徽标标注。
- **模型窗口解析**：`modelWindows.ts` 本地保守规则表（gemini / claude / gpt-oss / deepseek-v4），`windowSource` 标明已知或兜底。
- **窗口撑开不变量**：`effectiveContextWindow` 落地 Magpie 的 `scale = max(window, tokens, 1)`，`windowClamped` 在 UI 明示。

### 修复

- WAL 相关 `fetch` 统一走 `DEFAULT_BRIDGE_HTTP_URL`，修 dev 环境相对路径打到 Vite 后静默误判离线。
- 取消 part 级聚合，改面积下限重排，修复小占比分类被「另外 N 项」吞掉的回归。
- 指标区五格统一固定行高，label / value / note 逐行对齐。
- 抽屉排版按 Magpie 设计令牌重排，面板高度改内容驱动并去掉冗余图例。

### 清理

- 删除 `pruneContext` 假修剪、硬编码 `42000` 释放量、`DEFAULT_PRUNABLE_ITEMS` 死 mock 与 `PrunableInspectorDrawer` 死组件。
- 压缩 Lab 重定位为「压缩沙盒」，删除三份预设假日志，明确标注非真实会话数据。
- 假数据台账与未落地特性索引落在 `docs/BACKLOG.md`。

### 质量

- `pnpm test` 233 pass / 0 fail（13 个测试文件全部纳入脚本）。
- `pnpm build` 零类型报错。
- `pnpm exec oxlint` 当前 9 条 warning，均为 `react-hooks` 与 fast-refresh 提示，无 error。
- Playwright + 真实 bridge + 30 个本地会话实机验证：首屏自动切真实会话、`实测 Counted` 徽标、1.05M 窗口解析、七行档位与压缩机会真账全部就位。

### 已知限制

演示沙盒内置假会话仍在（已分区标注）；无 usage 会话走启发式估算；模型窗口规则表刻意保守；原文留存隐私口径未定；真实上下文压缩（Agent 侧介入）明确暂缓。详见 `README.md` 与 `docs/BACKLOG.md`。

---

## v0.1.x — 前序提交

`a51a4d2` 及更早提交覆盖多会话主从工作台、因果 DAG 自动串联、时间轴回放、视口缩放治理、回合节点弱化与聚合标签提取。该区间没有打过 tag，完整历史见 `git log`。
