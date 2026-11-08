# 功能留档：水位数据来源三态标注，清除零引用死 mock

## 变更描述

项目里仍存在两类别「不像真的却是真的」数据：一是假 mock（DEFAULT_PRUNABLE_ITEMS 全仓零引用属死代码；defaultMockEvents 演示会话；sampleTranscript 内置样例），二是启发式估算（JSONL 无 usage 时 systemPrompt 兜底 12000、activeTurns 按 events*300、实时流手势魔数 3500/12000/16000）。本次先做两件事：(1) 删除零引用的死 mock DEFAULT_PRUNABLE_ITEMS 及其契约测试；(2) 给 ContextWatermark 增加 provenance 三态（counted 来自真实 usage / estimated 启发式粗估 / live 实时流推算），并在底部水位条与上下文明细抽屉两处 UI 以同款扁平字典徽标显式标注来源，estimated 与 live 时追加克制的「推算值 / 数值为推算」小字，彻底消除「估算值看起来像实测值」的误导。

## 涉及文件

- `src/types/telemetry.ts` — 删除零引用的 DEFAULT_PRUNABLE_ITEMS 死 mock；ContextWatermark 与 TurnTokenBreakdown 新增 provenance 三态字段；两个默认水位常量的 JSDoc 补充「默认兜底值、非真实会话数据」
- `src/services/transcriptParser.ts` — 两处 watermark/tokenBreakdown 组装点按是否存在 lastUsage 写入 counted / estimated，启发式魔数位补来源注释但不改数值
- `src/hooks/useTelemetryStream.ts` — 实时流增量推算路径写入 provenance: 'live'，且不覆盖已解析会话的 counted/estimated；getDynamicWatermarkDelta 补 JSDoc 注明为启发式估算
- `src/components/ContextStripBar.tsx` — 水位标题行渲染来源徽标（扁平字典三态），estimated/live 追加「数值为推算」小字
- `src/components/ContextInspectorDrawer.tsx` — 大盘头部行渲染同款来源徽标，「已用 x% · 剩余 y」在推算态追加「· 推算值」
- `src/server/bridge.test.ts` — 删除死 mock 的契约测试；新增来源三态断言（带 usage 的 JSONL → counted，内置样例无 usage → estimated）

## 备注

仍未处理的假数据：defaultMockEvents（演示沙盒会话，已在会话列表显式分区）、sampleTranscript（会话时光机默认样例）、DEFAULT_CONTEXT_WATERMARK / BASE_CONTEXT_WATERMARK（默认兜底魔数）、totalLimit/maxCapacity 写死 200000（应随模型 catalog 的 contextWindow 取）。下一轮候选：给演示沙盒加更显眼的 demo 水印、把窗口上限改成按模型解析。
