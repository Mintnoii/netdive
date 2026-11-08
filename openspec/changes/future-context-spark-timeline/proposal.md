# Proposal: 上下文体量 Spark 时间轴 (Context Prompt Spark Timeline)

> 状态：**未排期特性（deferred）**。本档为立项占位与设计预研，不含实施任务。

## 1. 痛点
当前上下文观测只呈现「此刻的窗口占用」。真实排障与成本判断需要的是**趋势**：这个会话的 prompt 是怎么一轮一轮长起来的、哪一步让它跳变、还剩多少轮会撞到窗口上限。

## 2. 参考实现（已读源码）
`yetone/magpie` `internal/gui/assets/context.js` 的 `spark(series, at, window, onPoint)`：
- 输入是会话内**每次请求的 prompt 体量表** `[{ id, tokens, time }]`；
- 纵轴缩放取会话峰值（若接近窗口则把窗口线画出来），画面积 + 折线；
- 当前这一次请求用圆点标记，其余点作为 svg 命中区，**点击任意点切到那次请求的上下文窗口**；
- `headroom(series, free)`：按相邻请求的增量中位数推算「还能塞下几个这样的请求」。

## 3. 设计要点
- 数据源：`TranscriptParser` 需为每个 assistant 消息保留 `usage.input`（现在只保留最后一次），形成 `promptSeries: Array<{ nodeId, tokens, timestamp }>`；
- 组件：`ContextSparkTimeline.tsx`，纯 SVG（不引第三方图表库），宽高自适应；
- 交互：点选某点 → 抽屉切换到该请求时刻的 `ContextPrompt`（需要 parser 支持按事件回溯水位，或用已存的事件级 usage 复算）；
- 展示：底部水位条右侧显示 `headroom`（「按当前增速还可容纳 ~N 次请求」），撞线时转琥珀色。

## 4. 验收草案
- [ ] `promptSeries` 长度与真实 assistant 消息数一致，`tokens` 与 `usage.input` 逐条对齐
- [ ] 点击 spark 任一点，抽屉展示该请求的 7-part 档位（可验证窗口占用百分比随点变化）
- [ ] `headroom` 在增量恒定时给出的估计值与手算一致
- [ ] `pnpm test` 全绿，新增 spark 几何纯函数单测

## 5. 依赖与风险
- 依赖：parser 事件级 usage 留存（改动面中等）
- 风险：历史会话可能缺 `usage`，需按 `provenance='estimated'` 降级并明示

## 6. 关联
- 当前观测面板：`openspec/changes/context-blocks-content-inspector/`
- 台账：`docs/BACKLOG.md` 第三节
