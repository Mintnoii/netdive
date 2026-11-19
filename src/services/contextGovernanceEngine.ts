import {
  compactToolLines,
  computePrefixHash,
} from './microCompactor'

/**
 * 预置注册工具契约 (Registered Tool Schema)
 */
export interface RegisteredTool {
  name: string
  description: string
  parameters: string
}

/**
 * 通用上下文演练单步状态模型契约
 */
export interface GovernanceStep {
  stepIndex: number
  title: string
  gesture: 'think' | 'read' | 'edit' | 'bash' | 'memory' | 'gate'
  actor: string
  summary: string
  rawOutput?: string
  /** 是否属于子任务完成的安全压缩软边界（适合触发前半段精简） */
  isSafeBoundary: boolean
  boundaryReason?: string
  /** 输出是否超过阈值需要掐头去尾 */
  hasLargePayload: boolean
  largePayloadLines?: number
  tags?: string[]
  /** 推进到此步骤时动态达成的阶段性业务里程碑 */
  milestoneAchieved?: string
  /** 连续同构子调用（展开为多个节点，可折叠为一个聚合节点） */
  consecutiveSubCalls?: { title: string; summary: string }[]
  /** 每次同构调用重复的 Tool Schema 样板开销（折叠后只保留一份） */
  schemaOverheadTokens?: number
}

/**
 * 固化置顶指令块契约 (Pinned Directive State)
 */
export interface PinnedDirectives {
  userGoal: string
  systemPrompt: string
  registeredTools: RegisteredTool[]
  hardConstraints: string[]
  completedMilestones: string[]
  isLocked: boolean
}

/**
 * 原始备份记录契约 (按索引 ID 可 100% 原样取回)
 */
export interface BackupRecord {
  pointerId: string
  type: 'large_tool_output' | 'pruned_history' | 'coalesced_calls'
  stepIndex: number
  title: string
  /** 被裁剪/精简掉、从上下文抽离出去的完整原文 */
  fullText: string
  tokens: number
}

/**
 * 历史清理流水账单条记录契约 (Offloaded Record)
 */
export interface OffloadedRecord {
  stepIndex: number
  stepTitle: string
  target: string
  type: 'large_tool_output' | 'pruned_history' | 'coalesced_calls'
  originalLines: number
  compactedLines: number
  originalTokens: number
  reclaimedTokens: number
  pointerId: string
  summary: string
  timestamp: number
}

/**
 * 工业级上下文管理大对象 (ContextState · 上下文装配状态机实体)
 * 涵盖：1. Token 剩余容量与动态开销；2. 固定前置上下文(Prompt 骨架)；3. 动态交互工作区；4. 历史清理流水账(备份指针)
 */
export interface ContextState {
  /** 1. Token 剩余容量与动态开销 (Token Budget & Capacity) */
  budget: {
    maxCapacity: number
    rawTokensTotal: number
    optimizedTokensTotal: number
    reclaimedTokensTotal: number
    savedPercent: number
    headroomTokens: number
  }
  /** 2. 固定前置上下文 · Prompt 骨架 (Static Prefix · 系统身份 + 用户目标 + 注册工具 + 核心约束，字节级锁定命中缓存) */
  staticPrefix: {
    baseSystemPrompt: string
    pinnedDirectives: PinnedDirectives
    prefixHash: string
    isCacheStable: boolean
  }
  /** 3. 动态交互工作区 (当前正在执行的消息与步骤) */
  workingSet: {
    activeSteps: GovernanceStep[]
    currentStep: GovernanceStep
    currentStepIndex: number
    totalSteps: number
  }
  /** 4. 历史清理流水账 · 备份索引表 (Offloaded Ledger · 记录掐头去尾截断与历史打包归档的摘要及完整原件指针) */
  offloadedLedger: {
    totalEvictedTokens: number
    totalEvictedLines: number
    records: OffloadedRecord[]
    /** 索引 ID → 完整原文，支持按 ID 精确取回与还原放回 */
    backupStore: Map<string, BackupRecord>
  }
}

/**
 * 演练会话全局状态快照
 */
export interface GovernanceSimulationState {
  currentStepIndex: number
  totalSteps: number
  currentStep: GovernanceStep
  pinnedDirectives: PinnedDirectives
  appliedOptimizations: Record<number, boolean>
  prunedStageOne: boolean
  rawTokensTotal: number
  optimizedTokensTotal: number
  reclaimedTokensTotal: number
  savedPercent: number
  prefixHash: string
  isTimestampInjected: boolean
  contextState: ContextState
}

/**
 * 真实注册工具清单
 */
export const SCENARIO_TOOLS: RegisteredTool[] = [
  { name: 'ghost_scan', description: '扫描 _raw/ 待炼化素材与 YAML 元数据', parameters: '{ category: string, keyword?: string }' },
  { name: 'vector_match', description: '186 张卡片向量余弦比对与哈希验重', parameters: '{ bucket: string, threshold: 0.88 }' },
  { name: 'wiki_lint', description: '巡检全库 WikiLinks 死链与出链门禁', parameters: '{ maxOutlinks: 8 }' },
  { name: 'read_wiki', description: '读取 wiki/learning/ 概念卡正文', parameters: '{ path: string }' },
  { name: 'write_card', description: '写入或更新概念卡/信源卡/MOC看板', parameters: '{ path: string, content: string }' },
]

/**
 * 真实流水线场景（扩充至完整 9 步，强化前半截积累与阶段收敛）
 */
export const REAL_DISTILLATION_SCENARIO: {
  title: string
  description: string
  pinned: PinnedDirectives
  steps: GovernanceStep[]
} = {
  title: 'Ghost 知识库真实炼化流水线',
  description: '素材分诊 -> 预热注入 -> 三卡并发提纯 -> 去AI痕润色 -> [阶段收敛剪枝] -> 向量对撞 -> 卡片落盘 -> MOC反链 -> wiki:lint 终检',
  pinned: {
    userGoal: '炼化 _raw/articles/15 种高级 RAG 技术大比拼.md 并收敛至知识图谱',
    systemPrompt: 'You are an autonomous Knowledge Distiller. Enforce IPO structure, clamp reasoning effort to low, and converge concept outlinks <= 8.',
    registeredTools: SCENARIO_TOOLS,
    hardConstraints: [
      '概念卡严格遵循 IPO 结构（## 1. 核心定义与第一性机理）',
      '实体出链严格控制在 8 条以内（rules.ts 门禁）',
      '微创去 AI 痕锁定低推理档位（low），防止 300s 超时',
    ],
    completedMilestones: [
      '素材 SHA-256 校验通过 (8f7e2a9c)',
    ],
    isLocked: true,
  },
  steps: [
    {
      stepIndex: 0,
      title: '扫描素材与 YAML 解析',
      gesture: 'think',
      actor: 'Pi (Distiller)',
      summary: '读取素材 YAML 元数据与 14,280 字符正文，解析标题、作者与时间戳。',
      rawOutput: [
        '[ghost_scan] 扫描目标: _raw/articles/15 种高级 RAG 技术大比拼，值得收藏！.md',
        'entry: wechat-clipper | author: Tarun | length: 14,280 chars',
        'Frontmatter parsed: title, category=ai-agent, date=2026-11-18.',
      ].join('\n'),
      isSafeBoundary: false,
      hasLargePayload: false,
      tags: ['scan', 'parse'],
      milestoneAchieved: '素材元数据解析与 SHA-256 校验通过',
    },
    {
      stepIndex: 1,
      title: '全库 186 张卡片验重',
      gesture: 'read',
      actor: 'Zero-Ledger Gate',
      summary: '与既有 186 张卡片做差集名称查重，确认无同名分身。',
      rawOutput: [
        'Checking against Zero-Ledger (186 existing cards)...',
        'No duplicate concept titles found. Clear to proceed to Phase 1.',
      ].join('\n'),
      isSafeBoundary: false,
      hasLargePayload: false,
      tags: ['dedup'],
      milestoneAchieved: 'Zero-Ledger 前置查重通过（无同名概念）',
    },
    {
      stepIndex: 2,
      title: 'Top 10 概念上下文预热',
      gesture: 'read',
      actor: 'Context Injector',
      summary: '召回 10 张高相关概念卡组装 Prompt Cache 前缀，享受 9 折优惠。',
      rawOutput: [
        'Injected 10 relevant concepts from wiki/learning/:',
        '  - [[分块边界动态自适应机制]]',
        '  - [[递归字符分块与语义滑动窗口]]',
        '  - [[大模型重排与重叠块融合]]',
        'Prefix Hash: 6a8f1e9c2b4d | Prompt Cache warm-up completed.',
      ].join('\n'),
      isSafeBoundary: false,
      hasLargePayload: false,
      tags: ['cache', 'warmup'],
      milestoneAchieved: 'Top 10 概念卡注入就绪（Prompt Cache 稳定）',
    },
    {
      stepIndex: 3,
      title: '大模型并发抽取三大核心卡',
      gesture: 'think',
      actor: 'Inference Engine',
      summary: '并发提纯自适应分块、滑动窗口、重叠块融合 3 张概念卡 IPO 初稿。',
      rawOutput: [
        'Inference Session: deepseek-chat (concurrent x3) - Generation Output Stream:',
        'Extracted Concepts Draft Details (Full Output):',
        '--- CONCEPT 1 ---',
        'title: 分块边界动态自适应机制',
        'summary: 句子与标头层级自适应滑动窗口，基于自然语义切分点保证语义块的自闭环。',
        'content: ' + '在面向复杂技术文档的向量化过程中，固定字符长度截断往往导致核心谓词或上下文语义被物理腰斩。通过在标头、段落、句子层级设置自适应回退界标，结合语义滑动窗口，能够在切分时动态检测块末完整性，从而消减因断句导致的检索幻觉。'.repeat(16),
        '--- CONCEPT 2 ---',
        'title: 递归字符分块与语义滑动窗口',
        'summary: 多层分隔符递归切分保证单块上下文连贯，结合小步长滑动窗口维持段落承接。',
        'content: ' + '递归分块策略优先尝试二级、三级 Markdown 标题进行粗切，若分块尺寸依然超出 Token 预算，则逐级回退至双换行、单换行以及句号标点。重叠滑动窗口机制在此基础上保留前后 10% 的上下文缓冲，避免块交界处的概念碎片化。'.repeat(16),
        '--- CONCEPT 3 ---',
        'title: 大模型重排与重叠块融合',
        'summary: 跨 chunk 交叉验证消减检索幻觉，利用微调重排模型计算查询与切片的细粒度语义交叉矩阵。',
        'content: ' + '单凭密集向量余弦对撞往往只能捕获浅层主题相似度。在重排阶段引入交叉注意力机制对候选切片进行重打分，并对相邻重叠块进行语义缝合，既能消解窗口断裂风险，又能在预算内最大化有效信息密度。'.repeat(16),
        'Draft length: 4,200 tokens. Schema validated.',
      ].join('\n'),
      isSafeBoundary: false,
      hasLargePayload: false,
      tags: ['distill', 'extract'],
      milestoneAchieved: '三大核心概念卡草稿抽取完成',
      // 真实业务中这是 3 次连续同构的大模型抽取调用，每次携带相同的 Function Calling Schema 样板
      consecutiveSubCalls: [
        { title: '抽取概念卡 ①  自适应分块', summary: '调用 extract_concept 提纯「分块边界动态自适应机制」，写入 IPO 初稿。' },
        { title: '抽取概念卡 ②  递归滑动窗口', summary: '调用 extract_concept 提纯「递归字符分块与语义滑动窗口」，写入 IPO 初稿。' },
        { title: '抽取概念卡 ③  重排融合', summary: '调用 extract_concept 提纯「大模型重排与重叠块融合」，写入 IPO 初稿。' },
      ],
      schemaOverheadTokens: 380, // 折叠后消除 2 份重复 Schema 样板
    },
    {
      stepIndex: 4,
      title: '微创去 AI 痕与润色定稿',
      gesture: 'edit',
      actor: 'Humanizer Gate',
      summary: '消灭“不是...而是”、清除空洞大词，低推理档位重写定稿。此阶段内容正式收敛，到达安全边界。',
      rawOutput: [
        'Scanning AI patterns in drafted content...',
        '  - Rule #1 (不是...而是): 发现 2 处，已改写为直接陈述句',
        '  - Rule #4 (长前置定语 >15字): 发现 3 处，已拆分为短句',
        'Reasoning effort clamped: low (180ms inference budget)',
        'Draft finalized. Phase 1 concepts locked.',
      ].join('\n'),
      isSafeBoundary: true,
      boundaryReason: '前半段素材提纯与去 AI 痕全部收网定稿，状态转移安全点。此时前 4 步繁杂草稿已成历史，适合触发「打包精简」。',
      hasLargePayload: false,
      tags: ['humanizer', 'safe-boundary'],
      milestoneAchieved: '微创去 AI 痕定稿（去除翻案腔与冗长定语）',
    },
    {
      stepIndex: 5,
      title: '186 张卡片向量余弦对撞',
      gesture: 'bash',
      actor: 'Vector Worker',
      summary: '调用 ghost:vector-match 遍历 186 张卡片比对余弦相似度，产生超长校验矩阵日志。',
      rawOutput: [
        '$ pnpm ghost:vector-match --bucket=.pi/cache/concept-embeddings.deepseek.json',
        'Checking concept embedding cache hashes (186 cards)...',
        ...Array.from({ length: 1850 }, (_, i) => `  [Cache #${i + 1}] wiki/learning/concept-${(i % 50).toString().padStart(3, '0')}.md -> hash: ${((i * 192837) >>> 0).toString(16).padStart(8, '0')} (cos_sim: ${(0.42 + (i % 30) * 0.01).toFixed(4)})`),
        'Semantic Blocking Matrix computed.',
        'Max similarity: 0.764 (< 0.88 gate), 无同质分身。',
        'Process exited with code 0 in 1640ms.',
      ].join('\n'),
      isSafeBoundary: true,
      boundaryReason: '外部进程执行完成（Exit Code 0），语义对撞无冲突，子任务闭环。',
      hasLargePayload: true,
      largePayloadLines: 1856,
      tags: ['vector-match', 'bash'],
      milestoneAchieved: '全库向量余弦对撞通过（最大相似度 0.764 < 0.88）',
    },
    {
      stepIndex: 6,
      title: '概念卡与信源卡落盘',
      gesture: 'edit',
      actor: 'Wiki Builder',
      summary: '写入 3 张概念卡与 1 张信源卡，原子持久化至磁盘。',
      rawOutput: [
        'Writing concepts to disk:',
        '  + wiki/learning/分块边界动态自适应机制.md (42 lines, SHA: d38a7b)',
        '  + wiki/learning/递归字符分块与语义滑动窗口.md (38 lines, SHA: 82cf41)',
        '  + wiki/learning/大模型重排与重叠块融合.md (45 lines, SHA: c9120e)',
        '  + wiki/sources/15 种高级 RAG 技术大比拼，值得收藏！.md (26 lines, SHA: e1408a)',
        'FSync completed: 4 files committed to working tree.',
      ].join('\n'),
      isSafeBoundary: false,
      hasLargePayload: false,
      tags: ['fsync', 'write'],
      milestoneAchieved: '3 张概念卡与 1 张信源卡落盘完成',
    },
    {
      stepIndex: 7,
      title: 'MOC 知识看板与双向反链刷新',
      gesture: 'edit',
      actor: 'MOC Reconciler',
      summary: '增量刷新 wiki/areas/ai-agent/_index.md 看板索引与反向链接。',
      rawOutput: [
        'Updating MOC: wiki/areas/ai-agent/_index.md',
        '  - Registered 3 new concepts under [[高级分块与重排策略]]',
        '  - Reconciled backlinks in [[RAG 系统架构]] (+3 references)',
        'Total concept count in area: 189 cards.',
        'MOC reconciliation successful in 32ms.',
      ].join('\n'),
      isSafeBoundary: false,
      hasLargePayload: false,
      tags: ['moc', 'backlinks'],
      milestoneAchieved: 'MOC 知识看板与双向反链拓扑刷新',
    },
    {
      stepIndex: 8,
      title: '全库 wiki:lint 终检绿灯',
      gesture: 'bash',
      actor: 'Quality Gatekeeper',
      summary: '出链门禁收敛（all <= 8）与零死链校验，0 issues 收工。',
      rawOutput: [
        '$ pnpm wiki:lint && pnpm analyze:outlinks',
        '✓ Checking YAML Frontmatter schemas (189 concepts)... PASS',
        '✓ Verifying internal WikiLinks integrity (0 broken links)... PASS',
        '✓ Checking outlink thresholds (all <= 8)... PASS',
        '✨ Status: 0 errors, 0 warnings. Topology converged.',
        'Process exited with code 0 in 480ms.',
      ].join('\n'),
      isSafeBoundary: true,
      boundaryReason: '全流程终检 0 退出码闭环，任务全部完成。',
      hasLargePayload: false,
      tags: ['lint', 'complete'],
      milestoneAchieved: '全库 wiki:lint 0 警告 0 报错（图谱收敛绿灯）',
    },
  ],
}

export const STANDARD_GOVERNANCE_SCENARIO = REAL_DISTILLATION_SCENARIO

export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

/**
 * 单步推演纯函数
 */
export function computeSimulationSnapshot(
  scenario = REAL_DISTILLATION_SCENARIO,
  stepIndex: number,
  appliedOptimizations: Record<number, boolean> = {},
  prunedStageOne = false,
  isTimestampInjected = false,
  coalescedSteps: Record<number, boolean> = {}
): GovernanceSimulationState {
  const safeIndex = Math.max(0, Math.min(stepIndex, scenario.steps.length - 1))
  const currentStep = scenario.steps[safeIndex]
  const maxCapacity = 128000

  // 1. 动态收集阶段里程碑
  const dynamicMilestones = [...scenario.pinned.completedMilestones]
  for (let i = 0; i <= safeIndex; i++) {
    const s = scenario.steps[i]
    if (s.milestoneAchieved && !dynamicMilestones.includes(s.milestoneAchieved)) {
      dynamicMilestones.push(s.milestoneAchieved)
    }
  }

  const pinnedDirectives: PinnedDirectives = {
    ...scenario.pinned,
    completedMilestones: dynamicMilestones,
    isLocked: !isTimestampInjected,
  }

  // 2. 构造固定前缀字符串（若模拟注入时间戳，哈希将突变并打破前缀）
  const timestampSuffix = isTimestampInjected ? ` [MUTATED_TS: ${new Date('2026-11-18T20:30:00Z').toISOString()}]` : ''
  const toolsString = scenario.pinned.registeredTools.map(t => `${t.name}: ${t.description}`).join('; ')
  const baseSystemPrompt = `${scenario.pinned.systemPrompt} Tools: [${toolsString}]. User Goal: ${scenario.pinned.userGoal}. Rules: [${scenario.pinned.hardConstraints.join('; ')}]${timestampSuffix}`
  const prefixHash = computePrefixHash(baseSystemPrompt)

  let rawTokensTotal = estimateTokens(baseSystemPrompt)
  let optimizedTokensTotal = rawTokensTotal

  const activeSteps: GovernanceStep[] = []
  const offloadedRecords: OffloadedRecord[] = []
  const backupStore = new Map<string, BackupRecord>()
  let totalEvictedTokens = 0
  let totalEvictedLines = 0

  // 3. 计算步骤消耗与两类交互优化（掐头去尾截断 + 前半段打包精简）
  for (let i = 0; i <= safeIndex; i++) {
    const step = scenario.steps[i]
    activeSteps.push(step)
    const stepOutput = step.rawOutput || step.summary
    const stepRawTokens = estimateTokens(stepOutput)
    rawTokensTotal += stepRawTokens

    // 交互点 A: 若前半段（Step 0~3）已被打包精简，且当前进度在 Step 4 或更后
    if (prunedStageOne && i < 4 && safeIndex >= 4) {
      // 原来 4 步的原始文本被精简为高密度 2 行摘要
      const prunedTokens = 120 // 极简摘要
      optimizedTokensTotal += prunedTokens
      const reclaimed = Math.max(0, stepRawTokens - prunedTokens)
      totalEvictedTokens += reclaimed
      totalEvictedLines += (step.rawOutput?.split('\n').length || 1)
    } else if (appliedOptimizations[i] && step.hasLargePayload && step.rawOutput) {
      // 交互点 B: 单步超长输出掐头去尾
      const compacted = compactToolLines(step.rawOutput)
      const stepOptTokens = estimateTokens(compacted.compactedText)
      optimizedTokensTotal += stepOptTokens

      const stepReclaimed = Math.max(0, stepRawTokens - stepOptTokens)
      const evictedLines = Math.max(0, compacted.originalLines - compacted.compactedLines)
      totalEvictedTokens += stepReclaimed
      totalEvictedLines += evictedLines

      offloadedRecords.push({
        stepIndex: i,
        stepTitle: step.title,
        target: `${step.actor} 日志输出`,
        type: 'large_tool_output',
        originalLines: compacted.originalLines,
        compactedLines: compacted.compactedLines,
        originalTokens: stepRawTokens,
        reclaimedTokens: stepReclaimed,
        pointerId: `wal-call-step-${i + 1}`,
        summary: `已掐头去尾（保留前15行与后15行，中间 ${evictedLines} 行存入内存 WAL）`,
        timestamp: Date.now() - (safeIndex - i) * 60000,
      })

      // 把被裁掉的完整原文按索引 ID 存入备份仓库，支持后续按 ID 精确取回
      backupStore.set(`wal-call-step-${i + 1}`, {
        pointerId: `wal-call-step-${i + 1}`,
        type: 'large_tool_output',
        stepIndex: i,
        title: step.title,
        fullText: step.rawOutput,
        tokens: stepRawTokens,
      })
    } else {
      // 交互点 C: 连续同构调用折叠 —— 3 次同构抽取合并为 1 个节点，消除重复的 Tool Schema 样板
      if (coalescedSteps[i] && step.consecutiveSubCalls && step.schemaOverheadTokens) {
        const callCount = step.consecutiveSubCalls.length
        const saved = step.schemaOverheadTokens * (callCount - 1) // 只保留一份 Schema
        optimizedTokensTotal += Math.max(0, stepRawTokens - saved)
        totalEvictedTokens += saved
        totalEvictedLines += callCount - 1

        offloadedRecords.push({
          stepIndex: i,
          stepTitle: step.title,
          target: `${step.actor} 同构调用 Schema 样板`,
          type: 'coalesced_calls',
          originalLines: callCount,
          compactedLines: 1,
          originalTokens: step.schemaOverheadTokens * callCount,
          reclaimedTokens: saved,
          pointerId: `wal-coalesce-step-${i + 1}`,
          summary: `已将 ${callCount} 次连续同构抽取折叠为 1 个聚合节点，消除 ${callCount - 1} 份重复 Schema 样板`,
          timestamp: Date.now() - (safeIndex - i) * 60000,
        })

        backupStore.set(`wal-coalesce-step-${i + 1}`, {
          pointerId: `wal-coalesce-step-${i + 1}`,
          type: 'coalesced_calls',
          stepIndex: i,
          title: step.title,
          fullText: step.consecutiveSubCalls.map((c, idx) =>
            `===== 同构调用 ${idx + 1}/${callCount}: ${c.title} =====\n${c.summary}`
          ).join('\n\n'),
          tokens: step.schemaOverheadTokens * callCount,
        })
      } else {
        optimizedTokensTotal += stepRawTokens
      }
    }
  }

  const reclaimedTokensTotal = Math.max(0, rawTokensTotal - optimizedTokensTotal)
  const savedPercent = rawTokensTotal > 0 ? Math.round((reclaimedTokensTotal / rawTokensTotal) * 100) : 0
  const headroomTokens = Math.max(0, maxCapacity - optimizedTokensTotal)

  // 若前半段打包精简生效，登记一条台账（释放量与 budget 汇总共用同一计算结果）
  if (prunedStageOne && safeIndex >= 4) {
    offloadedRecords.unshift({
      stepIndex: 4,
      stepTitle: '前半段素材提纯与去 AI 痕过程',
      target: 'Step 1~4 历史草稿',
      type: 'pruned_history',
      originalLines: 120,
      compactedLines: 6,
      originalTokens: 3850,
      reclaimedTokens: reclaimedTokensTotal,
      pointerId: 'wal-stage-1-summary',
      summary: '前半段素材解析、验重、提纯与润色已定稿，历史细节已打包精简为结构化摘要',
      timestamp: Date.now() - 120000,
    })

    // 前半段 4 步的完整原文按同一索引 ID 汇总存入备份仓库
    const stageOneFullText = scenario.steps.slice(0, 4).map((s) =>
      `===== Step ${s.stepIndex + 1}: ${s.title} =====\n${s.rawOutput || s.summary}`
    ).join('\n\n')
    backupStore.set('wal-stage-1-summary', {
      pointerId: 'wal-stage-1-summary',
      type: 'pruned_history',
      stepIndex: 4,
      title: '前半段素材提纯与去 AI 痕过程',
      fullText: stageOneFullText,
      tokens: estimateTokens(stageOneFullText),
    })
  }

  const contextState: ContextState = {
    budget: {
      maxCapacity,
      rawTokensTotal,
      optimizedTokensTotal,
      reclaimedTokensTotal,
      savedPercent,
      headroomTokens,
    },
    staticPrefix: {
      baseSystemPrompt,
      pinnedDirectives,
      prefixHash,
      isCacheStable: !isTimestampInjected,
    },
    workingSet: {
      activeSteps,
      currentStep,
      currentStepIndex: safeIndex,
      totalSteps: scenario.steps.length,
    },
    offloadedLedger: {
      totalEvictedTokens,
      totalEvictedLines,
      records: offloadedRecords,
      backupStore,
    },
  }

  return {
    currentStepIndex: safeIndex,
    totalSteps: scenario.steps.length,
    currentStep,
    pinnedDirectives,
    appliedOptimizations,
    prunedStageOne,
    rawTokensTotal,
    optimizedTokensTotal,
    reclaimedTokensTotal,
    savedPercent,
    prefixHash,
    isTimestampInjected,
    contextState,
  }
}
