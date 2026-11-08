# Proposal: 遥测副本压缩机会剖析与真实对账 (Compaction Opportunity Inspector)

## 1. 痛点背景 (Problem Statement)
NetDive 的确定性微压缩（`microCompactor`）已经在 bridge 摄入链路上真实生效：`POST /api/telemetry` 收到事件后自动执行 `compactObservation`，把超长工具输出折叠为 Head 15 + 标记行 + Tail 15，原文落内存 WAL（`wal-call-N`）。但观测面完全看不见这件事：

1. **看不见哪里被压**：用户不知道本次会话里哪些工具观测体积超标、按什么阈值判定、被折了多少；
2. **看不见压完什么样**：折叠后的真实文本（头 15 行 / 标记行 / 尾 15 行）从未呈现；
3. **看不见真实省了多少**：抽屉底部显示的是硬编码假数（`pruneContext` 里 `|| 42000`），而 bridge 侧的 `getWalStats()` 早就有真账；
4. **存在误导性假动作**：底部「一键修剪」只改前端 `isPruned` / `watermark.prunableTools=4000`，浮层里的「微压缩」tab 只是本地 diff。

## 2. 边界声明 (Scope Boundary)
**本变更不做真实上下文压缩。** Agent 侧 tool_result 钩子介入属暂缓项，见 `docs/BACKLOG.md` 第一节。本变更只在**遥测副本层**做剖析、预演与对账，零协议改动、零侵入 Agent。

## 3. 设计 (Design)

### 3.1 服务层：压缩机会剖析纯函数
新增 `src/services/compactionOpportunities.ts`：

```ts
export interface CompactionOpportunity {
  nodeId: string
  toolName: string
  gesture: TelemetryGesture
  originalLines: number
  originalChars: number
  willCompact: boolean
  compactedLines: number
  compactedChars: number
  reclaimedChars: number
  reclaimedPercent: number
  pointerId?: string        // 已有 WAL 指针 = bridge 已真实折叠
  compactSummary?: string
  headLines: string[]       // 前 15 行原文
  tailLines: string[]       // 后 15 行原文
  foldMarker?: string       // 折叠标记行
  compactedText: string     // 折叠结果全文
}

export function analyzeCompactionOpportunities(
  events: TelemetryEvent[],
  options?: MicroCompactorOptions
): {
  opportunities: CompactionOpportunity[]   // 按 reclaimedChars 降序
  scannedCount: number
  hitCount: number
  totalRawChars: number
  totalReclaimedChars: number
}
```

硬约束：
- 判定统一走 `isCompactionNeeded`（>40 行 或 >1500 字符），折叠统一走 `compactToolLines`；
- **严禁使用 `compactToolOutput`**（它会写 WAL 注册表，剖析必须零副作用）；
- 折叠标记复用 `formatCompactFoldMarker`；
- 纯函数、无 IO、无 React。

### 3.2 真实对账：WAL 统计 Hook
新增 `src/hooks/useWalStats.ts`：抽屉打开时 `GET /api/wal` 拉 `stats`（`totalEntries / totalRawChars / totalCompactedChars / totalReclaimedChars`），bridge 离线返回 `null`，UI 标注「bridge 未连接，仅显示会话内推演账」。

### 3.3 UI：压缩机会区 + 预演浮层
- 抽屉（`ContextInspectorDrawer`）在 7 个 part 概要行下方新增一条**压缩机会摘要条**：`可折叠 N 条 · 预计释放 X 字符` + 右侧真实账 `bridge 已折叠 M 条 · 释放 Y 字符` + 「查看预演」按钮；
- 新增 `src/components/CompactionPreviewOverlay.tsx`：列出候选条目（工具名、行数、字符、释放量、释放百分比、是否已折叠），选中一条展示**三段对照**（头部 15 行 / 折叠标记 / 尾部 15 行），已带 `pointerId` 的条目提供「回放原文」（`GET /api/wal/:pointerId/replay`）；
- 面板高度维持 `h-[min(66vh,640px)]` 恒定；浮层 `z-[60]`，Esc 只关浮层。

### 3.4 移除假动作 (Technical Debt Cleanup)
- `useTelemetryStream.pruneContext` 的硬编码 `|| 42000` 与 `watermark.prunableTools = 4000` 假动作删除；「一键修剪」按钮改为**真实账展示**（不再声称执行了修剪）；
- `ContextTextOverlay` 里的「微压缩」tab 改名为「压缩预览（只读）」，并在展开时标注「不影响会话」。

## 4. 验收标准 (Acceptance Criteria)
- [ ] `analyzeCompactionOpportunities` 纯函数落地，单测覆盖：触发阈值、零副作用（不写 WAL）、排序、汇总、已折叠条目的 `pointerId` 透出；
- [ ] 抽屉展示压缩机会摘要 + 真实 WAL 账；bridge 离线时降级不报错；
- [ ] 预演浮层能展示三段对照，`pointerId` 条目可回放原文；
- [ ] 假动作清理完成：无硬编码 42000、无虚假修剪状态；
- [ ] `pnpm test` 100% 通过，`pnpm build` 零类型报错。

## 5. 素材源流 (Source Lineage)
- `docs/BACKLOG.md`（第一节真实压缩暂缓、第二节当前可做项）
- `src/services/microCompactor.ts`（`isCompactionNeeded` / `compactToolLines` / `formatCompactFoldMarker` / `getWalStats` / `replay`）
- `src/server/bridge.ts`（`POST /api/telemetry` 摄入折叠、`GET /api/wal`、`GET /api/wal/:pointerId/replay`）
- Ghost `wiki/learning/确定性微压缩.md`（本地规则先行、零算力阻断昂贵摘要的原则）
