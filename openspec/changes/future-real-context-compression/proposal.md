# Proposal: 真实上下文压缩（Agent 侧介入）

> 状态：**明确暂缓（deferred at source）**。2026-11-08 拍板：先不做。本档为架构预留与未来立项依据。

## 1. 为什么暂缓
NetDive 的定位是旁路观测与拦截控制台：Agent 在自己的进程里把 prompt 发完之后，才通过 `POST /api/telemetry` 把遥测送给 bridge。当前 `microCompactor` 压缩的是**观测副本**，Agent 自己的上下文一个 token 都没变。真要降本，必须在 Agent Loop 的 tool_result 回填钩子里介入 —— 那是宿主侧插件工程，与「零侵入监听」定位是两条产品线，揉一起会让 NetDive 退化为侵入式打点。

## 2. 已就绪的架构预留

| 要素 | 现状 | 缺口 |
| :--- | :--- | :--- |
| 折叠算法 | `compactToolLines`（Head 15 + 标记 + Tail 15）已具备、有单测 | 无 |
| 原文留存 | 内存 WAL `wal-call-N` + `replay()` | 需落盘（进程退出即失） |
| 协议守卫 | `validatePairing` / `ensureToolEnvelope` 已具备 | 需在宿主侧真正调用 |
| 前缀稳定 | `computePrefixHash` / `createPrefixBoundary` 已具备 | 需确认折叠只动尾部 |
| 触发时机 | bridge 摄入时自动折叠（观测副本） | 需迁移到 Agent 的 compaction 钩子 |

## 3. 立项前置条件（缺一不可）
1. 落盘 WAL（本地文件约定对齐 `Ghost/.pi` 那套）；
2. 宿主侧钩子可行性验证（以 Pi 扩展为试点，claude-code / codex 依次）；
3. 前缀哈希不变断言 + 配对完整性断言都进 CI；
4. 隐私口径（原文落盘意味着 prompt 文本留盘）。

## 4. 验收思路（未来）
- 折叠后会话能继续跑，无上游 400（配对完整）；
- Prompt Cache 命中率不下降（前缀哈希不变）；
- 被折叠条目 100% 可回放；
- 同一会话折叠前后 `usage.input` 有可测量下降。

## 5. 关联
- `src/services/microCompactor.ts`（Rule 1~4 已实现）
- `docs/BACKLOG.md` 第一节
- `openspec/changes/compaction-opportunity-inspector/`（当前的只读剖析层）
