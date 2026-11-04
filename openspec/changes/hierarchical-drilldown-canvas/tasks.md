# Tasks: 层级下钻画布与面包屑导航落地

- [x] Task 1: 改造 `TurnNode.tsx`：清除内部内嵌文本列表逻辑，卡片回归高颜值紧凑设计，提供醒目的 `查看步骤拓扑 ➔` 按钮，绑定双击与点击下钻交互
- [x] Task 2: 在 `transcriptParser.ts` 确保能够提取任意 `MacroTurnGroup` 内部独立的微观 Flow 节点与因果连线（`turnEventsToSubflowNodesAndEdges`）
- [x] Task 3: 在 `App.tsx` 引入 `activeDrilldownTurnId: string | null` 状态，实现下钻模式切换：当选中某个 Turn 时，画布平滑切换并独享展示该 Turn 的微观因果 DAG
- [x] Task 4: 实现高审美悬浮面包屑组件（Breadcrumbs Navigation），支持 `🏠 全部回合 (N) / Turn #K` 一键返回、`Esc` 快捷键返回，以及 `◀ / ▶` 跨回合轮播穿梭
- [x] Task 5: 验证全量单元测试与构建编译无错误
