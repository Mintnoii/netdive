# 功能留档：修复 Pi 原生 Session 绑定、根除刷新误弹窗与会话标识边界治理

## 变更描述

彻底根治 NetDive 会话漂移与刷新误弹窗两大痛点：1. 接入 Pi 原生 ctx.sessionManager.getSessionId() 作为单宿主会话物理主键，消灭盲目读取 process.env.PI_SESSION_ID 导致的时间戳漂移与零碎日常命令抢占会话问题；2. 重构 useBridgeConnection 状态机，将重连获取的历史存量门禁降级为静默状态记录，彻底消灭网页刷新强制弹窗打扰；3. 厘清 Session ID 与 Trace ID 的工程选型分水岭：单宿主内坚决以 sessionId 统摄，未来跨端联邦时再引入全局 traceId。

## 涉及文件

- `dotagents/extensions/pi-netdive-bridge/index.ts` — 切面 handler 接入 ctx.sessionManager.getSessionId() 与 getSessionName()，固化会话真实物理真理源
- `src/hooks/useBridgeConnection.ts` — 重构 bridge_connected 状态处理，存量门禁仅记录状态，消灭重连弹窗干扰
- `src/hooks/useTelemetryStream.ts` — 移除 selectSession 切换会话时自动唤起 pendingGateNode 模态窗的过度逻辑
- `src/types/telemetry.ts` — resolveSessionTitle 增加针对单行命令行降级优化，防止底层命令劫持整个会话名称

## 备注

遵循第一性原理与全机编码审美门禁；全量 118 个单测 100% 绿灯；通过端到端交互闭环验证。
