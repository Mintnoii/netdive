# Tasks: 上下文分块 Treemap 与原文内容查看器（对齐 Magpie 真实交互模型）

> 立项第二次定稿：读过 `yetone/magpie` 源码（`internal/gui/assets/context.js` / `ctxtext.js` / `context.css`）后，废弃自造 5 类分块方案，改为对齐其真实模型：**7 个固定 part + part 内 items 两层 / squarified Treemap 与 400 格 waffle 双视图 / 独立文本浮层**。

## 0. Magpie 源码事实（设计依据）
- `PARTS = ["system","tools","skills","memory","files","results","chat"]`，每 part 带 `tokens` 与 `items[{tag,name,tokens,n}]`；
- 双视图 `ctxLook = "map" | "grid"`，存 `localStorage`，map 为默认；
- `squarify()` 为 Bruls/Huizing/van Wijk 算法；`tilesOf()` 含 `TILE_MIN=1500`/`TILE_MAX=12`/`TILE_FLOOR=700`/`TILE_SIDE=16`、`share^0.35` 已用曲线、薄块重排 8 轮、free 斜纹瓦片；
- `ctx-waffle` 为 `repeat(50)` 网格共 400 格 = 窗口 1/400；
- 行悬停与图双向联动（`data-f` 高亮），点击瓦片/格子/行 → `openCtxText()` 独立浮层（逐条折叠 + 100 条分页 + 复制 + 归档失效说明）；
- 清单 tabs = 全部 + 有量的 part，默认前 8 行 + 「显示全部 N 项」，mini bar 相对当前最大 item。

## 1. 数据契约与采集层 (Data Contract & Parser)
- [x] 1.1 `src/types/telemetry.ts`：`ContextPartKind`（7 类）/ `ContextItem { tag, name, tokens, n?, content? }` / `ContextPart { kind, tokens, items }` / `ContextPrompt { tokens, window, parts }`，`ContextWatermark.prompt?: ContextPrompt`；删除旧 `ContextBlock`/`blocks`
- [x] 1.2 `src/services/transcriptParser.ts`：sections 按映射表归类到 system/tools/skills/memory；`role:system` 正文并入 system；read/edit 按文件聚合进 files；其余工具按工具名聚合进 results（带 `n` 计数与最近一次原文）；对话轮进 chat（超 30 条最早的合并为 `turns`）
- [x] 1.3 严格对账：差额归入 chat 的 `more` item；超限按比例缩放 + 最大项尾差修正，保证 `Σ parts.tokens === prompt.tokens === watermark.total`
- [x] 1.4 `src/services/contextPrompt.test.ts`：8 条契约用例（总量对账、system 原文、bash n 聚合、read→files、turn、window、多次 system 合并、超限缩放）

## 2. 几何内核 (Treemap Geometry)
- [x] 2.1 新建 `src/services/squarify.ts` 纯函数：`squarify()` + `layoutTiles(prompt, w, h)`，导出 `TILE_MIN/TILE_MAX/TILE_FLOOR/TILE_SIDE/ITEM_MIN_SIDE/USED_CURVE/USED_FLOOR` 常量与 `CONTEXT_PART_KINDS`
- [x] 2.2 `src/services/squarify.test.ts`：7 条用例（空输入、面积守恒、不重叠、free 瓦片、横竖版边界、极小 part 不消失、常量与顺序契约）

## 3. 图形层与交互层 (Map / Waffle / Overlay)
- [x] 3.1 新建 `src/components/ContextPromptMap.tsx`：map 视图（ResizeObserver + layoutTiles 绝对定位瓦片、free 斜纹、`.bare` 小瓦片隐藏文字）+ grid 视图（400 格 `repeat(50)`、最大余数法分配、中点映射 item）+ 视图切换按钮 + `PART_LABELS`/`PART_CLASSES` 扁平字典 + focus 高亮联动
- [x] 3.2 `ContextInspectorDrawer.tsx`：接入 map、`look` 状态持久化到 `localStorage['netdive.ctxLook']`、`focus` 状态、tabs（全部 + 有量 part）、前 8 行 + 「显示全部 N 项」、`×n` 徽标 + tag 芯片 + mini bar（相对当前列表最大 item）
- [x] 3.3 新建 `src/components/ContextTextOverlay.tsx`：独立文本浮层（`z-[60]`），逐条折叠 + 「原文 / 微压缩」双 tab + 复制 + 100 条分页「显示更多 N 条」+ `initialItemIndex` 单条定位与「全部 N 条」切换 + Esc 只关浮层
- [x] 3.4 抽屉 Esc 优先级：浮层打开时 Esc 先关浮层不关抽屉；面板高度恒 `h-[min(66vh,640px)]`

## 3.5 三次收敛（用户拍板，2026-11-08）
- [x] 3.5.1 废除 400 格 waffle 视图与视图切换按钮，只保留 Treemap 单一视图（删除 `localStorage['netdive.ctxLook']`）
- [x] 3.5.2 Treemap 改用成熟库 `d3-hierarchy`（`hierarchy` + `treemap().tile(treemapSquarify)`），删除手搓 `src/services/squarify.ts` 与其 7 条测试
- [x] 3.5.3 内容清单收敛为 7 个 part 概要行（色点 + 中文名 + mini bar + tokens + 占比）；`read` / `edit` 等细粒度条目不再列出（属于画布右侧 `NodeDetailsDrawer`），点行/瓦片 → `ContextTextOverlay` 按需看该 part 全部条目
- [x] 3.5.4 派发记录：`orca worktree create --name wt-ctx-d3` → `pnpm add d3-hierarchy (+ @types)` → spec 五要素派发 agy → Pi 回验发现 `HierarchyNode` 缺 `x0/y0` 类型错误，改为接收 `treemap()(root)` 返回的 `HierarchyRectangularNode`（去掉类型断言）→ build 绿

## 4. 验证与门禁 (Verification)
- [x] 4.1 `pnpm test` 全通过：**212 pass / 0 fail**（原 204 + contextPrompt 8；squarify 7 条已随手搓实现一并删除）
- [x] 4.2 `pnpm build` 零类型报错
- [x] 4.3 `git worktree list` 仅剩主仓库；`openspec` 与本文件同步

## 5. 派发与回验记录 (Dispatch Log)
- worktree：`orca worktree create --name wt-ctx-prompt --base-branch main`，镜像工作态 18 个文件后独立 `pnpm install`，基线 211 pass
- P1（数据层）：agy 派发 5 文件 → Pi 回验发现 1 处死函数 `formatBlockToolLabel` 导致 `TS6133`，Pi 侧直接删除后 build 绿
- P2（几何内核）：agy 派发 3 文件 → 7 条几何断言全过，219 pass
- P3（图与清单）：agy 派发 2 文件（新建 ContextPromptMap）→ grep 断言全过
- P4（文本浮层）：agy 派发 2 文件（新建 ContextTextOverlay）→ grep 断言全过
- 合并方式：逐文件拷回主仓库 → 主仓库 `pnpm build` + `pnpm test`（219/0）→ 关终端 / 删 worktree / 删分支

## 6. 后续可选项 (Backlog)
- [ ] 会话级 spark 曲线（Magpie `spark()`：按请求序列画 prompt 体量曲线，点任一点切到那次请求的窗口）
- [ ] 卡片折叠记忆（`ctxShut`）与折叠态 parts 堆叠细条
- [ ] 原文内存窗口策略（Magpie 只保留最近 10 次请求原文），NetDive 目前直接取自会话 JSONL
- [ ] **暂缓（2026-11-08 拍板）**：真实上下文压缩（Agent 侧 tool_result 钩子介入）先不做，架构预留见 `docs/BACKLOG.md` 第一节
- [ ] **立即可做**：遥测副本层「压缩机会剖析」——用 `isCompactionNeeded` 判定哪里该压、`compactToolLines` 预演压完什么样（Head 15 / 标记 / Tail 15）、用 `GET /api/wal` 的 `getWalStats()` 真实对账替代硬编码 42000；算法升级候选（结构化保边界 / 重复行合并 / read 类结构签名）见 `docs/BACKLOG.md` 第二节
- [ ] **技术债**：浮层「微压缩」tab 降级为只读注解；底部「一键修剪」改为 WAL 真实账，删除硬编码释放量

