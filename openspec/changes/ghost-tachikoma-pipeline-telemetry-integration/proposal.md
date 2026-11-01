# Change Proposal: ghost-tachikoma-pipeline-telemetry-integration

- **提案状态**: 规划立项中 (Planned / In Progress)
- **目标工程**: `NetDive` (控制平面) & `Ghost` / `Tachikoma` (业务流水线数据面)
- **关联架构**: OpenSpec 规范驱动开发 (Spec-Driven Development)

---

## 一、为什么要做阶段二 (Why)

### 1. 从“单点自嗨”走向“真实生产狗粮 (Dogfooding)”
在阶段一中，NetDive 已经具备了：
- **页面 1 (Live Console)**：单向因果主干 DAG、L1 硬断言、ReAct 自愈分叉与 Promise 跨进程决策门禁；
- **页面 2 (Session Replay)**：本地真实 JSONL 会话流解析、连续工具调用智能折叠（Folding）、进度比率锁定与平滑运镜。

但这依然属于“控制台单侧就绪”。依照全机最高工程准则，自研系统必须在日常生产中自己先用起来：
**必须让 NetDive 真正连接并点亮你自己的第二大脑（Ghost 知识库炼化）与多模态情报引擎（Tachikoma 抓取）！**

### 2. 核心解决的真实业务痛点
- **Ghost 炼化状态黑盒**：执行公众号/推文炼化时，终端往往滚动上百行日志，究竟进行到哪一步（提取标签、概念合并、双链更新还是写盘）缺乏全局因果直观透视；
- **高危写盘动作缺乏硬拦截**：当知识库生成破坏性操作（如批量退火下线、双胞胎概念合并重写全库双链）时，需要人类在第二块屏幕上审查真实差异（Diff）并一键审批放行；
- **Tachikoma 多模态抓取追踪**：清晰透视 Fast-HTTP、浏览器降级、OCR、Whisper 转录各阶段的耗时与重试自愈分支。

---

## 二、架构设计与系统边界 (Architecture & Boundaries)

遵循在阶段一中确立的 **“宿主/流水线与业务完全解耦”** 原则：

```text
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      Ghost / Tachikoma 执行运行时                      │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │
           极轻量无阻断 Reporter 挂载 (可配置启用，NetDive 不在线时静默跳过)
                                     │
        ┌────────────────────────────┴────────────────────────────┐
        ▼                                                         ▼
   【数据平面 Data Plane (异步流)】                      【控制平面 Control Plane (同步阻塞)】
   · 协议：HTTP / WebSocket                              · 协议：HTTP POST /api/gate/prompt
   · 事件：pipeline_step_start / complete                · 场景：高危批量写盘 / 概念合并 / Git 提交
   · 载荷：提取概念、标签、耗时、阶段                         · 行为：外部流水线暂停挂起，等待网页端放行
        │                                                         │
        └────────────────────────────┬────────────────────────────┘
                                     ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                  NetDive Local Bridge (127.0.0.1:4560)                 │
 ├────────────────────────────────────────────────────────────────────────┤
 │                  NetDive 控制台 (第二屏幕实时大盘)                     │
 │          - 阶段一: 抓取清洗 ──► 阶段二: 标签分类 ──► 阶段三: 审批门禁     │
 └────────────────────────────────────────────────────────────────────────┘
```

---

## 三、细粒度实施任务规划 (Implementation Plan)

### Milestone 1: 核心轻量 SDK / Reporter 设计 (`packages/netdive-reporter`)
- [ ] **Task 1.1: 定义统一轻量级流水线遥测协议**
  - 在 NetDive 中导出强类型 `PipelineStepEvent` 与 `PipelineGateEvent`；
  - 保证非侵入：采用类似 OpenTelemetry 的无状态发射器，如果 `127.0.0.1:4560` 离线，自动静默降级（Fail-silent），零性能惩罚。

### Milestone 2: Tachikoma 摄入流水线对接
- [ ] **Task 2.1: 在 Tachikoma 统一多模态引擎挂载 Reporter**
  - 接入 `tachikoma ingest <url>` 生命周期：
    1. Tier 1: Fast-HTTP 直通节点；
    2. Tier 2: 降级 Puppeteer 浏览器节点（若触发）；
    3. LLM 结构化抽取节点（提取 6+1 MOC 标签）；
    4. Ghost `_raw/articles/` 落盘节点。
  - 在 NetDive 画布上实时呈现 Tachikoma 抓取链路。

### Milestone 3: Ghost 知识库炼化与治理流水线对接
- [ ] **Task 3.1: 挂载 Ghost `pipeline.ts` 炼化流水线**
  - 节点 1：读取 `_raw/` 原始素材并计算指纹；
  - 节点 2：大模型提纯（五大支柱分类、aliases 抽取）；
  - 节点 3：L1 确定性质检断言（调用 `validator.ts` 校验强类型 YAML 契约）；
  - 节点 4：退火/合并判定（若触发近义卡片合并，沉降出自愈分支）。
- [ ] **Task 3.2: 接入写盘前的决策门禁 (HITL)**
  - 当 Ghost 准备向 `wiki/` 写入新卡片并更新全局 MOC 时，向 NetDive 发送审批挂起请求；
  - NetDive 弹出红色审批弹窗，展示新增卡片与双链变更摘要；
  - 人类点击「批准」后，Ghost 恢复执行完成物理写盘。

### Milestone 4: 全真生产联调与验证
- [ ] **Task 4.1: 执行一次真实的外部文章剪藏入库**
  - 运行 `tachikoma ingest`，验证 NetDive 界面无需刷新、秒级画出真实图文提取流；
- [ ] **Task 4.2: 执行一次真实的 Ghost 炼化并完成网页端门禁放行**
  - 验证跨进程真实挂起、人类审批通过后安全落盘。
