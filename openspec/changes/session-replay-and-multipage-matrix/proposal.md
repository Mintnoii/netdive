# Change Proposal: session-replay-and-multipage-matrix

- **提案状态**: 核心已完成交付 (Tasks 100% Completed & Verified)
- **目标工程**: `NetDive` (面向自主智能体控制论与因果拓扑控制台)
- **关联架构**: OpenSpec 规范驱动开发 (Spec-Driven Development)

---

## 一、技术选型深水区复盘与多方案权衡对比 (Architecture Evaluation)

在开发过程中，针对“如何捕获 Agent 工作流”、“需不需要侵入业务代码”、“需不需要手搓 JSONL 解析”等核心技术选型，进行了第一性原理级别的横向对比与权衡：

### 1. 宿主感知方案对比（如何获取 Agent 运行信息？）

| 方案 | 原理 | 侵入性 | 优点 | 缺点 / 致命痛点 | 适用结论 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **方案 A: 业务项目内侵入打点 (App Instrumentation)** | 每个业务工程手动调 NetDive API 上报 | **极高（严重污染）** | 定制灵活 | 项目代码与控制台强耦合，别的开源项目无法接入 | ❌ **绝对否决** |
| **方案 B: LLM 反向代理网关 (Gateway / Proxy)** *(如 LiteLLM)* | 改 `BASE_URL`，网络层抓包请求与返回 | **0% 零代码侵入** | 兼容多语言与多模型 | **只能看模型说了什么，看不到本地电脑实际发生了什么**（拿不到退出码，无法拦截本地 bash） | 🟡 **仅适合纯 API 监控** |
| **方案 C: 行业标准协议 (OpenTelemetry GenAI)** | 配 `OTEL_EXPORTER` 环境变量上报 Spans | **低（配环境变量）** | 工业级通用标准，主流大厂共建 | **OTel 是单向只读 Tracing 管道，根本不支持“双向跨进程挂起审批（HITL）”** | 🟢 **适合底层标准化兼容** |
| **方案 D: 本地文件会话账本嗅探 (Session Sniffing)** *(Magpie 绝活)* | 后台监听 `~/.pi/agent/sessions/` 追加 | **0% 绝对零侵入** | 终端敲什么，网页自动画图，完全不改项目 | 纯只读回放，拦截高危动作仍需额外 Hook 辅助 | 🟢 **推荐：时光机与无感可观测的核心** |
| **方案 E: 宿主全局扩展 / MCP 代理 (Host-level Hook)** | 装在 `~/.pi/agent/extensions/` 宿主目录 | **业务 0% 侵入**（跟机器走，不跟项目走） | 真正掌握物理执行拦截权，可实现毫秒级 Promise 挂起审批 | 仅限支持插件或 MCP 的宿主运行时 | 🟢 **推荐：高危门禁拦截的核心** |

> **NetDive 终态选型结论**：**双轨制（方案 D + 方案 E）**。
> - **只读因果拓扑与时光机**：走方案 D（Session Sniffing 本地账本消费），做到真正无感、业务零侵入；
> - **高危命令人机门禁 (HITL)**：走方案 E（Host-level Hook），在宿主层拦截危险动作，保证安全闭环。

---

### 2. JSONL 解析技术选型：引入 npm 库（如 ndjson）还是工具函数？

- **社区库现状**：npm 上有 `ndjson`、`jsonl-parse`、`jsonlkit` 等流式库；
- **为什么不引入重型依赖？**
  1. **语法层极简**：JSONL 物理规范纯粹是“换行切片 + JSON.parse”。使用武器库 `radash.tryit` 配合原生 `split` 仅需 1 行代码即可安全提取，无任何依赖负担；
  2. **容错与自愈**：通过 `jsonrepair` 治理意外中断带来的半截畸变 JSON，健壮性远超常规库；
  3. **语义层的不可替代性**：npm 通用库只管字符串转对象，根本无法理解 Pi / Claude 的内部协议（如 `toolCall` 与 `toolResult` 跨轮次关联、`exitCode !== 0` 自愈沉降、连续调用折叠），真正的核心工作 100% 集中在**领域适配层（Domain Adapter）**。

---

## 二、高频面试交锋与破局答辩库 (Interview Defense Battlecard)

### Q1：你们这个 NetDive 控制台，和 Magpie、Langfuse 这种开源大作有什么区别？不也是看日志吗？
> **答辩破局核心**：**被动记账器（Accountant） vs 主动控制平面（Control Plane）的本质区别。**

- **行业现状（Magpie / Langfuse）**：
  本质是“事后分析仪与账单器”。它们在网络层或文件层异步记录日志，只能告诉你“调用了什么、花了多少 Token”。但**它们对执行过程没有任何控制权**——如果模型输出高危指令（如 `rm -rf /` 或无授权提交），传统工具只能眼睁睁看着灾难发生，然后把这笔账记在账单上；在模型死循环时也只能等待全局最大步数超时硬掐。
- **NetDive 的差异化破局点（主动控制论）**：
  NetDive 不做平庸的代理管道，而是做**运行时控制缰绳**：
  1. **双向跨进程挂起（HITL Promise Gate）**：基于 `Promise.withResolvers()` 实现跨进程异步 RPC。遇到 `git commit` 等高危动作，外部 Agent 进程被物理挂起（挂在本地网络调用栈上），必须由人类在前端审查差异并拍板后才放行，做到了零延迟事前阻断；
  2. **L1 确定性硬断言与自愈分叉**：脱离“放任模型自由反思”的幻觉泥潭，通过退出码（`exitCode !== 0`）与 AST 解析，强制将执行流沉降为自愈分支，回归通过后汇流归并主干；
  3. **致命共振熔断（Fatal Failure Resonance）**：相同失败连续捕获 $\ge 2$ 次，强制认定为无效死循环并熔断，从源头拯救 Token 损耗。

---

### Q2：为什么一开始不做“全机自动监听”，而是搞了这套 API 契约？这不是要侵入业务项目吗？
> **答辩破局核心**：**业务层代码绝对零侵入；宿主运行时（Host Runtime）与业务逻辑彻底解耦。**

- **认知陷阱澄清**：
  绝对不能在 Ghost、Tachikoma 等业务项目里一行行写 NetDive 的上报代码，那属于严重的架构污染；
- **工业级解耦方案**：
  业务项目应该对 NetDive 完全无感。控制台的接入点不在业务代码里，而在**宿主执行环境（Host Environment）**：
  1. **会话账本嗅探（Transcript Sniffing，学习 Magpie 的绝活）**：Pi 和 Claude Code 默认会在操作系统家目录（`~/.pi/agent/sessions/`、`~/.claude/projects/`）持久化 JSONL 流水，NetDive 后台仅需监听本地会话文件的追加（`tail -f` 模式），即可实现 **0% 侵入式的全自动拓扑绘制**；
  2. **全局宿主扩展（Global Host Hook / MCP Server）**：在宿主环境（`~/.pi/agent/extensions/`）装载全局钩子，跟机器走、不跟业务走，仅在需要人机门禁拦截时介入，业务代码一尘不染。

---

### Q3：既然已经有 OpenTelemetry（OTel）工业标准，为什么 NetDive 还要有自己的事件定义？
> **答辩破局核心**：**OTel 管“管道通畅度（Tracing）”，管不了“状态机双向交互（Control）”。**

- **OTel 的边界**：
  OpenTelemetry GenAI 规范定义了 `gen_ai.agent.name`、`execute_tool` 等 Span 规范，但它是**单向、异步的只读日志流**；
- **控制平面的刚需**：
  Agent 在运行循环中，需要**动态参数热纠偏（Human Steering）**、**带反思分支的树状因果拓扑**和**跨进程挂起审批**。这些双向交互在 OTel 标准协议中并不存在；
- **NetDive 的最佳实践**：
  底层提供兼容 OTel `/v1/traces` 的通用摄入网关；上层通过 Sidecar RPC 保持自主控制论的极致响应能力。

---

## 三、NetDive 多页面技术矩阵蓝图 (Multi-Page Architecture)

为了避免将所有实验性技术强行塞进单一页面导致代码臃肿与互相污染，NetDive 正式确立**「多页面技术实验室矩阵」**架构：

```text
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      NetDive 技术工作台 (Studio)                        │
 ├───────────────────┬──────────────────────────┬─────────────────────────┤
 │ 页面 1: 实时控制台 │ 页面 2: 会话时光机        │ 页面 3: 上下文热力学    │
 │ (Live Console)    │ (Session Replay)         │ (Compactor Lab)         │
 ├───────────────────┼──────────────────────────┼─────────────────────────┤
 │ · React Flow 因果 │ · 消费本地真实 JSONL     │ · Head 15 + Tail 15     │
 │ · L1 确定性硬断言 │ · 离线几十万字长日志分块 │   差分微压缩对比        │
 │ · HITL 跨进程门禁 │ · 时间轴进度条无感回放   │ · WAL 离线指针检索与重放 │
 │ · 演示沙盒/实测切换│ · 连续工具调用智能折叠   │ · Prompt Cache 前缀验证 │
 └───────────────────┴──────────────────────────┴─────────────────────────┘
```

---

## 四、实施完成工单与交付物对账 (Delivery Verification)

### Milestone: Session Replay (会话时光机) 独立页面与单点落地
- [x] **Task 1: Transcript 规范化解析器 (`src/services/transcriptParser.ts`)**
  - [x] 支持解析 Pi Agent 与 Claude Code 原生 JSONL 会话流；
  - [x] 提取 `session` 元数据、`thought` 思考步骤、`tool_call`（bash/edit/read）与 `tool_result`；
  - [x] 自动识别 `exitCode !== 0` 生成自愈分叉与因果父子重定向；
  - [x] 提炼 `formatNodeSummary()` 强防线，彻底消除 `[object Object]` 坏味道。
- [x] **Task 2: 连续工具调用智能聚合折叠 (`aggregateConsecutiveToolEvents`)**
  - [x] 自动合并连续同文件 `read`/`edit` 与同类 `bash` 批处理命令，生成 `×N` 胶囊标记；
  - [x] 故障隔离守卫：任何异常或自愈分支绝对不参与折叠，保持 100% 可见；
  - [x] 重构后续节点 `parentId`，保证 DAG 因果线完好连贯。
- [x] **Task 3: 轻量单页 Tab 导航栏 (`src/components/HeaderNav.tsx`)**
  - [x] 提供 `实时控制台 (Live)` 与 `会话时光机 (Replay)` 双页面极简切换；
  - [x] 状态完全隔离，互不干扰污染。
- [x] **Task 4: 会话时光机页面与交互高精度防抖 (`src/pages/SessionReplayPage.tsx`)**
  - [x] 支持本地 `~/.pi/agent/sessions/*.jsonl` 文件点击上传与鼠标拖拽入画布秒级解析；
  - [x] 进度比率锁定（Progress Ratio Lock）：切换折叠模式或播放倍速时，滑块与小圆点物理百分比绝对稳固，零跳动；
  - [x] 布局防抖：步数容器固定等宽 `tabular-nums`，当前步概要固定 `w-72`，彻底杜绝文本长短变动挤压进度条；
  - [x] 自动运镜追焦（Auto-Pan Tracking）：播放时基于 `useReactFlow` 自动平滑追焦最新卡片，用户手动点选时自动锁定停止拉扯；
  - [x] 因果检查器（Inspector Drawer）：右侧抽屉支持查看子调用清单，工具参数与节点摘要均支持一键 Copy 复制。
- [x] **Task 5: 全量单测与代码质检**
  - [x] `src/services/transcriptParser.test.ts` 扩充至覆盖聚合折叠、磁盘真实文件解析、比率稳定机制；
  - [x] 全仓 **86 项单测 100% 绿灯全过**；
  - [x] `pnpm build`（Vite + TypeScript 5 严格检查）0 报错，`oxlint` 0 警告。
