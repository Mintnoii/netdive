# 功能留档：上下文窗口上限改为按模型解析，未知模型显式兜底

## 变更描述

上下文窗口上限此前写死 200000（parser 的 totalLimit/maxCapacity、prompt.window，以及两个 UI 组件的 || 200000 / || 128000 盲兜底），导致接 1M 窗口模型（本机实测 siliconflow/deepseek-ai/DeepSeek-V4.1-Flash 显示 1.05M）时占用百分比算错。实测确认会话 JSONL 不含 contextWindow 字段，因此新增本地保守规则表 modelWindows.ts：仅收录 4 条有公开依据的规则（gemini- 1M、claude- 200k、gpt-oss 128k、deepseek-v4 1M），未收录模型一律走 FALLBACK_CONTEXT_WINDOW=200000 并在 UI 显式标注「窗口未知·按 200k 兜底」。ContextWatermark 新增 windowSource 字段贯通解析与展示。

## 涉及文件

- `src/services/modelWindows.ts` — 新建本地保守规则表：FALLBACK_CONTEXT_WINDOW / WindowSource / resolveContextWindow(modelId)，4 条带来源注释的规则 + 未收录走兜底
- `src/services/modelWindows.test.ts` — 新建 7 条用例：无参兜底、deepseek-v4 1M、gemini 1M、claude 200k、未收录兜底、大小写不敏感
- `src/types/telemetry.ts` — ContextWatermark 新增 windowSource?: 'known' | 'default'
- `src/services/transcriptParser.ts` — 两处 watermark 组装点改用 resolveContextWindow(session.modelId) 推导 totalLimit/maxCapacity/prompt.window 并写入 windowSource，消除写死 200000
- `src/components/ContextStripBar.tsx` — 改用 FALLBACK_CONTEXT_WINDOW 兜底常量，windowSource==='default' 时加「窗口未知·按 200k 兜底」小标
- `src/components/ContextInspectorDrawer.tsx` — 同上，并在大盘窗口数值旁追加同款小标
- `src/services/transcriptParser.test.ts` — 把写死 200000 的断言改为对比 resolveContextWindow 结果并断言 windowSource 一致

## 备注

规则表只收录能核对的条目是刻意的保守选择：glm-5 / kimi-k2 / gpt-5 等未核实的窗口一律走兜底并在 UI 标注。后续如接入 Magpie 的 provider catalog（`contextWindow` 字段）或模型 API 的 metadata，可把规则表替换为远端/配置驱动，届时 windowSource 增加 'catalog' 一态即可。
