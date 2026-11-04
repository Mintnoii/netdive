# OpenSpec Proposal: streaming-online-coalescing-and-drilldown-folding

## 1. 核心背景与痛点 (Context & Problem Statement)
在长程复杂的 Agent 实际运行轨迹（例如通过 `orca terminal read` 持续轮询终端状态、或对同一源码文件反复检视与补丁时），NetDive 画布当前面临两大严重降低可读性与可用性的体验痛点：
1. **微观下钻折叠穿透丢失 (Drilldown Folding Bypass)**：
   在 `src/App.tsx` 的下钻微观视图（Drilldown View）中，画布直接对原始未折叠的 `currentTurnAllEvents` 切片渲染，未调用 `aggregateConsecutiveToolEvents`。导致即使开启了折叠功能，下钻微观回合后依然呈现密密麻麻上百个节点。
2. **死板的连续折叠判定机制 (Brittle Folding State Machine)**：
   当前 `getToolTargetKey` 一旦遇到 `think`、`actor === 'Human Operator'` 或过渡性复盘即刻断开折叠（flush）。实际中 Agent 的高频轮询（如 `orca terminal read`）在每次调用间隙往往伴随着 1~2 句过渡性自白（“正在读取”、“等待命令完成”），导致原本同属一个逻辑轮询链的操作被机械拆散为 6~10 个独立节点。
3. **同目标文件管道割裂 (Disjoint File Operations)**：
   对同一目标文件紧邻的连续 `read` 与 `edit`（检视 $\to$ 打补丁），当前被分散为独立无关联的节点，缺乏文件级会话聚合（File Session Affinity）。

## 2. 架构设计与解决方案 (Design & Solution)

### 2.1 修复微观下钻折叠穿透 (Fix Drilldown Folding)
在 `src/App.tsx` 中，确保微观下钻视图在将 `currentTurnAllEvents` 转换为 Flow 节点前，同样遵照 `isFoldingEnabled` 状态流经 `aggregateConsecutiveToolEvents`，并在窗口切片计算时以聚合后的事件序列为基准，消除上百节点的认知过载。

### 2.2 容忍过渡性 Think 与终端轮询抑制 (Poll Suppression with Soft Think Tolerance)
升级 `aggregateConsecutiveToolEvents` 状态机：
- 识别“终端/子进程只读轮询（如 `orca terminal read`）”与“只读探测序列”；
- 当两个同构工具调用之间穿插短小的过渡性思考（如短文本、心智碎碎念）时，不断开折叠链；
- 将中间的思考与复盘内容自动下沉并收集至聚合事件的 `subCalls` 或 `payload.notes` 中，主画布仅渲染 1 个带有 `(xN 轮询中/已轮询)` 的高密度聚合节点。

### 2.3 同文件连续交互会话聚合 (File Touch Session Pipeline)
- 对紧邻且操作同一物理文件（相同 `path`）的 `read` 与 `edit` 手势进行就近聚合；
- 聚合后标题塑形为 `file: <filename> (检视 + 补丁 xN)`，节点手势提升为 `edit`，同时保留完整的微观操作序列在抽屉明细中。

### 2.4 在线流式聚合契约预留 (Online Streaming Aggregation Contract)
- 导出增量聚合器纯函数 `coalesceIncrementalEvent(currentTail, newEvent)`，为后续 WebSocket 实时流就地吸附翻牌（In-place Absorbing & Debounce）提供通用纯函数支撑，使离线回放与实时流共用同一套聚合决策逻辑。

## 3. 验收标准 (Acceptance Criteria)
- [ ] `src/services/transcriptParser.ts` 支持容忍过渡性 Think 的终端轮询合并（如连续 3 次 `orca terminal read` + 3 句复盘收拢为 1 个聚合节点）；
- [ ] `src/services/transcriptParser.ts` 支持同文件紧邻交互会话合并；
- [ ] `src/App.tsx` 下钻微观模式正确遵循 `isFoldingEnabled` 响应式折叠；
- [ ] 补齐并更新 `src/services/transcriptParser.test.ts` 针对轮询抑制、过渡 Think 容忍及微观折叠的自动化单元测试；
- [ ] 执行全套自动化单测 `pnpm test` 100% 通过，无回归缺陷。
