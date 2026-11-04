# Implementation Tasks: screen-space-constant-billboard-and-intent-extraction

- [x] Task 1: 升级确定性意图提纯算法 (`src/services/agentNodeLOD.ts` & `src/services/transcriptParser.ts`)
  - 编写纯函数 `extractRealIntent(text: string, defaultTitle: string): string`：剥离礼貌客套前缀，提取首句动宾核心（支持 45~50 字符完整首句），杜绝死板的“决策输出与复盘”；
  - 改造 `extractLandmarkLabel` 与 `extractBillboardText`：对 think 手势优先利用提纯意图作为 Landmark（如 `🎯 检查App切片与分页逻辑`）。
- [x] Task 2: 实施 1+2 混合固定尺寸卡片与视口 0.65 锁死防线 (`src/components/AgentNode.tsx` & `src/App.tsx`)
  - 彻底拔除胶囊分支与 CSS `scale(1/zoom)` 假放大，节点物理盒模型锁定为标准的 `w-[280px]` 规整卡片，消灭节点碰撞重叠与连线遮挡；
  - 在 `src/App.tsx` 中将 ReactFlow 的 `minZoom` 锁死在 0.65，使画布缩小到舒适界限时卡死定住，绝不无限缩小；
  - 远景模式（`zoom < 0.85`）下容器坚决保持 `bg-white` 白底与高对比度边框（彻底消灭透明穿透），清空下半部分琐碎小参数，把整个 280px 空间完全让位给加粗、大字号、多行折行的动宾意图。
- [x] Task 3: 编写并扩充单元测试 (`src/components/AgentNode.test.ts` & `src/services/transcriptParser.test.ts`)
  - 验证 `extractRealIntent` 对各类长文本首句的准确提纯能力（支持达 50 字符完整语义）；
  - 验证远景模式下 Landmark 产出真实意图而非硬编码套话；
  - 验证 `AGENT_NODE_WIDTH` 280 物理守恒与 `isFarZoom` 视距判定。
- [x] Task 4: 执行全量测试与生产构建验收
  - 执行 `pnpm test` 达到 100% 绿灯（188 Tests 全部通过）；
  - 执行 `pnpm build` 确认零类型报错。
