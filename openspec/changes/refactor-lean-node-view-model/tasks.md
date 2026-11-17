# Tasks: 瘦节点视图模型落地与底座补测

> 起点基线：`pnpm test` 318 pass / 0 fail；`pnpm build` 通过（首屏 625.4 KB）；`pnpm exec oxlint` 11 warning。
> 执行顺序硬约束：**先补测 → 再改造 → 最后单源化**，每步跑完三件套再进下一步。

## 1. 补测打底（改造前必须完成）
- [x] 1.1 新增 `src/services/flowLayout.test.ts`：坐标单调递增、折行边界（第 6 个节点换行）、自愈分支下沉偏移、`createFlowEdge` 样式优先级（分支 > 失败 > 常规）与动画语义
- [x] 1.2 新增 `src/services/sessionTopology.test.ts`：`createInitialSession` 默认值、`processEventForSession` 建节点/建边/状态沉降、`processEventForSessions` 会话隔离、`extractPrunableItems` 过滤与摘要、`getDynamicWatermarkDelta` 手势映射
- [x] 1.3 在 1.2 中固化「节点 data 不含 observation/payload」的反向断言（记录当前违规现状为待修项，改造后转为期望通过）

## 2. 瘦节点视图模型
- [x] 2.1 新增 `src/services/nodeFacets.ts`：`NodeFacets` 契约与 `deriveNodeFacets(event)` 纯函数（含 `@example`）
- [x] 2.2 `AgentNodeData` 增补小标量字段（`command` / `filePath` / `pattern` / `exitCode` / `outputHead` / `outputLineCount` / `outputChars` / `hasDiff`），标注 observation/payload 为待移除
- [x] 2.3 `sessionTopology` 三处建节点分支改用 `deriveNodeFacets`，删除 `observation` / `payload` 写入
- [x] 2.4 `transcriptParser` 回放侧同步使用 `deriveNodeFacets`，两轨节点模型同源
- [x] 2.5 `AgentNode` 徽标与预览改读小标量；`agentNodeLOD` 地标改读 `command` / `filePath` / `pattern`
- [x] 2.6 `extractPrunableItems` 改用 `outputLineCount` / `outputChars` / `hasDiff`，不再触碰 observation 对象
- [x] 2.7 `NodeDetailsDrawer` 删除 `nodeData` 兜底，详情只从 `eventsMap` 事件取，保留未命中空态文案
- [x] 2.8 反转 1.3 的反向断言为正向契约：两轨节点 data 均不含 observation/payload

## 3. 判定单源
- [x] 3.1 `TurnNode` 删除本地 `isInputOnlyTurn` 复算，改用 `resolveTurnTone(turn) === 'inputOnly'`

## 4. 附带清理
- [x] 4.1 `flowLayout` 显式拆 `ATOM_GRID` 与 `TURN_GRID` 两套常量，`turnsToFlowNodesAndEdges` 停用同名不同义变量
- [x] 4.2 `microCompactor.normalizeOutputToLines` 手写切片换 `radash.chunk`
- [x] 4.3 `microCompactor.validatePairing` 双层扫描改「flatMap 信封 + 单遍判定」
- [x] 4.4 `scripts` 两处硬编码盘符改 `homedir()` + 环境变量覆盖
- [x] 4.5 `sampleTranscript.ts` 迁至 `src/fixtures/`，测试导入同步更新
- [x] 4.6 补 `GateApprovalModal` 裁决语义测试（approve / reject / modify + 快捷键）
- [x] 4.7 补 `gateManager` 状态机测试（挂起、裁决、超时、重复注册替换、订阅通知）

## 5. 收口校验
- [x] 5.1 `pnpm test` 全绿（起点 318，只增不减）
- [x] 5.2 `pnpm build` 零类型错误
- [x] 5.3 `pnpm exec oxlint` 告警不高于 11
- [x] 5.4 浏览器实测：实时会话渲染、失败徽标、地标文本、抽屉详情、剪枝面板均不回归
- [x] 5.5 人类拍板后提交（严禁 Agent 擅自 commit）

## 6. 本轮实测结果
- `pnpm test` **359 pass / 0 fail**（新增 flowLayout 11 + sessionTopology 17 + gateManager 9 + gateDecisions 4）
- `pnpm build` 零类型错误；首屏 `index-*.js` 625.2 KB（gzip 190.1 KB，与上轮持平）
- `pnpm exec oxlint` 11 warning（未增）
- 浏览器实测：地标（📄 文件 / $ 命令 / ❌ 报错 / 🛡️ 门禁 / ✨ 自愈）正常，`exit: 1` 徽标正常，选中态正常，
  抽屉内 JIT 取回完整 `AssertionError` 堆栈正常（证明节点不再自带 payload 也能看全量）
- 关键偏差说明：`radash` 未导出 `chunk`，`normalizeOutputToLines` 改用 `Array.from` 声明式窗口切片替代游标循环
- 关键兼容设计：`extractPrunableItems(nodes, lookupEvent?)` 支持按 nodeId JIT 回取事件，
  压缩机会预演面板保留完整 diff/输出预览，同时节点仍为瘦模型
