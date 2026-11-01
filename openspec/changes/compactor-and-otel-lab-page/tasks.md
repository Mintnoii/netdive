# Tasks: compactor-and-otel-lab-page

- [x] Task 1: 顶层导航扩充 (`src/components/HeaderNav.tsx`)
  - [x] 增加 StudioTab 类型 'lab'
  - [x] 增加第 3 个 Tab：`📊 观测实验室 (Lab)`
- [x] Task 2: 独立实验室页面 (`src/pages/CompactorLabPage.tsx`)
  - [x] 预设三套真实高压长工具输出场景 (单测Dump, AST Diff, 巨型文件)
  - [x] 实时双栏差分视图 (Raw vs Compacted)
  - [x] 动态 Token 节约率仪表盘与 Head/Tail 阈值控制
  - [x] Write-Ahead Log (WAL) 离线指针注册与原地回放器
  - [x] Prompt Cache 前缀 SHA-256 稳定性验证器
  - [x] 问号说明外显化与卡片右侧按钮排版对齐
  - [x] 示例数据 100% 中文化提纯
- [x] Task 3: 顶层单页 Tab 解耦挂载 (`src/App.tsx`)
  - [x] 保证页面 1、页面 2、页面 3 状态互相隔离
- [x] Task 4: 质量与自动化验收
  - [x] 96 项单测全绿，构建 0 报错，oxlint 0 警告
  - [x] Playwright 无头浏览器 E2E 验证并截取全景实验图
EOF
