# Proposal: 瘦节点视图模型落地与底座补测 (Lean Node View-Model & Foundation Test Coverage)

## 1. 痛点背景 (Problem Statement)

`AGENTS.md §3.3` 明文规定：「塞入 `node.data` 的数据必须保持极简，**绝对严禁把原始 megabyte 级 stdout、完整 payload 冗余存入画布节点**；完整遥测事件保留在外部索引（如 `eventsMap`），点击抽屉时 JIT 提取」。

但当前代码只有回放路径遵守了这条宪法，实时路径直接违反：

```ts
// src/services/sessionTopology.ts:300 / 381 / 472
data: {
  ...,
  observation: normalizedObs,   // 完整 stdout / 全量输出行
  payload: event.payload,       // 完整入参（含 diff、args）
}
```

后果：
1. **内存**：实时会话每步节点驻留完整工具输出，长会话（实测单会话已到 193 步）可达数十 MB，且随会话数线性叠加；
2. **渲染**：`node.data` 引用每次事件都变，`AgentNodeMemo` 的比较器必然失效，memo 化收益被抵消；
3. **双轨不一致**：回放路径建的是瘦节点（`transcriptParser.test.ts:490` 已有断言），实时路径建的是胖节点，两条轨道节点模型不同源。

而瘦节点所需基础设施其实都在：`App.tsx:303` 已维护 `eventsMap: Map<string, TelemetryEvent>`，`NodeDetailsDrawer:55` 已是 `event?.payload ?? nodeData.payload`（event 优先）。缺的只是「把兜底拆掉 + 把渲染真正需要的小标量提前抽出来」。

同时暴露两个派生问题：
- 新抽的两个底座 `flowLayout.ts` / `sessionTopology.ts` **零专属测试**，而它们恰好是本次改造的主战场；
- 「纯人类输入回合」判定在 `statusTone.ts` 与 `TurnNode.tsx` 各有一份实现，漂移即错位。

## 2. 设计规格 (Design)

### 2.1 节点视图模型：只留小标量，不留 blob

新增 `src/services/nodeFacets.ts`，以纯函数把事件中「渲染真正用到的小字段」抽成扁平标量：

```ts
export interface NodeFacets {
  command?: string        // payload.command ?? observation.command
  filePath?: string       // payload.path ?? file_path ?? filePath ?? file
  pattern?: string        // payload.pattern
  exitCode?: number       // observation.exitCode
  outputHead?: string     // observation.output 首行
  outputLineCount?: number
  outputChars?: number
  hasDiff?: boolean       // payload.diff 是否存在
}

export function deriveNodeFacets(event: TelemetryEvent): NodeFacets
```

`node.data` 从此只包含：`nodeId / gesture / title / summary / status / actor / 折叠与分支标记 / walPointerId / prunableTokens / reclaimedTokens / NodeFacets`。**不再有 `observation` 与 `payload` 字段**。

### 2.2 渲染与推导改用标量

- `AgentNode`：`exitCode` 徽标与首行预览改读 `nodeData.exitCode` / `nodeData.outputHead`；
- `agentNodeLOD`：地标文本改读 `command` / `filePath` / `pattern`；
- `extractPrunableItems`：改用 `outputLineCount` / `outputChars` / `hasDiff`，不再触碰 observation 对象（聚合节点的 `subCalls` 预览退化为 `summary` 已有内容 + `aggregateCount`）；
- `NodeDetailsDrawer`：删除 `nodeData` 兜底，详情只从 `eventsMap` 的 `TelemetryEvent` 取（JIT 契约）；
- 两条轨道（实时 `sessionTopology` / 回放 `transcriptParser`）统一调用 `deriveNodeFacets`，节点模型同源。

### 2.3 判定单源

`TurnNode` 删除本地 `isInputOnlyTurn` 复算，改用 `resolveTurnTone(turn) === 'inputOnly'`。

## 3. 执行顺序 (必须遵守)

1. **先补测**：`flowLayout.test.ts`（坐标单调、折行边界、分支下沉、连线样式优先级）与 `sessionTopology.test.ts`（会话归约、因果建链、prunable 提取、瘦节点断言）——锁住改造前行为；
2. **再改造**：按 2.1 / 2.2 迁移，回放侧既有瘦节点断言零放宽；
3. **最后单源化**：TurnNode 改用 statusTone 判定。

## 4. 附带清理（同一批尾部）

- `turnsToFlowNodesAndEdges` 与 `FLOW_LAYOUT` 同名不同值的常量，显式拆成 `ATOM_GRID`（280/6）与 `TURN_GRID`（360/4/280），杜绝误用；
- `microCompactor.normalizeOutputToLines` 手写切片换 `radash.chunk`；`validatePairing` 双层扫描改「先 flatMap 信封、再单遍判定」；
- `scripts/run-claude-host-simulation.ts` / `verify-host-extension-e2e.ts` 里写死的 `C:/Users/wangqing/...` 改 `homedir()` + 环境变量；
- `sampleTranscript.ts` 挪至 `src/fixtures/`（已无生产消费方，纯测试夹具）；
- 补 `GateApprovalModal` 裁决语义测试与 `gateManager` 状态机测试。

## 5. 验收标准

1. `pnpm test` 全绿（起点 318，只增不减）；
2. `src/` 下无任何建节点分支把 `observation` / `payload` 写入 `node.data`（新增断言固化）；
3. 实时与回放两条轨道的节点 data 键集合一致（同一断言覆盖）；
4. `pnpm build` 零类型错误；`pnpm exec oxlint` 告警不高于 11；
5. 浏览器实测：实时会话渲染、失败徽标、文件/命令地标、抽屉详情、剪枝面板均不回归。

## 6. 风险与回滚

| 风险 | 缓解 |
| :--- | :--- |
| 渲染依赖的小字段遗漏，导致徽标/地标空白 | `nodeFacets` 字段与现有 UI 读取点一一对账；浏览器逐项核对；缺字段时降级为已有 `summary` |
| 聚合节点的 subCalls 预览退化 | 仅在瘦节点改造中移除嵌套 payload 预览，主摘要与折叠计数保留，视觉不塌 |
| 抽屉失去兜底后空态 | App 已把 `eventsMap.get(selectedNodeId)` 传入；对未命中事件保留「事件已随会话释放」空态文案 |
| 改造触碰 318 条断言 | 先补测再加断言，回放侧既有瘦节点断言零放宽，失败即回滚单批 |
