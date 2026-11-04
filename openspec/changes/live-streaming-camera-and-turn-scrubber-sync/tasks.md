# Tasks: 上下文自适应时间轴与实时流式镜头跟随落地

- [x] Task 1: 改造 `App.tsx` 中的时间轴驱动逻辑：引入 `microTimelineStep` 状态，当 `activeDrilldownTurnId` 激活时，时间轴步长、总步数与单位自动重映射为当前 Turn 内部的原子步骤数，支持微观单步回放切片
- [x] Task 2: 打通微观子图的单步回放切片：在微观下钻模式下，根据 `microTimelineStep` 切片呈现 `currentTurn.subEvents.slice(0, microTimelineStep)`，实现回合内逐帧推演
- [x] Task 3: 升级 `transcriptParser.ts`：确保流式传入的新事件在未完成时末尾 Turn 保持 `status: 'running'` 与活跃徽章，工具统计实时累加
- [x] Task 4: 视口引擎实现实时镜头跟随 (Live Camera Follow)：在 `CanvasViewportController` 中增加实时流感知，新节点推入且用户未锁定视口时，平滑调用 `fitView` 或定位最新节点；右上角提供恢复跟随控制浮标
- [x] Task 5: 验证全量单元测试与构建打包无错误
