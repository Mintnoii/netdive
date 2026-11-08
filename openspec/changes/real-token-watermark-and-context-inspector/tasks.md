# Tasks: 真实 JSONL 会话 Token 上下文解析与多维上下文水位抽屉面板

## 1. 契约与解析层 (Data Contract & Transcript Parser)
- [x] 1.1 在 `src/types/telemetry.ts` 扩展 `ContextWatermark` 和 `TurnCompoundNode.tokenBreakdown` 类型，补充 `cacheRead`, `reasoningTokens`, `systemPrompt`, `toolOutputs`, `conversationHistory` 等全维上下文契约字段
- [x] 1.2 在 `src/services/transcriptParser.ts` 实现真实 `usage` 提取逻辑：从助手消息的 `message.usage`（input, output, cacheRead, reasoning）及工具输出真实文本尺寸派生真实 Token 负载
- [x] 1.3 改造 `useTelemetryStream.ts` 中的 `extractPrunableItems`，使用节点真实载荷尺寸（真实 stdout 行数/字符数折算），彻底废除 28000/14000/4000 等硬编码常量
- [x] 1.4 在 `src/services/transcriptParser.test.ts` 编写真实 Pi / Claude JSONL 提取契约测试，验证真实 Token 水位无误差提取

## 2. UI 交互与下钻面板重构 (UI & Context Inspector Bottom Sheet)
- [x] 2.1 设计并实现 `src/components/ContextInspectorDrawer.tsx`（Bottom Sheet）：
  - 沿用 NetDive Paper & Ink 纸本浅色视觉语言（与水位条同源配色，不再使用磨砂深色浮窗）；
  - 核心模块一：上下文构成分布（系统基座、对话历史与思考链、工具执行与文件载荷、Prompt Cache 命中比率）；
  - 核心模块二：高耗工具载荷 Top 列表与微压缩预览（联动 `microCompactor` 展示可释放大小）；
  - 核心模块三：一键微压缩/修剪触发入口与断言状态联动。
- [x] 2.2 改造 `src/components/ContextStripBar.tsx`：
  - 点击水位条任意区域直接展开/收起其正上方的明细面板（水位条即锚点，自身常驻页面最底部）；
  - 视觉升级：支持更细腻的色彩渐变与真实比例分布（包括 Cache 命中标识）。
- [x] 2.3 联动 `src/App.tsx` 与主界面：将面板挂载至全局，与当前选中的 Session 真实 Watermark 双向联动。
- [x] 2.4 形态改造（2026-11-08 拍板）：删除 `ContextInspectorModal.tsx` 居中弹窗，新建 `ContextInspectorDrawer.tsx` 底部生长明细面板；
  - 定位纠偏：由 `<main>` 内绝对定位浮层改为流内兄弟节点，渲染顺序 `画布 → 明细面板 → 水位条`，水位条钉在页面最底部作为锚点，无遮罩、无画布覆盖；
  - 默认只展示水位条 + 概述行，点击后 `drawer-grow-up` 关键帧从高度 0 长到 `46vh`（`max-h-[560px]`），画布同步压缩；把手/底部收起/Esc 三重收起；
  - 片段页签四选一双向联动，下方明细区按片段切换展示真实细节；
  - 动效由 `src/index.css` 原生 `drawer-grow-up` 关键帧提供（不依赖 tailwindcss-animate 插件），未使用的旧 keyframes 已清理；
  - 单测与 `pnpm test` 脚本同步重命名为 `src/components/ContextInspectorDrawer.test.ts`。
- [x] 2.5 第三次定位纠偏（Orca + agy 派发落地）：流内纵向生长会顶飞 `StateTimelineScrubber` 播放控制与进度条，改回 `fixed inset-x-0 bottom-0 z-50` 悬浮 Sheet + `fixed inset-0 z-40` 轻遮罩；
  - 挂载点迁移至页面根容器最后一个子节点，`<main>` / `StateTimelineScrubber` / `ContextStripBar` 的 JSX 结构、class 与渲染顺序保持零改动；
  - 动画替换为 `drawer-sheet-up`（translateY）与 `drawer-fade-in`，删除 `drawer-grow-up`；
  - 抽屉内新增锚点水位色谱带（四段可点，`SEGMENT_STYLE.barColor` 查表着色，Cache 段用 `#D97706` 与工具段区分）；
  - 派发链路：`orca worktree create --name wt-ctx-sheet` → 镜像当前工作态 → 独立 `pnpm install` → spec 五要素派发 agy（gemini-3.8-flash-medium）→ Pi 侧 `git diff` + `pnpm test`(204/0) + `pnpm build` 回验 → 三文件合并回主仓库 → 关终端/删 worktree/删分支。

## 3. 验证与门禁检查 (Verification & Quality Gate)
- [x] 3.1 运行 `pnpm test`，确保全部单测通过（189+ pass，0 fail -> 204 pass，0 fail）
- [x] 3.2 运行 `pnpm build`，确保 TypeScript 编译通过且零类型报错
- [x] 3.3 整理变更摘要，出示用户拍板与 Git 提交建议
- [x] 2.6 第四次纠偏（Orca + agy 派发落地）：内容驱动高度导致切片段面板跳动，改为恒定高度 + 四片段并排；
  - 面板锁定 `h-[min(56vh,560px)]`，删除 `activeSegment` 页签与可点击色谱带，仅保留纯展示迷你色谱条；
  - 主体 `grid grid-cols-4` 四列并排（system / dialogue / tools / cache），列头带 Token 与占比，列体独立滚动；
  - 新增 `focusedItemId` 状态：null 为四列概览，非 null 为「原始输出 ↔ 微压缩」左右对照视图，两者高度恒定；
  - 派发链路：`orca worktree create --name wt-ctx-grid` → 镜像工作态 → 独立 `pnpm install` → spec 五要素派发 agy（gemini-3.8-flash-medium，thinking=high）→ Pi 回验 8 条验收（build/test/6 条 grep/越界检查）全过 → 单文件合并 → 关终端/删 worktree/删分支。
