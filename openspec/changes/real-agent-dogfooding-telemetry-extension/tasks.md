# Task Breakdown: real-agent-dogfooding-telemetry-extension

## 阶段一：Pi Agent 原生遥测插件
- [ ] 1.1 编写 `extensions/netdive-tracer.ts` 插件，利用 Pi Extension API 监听 `tool_call_start` 与 `tool_call_result`
- [ ] 1.2 将事件异步序列化上报至 `http://127.0.0.1:4560/api/telemetry`
- [ ] 1.3 软链或注册至本地 `~/.pi/agent/extensions/` 并通过真实任务验证节点实时打出

## 阶段二：真实高危动作门禁挂起 (HITL)
- [ ] 2.1 拦截 `before_tool_execute`，针对敏感命令（`git commit`, `rm -rf`）调用 `/api/gate/prompt` 挂起
- [ ] 2.2 在网页端点击放行，验证本地终端继续执行；点击拒绝，验证本地终端抛错优雅中断
- [ ] 2.3 测试通过与真实全链路 Dogfooding 交付
