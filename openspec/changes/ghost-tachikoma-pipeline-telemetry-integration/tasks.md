# Tasks: ghost-tachikoma-pipeline-telemetry-integration

- [ ] Task 1: 核心轻量流水线 Reporter 设计 (`packages/netdive-reporter` 或 `src/client/reporter.ts`)
  - [ ] 定义通用流水线生命周期事件 (step_start, step_complete, gate_prompt)
  - [ ] 探针安全防线：Local Bridge 离线时静默熔断，绝不阻断业务执行 (Fail-silent)
- [ ] Task 2: Tachikoma 统一情报摄入链路集成
  - [ ] 挂载 Fast-HTTP / 浏览器降级多模态抓取节点
  - [ ] 挂载 6+1 MOC 标签提纯与灵感入库节点
- [ ] Task 3: Ghost 知识库炼化与治理链路集成
  - [ ] 挂载素材读取、模型提纯与 validator.ts 出厂质检断言节点
  - [ ] 挂载退火与近义概念合并自愈分支
  - [ ] 挂载 wiki/ 物理写盘前的决策门禁 (HITL Promise Gate)
- [ ] Task 4: 端到端生产狗粮实测 (Dogfooding Verification)
  - [ ] 实测单篇真实微信长文抓取并实时在 NetDive 上呈现拓扑
  - [ ] 实测 Ghost 真实炼化并在 NetDive 网页端审批通过后完成写盘
EOF
