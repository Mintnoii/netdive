---
type: doc
title: "SESSION_DATA_DIRECTIONS.md — 本地会话数据的二次利用方向"
created: 2026-11-19
updated: 2026-11-19
tags: [roadmap, session-data, regression, process-mining, evals]
status: evergreen
---

# 本地会话数据的二次利用方向

> 面板回答单次会话发生了什么。跨会话数据能回答哪些失败反复出现、哪些路径浪费最多、改完之后有没有变好。本文记录已识别的方向、前置数据与推荐顺序，作为后续立项索引。

## 方向总览

| 方向 | 输入 | 产出 | 叙事强度 | 状态 |
| :--- | :--- | :--- | :---: | :--- |
| 失败会话用例提纯与回归工作台 | 失败节点、断言、工具输出 | 可重跑用例、5步提取流水线与基线报告 | 最强 | 已落地，见 `openspec/changes/trace-to-regression-case/` |
| 跨会话流程挖掘 | 多个 JSONL 的节点序列 | 主路径、异常变体、瓶颈节点 | 强 | 待立项 |
| Token / 成本 / 耗时归因 | usage、timestamp、事件间隔 | 按工具、项目、文件排序的浪费榜 | 强 | 待立项 |
| 个人工作镜像 | 会话标题、文件操作、失败率 | 日报周报、习惯画像、卡点统计 | 中 | 待立项 |
| 失败指纹库 | assertion.rule、命令、文件路径 | 高频坑清单，反哺规则与门禁策略 | 中 | 待立项 |
| 匿名轨迹数据集 | 去敏后的事件流 | 小模型评测集或 judge 样本 | 偏弱 | 暂缓 |

## 失败会话用例提纯与回归工作台

失败 trace 提纯为回归测试用例，改完 prompt 或工具后重放同一条用例，用两份报告差分看失败指纹有没有消失、水位有没有下降。核心工程价值在于将偶发 Badcase 固化为自动化考卷，摆脱“改一句 Prompt 引发隐性雪崩”的陷阱。

NetDive 的落点：

- **5 步提纯流水线**：涵盖故障分级（L1/L2）、指纹降噪、证据载荷剥离与 WAL 指针冻结、三维复合断言合成与 Tracing Tag 探针嵌入；
- `contextHealthReport` 给出失败分组、水位峰值、压缩机会与前缀稳定性，直接当三维基线指标；
- 采用瘦用例契约与冷热分层架构，大 payload 卸载至 WAL，单用例控制在 5KB 内；
- 对照组来自用户重跑后导入的新 JSONL，并支持内置全特性演示会话的一键模拟对账。

## 跨会话流程挖掘

单个会话的 DAG 是一条路径，几十条会话叠起来才是流程。AgentFlow 与 QPR Agent Mining 用 directly-follows graph 找主路径和异常变体，典型结论是多数运行走 A→B→C，少数走 A→D 的变体失败率极高。

NetDive 的落点：

- 事件流已有 `parentId` 与 nodeId，可以直接聚合成跨会话转移频次；
- 输出主路径、低频路径、失败率最高的变体、P95 耗时节点；
- 这条方向的价值在跨会话统计，单会话面板做不到。

## Token、成本与耗时归因

Datadog 的 trajectory 项目把会话日志转成时间、token、成本三类运营指标。NetDive 已有 usage、timestamp 和项目字段，可以按工具、项目、文件三个维度排序，找出最贵的重复命令和最耗 token 的文件读取。

这条方向实现成本低，适合作为回归工作台的附属视图。

## 个人工作镜像

OpenStory 这类本地工具把会话变成「你实际怎么工作」的镜子。基于会话标题、文件操作与失败率，可以生成日报周报、高频文件清单、卡点分布。对个人用户有留存价值，对面试叙事的加成弱于回归和流程挖掘。

## 失败指纹库

把 `assertion.rule`、命令、文件路径与失败原因跨会话聚类，得到高频坑清单。这份清单可以直接反哺本地规则与门禁策略，例如把反复触发的高危命令提升为默认审批项。与个人规则系统联动时，这条方向有独特优势。

## 匿名轨迹数据集

去敏后的事件流可以做小模型评测集或 judge 样本。隐私处理成本高，且单用户数据量有限，短期不作为主线。真要做时先参考 AgentX 的做法，去掉 prompt、源码与工具载荷，只保留请求长度、前缀复用和分支时序。

## 推荐顺序

- 第一步失败会话转回归用例已完成，观测闭环到验证。
- 第二步做跨会话流程挖掘，让单次 DAG 升级为路径统计。
- 第三步补成本与耗时归因，挂进回归工作台。
- 个人工作镜像和失败指纹库按使用频率增量做。
- 匿名数据集暂缓。

## 还缺的元数据

现有事件足够起步，跨会话能力还需要三样轻量字段：

- **任务标识**：把同一次任务的前后会话串起来，否则只能靠人选两次回放；
- **结果标签**：成功、失败、人工中止可由断言和门禁裁决派生，最好显式落一层；
- **耗时与成本**：事件间隔加 usage，支持按工具和文件归因。

这些字段都能从现有 JSONL 派生，不需要改 Agent 内核。

## 外部参考

- Arize，How to build agent evals from traces：https://arize.com/resources/agent-evals-from-traces/
- Arthur，AI Agent Regression Testing From Production Failures：https://www.arthur.ai/column/regression-test-datasets-ai-agents-production-failures
- AgentFlow，process mining across traces：https://github.com/ClemenceChee/AgentFlow
- QPR Agent Mining：https://www.qpr.com/ai-agent-mining
- Datadog trajectory：https://github.com/datadog-labs/trajectory
- AgentX 数据集方法：https://inferencex.semianalysis.com/infx/agentx
