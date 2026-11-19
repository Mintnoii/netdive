# OpenSpec 提案：context-health-report (会话复盘诊断报告)

- **提案代号**：`context-health-report`
- **创建日期**：2026-11-19
- **作者**：qing
- **状态**：`completed`
- **结案日期**：2026-11-19
- **项目目录**：`C:/Users/wangqing/Desktop/netdive`
- **素材源流**：当前对话直接提炼

---

## 1. 背景与问题痛点

首屏改成会话回放后，工具能回答「这次任务发生了什么」，还回答不了「下一步该改什么」。

现有引擎已经算出大量可用信号：七类上下文占比、逐请求 token 水位、微压缩机会、失败指纹与共振、门禁裁决、连续同构调用折叠。这些信号散落在检查器、沙盒和断言引擎里，用户需要自己拼起来才能得出结论。

本次变更把这些信号收敛成一份可导出的诊断报告，让每条建议都带证据 nodeId 和量化收益。

## 2. 变更内容

- 新增纯函数服务 `src/services/contextHealthReport.ts`，输入事件流与水位，输出结构化诊断报告。
- 报告包含会话概览、上下文构成、压缩机会、前缀稳定性、失败与门禁、重复调用、建议清单七块。
- 建议由确定性规则生成，每条带严重级别、证据指针和预期收益。大模型不参与判定。
- 回放页新增「复盘诊断」按钮与右侧抽屉，支持复制 Markdown 报告。
- 产出 Markdown 序列化纯函数，为后续双会话差分复用同一契约。

## 3. 实现方案

### 3.1 单一真源

`buildContextHealthReport(events, watermark, options)` 是唯一报告构造器。输入来自 `rawEvents` 与解析出的水位，不读取全局单例，不写状态，不调用模型。

### 3.2 复用现有引擎

- 会话体量与 headroom 复用 `buildTrendModel`；
- 压缩机会复用 `analyzeCompactionOpportunities`；
- 重复调用复用 `aggregateConsecutiveToolEvents`；
- 前缀稳定性用 `computePrefixHash` 对 `system + tools + memory` 快照做一致性判定；
- 失败与门禁直接读事件上的 `assertion`、`status`、`gatePayload`。

### 3.3 建议规则

规则表扁平声明，命中即产出建议。每条建议结构固定为 `id / severity / title / detail / action / evidence / metrics`。证据只引用事件里真实存在的 nodeId、指针和数值。

### 3.4 UI

抽屉固定在右侧，不挤占画布。顶部放导出按钮，主体按七块分区渲染，建议卡片按严重级别排序。空会话时按钮禁用。

## 4. 涉及 Spec 模块

- `context-health-report` — 新增诊断报告契约与生成规则。

## 5. 新增 Requirement

### Requirement: 结构化复盘诊断报告

系统 SHALL 从回放事件流与上下文水位生成结构化诊断报告，且每条建议 MUST 携带至少一个证据指针。

#### Scenario: 用户打开有事件的会话

- **WHEN** 用户点击「复盘诊断」
- **THEN** 抽屉展示概览、构成、压缩机会、前缀稳定性、失败门禁、重复调用与建议清单

#### Scenario: 会话为空

- **WHEN** 当前回放没有事件
- **THEN** 诊断按钮禁用，抽屉不展示伪造指标

### Requirement: 确定性建议生成

建议 SHALL 由阈值规则生成，禁止调用大模型猜测结论。

#### Scenario: 工具输出超过压缩阈值

- **WHEN** 事件流中存在可折叠工具输出
- **THEN** 报告给出压缩建议，并写出回收字符数与证据 nodeId

#### Scenario: 前缀快照不一致

- **WHEN** 多个水位快照的 system/tools/memory 前缀哈希不同
- **THEN** 报告给出缓存稳定性告警，并列出命中哈希数量

### Requirement: Markdown 导出

报告 SHALL 提供确定性 Markdown 序列化，便于复制到 issue 或评审文档。

#### Scenario: 用户点击复制报告

- **WHEN** 报告抽屉处于打开状态且会话非空
- **THEN** 剪贴板获得与抽屉内容一致的 Markdown 文本

## 6. 非目标

- 不实现双会话差分视图，报告契约只为其预留结构。
- 不调用大模型生成或润色报告正文。
- 不改写 Bridge、断言引擎、微压缩引擎和 Context Lab 的运行时逻辑。
- 不把演练沙盒的假水位当作真实诊断结论。

## 7. 向后兼容性

纯新增模块与 UI 按钮，既有事件契约、画布行为和 API 均不变。

## 8. 涉及文件

- `openspec/changes/context-health-report/*` — 提案、设计与任务清单
- `src/services/contextHealthReport.ts` — 新增报告构造器与 Markdown 序列化
- `src/services/contextHealthReport.test.ts` — 契约与规则单测
- `src/components/ContextHealthReportDrawer.tsx` — 新增诊断抽屉
- `src/App.tsx` — 按钮入口与抽屉挂载
- `README.md` / `CHANGELOG.md` / `docs/INTERVIEW.md` — 文档同步
