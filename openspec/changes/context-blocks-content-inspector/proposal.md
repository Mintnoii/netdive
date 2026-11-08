# Proposal: 上下文分块 Treemap 与原文内容查看器 (Context Blocks Treemap & Content Inspector)

## 1. 痛点背景 (Problem Statement)
`real-token-watermark-and-context-inspector` 已把上下文水位做成了恒定高度的四列概览，但每列只有聚合数字（「系统基座 21K」「工具与文件 14K」），用户无法回答两件事：
1. **这 21K 到底是什么内容**——想直接读到系统提示词、某一轮对话、某次 bash 输出的原文；
2. **谁在真正吃空间**——聚合列看不出「bash 被调用了 75 次」「第 21 轮独占 15.9K」这种块级分布。

参考形态（Magpie 风格上下文窗口）：上方按面积比例铺满的块状 Treemap + 底部图例，下方「内容」清单（分类筛选 + 每项横向占比条 + Token 数），点击任意项即可读到该块原文。

## 2. 核心设计 (Design)

### 2.1 数据层：上下文分块契约 `ContextBlock`
- 新增类型（`src/types/telemetry.ts`）：
  - `ContextBlockCategory = 'system' | 'dialogue' | 'tool' | 'file' | 'free'`
  - `ContextBlock { id, category, label, tokens, content?, meta?, count? }`
  - `ContextWatermark.blocks?: ContextBlock[]`
- 采集规则（`src/services/transcriptParser.ts`）：
  - 系统提示词：`sections` / `{type:'system'}` / `role:'system'` 的原文入 `content`，`tokens = ceil(chars/4)`；
  - 对话轮：每条 user/assistant 消息一个块，`label = 第 N 轮`，`content = 文本原文`；
  - 工具类：每次工具调用一个块（`category: 'tool'`，`content = 观测输出原文`）；读取/编辑文件的调用归 `category: 'file'`；
  - 剩余空间：`free` 块，`tokens = max(0, maxCapacity - total)`，无 content。
- 契约约束：`blocks` 中非 `free` 项的 `tokens` 之和必须等于水位 `total`（容差内），`free` 补齐到 `maxCapacity`。

### 2.2 UI 层：Treemap + 内容清单 + 原文查看器
- 抽屉结构改为三段（高度仍恒定 `h-[min(66vh,640px)]`）：
  1. **顶部大盘**：左侧「已用上下文 + 健康度徽标 + `125K / 1.05M token` 大字 + 已用百分比」；右侧「Prompt Cache 命中率大字 + 命中横条 + `来自缓存 / 新增`」；
  2. **Treemap 区块图**：`grid` 近似面积布局，块宽按 `tokens` 权重，超出前 9 块聚合为「另外 N 项」；每块显示主标签 + 次级 `token · 类别`；块色按 `category` 查表（system 紫 / dialogue 靛蓝 / tool 琥珀 / file 绿 / free 斜纹灰）；
  3. **内容清单**：分类筛选 chips（全部 / 系统提示词 / 工具 / 文件 / 工具结果 / 会话内容）+ 每行「色点 + 名称 + 右对齐占比条 + token 数」，点击行内展开原文查看器（等宽等宽字体、行内滚动、`max-h`），无原文时显示降级提示。
- 底部图例展示五类总量；保留既有「一键修剪」与「收起」操作。

### 2.3 交互硬约束（沿用上一版定稿）
- 面板高度恒定，任何筛选/展开/查看原文操作不得改变面板高度；
- 不参与流内布局（`fixed inset-x-0 bottom-0`），画布与播放控制位置零变化。

## 3. 验收标准 (Acceptance Criteria)
- [ ] `ContextBlock` 契约落地，`transcriptParser` 产出 blocks，非 free 项 tokens 之和与水位 `total` 一致；
- [ ] 系统提示词块保留原文 `content`，可从 UI 中逐字符查看；
- [ ] Treemap、筛选 chips、占比条与原文查看器全部可用，切换不改变面板高度；
- [ ] `pnpm test` 100% 通过（新增 blocks 契约测试），`pnpm build` 零类型报错。

## 4. 素材源流 (Source Lineage)
- 延伸自 `openspec/changes/real-token-watermark-and-context-inspector/`
- 形态参考：Magpie 上下文窗口截图（Treemap + 内容清单 + 缓存命中大盘）

## 5. 二次定稿：对齐 Magpie 真实交互模型 (2026-11-08)
读完 `yetone/magpie` 源码后推翻自造方案，落地其真实设计：
- **数据**：7 个固定 part（system / tools / skills / memory / files / results / chat），每 part 内含 `items[{tag,name,tokens,n,content}]` 两层结构；
- **图形**：squarified Treemap（`squarify` + `layoutTiles`，含瓦片面积下限、薄块重排、`share^0.35` 已用曲线、free 斜纹瓦片）与 400 格 waffle 双视图，视图选择持久化；
- **交互**：清单行 ↔ 瓦片/格子双向 hover 高亮；点击任意处打开**独立文本浮层**（逐条折叠、原文/微压缩双 tab、复制、100 条分页）；
- **清单**：tabs（全部 + 有量 part）、前 8 行 + 「显示全部 N 项」、`×n` 徽标 + tag 芯片 + 相对最大 item 的 mini bar。

配色保持 NetDive 的 Paper & Ink 浅色系，仅继承 Magpie 的信息层级与交互骨架。

## 6. 三次定稿：单一 Treemap + 成熟库 (2026-11-08)
- 只保留 Treemap 一种视图，废除 400 格 waffle 与视图切换；
- Treemap 几何改为 `d3-hierarchy` 的 `treemap + treemapSquarify`（成熟库替代手搓 squarify，删掉自研几何模块）；
- 内容清单只保留 7 个 part 概要行；`read` / `edit` 等细粒度条目归画布右侧 `NodeDetailsDrawer`，抽屉内通过 `ContextTextOverlay` 按需查看某 part 的全部条目原文。
