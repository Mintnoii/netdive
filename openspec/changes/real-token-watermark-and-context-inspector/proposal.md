# Proposal: 真实 JSONL 会话 Token 上下文解析与多维上下文水位抽屉面板 (Real Token Watermark & Context Inspector)

## 1. 痛点背景与动机 (Problem Statement)
当前 NetDive 的上下文 Token 内存水位（`ContextWatermark` 与 `PrunableItem`）存在两个核心短板：
1. **数据源层仍为启发式 Mock / 兜底折算**：
   - 现有的 `transcriptParser.ts` 统计 `tokenBreakdown` 时采用 `Math.ceil(chars / 4)` 粗估；
   - `useTelemetryStream.ts` 中的 `extractPrunableItems` 针对手势固定映射为硬编码数字（如 bash 28k、edit 14k、read 4k），而非提取自真实会话的输出负载。
   - 实际上，真实的本地 JSONL（如 Pi / Claude 会话）在每条助手消息中均完整输出了 `usage: { input, output, cacheRead, cacheWrite, reasoning, totalTokens }`，以及第一条消息中的全量 `sections (systemPrompt, tools, rules, docs)`，真实数据长期处于未利用状态。
2. **UI 展现与上下文类别洞察单薄**：
   - 顶部 `ContextStripBar` 仅提供静态的三段色条（System 12k / Active 8k / Prunable 2k），无法向用户解释“当前上下文究竟被什么消耗了”；
   - 缺乏类似 **Magpie / 现代模型网关请求上下文视窗** 的分析能力——无法一目了然看清：
     - System Prompt 占比（Preamble / Tools Schema / Docs / Addendum）；
     - 历史多轮对话上下文（User / Assistant / Thinking Chain）；
     - 工具执行冗余（Bash stdout / Read File 内容 / Edit Diff）；
     - 关键的 **Prompt Cache 命中与节省比率 (Cache Read vs Fresh Input)**。

## 2. 核心架构与设计规格 (Architecture Design)

### 2.1 真实数据提取层 (Transcript Parser & Watermark Engine)
- **真值优先契约**：
  - 在 `transcriptParser.ts` 规范化流程中，扫描助手消息中的 `message.usage` 原生字段；
  - 提取当前轮次的真实输入、输出、思考链 (`reasoning`) 以及缓存读取 (`cacheRead`)；
  - 从 `role === 'system'` 的消息或第一条消息的 `sections` 提取系统提示词各部分的实际字符量与估算/精确 Token；
  - 精确计算每个工具调用（`toolResult`）在上下文中的实际字符/Token 负载（区分终端输出、文件正文、Git Diff），废除写死的 28k/14k/4k 伪数字。
- **动态 Watermark 契约升级**：
  - 扩展 `ContextWatermark` 类型，包含：
    - `total`: 当前实际总 Token 消耗
    - `systemPrompt`: 系统提示词与工具定义 Token
    - `conversationHistory`: 历史对话与思考自白 Token
    - `toolOutputs`: 工具产生的结果与观测数据 Token
    - `cacheRead`: 命中缓存的 Token 数
    - `reasoningTokens`: 思维链 Token 数
    - `prunableTools`: 建议修剪或可压缩的冗余工具输出
    - `maxCapacity`: 上下文物理上限（默认 200k 或依据模型动态设定）

### 2.2 底部上滑抽屉式上下文多维分析面板 (Context Inspector Bottom Sheet)
- **形态定稿（2026-11-08 三次纠偏，最终方案）**：废除居中弹窗 → 废除流内纵向生长（会顶飞播放控制与进度条）→ 定为**固定视口底部悬浮 Sheet**。抽屉 `fixed inset-x-0 bottom-0 z-50`、高 `52vh`（`min-h-[320px]` / `max-h-[620px]`），配 `fixed inset-0 z-40` 轻遮罩；**完全不参与流内布局**，画布、`StateTimelineScrubber` 播放控制与进度条、`ContextStripBar` 水位条的位置与尺寸在开关抽屉时零变化。挂载点位于页面根容器末尾，与流内结构彻底脱钩。
- **高度与导航定稿（2026-11-08 第四次纠偏）**：内容驱动高度会让切片段时面板上下跳，改回**恒定高度** `h-[min(56vh,560px)]`；同时**取消片段页签切换**，四个片段（系统基座 / 对话与思考 / 工具与文件 / Cache）改为**四列并排同屏**，列内独立滚动。点工具列条目 → 同面板切到「原始输出 ↔ 微压缩」左右对照视图，高度同样恒定；左上角「返回四片段概览」可回退，不触发关闭。窄窗口时四列横向滚动，绝不改变面板高度。
- **抽屉结构**：
  - 顶部把手 + 标题行（会话、实耗/上限、水位百分比、Cache 命中率）；
  - **纯展示迷你色谱条**：`h-2`，四段按真实占比平铺，无点击无选中态，仅承担「抽屉盖住水位条」后的锚点延续与比例速览；
  - **四片段并排列**：`grid grid-cols-4`，顺序固定为系统基座 (System Prompt & Tools Schema) / 交互历史与自白 (Dialogue & Assistant Thinking) / 工具输出与文件 (Tool Observations) / 缓存加速 (Cache Read Hit Rate)，列头带 Token 与占比，列体独立滚动；
  - **片段明细区（各构成部分的真实细节）**：
    - 非工具片段以结构化明细行呈现（稳定前缀量、思考链拆解、命中率与等价节省、可优化空间判定等）；
    - 工具片段展示高耗条目 TOP 清单 + `MicroCompactor` 确定性微压缩前后对比视窗。

## 3. 验收标准 (Acceptance Criteria)
- [ ] `transcriptParser.ts` 完整支持从 JSONL 读取真实 `message.usage`（含 input, output, cacheRead, reasoning）及工具输出尺寸；
- [ ] `useTelemetryStream.ts` 和 `ContextWatermark` 能根据真实加载的会话动态更新真实水位，不再依赖硬编码；
- [ ] 交互体验重构：点击顶部上下文水位条，从底部优雅滑出“上下文水位明细抽屉（Context Inspector Drawer）”，杜绝居中弹窗；
- [ ] 面板清晰展示：各类上下文占比饼/柱状条、Prompt Cache 命中状态、高消耗工具调用 TOP 榜单及一键修剪入口；
- [ ] 完善契约单元测试，确保真实 JSONL 样本与合成场景均能精准计算；
- [ ] `pnpm test` 保持 100% 通过，`pnpm run build` 零类型报错。
