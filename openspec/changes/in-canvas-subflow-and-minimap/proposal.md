# Proposal: 实施同画布原地手风琴展开 (In-Canvas SubFlow) 与高审美鸟瞰小地图 (MiniMap)

## 1. 痛点背景与动机 (Problem Statement)
当前 NetDive 虽然实现了宏观回合与微观流水的分层抽象，但在交互体验上仍有两大缺憾：
1. **脱离画布体验打断（跳出感）**：微观细节完全依赖右侧滑出抽屉查看，用户无法在同一个画布视野内直观对比多个回合的内部执行流（In-Canvas Visual Cohesion）；
2. **缺乏全景鸟瞰感知（缺少小地图）**：长链路执行流在大画布缩放与拖拽时，用户无法快速感知当前可视视口在全局 DAG 中的相对位置，缺少现代流程图必备的 MiniMap 导航。

## 2. 核心架构与模式设计 (Architecture Design)

### 2.1 原地弹性手风琴卡片 (In-Canvas Accordion Turn Container)
- 将 `TurnNode.tsx` 改造为支持原地展开/收起的弹性容器：
  - **默认折叠态 (Collapsed)**：紧凑卡片（宽 ~320px），展示 Turn 序号、思维核心、耗时、状态指示与紧凑工具 Badge，右上角提供醒目的 `展开步骤 ▼` 按钮；
  - **展开态 (Expanded / In-Canvas Subflow)**：节点平滑撑高撑宽（宽 ~420px~500px），卡片主体直接内嵌渲染本回合的 **微观执行流水线 (Micro Step Flow)**（显示子步骤序号、手势类型、参数摘要、断言状态与耗时）；
  - **动态排版自适应**：展开/折叠时，更新当前展开 Turn ID 集合，`turnsToFlowNodesAndEdges` 依据每个节点的实际计算宽度自适应平移后续节点位置，连线平滑过渡；
- 用户可以随时点击任意 Turn 展开，亦可点击“全部展开 / 全部收起”，宏观与微观在同一个画布内浑然一体。

### 2.2 挂载素雅风格鸟瞰小地图 (Integrated MiniMap)
- 在 React Flow 画布中引入 `@xyflow/react` 原生的 `<MiniMap />` 组件；
- 遵循 NetDive 的素雅米白暖色系（Warm Minimalist）：
  - 背景：`#FAF8F5`，边框：`#E5E0D8`，圆角阴影微质感；
  - 节点颜色（`nodeColor`）按动作手势语义着色（如 bash `#1E2024`，read `#4F46E5`，edit `#D97706`，gate `#E11D48`）；
  - 视口遮罩（Viewport Mask）：半透明淡琥珀色，支持直接拖拽导航，全景视野尽在掌握。

## 3. 验收标准 (Acceptance Criteria)
- [x] Turn 节点具备原生原地展开/收拢能力，展开后在卡片内部完整渲染微观子步骤链；
- [x] 展开/收起时后续 Turn 节点坐标自适应平移，连线平滑不重叠；
- [x] 画布右下角（或视口合适位置）成功挂载素雅风格的 MiniMap，准确投射所有节点并在拖拽时无缝漫游；
- [x] 所有单元测试保持 100% 通过，`pnpm run build` 成功。
