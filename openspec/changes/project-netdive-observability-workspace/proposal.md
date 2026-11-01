# Change Proposal: project-netdive-observability-workspace

## 1. 为什么要做 (Why)
- **行业痛点与认知断层**：在长程推理与复杂多步骤任务中，自主智能体（AI Agent）普遍面临“黑盒执行恐惧”、“目标漂移（Goal Drift）”以及“高危工具破坏性副作用难以拦截”的工程难题。现存的开源方案要么过于庞大重型（如 Dify/FastGPT，包含大量多租户与复杂后端），要么过于简陋反直觉（如 agrex，无清晰因果主线、自中心无序散开）。
- **用户核心审美与落地理念**：
  1. **渐进式由浅入深，每个技术点即刻见效**：绝不搞大而全的一次性堆叠，每个核心 AI + 前端技术点独立成型、配合原理精讲、立即能在界面中验证体验，最后自洽串联；
  2. **库优先于手搓**：核心画布直连工业标准 `@xyflow/react` (React Flow)，彻底摒弃手搓图形渲染代码，聚焦于“AI 状态流与前端控制论”高价值技术深水区；
  3. **朴素耐看的界面风格**：抛弃花哨刺眼的暗黑科幻风，采用温润干净的信纸底色（Warm Paper）、墨水线条与呼吸感极佳的清晰卡片，排版遵循严格的**从左到右（Left-to-Right）因果主线**；
  4. **全机真实场景直连（Dogfooding）**：深度对齐本地 `dotagents` 与 `Ghost` 流水线，沉淀为求职与技术作品集的核心抓手。

## 2. 变更与系统定位 (What Changes)
- **项目定位**：面向自主智能体执行轨迹、因果分支与决策门禁的轻量级可观测工作台（Autonomous Agent Trajectory & Decision Gate Workspace）；
- **核心功能演进阶梯（4 大 AI + 前端技术点由浅入深）**：
  1. **基石底座**：基于 Vite + React + `@xyflow/react` + Tailwind 的标准单向从左到右（LR）布局与极简信纸风节点；
  2. **技术点 1 (流式事件与拓扑解析)**：定义强类型遥测事件流（`node_start`, `node_stream`, `node_complete`），实现流式更新拓扑与文字打字效果；
  3. **技术点 2 (非确定性自愈分叉)**：基于 ReAct 错误捕获（Observation Exit Code != 0），展示 Agent 自我修正分叉（Self-Correction Branch）的动态长出与主干再汇拢；
  4. **技术点 3 (Promise-based 决策门禁挂起)**：基于 Promise 悬挂机制，实现后台执行协程冻结、前端审查 Diff、以及支持参数微调（Steering）的双向控制闭环；
  5. **技术点 4 (上下文熵增与剪枝热力探针)**：多段可视化内存条与剪枝折叠（Context Pruning），直观透视 Token 消耗与记忆召回。

## 3. 非目标 (Non-Goals)
- 不做多租户鉴权、商业计费与复杂权限系统；
- 不手搓底层 SVG 贝塞尔曲线引擎或替代 React Flow 既有能力；
- 不搞沉重不可读的代码，每个核心模块保持小巧纯粹并附带详尽中文教学注释。
