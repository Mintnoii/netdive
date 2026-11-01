# NetDive (潜网)

> 面向自主智能体 (Autonomous AI Agents) 与复杂流水线 (Pipelines) 的实时因果拓扑、控制论断言与双向人机门禁 (Human-in-the-Loop) 控制台。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript 5.x](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React 19](https://img.shields.io/badge/React-19.x-61dafb?logo=react)](https://react.dev/)
[![Hono 4.x](https://img.shields.io/badge/Hono-4.x-E36002?logo=hono)](https://hono.dev/)
[![Build & Tests](https://img.shields.io/badge/Tests-86%20Passed%20(100%25)-brightgreen)]()

---

![NetDive 控制台界面全景](./public/netdive-preview.png)
*图 1：NetDive 单向因果主干拓扑、ReAct 错误自愈分叉与上下文剪枝审查抽屉联动全景*

![NetDive 会话时光机界面](./public/session-replay-autopan-preview.png)
*图 2：NetDive 会话时光机 (Session Replay)：解析本地真实 JSONL 会话流、智能连续调用聚合折叠 (Folding) 与时间轴无感回放*

---

## 核心定位与设计哲学

在长程自主 Agent（如 Coding Agent、复杂搜索编排）与数据流水线（如知识库自动化摄入、向量构建、多模态清洗）的真实生产落地中，传统的终端日志输出与被动 APM 监控面临三大本质困境：

1. **状态黑盒与因果失真**：多轮 ReAct 循环中，意图决策、工具调用与物理环境副作用混杂在巨量字符流里，难以辨识因果主干；
2. **被动记账无法阻止灾难**：现有 APM（如 Langfuse、传统网关）只能“事后记账”，面对模型产生的高危破坏性动作（如未授权代码提交、删库、越权操作）缺乏零延迟的跨进程双向硬拦截手段；
3. **连续调用的视觉雪崩**：长任务中频繁出现的连续读取同文件、批量工具执行拉出长达数米的“贪吃蛇”节点，严重淹没系统真正的异常与转折；
4. **上下文热力学膨胀**：超长工具标准输出迅速挤占有限上下文，破坏 KV Cache 并引发昂贵的推理重算与截断崩溃。

**NetDive 的第一性原理：拒绝平庸的被动日志记录，构建具备主动控制论（Cybernetics）的白盒潜望镜与安全缰绳控制台。**

---

## 核心系统架构矩阵 (Studio Architecture)

NetDive 采用多页面实验室（Studio Matrix）架构，将不同层级的主动控制与可观测能力正交解耦：

```text
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      NetDive 控制台工作台 (Studio)                      │
 ├───────────────────┬──────────────────────────┬─────────────────────────┤
 │ 页面 1: 实时控制台 │ 页面 2: 会话时光机        │ 页面 3: 工业级观测实验室 │
 │ (Live Console)    │ (Session Replay)         │ (Compactor & OTel Lab)  │
 ├───────────────────┼──────────────────────────┼─────────────────────────┤
 │ · React Flow 因果 │ · 本地 Pi/Claude JSONL   │ · OpenTelemetry 标准兼容│
 │ · L1 确定性硬断言 │   文件拖拽与秒级流式解析 │ · Head 15 + Tail 15     │
 │ · HITL 跨进程门禁 │ · 连续工具智能聚合折叠   │   确定性微压缩 (零Token) │
 │ · 致命共振自动熔断│ · 进度比率锁定时间轴     │ · WAL 离线指针检索与重放 │
 │ · 双模自动感知沙盒│ · 平滑运镜追焦 (Auto-Pan)│ · Prompt Cache 前缀保真 │
 └───────────────────┴──────────────────────────┴─────────────────────────┘
                                ▲
                                │ 双轨信道：HTTP (RPC 阻塞) / WebSocket (流式旁路)
                                ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │              Local Sidecar Bridge (Hono 跨进程宿主伴生服务)            │
 └────────────────────────────────────────────────────────────────────────┘
                                ▲
                                │ 宿主环境生命周期钩子 / 本地 Session 监听
                                ▼
      自主智能体工作流 (Pi / Claude Code / Ghost & Tachikoma Pipelines)
```

---

## 核心技术点解析

### 1. 双向人机审批门禁 (Human-in-the-Loop Promise Gate)
- **跨进程异步挂起**：基于 JavaScript 原生 `Promise.withResolvers()` 实现跨进程异步 RPC。当外部 Agent 触发 `git commit`、敏感写操作或高危指令时，调用方被物理阻塞挂起，前端居中唤起高危审批模态窗，操作员拍板放行或附加热纠偏指令（Steering）后方恢复执行；
- **致命共振熔断 (Fatal Failure Resonance)**：当同一异常特征连续捕获 $\ge 2$ 次时，系统自动判定为死循环死锁并强制触发紧急熔断门禁，彻底阻断 Token 损耗。

### 2. L1 确定性硬断言与 ReAct 自愈分叉
- **退出码与 AST 硬拦截**：脱离“放任大模型自由反思”的幻觉泥潭。工具执行返回时，引擎首先执行 L1 确定性规则审查（`exitCode !== 0`、语法报错、超时）；
- **自愈拓扑沉降**：未通过断言的节点自动标记为异常，执行流沉降为下方的**琥珀金自愈分支**，待修复补丁通过单测验证（`exitCode: 0`）后，平滑连回主干，形成闭环因果图。

### 3. 会话时光机与连续调用智能折叠 (Session Replay & Tool Folding)
- **零侵入会话解析引擎**：内置高性能原生解析器，无需修改任何业务代码，直接消费本地 `~/.pi/agent/sessions/*.jsonl` 或 Claude Code 历史会话；
- **智能聚合折叠 (Folding)**：针对连续多次读取同文件或连续批处理命令，自动融合为带 `×N` 胶囊标记的多层物理叠纸卡片（Stacked Sheets）；
- **异常强隔离守卫**：序列中只要出现失败调用，算法自动切断折叠并单独突显自愈节点，杜绝掩盖故障；
- **时钟比率锁定与平滑运镜**：切换折叠或回放倍速时，进度滑块物理百分比纹丝不动；回放时镜头平滑跟随最新执行卡片，用户手动审查时自动暂停追焦。

### 4. 上下文热力学与确定性微压缩 (Micro-Compactor)
- **本地零 Token 开销**：对超过 40 行或 1500 字符的冗长输出，采用确定性 Head 15 + Tail 15 保留截断，平均降低 80% 的单步上下文开销；
- **协议配对校验**：严格校验 `tool_call_id` 与工具返回的闭合对应关系，防止孤儿节点引发 HTTP 400 崩溃；
- **Prompt Cache 前缀保真**：在压缩执行历史的同时，严格保证 System Prompt 与长程记忆在字节级不变，充分复用模型供应商的 KV Cache 优惠。

---

## 快速上手

### 环境要求
- Node.js >= 20.0.0
- pnpm >= 9.0.0

### 安装依赖
```bash
git clone https://github.com/Mintnoii/netdive.git
cd netdive
pnpm install
```

### 运行环境

#### 模式 A：启动前端交互控制台 (开发/沙盒体验)
```bash
pnpm dev
```
打开浏览器访问 `http://localhost:5173`。
- **页面 1：实时拓扑 (Live Console)**：体验单向主干推进、ReAct 自愈分叉演练、上下文微压缩抽屉审查与双向门禁；
- **页面 2：会话时光机 (Session Replay)**：点击上方「加载真实样本」，或者直接**把电脑上的任意 `.jsonl` 拖入画布**，通过时间轴播放器像看电影一样回放完整执行拓扑！

#### 模式 B：启动跨进程 Local Bridge (接入本地真实 Agent / 流水线)
```bash
pnpm start
# 或 pnpm run server
```
Hono 跨进程伴生服务将运行在 `127.0.0.1:4560`，支持 WebSocket 实时遥测广播与双向门禁 RPC。

#### 运行端到端工作流实测
保持控制台运行，在另一个终端执行：
```bash
pnpm test:workflow
```
体验真实的 Agent 规划、环境探测、高危门禁网页端挂起与审批放行全流程！

---

## 自动化测试与工程质量

全仓包含 **86 项深度单元与集成测试**，覆盖 Bridge RPC 挂起、L1 确定性硬断言、WAL 离线指针、Prompt Caching 稳定性及 JSONL 聚合折叠算法：

```bash
# 执行全量单元测试 (86 passed, 100%)
pnpm test

# 代码风格与语法检查 (OxLint 零警告)
pnpm lint

# 生产级构建打包 (TypeScript 严格类型检查)
pnpm build
```

---

## 技术栈与选型

- **拓扑编排**：`@xyflow/react` (React Flow 12)
- **前端视图**：`React 19` + `TypeScript 5` + `Vite 8` + `Tailwind CSS 4`
- **伴生网关**：`Hono 4` + `@hono/node-server` + `@hono/node-ws` + `ws`
- **基础工具**：`pathe` + `radash`
- **代码质检**：`oxlint` (极速 Rust 静态分析器)

---

## 开源协议

本项目基于 [MIT 许可证](LICENSE) 开源。
