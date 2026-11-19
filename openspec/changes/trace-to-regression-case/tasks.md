# OpenSpec 任务清单：trace-to-regression-case (失败会话用例提纯与回归评测工作台)

## Phase 1: 核心契约与数据模型重塑

- [x] 更新 `openspec/changes/trace-to-regression-case/proposal.md` 与 `design.md`，固化用例提纯定位与 5 大技术点
- [x] 在 `src/services/regressionCase.ts` 中增强流水线白盒拆解接口（`resolvePipelineSteps`）与模拟对账 Challenger 纯函数（`createDemoChallengerReport`）
- [x] 在 `src/services/regressionCaseStore.ts` 中升级 `DEFAULT_SEED_CASE` 为具备 L1/L2 死循环、WAL 指针与高水位基线的全特性演示用例

## Phase 2: 页面重构与白盒流水线可视化

- [x] 更新 `src/components/HeaderNav.tsx`：Tab 命名从「测试对比」更名为「用例提纯」，更新图标与提示文案
- [x] 在 `src/pages/RegressionPage.tsx` 中新增「提纯流水线白盒拆解 (Extraction Pipeline)」4 步步骤条
- [x] 在 `src/pages/RegressionPage.tsx` 中增加「⚡ 一键模拟优化重跑」交互，支持一键载入修复版会话对账
- [x] 优化页面布局文案：左侧列表明确为“失败会话源”，右侧第一视觉重心为“用例特征提取”，下方收敛为“验收对账”
- [x] 彻底重塑流水线为**病灶靶向对症治理 (Targeted Distillation)**：废除千篇一律的固定 4 步八股文，依据当前会话检出的具体事故病灶动态生成治理步骤（如针对死锁共振的因果 DAG 剪枝、针对超长输出的 WAL 冷热分离、针对环境路径的正则指纹去噪），并在卡片上显式标注 `🎯 靶向治理 · 病灶 0X` 与 `📦 全案汇聚`
- [x] 将流水线改造为「用例提纯」**内嵌数据变换区块（非弹窗）**：点击后逐病灶展示**真实会话数据 ➜ 提纯产物**的具体数据（原始日志/JSONL 事件 ➜ 规则签名/瘦用例/WAL 指针/断言 JSON），确认入库后下方才显现重跑指令
- [x] 现场档案每个病灶旁挂一条小巧的「建议处理手段」提示（技术手段名 + 徽标），体征画像（峰值/前缀/体积）放大为醒目卡片
- [x] 模拟重跑改为**会话原地治愈翻牌**（顶部病灶与体征翻为治愈态），并提供「重置会话」一键还原故障前状态；移除下方独立治愈对账大屏

## Phase 3: 概览与文档同步 (对齐第一性心智)

- [x] 更新 `src/pages/OverviewPage.tsx`：Section 02 标题从「测试对比同屏回归找差异」更名为「失败用例提纯与回归验收」，更新三维断言与演示图文说明
- [x] 更新 `docs/INTERVIEW.md`：增加“Trace-to-Eval 失败会话用例提取流水线”核心技术点与面试高频解析
- [x] 更新 `docs/SESSION_DATA_DIRECTIONS.md`、`README.md` 与 `CHANGELOG.md`

## Phase 4: 测试与构建验证

- [x] 更新 `src/services/regressionCase.test.ts`，补充全特性演示用例与模拟对账契约测试
- [x] 运行 `pnpm test`，确保 382 项单测 100% 绿灯通过
- [x] 运行 `pnpm build`，确保零 TypeScript 类型报错，生产打包完成

## Phase 5: UI 配色对齐与 Zero CLS 生产级交互工程化

- [x] 全面统一页面视觉基调至 NetDive Warm Stone 纸白体系（`#FBF9F5` / `#FAF8F5` / `#E5E0D8` / `#1E2024`），对齐「会话回放」与「上下文演练」
- [x] 锁死三栏等高布局（`h-40`）与固定按钮高度（`h-7`），彻底根除点击治理与状态切换时的布局位移（Zero CLS）
- [x] 优化病灶排版：首行并列展示「病灶描述」与「治理建议」，治理后在正下方增量展开「治理后成效」
- [x] 规范状态判定与控制流：全部病灶治理完成时大区图标变绿并弹出轻量 Toast，会话重置彻底清空治理状态

