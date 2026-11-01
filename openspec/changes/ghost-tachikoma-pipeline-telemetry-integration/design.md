# Technical Decision Record: ghost-tachikoma-pipeline-telemetry-integration

- **文档类型**: 技术选型与架构决策 (TDR / OpenSpec Design)
- **核心议题**: 如何在零侵入、零业务污染的前提下，将 Ghost 知识库流水线与 Tachikoma 情报摄入引擎接入 NetDive 控制平面？

---

## 1. 核心技术选型对抗与拍板 (Trade-offs & Decisions)

### 决策点 1: 客户端数据上报方式（Invasive Tracing vs Fail-Silent Reporter）
| 备选方案 | 优点 | 致命缺陷 | 结论 |
|---|---|---|---|
| **方案 A: 引入重型 OpenTelemetry SDK (`@opentelemetry/api`)** | 行业标准规范，生态庞大 | 依赖极重（包含大量上下文追踪器、Exporter 包），严重污染轻量命令行脚本，体积膨胀几十兆 | ❌ 坚决否决 |
| **方案 B: 业务代码直接写死的 `fetch('http://localhost:4560/...')`** | 零依赖，直接粗暴 | 强侵入性！如果 NetDive 没开，业务脚本直接炸掉或狂喷网络 ECONNREFUSED 错误 | ❌ 坚决否决 |
| **方案 C: 自研轻量纯 TS 零依赖 Fail-Silent Reporter (`netdive-reporter`)** | **1. 零依赖、单文件纯 TS；<br>2. 静态探活与自动静默熔断；<br>3. 业务代码只需声明 `await reporter.step(...)` 或包裹执行** | 需要自己维护一套约 100 行的简洁契约 | **✅ 最终拍板 (Winner)** |

> **关键契约设计 (Fail-Silent)**：
> Reporter 内部使用 `radash.tryit`，先进行单次 50ms 端口探活。如果 NetDive Bridge 离线，Reporter 自动切换为“静默无操作（No-op）模式”，所有 `step()`、`gate()` 立即透传原函数返回值，**业务流水线 100% 毫无察觉、零报错、零等待**！

---

### 决策点 2: 控制平面阻塞模式（WebSocket RPC vs HTTP Pending Polling）
| 备选方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **方案 A: 纯 WebSocket 双向 RPC** | 实时性极高 | CLI 脚本生命周期短暂，维持持久长连接复杂度高，进程退出时连接清理容易悬挂 | 放弃 |
| **方案 B: 现代 HTTP POST + Node.js `Promise.withResolvers` (挂起等待)** | **1. 契合 CLI 脚本执行模型；<br>2. 桥接端天然支持超时自愈；<br>3. 前端界面与 CLI 解耦极度清晰** | 依赖 NetDive Bridge 充当消息中转中心 | **✅ 最终拍板 (Winner)** |

> **执行机制**：
> 1. Ghost/Tachikoma 遇到破坏性写盘时，调用 `await reporter.gate({ action: 'wiki_merge', summary: '合并双胞胎概念' })`；
> 2. 向 `http://127.0.0.1:4560/api/gate/prompt` 发起异步 HTTP 请求；
> 3. Hono Bridge 挂起该 HTTP 连接（内部持有 Promise resolver），同时向网页前端 WebSocket 广播弹出高危红框；
> 4. 人类在浏览器点击“批准”，Bridge 调用 resolver 返回 HTTP 200 `{ decision: 'approved' }`；Ghost 瞬间恢复执行完成物理写盘！

---

### 决策点 3: 架构拓扑映射设计（DAG 渲染规范）
- **Tachikoma 抓取链路**：
  `[输入 URL]` ➔ `[Tier 1: Fast-HTTP 直通]` ──(若遇反爬)──► `[Tier 2: 浏览器渲染降级]` ➔ `[LLM 标签分类]` ➔ `[Ghost _raw 落盘]`
- **Ghost 炼化链路**：
  `[读取素材]` ➔ `[模型提纯]` ➔ `[validator 出厂断言]` ──(若遇近义概念)──► `[自愈分支: 概念退火/合并]` ➔ `[🛑 HITL 写盘门禁]` ➔ `[原子更新 wiki & MOC]`
