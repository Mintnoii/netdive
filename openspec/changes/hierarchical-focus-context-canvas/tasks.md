# Tasks: 两级“宏观-微观”双焦交互因果画布落地

- [x] Task 1: 数据层升级：在 `transcriptParser.ts` 实现 `aggregateEventsIntoTurns` 与 `turnsToFlowNodesAndEdges` 纯函数，支持将事件流按 Turn 聚合为宏观复合节点数据契约
- [x] Task 2: 节点层设计：新增或扩展 `TurnNode.tsx` 宏观卡片组件，精美呈现 Turn 序号、思维核心意图、耗时、状态标识与工具汇总芯片 Badge
- [x] Task 3: 视图双模与交互联动：在 `App.tsx` 实现“宏观回合 (Macro Focus)”与“全量流水 (Flat Detail)”双模切换开关，点击宏观 Turn 节点可打开微观深潜抽屉或高亮微观子流
- [x] Task 4: 视口与时间轴自适应：确保 `CanvasViewportController` 与时间轴在宏观模式下以 Turn 为单位平滑居中和步进，彻底杜绝白屏与漂移
- [x] Task 5: 单元测试与端到端编译验收：为 Turn 聚合编写完整单元测试，确保 `pnpm test` 和 `pnpm run build` 全部绿灯通过

