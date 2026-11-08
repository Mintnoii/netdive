/**
 * NetDive Model Context Window Resolution Service
 * 本表是本地保守规则表，未收录的模型一律走兜底，禁止为了让数字好看而随手添加未经核对的窗口值。
 */

/** 未知模型的兜底窗口（不是真实值，UI 必须标明） */
export const FALLBACK_CONTEXT_WINDOW = 200000

export type WindowSource = 'known' | 'default'

export interface ContextWindowResolution {
  window: number
  source: WindowSource
  matchedRule?: string
}

interface ModelWindowRule {
  /** 匹配的小写子串 */
  match: string
  /** 上下文窗口最大 Token 数 (Window Capacity) */
  window: number
  /** 来源说明 */
  sourceNote: string
}

/**
 * 扁平模型上下文窗口规则表
 * 仅收录有公开依据或实测依据的条目，规则顺序决定匹配优先级
 */
const MODEL_WINDOW_RULES: readonly ModelWindowRule[] = [
  {
    // Google Gemini 系列 1M 输入窗口
    match: 'gemini-',
    window: 1048576,
    sourceNote: 'Google Gemini 系列 1M 输入窗口',
  },
  {
    // Anthropic Claude 3/4 系 200k
    match: 'claude-',
    window: 200000,
    sourceNote: 'Anthropic Claude 3/4 系 200k',
  },
  {
    // OpenAI gpt-oss 系列 128k
    match: 'gpt-oss',
    window: 131072,
    sourceNote: 'OpenAI gpt-oss 系列 128k',
  },
  {
    // 依本机 Magpie 上下文窗口面板实测显示 1.05M
    match: 'deepseek-v4',
    window: 1048576,
    sourceNote: '依本机 Magpie 上下文窗口面板实测显示 1.05M',
  },
]

/**
 * 根据 modelId 解析上下文窗口容量与来源
 * @param modelId 模型标识符，支持大小写不敏感子串匹配
 */
export function resolveContextWindow(modelId?: string | null): ContextWindowResolution {
  if (!modelId || typeof modelId !== 'string') {
    return {
      window: FALLBACK_CONTEXT_WINDOW,
      source: 'default',
    }
  }

  const normalized = modelId.toLowerCase().trim()
  if (!normalized) {
    return {
      window: FALLBACK_CONTEXT_WINDOW,
      source: 'default',
    }
  }

  const matched = MODEL_WINDOW_RULES.find((rule) => normalized.includes(rule.match))
  if (matched) {
    return {
      window: matched.window,
      source: 'known',
      matchedRule: matched.match,
    }
  }

  return {
    window: FALLBACK_CONTEXT_WINDOW,
    source: 'default',
  }
}

/**
 * 依据实际已用 Token 动态计算生效的上下文窗口尺度（Magpie scale = max(window, tokens, 1) 不变量）
 * 当实际已用用量超过解析出的规则/兜底窗口时，将窗口尺度撑开至 usedTokens，保证百分比不超过 100%、剩余量不为 0。
 * 注意：撑开后的 window 仅为 UI 绘图尺度，并不是模型的真实物理窗口，因此严格保留 source 与 matchedRule 原值。
 *
 * @param resolved 模型规则解析出的原始上下文窗口信息
 * @param usedTokens 会话中实际消耗的总 Token 数量
 */
export function effectiveContextWindow(
  resolved: ContextWindowResolution,
  usedTokens: number
): ContextWindowResolution & { clamped: boolean } {
  if (usedTokens > resolved.window) {
    return {
      ...resolved,
      window: usedTokens,
      clamped: true,
    }
  }
  return {
    ...resolved,
    clamped: false,
  }
}

