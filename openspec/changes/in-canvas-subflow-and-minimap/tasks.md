# Tasks: 原地手风琴展开与鸟瞰小地图落地

- [x] Task 1: 升级 `TurnNode.tsx` 支持原地手风琴展开 (In-Canvas Subflow)，支持折叠与展开状态的动态切换，展开态内嵌渲染高密度子步骤瀑布卡片
- [x] Task 2: 改造 `transcriptParser.ts` 中的 `turnsToFlowNodesAndEdges` 纯函数，支持传入已展开的 `expandedTurnIds: Set<string>` 参数，展开节点自适应增加宽度与间距，后续节点自动向右平移
- [x] Task 3: 在 `App.tsx` 挂载 `@xyflow/react` 的 `<MiniMap />` 组件，定制素雅米白主题与手势语义节点配色，并支持通过开关随时显隐小地图
- [x] Task 4: 在 `App.tsx` 维护 `expandedTurnIds` 状态，打通节点点击展开与批量“全部展开/收起”控制按钮
- [x] Task 5: 验证单元测试与全工程编译无错误

