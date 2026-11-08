---
type: doc
title: "BACKLOG.md — NetDive 未来特性与暂缓项清单"
created: 2026-11-08
updated: 2026-11-08
tags: [backlog, roadmap, compression, context, micro-compactor]
status: evergreen
---

# BACKLOG — 未来特性与暂缓项

> 本文件记录**明确决定暂缓但已在架构上预留**的能力，以及**当前就能做、不需要改动 Agent 侧**的落地项。
> 与 `openspec/changes/<name>/tasks.md` 的 Backlog 小节互为索引：那里记任务粒度，这里记工程决策与边界。

---

## 一、暂缓项：真实上下文压缩（Agent 侧介入）

**状态**：明确暂缓，先不做。
**决策日期**：2026-11-08

### 1.1 为什么现在不做

NetDive 的定位是**旁路观测与拦截控制台**（见 `docs/POSITIONING.md`）：Agent 在自己的进程里把 prompt 发完之后，才通过 `POST /api/telemetry` 把遥测送给 bridge。也就是说：

- 当前 `microCompactor` 压缩的是**进入画布与检查器的遥测副本**，Agent 自己的上下文一个 token 都没变；
- 想真正降低 Agent 的上下文水位，必须**在 Agent Loop 的 tool_result 回填钩子里介入**，这属于宿主侧插件工程，与「可观测面板」是两条产品线；
- 强行把两者揉在一起会让 NetDive 从「零侵入监听」退化为「侵入式打点」，违背项目第一性定位。

### 1.2 真要做的时候需要什么（架构预留已就绪）

| 要素 | 现状 | 缺口 |
| :--- | :--- | :--- |
| 折叠算法 | `microCompactor.compactToolLines`（Head 15 + 折叠标记 + Tail 15）已具备、已有单测 | 无 |
| 原文留存 | 内存 WAL 注册表 `wal-call-N` + `replay()` 回放 | 需改为落盘 WAL（进程退出即失是硬伤） |
| 协议守卫 | `validatePairing` / `assertPairing` / `ensureToolEnvelope` 已具备 | 需在宿主侧真正调用（防止折叠破坏 tool_call ↔ tool_result 配对导致 HTTP 400） |
| 前缀稳定 | `computePrefixHash` / `createPrefixBoundary` 已具备 | 需在宿主侧确认折叠只动尾部、前缀字节级不变 |
| 触发时机 | bridge 摄入时自动折叠（观测副本） | 需迁移/复制到 Agent 的 compaction 钩子，在回填历史前生效 |

### 1.3 验收思路（未来）

- 折叠后会话能继续跑，不出现上游 400（配对完整性）；
- 折叠后 Prompt Cache 命中率不下降（前缀哈希不变）；
- 被折叠条目可 100% 回放原文（WAL 落盘可查）；
- 对同一会话，折叠前后 Agent 上报的 `usage.input` 有可测量下降。

---

## 二、当前就能做：遥测副本层面的「压缩机会剖析」

**前提**：不动 Agent、不改协议，只在观测面把「哪里该压、压完长什么样、真实省了多少」讲清楚。
**这属于面板能力升级，可直接落地。**

### 2.1 三步链路

1. **判定（哪里该压）**
   对当前会话每个事件调 `isCompactionNeeded(output)`：
   - 触发条件：行数 `> 40` 或 字符数 `> 1500`（`DEFAULT_MAX_LINES_THRESHOLD` / `DEFAULT_MAX_CHARS_THRESHOLD`）；
   - 产出候选清单：工具名、原始行数/字符、折叠后字符、释放字符、释放百分比、是否已带 `pointerId`（说明 bridge 已真实折叠过）。

2. **预演（压完什么样）**
   对候选条目调 `compactToolLines(output)`，直接展示三段真实文本：
   - 头部 15 行（原始，保留入参/命令与前置上下文）
   - 折叠标记行：`[... 原始输出已折叠 N 行，保留前置入参及尾部退出判定 ...]`
   - 尾部 15 行（原始，保留退出码/断言结论/报错尾巴）
   折叠后固定 31 行，可与原文左右对照。

3. **对账（真实省了多少）**
   读取 bridge 已有的真实账，替代现在硬编码的 `42000`：
   - `GET /api/wal` → `stats.totalEntries / totalRawChars / totalCompactedChars / totalReclaimedChars`；
   - `GET /api/wal/:pointerId/replay` → 逐条回放原文。

### 2.2 现有算法可升级的候选（确定性、零模型调用）

| 编号 | 算法 | 做法 | 收益 | 风险 | 建议 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| A | Head/Tail 15+15（现状） | 保首尾，中间折叠成一行标记 | 稳定 80~90% | 无 | 保留为兜底 |
| B | **结构化保边界裁剪** | 除首尾外，强制保留所有「失败/报错/断言失败/堆栈/路径与摘要」行，其余折叠 | 折叠率略降但信息价值更高；长测试日志上近乎无损 | 需规则清单，不能误留海量重复报错行 | **优先做** |
| C | 读文件类改结构签名 | `read` 类输出不做行折叠，改为「文件签名摘要」：路径 + 行数 + 顶层导出/函数名 + diff 摘要 | 读大文件场景释放极多 | 需语言无关的轻量签名提取 | 次优先，仅限 `read` |
| D | 连续重复行合并 | `\d+ identical lines` 式折叠（`radash` 归约即可） | 日志/表格类输出额外 10~30% | 无 | 与 B 叠加 |
| E | JSON / JSONL 按字段裁剪 | 保留 key 骨架 + 前 N 条数组项，其余 `…(+N)` | 结构化输出释放多 | 需保证不破坏可读结论 | 谨慎，先做采样预览 |
| F | 按 Token 预算而非行长 | 阈值从「40 行 / 1500 字符」改为「占窗口百分比」 | 更贴合真实成本 | 需窗口口径统一 | 等 B/D 落地后再议 |

### 2.3 现在这一屏能立刻回答的三个问题

- **哪里该压**：本次会话中体积超标、且尚未被折叠的工具观测（按释放量排序）；
- **压完什么样**：Head 15 / 标记行 / Tail 15 的真实文本，可直接对比原文；
- **压了能省多少**：字符数释放量与占窗口百分比，并以 bridge WAL 的真实统计为准。

### 2.4 假动作清理（已于 2026-11-08 落地）

- ✅ 详情浮层里的「微压缩」tab 已改名「压缩预览（只读）」并标注不改变会话；
- ✅ 底部「一键修剪」与 `pruneContext` 已彻底删除，释放量硬编码 `42000` 清零，改为展示 bridge `getWalStats()` 的真实账；
- 落地记录见 `openspec/changes/compaction-opportunity-inspector/`。

### 2.5 死代码清理（已于 2026-11-08 落地）

- ✅ 删除未被挂载的 `src/components/PrunableInspectorDrawer.tsx`（内部含 `isPruned ? 42000 : ...` 假默认值），同步移除 `bridge.test.ts` 的导出冒烟断言与压缩实验室样例文案中的提及。

---

## 三、其它已记的暂缓项

- 会话级 spark 曲线（Magpie `spark()`：按请求序列画 prompt 体量，点击切换请求窗口）
- 上下文卡片折叠记忆（Magpie `ctxShut`）与折叠态 parts 堆叠细条
- 原文内存窗口策略（Magpie 只保留最近 10 次请求原文；NetDive 直接读会话 JSONL，保留更久）

---

## 四、沙盒台账（Compactor Lab）

`压缩沙盒`（`src/pages/CompactorLabPage.tsx`）已重新定位为**纯沙盒实验台**，与真实观测面板职责分离：

| 能力 | 位置 |
| :--- | :--- |
| 真实会话压缩机会、三段预演、bridge WAL 真实账 | 底部「上下文水位明细」抽屉 + `CompactionPreviewOverlay` |
| 任意文本试压缩、阈值边界实验、Rule 1~4 教学、前缀稳定性试验 | 「压缩沙盒」页签（`非真实会话数据`） |

沙盒内的 WAL 指针前缀为 `wal-lab-*`，仅存于该页实例内存，与 bridge 的 `wal-call-*` 互不干扰。
留档：`openspec/changes/compactor-lab-sandbox-repositioning/`

---

## 五、假数据台账（Mock / 估算边界）

### 5.1 已清理（2026-11-08）

- ✅ `DEFAULT_PRUNABLE_ITEMS`（46k 假可修剪条目，全仓零引用）已删除，连同其契约测试
- ✅ `PrunableInspectorDrawer`（含 `isPruned ? 42000` 假默认值）已删除
- ✅ `pruneContext` 及其硬编码 `42000` / `watermark.prunableTools = 4000` 假修剪已删除
- ✅ 三份预设假日志 `PRESET_SCENARIOS` / `SCENARIO_*` 已删除

### 5.2 新增防线：数据来源三态

`ContextWatermark.provenance`：
| 值 | 含义 | UI 呈现 |
| :--- | :--- | :--- |
| `counted` | 来自真实 `message.usage` | `实测 Counted`（emerald） |
| `estimated` | JSONL 无 usage，按字符量启发式粗估 | `估算 Estimated`（amber）+「数值为推算」 |
| `live` | 实时流增量与手势魔数推算 | `实时 Live`（indigo）+「数值为推算」 |

### 5.3 仍在的假数据（显式标注，暂留）

| 位置 | 性质 | 处理口径 |
| :--- | :--- | :--- |
| `src/App.tsx` `defaultMockEvents` | 演示沙盒会话 | 保留；会话列表已分区「演示沙盒」 |
| `src/services/sampleTranscript.ts` | 会话时光机内置样例 | 保留；页面为演示用途 |
| `types/telemetry.ts` `DEFAULT_CONTEXT_WATERMARK` / `BASE_CONTEXT_WATERMARK` | 默认兜底水位 | 保留；JSDoc 已注明非真实数据 |
| `transcriptParser.ts` `systemTokens ? : 12000`、`Math.max(2000, events*300)` | 启发式兜底 | 保留；现已带 `estimated` 标记 |
| `transcriptParser.ts` `totalLimit/maxCapacity` | 已改为按模型解析 | ✅ 2026-11-08 落地：`modelWindows.ts` 本地保守规则表 + 未知模型 `windowSource='default'` 显式兜底 |

### 5.4 模型窗口规则表现状

`src/services/modelWindows.ts` 刻意保持保守，仅收录能核对的模型：

| 规则（小写子串） | 窗口 | 依据 |
| :--- | :--- | :--- |
| `gemini-` | 1,048,576 | Google Gemini 系列 1M 输入窗口 |
| `claude-` | 200,000 | Anthropic Claude 3/4 系 200k |
| `gpt-oss` | 131,072 | OpenAI gpt-oss 系列 128k |
| `deepseek-v4` | 1,048,576 | 本机 Magpie 上下文窗口面板实测 1.05M |

未收录模型（如 `glm-5` / `kimi-k2` / `gpt-5`）一律 `FALLBACK_CONTEXT_WINDOW = 200000` 兜底，UI 显示「窗口未知·按 200k 兜底」。
后续若接入 provider catalog 的真实 `contextWindow`，把规则表换成配置/远端驱动，并给 `windowSource` 增补 `catalog` 一态即可。

---

## 六、实机验证结论（2026-11-08，Playwright + 真实 bridge + 30 真会话）

| 验证项 | 结果 |
| :--- | :--- |
| 首屏是否自动切到真实会话 | ✅ 选中态为真实会话（非 `demo-session`） |
| 水位来源标记 | ✅ 显示 `实测 Counted`（真实 `message.usage`） |
| 模型窗口解析 | ✅ `gemini-3.8-flash` 命中规则 → 约 1.05M 窗口（非 200k） |
| 抽屉七行 + 压缩机会条 + 查看预演 | ✅ 全部就位，浮层三段对照正常 |
| 假修剪按钮 | ✅ 已消失 |
| bridge 真实账 | ✅ `bridge 已折叠 1 条 · 释放 527 字符`（修复相对路径 fetch 后） |
| 页面 JS 错误 | ✅ 0 |

**顺带修掉的坑**：`useWalStats` / `CompactionPreviewOverlay` 曾用相对路径 `fetch('/api/wal')`，dev 下打到 Vite 返回 404 → 静默降级成「bridge 未连接」。现已统一走 `DEFAULT_BRIDGE_HTTP_URL`。
**纪律沉淀**：凡面向 bridge 的新端点一律使用 `DEFAULT_BRIDGE_HTTP_URL`，禁止相对路径 —— 否则会出现"静默降级"（与记忆中「静默降级必须暴露失败原因」同源）。
留档：`openspec/changes/fix-wal-stats-bridge-base-url/`

