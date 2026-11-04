# Proposal: 实施两级“宏观-微观”双焦交互因果画布 (Hierarchical Focus + Context Canvas)

## 1. 痛点背景与动机 (Problem Statement)
当前 NetDive 将 JSONL 流水中的所有底层原子工具事件（Tool Calls）直接映射为画布节点，导致在大规模真实会话（50~300+ 步）中面临三大根本性交互瓶颈：
1. **认知过载与拓扑杂乱**：将数十个连续的 `read`、`edit` 与 `bash` 平铺在主画布，用户无法快速建立“Agent 这轮在解决什么问题，总共经历了几次交互回合”的宏观心智模型；
2. **虚拟视口与 DOM 膨胀摩擦**：依据知识库 `[[虚拟视口渲染]]` 第一性原理，大规模 DOM 节点与连线使 React Flow 内部多叉树遍历与 SVG 渲染成本剧增，导致频繁切页与相机漂移；
3. **缺乏层次化深潜路径**：排查问题时，开发者需要先看“哪一轮交互出错了（宏观定位）”，再看“这轮里的哪个具体命令挂了（微观钻取）”，单一粒度节点无法满足这种层次化分析需求。

## 2. 核心架构与模式设计 (Architecture Design)

### 2.1 宏观主干层 (Macro Turn DAG / Context Layer)
- **数据模型**：在 `transcriptParser.ts` 引入 `TurnCompoundNode` 聚合抽象：
  - 将属于同一推理回合（由 User Message 或系统决策周期触发）的多个原子 TelemetryEvent 聚合为一个 `Turn` 主节点；
  - 属性包含：`turnIndex`、`intentSummary`、`status`（success / failed / branching / gate）、`totalDuration`、`tokenBreakdown`、`toolChips`（如 `[read x3, bash x2]`）以及内部原始事件列表 `subEvents: TelemetryEvent[]`；
- **画布呈现**：
  - 主画布默认按因果主干排布 **Turn 宏观卡片**（或在视图切换栏提供“宏观回合 (Macro Turns)”与“全部细节 (Flat Trace)”一键双模切换，默认启用宏观回合模式）；
  - 主画布节点数稳定收敛在 5~20 个，彻底根治视口漂移与卡顿。

### 2.2 微观深潜层 (Micro Trace & Drill-Down / Focus Layer)
- **宏微联动**：
  - 点击宏观 Turn 节点，除了高亮外，主画布可支持**原地子图展开（SubFlow / Inline Expansion）**或联动**右侧微观深潜抽屉（Turn Details Drawer）**；
  - 抽屉内以时序流水瀑布（Execution Waterfall）清晰呈现本 Turn 内的每一步调用，包括命令入参、输出高亮、L1 断言命中状态和 WAL 还原按钮；
  - 底部时间轴 Scrubber 支持按“回合（Turn）”与按“步数（Step）”无缝联动步进。

## 3. 验收标准 (Acceptance Criteria)
- [x] `transcriptParser.ts` 具备将 TelemetryEvent 序列按 Turn 结构聚合为宏观 Compound 节点的能力；
- [x] 顶部或画布控制区提供“宏观回合 (Macro Turns) / 全量细节 (Flat Trace)”视图切换控件；
- [x] 宏观回合视图下，主画布以优雅的 Turn 卡片呈现，展示回合主题与工具汇总芯片（Tool Chips）；
- [x] 点击 Turn 节点能够流畅查看其微观调用链（通过抽屉或局部展开）；
- [x] 视口跟焦机制与宏观节点完美适配，首屏自动优雅居中；
- [x] 所有测试保持 100% 通过，`pnpm run build` 打包构建无警告无错误。

