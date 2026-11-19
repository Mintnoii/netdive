# OpenSpec 提案：trace-to-regression-case (失败会话用例提纯与回归评测工作台)

- **提案代号**：`trace-to-regression-case`
- **创建日期**：2026-11-19
- **更新日期**：2026-11-19 (根据用户心智重塑与白盒化要求深度演进)
- **作者**：qing
- **状态**：`completed`
- **项目目录**：`C:/Users/wangqing/Desktop/netdive`
- **素材源流**：`docs/SESSION_DATA_DIRECTIONS.md`、Ghost 知识库《Agent 决策级可观测性分层体系》、《Agent 评测数据飞轮》

---

## 1. 背景与核心定位重塑

### 1.1 核心痛点与心智纠偏
在原设计中，该模块被定名为「测试对比」（Dual-Trace Diff），引发了严重的心智割裂：
- 用户反馈：“我刚打开页面，手里只有一次执行报错的现场，哪来的两份数据？我跟谁去对比？”
- “对比”只是用户拿着提取到的用例去优化并重跑后，拿重跑新会话进行验证的**最终结果/验收环节**；
- 模块的第一主轴与核心工程价值是：**从失败会话（Failed Trace）中捕获故障特征与断言指纹，抽取提纯为标准的回归测试用例（Trace-to-Eval Benchmark）**。

### 1.2 白盒化诉求与技术同构性
原有抽取过程对用户如同黑盒，缺乏技术可解释性与面试穿透力。实战中“从长会话中剥离巨型输出、保留指针引用”的机制，与 NetDive 在上下文工程演练（Micro-Compactor）中实现的确定性微压缩及 WAL 物理指针引用高度同构（冷热分层与指针解耦）。

因此，本次演进确立三大核心任务：
1. **更名与定位归正**：Tab 与模块统一更名为**「用例提纯」**，定义为“失败会话用例提纯与回归评测工作台”；
2. **5 大实战技术点显性化**：白盒化呈现从杂乱日志到结构化用例的完整流水线；
3. **内置全特性交互式演示用例与一键对账**：消灭纯粹依赖本地零散会话导致无法全面演示技术点的痛点。

---

## 2. 核心技术体系 (The 5 Trace-to-Eval Pillars)

在真实工业级 AI Agent 架构中，将失败 Trace 萃取为回归测试用例包含 5 大核心技术：

1. **故障分级捕获与因果切片 (Fault Attribution & Slicing)**：
   - 区分 L1 物理执行崩溃（退出码非 0）、L2 认知共振死循环（重复调用同一工具 $\ge 2$ 次）与 L3 门禁熔断；
   - 倒查因果 DAG，截取最早暴露出故障的 Run 节点与直接上下文。
2. **失败指纹降噪与签名归一化 (Fingerprint Normalization)**：
   - 过滤动态易变噪声（进程 PID、临时目录路径、随机 UUID、毫秒时间戳）；
   - 提纯规范化规则签名（如 `failed | pnpm test (exit: 1)`）。
3. **证据载荷剥离与 WAL 指针冻结 (Lean Evidence & Blob Offloading)**：
   - 瘦用例契约（Head 5 行摘要），将数万字符的 stdout 卸载为 WAL 离线物理指针（`pointerId`）；
   - 与上下文演练中的 Micro-Compactor 实现技术同构，将单用例体积控制在 5KB 内。
4. **三维复合验收断言合成 (Multi-Dimensional Assertion Synthesis)**：
   - **功能正确性**：原失败指纹完全消除（Pass）；
   - **资源防退化门槛**：峰值 Token 水位与上下文占用率不得恶化超过基线阈值；
   - **过程治理守卫**：门禁拦截次数归零，KV Cache 前缀稳定性维持 stable。
5. **探针嵌入与评测数据飞轮 (Repro Prompt & Automated Verification)**：
   - 自动组装带元数据追踪标签（`<!-- [netdive-case: tag] -->`）的重跑 Prompt；
   - 终端重跑导入后，基于标签与报告差分自动对账判分。

---

## 3. 变更内容与落地设计

- **导航与路由更名**：HeaderNav Tab 从「测试对比」正式修正为「用例提纯」，tooltip 调整为清晰的端到端描述。
- **4 步提纯流水线可视化**：在用例详情面板上半区，以步骤条可视化展示：
  - `Step 1: 故障分级捕获 (L1/L2)` ➔ `Step 2: 规范化指纹去噪` ➔ `Step 3: WAL 载荷剥离` ➔ `Step 4: 三维断言合成`。
- **全特性内置演示数据 (Built-in Demo Case)**：
  - 内置经典样本：`数据清洗管道死循环与微压缩回归 (Data Pipeline Resonance & WAL)`；
  - 完整承载 5 大技术点（双次报错死循环、WAL 指针引用、高水位基线与前缀 volatile）。
- **⚡ 一键模拟重跑对账 (Simulate Repro)**：
  - 为演示用例提供一键注入 Challenger 修复会话的能力，无需去终端跑即可直观查看全绿对账差异（指纹消除、Token 降低 63%、WAL 增量回收）。
- **文档与面试题库同步**：将技术点与第一性推导同步更新至 `docs/INTERVIEW.md`、`docs/SESSION_DATA_DIRECTIONS.md` 与 `README.md`。

---

## 4. 涉及文件

- `openspec/changes/trace-to-regression-case/*` — 提案、设计与任务清单更新
- `src/services/regressionCase.ts` — 用例契约、流水线元数据与模拟对账服务
- `src/services/regressionCaseStore.ts` — 全特性内置种子演示用例更新
- `src/services/regressionCase.test.ts` — 演示用例与单测用例覆盖
- `src/pages/RegressionPage.tsx` — 命名修正、4 步提纯流水线可视化、一键模拟对账
- `src/components/HeaderNav.tsx` — Tab 命名由「测试对比」更名为「用例提纯」
- `src/pages/OverviewPage.tsx` — 概览页 Section 02 文案与图文介绍对齐
- `docs/INTERVIEW.md` / `docs/SESSION_DATA_DIRECTIONS.md` / `README.md` / `CHANGELOG.md` — 统一技术演进留档
