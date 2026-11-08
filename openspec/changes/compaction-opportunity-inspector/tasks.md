# Tasks: 遥测副本压缩机会剖析与真实对账

> 边界：**不做真实上下文压缩**（Agent 侧介入属暂缓，见 `docs/BACKLOG.md`）。只在遥测副本层做剖析、预演与对账，并清掉误导性假动作。

## 1. 服务层 (Service Layer)
- [x] 1.1 新建 `src/services/compactionOpportunities.ts`：`CompactionOpportunity` 契约 + `analyzeCompactionOpportunities(events, options?)` 纯函数
  - 判定走 `isCompactionNeeded`（>40 行 或 >1500 字符），折叠走 `compactToolLines`，标记走 `formatCompactFoldMarker`
  - **严禁调用 `compactToolOutput`**（会写 WAL，剖析必须零副作用）
  - 透出 `pointerId` / `compactSummary`（来自事件 already-wal 折叠信息）
  - 输出按 `reclaimedChars` 降序，并汇总 `scannedCount / hitCount / totalRawChars / totalReclaimedChars`
- [x] 1.2 新建 `src/services/compactionOpportunities.test.ts`：≥6 条用例
  - 阈值边界（40 行 / 1500 字符不触发、41 行触发、1501 字符触发）
  - 零副作用：调用前后 `microCompactor.getWalStats().totalEntries` 不变
  - 折叠结果结构：`headLines.length <= 15`、`tailLines.length <= 15`、`foldMarker` 含「原始输出已折叠」
  - 排序与汇总正确
  - 已有 `pointerId` 的事件会被透出且仍参与统计
  - 空输入返回零值汇总
- [x] 1.3 `package.json`：`test` 脚本追加 `src/services/compactionOpportunities.test.ts`

## 2. UI 层 (UI Layer)
- [x] 2.1 新建 `src/hooks/useWalStats.ts`：抽屉打开时 `GET /api/wal` 拉 `stats`；bridge 离线返回 `null`；用 `radash.tryit` 包裹，导出 `{ stats, isLoading, isOffline, refresh }`
- [x] 2.2 新建 `src/components/CompactionPreviewOverlay.tsx`：
  - props：`{ isOpen, opportunities, totalRawChars, totalReclaimedChars, walStats, onClose }`
  - 左侧候选列表（工具名 + 行数 + 字符 + 释放字符/百分比 + 已折叠标记），右侧三段对照（头部 15 行 / 折叠标记 / 尾部 15 行，等宽 pre 可滚动）
  - 已带 `pointerId` 的条目提供「回放原文」按钮（`GET /api/wal/:pointerId/replay`，用 `tryit` 包裹，失败显示降级文案）
  - Esc 关闭，`z-[60]`，Paper & Ink 浅色
- [x] 2.3 `ContextInspectorDrawer` 接入：在 7 个 part 概要行下方新增压缩机会摘要条
  - 左：`可折叠 N 条 · 预计释放 X 字符`；右：真实账 `bridge 已折叠 M 条 · 释放 Y 字符`（离线时显示「bridge 未连接，仅显示推演账」）
  - 「查看预演」按钮打开 `CompactionPreviewOverlay`
  - 面板高度保持 `h-[min(66vh,640px)]` 恒定

## 3. 假动作清理 (Debt Cleanup)
- [x] 3.1 `src/hooks/useTelemetryStream.ts`：`pruneContext` 删除硬编码 `|| 42000` 与 `watermark.prunableTools = 4000` 的假状态篡改；改为只记录「本次会话内推演」的真实统计（或直接移除该能力，由真实 WAL 账替代）
- [x] 3.2 `src/components/ContextStripBar.tsx`：底部「修剪冗余上下文」按钮改为真实账展示（不再声称执行了修剪），保留 `onInspect`
- [x] 3.3 `src/components/ContextTextOverlay.tsx`：「微压缩」tab 改名为「压缩预览（只读）」，并在展开时标注「不影响会话，仅本地预览」

## 4. 验证与门禁 (Verification)
- [x] 4.1 `pnpm test` 全部通过（含新增剖析器用例）
- [x] 4.2 `pnpm build` 零类型报错
- [x] 4.3 Orca worktree 隔离派发 agy；Pi 回验 `git diff` + 验收命令后合并，清理 worktree

## 5. 验证断言（Pi 执行）
- `grep -rn "|| 42000" src/` 必须零命中
- `grep -rn "prunableTools: 4000\|prunableTools: targetPrunable" src/` 必须零命中
- `grep -n "compactToolLines" src/services/compactionOpportunities.ts` ≥1 命中
- `grep -n "compactToolOutput" src/services/compactionOpportunities.ts` 必须零命中
- `grep -n "压缩预览（只读）" src/components/ContextTextOverlay.tsx` ≥1 命中

## 6. 派发与回验记录 (Dispatch Log)
- worktree：`orca worktree create --name wt-compact-opp --base-branch main`，镜像工作态（含 `docs/BACKLOG.md` 与本变更档）+ 独立 `pnpm install`，基线 212 pass
- Task A（服务层）：agy 派发 `compactionOpportunities.ts` + 测试 + package.json → 8 条用例，220 pass；`compactToolOutput` 零命中（零副作用成立）
- Task B（UI + 清债）：agy 派发 7 文件 → Pi 回验发现两处编译问题（未使用的 `prunableItems` prop），Pi 侧删除该 prop 与 `App` 侧传参后 build 绿
- 合并后主仓库复验：`pnpm build` 零类型报错，`pnpm test` **220 pass / 0 fail**，`grep -rn "pruneContext" src/` 零命中
- 清理：关终端 → 删 worktree → 删分支（`git worktree list` 仅剩主仓库）
- 遗留（下一轮处理）：`src/components/PrunableInspectorDrawer.tsx` 未被任何 UI 挂载，但内部仍保留 `isPruned ? 42000 : ...` 假默认值，且仅被 `bridge.test.ts` 的导出冒烟测试引用 —— 属死代码，建议删除并同步删掉该冒烟断言
