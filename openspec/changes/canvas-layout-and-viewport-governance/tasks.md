# Tasks: 画布排版、视口跟焦与折叠交互落地

- [x] Task 1: 移除 `AgentNode.tsx` 中的 Hover 悬浮上下文弹窗及多余定时器逻辑
- [x] Task 2: 改造 `transcriptParser.ts` 中的 `eventsToFlowNodesAndEdges` 布局算法，支持多行蛇形/网格流式排版（Row-Wrapped Grid Layout），解决一字长蛇阵空间浪费
- [x] Task 3: 治理 `App.tsx` 中的同构折叠状态模型，以 `rawEvents` 为单一真理源，`isFoldingEnabled` 动态驱动图结构响应与即时重算
- [x] Task 4: 封装 `CanvasViewportController` 挂载到 `ReactFlow` 内部，在首屏加载、翻页切换、时间轴拖动以及折叠切换时自动跟焦与 `fitView`，根除白屏与视口飘走
- [x] Task 5: 验证全量单元测试与编译，自检无回归
