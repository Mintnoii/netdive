# Tasks: 落地与验证清单

- [x] 规范设计与提案立项 (`openspec/changes/add-showcase-page/`)
- [x] 编写静态实录数据源 (`src/fixtures/showcaseSessions.ts`)
- [x] 编写独立展示页面组件 (`src/pages/ShowcasePage.tsx`)
- [x] 顶栏 Tab 与路由接入 (`src/components/HeaderNav.tsx` & `src/App.tsx`)
- [x] 编写单测验证 (`src/pages/ShowcasePage.test.ts`)
- [x] 实跑验证与类型检查 (`pnpm test` & `pnpm build`)
- [x] 修复切换 Tab 时 ReactFlow 跨场景边残留与悬空无用连线 (`key={selectedScenarioId}`)
- [x] 修复小地图 MiniMap 缺少几何尺寸导致节点空白问题 (`width`/`height`/`initialWidth`/`initialHeight` 与 `useNodesState`)
- [x] 修复场景 2 中 `comp-5` 重复 ID 数据契约问题
- [x] 新增「宏观回合与微观下钻」双焦架构场景并置于 Showcase 第 1 顺位 (`hierarchical-focus`)
- [x] 场景顺序全面升级为认知升维流：双焦架构 $\to$ 死循环熔断 $\to$ 上下文微压缩 $\to$ 高危命令拦截
- [x] Showcase 支持【宏观回合 / 全量流水】双焦切换与点击回合下钻、悬浮面包屑返回导航
- [x] 重构布局：将问题/解法/效果移至顶栏折叠条，右侧固定边栏改为按需滑出详情抽屉 (`NodeDetailsDrawer` / `TurnDetailsDrawer`)，画布释放 100% 满幅全景空间
- [x] 强化场景 3「上下文压缩」内容：注入超长日志、巨量 Token 载荷 (86.5k)、x24 连续聚合读取、WAL 离线指针 `wal-lab-tsc-01`、KV Cache 前缀命中与 ✂️ 剪枝折叠态契约 (`pruned: true`)
- [x] 完善契约与解析层：`TelemetryEvent` 与 `AgentNodeData` 契约打通 `pruned?: boolean`，`pnpm test` (293 测试) 与 `pnpm build` 100% 绿灯零报错通过
- [x] 深度优化微压缩透视能力：抽屉注入【微压缩透视板】（Token 水位对比条、Head 15/Tail 15 骨架拆解、WAL 一键还原 1500 行原文、Prompt Cache 保真），画布节点增加折叠条与 Token 释放徽章
- [x] 消除底部栏视觉杂质：移除右下角静态手势圆点图例，释放时光机 Slider 全宽空间并提升操作体验
