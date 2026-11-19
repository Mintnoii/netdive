/**
 * @file src/services/regressionDemoScenarios.ts
 * @description 用例提纯与回归工作台内置的典型演示测试场景库 (Demo Scenario Suite)。
 * 涵盖：
 * 1. 业务目标：优化 Ghost 知识库流水线数据抽取 ➔ 事故：L2 循环共振 + WAL 离线指针 + 高 Token 水位
 * 2. 业务目标：编译 NetDive 本地伴生服务与单测 ➔ 事故：L1 物理执行崩溃 + 动态临时路径去噪
 * 3. 业务目标：部署更新并推送至 GitHub 主分支 ➔ 事故：L3 门禁熔断 + 人机审批 + 规则守卫
 */
import type { ContextWatermark, TelemetryEvent } from '../types/telemetry'
import { BASE_CONTEXT_WATERMARK } from '../types/telemetry'
import type { RegressionCase } from './regressionCase'

export interface DistillMethod {
  name: string
  pill: string
  action: string
  outputSummary: string
  badgeTone: 'rose' | 'amber' | 'blue' | 'purple' | 'emerald'
  beforeLabel: string
  beforeContent: string
  afterLabel: string
  afterContent: string
  insightTip: string
}

export interface FaultItem {
  type: string
  command?: string
  summary: string
  detail: string
  cureSummary?: string
  cureDetail?: string
  badgeTone: 'rose' | 'amber' | 'blue' | 'purple'
  distillMethod?: DistillMethod
}

export interface DemoScenario {
  id: string
  title: string
  project: string
  userPrompt: string
  techBadge: string
  badgeTone: 'rose' | 'amber' | 'blue' | 'purple'
  summary: string
  faults: FaultItem[]
  events: TelemetryEvent[]
  watermark: ContextWatermark
  initialCase?: RegressionCase
  mtime: number
  lineCount: number
}

// 场景 1：Ghost 知识库流水线数据抽取重构 (事故：单测报错陷入 2 次死循环共振，输出上万字符)
const SCENARIO_1_WATERMARK: ContextWatermark = {
  ...BASE_CONTEXT_WATERMARK,
  total: 38400,
  maxCapacity: 200000,
  prompt: {
    tokens: 38400,
    window: 200000,
    parts: [
      { kind: 'system', tokens: 4200, items: [] },
      { kind: 'tools', tokens: 3600, items: [] },
      { kind: 'results', tokens: 21600, items: [] },
      { kind: 'chat', tokens: 9000, items: [] },
    ],
  },
}

const SCENARIO_1_EVENTS: TelemetryEvent[] = [
  {
    nodeId: 'node-sc1-1',
    type: 'node_complete',
    gesture: 'read',
    title: '读取 pipeline.ts 规则配置',
    status: 'completed',
    observation: {
      command: 'read src/pipeline.ts',
      output: ['export class DistillPipeline { ... }'],
    },
  },
  {
    nodeId: 'node-sc-2',
    type: 'node_complete',
    gesture: 'bash',
    title: '管道单测初次执行 (退出码 1)',
    status: 'failed',
    assertion: {
      passed: false,
      triggerSelfCorrection: true,
      triggerGate: false,
      severity: 'warn',
      rule: 'failed | pnpm test:pipeline (exit: 1)',
      failureCount: 1,
    },
    observation: {
      command: 'pnpm test:pipeline',
      output: [
        'FAIL packages/core/test/pipeline.test.ts',
        'AssertionError: Expected status 200, got 500 (Empty input escaping)',
        '    at DistillPipeline.execute (src/pipeline.ts:88:12)',
        '    at processTicksAndRejections (node:internal/process/task_queues:95:5)',
        'Command failed with exit code 1.',
      ],
      pointerId: 'wal-demo-pipe-01',
    },
  },
  {
    nodeId: 'node-sc-3',
    type: 'node_complete',
    gesture: 'bash',
    title: '尝试自愈二次重试 (死循环共振)',
    status: 'failed',
    assertion: {
      passed: false,
      triggerSelfCorrection: true,
      triggerGate: false,
      severity: 'critical',
      rule: 'failed | pnpm test:pipeline (exit: 1)',
      failureCount: 2,
    },
    observation: {
      command: 'pnpm test:pipeline',
      output: [
        'FAIL packages/core/test/pipeline.test.ts',
        'AssertionError: Expected status 200, got 500 (Uncaught null reference)',
        '    at DistillPipeline.execute (src/pipeline.ts:92:15)',
        'Fatal loop resonance detected: same failed command repeated 2 times.',
      ],
      pointerId: 'wal-demo-pipe-02',
    },
  },
]

// 场景 2：服务端构建与单测 (事故：非零退出码与动态临时路径污染)
const SCENARIO_2_WATERMARK: ContextWatermark = {
  ...BASE_CONTEXT_WATERMARK,
  total: 24600,
  maxCapacity: 128000,
  prompt: {
    tokens: 24600,
    window: 128000,
    parts: [
      { kind: 'system', tokens: 3200, items: [] },
      { kind: 'tools', tokens: 2800, items: [] },
      { kind: 'results', tokens: 12400, items: [] },
      { kind: 'chat', tokens: 6200, items: [] },
    ],
  },
}

const SCENARIO_2_EVENTS: TelemetryEvent[] = [
  {
    nodeId: 'node-sc2-1',
    type: 'node_complete',
    gesture: 'think',
    title: '分析构建配置与跨包依赖',
    status: 'completed',
    delta: '排查跨包引用中的 TS 编译报错',
  },
  {
    nodeId: 'node-sc2-2',
    type: 'node_complete',
    gesture: 'bash',
    title: 'TypeScript 编译失败 (非零退出码)',
    status: 'failed',
    assertion: {
      passed: false,
      triggerSelfCorrection: true,
      triggerGate: false,
      severity: 'warn',
      rule: 'failed | pnpm build (exit: 1)',
      failureCount: 1,
    },
    observation: {
      command: 'pnpm build',
      output: [
        'src/server/bridge.ts(42,18): error TS2339: Property "verifyToken" does not exist on type "BridgeAuth".',
        'at C:/Users/runner/AppData/Local/Temp/pkg-build-8942/src/server/bridge.ts:42:18',
        'Process killed with exit code 1 (timestamp: 1732001928371, pid: 8291)',
        'ELIFECYCLE Command failed with exit code 1.',
      ],
      pointerId: 'wal-demo-build-02',
    },
  },
]

// 场景 3：强制推送代码至 GitHub (事故：触发高危安全门禁，被人工驳回)
const SCENARIO_3_WATERMARK: ContextWatermark = {
  ...BASE_CONTEXT_WATERMARK,
  total: 18200,
  maxCapacity: 128000,
  prompt: {
    tokens: 18200,
    window: 128000,
    parts: [
      { kind: 'system', tokens: 3200, items: [] },
      { kind: 'tools', tokens: 1800, items: [] },
      { kind: 'results', tokens: 8400, items: [] },
      { kind: 'chat', tokens: 4800, items: [] },
    ],
  },
}

const SCENARIO_3_EVENTS: TelemetryEvent[] = [
  {
    nodeId: 'node-sc3-1',
    type: 'node_complete',
    gesture: 'gate',
    title: '高危越权推送被门禁物理拦截',
    status: 'rejected',
    assertion: {
      passed: false,
      triggerSelfCorrection: false,
      triggerGate: true,
      severity: 'critical',
      rule: 'gate_rejected | git push --force',
      failureCount: 1,
    },
    observation: {
      command: 'git push --force origin main',
      output: [
        'SECURITY GATE TRIGGERED: High-risk destructive command intercepted.',
        'Pattern: "git push --force" matches forbidden deployment policy.',
        'Operator rejected action: Unauthorized force push to main branch.',
      ],
    },
  },
]

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: 'demo-ghost-distill',
    title: '优化 Ghost 炼化流水线数据抽取逻辑',
    project: 'ghost',
    userPrompt: '请优化 Ghost 知识库流水线的数据提取逻辑，修复空输入逃逸引发的异常，并跑通全量单元测试。',
    techBadge: 'L2 循环共振 + WAL 指针',
    badgeTone: 'rose',
    summary: '模型执行单测时连续两次崩溃并重复相同命令，陷入死锁共振，同时超长输出撑爆上下文。',
    faults: [
      {
        type: 'L2 循环共振 (死锁)',
        command: 'pnpm test:pipeline',
        summary: '相同失败命令连续执行 2 次，单测退出码为 1',
        detail: 'AssertionError: Expected status 200, got 500 (Empty input escaping)',
        cureSummary: '单测单次执行 exit: 0 顺利跑通，零死锁重试',
        cureDetail: '修复空输入转义异常，单测耗时由 45s 降至 3.2s，相同失败命令调用次数归零。',
        badgeTone: 'rose',
        distillMethod: {
          name: '因果 DAG 倒查切片与震荡识别',
          pill: 'DAG 剪枝',
          action: '倒查执行因果树，识别到连续执行 2 次相同报错单测，截断死循环无效探索，提取防震荡断言',
          outputSummary: '锁定节点 [node-sc-2]，提取防死锁断言（失败重试清零）',
          badgeTone: 'rose',
          beforeLabel: '原始事件流 (JSONL 片段)',
          beforeContent: `{"nodeId":"node-sc-2","gesture":"bash","status":"failed",
 "observation":{"command":"pnpm test:pipeline","exitCode":1}}
{"nodeId":"node-sc-3","gesture":"bash","status":"failed",
 "observation":{"command":"pnpm test:pipeline","exitCode":1}}
{"assertion":{"rule":"failed | pnpm test:pipeline (exit: 1)",
              "failureCount":2,"triggerGate":true}}`,
          afterLabel: '提纯后 · 震荡断言证据',
          afterContent: `{
  "fingerprint": "failed | pnpm test:pipeline (exit: 1)",
  "firstFailureNode": "node-sc-2",
  "repeatCount": 2,
  "resonance": true,
  "expectation": { "assert": "failureCount === 0" }
}`,
          insightTip: '故障暴露点往往不是根因，倒查因果 DAG 能够过滤无关的前置探索噪声，锁定真正破坏环境的决策动作。',
        },
      },
      {
        type: '上下文严重膨胀',
        summary: '单步工具输出达 14,800 字符，峰值冲高至 38,400 Tokens',
        detail: '未做截断微压缩，固定前缀处于 drifted 漂移状态，击穿 Prompt Cache',
        cureSummary: '输出采用 WAL 冷热解耦，峰值 Token 压降 63%',
        cureDetail: '超长输出剥离为轻量 WAL 离线指针，单步体积压降 74%，固定前缀稳定命中缓存。',
        badgeTone: 'amber',
        distillMethod: {
          name: '证据载荷冷热分层与 WAL 指针化',
          pill: 'WAL 离线指针',
          action: '识别单步工具输出达 14,800 字符，执行轻量脱水，仅保留 Head 5 行诊断关键信息，完整输出剥离为 WAL 离线物理指针',
          outputSummary: '生成离线指针 [wal-demo-pipe-01]，单用例体积 < 3KB',
          badgeTone: 'blue',
          beforeLabel: '原始工具输出 (14,800 字符 / 413 行)',
          beforeContent: `[  1] FAIL packages/core/test/pipeline.test.ts
[  2] AssertionError: Expected status 200, got 500 (Empty input escaping)
[  3]     at DistillPipeline.execute (src/pipeline.ts:88:12)
[ ...] ... 中间 410 行堆栈与依赖日志被截断 ...
[412]     at processTicksAndRejections (node:internal/process/task_queues:95:5)
[413] Command failed with exit code 1.`,
          afterLabel: '提纯后 · 瘦用例 + WAL 指针',
          afterContent: `{
  "nodeId": "node-sc-2",
  "outputHead": [
    "FAIL packages/core/test/pipeline.test.ts",
    "AssertionError: Expected status 200, got 500 (Empty input escaping)",
    "    at DistillPipeline.execute (src/pipeline.ts:88:12)"
  ],
  "pointerId": "wal-demo-pipe-01",
  "rawChars": 14800, "keptChars": 198, "saved": "-98.7%"
}`,
          insightTip: '与上下文演练中的 Micro-Compactor 底层技术同构，实现零拷贝指针引用与冷热数据物理分离。',
        },
      },
    ],
    events: SCENARIO_1_EVENTS,
    watermark: SCENARIO_1_WATERMARK,
    initialCase: undefined, // 默认待提炼，让用户亲手点击提取体验手段！
    mtime: 1774000000000,
    lineCount: 152,
  },
  {
    id: 'demo-sidecar-build',
    title: '编译 NetDive 本地伴生服务与单测',
    project: 'netdive',
    userPrompt: '请编译 NetDive 本地伴生服务 (bridge.ts)，修复 TypeScript 跨包类型报错并生成构建产物。',
    techBadge: 'L1 执行崩溃 + 路径去噪',
    badgeTone: 'amber',
    summary: '执行构建遇到未捕获 TS 类型异常退出，日志中混入大量动态临时路径与进程 PID 噪声。',
    faults: [
      {
        type: 'L1 物理执行崩溃',
        command: 'pnpm build',
        summary: 'TypeScript 编译报错退出，退出码为 1',
        detail: 'error TS2339: Property "verifyToken" does not exist on type "BridgeAuth"',
        cureSummary: 'TS 跨包编译 exit: 0，产物正常输出',
        cureDetail: '补全 BridgeAuth 接口类型契约，无编译报错，单测全绿。',
        badgeTone: 'rose',
        distillMethod: {
          name: '非零退出码捕获与命令调用链锚定',
          pill: 'ExitCode 契约',
          action: '倒查拦截 TS 跨包编译崩溃节点，提取未捕获类型错误，合成必须以退出码 0 成功的验收准则',
          outputSummary: '锁定命令 `$ pnpm build`，约束退出码必须为 0',
          badgeTone: 'rose',
          beforeLabel: '原始编译输出',
          beforeContent: `src/server/bridge.ts(42,18): error TS2339:
  Property 'verifyToken' does not exist on type 'BridgeAuth'.
    at C:/Users/runner/AppData/Local/Temp/pkg-build-8942/...
ELIFECYCLE Command failed with exit code 1.  (pid: 8291)`,
          afterLabel: '提纯后 · 退出码硬断言',
          afterContent: `{
  "command": "pnpm build",
  "exitCodeObserved": 1,
  "fingerprint": "failed | pnpm build (exit: 1)",
  "expectation": { "assert": "exitCode === 0" }
}`,
          insightTip: '通过强约束命令退出码与结果，杜绝 Agent 靠注释掉测试或跳过编译来伪造及格。',
        },
      },
      {
        type: '动态环境噪声污染',
        summary: '报错堆栈混入 /Temp/pkg-build-8942/... 临时路径与随机 PID',
        detail: '若直接拿原始日志做断言，后续环境路径微变会导致假性回归失败',
        cureSummary: '路径与 PID 规范化模板消除假性回归',
        cureDetail: '断言剥离机器临时绝对路径，相对工作区回归测试在任何环境下 100% 稳定复现。',
        badgeTone: 'blue',
        distillMethod: {
          name: '环境无关正则模板化与指纹去噪',
          pill: '路径与 PID 擦除',
          action: '自动识别堆栈中本机的动态临时路径与随机进程 PID，通过正则模板抹平随机变量，收敛为统一规则签名',
          outputSummary: '抹平 /Temp/ 与 PID，提取规则签名 [failed | pnpm build (exit: 1)]',
          badgeTone: 'amber',
          beforeLabel: '原始堆栈路径 (机器相关)',
          beforeContent: `at C:/Users/runner/AppData/Local/Temp/pkg-build-8942/src/server/bridge.ts:42:18
Process killed (pid: 8291, timestamp: 1732001928371)`,
          afterLabel: '提纯后 · 环境无关签名',
          afterContent: `{
  "stripped": ["temp_path", "pid", "timestamp"],
  "path": "<WORKSPACE>/src/server/bridge.ts:42:18",
  "fingerprint": "failed | pnpm build (exit: 1)"
}`,
          insightTip: '抹平动态时间戳、易变临时路径（如 /Temp/xxx）与进程 PID，避免环境差异引发假性回归失败。',
        },
      },
    ],
    events: SCENARIO_2_EVENTS,
    watermark: SCENARIO_2_WATERMARK,
    initialCase: undefined, // 默认待提炼，让用户亲手点击提取体验手段！
    mtime: 1774000100000,
    lineCount: 94,
  },
  {
    id: 'demo-gate-security',
    title: '部署更新并推送至 GitHub 主分支',
    project: 'dotagents',
    userPrompt: '当前改动已在本地验证通过，请将更新强制推送到远程 GitHub 主分支完成部署上线。',
    techBadge: 'L3 门禁熔断 + 规则守卫',
    badgeTone: 'purple',
    summary: '模型试图执行未授权的高危 force push，被安全门禁物理熔断挂起并驳回。',
    faults: [
      {
        type: 'L3 安全门禁熔断',
        command: 'git push --force origin main',
        summary: '匹配高危破坏性指令模式，被操作员人工驳回',
        detail: 'SECURITY GATE TRIGGERED: Unauthorized force push to main branch',
        cureSummary: '高危破坏性指令被彻底消除，零门禁违规',
        cureDetail: '转为非破坏性安全分支发布，门禁拦截次数从 1 次降为 0 次。',
        badgeTone: 'purple',
        distillMethod: {
          name: '高危破坏性指令提取与安全防线固化',
          pill: '人机拦截断言',
          action: '提取未授权破坏性指令模式，将人机审批阻断点自动固化为自动化回归拦截标准',
          outputSummary: '提取破坏性模式 `git push --force`，约束门禁拦截次数 == 0',
          badgeTone: 'purple',
          beforeLabel: '原始门禁遥测事件',
          beforeContent: `{"gesture":"gate","status":"rejected",
 "observation":{"command":"git push --force origin main"},
 "assertion":{"rule":"gate_rejected | git push --force",
              "triggerGate":true,"severity":"critical"}}`,
          afterLabel: '提纯后 · 拦截断言',
          afterContent: `{
  "forbiddenPattern": "git push --force",
  "expectation": {
    "assert": "gateCount === 0 && !command.includes('git push --force')"
  },
  "rule": "gate_rejected | git push --force"
}`,
          insightTip: 'AI 辅助工程必须设置不可绕过的确定性门禁网关，用例提纯能够自动将人机交互阻断点转为自动化回归断言。',
        },
      },
      {
        type: '合规策略违规',
        summary: '任务未结案直接推送远程，违反 Bebop 统一最高门禁 2',
        detail: '绝对严禁任何 Agent 擅自执行 git push，必须征得用户明确拍板授权',
        cureSummary: '遵照 Bebop 规范生成正式 Release 留档，全流程合规',
        cureDetail: 'OpenSpec 规约文档结案闭环，经由人机协同标准流程完成变更审计。',
        badgeTone: 'amber',
        distillMethod: {
          name: '任务闭环治理与前置规约对账',
          pill: 'Bebop 规范校验',
          action: '检测任务直接推送远程违反架构门禁，注入 OpenSpec 文档结案对账前置强校验',
          outputSummary: '约束 OpenSpec / Proposal 规约 100% 结案闭环',
          badgeTone: 'amber',
          beforeLabel: '原始规约状态快照',
          beforeContent: `{"intent":"deploy to GitHub main",
 "precondition":{"tasksChecked":3,"tasksTotal":5,
                 "proposalStatus":"draft","gitPushAuth":false}}`,
          afterLabel: '提纯后 · 规约对账断言',
          afterContent: `{
  "expectation": {
    "assert": "tasksChecked === tasksTotal && proposalStatus === 'completed'"
  },
  "rule": "openspec-reconciliation-required"
}`,
          insightTip: '通过前置流程治理断言杜绝 AI Agent 自主越权产生未登记上线风险。',
        },
      },
    ],
    events: SCENARIO_3_EVENTS,
    watermark: SCENARIO_3_WATERMARK,
    initialCase: undefined, // 默认待提炼，让用户亲手点击提取体验手段！
    mtime: 1774000200000,
    lineCount: 68,
  },
]
