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
