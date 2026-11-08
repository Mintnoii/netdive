# 功能留档：压缩 Lab 重新定位为纯沙盒实验台，移除预设假数据堆砌

## 变更描述

真实会话的压缩机会与 bridge WAL 真实账已由「上下文水位明细」抽屉承载后，CompactorLabPage 的预设场景与大段假日志与新面板职责重复且数据不真实，容易让整个面板显得不可信。本次把 Lab 重新定位为纯沙盒实验台：顶部加「沙盒实验台 · 非真实会话数据 · 仅本地试算」横幅与指引文案；删除三份预设假样例（PRESET_SCENARIOS / SCENARIO_*）与其选择器；保留自定义文本输入、四维阈值滑杆、折叠前后对照、本沙盒实例 wal-lab-* WAL 列表与原文回放、Rule 1~4 教学卡与 Rule 4 前缀稳定性试验；全部文案改为沙盒口径（本沙盒试算释放 X 字符）。HeaderNav 的 Lab 页签改名为「压缩沙盒」，徽标改为 Sandbox。经 Orca worktree 隔离派发 agy 实现，Pi 回验 build 绿 + 220 pass / 0 fail 后合并，worktree 与分支已清理。

## 涉及文件

- `src/pages/CompactorLabPage.tsx` — 顶部加沙盒定位横幅与真实面板指引，删除预设场景选择器与相关状态，文案统一改为沙盒口径，保留输入/滑杆/前后对照/WAL 回放/Rule 1~4 教学
- `src/services/compactorLabScenarios.ts` — 删除 PRESET_SCENARIOS 与三段大假日志及假叙事，仅保留 estimateTokens 与简短 SANDBOX_PLACEHOLDER
- `src/pages/CompactorLabPage.test.ts` — 删除预设场景断言，保留 estimateTokens 与 compactToolLines 边界契约，新增沙盒常量化断言
- `src/components/HeaderNav.tsx` — Lab 页签改名「压缩沙盒」，徽标 Lab → Sandbox，title 提示注明非真实会话数据

## 备注

沙盒与真实观测面板的边界现在由 UI 文案显式区分：真实压缩机会看底部「上下文水位明细」抽屉（compaction-opportunity-inspector），沙盒只做本地试算。后续若要给沙盒加「从真实会话导入一条观测」的快捷入口，需要额外打通 events → textarea 的单向拷贝。
