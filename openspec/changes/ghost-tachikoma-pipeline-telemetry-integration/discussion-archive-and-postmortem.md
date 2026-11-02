# 研讨留档：AI Agent 零侵入可观测性、宿主控制平面与工业界最佳实践对账

- **留档日期**: 2026-11-02
- **关联工程**: `NetDive` (控制平面), `Tachikoma` (业务引擎), `Ghost` (知识库底座), `dotagents` (全局中枢)
- **核心议题**: 从“侵入式打点的恶心感”到“工业界标准 W3C Trace Context + 宿主生命周期无感接管”的架构演化与疑难对账

---

## 一、研讨背景与踩坑现场还原

在 NetDive 与 Tachikoma 早期联调中，我们实现了一版 `telemetry.ts`，并在 `Tachikoma` 业务函数（`pipeline.ts`）内层层包裹：
```typescript
// ❌ 早期侵入式打点：导致业务代码被严重污染
export async function refineAndCreateSpark(db, rawInput, options) {
  const input = await tachikomaReporter.step("distill", () => refine(rawInput), {
    title: "语义提纯与分类", actor: "Tachikoma", gesture: "classify"
  });
  const record = await tachikomaReporter.step("persist", () => create(input), {
    title: "落盘", actor: "SQLite", gesture: "disk"
  });
  return record;
}
```

### 用户直击灵魂的质问（核心痛点）：
> “实践证明这套方法确实可以跑通，但我总感觉很恶心呢？首先在 NetDive 这边写了一套 API，然后在项目接入方还要再写一个 `telemetry.ts`，还要侵入业务代码。如果涉及多个项目联动，那一个工作流要在不同地方写一堆这种代码。现在想实现这种可视化的流程控制只能这样做吗？不能从全局的 Pi 系统入手控制吗？”

---

## 二、研讨核心疑问层层推导与权威答辩 (Q&A Audit)

### 疑问 1：既然宿主挂在全局，只要任意工作流调用工具，宿主都能感知到，那怎么区分来源？
- **物理事实**：Pi 宿主环境拥有三大不可伪造的天然上下文指纹：
  1. **工作目录指针 (`ctx.cwd`)**：Tachikoma 执行时物理锁定在 `Desktop/Tachikoma`，Ghost 锁定在 `Desktop/Ghost`；
  2. **会话与通道唯一 ID (`ctx.session.id`)**：微信通道（ClawBot）、终端交互、自动化任务拥有独立的会话流；
  3. **调用命令 AST 静态特征**：宿主拦截到的 `command` 携带明确的执行目标。

### 疑问 2：宿主能感知到子进程内部调大模型吗？既然已有 Magpie 网关，还要套一层代理吗？
- **物理事实**：
  1. 子进程在操作系统中是独立的黑盒，若不加协同，宿主直接隔空看子进程内部确实是盲区；
  2. 但 Tachikoma/Ghost 内部调大模型统一走的是本地 **Magpie 网关（`127.0.0.1:3425`）**；
  3. **绝对严禁搞“代理套代理 (Proxy-in-Proxy)”**：那属于过度工程。Magpie 原生提供了请求账本 API（`GET /v1/magpie/usage/requests`），且支持官方 Gateway Middleware（`onResponse`）。

### 疑问 3：微观细节（本地 Whisper、本地向量、SQLite），宿主不知道怎么办？
- **物理事实**：
  1. 纯本地的进程内计算（如本地跑 C++ Whisper、SQLite 执行）对外部宿主而言不可直接穿透；
  2. **“白盒调试”与“宏观可观测”的界限划分**：
     - 不要把本地每一行 `sqlite.run()` 机械画成卡片，那属于“代码调试器（Debugger）”而非“可观测大盘”；
     - 业务子进程若需汇报阶段耗时，通过**标准输出（Stdout 信令）**打印即可，操作系统管道天然隔离，宿主被动读取，业务零侵入。

### 疑问 4：宿主跑去查账单，怎么知道属于工作流的哪个环节？这不属于宿主主动猜吗？
- **物理事实**：
  - “宿主凭时间戳盲猜最新账单”确实是**极度脆弱且违背解耦原则的伪因果**；
  - 宿主绝不能主动猜业务，必须依赖确定性的链路关联机制。

### 疑问 5：国际工业界（Anthropic、Langfuse）成熟的标杆项目到底是怎么解决这个问题的？
- **真实行业事实（查证 Anthropic 官方源码 `claude-agent-sdk-python#821` 与 OpenTelemetry 标准）**：
  - 全行业公认的黄金标准有且仅有一个：**W3C Trace Context 规范 + OpenTelemetry 环境变量上下文透传（`TRACEPARENT`）**；
  - **宿主启动子进程时**：注入标准环境变量 `TRACEPARENT=00-<trace_id>-<span_id>-01`；
  - **子进程底层 HTTP Client 调 Magpie 时**：仅做一件事——若环境变量存在 `TRACEPARENT`，在 Header 里带上这一行；
  - **Magpie / 网关记录账单**：将 Token 与 Trace ID 绑定；
  - **物理闭环**：宿主拿着 Trace ID 精确对齐，**100% 物理咬合，即使 100 个 Agent 并发执行也绝不串台！**

---

## 三、最终拍板的架构结论：三层漏斗可观测模型 (The 3-Tier Funnel)

```text
 ┌────────────────────────────────────────────────────────────────────────┐
 │ 【层级 1：宏观控制平面 (Pi 宿主 Harness)】                              │
 │  • ~/.pi/agent/extensions/pi-netdive-bridge.ts                         │
 │  • 负责 Agent 生命周期、工具调用因果链构建、高危操作物理硬门禁           │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │ 注入 TRACEPARENT 环境变量
     ┌───────────────────────────────┴───────────────────────────────┐
     ▼                                                               ▼
 ┌──────────────────────────────────────┐  ┌──────────────────────────────────────┐
 │ 【层级 2：模型中枢 (Magpie 网关)】     │  │ 【层级 3：业务执行 (Tachikoma CLI)】 │
 │  • Tachikoma 调模型统一走 Magpie     │  │  • 100% 纯业务逻辑，零遥测 SDK      │
 │  • Magpie 账本记录绑定 Trace ID      │  │  • 本地 Whisper/落盘信息通过 Stdout │
 └──────────────────┬───────────────────┘  └──────────────────┬───────────────────┘
                    │                                         │
                    └────────────────────┬────────────────────┘
                                         ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                   NetDive 实时控制台 (第二屏幕因果大盘)                │
 │  [微信收到链接] ──► [启动 Tachikoma] ──► [Whisper 本地转录 (日志解析)]   │
 │                                                   │                    │
 │  [Ghost 写入]   ◄── [SQLite 归档]    ◄── [Magpie: Gemini 语义提纯]     │
 └────────────────────────────────────────────────────────────────────────┘
```

1. **彻底拔除侵入代码**：Tachikoma 恢复 100% 纯洁，删除所有 `telemetry.ts`；
2. **宏观控制收敛在宿主**：由 Pi 全局 Extension 接管；
3. **模型链路遵循 W3C 国际标准**：通过 `TRACEPARENT` 确定性贯通，拒绝盲猜。
