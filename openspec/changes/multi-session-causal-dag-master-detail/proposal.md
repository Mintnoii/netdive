# 功能留档：NetDive 多会话隔离、因果 DAG 自动建链与 Master-Detail 工作台重构

## 变更描述

升级 NetDive 可观测性架构：确立以真实任务会话（Session/Trace）为唯一真理源，支持单会话跨多 Agent 协作；引入 OpenTelemetry 标准 Active Span 时序因果建链消灭孤岛卡片；并将前端布局重构为左侧可折叠会话列表 + 中间 DAG 画布 + 右侧审查抽屉的专业生产级工作台。

## 涉及文件

- `src/types/telemetry.ts` — 扩展 SessionMetadata、SessionState 契约及 sessionId/traceId 归一化提取函数
- `src/hooks/useTelemetryStream.ts` — 实现按 Session 隔离的状态管理与 OpenTelemetry 标准因果拓扑建链算法
- `src/components/SessionListSidebar.tsx` — 新增左侧可折叠会话列表组件，展示会话状态、协同 Agent 与步数统计
- `src/App.tsx` — 重构页面为左中右专业 Master-Detail 布局，集成会话列表与沉浸画布切换

## 备注

方案遵循 OpenTelemetry GenAI 语义规范与 Ghost 知识库《Agent 可观测性全解：Run、Trace、Thread》理论；编码落地由 Orca 编排 Claude Worker 独立闭环完成。
