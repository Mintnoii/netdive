# 研讨留档：DeepSeek Harness Context 与 Agent Team 插件调研及借鉴边界

- **留档日期**: 2026-11-09
- **关联工程**: `NetDive`
- **核心议题**: 上下文洞察插件的信息呈现与交互体验借鉴，以及项目定位边界的两轮纠偏
- **素材性质**: 本轮 Pi × qing 研讨直接提炼，外部事实均标注一手信源坐标
- **下游建档**: `openspec/changes/context-trend-and-event-track/proposal.md` / `tasks.md`

---

## 一、对象辨析：两个名字，四套东西

调研起手先做身份核实，避免凭插件名脑补。Context 与 Agent Team 各有官方内核包和社区可视化插件两套实现，层次完全不同。

| 名字 | 官方内核包 | 社区可视化插件 |
| :--- | :--- | :--- |
| Context | `deepseek-ai/deepseek-harness` 的 `packages/context/`，一组注入类插件。工作区指令文件转 guidance、`@file` 路径补全、其他会话的有界快照、当前时间、tmux 位置。默认只挂 `agent-instructions`（`dsh-base`），其余 opt-in，注入内容以 user-role 消息进入 session history | `bowenliang123/dsh-context`，上下文洞察看板，DSH 团队成员加星推荐 |
| Agent Team | `packages/team/agent-team/`，给既有 subagent 树加持久共享任务板，CAS 任务所有权，成员用 `list_agents` 发现树、`send_message` 按名联系，共享一份 checkout | `NanmiCoder/dsh-agent-teams`，队长式委派加实时 Web 活动面板 |

本次讨论的「信息呈现与交互体验」全部指向右侧社区插件。官方包提供的是机制层参照。宿主本身基于 Cordis 的「一切皆插件」架构，模型、工具、会话、循环、UI 均可从配置替换（`docs/architecture.md`）。

## 二、一手功能清单

### 2.1 `dsh-context` 信息呈现

- **当前组成**：六色堆叠条按模型完整窗口缩放，灰色轨道是剩余余量，末尾两个斜线区是自动压缩预留与输出窗口预留。六类为系统提示、工具定义、用户消息、注入上下文、助手回复、工具结果，另列占用最高的 Top-5 工具 schema。
- **历史趋势**：每个模型请求一根堆叠柱，`Step / Turn` 双粒度，`Total / Delta` 双模式，Delta 下压缩向基线下方延伸；✂ 固定在压缩或剪枝发生的那根柱上；「总览」开关把整段会话压成面板宽度内一条连续色带并标四分位点；柱下三行步骤摘要为 User（开启该轮的消息）、In（新加入内容，通常是上一步工具结果）、Response（回复或调用的工具）。
- **上下文浏览器**：七个可折叠类别逐项标 token，再展开看实际内容（系统提示、工具 JSON schema、消息、推理、参数、工具输出）；`Skill Injections` 独立成类，让隐蔽技能占用不混进工具结果；工具 schema 带来源芯片（`tool-*` / `dsh-*` / `mcp:` / 注册插件名），可按大小或名称排序，每类有独立搜索；助手回复按 `Thinking / Tools / Answer` 筛；工具结果展开含 `OK/error`、行数与 `Raw / Markdown` 切换；图片与文件附件按顺序显示为卡片（缩略图、尺寸、存储大小、官方图像 token 估算）；与上一轮的 `+N 项 · ±Nk Token` 差异徽标。
- **上下文事件**：Inject / Compact / Prune / Switch / Mode 五类标签，每次带来源（指令文件、插件 ID、技能名）、token 净变化、轮次步骤与时间戳。
- **文件活动与命令执行**：Read / Written / Searched / Images 四类筛选，`edit` / `write` 估算 `+新增 / −删除` 行数，点击行展开完整操作日志并可跳到对应工具结果，点击文件名在侧栏预览；命令执行给状态、墙钟耗时、步骤定位与程序分布。
- **跨会话洞察页**：一级侧栏面板，KPI 栏（计费 Token、预估成本、缓存命中率、轮次）、7 天成对柱状图、8 周活动热力图、技能加载 / 工具调用 / 命令执行三个账本、组成环形图、会话卡片（点击直达）。
- **五入口同一份数据**：跨会话洞察页、会话 Context 标签、Fleet 标签（父 Agent 与每个子 Agent 各一张实时卡片）、右侧边栏面板、`/context` 居中弹窗，另有 Preferences 卡存每用户粒度与时间范围默认值。

### 2.2 `dsh-context` 数据治理

只把每会话精简摘要（组成、计数、成本耗时、模型信息）写进投影缓存，逐事件明细在面板需要时从持久日志重新汇总，明细各项有硬上限（步骤 1500、轮次 300、事件 400、surface 节点 2000、存档 400、文件操作 400、命令 400）。估算值与服务商报告的 `Actual Prompt / Output / Cache` 并列显示；压缩前的旧步骤从已移除消息存档重建，并明确标注「近似重建」，旧内容按页补载。

### 2.3 `dsh-agent-teams` 交互壳

- **非模态浮层**：右上角 `shell.overlay`，默认停靠会话右侧，可拖成浮动窗、左边缘调宽，折叠后变「团队数 + 活动脉冲点」小浮标；位置、手动尺寸、停靠模式 localStorage 持久化；宽屏时主对话列按面板实际宽度礼让，窄屏退回安全内边距并关掉拖拽缩放。
- **紧凑任务 DAG**：SVG 曲线连依赖，hover 或键盘聚焦预览完整上下游链，点击固定，`Esc` 取消；选中节点显示负责人、未满足前置、下游解锁信息、该任务用的模型短名。
- **成员行**：角色职业头像与状态动作动画、未读消息光晕、遵循 `prefers-reduced-motion`；行内给角色、实时状态、任务标签、完整 `provider/model`，点击打开成员子会话；顶部是分段总进度与状态统计。
- **会话跟随与冷发现**：面板只显示当前会话的团队（按 `captainSessionId`），新建会话自动收起，切回恢复；删除团队走归档保留（成员、任务、依赖图、邮箱全留），重启后按会话 ID 轻量冷发现重建成员树与 DAG。
- **刷新克制**：只在发现活动团队或有对话流卡片需求时保持轮询，普通会话不常驻扫描；轮询间隔从 1s 降到 3s，请求负载降约三倍（PR #34）。
- **宿主融入**：不改宿主源码，靠 `shell.overlay`、官方 locale seat、侧栏面板位、slash 命令、webServer 路由挂入。

### 2.4 `dsh-agent-teams` 契约层

任务状态机 `pending → claimed → in_progress → completed | failed | cancelled`，每次执行带单调 `attempt` 与唯一 `attemptId`；转派先撤销旧 attempt、等原成员安静再启动新 attempt，迟到结果无法覆盖；依赖未满足不可领取，成员不能同时持有两个未完成任务。质量任务走结构化合同（`objective / acceptance / inScope / verify / verdict`），`review` 只有 `pass` 才能完成，失败自动派生 repair 与下一轮 review；`halted`（人叫停）与 `escalated`（自动循环到上限）严格分开。Web 面板读磁盘状态文件当真相源，会话日志事件流独立用于审计重放，理由是模型偶尔干完活却不调 `update_task`，面板必须如实暴露这个偏差。

## 三、NetDive 现状对账

| 档位 | 已落地或已排队 |
| :--- | :--- |
| 已有 | `ContextStripBar` 7-part 水位条与 provenance 三态扁平字典、`ContextInspectorDrawer` 明细加压缩机会、`ContextPromptMap`、`ContextTextOverlay`、`CompactionPreviewOverlay`、`CompactorLabPage` 微压缩沙盒与 WAL 回放、`StateTimelineScrubber`、`SessionListSidebar`、`GateApprovalModal`、`AgentNode` 六大手势瘦节点、`multi-session-causal-dag-master-detail` 因果 DAG、`watermark-provenance-and-dead-mock-cleanup` 的 counted / estimated / live |
| 已排队 deferred | `future-context-spark-timeline`（按请求序列画 prompt 体量，点击切到该请求窗口，含 `headroom`）、`future-context-card-fold-memory`（`netdive.ctxShut` 折叠态与 7-part 细条）、`future-transcript-text-retention-policy`、`future-lab-import-from-live-observation`、`future-demo-sandbox-badging` |
| 真空白 | 趋势上的 ✂ 事件标记、`Total / Delta` 与双粒度、图表与浏览器的 hover 联动和点击钉住、步骤摘要三行、浏览器来源芯片与独立筛选、`Raw / Markdown`、附件卡、±差异徽标、估算与服务商实际并列、「近似重建」标注、大明细按需重放 |

## 四、两轮纠偏与最终边界

### 4.1 第一轮：优先 Context，不引入 team 主线

qing 指出 NetDive 当前不主打 team 相关能力，判断成立。理由比「不主打」更硬一层：`dsh-agent-teams` 的队长委派、共享任务板、成员唤醒、质量门禁合同都要在 Agent Loop 里派工才能拿到真相，而 NetDive 只拿到 `POST /api/telemetry` 送来的遥测副本，做编排就得侵入宿主。这与 `docs/BACKLOG.md` 第一节把「真实上下文压缩」明确暂缓是同一条判据。Context 侧全是只读投影，从现有 JSONL、usage、WAL 就能推导，零 Agent 侧改动。

NetDive 有 `SessionListSidebar` 的协同 Agent 字段和 `multi-session-causal-dag-master-detail`，但那是观测协同轨迹，跟编排团队任务是两件事。team 侧只剥交互壳留作后续参考（非模态可折叠浮标、DAG 上下游链 hover、归档冷发现），不引入 team 概念。

### 4.2 第二轮：撤回跨会话成本大盘

首轮答复曾把「跨会话聚合大盘（7 天成本、活动热力图、工具调用账本）」列为最值得抄的第一项。回读 `docs/POSITIONING.md` 后发现定位原文写着「不做事后记账器：如果只是记录消耗了多少 Token 和时长，开源界已经有很多轮子」，项目是外置副屏雷达仪，主业是事前事中拦截。该洞察页恰是典型事后记账，方向相反，当场从清单里撤回，不再作为新增视图推荐。

### 4.3 形态决策：不新开页，全部原地重构

`HeaderNav` 只有 `live` 与 `lab` 两个 Tab，后者明确标「非真实会话数据 · Sandbox」，这是 `compactor-lab-sandbox-repositioning` 刻意拍下的真实与沙盒分离。加第三个 Tab 会让人分不清眼前是真实会话还是统计聚合，跟 `future-demo-sandbox-badging` 想堵的坑撞在一起；副屏雷达仪也只需要一屏因果视野。`/context` 那类弹窗同样不做独立页，复用现有 `ContextTextOverlay` 与 `CompactionPreviewOverlay` 即可。五入口的本质是同一份数据的五种密度，该抄密度分层，入口维持现有两个浮层，不额外增加。

### 4.4 边界判据

**能不能帮人在当前这一步做出拦截或放行判断。能就进 `live` 页的抽屉与时间轴，不能就先放着。** 跨天成本统计答不上这个问题，趋势轨道能答，因为看清窗口怎么涨起来的，才知道该在哪一步挂起。

### 4.5 显式不做

跨会话成本大盘、Agent Team 编排能力、真实上下文压缩、新页面或第三个 HeaderNav Tab、`future-context-card-fold-memory` 的折叠态（已有独立 deferred 提案承接）。

## 五、信源分级与排雷

| 级别 | 坐标 | 用途 |
| :--- | :--- | :--- |
| 一手 | `github.com/bowenliang123/dsh-context/blob/main/README.md`、`github.com/NanmiCoder/dsh-agent-teams/blob/main/README_ZH.md` 与 `docs/usage.md`、`github.com/deepseek-ai/deepseek-harness` 的 `packages/context/README.md`、`packages/team/agent-team/README.md`、`docs/architecture.md`、`deepseek.com/harness/zh/` | 本文功能事实的唯一依据 |
| 交叉核对 | `blog.yeyupiaoling.cn/article/1786938660458`（2026-08-17，按 README + package.json + npm + 官方仓库核对） | 佐证。文中「48 轮约 56.3 万 token、一次压缩回收 −53.55 万」是维护者文档示例，非第三方评测 |
| 目录站 | `dsh.plus`、`dsh-plugin.org`、`dsh.directory` 对应插件页 | 二手整理，与 README 基本一致 |
| 存疑 | `deepseekharness.dev/zh/plugins/dsh-context` | 见下 |

**排雷结论**：存疑站列出的 `/context open`、`/context diff`、`/context prune`、`dsh.context.config.yml`（`dashboard.port: 3210`、`warnThreshold: 0.85`、`keepLastTurns: 10`）、「快照比对与回滚」、「一键脱敏导出」、「需重启宿主进程生效」，在一手 README 里一条都没有，且与官方「五种入口、只 `/context` 一条斜杠命令」「无需构建、无需重启」「配置在 Settings → 插件配置」直接冲突，行文带明显生成痕迹。判为二次加工站，交互范式可参考，配置 API 一律不照抄。

**知识库查重（标题级，不引用 `_raw` 内容）**：Ghost 已收录《一切皆插件之后，Agent 工程的新范式》《人人都能整个自己的 DeepSeek Harness》《我把公众号搜索接进了 DeepSeek Harness》《AI 不缺智商缺纪律：一场 Harness 工程化实践》《AI 编码工程 Harness 实践体系》及抖音转录《DeepSeek Harness 深度解读》。本轮未触发入库，也未引用这些素材的具体结论。

**已回读正文的概念卡**：`Ghost/wiki/learning/Agent 运行时透明度与可观测性.md`（以状态事件流作为唯一真相源）、`Ghost/wiki/learning/Agent 上下文工程与动态工作集治理.md`（上下文视为瞬时工作内存，静态前缀对齐命中 Prefix Caching，四阶段生命周期含 Compaction 代谢）。

## 六、遗留洞察

`dsh-agent-teams` 让 Web 面板读磁盘状态文件当真相源，事件流只用于审计重放，理由是模型偶尔不按工具协议上报。本地概念卡主张以状态事件流作为唯一真相源。两条路各有代价，事件流赢在可复现，状态快照赢在能戳穿「有事无报」的偏差。NetDive 后续可在保留事件流回放的同时加一份轻量状态投影，专门标出这类偏差。本提案不实现，留作独立议题。

## 七、落地拆分与交付节奏

三件事严格串行，承接 `future-context-spark-timeline` 的设计预研（其 deferred 档保留作溯源，不改动）。

| 里程碑 | 内容 | 主要落点 |
| :--- | :--- | :--- |
| M1 | 上下文趋势与事件轨道：趋势柱、✂ 标记、`Total / Delta`、`Step / Turn`、三行步骤摘要、`headroom` | `transcriptParser.ts` 的 `promptSeries`、新增纯 SVG 趋势组件、`ContextInspectorDrawer` 内轨道 |
| M2 | 图表与浏览器联动及检视手感：hover 预览、点击钉住、估算与实际并列、来源芯片、独立搜索排序、三类回复筛选、`Raw / Markdown`、附件卡、±差异徽标 | `ContextInspectorDrawer`、`ContextPromptMap`、`ContextTextOverlay` |
| M3 | 数据可信度与体积治理：provenance 扩「近似重建」、压缩前步骤标注、精简摘要进投影缓存与大明细按需重放 | `types/telemetry.ts`、`transcriptParser.ts`、`useTelemetryStream.ts`、`ContextStripBar`、`ContextInspectorDrawer` |

qing 于 2026-11-09 拍板：**三件事不要一次实现，完成一个跟我对齐一次。** 该硬约束写入 `tasks.md` 顶部，每个里程碑末尾设停工对齐点，禁止一轮连做两项，禁止把后续里程碑代码夹带进当前 worktree。

同日追加拍板：**不派发 agy、不切 Orca worktree，三个里程碑全部由当前 Pi Agent 在主仓库原生直写。** 提案与 `tasks.md` 的派发规约已就地改为 Pi 直写，编码派发门禁的默认路径在本任务链上被显式覆盖。

**结案对账（2026-11-09）**：三里程碑全部完成并经 qing 逐项对齐，整案回「可以」授权提交。上表是研讨当时的计划快照，实际落点已按数据可用性收敛，例如 `promptSeries` 改为从事件流派生、投影缓存改为纯计数摘要、parser 与实时流三态写入零改动。实现差异与验收基线以 `proposal.md` 第三节、`tasks.md` 各里程碑的「实现差异对账」表为准，本节保留作溯源，不再回改。
