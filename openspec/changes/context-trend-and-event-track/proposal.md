# Proposal: 上下文趋势轨道与事件标记 (Context Trend & Event Track)

> **提出时间**: 2026-11-09
> **状态**: 三里程碑全部对齐并结案，已获 qing 授权提交（2026-11-09）
> **素材源流**: `openspec/changes/context-trend-and-event-track/discussion-archive-and-postmortem.md`（项目内研讨留档，本轮 Pi × qing 对话直接提炼，外部一手信源坐标见该档第五节）
> **承接**: `openspec/changes/future-context-spark-timeline/`（deferred 设计预研，保留原档作溯源，不改动）
> **交付节奏**: 三件事严格串行，每完成一个跟 qing 对齐一次，见第六节

## 1. 痛点背景 (Problem Statement)

NetDive 当前的上下文观测只回答「此刻窗口里装了什么」。`ContextStripBar` 给 7-part 水位与 provenance 三态，`ContextInspectorDrawer` 给明细与压缩机会，两者都是静态切片。真实排障时缺的是另外三个答案：

1. **窗口怎么一轮轮涨起来的**，哪一步让体量跳变，还剩多少轮会撞到窗口上限；
2. **压缩或剪枝发生在哪一次请求**，回收了多少，事件原因是什么（压缩、工具输出剪枝、技能注入、模型切换）；
3. **点中某一步能否直接看到那一刻模型实际看到的上下文**，以及这一轮相对上一轮新增或回收了什么。

调研 `bowenliang123/dsh-context` 后确认，它把这三件事做在同一块面板内，用一根堆叠柱承载一次模型请求，用 ✂ 标记事件，用 hover 与点击把图表和上下文浏览器接起来。这套信息呈现与 NetDive 的旁路观测定位同源，且全部可从现有 JSONL、usage、WAL 推导，零 Agent 侧改动。

## 2. 边界声明 (Scope Boundary)

**本变更只在 `live` 执行控制台内原地重构，不新开页面，不加第三个 HeaderNav Tab，不改 telemetry 协议，零侵入 Agent。**

判据：能不能帮人在当前这一步做出拦截或放行判断。能就进 `live` 页的抽屉与时间轴，不能就先放着。

撤回项：首轮研讨曾推荐跨会话聚合大盘（7 天成本、活动热力图、工具调用账本），回读 `docs/POSITIONING.md` 的「不做事后记账器」后当场撤回，不列入本提案，也不作为新增视图。

## 3. 设计 (Design)

### 3.1 三件事与落点

| 里程碑 | 内容 | 主要落点 |
| :--- | :--- | :--- |
| M1 上下文趋势与事件轨道 | `TrendPoint[]` 逐请求体量、纯 SVG 柱、✂ 压缩剪枝标记、`Total / Delta`、`Step / Turn` 双粒度、三行步骤摘要、`headroom` | `src/services/contextTrend.ts`、`src/components/ContextTrendTrack.tsx`、`ContextInspectorDrawer.tsx` |
| M2 图表与浏览器联动及检视手感 | `{ stepIndex, nodeId, mode }` 联动指针、hover 预览事件摘要、点击固定、`Esc` 取消、窗口级净变化徽标、服务商实际 usage 并列、三段筛选、独立搜索排序、原文 / Markdown / 压缩预览三视图、来源芯片、`OK/error`、行数、文件引用卡 | `src/services/contextBrowser.ts`、`ContextTrendTrack.tsx`、`ContextInspectorDrawer.tsx`、`ContextTextOverlay.tsx` |
| M3 数据可信度与体积治理 | `ContextAnnotation` / `ActualUsageReport` 契约、共享三态与标注字典、`服务商实际值` 与 `近似重建` 徽标、压缩前步骤明示、精简投影计数、五维硬上限与可读降级文案、浮层按页补载 | `src/types/telemetry.ts`、`src/services/contextProvenance.ts`、`ContextStripBar.tsx`、`ContextInspectorDrawer.tsx`、`ContextTextOverlay.tsx` |

### 3.2 关键决策

- **事件流为唯一真相源**。parser 已把 `message.usage` 挂到每条 assistant 事件上，M1 用 `buildTrendModel(events, window)` 从事件流按请求派生序列，不在 `ParsedTranscript` 里再存一份投影，也不改 `telemetry.ts` 协议。
- **纯 SVG，不引第三方图表库**。沿用 `future-context-spark-timeline` 的预研结论，趋势柱与事件标记几何抽成纯函数并单独补单测。
- **瘦节点不变**。点选只持 `TrendPoint` 指针，完整 payload 仍留在 `eventsMap` 与 WAL，严禁把原文塞进 `node.data` 或 React 状态树常驻。
- **历史每步 7-part 不投影**。会话只留存当前窗口的构成快照，点选某请求只显示该次实测输入 / 输出 / 缓存与三行摘要，7-part 明确标为当前窗口快照，绝不按当前比例伪造历史档位。
- **时间轴不接播放器**。趋势轨道是抽屉内独立 SVG，点选只改轨道内的选中请求，不触发 `StateTimelineScrubber` 拖拽或画布运镜，零竞态。
- **压缩事件只认事件流里真实存在的类型**。NetDive 现有事件流只有 `context_pruned`（带 `contextPruned` 负载时判 compact，否则 prune），没有 Inject / Switch 的显式事件，M1 不造这两类标记。
- **provenance 采用正交维度而非改写三态**。现有 `counted / estimated / live` 已被 `ContextStripBar`、抽屉与契约测试共用，改写会牵动多处断言。M3 新增 `actualReported` 与 `reconstructed` 两个独立标注，UI 上并列显示「窗口装配值 / 服务商实际 Input」，压缩前步骤标「近似重建」。
- **标注从事件流派生，不在 parser 与 stream 两处重复写**。M1 已确立事件流为唯一真相源，M3 延续该路线：`resolveAnnotations(events)` / `buildProvenanceView(events)` 纯函数派生，`transcriptParser.ts` 与 `useTelemetryStream.ts` 的三态写入路径保持原样，零改动。`telemetry.ts` 只加契约类型与可选标注视图，供下游消费者读取。
- **两份徽标字典收敛为一份共享底座**。原先 `ContextStripBar` 与 `ContextInspectorDrawer` 各自维护 `PROVENANCE_BADGES`，M3 统一收到 `contextProvenance.ts` 的 `PROVENANCE_BADGES` 与 `ANNOTATION_BADGES`，同一渲染形状，杜绝多头维护。
- **投影不引运行时缓存层**。项目里没有现成的投影缓存，`buildContextProjection(events)` 只返回计数摘要，完整原文仍在 `prompt.parts` 与 WAL；`ContextTextOverlay` 沿用 M2 已有的分页，M3 把每页数量与硬上限收成常量，触顶给可读降级文案，不静默截断。
- **联动只传指针，按 nodeId 跨粒度稳定**。契约固定为 `{ stepIndex, nodeId, mode }`，不含 content、payload 或播放器位置；`Step / Turn` 切换时不会因索引错位而指错请求。
- **hover 不组装历史上下文**。M1 已确认历史每步 7-part 未留存，M2 的 hover 只预览该请求前新增的事件摘要（标题、手势、字符量），移开恢复用户自选，点击固定，`Esc` 取消。Esc 收进抽屉的逐级关闭链，不另起监听抢事件。
- **三段筛选按 7-part 分类派生**。事件流没有 DSH 那种 assistant 消息内 Thinking / Tools / Answer 原生分段标签，UI 上明确写「按 7-part 分类派生」，三段互斥覆盖 7 类，再次点击清除恢复全部。
- **附件卡只展示真实文本引用**。遥测契约没有图片二进制、缩略图与物理尺寸，卡片给出事件流里真实出现的文件引用路径，字符量与 token 为推算值并带 tooltip 明示。
- **Markdown 视图不引第三方渲染库**。行级分类字典渲染标题、列表、引用、代码块，与既有 `renderHighlightedSnippet` 同一思路。
- **沿用现有浮层体系**。不新增弹窗页面，复用 `ContextTextOverlay` 与 `CompactionPreviewOverlay` 的层级与 Esc 约定。

## 4. 非目标 (Non-Goals)

- 跨会话成本大盘、7 天用量图表、活动热力图、工具调用账本（与 `docs/POSITIONING.md` 定位冲突，已撤回）。
- Agent Team 编排能力：队长委派、共享任务板、成员唤醒、质量门禁合同，均需侵入 Agent Loop，属暂缓。
- 真实上下文压缩（Agent 侧 `tool_result` 钩子介入），见 `docs/BACKLOG.md` 第一节。
- 新页面或第三个 HeaderNav Tab；真实与沙盒的二分不破坏。
- `future-context-card-fold-memory` 的折叠态，由该独立 deferred 提案承接。
- 磁盘状态快照当真相源、轻量状态投影标「有事无报」偏差，留作独立议题（见研讨留档第六节）。

## 5. 验收场景 (Acceptance Scenarios)

### Scenario: 逐请求体量对齐
- **WHEN** 解析一条含多个 assistant 消息且每条带 `usage.input` 的 JSONL 会话
- **THEN** 逐请求序列长度与真实 assistant 消息数一致（同一条消息的多个 block 按连续相同 usage 折叠），且每项 `tokens` 与对应 `usage.input` 逐条对齐

### Scenario: 事件标记定位
- **WHEN** 会话中某一请求触发压缩或工具输出剪枝
- **THEN** 该请求对应的柱上有 ✂ 标记，Delta 模式下该柱向基线下方延伸，点选后显示净变化、回收量与事件来源

### Scenario: 点选回溯
- **WHEN** 点击趋势轨道上任意一个请求点
- **THEN** 轨道显示该请求的实测输入 / 输出 / 缓存与三行步骤摘要，7-part 分布明确标为当前窗口快照，且不与播放器的 `StateTimelineScrubber` 位置产生竞态

### Scenario: 联动只传指针
- **WHEN** hover 或钉住某一步查看完整上下文
- **THEN** 传给抽屉的契约只含 `stepIndex` / `nodeId` / `mode`，不含 content、payload 或 seek 位置，`node.data` 不新增任何原文 payload

### Scenario: 可信度不误导
- **WHEN** 打开一个缺 `usage` 的历史会话，或查看压缩前的旧步骤
- **THEN** 三态徽标保持原义，正交徽标显示「服务商实际值」与「近似重建」，窗口装配值与服务商实际 Input 并列，压缩前步骤附「明细按事件摘要近似重建，非原始装配快照」

### Scenario: 体积治理不静默截断
- **WHEN** 某会话的事件、步骤、回合、文件操作或命令数超过对应硬上限
- **THEN** 抽屉给出可读降级文案列出实际数与上限，浮层按页补载且触顶后停止「显示更多」，投影返回体不含任何原文 content

### Scenario: 回归不变
- **WHEN** 执行 `pnpm test` 与 `pnpm build`
- **THEN** 284 条用例全绿（M3 收口实测）、零类型报错，未启用新轨道的旧会话回放行为逐字节等价

## 6. 交付节奏（硬约束）

qing 于 2026-11-09 拍板：**三件事不要一次实现，完成一个跟我对齐一次。**

- M1 → M2 → M3 严格串行，每完成一个里程碑立即停工，向 qing 出示 diff、`pnpm test` / `pnpm build` 结果与验收断言，等待明确对齐后才开工下一个。
- 严禁一轮内连做两项，严禁把后续里程碑的代码夹带进当前 worktree 或当前提交建议。
- **派发方式（qing 2026-11-09 拍板）**：不派发 agy、不切 Orca worktree，三个里程碑全部由当前 Pi Agent 在主仓库原生直写。Pi 自行回验 `git diff` 并出示结果，不依赖子 Agent 自报。
- 严禁擅自 `git commit` / `git push`。每个里程碑收口后主动出示修改摘要与推荐 Commit 信息，等 qing 拍板。
- **M1 收口记录（2026-11-09）**：已完成并经 qing 回「可」对齐。`pnpm test` 248 条全绿、`pnpm build` 零类型报错。
- **M2 收口记录（2026-11-09）**：已完成并经 qing 回「那继续」对齐。`pnpm test` 267 条全绿、`pnpm build` 零类型报错。
- **M3 收口记录（2026-11-09）**：已完成，`pnpm test` 284 条全绿、`pnpm build` 零类型报错，三里程碑全部落盘并经 qing 回「可以」整案对齐。临时验收样例与一次性验证脚本已清理，正式契约单测全部保留。

## 7. 涉及文件

- `src/services/contextTrend.ts`（新增）— 从事件流派生逐请求序列、Delta 换算、Step/Turn 聚合、headroom 推算、柱几何、✂ 事件定位，全部纯函数
- `src/services/contextTrend.test.ts`（新增）— 11 条契约用例
- `src/components/ContextTrendTrack.tsx`（新增）— 纯 SVG 趋势轨道、✂ 标记、总量/增量、步骤/回合、点选明细与三行摘要
- `src/components/ContextInspectorDrawer.tsx` — 内嵌轨道与联动明细条；7-part 标为当前窗口快照；三段筛选；M3 正交徽标、压缩前步骤提示与投影超限提示
- `src/components/ContextInspectorDrawer.test.ts` — 补 M1 趋势对账与 M2 联动契约用例
- `src/components/ContextTrendTrack.tsx` — 受控联动（hover / 固定 / Esc），按 `nodeId` 跨粒度定位
- `src/services/contextBrowser.ts`（新增）— 联动指针、事件摘要、实际 usage、净变化、搜索排序、三段筛选、成败判定、文件引用、Markdown 行分类，全部纯函数
- `src/services/contextBrowser.test.ts`（新增）— 14 条契约用例
- `src/components/ContextTextOverlay.tsx` — 独立搜索排序、原文 / Markdown / 压缩预览三视图、来源芯片、`OK/error`、行数、文件引用卡；M3 分页常量收敛与触顶降级文案
- `src/services/contextProvenance.ts`（新增）— 共享徽标字典、`resolveAnnotations` / `buildProvenanceView` / `isStepBeforePrune` / `buildContextProjection` / `projectionNotice` / `resolveDetailWindow` 纯函数与五维硬上限
- `src/services/contextProvenance.test.ts`（新增）— 14 条契约用例
- `src/types/telemetry.ts` — 新增 `ContextAnnotation` / `ActualUsageReport` / `ContextProvenanceView` 契约类型，三态字段不变
- `src/components/ContextStripBar.tsx` / `src/App.tsx` — 水位条接收 `events` 并渲染正交徽标与实际值并列
- `src/server/bridge.test.ts` — 补三态与正交标注并存断言
- `package.json` — `test` 脚本追加三个新增测试文件
- `docs/BACKLOG.md` / `README.md` — 索引、能力清单与测试基线同步

## 8. 向后兼容性

纯前端增量，`telemetry.ts` 只加可选契约类型，既有三态字段与事件契约不变，不改 bridge HTTP 端点。历史会话缺 `usage` 时按 `provenance='estimated'` 降级并明示，不抛错、不阻断回放。新增组件不影响 `lab` 沙盒页，沙盒与真实观测的职责分离保持原样。

## 9. 关联

- 研讨留档：`openspec/changes/context-trend-and-event-track/discussion-archive-and-postmortem.md`
- 任务清单：`openspec/changes/context-trend-and-event-track/tasks.md`
- 设计预研：`openspec/changes/future-context-spark-timeline/proposal.md`
- 可信度基线：`openspec/changes/watermark-provenance-and-dead-mock-cleanup/proposal.md`
- 明细基线：`openspec/changes/context-blocks-content-inspector/`、`openspec/changes/compaction-opportunity-inspector/`
- 定位约束：`docs/POSITIONING.md`、`docs/BACKLOG.md`
