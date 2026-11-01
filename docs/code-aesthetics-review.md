# NetDive 核心代码库架构审美与工程铁律静态审阅报告

> **审阅目标**：全盘审视 NetDive 核心代码（`src/client/reporter.ts`、`src/server/index.ts`、`src/server/bridge.ts`、`src/services/microCompactor.ts`、`src/services/assertionEngine.ts`、`src/services/transcriptParser.ts`、`src/pages/SessionReplayPage.tsx`、`src/pages/CompactorLabPage.tsx`、`src/types/telemetry.ts`）是否符合全机最高编码审美与工程铁律。  
> **审阅真源**：`~/Desktop/dotagents/MIND.md`（维度 3：架构审美与负向免疫）  
> **审阅基准**：库优先于手搓（`pathe` / `radash`）、契约信任与第一性直给（消灭防御八股与无脑 `Array.isArray`）、工程函数式审美（消灭类状态机、扁平查表消除 `if/else`）、消灭天书正则与命令式 `for` 循环。

---

## 一、宏观审阅结论大盘 (Executive Scorecard)

| 审阅维度 | 达标度 | 现状定性 | 核心症结与典型切片 |
| :--- | :---: | :--- | :--- |
| **1. 库优先于手搓 (`radash` / `pathe`)** | ⚠️ **60%** | **局部先锋，多处弃用** | `reporter.ts` 堪称 `radash.tryit` 模范；但 `bridge.ts` 与 `assertionEngine.ts` 仍残存多处原生 `try/catch` 与空 `catch {}`；全项目除 `transcriptParser.ts` 引入 `basename` 外，对 `pathe` 完全零利用，多处手写正则剥离路径与 URL。 |
| **2. 命令式 `for` 循环与游标清除** | ❌ **45%** | **初级八股多发** | `assertionEngine.ts` 存在 3 处双重嵌套 `for` 循环；`transcriptParser.ts` 存在 370 行巨型单体 `for` 循环与多处原地副作用修改；`bridge.ts` 的 `broadcast` 仍在手写 `for (const client of wss.clients)` 与可变计数器。 |
| **3. 契约信任与消灭防御八股** | ❌ **50%** | **伪兼容妥协严重** | `bridge.ts` 的 `/api/gate/prompt` 充斥 45 行层层三元与 `'key' in body` 属性猜谜；下游组件与解析器在已知上游收敛后仍到处散落无脑 `Array.isArray` 嵌套三元。 |
| **4. 类与函数式审美 (FP vs Class)** | ⚠️ **65%** | **风格割裂** | `reporter.ts` 展现了极佳的无 Class 函数式工厂闭包；但 `gateManager`、`assertionEngine`、`microCompactor` 均采用传统 ES6 Class 与私有可变 `Map` 状态机；`mapToolNameToGesture` 充斥 50 行串联 `if (||)`，完全弃用扁平字典查表。 |
| **5. 正则与字符串拆分审美** | ⚠️ **65%** | **天书正则 + 猜词兜底** | `assertionEngine.ts` 声明了 13 条高危命令天书正则，随后又心虚手写 `lower.includes(...)` 兜底，暴露了对模式匹配缺乏第一性信心的防御性猜疑。 |
| **6. 数据塑形注释 (Shape By Example)** | ⚠️ **70%** | **头重脚轻** | `reporter.ts` 附带完整 `@example`，但 `transcriptParser.ts` 的三大核心转换函数未提供输入输出真实 JSON/DAG 形状示例，存在盲目心智猜测。 |

---

## 二、优秀审美亮点与标杆实现 (Where the Code Shines)

### 1. `src/client/reporter.ts`：函数式探针的教科书级实现
- **彻底消灭 Class 样板**：采用纯函数与工厂闭包 (`createReporter`)，返回不可变接口句柄，零类继承与零过度抽象（完全契合 Ponytail 极简阶梯）。
- **`radash.tryit` 彻底终结原生 `try/catch`**：网络探活 (`probeBridgeHealth`)、事件发射 (`postTelemetrySilently`)、业务包裹 (`step`)、门禁挂起 (`gate`) 100% 依托 `tryit`，语法极其干练。
- **契约信任与 Fail-Silent / Fail-Fast 双轨分工**：
  - 探活失败或 Bridge 挂起时，自动静默降级（Fail-Silent），零开销透传原始业务；
  - 真实业务发生异常时，留痕后当场 `throw execError` 原样抛出业务真实错误（Fail-Fast），绝不搞 `catch(() => null)` 掩耳盗铃。
- **结构化 IPO 注释**：文件头部附带清晰的 `@example` 调用示例与因果链说明。

### 2. `src/pages/CompactorLabPage.tsx`：清晰的声明式计算与通俗去 AI 味表达
- **声明式纯数据派生**：`rawLinesCount`、`compactedLinesCount`、`reclaimedTokens`、`reclaimRatio` 全部由 `useMemo` 基于原子状态纯函数推导，杜绝在 `useMemo` 中调用 `setState` 造成 React 级联重渲染白屏。
- **组件沙盒隔离**：通过 `useMemo(() => new MicroCompactor(...))` 构造实验室独立上下文，与全局运行时解耦。
- **去 AI 味文案典范**：抛弃了“自适应上下文吞吐量管理”等玄学大词，采用「大白话指南」、「智能工具输出裁剪与省钱实验室」、「被裁剪内容的后悔药」等具象直给的单句痛点表达。

### 3. `src/pages/SessionReplayPage.tsx`：无撕裂的时间轴数学推导
- **派生状态防抖动**：通过 `effectiveStep = Math.min(currentStep, totalEvents)` 纯数学约束派生，消灭了依赖 `useEffect` 同步步长产生的滑块位置跳变。
- **因果拓扑与自愈分叉强可见性契约**：严格断言所有失败节点 (`status === 'failed'`) 与自愈分叉永远豁免折叠，保持高显式度。

### 4. `src/services/microCompactor.ts`：经典 OS 页表动静分离思想的准确同构
- **纯函数微压缩**：`compactToolLines` 输入字符串/数组，输出确定性切片，零外部状态与零 LLM 依赖。
- **字节级前缀不可变守卫**：`createPrefixBoundary` 与 `verifyPrefixStability` 精确保护 System Prompt 与 LTM 边界，将大模型缓存击穿问题还原为操作系统 Radix Tree / 页表不变性，充分体现了 MIND.md 哲学信条「日光之下，并无新事」。

---

## 三、深度挑刺：六大病理切片与违规事实 (Anti-Patterns Audit)

### 缺陷 1：原生 `try/catch` 样板与掩耳盗铃式空 `catch`
- **违规事实**：
  - `src/server/bridge.ts`：存在 4 处原生 `try/catch`。第 90 行、第 184 行、第 303 行充斥大块 `try { ... } catch (err) { ... }` 样板。更严重的是第 403-444 行：
    ```ts
    // src/server/bridge.ts:403
    try {
      const text = typeof event.data === 'string' ? event.data : event.data.toString()
      if (!text.trim().startsWith('{')) return
      const data = JSON.parse(text)
      ...
    } catch {
      // 忽略非标准或无效 WebSocket 帧  <-- 掩耳盗铃式空 catch
    }
    ```
  - `src/services/assertionEngine.ts:149`：
    ```ts
    // src/services/assertionEngine.ts:149
    if (validator && payload) {
      try {
        const valid = validator(payload)
        if (!valid) return 'Payload failed custom schema validator contract'
      } catch (err) {
        return `Payload schema validation exception: ${err instanceof Error ? err.message : String(err)}`
      }
    }
    ```
- **违背铁律**：MIND.md 维度 3：“起手编码审美门禁……严禁原生 `try/catch` 样板与 `catch(() => null)` 掩耳盗铃，统一依托 `radash.tryit` 错误解构”。

---

### 缺陷 2：命令式 `for` 循环与嵌套游标泛滥
- **违规事实**：
  - `src/services/assertionEngine.ts`：惊现 3 处双重嵌套 `for` 循环（第 109-116 行、第 129-136 行、第 157-164 行）：
    ```ts
    // src/services/assertionEngine.ts:108-118
    export function detectAstError(outputLines: string[]): string | null {
      for (const line of outputLines) {
        for (const pattern of AST_ERROR_PATTERNS) {
          const match = line.match(pattern)
          if (match) {
            return line.trim()
          }
        }
      }
      return null
    }
    ```
  - `src/server/bridge.ts:67-76`（`broadcast` 函数）：
    ```ts
    let dispatched = 0
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(raw)
        dispatched++
      }
    }
    return dispatched
    ```
  - `src/services/microCompactor.ts:393-398`（`getWalStats`）：
    ```ts
    let totalRawChars = 0
    let totalCompactedChars = 0
    for (const record of this.walRegistry.values()) {
      totalRawChars += record.originalChars
      totalCompactedChars += record.compactedChars
    }
    ```
  - `src/services/transcriptParser.ts:174-545`（`parseTranscript`）：
    一个跨越近 400 行的超长过程式 `for (const rawLine of lines)`，在内部维持 6 个可变状态标志（`let lastEventId`、`let turnCounter`、`let isPiSession` 等），嵌套多层 `for (let i = 0; i < content.length; i++)`，在尾部又用 `for (const event of events)` 进行对象原地篡改修改。
- **违背铁律**：MIND.md 维度 3：“命令式 for 循环与中途可变终结：‘首先我就不喜欢 for。我喜欢后者，先处理成型再统一判定，或者有错了就直接中断。’ 集合先行与 Fail-Fast 中断（替代 for）：靠 `map / filter / find / some / every / reduce` 把集合声明式塑形到目标形态，再做单点判定或落盘，绝不写 `for` + `push` 边扫边攒”。

---

### 缺陷 3：灾难级防御八股与属性猜谜（妥协伪兼容）
- **违规事实**：
  - `src/server/bridge.ts:207-250`（`/api/gate/prompt` 处理器）：
    为了兼容 4 种不同客户端传参形态（直接传 `GatePromptPayload`、包装传 `{ gatePayload: ... }`、平铺传 `command/explanation`、甚至只传 `{ nodeId: 'direct-gate-node' }`），写出了长达 45 行层层嵌套三元与 `'key' in body` 的防御八股：
    ```ts
    // src/server/bridge.ts:207-240
    const rawPayload = 'gatePayload' in body && body.gatePayload ? body.gatePayload : body
    const gateId =
      rawPayload.gateId ||
      ('gateId' in body && typeof body.gateId === 'string' ? body.gateId : undefined) ||
      `gate-${Date.now()}`

    const title =
      rawPayload.title ||
      ('title' in body && typeof body.title === 'string' ? body.title : undefined) ||
      '决策门禁待审 (HITL)'

    const rawAction =
      ('proposedAction' in rawPayload && rawPayload.proposedAction) ||
      ('proposedAction' in body && body.proposedAction) ||
      undefined

    const proposedAction = {
      command:
        (rawAction && typeof rawAction.command === 'string' ? rawAction.command : '') ||
        ('command' in body && typeof body.command === 'string' ? body.command : '') ||
        '',
      ...
    }
    ```
  - **`Array.isArray` 重复防御八股**：
    `src/types/telemetry.ts` 已经产出了强契约 `normalizeObservationOutput(obs.output): string[]`。但是在消费端：
    - `src/pages/SessionReplayPage.tsx:716, 781`：JSX 中依然散落 `{Array.isArray(sub.observation.output) ? (...) : (...)}`；
    - `src/services/transcriptParser.ts:859`：刚完成归一化，立刻又写 `const outputLines = Array.isArray(ev.observation.output) ? ev.observation.output : [String(ev.observation.output)]`；
    - `src/services/microCompactor.ts`：在 `isCompactionNeeded`、`normalizeOutputToLines`、`compactToolLines`、`compactToolOutput` 等 5 个函数中反反复复 `if (Array.isArray(output))`。
- **违背铁律**：MIND.md 维度 3：“契约信任与第一性直给：上游已有格式保证，下游坚决信任直接解构，严禁无脑防御八股（业务层严禁到处散落 `Array.isArray` 与嵌套三元）；源头契约优先于下游妥协：坚决禁止在消费端手写深度递归修补，必须从源头消灭脏数据”。

---

### 缺陷 4：类面向对象残余 vs 函数式查表缺失
- **违规事实**：
  - `src/services/gateManager.ts` (`class GateManager`)
  - `src/services/assertionEngine.ts` (`class AssertionEngine`)
  - `src/services/microCompactor.ts` (`class MicroCompactor`)
  三个服务均被写成了包含 `private Map`、`private counter` 的传统类。全系统没有任何继承结构，纯属“伪面向对象包装”。
  对比 `src/client/reporter.ts`，后者证明了使用 TypeScript 函数式闭包工厂（`createReporter`）返回不可变 API 句柄远比 Class 更干净利落。
  - **50 行级联 `if/else` 弃用扁平查表法**：
    `src/services/transcriptParser.ts:48-100`（`mapToolNameToGesture`）：
    ```ts
    // src/services/transcriptParser.ts:48-100
    if (name === 'bash' || name === 'exec' || name === 'command' || name === 'terminal' || name === 'sh') {
      return 'bash'
    }
    if (name === 'edit' || name === 'write' || name === 'notebookedit' || name === 'patch' || name === 'apply_diff') {
      return 'edit'
    }
    if (name === 'read' || name === 'grep' || name === 'glob' || name === 'find' || ...) {
      return 'read'
    }
    ...
    ```
- **违背铁律**：MIND.md 维度 3：“工程函数式原则（平实查表）：用单一扁平 Dictionary/Map 消除复杂 if/else 与冗余中间变量；坚决拒绝晦涩元组、嵌套类型体操与 point-free 堆砌，优雅与日常可读性并重”。

---

### 缺陷 5：天书正则与关键词兜底的自我否定
- **违规事实**：
  `src/services/assertionEngine.ts` 声明了 13 条包含各类晦涩分组的高危正则（如 `/\brm\s+-[a-zA-Z]*r[a-zA-Z]*f\b/i`、`/\bdel\s+\/[a-zA-Z0-9\s]*\b/i`）。
  但紧接着在第 88-101 行，又写了一大串小写字符串判断：
  ```ts
  // src/services/assertionEngine.ts:88-101
  const lower = trimmed.toLowerCase()
  if (lower.includes('git commit') || lower.includes('git push')) return { matched: true, pattern: 'git commit/push' }
  if (lower.includes('rm -rf') || lower.includes('rm -r')) return { matched: true, pattern: 'rm -rf' }
  if (lower.includes('drop table') || lower.includes('drop database')) return { matched: true, pattern: 'drop table' }
  if (lower.includes('truncate table')) return { matched: true, pattern: 'truncate table' }
  ```
  如果上游正则有效，为何还要在下游手写如此简陋的 `includes`？这反映出对生搓复杂正则的极度心虚，形成了“既手搓天书正则，又手搓胶水补丁”的负向叠加。
- **违背铁律**：MIND.md 维度 3：“手写难读易错的生涩天书正则：生理性反感手搓晦涩的边缘正则，推崇现代前端基建通用语言（如 picomatch 的 glob 声明式匹配）；代码即文档，直觉且具备工业级鲁棒性”。

---

### 缺陷 6：`pathe` 武器库闲置与手动正则切片
- **违规事实**：
  `package.json` 中明确声明了 `"pathe": "^2.0.3"`。但全工程只有 `transcriptParser.ts` 引入了单一的 `basename`。
  `src/client/reporter.ts:109` 中，处理 URL/路径依然在手搓正则：
  ```ts
  const endpoint = (config.endpoint || 'http://127.0.0.1:4560').replace(/\/+$/, '')
  ```
  而在多处解析文件路径参数时（`args.path || args.file_path || args.filePath`），未做统一的 `pathe.normalize` 规约，跨平台（Windows 反斜杠 `\` 与 POSIX `/`）存在隐式隐患。
- **违背铁律**：MIND.md 维度 3：“武器库第一性优先于手搓路径字符串 (Weaponry First)：严禁手写 `.replace(/\\/g, "/")` 或暴力截取前缀；统一使用 pathe 工业级原生原语（normalize、relative、basename）处理全系统路径”。

---

## 四、具体重构建议清单与代码 Diff 样例 (Actionable Refactoring Diffs)

---

### 样例 1：`src/server/bridge.ts` —— 依托 `radash.tryit` 消灭原生 `try/catch` 与防御八股

#### 存在问题
1. 原生 `try/catch` 散落，甚至在 WebSocket 消息处理中使用吞异常的空 `catch {}`；
2. `/api/gate/prompt` 存在 45 行层层嵌套三元，充斥 `'key' in body` 属性猜谜；
3. `broadcast` 使用命令式 `for` 循环与 `let dispatched = 0` 计数。

#### 重构后代码 Diff 样例
```diff
--- a/src/server/bridge.ts
+++ b/src/server/bridge.ts
@@ -1,5 +1,6 @@
 import { Hono } from 'hono'
 import { cors } from 'hono/cors'
+import { tryit } from 'radash'
 import { serve, type ServerType } from '@hono/node-server'
 import { createNodeWebSocket, type NodeWebSocket } from '@hono/node-ws'
 import { WebSocket } from 'ws'
@@ -64,15 +65,11 @@ export function createBridgeApp(options: {
   /**
    * 广播事件至所有已建立连接且活跃的 Web UI WebSocket 客户端
+   * 纯函数集合操作，消灭命令式 for 循环与可变计数器
    */
   const broadcast = (data: TelemetryEvent | Record<string, unknown>): number => {
     const raw = typeof data === 'string' ? data : JSON.stringify(data)
-    let dispatched = 0
-    for (const client of wss.clients) {
-      if (client.readyState === WebSocket.OPEN) {
-        client.send(raw)
-        dispatched++
-      }
-    }
-    return dispatched
+    const activeClients = Array.from(wss.clients).filter((c) => c.readyState === WebSocket.OPEN)
+    activeClients.forEach((client) => client.send(raw))
+    return activeClients.length
   }
 
@@ -88,4 +85,4 @@ export function createBridgeApp(options: {
   // 2. 外部 Agent 遥测流式事件摄入端点 (POST /api/telemetry)
   app.post('/api/telemetry', async (c) => {
-    try {
-      const body = await c.req.json<TelemetryEvent | { event: TelemetryEvent }>()
+    const [jsonErr, body] = await tryit(() => c.req.json<TelemetryEvent | { event: TelemetryEvent }>())()
+    if (jsonErr || !body) {
+      return c.json({ ok: false, error: jsonErr?.message || 'Invalid JSON body' }, 400)
+    }
       const rawEvent: TelemetryEvent = 'event' in body && body.event ? body.event : (body as TelemetryEvent)
 
       if (!rawEvent || !rawEvent.type || !rawEvent.nodeId) {
@@ -174,4 +171,1 @@
       return c.json({ ok: true, deliveredClients: delivered, nodeId: normalizedEvent.nodeId })
-    } catch (err) {
-      const message = err instanceof Error ? err.message : 'Failed to parse telemetry body'
-      return c.json({ ok: false, error: message }, 400)
-    }
   })

@@ -183,68 +177,25 @@ export function createBridgeApp(options: {
   // 3. Agent 协程门禁挂起请求 (POST /api/gate/prompt)
   app.post('/api/gate/prompt', async (c) => {
-    try {
-      const body = await c.req.json<any>()
-      // 45 行层层嵌套三元与 'key' in body 属性猜谜...
-      const rawPayload = 'gatePayload' in body && body.gatePayload ? body.gatePayload : body
-      ...
+    const [jsonErr, body] = await tryit(() => c.req.json<Record<string, unknown>>())()
+    if (jsonErr || !body) {
+      return c.json({ action: 'reject', feedback: 'Invalid JSON body' } satisfies GateDecision, 400)
+    }
+
+    // 第一性契约直给归一化：消灭 45 行防御八股
+    const gatePayload = resolveGatePromptPayload(body)
+    const decisionPromise = gateManager.registerGate(gatePayload)
+    ...
+    const decision = await decisionPromise
+    return c.json(decision)
   })
```

---

### 样例 2：`src/services/assertionEngine.ts` —— 消除双重嵌套 `for` 循环与原生 `try/catch`

#### 存在问题
1. `detectAstError`、`detectTimeoutOrDeadlock`、`detectSchemaError` 均手写双重嵌套 `for` 循环；
2. `detectSchemaError` 使用原生 `try/catch` 包裹 `validator`；
3. 命令检测既写复杂正则，又在下游写 `lower.includes(...)`。

#### 重构后代码 Diff 样例
```diff
--- a/src/services/assertionEngine.ts
+++ b/src/services/assertionEngine.ts
@@ -1,4 +1,5 @@
 import type {
   AssertionResult,
   TelemetryEvent,
   TelemetryGesture,
   TelemetryObservation,
   TelemetryStatus,
 } from '../types/telemetry'
 import { normalizeObservationOutput } from '../types/telemetry'
+import { tryit } from 'radash'
 
@@ -107,12 +108,6 @@ export function matchHighRiskCommand(command: string): { matched: boolean; patte
 /**
  * 检测输出中是否存在 AST 语法树异常
+ * 函数式声明式直给：消灭双重嵌套 for 循环
  */
 export function detectAstError(outputLines: string[]): string | null {
-  for (const line of outputLines) {
-    for (const pattern of AST_ERROR_PATTERNS) {
-      const match = line.match(pattern)
-      if (match) {
-        return line.trim()
-      }
-    }
-  }
-  return null
+  const matchedLine = outputLines.find((line) =>
+    AST_ERROR_PATTERNS.some((pattern) => pattern.test(line))
+  )
+  return matchedLine ? matchedLine.trim() : null
 }
 
@@ -122,18 +117,11 @@ export function detectAstError(outputLines: string[]): string | null {
 /**
  * 检测输出中是否存在超时或死锁异常
+ * 集合先行 + Fail-Fast
  */
 export function detectTimeoutOrDeadlock(outputLines: string[], exitCode?: number): string | null {
   if (exitCode === 124 || exitCode === 143) {
     return `Process terminated by timeout (exit code ${exitCode})`
   }
-  for (const line of outputLines) {
-    for (const pattern of TIMEOUT_DEADLOCK_PATTERNS) {
-      const match = line.match(pattern)
-      if (match) {
-        return line.trim()
-      }
-    }
-  }
-  return null
+  const matched = outputLines.find((line) =>
+    TIMEOUT_DEADLOCK_PATTERNS.some((p) => p.test(line))
+  )
+  return matched ? matched.trim() : null
 }
 
@@ -142,26 +130,17 @@ export function detectTimeoutOrDeadlock(outputLines: string[], exitCode?: number
 /**
  * 检测输出或 Payload 中是否存在 Schema 校验异常
+ * radash.tryit 优雅解构，消灭原生 try/catch 与嵌套 for
  */
 export function detectSchemaError(
   outputLines: string[],
   payload?: Record<string, unknown>,
   validator?: (data: unknown) => boolean
 ): string | null {
   if (validator && payload) {
-    try {
-      const valid = validator(payload)
-      if (!valid) return 'Payload failed custom schema validator contract'
-    } catch (err) {
-      return `Payload schema validation exception: ${err instanceof Error ? err.message : String(err)}`
-    }
+    const [err, valid] = tryit(validator)(payload)
+    if (err) return `Payload schema validation exception: ${err.message}`
+    if (!valid) return 'Payload failed custom schema validator contract'
   }
-  for (const line of outputLines) {
-    for (const pattern of SCHEMA_ERROR_PATTERNS) {
-      const match = line.match(pattern)
-      if (match) {
-        return line.trim()
-      }
-    }
-  }
-  return null
+  const matched = outputLines.find((line) =>
+    SCHEMA_ERROR_PATTERNS.some((p) => p.test(line))
+  )
+  return matched ? matched.trim() : null
 }
```

---

### 样例 3：`src/services/transcriptParser.ts` —— 扁平字典查表法消除 50 行 Cascaded `if/else`

#### 存在问题
`mapToolNameToGesture` 手写了 50 行冗长级联 `if (name === ... || name === ...)`。

#### 重构后代码 Diff 样例
```diff
--- a/src/services/transcriptParser.ts
+++ b/src/services/transcriptParser.ts
@@ -41,60 +41,27 @@ export interface ParsedTranscript {
   events: TelemetryEvent[]
 }
 
+/**
+ * 扁平字典映射表：工程函数式查表法消除 50 行 if/else 级联
+ */
+const TOOL_GESTURE_MAP: Readonly<Record<string, TelemetryGesture>> = {
+  bash: 'bash', exec: 'bash', command: 'bash', terminal: 'bash', sh: 'bash',
+  edit: 'edit', write: 'edit', notebookedit: 'edit', patch: 'edit', apply_diff: 'edit',
+  read: 'read', grep: 'read', glob: 'read', find: 'read', source_check: 'read',
+  fetch_content: 'read', web_search: 'read', websearch: 'read', webfetch: 'read',
+  gate: 'gate', askuserquestion: 'gate', approval: 'gate', confirm: 'gate',
+  scratchpad: 'memory', honcho: 'memory',
+}
+
 /**
  * 将工具名称规约为 NetDive 标准手势类型
+ * O(1) 字典查表直给，彻底消灭过程式分支
  */
 export function mapToolNameToGesture(toolName?: string): TelemetryGesture {
   if (!toolName) return 'think'
   const name = toolName.toLowerCase()
-
-  if (name === 'bash' || name === 'exec' || name === 'command' || name === 'terminal' || name === 'sh') {
-    return 'bash'
-  }
-  if (name === 'edit' || name === 'write' || name === 'notebookedit' || name === 'patch' || name === 'apply_diff') {
-    return 'edit'
-  }
-  if (name === 'read' || name === 'grep' || name === 'glob' || name === 'find' || ...) {
-    return 'read'
-  }
-  if (name.startsWith('memory') || name === 'scratchpad' || name === 'honcho') {
-    return 'memory'
-  }
-  if (name === 'gate' || name === 'askuserquestion' || name === 'approval' || name === 'confirm') {
-    return 'gate'
-  }
-  return 'think'
+  if (name.startsWith('memory')) return 'memory'
+  return TOOL_GESTURE_MAP[name] ?? 'think'
 }
```

---

### 样例 4：`src/types/telemetry.ts` —— 消除重复的多层 `Array.isArray` 与递归分支

#### 存在问题
`normalizeObservationOutput` 中存在内外两套几乎完全相同的对象属性提取与分行逻辑（`obj.text`, `obj.content`, `JSON.stringify` 在数组分支和非数组分支各自拷贝了一遍）。

#### 重构后代码 Diff 样例
```diff
--- a/src/types/telemetry.ts
+++ b/src/types/telemetry.ts
@@ -198,49 +198,28 @@ export interface TelemetryObservation {
   [key: string]: unknown
 }
 
+/** 单项元素原子转文本原语 */
+function extractItemToString(item: unknown): string {
+  if (typeof item === 'string') return item
+  if (item && typeof item === 'object') {
+    const obj = item as Record<string, unknown>
+    if (typeof obj.text === 'string') return obj.text
+    if (typeof obj.content === 'string') return obj.content
+    if (typeof obj.message === 'string') return obj.message
+    return JSON.stringify(item)
+  }
+  return item !== undefined && item !== null ? String(item) : ''
+}
+
 /**
  * 安全规约任何形状的工具执行输出为 string[]
- * 彻底消除 output.some / output.map / output.join 不是函数的白屏隐患
+ * 统一归一化为单层集合，消灭内外重复 30 行类型判断八股
  */
 export function normalizeObservationOutput(output: unknown): string[] {
-  if (Array.isArray(output)) {
-    return output.flatMap((item) => {
-      if (typeof item === 'string') {
-        return item.includes('\n') ? item.split(/\r?\n/) : [item]
-      }
-      if (item && typeof item === 'object') {
-        ...
-      }
-      return []
-    })
-  }
-  if (typeof output === 'string') {
-    return output.split(/\r?\n/)
-  }
-  if (output && typeof output === 'object') {
-    ...
-  }
-  return []
+  if (output === null || output === undefined) return []
+  const rawList = Array.isArray(output) ? output : [output]
+  return rawList
+    .map(extractItemToString)
+    .filter(Boolean)
+    .flatMap((str) => (str.includes('\n') ? str.split(/\r?\n/) : [str]))
 }
```

---

### 样例 5：`src/services/microCompactor.ts` —— 函数式不可变累加替代过程式游标

#### 存在问题
在 `getWalStats()` 中手写 `let totalRawChars = 0`，使用 `for..of` 循环逐条累加变动变量。

#### 重构后代码 Diff 样例
```diff
--- a/src/services/microCompactor.ts
+++ b/src/services/microCompactor.ts
@@ -386,18 +386,15 @@ export class MicroCompactor {
   /**
    * 获取 WAL 统计指标 (全量字符、压缩字符、释放字符数)
+   * 声明式集合归约 (Reduce)，消除命令式可变累加变量
    */
   getWalStats(): {
     totalEntries: number
     totalRawChars: number
     totalCompactedChars: number
     totalReclaimedChars: number
   } {
-    let totalRawChars = 0
-    let totalCompactedChars = 0
-    for (const record of this.walRegistry.values()) {
-      totalRawChars += record.originalChars
-      totalCompactedChars += record.compactedChars
-    }
+    const records = Array.from(this.walRegistry.values())
+    const totalRawChars = records.reduce((acc, r) => acc + r.originalChars, 0)
+    const totalCompactedChars = records.reduce((acc, r) => acc + r.compactedChars, 0)
     return {
       totalEntries: this.walRegistry.size,
       totalRawChars,
       totalCompactedChars,
       totalReclaimedChars: Math.max(0, totalRawChars - totalCompactedChars),
     }
   }
```

---

## 五、收工总结与演进建议 (Summary & Next Steps)

1. **优先级 P0：消灭原生 `try/catch` 与防御八股**：
   - 优先对 `src/server/bridge.ts` 与 `src/services/assertionEngine.ts` 执行重构，全面采用 `radash.tryit` 统一错误解构；
   - 提取 `resolveGatePromptPayload` 扁平契约函数，彻底铲除 `/api/gate/prompt` 里的 45 行级联三元。
2. **优先级 P1：清除所有命令式嵌套 `for` 循环**：
   - 改造 `src/services/assertionEngine.ts` 中的 3 处双重嵌套 `for` 为声明式 `outputLines.find(...some...)`；
   - 拆解 `src/services/transcriptParser.ts` 400 行庞大 `parseTranscript`，将其按行解析抽取为独立纯函数映射。
3. **优先级 P2：字典查表法替换 Cascaded `if/else`**：
   - 将 `src/services/transcriptParser.ts` 的 `mapToolNameToGesture` 改为扁平只读字典映射表，直接缩减 70% 代码量。
4. **优先级 P3：服务层逐步去 Class 化 (Factory Closure)**：
   - 参照 `src/client/reporter.ts` 的成功范式，逐步将 `GateManager`、`AssertionEngine` 重构成 `createGateManager()`、`createAssertionEngine()` 函数式工厂，彻底消除伪 Class 与内部可变状态机。
