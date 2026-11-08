import { basename } from 'pathe'
import type { AgentNodeData } from '../components/AgentNode'

/**
 * 计算屏幕空间恒定字号反向缩放系数 (Screen-Space Inverse Scaling)
 * 契约：当画布缩小到 zoom < 0.45 时，提供反向缩放系数 scaleFactor = 1 / safeZoom
 * 乘法相消原理：画布物理缩小 × 节点自身反向放大 ≡ 1
 * 使远景关键地标牌在人类视网膜上的实际显示尺寸绝对恒定保持在 150px~180px 宽、28px 高，
 * 字号稳固在 12px~13px 清晰黑体，杜绝缩成 3px 蚂蚁字
 */
export function calculateInverseScaleFactor(zoom: number): number {
  const safeZoom = zoom > 0 ? zoom : 0.45
  return Number((1 / safeZoom).toFixed(2))
}

/**
 * 确定性思考意图提纯纯函数 (Deterministic Zero-Cost Intent Extraction)
 * 契约：
 * 1. 坚决不调用任何外部 LLM，纯启发式毫秒级提取；
 * 2. 剥离无信息量的客套套话与礼貌前缀（如“好的，我现在需要”、“准备开始”、“接下来我将”等）；
 * 3. 提取完整首句真实动宾意图（支持达 45~50 字符，彻底废除 12~16 字符强制截断），由 280px 卡片自然折行排布；
 * 4. 边界安全：若文本为空或仅含套话，安全回退至 fallback 默认标题。
 *
 * @example
 * extractRealIntent('好的，我现在需要检查App切片是否有断链。接下来我会继续...', '目标规划')
 * // => '检查App切片是否有断链'
 *
 * @example
 * extractRealIntent('准备开始补齐类型声明以通过自动化单测', '决策输出')
 * // => '补齐类型声明以通过自动化单测'
 */
export function extractRealIntent(text: string | undefined | null, fallback: string = '决策思考'): string {
  if (!text || typeof text !== 'string') return fallback

  // 1. 去除 Markdown 标记（标题符、引用符、列表符、代码块反引号、手势表情）
  let clean = text
    .replace(/^[\s#*>-]+/, '')
    .replace(/^`+|`+$/g, '')
    .replace(/^[\p{Extended_Pictographic}$]\s*/u, '')
    .trim()

  if (!clean) return fallback

  // 2. 启发式无信息量客套前缀字典表 (剥离套话与填充词)
  const PREFIX_PATTERNS = [
    // 礼貌答复与承接
    /^(好的|好的呢|好嘞|好的呀|好啊|好的吧|好|收到|明白|了解|没问题|行)[，,、！!。\s~-]*/i,
    // 第一人称/团队意向表态
    /^(我现在需要|我现在将|我现在要|我现在先|我现在准备|我现在去|我现在|我需要|我要|我将|我先|我准备|我去)[，,、\s]*/i,
    /^(我们现在需要|我们现在将|我们现在要|我们现在|我们需要|我们将|我们先|我们准备)[，,、\s]*/i,
    /^(让我先来|让我先|让我来|让我们先|让我们|让我)[，,、\s]*/i,
    // 步骤前缀
    /^(接下来我将|接下来我们需要|接下来将|接下来要|接下来我|接下来)[，,、\s]*/i,
    /^(准备开始|开始准备|准备|开始|先|首先[，,、\s]*(我将|我们需要|我们要|我要)?)[，,、\s]*/i,
    /^(目前需要|目前先|目前将|目前)[，,、\s]*/i,
    // 英文客套与指示
    /^(okay|ok|sure|alright|got it|understood)[,!\s~-]*/i,
    /^(i need to|i will|i should|i want to|i am going to|i'll)[,\s]*/i,
    /^(let me|let's|we will|we need to|we should|we'll)[,\s]*/i,
    /^(next,?\s*(i will|we will)?|first,?\s*(i will|we will)?|firstly,?\s*)[,\s]*/i,
    /^(ready to|starting to|start to)[,\s]*/i,
  ]

  // 循环剥离复合前缀 (例如 "好的，我现在需要先...")
  let prevLength = 0
  while (clean.length > 0 && clean.length !== prevLength) {
    prevLength = clean.length
    for (const pattern of PREFIX_PATTERNS) {
      clean = clean.replace(pattern, '').trim()
    }
  }

  if (!clean) return fallback

  // 3. 提取首行首句（在句号、叹号、问号或换行前截断，保留完整单句）
  const firstLine = clean.split(/[\r\n]+/)[0].trim()
  if (!firstLine) return fallback

  // 按断句标点切割首句
  const sentenceMatch = firstLine.split(/[。！？!?]/)[0].trim()
  let core = sentenceMatch || firstLine

  // 若首句包含冒号且冒号前具备动宾短语（>= 4 字），优先提取冒号前的核心意图 (如 "检查App切片: 发现断链")
  if (core.includes(':') || core.includes('：')) {
    const parts = core.split(/[:：]/)
    if (parts[0].trim().length >= 4 && parts[0].trim().length <= 50) {
      core = parts[0].trim()
    }
  }

  // 4. 清理末尾悬挂的标点符号
  core = core.replace(/[，,。！？!?、:：;；\s]+$/, '').trim()

  if (!core) return fallback

  // 5. 完整首句展示支持达 45~50 字符，由 280px 卡片自然折行排布，绝不截成残缺短句
  if (core.length > 50) {
    core = core.slice(0, 50).replace(/[，,。！？!?、:：;；\s]+$/, '').trim()
  }

  return core || fallback
}

/**
 * 提取精炼醒目的远景 Landmark 地标标签
 * 契约与判定优先级：
 * 1. 异常与报错 -> ❌ 报错 (或 ❌ 已拦截)
 * 2. 门禁待审 -> 🛡️ 门禁待审
 * 3. 剪枝节点 -> ✂️ 已修剪
 * 4. 轮询提取 -> ⚡ 轮询 xN
 * 5. 文件类型 -> 提取清晰文件名 (如 AgentNode.tsx)
 * 6. 命令类型 -> 提取 $ 命令首词 (如 $ pnpm)
 * 7. 自愈分支 -> ✨ 自愈分支
 * 8. 思考规划 -> 提取规划主题 (如 💭 目标规划)
 * 9. 记忆检索 -> 🧠 记忆存取
 */
export function extractLandmarkLabel(nodeData: AgentNodeData): string {
  // 1. 异常与报错 (最高优先级)
  if (
    nodeData.status === 'failed' ||
    nodeData.status === 'rejected' ||
    (typeof nodeData.observation?.exitCode === 'number' && nodeData.observation.exitCode !== 0) ||
    (nodeData.assertion && !nodeData.assertion.passed)
  ) {
    if (nodeData.status === 'rejected') return '❌ 已拦截'
    return '❌ 报错'
  }

  // 2. 门禁待审
  if (nodeData.status === 'gate') {
    return '🛡️ 门禁待审'
  }

  // 3. 剪枝节点
  if (nodeData.pruned) {
    const targetPath = (nodeData.payload?.path ||
      nodeData.payload?.file_path ||
      nodeData.payload?.filePath) as string | undefined
    if (targetPath) {
      return `✂️ ${basename(targetPath)}`
    }
    return '✂️ 已修剪'
  }

  // 4. 轮询提取 (⚡ 轮询 xN)
  const isPolling =
    Boolean(
      nodeData.title &&
        (nodeData.title.includes('轮询') ||
          nodeData.title.toLowerCase().includes('poll') ||
          nodeData.title.includes('terminal'))
    ) ||
    Boolean(
      nodeData.summary &&
        (nodeData.summary.includes('terminal read') ||
          nodeData.summary.includes('terminal wait') ||
          nodeData.summary.includes('terminal check') ||
          nodeData.summary.includes('terminal poll'))
    )

  if (isPolling) {
    const count = nodeData.aggregateCount || 2
    return `⚡ 轮询 x${count}`
  }

  // 若为非轮询的连续聚合节点：必须优先提取具体文件或真实执行命令，绝不展示空洞无价值的“聚合x2”或“命令组x2”
  if (nodeData.isAggregated) {
    const count = nodeData.aggregateCount || 2

    // 1) 优先提取明确的目标文件路径 (read / edit / file)
    const targetPath = (nodeData.payload?.path ||
      nodeData.payload?.file_path ||
      nodeData.payload?.filePath ||
      nodeData.payload?.file) as string | undefined
    if (targetPath) {
      return `${basename(targetPath)} x${count}`
    }

    // 2) 针对 bash 命令行聚合，优先提取具体命令行首句或首词
    if (nodeData.gesture === 'bash') {
      const rawCmd = String(
        nodeData.payload?.command ||
        (Array.isArray(nodeData.payload?.commands) ? (nodeData.payload.commands as string[])[0] : '') ||
        nodeData.observation?.command ||
        ''
      ).trim()

      const cleanCmd = (rawCmd || nodeData.title || '')
        .replace(/\s*\(x\d+\)\s*$/i, '')
        .replace(/^bash:\s*/i, '')
        .replace(/^\$\s*/, '')
        .replace(/\s*命令组.*$/i, '')
        .trim()

      const firstLineCmd = cleanCmd.split(/[\r\n]+/)[0]?.trim()
      if (firstLineCmd) {
        if (firstLineCmd.length <= 32) {
          return `$ ${firstLineCmd} x${count}`
        }
        return `$ ${firstLineCmd.slice(0, 30)}... x${count}`
      }
    }

    // 3) 从聚合标题中提纯具体实体（如 "file: App.tsx", "read: pipeline.ts (x3)", "rg "pattern""）
    if (nodeData.title) {
      const cleanTitle = nodeData.title
        .replace(/\s*\(x\d+\)\s*$/i, '')
        .replace(/^(bash|read|edit|file):\s*/i, '')
        .trim()

      if (cleanTitle && !/^(聚合调用|命令组|连续读取|连续编辑|执行节点)$/i.test(cleanTitle)) {
        if (cleanTitle.length <= 32) {
          return `${cleanTitle} x${count}`
        }
        return `${cleanTitle.slice(0, 30)}... x${count}`
      }
    }

    // 4) 从子调用列表中嗅探首个子操作的目标实体
    if (Array.isArray(nodeData.payload?.subCalls) && (nodeData.payload.subCalls as Record<string, unknown>[]).length > 0) {
      const firstSubCall = (nodeData.payload.subCalls as Record<string, unknown>[])[0]
      const subPath = (firstSubCall.payload as Record<string, unknown> | undefined)?.path as string | undefined
      if (subPath) {
        return `${basename(subPath)} x${count}`
      }
      const subCmd = String(
        (firstSubCall.payload as Record<string, unknown> | undefined)?.command ||
        (firstSubCall.observation as Record<string, unknown> | undefined)?.command ||
        ''
      ).trim()
      if (subCmd) {
        const cleanSub = subCmd.replace(/^\$\s*/, '').split(/[\r\n]+/)[0].trim()
        if (cleanSub.length <= 32) return `$ ${cleanSub} x${count}`
        return `$ ${cleanSub.slice(0, 30)}... x${count}`
      }
    }

    // 5) 兜底依据手势给出具象动作而不是死板抽象名词
    if (nodeData.gesture === 'read') return `代码检视 x${count}`
    if (nodeData.gesture === 'edit') return `文件修改 x${count}`
    if (nodeData.gesture === 'bash') return `$ 终端指令 x${count}`
    if (nodeData.gesture === 'memory') return `记忆存取 x${count}`
    return `${nodeData.gesture} x${count}`
  }

  // 5. 文件类型提取清晰的文件名 (read / edit)
  if (nodeData.gesture === 'read' || nodeData.gesture === 'edit') {
    const targetPath = (nodeData.payload?.path ||
      nodeData.payload?.file_path ||
      nodeData.payload?.filePath ||
      nodeData.payload?.file) as string | undefined

    if (targetPath) {
      return basename(targetPath)
    }

    if (typeof nodeData.payload?.pattern === 'string') {
      return `🔍 ${nodeData.payload.pattern}`
    }

    // 从 title 中提取路径 (如 read: src/components/AgentNode.tsx 或 edit: package.json)
    if (nodeData.title) {
      const cleanTitle = nodeData.title.replace(/^(read|edit|file):\s*/i, '').trim()
      const candidatePath = cleanTitle.split(/\s+/)[0]
      if (candidatePath && (candidatePath.includes('/') || candidatePath.includes('\\') || candidatePath.includes('.'))) {
        return basename(candidatePath)
      }
      if (cleanTitle) {
        return cleanTitle.length > 50 ? `${cleanTitle.slice(0, 48)}...` : cleanTitle
      }
    }

    return nodeData.gesture === 'edit' ? '文件编辑' : '代码检视'
  }

  // 6. 命令类型提取 $ 命令首词 (bash)
  if (nodeData.gesture === 'bash') {
    const rawCmd = String(nodeData.payload?.command || nodeData.observation?.command || '').trim()
    const cleanCmd = (rawCmd || nodeData.title || '')
      .replace(/^bash:\s*/i, '')
      .replace(/^\$\s*/, '')
      .trim()

    const firstWord = cleanCmd.split(/\s+/)[0]
    if (firstWord) {
      return `$ ${firstWord}`
    }
    return '$ bash'
  }

  // 7. 自愈分支 (ReAct Self-Correction Branch)
  if (nodeData.isCorrectionBranch) {
    return '✨ 自愈分支'
  }

  // 8. 思考与推理 (think) - 优先提纯真实意图，杜绝空洞套话
  if (nodeData.gesture === 'think') {
    const rawText =
      (typeof nodeData.delta === 'string' && nodeData.delta.trim()) ||
      (typeof nodeData.summary === 'string' && nodeData.summary.trim()) ||
      nodeData.title ||
      ''

    const intent = extractRealIntent(rawText, '')
    const isDummyTitle = (t: string) =>
      !t ||
      /^(目标规划|决策输出|内部推演|模型执行|执行分析|决策思考)/.test(t)

    if (intent && !isDummyTitle(intent)) {
      const cleanIntent = intent.length > 50 ? `${intent.slice(0, 48)}...` : intent
      return `🎯 ${cleanIntent}`
    }

    if (nodeData.title.includes('目标规划')) return '💭 目标规划'
    if (nodeData.title.includes('内部推演')) return '💭 内部推演'
    if (nodeData.title.includes('决策输出')) return '💭 决策输出'
    if (nodeData.title.includes('模型执行') || nodeData.title.includes('执行分析')) return '💭 执行分析'
    return `💭 ${nodeData.title.length > 50 ? `${nodeData.title.slice(0, 48)}...` : nodeData.title}`
  }

  // 9. 记忆 (memory)
  if (nodeData.gesture === 'memory') {
    return '🧠 记忆存取'
  }

  // 10. 兜底标题提取 (支持完整展示达 45~50 字符)
  return nodeData.title.length > 50 ? `${nodeData.title.slice(0, 48)}...` : nodeData.title
}
