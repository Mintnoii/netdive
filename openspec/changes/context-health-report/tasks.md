# OpenSpec 任务清单：context-health-report

## Phase 1: 纯逻辑层

- [x] `src/services/contextHealthReport.ts`：报告契约 + `buildContextHealthReport` 纯函数
- [x] 会话概览复用 `buildTrendModel`，输出峰值 token、窗口、headroom 与 provenance
- [x] 上下文构成复用 `watermark.prompt.parts`，输出七类占比与最大类
- [x] 压缩机会复用 `analyzeCompactionOpportunities`，带 nodeId 与 WAL 指针
- [x] 前缀稳定性用 `computePrefixHash` 判定，缺失快照时标 `unknown`
- [x] 失败与门禁从断言、状态、gatePayload 聚合
- [x] 重复调用复用 `aggregateConsecutiveToolEvents`
- [x] 建议规则表与 `toMarkdownReport` 序列化

## Phase 2: 单测

- [x] `src/services/contextHealthReport.test.ts`：空会话、水位占比、压缩建议、前缀漂移、失败共振、门禁记录、Markdown 形状

## Phase 3: UI

- [x] `src/components/ContextHealthReportDrawer.tsx`：右侧抽屉、分区渲染、严重级别排序、复制按钮
- [x] `src/App.tsx`：会话面包屑加「复盘诊断」按钮，空会话禁用，抽屉挂载

## Phase 4: 文档与质量门禁

- [x] 更新 `README.md`、`CHANGELOG.md`、`docs/INTERVIEW.md`、`docs/BACKLOG.md`
- [x] `pnpm test`：原有 368 项全绿，新增 5 项报告契约用例通过，合计 373
- [x] `pnpm build`：零类型错误
- [x] 浏览器实测空态禁用、有会话时报告与抽屉可用
