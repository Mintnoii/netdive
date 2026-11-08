# Proposal: 演示沙盒数据的显式 demo 水印

> 状态：**未排期特性（deferred）**。

## 1. 痛点
项目里仍有三处非真实数据：`App.tsx` 的 `defaultMockEvents`（演示沙盒会话）、`sampleTranscript.ts`（会话时光机内置样例）、`DEFAULT_CONTEXT_WATERMARK` / `BASE_CONTEXT_WATERMARK`（兜底常量）。它们都已在会话列表分区或 JSDoc 里标注过，但从画布上看不出来 —— 截图给别人看时，对方无法分辨这是真会话还是样板。

## 2. 设计要点
- 演示会话在**画布区域**加一条轻量横幅或角标：`演示沙盒 · 非真实会话数据`；
- 会话时光机加载内置样例时，在工具栏显示 `样例数据` 徽标；
- 凡是 `provenance !== 'counted'` 的水位，色条加浅斜纹底（与 Treemap 的 free 瓦片视觉语言一致），一眼可辨"这是推演值"；
- 全部标注走同一份扁平字典，避免各处文案不一致。

## 3. 验收草案
- [ ] 演示会话的画布上必然出现 demo 标识（可断言 DOM 存在固定文案）
- [ ] 样例数据徽标仅在内置样例加载时出现，加载真实会话后消失
- [ ] 估算水位色条呈现斜纹，`counted` 水位无斜纹

## 4. 关联
- `docs/BACKLOG.md` 5.3
- `openspec/changes/watermark-provenance-and-dead-mock-cleanup/`（三态来源标记是其前置）
