# Proposal: 窗口上限不得小于实际用量（Magpie scale 不变量）

## 1. 问题
实机截图（未知模型会话）暴露自相矛盾的数字：

```
已用 369.8k / 窗口上限 200k / 剩余 0
健康度「紧张」· 读入的文件「占窗口 162%」
```

根因：`resolveContextWindow()` 对未收录模型返回 `FALLBACK_CONTEXT_WINDOW = 200000`，而该会话真实 `usage.input` 已达 369.8k。窗口兜底值比实际 prompt 还小，于是：
- `usagePercent = min(100, 369.8/200) = 100%` 被截断；
- `remainingTokens = max(0, 200-369.8) = 0`；
- 各 part 按 `tokens / window` 算出 162% 这类超过 100% 的荒谬占比；
- Treemap 的 `freeTokens` 为 0，剩余空间块消失。

## 2. 参考实现
`yetone/magpie` `internal/gui/assets/context.js` 的 `cellsOf`：

```js
const scale = Math.max(window, p.tokens, 1);
const used = Math.min(CELLS, Math.round((p.tokens / scale) * CELLS));
```

以及 `tilesOf` 里同样的 `const scale = Math.max(window, p.tokens, 1)`。即**窗口未知/过小/被 overrrun 时，一律按 prompt 实际体积作为绘图尺度**，绝不让分母小于分子。

## 3. 设计

### 3.1 纯函数（`src/services/modelWindows.ts`）
```ts
export function effectiveContextWindow(
  resolved: ContextWindowResolution,
  usedTokens: number
): ContextWindowResolution & { clamped: boolean }
```
- `usedTokens <= resolved.window` → 原样返回 + `clamped: false`
- `usedTokens > resolved.window` → `{ ...resolved, window: usedTokens, clamped: true }`
- 不改 `source` / `matchedRule`（模型判定来源仍为真）

### 3.2 数据契约（`src/types/telemetry.ts`）
`ContextWatermark` 新增 `windowClamped?: boolean`（中文 JSDoc：窗口兜底值小于实际用量时按用量撑开，非模型真实窗口）。

### 3.3 解析层（`src/services/transcriptParser.ts`）
组装 watermark 时：
```ts
const effective = effectiveContextWindow(resolvedWindow, totalTokens)
```
`totalLimit` / `maxCapacity` / `prompt.window` 一律取 `effective.window`，并写入 `windowClamped: effective.clamped`。

### 3.4 展示层
- 抽屉 facts「窗口上限」note：`windowClamped` 时显示 `用量已超规则窗口 · 按实际用量撑开`，否则沿用现有 `模型规则表判定` / `未知模型 · 按 200k 兜底`；
- 底部水位条同样在 `windowClamped` 时优先显示该提示，替代「窗口未知·按 200k 兜底」；
- 不改动任何交互与面板高度。

## 4. 不变量（验收核心）
- `watermark.maxCapacity >= watermark.total` 恒成立；
- `prompt.window === watermark.maxCapacity` 恒成立；
- 所有 part 的 `tokens / prompt.window <= 1`，UI 不再出现 >100% 占比；
- `prompt.tokens === watermark.total`，且 `Σ parts.tokens === watermark.total` 不受影响；
- 已知模型且用量未超窗口时，`windowClamped` 为 `false`，行为与现在完全一致（零回归）。

## 5. 验收
- [ ] `effectiveContextWindow` 纯函数单测（未超 / 超 / 相等 / 0 用量）
- [ ] parser 契约单测：未知模型 + 大 usage → `maxCapacity === total`、`windowClamped === true`、`prompt.window === maxCapacity`；已知模型正常会话 → `windowClamped` 未设置或 false
- [ ] `pnpm test` 全绿、`pnpm build` 零类型报错
- [ ] 实机截图复核：不再出现「占窗口 >100%」与「剩余 0」自相矛盾

## 6. 素材源流
- `yetone/magpie` `internal/gui/assets/context.js`（`cellsOf` / `tilesOf` 的 `scale = max(window, tokens, 1)`）
- 本次实机截图：`C:/Users/wangqing/AppData/Local/Temp/netdive-facts-aligned.png`
