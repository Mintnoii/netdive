# Design: context-health-report

## Context

NetDive 已经能从本地 JSONL 还原因果 DAG、上下文水位、压缩机会、失败指纹与门禁记录。这些信息目前分散在底部检查器、算法沙盒和断言引擎里，回放用户需要跨面板手工拼结论。项目缺一个把观测数据转成行动项的收口层。

## Goals / Non-Goals

- Goals
  - 把现有确定性信号收敛为一份结构化报告。
  - 每条建议带证据 nodeId、数值和可执行动作。
  - 报告构造与 Markdown 序列化都是纯函数，便于后续做双会话差分。
- Non-Goals
  - 不接大模型生成建议。
  - 不实现双会话对比 UI。
  - 不修改现有引擎的运行时行为。

## Decisions

### D1 报告构造器放在 services，不放组件

- 方案：`buildContextHealthReport(events, watermark, options)` 作为纯函数落在 `src/services/contextHealthReport.ts`。
- 备选：在抽屉组件里用 `useMemo` 直接算。
- 理由：组件内计算无法复用，双会话差分和 Markdown 导出都会被迫重写。纯函数可以独立测试。

### D2 建议由阈值规则生成

- 方案：压缩阈值、水位占比、前缀哈希数量、失败指纹次数、聚合调用次数各自对应一条规则。
- 备选：把事件流交给大模型自由总结。
- 理由：面试官会追问结论来源。规则加阈值加证据指针可以逐条回查，模型总结无法保证这点。

### D3 前缀稳定性从水位快照推导

- 方案：取事件上 `watermark.prompt` 的 system、tools、memory 三类 items 拼规范串，用 `computePrefixHash` 算哈希集合。
- 备选：读取真实 API 请求的 cacheRead 字段。
- 理由：本地回放事件里不一定有 cacheRead，水位快照是现有契约里稳定存在的证据源。没有 prompt 快照时报告标注 `unknown`。

### D4 抽屉独立挂载，不并入 Context Inspector

- 方案：右侧抽屉，由会话面包屑上的「复盘诊断」按钮开关。
- 备选：塞进底部水位检查器的一个新 Tab。
- 理由：水位检查器已经很密，右侧抽屉能并列打开，对照画布节点看证据更顺手。

## 数据流

```text
rawEvents + watermark
        ↓
buildContextHealthReport
        ├─ buildTrendModel        会话概览与 headroom
        ├─ analyzeCompactionOpportunities  压缩机会
        ├─ aggregateConsecutiveToolEvents  重复调用
        ├─ computePrefixHash      前缀稳定性
        └─ 事件断言 / 状态 / 门禁   失败与治理
        ↓
ContextHealthReport
        ↓
ContextHealthReportDrawer ⇄ toMarkdownReport
```
