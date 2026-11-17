# Tasks: 编码审美底座收敛与反模式清洗

> 状态：批次 1–5 全部落地，仅剩 6.6 提交权归人类。
> 收口基线：`pnpm test` 314 pass / 0 fail；`pnpm build` 通过；`pnpm exec oxlint` 11 warning。
> 每一批结束必须重跑三者，且不得放宽既有断言强度。

## 1. 公共底座：config/bridge.ts + utils/http.ts（P0）
- [x] 1.1 新增 `src/config/bridge.ts`，收敛 `DEFAULT_BRIDGE_HOST/PORT/HTTP_URL/WS_URL` 与 `resolveBridgeBaseUrl()`，支持 `NETDIVE_BRIDGE` / `PORT` 环境覆盖
- [x] 1.2 新增 `src/utils/http.ts`：`httpJson` / `httpText` / `httpJsonSilent`，内部 `radash.tryit` 解构 + `AbortSignal.timeout` + 统一 `Content-Type`
- [x] 1.3 `hooks/useBridgeConnection.ts` 改用 `config/bridge.ts` 常量与 http 基座
- [x] 1.4 `hooks/useWalStats.ts` 改用 http 基座，删除私有 `controller` 样板
- [x] 1.5 `components/CompactionPreviewOverlay.tsx` 改用 http 基座
- [x] 1.6 `client/reporter.ts` 复用 `config/bridge.ts` 默认端点，验收标准 `fetch(` 仅存于基座与 reporter 探活
- [x] 1.7 `server/bridge.ts` / `server/index.ts` 端口常量统一由 `config/bridge.ts` 派生

## 2. 空 catch 清洗（P0）
- [x] 2.1 `hooks/useBridgeConnection.ts` 三处空 catch 改 `tryit` 解构并写明降级语义
- [x] 2.2 `server/bridge.ts` 两处空 catch（JSONL 行解析 / 目录扫描）改 `tryit`
- [x] 2.3 `components/NodeDetailsDrawer.tsx` / `TurnDetailsDrawer.tsx` 剪贴板写入改 `tryit`
- [x] 2.4 `types/telemetry.ts` 两处 JSON 解析降级改 `tryit`
- [x] 2.5 `services/transcriptParser.ts` catch 内套 catch 的 URI 自愈解码抽为纯函数 `safeDecodeUri`
- [x] 2.6 全仓非测试代码 `catch {` 归零校验

## 3. 本地会话扫描剥离（P1）
- [x] 3.1 新增 `src/services/localSessionScanner.ts`：`scanLocalSessions(limit)` / `readLocalTranscript(id)`，`pathe` 处理路径、`radash` 归一化集合、集合变换替代 4 层 for
- [x] 3.2 `server/bridge.ts` 路由瘦身，仅保留 HTTP 信封与错误映射
- [x] 3.3 新增 `src/services/localSessionScanner.test.ts`：空目录、脏 JSONL 行、标题优先级、mtime 倒序 + limit、按 id 命中/未命中
- [x] 3.4 移除 `bridge.ts` 内 `existsSync` 无脑防御，改为契约信任 + 明确错误信封

## 4. 协议适配拆分（P1）
- [x] 4.1 新增 `src/services/protocols/shared.ts`：`ParserContext`、`TelemetryEvent` 归一化原语、`recordSearchText` / `extractTextContent` / `pushEvent` 等共享工具
- [x] 4.2 新增 `src/services/protocols/pi.ts`：`handlePiUserMessage` / `handlePiAssistantMessage` / `handlePiToolResult` / `handlePiMetadata` 迁移为 `RecordAdapter`
- [x] 4.3 新增 `src/services/protocols/claude.ts`：Claude 四件套同构迁移
- [x] 4.4 `transcriptParser.ts` 瘦身为「分发 + 聚合 + 排版」，Pi/Claude 对偶分支消除，fixture 类型收回 protocols/shared
- [x] 4.5 `transcriptParser.test.ts` 1911 行既有断言零放宽、全绿

## 5. 表现层字典与死资产（P2）
- [x] 5.1 新增 `src/services/statusTone.ts`：`statusTone` / `gestureTone` / `minimapNodeStroke` 扁平字典
- [x] 5.2 替换 `App.tsx` 内联 MiniMap 配色 switch（原 146 行内联逻辑）
- [x] 5.3 替换 `ShowcasePage.tsx` / `ContextStripBar.tsx` / `useTelemetryStream.ts` / `transcriptParser` 散落色值
- [x] 5.4 87 处 `typeof x === 'string'` 收敛为 `radash.isString`
- [x] 5.5 删除 `src/assets/react.svg` / `vite.svg` / `hero.png` 死资产

## 6. 收口校验
- [x] 6.1 `pnpm test` 全绿（起点 299，只增不减）
- [x] 6.2 `pnpm build` 零类型错误
- [x] 6.3 `pnpm exec oxlint` 告警不高于 11
- [x] 6.4 验收脚本：`src/` 下 `fetch(` 仅存于 `utils/http.ts` 与 `client/reporter.ts`
- [x] 6.5 验收脚本：`4560` 字面量仅存于 `config/bridge.ts` 与文档
- [x] 6.6 人类拍板后提交（严禁 Agent 擅自 commit）
