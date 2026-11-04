# OpenSpec Proposal: semantic-zoom-and-lean-dag-nodes

## 1. 核心背景与痛点 (Context & Problem Statement)
NetDive 在长程 Agent 会话拓扑（全量平铺流水 Flat Trace 与巨型微观下钻回合）中面临两大性能与可用性痛点：
1. **硬截断切片破坏因果主干 (Broken Causal Links via Hard Slice)**：
   在 `src/App.tsx` 的全量平铺流水中，曾为了规避长列表卡顿引入了 `WINDOW_SIZE = 50` 的硬切片逻辑。当步骤超过 50 时，滑动视口直接将跨窗口边界（例如第 50 步连接至第 51 步）的因果连线（DAG Edge）当场斩断，用户必须频繁切换步长且无法纵览完整因果主干。
2. **节点卡片数据膨胀引发渲染迟钝 (Heavy Node ViewModel)**：
   当前 `eventsToFlowNodesAndEdges` 将完整的 `payload`（入参大对象）、`observation`（数百行标准输出）、`subCalls`（子调用明细）全部打包塞入了 React Flow 的 `node.data` 中。导致画布平移与缩放（Pan/Zoom）时触发巨型对象数的深层对比与 DOM 负担，内存占用居高不下。

## 2. 架构设计与解决方案 (Design & Solution)

### 2.1 节点数据契约瘦身与按需懒加载 (Lean Node ViewModel & JIT Lookup)
- **数据结构瘦身**：将 React Flow `node.data`（`AgentNodeData`）精炼为轻量视图模型（Lean ViewModel）：仅保留渲染所需的元信息：`nodeId`, `gesture`, `title`, `summary` (精炼摘要), `status`, `isAggregated`, `aggregateCount`, `isCorrectionBranch` 等；
- **巨型数据外置**：剔除节点内部深层嵌套的大对象；在应用层维护扁平的 `eventsMap: Map<string, TelemetryEvent>`，只有当人类在画布上点击选定节点唤起详情抽屉（Drawer）时，才 JIT 按需提取完整的参数和标准输出。

### 2.2 彻底废除硬切片分页，保持因果 DAG 100% 连续 (Unbroken Continuous DAG)
- 废弃平铺流水中的 `WINDOW_SIZE` 机械切片，全量节点与边完整挂载于画布上；
- 依托多行蛇形流式网格（Row-Wrapped Grid Layout）排版，因果连线永不断链。

### 2.3 语义缩放与层级细节呈现 (Semantic Zoom Level of Detail - LOD)
- 在 `src/components/AgentNode.tsx` 中结合 React Flow 的视口缩放状态（Zoom Level）：
  - **远景俯瞰模式 (Zoom < 0.45)**：节点自动切换为极简色块胶囊形态（Compact Pill），隐藏长文本；
  - **屏幕空间恒定字号反向缩放补偿 (Screen-Space Inverse Scaling)**：在紧凑胶囊核心标签上，根据当前 zoom 计算反向缩放系数 `scaleFactor = Math.min(2.2, 1 / zoom)`，使关键标题文本在视网膜上的实际显示尺寸稳定保持在 12px~13px 清晰易读尺寸，杜绝随画布缩小到 3px 蚂蚁字；
  - **醒目 Landmark 地标标签提纯**：文件类型提取清晰文件名、命令类型提取 `$ 命令首词`、轮询提取 `⚡ 轮询 xN`、异常提取 `❌ 报错`；
  - **1:1 正常尺寸 Hover 气泡卡片**：在远景模式下 hover 时以 `1 / zoom` 反向缩放抵消画布缩小，以正常视口尺寸清晰浮现概要卡片；
  - **Handle 连线桩位置严谨对齐**：Handle 直接锚定在固定盒模型边界（Left 与 Right），杜绝 CSS transform 缩放导致的因果连接线错位与漂移；
  - **微观检视模式 (Zoom >= 0.45)**：平滑展开为高密度质感卡片，呈现两行摘要与指标。

## 3. 验收标准 (Acceptance Criteria)
- [x] `src/services/transcriptParser.ts` 转换生成的 React Flow 节点数据符合瘦节点契约（不再携带冗余的大型 payload/observation）；
- [x] `src/App.tsx` 彻底移除平铺视图下的硬分页切片，全量流水下所有因果边保持连续；
- [x] `src/components/AgentNode.tsx` 具备基于 Zoom 级别的自适应轻量形态渲染与屏幕空间恒定字号反向缩放补偿；
- [x] 远景紧凑胶囊提纯醒目 Landmark 地标，Handle 连线桩严谨对齐，Hover 时浮现 1:1 正常尺寸卡片；
- [x] 点击节点唤起详情抽屉时，能通过 JIT 映射完整展示其参数和终端输出；
- [x] 执行全套自动化单元测试（174 Tests 全部通过）与 `pnpm build` 100% 绿灯。
