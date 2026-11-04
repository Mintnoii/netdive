# Proposal: 实施上下文自适应时间轴与实时流式镜头跟随 (Context-Aware Scrubber & Live Camera Follow)

## 1. 痛点背景与动机 (Problem Statement)
在实现了层级下钻画布 (Composite Drill-Down Canvas) 之后，系统在时序联动与实时流式执行中暴露出两个核心断层：
1. **时间轴尺度失配 (Scrubber Scale Mismatch)**：
   - 宏观视图下时间轴单位是“回合 (Turn)”，但下钻到微观子图后，底部时间轴未作上下文感知，导致无法在单个 Turn 内部单步回放 Thought 与 Action 序列；
2. **实时工作流 (Live Streaming) 呈现割裂**：
   - 当本地 Agent (Pi / Claude) 正在流式执行时，最新落地的 Turn 或原子节点无法被用户感知，最新节点常常生成在视口外，缺少自动镜头跟焦 (Live Camera Auto-tracking) 与明确的运行中脉冲状态 (Running Pulse Indicator)。

## 2. 核心架构与模式设计 (Architecture Design)

### 2.1 上下文感知自适应时间轴 (Context-Aware Scrubber)
- **动态两级映射契约**：
  - **宏观视图 (Macro View)**：时间轴刻度绑定为 `1 ~ macroTurns.length`（单位：`回合`），拖动或播放以“回合”为颗粒度推进；
  - **微观下钻视图 (Micro Drill-down View)**：时间轴刻度即时重映射为当前 Turn 内部的步骤数 `1 ~ currentTurn.subEvents.length`（单位：`步`），标签清晰标注 `Turn #K 步进`；
  - 拖动微观时间轴时，当前子图根据选定步骤切片回放（只展示前 N 个原子步骤），彻底实现“回合内逐帧回溯”；
  - 面包屑返回宏观时，时间轴平滑切回全局回合尺度。

### 2.2 实时流镜头跟随与动态生长 (Live Camera Auto-Tracking & Running Turn)
- **实时活跃 Turn 态**：
  - `aggregateEventsIntoTurns` 在流式接收事件时，末尾未闭环的回合自动标记为 `status: 'running'`，展示旋转 Loader 与脉冲流光边框；
  - 内部工具调用计数与步骤实时动态递增；
- **镜头自适应锁定 (Live Camera Follow)**：
  - 在活跃运行态（`isCurrentSessionActive` 或最新节点推入时），系统自动执行平滑视口锁定，将相机中心平滑对准最新生成的节点（宏观 Turn 或微观 AgentNode），免除人工拖拽；
  - 若用户手动拖动或缩放画布，支持轻量暂停自动锁定，提供右上角 `[ 恢复实时跟随 🎥 ]` 浮标。

## 3. 验收标准 (Acceptance Criteria)
- [ ] 下钻进入微观 Turn 后，底部时间轴自动切换为该 Turn 内部的原子步骤数，拖动可逐帧回放微观调用序列；
- [ ] 从微观返回宏观后，时间轴自动平滑还原为全局回合尺度；
- [ ] 活跃流式执行时，最新 Turn / 节点自动带有运行态动画，画布相机自动平滑跟焦最新生成的节点；
- [ ] 全量单元测试 100% 通过，`pnpm run build` 成功无错误。
