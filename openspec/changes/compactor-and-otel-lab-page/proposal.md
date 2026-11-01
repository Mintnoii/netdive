# Change Proposal: compactor-and-otel-lab-page

- **提案状态**: 实施已就绪 (Ready for Implementation)
- **目标工程**: `NetDive` (页面 3: 工业级观测与上下文热力学实验室)
- **演进策略**: 先单点吃深吃透页面 3，再整体连线真实业务流水线

---

## 一、为什么优先攻坚场景 3 (Why Lab 3 First)

1. **稳扎稳打的“正规军研发节奏”**：
   在把 NetDive 强行接到外部 Ghost/Tachikoma 真实业务前，**必须先在 NetDive 自己的实验室（Studio）内把所有单点武器与可视化验证器彻底做扎实**。
2. **核心底层代码早已就绪，只缺一个“炸裂的可视化舞台”**：
   - 我们的 `src/services/microCompactor.ts`（Head 15 + Tail 15 裁剪、WAL 离线重放、协议配对防 HTTP 400、Prompt Cache 前缀字节保真）在阶段一就已经写得极为硬核；
   - 但目前这套极其亮眼的能力**纯粹埋在单测里**，在界面上缺乏一个专门的实验页面向面试官/访客进行可视化直观演示！
3. **完成 Studio 三大页面矩阵闭环**：
   - 页面 1: `Live Console` (实时控制台)
   - 页面 2: `Session Replay` (会话时光机)
   - **页面 3: `Compactor & OTel Lab` (工业级观测与微压缩实验室)**

---

## 二、页面 3 核心功能与交互设计 (CompactorLabPage)

在顶部 Tab 导航增加第 3 个 Tab：**`📊 观测实验室 (Lab)`**，包含三大交互实验台：

### 1. 确定性微压缩 (Micro-Compaction) 实时差分实验台
- **交互**：
  - 预设 3 套经典重型工具输出场景（`150 行庞大单测日志 Dump`、`超长 AST 差异补丁`、`巨型 package.json 读取`），也支持用户自由粘贴任意长文本；
  - 实时调整阈值滑块（触发阈值 40 行，Head 15 行，Tail 15 行）；
- **呈现**：
  - 左侧：原始膨胀文本（显示真实行数、字符数、估算 Token 消耗）；
  - 右侧：微压缩输出（精准保留 Head 15 + 结构化折叠标记 + Tail 15）；
  - 中间：**Token 节约率仪表盘（如：节省 78.5% 上下文，0 LLM 调用，0 成本）**；
  - 一键生成 WAL 离线指针（`wal-call-xxx`），点击「指针回放」即可原地还原原始未压缩文本。

### 2. Prompt Cache 前缀字节保真验证器 (Prefix Stability Checker)
- **核心论点**：在微压缩工具输出的同时，如何保证 System Prompt 与 LTM 字节级不可变，充分复用 Anthropic / OpenAI 90% 的缓存折扣？
- **呈现**：
  - 动态计算并展示 SHA-256 前缀指纹；
  - 演示当 System Prompt 发生微小变动时，系统如何拦截报警并判定 Cache 击穿。

### 3. OpenTelemetry (OTel GenAI) 标准协议探针接入
- **呈现**：
  - 提供兼容 OTel 的 OTLP/HTTP 接入端点说明与实时 Span 模拟器；
  - 验证标准 OTel 规范与 NetDive 自研状态机拓扑的无缝互通。

---

## 三、细粒度实施任务工单 (Backlog Tasks)

- [ ] **Task 1: 顶层导航扩充 (`src/components/HeaderNav.tsx`)**
  - 在现有 `Live` 与 `Replay` 右侧扩充第 3 个 Tab：`📊 观测实验室 (Lab)`。
- [ ] **Task 2: 微压缩与 OTel 独立实验室页面 (`src/pages/CompactorLabPage.tsx`)**
  - 搭建双栏代码对比视图（带行号、折叠指示线与 Warm Paper 墨水信纸风格）；
  - 接入单测预设长文本与一键压缩演算；
  - 挂载 WAL 指针重放与 Token 节约率动态仪表盘。
- [ ] **Task 3: 顶层路由解耦挂载 (`src/App.tsx`)**
  - 保持三页面状态物理隔离，Vite + TypeScript 严格编译 0 报错。
- [ ] **Task 4: 全量单测与无头浏览器验证**
  - 确保全仓单测 100% 绿灯，截取页面 3 高清实验实测效果图。
