# NetDive 技术点 2 深度解构：ReAct 错误捕获与自愈分叉 (Self-Correction)

> 本文档为 NetDive (潜网) 技术点 2 的教学与原理说明文档，详细解析环境报错时的反思、旁路分支下沉算法，以及如何闭环回归主干。

---

## 1. 对应 Ghost 知识库认知图谱

- 📖 **知识库卡片**：`wiki/learning/Agent 端到端可观测性与生产评测闭环.md`
- 🎯 **第一性原理与模式映射**：
  > “**L1 确定性逻辑断言（Deterministic Assertions）**：校验工具调用的 Bash 命令退出码（`exitCode`）、文件语法树正确性。这是零成本且 100% 确定性的首道防线。”
  > “**状态差分与环境 Oracle（State Diff & Execution Oracles）**：验证执行结果在沙箱中是否满足验收准则。失败聚类反向输入到 Prompt/修复动作中，形成负反馈闭环。”

### 痛点：Agent 犯错时，传统控制台的混乱
在传统终端中，当 Agent 执行单测失败时，整屏刷满报错红字。Agent 往往盲目重试，用户无法看清：
- 究竟是哪一步踩坑挂了？
- 自我反思修了哪几个文件？
- 修复之后单测有没有重新通过？
- 怎么确认系统已经脱离危险区回归了主线？

**NetDive 的技术点 2，通过「树形 Y 轴下沉分支 + 闭环菱形聚拢」，让 Agent 的错误、反省、修复、回归像一张精美的手绘拓扑图一样清晰呈现！**

---

## 2. 拓扑形态设计：从直线到闭环菱形 (Diamond Bypass Topology)

```text
[主干 y=180] ──► (node-2 重构) ──► [node-3 运行测试 ❌ exit: 1] ──────────────────────────┐ (连回新主干)
                                              │                                           │
                                              │ (红色警示连线，向下分叉)                    ▼
                                              ▼                                    [node-4 Git 门禁 🛡️]
                                  [node-3-fix 自愈修复 🛠️] ──► [node-3-verify 验证通过 ✅] ──┘
[分支 y=340]                         (琥珀金分支虚线流动)           (exit: 0 回归通过)
```

### 为什么选择向下分叉（Y 轴下沉）而不是全堆在一条直线上？
1. **认知负荷分层**：
   - 上面一条水平线（`y = 180`）代表**理想的主干推进路径**；
   - 下方一条水平线（`y = 340`）代表**因异常触发的纠错与重试旁路**；
2. **视觉因果闭环**：
   - 报错节点产生红色警示；
   - 纠错过程在下方展开（带有琥珀金「自愈」徽章）；
   - 纠错验证通过后，连线重新向上爬升并入新主干（`node-4`），形成闭环菱形拓扑。用户一眼就能看出“系统曾经受挫，但已成功自愈并回到正轨”。

---

## 3. 核心算法与实现细节

### 3.1 带有 `isCorrectionBranch` 的分层坐标算法 (`useTelemetryStream.ts`)
```typescript
const isCorrection = Boolean(event.isCorrectionBranch);
const parentNode = event.parentId ? prevNodes.find((n) => n.id === event.parentId) : undefined;

// X 轴始终向右延伸
const posX = parentNode ? parentNode.position.x + 280 : 50 + prevNodes.length * 280;

// Y 轴智能分层：自愈分支下沉到 y=340；主干保持在 y=180
const posY = isCorrection ? 340 : 180;
```

### 3.2 动态连线与状态感知
根据节点及其父节点的状态，Edge 自动换上富有语义的皮肤：
- **失败断言边**：当父节点 `status === 'failed'` 时，边变为醒目的深红色（`#DC2626`）；
- **自愈分支流动边**：当节点是自愈分支时，边使用琥珀金色（`#D97706`）配合虚线流动动画（`animated: true`）；
- **自愈并网边**：当从分支节点连回主干时，边自动从 `y=340` 平滑弯曲过渡至 `y=180`。

### 3.3 卡片视觉增强 (`AgentNode.tsx`)
1. **自愈微型徽章**：`isCorrectionBranch === true` 时，卡片右上角显示淡琥珀色 `✨ 自愈` 标签；
2. **环境 Observation 警示条**：
   - 若 `observation.exitCode !== 0`，卡片内直出红色错误看板：`exit: 1 | AssertionError: pipeline guard failure`；
   - 若 `observation.exitCode === 0`，卡片内显示翠绿色看板：`exit: 0 | 回归验证通过`。

---

## 4. 测试剧本设计理念 (`SELF_CORRECTION_SCENARIO`)

我们在 `src/hooks/useTelemetryStream.ts` 中设计了 6 步完整的闭环剧本：
1. `node-1 (think)`：目标规划与分解（主干）
2. `node-2 (edit)`：核心业务改造（主干）
3. `node-3-failed (bash)`：运行单测**异常挂起**（主干，`exit: 1`）
4. `node-3-fix (edit)`：异常反思与修复（**自愈分支下沉**，打字修补 `guard.ts` 契约漏洞）
5. `node-3-verify (bash)`：重新跑单测（**自愈分支**，`exit: 0`，156 项单测全绿）
6. `node-4 (gate)`：代码回归主干，进入提交决策门禁（**回升到主干**，闭环完成）

---

## 5. 极简复现与验证步骤

1. 确保本地 `pnpm dev` 运行中（或打开 `http://localhost:5173/`）；
2. 点击顶部操作栏的「**注入单测异常与自愈**」按钮：
   - 前两步在主干顺利生长；
   - 第 3 步变红，卡片打出红色的 `exit: 1 | 断言异常`；
   - 第 4 步连线向右下方优雅分叉，黄色虚线流动，卡片带有 `✨ 自愈` 徽章并打字输出修复方案；
   - 第 5 步在下方完成单测回归，显示翠绿的 `exit: 0`；
   - 第 6 步连线从下方昂首聚拢回右上方的主干 `node-4`，进入门禁待审状态。
