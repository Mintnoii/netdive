# Implementation Tasks: streaming-online-coalescing-and-drilldown-folding

- [x] Task 1: 升级 `src/services/transcriptParser.ts` 聚合状态机
  - 改进 `getToolTargetKey` 与 `aggregateConsecutiveToolEvents`，支持在连续同目标工具调用间穿插过渡性 `think` 节点时不断开链条；
  - 将中间穿插的 `think` 文本抽取为 `subNotes` / `thoughts` 存入聚合节点的 `payload` 与 `observation`；
  - 支持终端轮询（如连续 `orca terminal read` 或类似只读指令）的专属折叠标题塑形；
  - 支持同路径紧邻文件操作（`read` + `edit`）的文件会话聚合模式。
- [x] Task 2: 修复 `src/App.tsx` 微观下钻视图折叠穿透
  - 确保下钻模式下的事件序列尊重 `isFoldingEnabled` 开关，先经过 `aggregateConsecutiveToolEvents` 再进行滑动视口窗口切片与 Flow 节点渲染；
  - 调整微观时间轴步骤（Scrubber）与聚合后事件数量的一致性映射。
- [x] Task 3: 编写并完善单测覆盖 (`src/services/transcriptParser.test.ts`)
  - 新增测试用例：验证包含 `orca terminal read` 与决策输出交替的序列能够正确合并为单个聚合节点；
  - 新增测试用例：验证同一文件的 `read` $\to$ `edit` 紧邻操作能正确聚合并保留明细；
  - 新增测试用例：验证当 `isFailureOrCorrectionEvent` 发生时依然保持强可见性，绝不盲目折叠。
- [x] Task 4: 运行全量单测与回归验证
  - 执行 `pnpm test`，确保全部单测通过。
