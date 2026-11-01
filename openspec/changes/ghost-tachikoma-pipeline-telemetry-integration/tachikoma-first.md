# Change Proposal: tachikoma-first-pipeline-telemetry-integration

- **提案状态**: 实施中 (In Progress)
- **目标工程**: `NetDive` (控制台) & `Tachikoma` (统一情报引擎)
- **架构原则**: Tachikoma 极速先导 (Fast-Path First) · 纯单向因果链 · 零阻塞 Fail-Silent

---

## 一、为什么优先从 Tachikoma 入手？(The "Tachikoma-First" Rationale)

你的敏锐直觉完全切中了工程迭代的第一性原理！相比于 Ghost 复杂的知识图谱治理，**优先接入 Tachikoma 具有压倒性的架构优势**：

1. **链路极短、纯线性无环因果**：
   - Tachikoma 的日常摄入只有 4 个清晰步骤：
     `[1. HTTP抓取]` ➔ `[2. 正文清洗]` ➔ `[3. 领域标签抽取]` ➔ `[4. 落盘归档]`；
   - 相比 Ghost 动辄涉及“双胞胎概念合并”、“全库双链反向重写”、“退火墓碑回收”，Tachikoma 没有任何复杂的状态分支回溯，**极其适合作为验证 NetDive 实时拓扑与吞吐能力的第一号先锋！**
2. **极速闭环，10 秒内看到生产狗粮效果**：
   - 跑一次 `tachikoma ingest <链接>` 或 `tachikoma spark "<句子>"` 耗时仅需 1~3 秒；
   - 可以立刻在 NetDive 网页端看到 4 个卡片像多米诺骨牌一样顺滑点亮，瞬间验证“终端敲命令 ➔ 第二屏幕秒级画图”的全部链路！
3. **沉淀出可复用的通用中间件**：
   - 在 Tachikoma 上打磨成熟的 `netdive-reporter`（具备 50ms 端口探活与 Fail-Silent 静默跳过机制），随后直接平移给 Ghost 使用，水到渠成。

---

## 二、Tachikoma 先锋落地里程碑 (Tasks)

- [ ] **Milestone 1: 编写 NetDive 极轻量单文件 Reporter (`src/client/reporter.ts`)**
  - [ ] 零依赖、纯 TypeScript 实现；
  - [ ] 实现 Fail-Silent 探活：检测 `http://127.0.0.1:4560/health`，若离线自动切换为 `No-Op` 空实现，业务流水线 100% 毫无察觉；
  - [ ] 提供声明式 API：`await reporter.step(name, fn)` 与 `reporter.emit(...)`。
- [ ] **Milestone 2: Tachikoma 摄入流水线单点对接**
  - [ ] 在 `Tachikoma/apps/cli/src/cli.ts` 引入 reporter；
  - [ ] 为 `fetch`、`clean`、`classify`、`persist` 4 个核心函数挂载步进事件。
- [ ] **Milestone 3: 端到端生产实测与闭环验证**
  - [ ] 启动 NetDive (`pnpm dev`)；
  - [ ] 运行一次真实的 Tachikoma 摄入命令；
  - [ ] 在 NetDive **实时控制台 (Live Console)** 见证 4 个节点毫秒级动态建图，完成先锋验证！
