# Proposal: 沙盒一键导入真实观测（真实会话 → 压缩沙盒）

> 状态：**未排期特性（deferred）**。

## 1. 痛点
压缩沙盒现在只能粘贴自定文本试压缩。想验证「这条真实的大输出按新阈值会折成什么样」，用户得先在抽屉里找到它、复制原文、切到沙盒、粘贴 —— 三步纯手工搬运。

## 2. 设计要点
- 在抽屉的压缩机会预演浮层（`CompactionPreviewOverlay`）每条候选上加一个「在沙盒中试算」按钮；
- 点击后：切到「压缩沙盒」页签，把该条原文注入 textarea，并把阈值滑杆同步为当前面板口径，然后自动跑一次折叠；
- 单向数据流（真实 → 沙盒），**沙盒的试算结果绝不回写真实会话**，符合现有沙盒定位；
- 跨越页签的状态传递用最小契约（`{ text, options, source: 'live-observation', nodeId }`），禁止把整棵画布状态搬过去。

## 3. 验收草案
- [ ] 从浮层点「在沙盒中试算」后，沙盒页出现原文与折叠结果
- [ ] 沙盒页显示来源标记 `来自真实观测 · {nodeId}`
- [ ] 沙盒操作不产生任何 WAL 之外的副作用，真实会话水位不变

## 4. 关联
- `openspec/changes/compactor-lab-sandbox-repositioning/`
- `openspec/changes/compaction-opportunity-inspector/`
