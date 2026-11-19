# OpenSpec 任务清单：context-governance-lab

## Phase 1: 纯逻辑层与演练剧本
- [x] `src/services/contextGovernanceEngine.ts`：ContextState 四层大对象 + 9 步真实场景数据
- [x] 掐头去尾截断（复用 `compactToolLines`）+ 首尾截断 Token 节省计算
- [x] 前半段打包精简（安全边界触发）+ 阶段草稿归档
- [x] 连续同构折叠（3 次抽取合并为 `x3`，消除重复 Schema）
- [x] 按 ID 备份仓库 `backupStore`：取回与还原回滚共用同一真实计算结果
- [x] 前缀哈希稳定性 + 时间戳突变模拟

## Phase 2: UI 交互组件与页面
- [x] `src/pages/ContextLabPage.tsx`：React Flow 演练画布 + 自动追焦
- [x] 同构节点默认展开为 3 个子节点（150px 间距、青色虚线串联），可折叠为聚合节点
- [x] 连线出口动态计算（展开时从最后一个子节点连出），保证链路贯通
- [x] 节点可拖动 + 位置覆盖表记忆 + 重置清空
- [x] `src/components/AgentNode.tsx`：三类交互按钮（掐头去尾 / 打包精简 / 折叠重复）+ 展开还原
- [x] `src/components/ContextBottomPanel.tsx`：双层全宽面板 + 步进控制 + 历史清理流水账（按ID取回/还原放回）
- [x] `src/components/ContextNodeDrawer.tsx`：点击节点的右侧治理分析抽屉
- [x] `src/components/HeaderNav.tsx` / `src/App.tsx`：Tab 入口与 Lazy 路由挂载

## Phase 3: 文案口语化与布局收敛
- [x] 全页面黑话降级为大白话（掐头去尾/打包精简/折叠重复/清理流水账/固定前置骨架）
- [x] 固定前置上下文补齐 4 类不变内容（系统身份 / 用户目标 / 注册工具 / 里程碑）
- [x] 四块内容 12 栏不等分、固定高度、里程碑横向滚动不撑高
- [x] 死代码清退：删除被取代的 `ContextStateDrawer.tsx`

## Phase 4: 文档与质量门禁
- [x] 更新 `openspec/changes/context-governance-lab/proposal.md` 收口最终形态
- [x] 更新 `dotagents/resume/project-netdive.md` 面试问答（4 大交互 + 折叠重复调用 + 面试题整理）
- [x] `pnpm test`：368 tests / 112 suites 全部通过
- [x] `pnpm build`：零类型错误，生产构建成功
