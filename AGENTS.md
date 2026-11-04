---
type: meta
title: "NetDive AGENTS.md — 局部自包含宪法与开发运维规约"
created: 2026-11-04T22:30:00+08:00
updated: 2026-11-04T22:30:00+08:00
tags: [meta, netdive, architecture, guardrails, cybernetics, telemetry, react-flow]
status: evergreen
---

# NetDive (潜网) — Agent 交互因果拓扑与双向人机门禁控制台

> 🛸 **项目定位**：NetDive 是 Bebop 体系中面向自主智能体 (Autonomous AI Agents) 与数据流水线 (Pipelines) 的**实时因果拓扑可视化、控制论硬断言与双向人机门禁 (HITL) 控制台**。  
> ⚠️ **所有在该仓库工作的 Agent 启动时必读本文件。任何与本文档冲突的局部认知，一律以本文档为准。**

---

## 1. 核心架构与第一性原理 (Architecture & First Principles)

### 1.1 第一性原理推演
1. **控制论的状态可观测性定理（POMDP）**：
   Agent 是运行在部分可观察马尔可夫决策过程中的认知系统。单步的“输入-输出”无法反映真实状态，必须依靠**轨迹拓扑（Trajectory-level DAG）**与**因果链（Causal Links）**实现白盒化状态重构；
2. **计算不可逆性与上下文熵减（Context Entropy Reduction）**：
   Agent 长任务中产生的过渡自白、高频轮询与冗长工具输出单调递增，必然导致注意力稀释。NetDive 的使命是在前端与传输层充当“麦克斯韦妖”，通过**确定性微压缩 (Micro-Compactor)**、**连续调用智能折叠 (Coalescing)** 与 **分层聚焦 (Hierarchical Drilldown)** 主动阻断熵增；
3. **主动缰绳防御优于被动记账 (Active Gate vs Passive APM)**：
   传统的 APM 只能在事后记录灾难。NetDive 通过基于 `Promise.withResolvers()` 的跨进程双向挂起协议，在模型执行高危动作（如 `git commit`、破坏性命令）或发生致命共振（$\ge 2$ 次死循环重复报错）时，**零延迟实施物理挂起并移交人类仲裁**。

---

## 2. 核心模块与物理目录映射 (Workspace Map)

```text
netdive/
├── src/
│   ├── client/              # 【探针层】轻量无状态客户端 SDK (reporter.ts)
│   ├── server/              # 【桥接层】基于 Hono 4.x 的本地伴生 Sidecar (127.0.0.1:4560)
│   │   ├── bridge.ts        # HTTP RPC (门禁挂起/恢复) + WebSocket (流式旁路广播)
│   │   └── index.ts         # 桥接服务入口
│   ├── services/            # 【控制论与算法核心】
│   │   ├── transcriptParser.ts  # JSONL 流水规范化、连续折叠与 React Flow 网格排版
│   │   ├── assertionEngine.ts   # L1 确定性硬断言 (退出码、高危命令、死循环检测)
│   │   └── microCompactor.ts    # Head 15 + Tail 15 确定性微压缩与 WAL 离线指针
│   ├── types/               # 【数据契约】telemetry.ts 强类型定义
│   ├── components/          # 【React Flow 画布原子组件】AgentNode, TurnNode, Scrubber 等
│   └── pages/               # 【多页面工作台矩阵】
│       ├── SessionReplayPage.tsx # 本地 JSONL 会话时光机与平滑运镜
│       └── CompactorLabPage.tsx  # 微压缩与 Prompt Cache 前缀保真实验室
└── openspec/                # 【规约演进提案库】每个重大特性必须立项留档
```

---

## 3. 全局编码审美与工程铁律 (Engineering Aesthetics)

在 NetDive 编写或重构任何代码时，必须严格执行以下红线，绝不允许妥协：

### 3.1 库优先于手搓 (Toolbox-First)
- **路径与文件名**：100% 依托 `pathe`（`basename`, `resolve`, `normalize`），严禁手写斜杠拼接或正则截取；
- **流式与集合变换**：100% 依托 `radash`（`sift`, `unique`, `tryit`, `flat`），严禁手写过程式 `for` 游标、可变累加数组与循环副作用；
- **消灭原生 `try/catch`**：业务层严禁裸写 `try { ... } catch { ... }`，一律使用 `radash.tryit` 解构 `[err, res]`，严禁写出掩耳盗铃式的空 `catch {}`；
- **消灭天书正则与多层嵌套**：模式匹配优先依靠字典扁平查表（如 `TOOL_GESTURE_MAP`）与平实切片，绝不堆叠嵌套捕获组。

### 3.2 契约信任与消灭防御八股
- 上游已在 `types/telemetry.ts` 中规范化的契约（如 `normalizeObservationOutput` 保证返回 `string[]`），下游坚决信任解构，**严禁散落 `Array.isArray` 嵌套三元防御八股**；
- 输入输出转换纯函数必须附带明确的 `@example` 真实 JSON 形状注释（Shape By Example）。

### 3.3 画布性能与瘦节点原则 (Lean View-Model)
- **React Flow 节点轻量化**：塞入 `node.data` 的数据必须保持极简（标题、手势、精简摘要、状态与折叠计数），**绝对严禁把原始 megabyte 级 stdout、完整 payload 冗余存入画布节点**；
- **按需 JIT 读取**：完整遥测事件保留在外部索引（如 `eventsMap: Map<string, TelemetryEvent>`），只有当用户点击特定节点弹出抽屉时，才 JIT 提取全量数据。

---

## 4. 协作工作流与门禁 (Guardrails & Dispatch Protocol)

1. **Orca 编排 Claude Worker 门禁 (重大深水区落地)**：
   - 一旦进入 `openspec/changes/<name>/tasks.md` 的代码落地、跨文件重构或复杂算法状态机时，**当前 Agent 必须履行 Coordinator 职责，通过 Orca Worker 调度 Claude 编写代码与单测**；
   - 本地轻量微调（单文件 <=30 行、配置修改、补 import）可由当前 Agent 就地完成。
2. **测试驱动作为唯一真相源**：
   - 每次功能迭代必须在对应测试文件中补充契约用例（`*.test.ts`）；
   - 执行 `pnpm test` 必须达到 100% 绿灯（146+ Tests 全部通过），`pnpm build` 零类型报错。
3. **Git 提交红线**：
   - **绝对严禁擅自执行 `git commit`**，完成修改与单测验证后，主动出示提交建议并征询人类授权；
   - **绝对严禁擅自执行 `git push`**。

---

## 5. 核心六大手势规约 (The 6 Telemetry Gestures)

NetDive 画布上的所有节点均收敛为六大标准操作手势：
- `think`：紫/灰。大模型内部思考、规划、分解或结构化自白；
- `read`：天蓝。文件读取、代码检视、上下文搜索（grep/glob）、网页探测；
- `edit`：深蓝。代码写入、文件修改、补丁应用；
- `bash`：翠绿。命令行执行、环境命令、终端交互；
- `memory`：丁香紫。长期记忆检索、阿赖耶识（Honcho）沉淀、Scratchpad 存取；
- `gate`：琥珀金。人机决策审批挂起、热纠偏拦截、高危熔断。
