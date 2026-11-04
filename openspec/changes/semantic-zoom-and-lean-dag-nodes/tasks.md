# Implementation Tasks: semantic-zoom-and-lean-dag-nodes

- [x] Task 1: 瘦节点数据契约升级 (`src/services/transcriptParser.ts` & `src/components/AgentNode.tsx`)
  - 精简 `AgentNodeData` 契约，移除节点中非必要的巨型 payload/observation 深层嵌套；
  - 改造 `eventsToFlowNodesAndEdges` 纯函数，确保生成的 React Flow 节点仅承载精炼视图字段与轻量摘要。
- [x] Task 2: 详情抽屉按需 JIT 检索解耦 (`src/App.tsx`)
  - 在 `src/App.tsx` 中建立 `eventsMap` 映射表，确保在点击节点时通过 `nodeId` 即时还原完整 `TelemetryEvent` 并传递给详情抽屉，保证数据无损。
- [x] Task 3: 废除全量平铺视图硬分页切片 (`src/App.tsx`)
  - 清理 `windowNodes` / `windowEdges` 中的硬切片逻辑，让全量平铺视图与微观下钻一样享有完整的因果连续拓扑；
  - 确保跨行网格中上下游连线完整连通。
- [x] Task 4: 语义缩放层级渲染与屏幕空间恒定字号补偿 (`src/components/AgentNode.tsx` & `src/services/agentNodeLOD.ts`)
  - 引入 React Flow 的 `useStore(s => s.transform[2])` 获取当前视口 Zoom 缩放倍率；
  - 当 `zoom < 0.45` 时，渲染紧凑色块胶囊 (Compact Pill)；
  - 引入屏幕空间恒定字号反向缩放补偿（Screen-Space Inverse Scaling）：计算 `scaleFactor = Math.min(2.2, 1 / zoom)`，保持关键地标在视网膜上稳定在 12px~13px 清晰易读尺寸；
  - 提取更精炼醒目的 Landmark 地标标签（文件提取清晰文件名，命令提取 $ 命令首词，轮询提取 ⚡ 轮询 xN，异常提取 ❌ 报错）；
  - 支持 hover 时以 `1 / zoom` 抵消画布缩放，以 1:1 正常视口尺寸浮现高密度概要气泡卡片；
  - 严格保持 Handle 连线桩位置严谨对齐，防止因果连接线错位。
- [x] Task 5: 全量单测回归与构建验收
  - 新增 `src/components/AgentNode.test.ts` 契约单测（27 个子用例，全覆盖缩放补偿与地标提取）；
  - 运行 `pnpm test`（174 Tests 全部通过）与 `pnpm build`，确保 100% 绿灯无警告通过。
