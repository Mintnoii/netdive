# Tasks: 上下文趋势轨道、图表联动与可信度标注

> **交付节奏硬约束（qing 2026-11-09 拍板）**：M1 → M2 → M3 严格串行，**完成一个跟 qing 对齐一次**。每完成一个里程碑立即停工，出示 diff、`pnpm test` / `pnpm build` 结果与本档验收断言，等待明确对齐后方可开工下一个。严禁一轮内连做两项，严禁把后续里程碑代码夹带进当前 worktree 或当前提交建议。
>
> **边界**：只在 `live` 执行控制台内原地重构，不新开页面，不加第三个 HeaderNav Tab，不改 telemetry 协议，零侵入 Agent。详见 `proposal.md` 第二节。
>
> **派发规约（qing 2026-11-09 拍板）**：**不派发 agy、不切 Orca worktree**，三个里程碑全部由当前 Pi Agent 在主仓库原生直写。Pi 自行回验 `git diff` 并出示结果，不依赖子 Agent 自报。编码派发门禁的默认路径在本任务链上被显式覆盖。
>
> **Git 红线**：严禁擅自 `git commit` / `git push`。每个里程碑收口后主动出示修改摘要与推荐 Commit 信息，等 qing 拍板。

---

## M1 上下文趋势与事件轨道 ✅ 已完成并对齐

承接 `future-context-spark-timeline` 的设计预研，叠加 DSH 借鉴的事件标记与双粒度。

### 1. 服务层
- [x] 1.1 `src/services/contextTrend.ts`：从 `TelemetryEvent[]` 事件流派生逐请求 `TrendPoint[]`，相邻相同 usage 折叠；实测路径取 `usage.input`，缺 usage 走字符量启发式推算并标 `estimated`
- [x] 1.2 同文件：从 `context_pruned` 事件提取 ✂ 标记并挂到最近请求点，带 `contextPruned` 负载判 `compact`，否则 `prune`；事件流无 Inject / Switch 显式记录，不造这两类标记
- [x] 1.3 同文件：`attachDelta` / `aggregateByTurn` / `estimateHeadroom` / `buildTrendBars` 纯函数，附 `@example` 真实 JSON 形状注释
- [x] 1.4 `src/services/contextTrend.test.ts`：11 条契约用例（逐请求对齐、去重、estimated 降级、双粒度、headroom、✂ 定位、柱几何、空输入）
- [x] 1.5 `package.json`：`test` 脚本追加 `src/services/contextTrend.test.ts`

### 2. UI 层
- [x] 2.1 `src/components/ContextTrendTrack.tsx`：纯 SVG 柱阵，`总量 / 增量` 与 `步骤 / 回合` 切换，✂ 固定在事件发生柱上，Delta 模式负值向下延伸，`ResizeObserver` 取真实宽度
- [x] 2.2 同组件：三行步骤摘要（User / In / Response）与选中请求的实测明细（输入 / 输出 / 缓存 / 回收量），点选只持 `TrendPoint` 指针
- [x] 2.3 `src/components/ContextInspectorDrawer.tsx`：内嵌趋势轨道；7-part 明确标「当前窗口构成快照 · 历史每步分布未留存，不作比例投影」，不伪造历史档位
- [x] 2.4 抽屉 `max-h-[min(76vh,720px)]` 与第 3 段 `min-h-0 overflow-y-auto` 保持不变，新增轨道由弹性内容区吸收，播放控制与画布位置不变

### 3. 验证
- [x] 3.1 `pnpm test` 248 条全绿，`pnpm build` 零类型报错
- [x] 3.2 `src/components/ContextInspectorDrawer.test.ts` 补趋势轨道挂载与事件标记断言（组件导出、窗口与 headroom 对账、✂ 定位、estimated 标注）
- [x] 3.3 `docs/BACKLOG.md` 第三节与第七节补注承接关系，新增正式提案索引行

### 实现差异对账（M1）

| 原计划 | 实际 | 原因 |
| :--- | :--- | :--- |
| `transcriptParser.ts` 产出 `promptSeries` | `contextTrend.ts` 从事件流派生 `TrendPoint[]` | parser 已把 `message.usage` 挂到每条 assistant 事件，事件流是唯一真相源，不重复存投影，零协议改动 |
| 点选切到该请求的 7-part 档位 | 点选显示该请求实测体量明细，7-part 标为当前窗口快照 | 历史每步 7-part 未留存，按当前比例投影会造假，违反 provenance 守卫 |
| Inject / Compact / Prune / Switch 四类事件 | 只实现 `compact` / `prune` | 现有事件流无 Inject / Switch 显式记录，不造不存在的标记 |
| 趋势轨道贴 `StateTimelineScrubber` 共用时序 | 抽屉内独立 SVG，不接播放器 | 避免与拖拽播放竞态，零画布运镜 |
| 抽屉高度恒定 `h-[min(66vh,640px)]` | 沿用现有 `max-h-[min(76vh,720px)]` + 弹性内容区 | 任务书写表述与代码不符，保持既有约束不破坏 |

### ⏸ 停工对齐点 M1
> **已完成并经 qing 回「可」对齐（2026-11-09）**。实现差异五条已出示，未写 M2 / M3 代码即停工。

---

## M2 图表与浏览器联动及检视手感 ✅ 已完成并对齐

### 1. 联动契约
- [x] 1.1 `src/services/contextBrowser.ts`：`StepLink` 严格三字段 `{ stepIndex, nodeId, mode }`，按 `nodeId` 跨 Step/Turn 粒度定位，不含 content、payload 或播放器位置
- [x] 1.2 同文件：`resolveStepEvents` 只返回事件摘要（nodeId / title / gesture / chars），完整原文在浮层展开时 JIT 取，14 条契约测试覆盖瘦节点
- [x] 1.3 `ContextTrendTrack.tsx` 改受控联动：hover 预览、移开恢复用户自选、点击固定、`Esc` 取消；Esc 收进抽屉逐级关闭链，趋势轨道保持独立 SVG 不接播放器
- [x] 1.4 `src/services/contextBrowser.test.ts`：14 条契约用例（指针、事件摘要、实际 usage、净变化、搜索排序、三段筛选、成败判定、文件引用、Markdown 行分类）

### 2. 浏览器增强
- [x] 2.1 `ContextTextOverlay.tsx`：每类独立搜索框（条目名称 + 来源标签）、按体量 / 按名称排序、结果保留原索引供展开态复用
- [x] 2.2 同组件：原文 / Markdown / 压缩预览三视图；Markdown 走行级分类字典，不引第三方渲染库
- [x] 2.3 同组件：来源芯片取 JSONL 真实 `tag`、`OK/error` 判定、行数、文件引用卡（路径 + 字符量 + token 推算）
- [x] 2.4 抽屉内容构成标题行：三段筛选（思考与提示 / 工具 / 对话）互斥覆盖 7 类，各段带非空类别计数，再次点击清除恢复全部
- [x] 2.5 抽屉联动明细条：窗口级 `±Nk · 较上一请求` 徽标、服务商实际 `Input / Output / Cache` 并列、hover / pinned 状态与事件摘要；无 usage 时明示仅有推算值

### 3. 验证
- [x] 3.1 `pnpm test` 267 条全绿，`pnpm build` 零类型报错
- [x] 3.2 `src/components/ContextInspectorDrawer.test.ts` 补 M2 联动指针、实际 usage、差异徽标、三段筛选、浮层导出断言
- [x] 3.3 `proposal.md` 状态、设计决策、验收场景、涉及文件与 `docs/BACKLOG.md` 索引同步

### 实现差异对账（M2）

| 原计划 | 实际 | 原因 |
| :--- | :--- | :--- |
| hover 预览该步骤组装的上下文 | hover 预览该请求前新增的事件摘要，7-part 仍为当前窗口快照 | 历史每步上下文未留存（M1 已确认），不组装假档位 |
| 最小契约 `{ stepId, nodeId, mode }` | `{ stepIndex, nodeId, mode }`，按 nodeId 定位 | 事件流无 `stepId`；数字索引在 Step/Turn 切换时会错位 |
| 助手回复按 Thinking / Tools / Answer 筛选 | 三段按 7-part 分类互斥派生，UI 明示无原生分段标签 | NetDive 事件流没有 assistant 消息内的原生分段标记 |
| 附件卡含缩略图、尺寸、存储大小 | 文件引用卡只给真实文本引用路径与字符量推算 | 遥测契约无图片二进制、缩略图与物理尺寸字段 |
| 各类别显示 ±差异徽标 | 窗口级净变化徽标，放在趋势轨道联动条 | 类别级历史 tokens 未留存，不能造 |
| `Raw / Markdown` 双视图 | 原文 / Markdown / 压缩预览三视图 | 保留 M1 之前的只读压缩预览，避免能力回退 |
| 估算值与服务商 Actual 并列，新增 `actualReported` 契约 | 从事件流 `usage` 直接取实际值并列显示 | 契约层正交标注是 M3 范围，M2 不提前写 |
| 与播放器做互锁状态机 | 联动契约不含 seek / position，轨道不接播放器，Esc 走抽屉链 | 零画布运镜，不新增状态机胶水 |

### ⏸ 停工对齐点 M2
> **已完成并经 qing 回「那继续」对齐（2026-11-09）**。实现差异八条已出示，未写 M3 代码即停工。

---

## M3 数据可信度与体积治理 ✅ 已完成并对齐

### 1. 可信度标注
- [x] 1.1 `src/types/telemetry.ts`：新增 `ContextAnnotation` / `ActualUsageReport` / `ContextProvenanceView` 契约类型，`counted / estimated / live` 三态字段逐字不动
- [x] 1.2 `src/services/contextProvenance.ts`：`PROVENANCE_BADGES` 与 `ANNOTATION_BADGES` 两份扁平字典收敛到共享底座，`ContextStripBar` 与 `ContextInspectorDrawer` 删除各自的本地副本，同一渲染形状
- [x] 1.3 `ContextStripBar.tsx` / `App.tsx`：水位条接收 `events`，渲染「服务商实际值」与「近似重建」正交徽标，并列显示「窗口装配 X · 实际 Input Y」
- [x] 1.4 `ContextInspectorDrawer.tsx`：标题行渲染正交徽标；hover 或固定到压缩前请求时明示「明细按事件摘要近似重建，非原始装配快照」
- [x] 1.5 `src/services/contextProvenance.test.ts`：14 条契约用例（正交标注、三态不变、压缩前步骤判定、精简投影、硬上限、按页补载）
- [x] 1.6 `src/server/bridge.test.ts`：补三态与正交标注并存断言（带 usage → counted + actualReported、无 usage → estimated 无标注、剪枝 → live + reconstructed）

### 2. 体积治理
- [x] 2.1 `CONTEXT_DETAIL_LIMITS` 五维硬上限（步骤 1500 / 回合 300 / 事件 400 / 文件操作 400 / 命令 400）加每页 100 条，取值参考研讨留档第五节并按项目规模适配
- [x] 2.2 `buildContextProjection(events)` 只返回计数摘要，返回体不含任何 content / payload；`projectionNotice` 超限时列出实际数与上限，抽屉显示可读降级文案，不静默截断
- [x] 2.3 `ContextTextOverlay.tsx` 沿用 M2 已有分页，把每页数量与上限收成共享常量；`resolveDetailWindow` 触顶后停止「显示更多」并给出补载提示，绝不把整段会话原文灌进抽屉状态

### 3. 验证
- [x] 3.1 `pnpm test` 284 条全绿，`pnpm build` 零类型报错
- [x] 3.2 端到端烟雾验证：验收用 JSONL 解析后 `annotations=['actualReported']`、实际值 `input=13000 / output=500 / cacheRead=1200`、投影 6 事件且不超限；追加模拟剪枝事件后标注变为 `['actualReported','reconstructed']` 且压缩前步骤判定为 true
- [x] 3.3 `docs/BACKLOG.md`、`README.md`（能力清单与 284 测试基线）、`proposal.md`、`tasks.md` 同步；`docs/POSITIONING.md` 边界无变化，未改动

### 实现差异对账（M3）

| 原计划 | 实际 | 原因 |
| :--- | :--- | :--- |
| `transcriptParser.ts` / `useTelemetryStream.ts` 写入 `estimated` / `live` / `reconstructed` | 两处三态写入路径零改动，标注由 `resolveAnnotations(events)` 纯函数派生 | M1 已确立事件流为唯一真相源，在 parser 与 stream 两处重复写同一事实会制造双源，且现有三态逻辑本就正确 |
| 新增 `actualReported` / `reconstructed` 到 `ContextWatermark` 字段 | 只加契约类型与可选 `ContextProvenanceView`，水位字段不变 | 水位契约被 parser、bridge 与既有测试共用，加未被读取的字段是死数据 |
| 投影缓存只存精简摘要，明细从持久日志重汇总 | `buildContextProjection` 返回纯计数摘要，原文仍留在 `prompt.parts` / WAL，沿用浮层 JIT 展开 | 仓库里没有现成投影缓存层，不造运行时状态机；「按需取原文」已由 M2 分页实现 |
| 「估算值 / 服务商实际值」并列 | 「窗口装配值 / 服务商实际 Input」并列 | `provenance='counted'` 时水位本身来自真实 usage，把左边一律叫估算值会误导 |
| 压缩前旧步骤从存档近似重建并标注 | 只标「明细按事件摘要近似重建」，不重建原始装配快照 | 历史每步 7-part 未留存，造一份重建结果会违反 provenance 守卫 |
| `bridge.test.ts` 断言带 usage → counted / 无 usage → estimated / 重建 → reconstructed | 三条断言按原计划补齐，同时验证三态与标注正交并存 | 沿用 `watermark-provenance` 既有契约测试落点 |

### ⏸ 停工对齐点 M3
> **已完成并经 qing 回「可以」整案对齐（2026-11-09）**。三里程碑全部落盘，完整 diff、`pnpm test` 284/284 与 `pnpm build` 结果、上表实现差异均已出示。临时验收样例与一次性验证脚本已清理，正式契约单测全部保留。qing 授权整理提交，未执行 `git push`。

---

## 验证断言（Pi 回验执行）

```bash
# M1
grep -n "buildTrendModel" src/services/contextTrend.ts src/components/ContextInspectorDrawer.tsx
grep -n "estimateHeadroom" src/services/contextTrend.ts
# M2
grep -n "buildStepLink\|collectActualUsage\|searchAndSortItems" src/services/contextBrowser.ts
# M3
grep -n "resolveAnnotations\|CONTEXT_DETAIL_LIMITS" src/services/contextProvenance.ts
grep -n "ContextAnnotation\|ActualUsageReport" src/types/telemetry.ts
# 全局红线：node.data 不得常驻原文
grep -rn "node.data.*rawText\|node.data.*payload" src/ || echo "零命中"
# 全量
pnpm test && pnpm build
```

- 284 条用例全绿，零类型报错
- 未启用新轨道的旧会话回放行为逐字节等价
- `lab` 沙盒页与真实观测的职责分离不受影响
- `telemetry.ts` 既有三态字段与事件契约逐字未改，bridge HTTP 端点未改

## 派发与回验记录 (Dispatch Log)

- **M1**：2026-11-09 完成并经 qing 回「可」对齐。Pi 主仓库原生直写。`pnpm test` 248/248 全绿、`pnpm build` 零类型报错。
- **M2**：2026-11-09 完成并经 qing 回「那继续」对齐。Pi 主仓库原生直写。`pnpm test` 267/267 全绿、`pnpm build` 零类型报错。
- **M3**：2026-11-09 完成并经 qing 回「可以」整案对齐。Pi 主仓库原生直写（qing 拍板不派 agy、不切 worktree）。回验 `pnpm test` 284/284 全绿、`pnpm build` 零类型报错；端到端烟雾验证覆盖标注派生与投影上限。三里程碑全部收口，临时产物清理完毕，授权整理为单个提交。
