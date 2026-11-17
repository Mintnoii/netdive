# Proposal: 编码审美底座收敛与反模式清洗 (Aesthetic Base Convergence & Anti-Pattern Hygiene)

## 1. 痛点背景与动机 (Problem Statement)

对齐 `dotagents/MIND.md` 维度 3（架构审美与负向免疫）与 `SYSTEM_PROMPT.md` 门禁 1（起手编码审美），审计当前仓库后命中五类结构性欠账。它们不是功能缺陷，而是"每加一个功能就多一份维护成本"的慢性病：

1. **公共底座缺失（最严重）**：
   - 全仓 12 处 `fetch` 散落在 `client/reporter.ts`、`hooks/useWalStats.ts`、`components/CompactionPreviewOverlay.tsx`、`hooks/useBridgeConnection.ts` 四处，各自手写端点拼接、`tryit` 包装与错误降级；
   - `127.0.0.1:4560` 在 5 个文件各写一遍（`reporter`、`useBridgeConnection` ×2、`server/bridge.ts`、`server/index.ts`），端口一改就要全仓搜替换；
   - 违反门禁「网络请求统一收敛于 `utils/http.ts`」。

2. **掩耳盗铃式空 catch**：
   - 非测试代码 13 处原生 `try/catch`，其中 9 处 body 只有一句 `// ignore`（`useBridgeConnection.ts:165/268/282`、`bridge.ts:484/488`、`NodeDetailsDrawer.tsx:93`、`TurnDetailsDrawer.tsx:64`、`telemetry.ts:546/640`）；
   - `transcriptParser.ts:1923` 在 `catch` 里再套 `try/catch` 手搓自愈解码；
   - 违反门禁「业务层严禁裸写 try/catch，一律 `radash.tryit` 解构，严禁空 catch」。

3. **命令式 IO 嵌套**：
   - `server/bridge.ts` 的本地会话扫描约 110 行，4 层嵌套 `for`，混用 `readdirSync` / `statSync` / `readFileSync`（全文件 11 处 sync fs）、手写正则抠标题、`existsSync` 防御与内层空 catch；
   - 违反 MIND 10-19「信赖系统契约，消灭无脑防御」与「pathe / radash 物尽其用」。

4. **旗舰解析器单文件膨胀**：
   - `services/transcriptParser.ts` 2315 行，`handlePi*` 与 `handleClaude*` 两组适配器近乎对偶重复（54/100 行、111/110 行）；
   - 全仓 76 个 `for` 循环中 25 个集中在此文件。

5. **表现层字典多头维护**：
   - 状态色 `#F59E0B` / `#6366F1` / `#D97706` / `#10B981` / `#F43F5E` 散在 5 个文件共 22 处，无单一字典源；
   - `App.tsx:755-900` 有 146 行内联 MiniMap 配色 `switch` 与手势判断；
   - 87 处 `typeof x === 'string'`（MIND 10-17 原声点名的正是这个）；
   - `src/assets/react.svg` / `vite.svg` / `hero.png` 为 Vite 模板残留，零引用。

## 2. 重构目标与边界 (Goals & Non-Goals)

### 2.1 目标
- 建立 `src/utils/http.ts` 与 `src/config/bridge.ts` 两个公共底座，把 12 处 fetch 与 5 处端口常量收敛为单点；
- 清零空 catch，全部改为 `radash.tryit` 解构 + 显式 fallback 语义；
- 把本地会话扫描从路由层剥离为纯函数服务；
- 把协议适配从 2315 行单文件拆为可独立测试的 adapter；
- 收敛状态色与手势语义为单点查表，清理死资产。

### 2.2 非目标 (Non-Goals)
- **零行为变更**：本提案不新增功能、不改动门禁裁决契约、不触碰 `demoOnly` 隔离语义；
- **严禁重写历史妥协**：不对既有 299 条测试断言做宽松化修改；任何测试改动必须是契约升级，不得为通过测试而降低断言强度；
- **不做类型体操**：拒绝 point-free 堆砌与过度抽象，遵守「工程函数式」基准（扁平字典查表优先）；
- **不动视觉骨架**：状态色收敛只做「抽常量 + 查表函数」，不重设计配色。

## 3. 分批实施规格 (Batches)

### 批次 1：公共底座（P0）
- 新增 `src/config/bridge.ts`：`DEFAULT_BRIDGE_HOST` / `DEFAULT_BRIDGE_PORT` / `DEFAULT_BRIDGE_HTTP_URL` / `DEFAULT_BRIDGE_WS_URL` / `resolveBridgeBaseUrl(override?)`，由 `NETDIVE_BRIDGE` / `PORT` 环境变量与常量共同推导；
- 新增 `src/utils/http.ts`：`httpJson<T>(url, init)` / `httpText(url, init)` / `httpJsonSilent<T>(...)`，内部 `radash.tryit` 解构返回 `[err, data]`，统一 `AbortSignal.timeout` 与 `Content-Type`；
- 12 处 fetch 全量接入，删除各文件私有的端点拼接与错误样板。

### 批次 2：空 catch 清洗（P0）
- 9 处 `catch { // ignore }` 全部改 `tryit` 解构，`err` 分支给出可解释降级值（如 WS 非标准帧 → 明确返回、WAL 缺失 → 返回 null 并保留原因字符串）；
- `transcriptParser.ts` 的 catch 内套 catch 自愈抽为纯函数 `safeDecodeUri`；
- 保留 4 处「协议层解析未知 JSON」的 try/catch 语义但统一走 `tryit`。

### 批次 3：本地会话扫描剥离（P1）
- 新增 `src/services/localSessionScanner.ts`：`scanLocalSessions(limit)` 与 `readLocalTranscript(id)` 纯函数，内部以 `pathe` 处理路径、`radash` 归一化集合、单层集合变换替代 4 层 for；
- `server/bridge.ts` 只保留 HTTP 路由与错误信封；
- 新增 `localSessionScanner.test.ts` 覆盖：空目录、非法 JSONL 行、标题提取优先级（session.title > 首条 user 首行 > 文件名）、mtime 倒序与 limit 截断、按 id 命中与未命中。

### 批次 4：协议适配拆分（P1）
- 新增 `src/services/protocols/pi.ts` / `protocols/claude.ts` / `protocols/shared.ts`，把 `handlePi*` / `handleClaude*` 收敛为 `RecordAdapter` 接口实现；
- 共享管道：`record → normalized fields → TelemetryEvent[]`，删除对偶重复分支；
- `transcriptParser.ts` 缩减为「分发 + 聚合 + 排版」，1911 行既有测试必须保持全绿。

### 批次 5：表现层字典与死资产（P2）
- 新增 `src/services/statusTone.ts`：`statusTone(status)` / `gestureTone(gesture)` 扁平字典，替换 22 处散落色值；
- `App.tsx` 的 MiniMap 配色 `switch` 下沉为 service 纯函数；
- 87 处 `typeof x === 'string'` 收敛为 `radash.isString`；
- 删除 `src/assets/react.svg`、`vite.svg`、`hero.png`。

## 4. 验收标准 (Acceptance Criteria)

1. `pnpm test` 全绿（起点 299，允许只增不减）；
2. `pnpm build` 零类型错误；
3. `pnpm exec oxlint` 告警数不高于起点 11 条；
4. 全仓非测试代码 `catch {` 数量为 0（协议层统一经 `tryit`）；
5. `src/` 下 `fetch(` 调用点仅存于 `utils/http.ts` 与 `client/reporter.ts`（后者为对外 SDK 探活，复用 http 基座）；
6. `4560` 字面量仅存于 `config/bridge.ts` 与文档。

## 5. 风险与回滚 (Risks)

| 风险 | 缓解 |
| :--- | :--- |
| http 基座替换改变错误信封语义，导致 UI 静默失联 | 基座返回 `[err, data]` 与原 `tryit` 语义一致；`reporter` 的 Fail-Silent 与 `useBridgeConnection` 的重连逻辑各有测试覆盖 |
| 会话扫描改写后标题提取规则漂移 | 新增 `localSessionScanner.test.ts` 固化优先级并保留原行为断言 |
| 协议拆分引入回归 | 批次 4 单独提交，1911 行既有测试作为安全网，逐函数迁移 |
| 色值收敛改错配色 | 只抽常量与查表，不调数值；逐处替换后目视核对 ShowcasePage 与实时画布 |
