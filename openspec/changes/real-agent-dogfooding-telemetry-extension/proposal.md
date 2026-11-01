# Change Proposal: real-agent-dogfooding-telemetry-extension

## 1. 为什么要做 (Why)
- **从模拟器走向真实战场**：NetDive 已经具备了 React Flow 拓扑渲染、自愈分叉、Promise 决策门禁与 Hono 桥接层。但目前前端主要依赖内置剧本模拟，尚未接入本地真实运行的 Agent。
- **全机真实场景直连（Dogfooding 铁律）**：依照全机架构规范，自研工具必须能在日常真实开发中自己先用起来（Eat your own dog food）。
- **打通最后一公里**：编写极轻量（几十行）的生命周期捕获适配器，将本地 Pi Coding Agent 与 Claude Worker 的实际执行链路无缝连入 `127.0.0.1:4560`，在日常处理真实需求时，真正提供第二屏幕拓扑潜望镜与网页端审批门禁。

## 2. 变更与系统定位 (What Changes)
- **提案范围**：
  1. **Pi Agent 原生遥测扩展 (`packages/pi-tracer` 或 `apps/pi-extension`)**：利用 Pi 扩展生命周期钩子（`tool_call`, `tool_result`, `assistant_message`），异步上报至 NetDive Hono Bridge；
  2. **高危门禁拦截钩子**：当外部 Agent 触发 `git commit`、破坏性 `bash` 或核心文件写操作时，通过 `POST /api/gate/prompt` 挂起远程协程，等待网页端放行；
  3. **实时会话多租户感知**：支持多会话/多任务切换与重连自愈。

## 3. 非目标 (Non-Goals)
- 不做侵入式的大模型代理转发（不劫持 OpenAI/Anthropic API 原生请求）；
- 不做沉重的日志落库持久化，保持本地纯内存流式通信的高性能与轻量。
