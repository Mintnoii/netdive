# Tasks: 窗口上限不得小于实际用量

## 1. 纯函数与契约
- [x] 1.1 `src/services/modelWindows.ts` 新增 `effectiveContextWindow(resolved, usedTokens)`，返回 `ContextWindowResolution & { clamped: boolean }`
- [x] 1.2 `src/services/modelWindows.test.ts` 追加 4 条用例（未超 / 超 / 相等 / 0 用量），断言 `source` / `matchedRule` 保持不变
- [x] 1.3 `src/types/telemetry.ts`：`ContextWatermark` 新增 `windowClamped?: boolean`

## 2. 解析层
- [x] 2.1 `src/services/transcriptParser.ts`：组装 watermark 时调用 `effectiveContextWindow`，`totalLimit` / `maxCapacity` / `prompt.window` 统一取 `effective.window`，写入 `windowClamped`
- [x] 2.2 `src/services/transcriptParser.test.ts` 追加 2 条契约用例：未知模型 + 369.8k usage → 撑开且 `windowClamped === true`；已知模型正常用量 → 不撑开

## 3. 展示层
- [x] 3.1 `src/components/ContextInspectorDrawer.tsx`：facts「窗口上限」note 在 `windowClamped` 时显示 `用量已超规则窗口 · 按实际用量撑开`
- [x] 3.2 `src/components/ContextStripBar.tsx`：`windowClamped` 时优先显示同款提示，替代「窗口未知·按 200k 兜底」

## 4. 验证
- [x] 4.1 `pnpm test` 全绿（≥233）
- [x] 4.2 `pnpm build` 零类型报错
- [x] 4.3 实机截图复核无 >100% 占比、无「剩余 0」自相矛盾
- [x] 4.4 Orca worktree 隔离派发 agy，Pi 回验 diff 后合并清理

## 5. 验收断言（Pi 执行）
- `grep -n "effectiveContextWindow" src/services/transcriptParser.ts` ≥1
- `grep -n "windowClamped" src/types/telemetry.ts src/components/ContextInspectorDrawer.tsx src/components/ContextStripBar.tsx` 各 ≥1
- `grep -rn "as any\|@ts-ignore\|as unknown as" <Target 文件>` 零新增

## 6. 派发与回验记录 (2026-11-08)
- worktree：`orca worktree create --name wt-window-clamp --base-branch main`，镜像工作态 + 独立 `pnpm install`，基线 227 pass
- 派发 agy（gemini-3.8-flash-medium, thinking=high）执行 7 文件 spec；**agy 在 45 分钟超时被 kill，但代码已全量落盘且零自报**——按 SOP 以 Pi 侧 `git diff` + 命令实测为准，未判失败也未重派
- Pi 回验：`pnpm build` 零类型报错、`pnpm test` **233 pass / 0 fail**（227 + 6 条新增）、7 个 Target 文件零越界、零 `as any`
- 实机复核（Playwright + 真实 bridge）：`已用 382.8k / 窗口上限 382.8k / 剩余 0`，note 显示「用量已超规则窗口 · 按实际用量撑开」，part 占比最大 88%（原 162% 消失），`has162 = false`
- 合并后清理：关终端 → 删 worktree → 删分支（`git worktree list` 仅剩主仓库）

