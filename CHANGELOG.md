# Changelog

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
