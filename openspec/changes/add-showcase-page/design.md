# Design: Showcase 独立演示页面架构设计

## 1. 架构与数据流
- **数据源**：`src/fixtures/showcaseSessions.ts` 导出静态的 `ShowcaseScenario[]`，包含原始 JSONL / 事件流、场景元数据（背景痛点、核心指标）及预置断言；
- **解析管道**：复用 `src/services/transcriptParser.ts`，将事件流转换为规范的 React Flow DAG 节点与因果连线；
- **时光机控制器**：内置虚拟时间轴，支持 Play / Pause / 步进 / 拖拽 Scrubber，逐步释放事件并驱动画布增长；
- **模拟门禁交互**：当事件流推进至 `gate` 节点时，自动触发琥珀金高亮并弹出门禁抽屉，允许用户点击“放行”或“注入指令”。

## 2. 路由与导航契约
- 页面组件：`src/pages/ShowcasePage.tsx`
- 顶层 HeaderNav：`StudioTab` 扩展为 `'live' | 'lab' | 'showcase'`
- 路由挂载：支持 URL hash（`#showcase`）与 path（`/showcase`），在任何静态托管服务上直接刷新均不白屏。
