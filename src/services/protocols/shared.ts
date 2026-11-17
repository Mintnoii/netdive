/**
 * @file src/services/protocols/shared.ts
 * @description Pi / Claude 双协议共享的解析原语与运行期上下文。
 *
 * 契约：
 * 1. 手势字典、标题格式化、usage 提取、上下文槽位记账等跨协议能力只在此处定义；
 * 2. 协议适配器（pi.ts / claude.ts）只负责「字段差异 → 标准化记录」的映射，不重复实现原语；
 * 3. 脏字符串自愈统一走 `safeDecodeUri`，禁止在业务分支里嵌套 try/catch。
 */

import { basename } from 'pathe'
import type {
  ContextItem,
  ContextPartKind,
  TelemetryEvent,
  TelemetryGesture,
} from '../../types/telemetry'

import { tryit , isString } from 'radash'

/** 解析后的会话元数据契约 */
export interface SessionMetadata {
  id: string
  sessionId?: string
  version?: number | string
  timestamp?: string
  cwd?: string
  cwdBase?: string
  modelId?: string
  provider?: string
  agentName?: string
  gitBranch?: string
  totalTurns: number
  totalTools: number
  format: 'pi' | 'claude' | 'generic'
}

/**
 * 扁平字典映射表：工程函数式查表法消除 50 行 if/else 级联
 */
const TOOL_GESTURE_MAP: Readonly<Record<string, TelemetryGesture>> = {
  bash: 'bash',
  exec: 'bash',
  command: 'bash',
  terminal: 'bash',
  sh: 'bash',
  edit: 'edit',
  write: 'edit',
  notebookedit: 'edit',
  patch: 'edit',
  apply_diff: 'edit',
  read: 'read',
  grep: 'read',
  glob: 'read',
  find: 'read',
  source_check: 'read',
  fetch_content: 'read',
  web_search: 'read',
  websearch: 'read',
  webfetch: 'read',
  gate: 'gate',
  askuserquestion: 'gate',
  approval: 'gate',
  confirm: 'gate',
  scratchpad: 'memory',
  honcho: 'memory',
}

/**
 * 将工具名称规约为 NetDive 标准手势类型
 * O(1) 字典查表直给，彻底消灭过程式分支
 *
 * @example
 * ```ts
 * mapToolNameToGesture('bash')       // => 'bash'
 * mapToolNameToGesture('write')      // => 'edit'
 * mapToolNameToGesture('grep')       // => 'read'
 * mapToolNameToGesture('memory_add') // => 'memory'
 * mapToolNameToGesture('unknown')    // => 'think'
 * ```
 */
export function mapToolNameToGesture(toolName?: string): TelemetryGesture {
  if (!toolName) return 'think'
  const name = toolName.toLowerCase()
  if (name.startsWith('memory')) return 'memory'
  return TOOL_GESTURE_MAP[name] ?? 'think'
}

/**
 * 依据工具名与入参生成精炼的标题 (Shape By Example)
 *
 * @example
 * ```ts
 * formatToolTitle('bash', { command: 'pnpm test' })             // => '$ pnpm test'
 * formatToolTitle('read', { path: 'src/types/telemetry.ts' })   // => 'read: telemetry.ts'
 * formatToolTitle('grep', { pattern: 'tryit' })                 // => 'rg "tryit"'
 * ```
 */
export function formatToolTitle(toolName: string, args?: Record<string, unknown>): string {
  const name = toolName.trim()
  if (!args) return `工具调用: ${name}`

  // Bash command
  if (isString(args.command) && args.command) {
    const cmd = args.command.trim().split('\n')[0]
    const shortCmd = cmd.length > 38 ? `${cmd.slice(0, 35)}...` : cmd
    return `$ ${shortCmd}`
  }

  // File read/edit/write
  const targetPath = (args.path || args.file_path || args.filePath) as string | undefined
  if (isString(targetPath) && targetPath) {
    const base = basename(targetPath)
    return `${name}: ${base}`
  }

  // Pattern search
  if (isString(args.pattern) && args.pattern) {
    return `rg "${args.pattern}"`
  }

  return `工具调用: ${name}`
}

/**
 * 将 sections 键名按规则映射至 ContextPartKind (键名小写匹配)
 */
export function mapSectionKeyToPartKind(key: string): ContextPartKind {
  const k = key.toLowerCase()
  if (/^(systemprompt|preamble|rules|docs|addendum|guidelines|instructions|system|prompt)$/.test(k)) {
    return 'system'
  }
  if (/^(tools|tool)$/.test(k)) {
    return 'tools'
  }
  if (/^(skills|skill)$/.test(k)) {
    return 'skills'
  }
  if (/^(memory|agents|context|memoryfiles|claudemd)$/.test(k)) {
    return 'memory'
  }
  return 'system'
}

/**
 * 从事件 title 与工具入参中提取文件标识路径，取不到则降级为 title
 */
export function extractFileIdentifier(title: string, toolArgs?: Record<string, unknown>): string {
  if (toolArgs) {
    const p = toolArgs.path ?? toolArgs.file_path ?? toolArgs.filePath ?? toolArgs.file
    if (isString(p) && p.trim()) {
      return p.trim()
    }
  }
  const trimmed = title.trim()
  const spaceIdx = trimmed.indexOf(' ')
  if (spaceIdx > 0 && spaceIdx < trimmed.length - 1) {
    return trimmed.slice(spaceIdx + 1).trim()
  }
  return trimmed
}

/**
 * 从文本块提取可读字符串
 */
export function extractTextContent(content: unknown): string {
  if (isString(content)) return content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== 'object') return ''
        const b = block as Record<string, unknown>
        if (isString(b.text)) return b.text
        if (isString(b.content)) return b.content
        if (isString(b.thinking)) return b.thinking
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

/** 提取的原生使用量结构 */
export interface ExtractedUsage {
  input: number
  output: number
  cacheRead: number
  reasoning: number
  total: number
}

/**
 * 从 JSONL 记录或消息中提取真实 usage
 * 兼容 Pi 格式 (input, output, cacheRead, reasoning) 与 Claude Code 格式 (input_tokens, cache_read_input_tokens 等)
 */
export function extractUsageFromRecord(
  record: Record<string, unknown>,
  msg?: Record<string, unknown>
): ExtractedUsage | undefined {
  const usageObj =
    (msg?.usage as Record<string, unknown>) ||
    (record.usage as Record<string, unknown>) ||
    (msg?.token_usage as Record<string, unknown>) ||
    (record.token_usage as Record<string, unknown>)

  if (!usageObj || typeof usageObj !== 'object') {
    return undefined
  }

  const input =
    Number(
      usageObj.input ??
        usageObj.input_tokens ??
        usageObj.inputTokens ??
        usageObj.prompt_tokens ??
        usageObj.promptTokens ??
        0
    ) || 0

  const output =
    Number(
      usageObj.output ??
        usageObj.output_tokens ??
        usageObj.outputTokens ??
        usageObj.completion_tokens ??
        usageObj.completionTokens ??
        0
    ) || 0

  const cacheRead =
    Number(
      usageObj.cacheRead ??
        usageObj.cache_read ??
        usageObj.cacheReadTokens ??
        usageObj.cache_read_input_tokens ??
        usageObj.cacheReadInputTokens ??
        0
    ) || 0

  const reasoning =
    Number(
      usageObj.reasoning ??
        usageObj.reasoning_tokens ??
        usageObj.reasoningTokens ??
        usageObj.thinking_tokens ??
        usageObj.thinkingTokens ??
        0
    ) || 0

  const total =
    Number(
      usageObj.total ??
        usageObj.total_tokens ??
        usageObj.totalTokens ??
        (input + output)
    ) || (input + output)

  return { input, output, cacheRead, reasoning, total }
}

/** 解析器运行期内部状态上下文 */
export interface ParserContext {
  session: SessionMetadata
  events: TelemetryEvent[]
  toolCallEventMap: Map<string, TelemetryEvent>
  idAliasMap: Map<string, string>
  lastEventId?: string
  turnCounter: number
  isPiSession: boolean
  isClaudeSession: boolean
  lastUsage?: ExtractedUsage
  systemTokens: number
  totalToolTokens: number
  systemText: string
  sectionsMap: Map<string, string>
  fileItems: Map<string, ContextItem>
  resultItems: Map<string, ContextItem>
  turnItems: ContextItem[]
  toolCallInfoMap: Map<
    string,
    {
      gesture: TelemetryGesture
      toolName: string
      fileIdentifier?: string
      currentTokens: number
    }
  >
}

/**
 * 提取系统提示词及 sections 的真实 Token 尺寸与分块
 */
export function handleSystemMessage(record: Record<string, unknown>, ctx: ParserContext): boolean {
  // 扫描 sections 字段 (Pi 第一条消息或全局 sections)
  const sections = (record.sections || (record.message as Record<string, unknown> | undefined)?.sections) as unknown
  if (sections && typeof sections === 'object') {
    let sectionChars = 0
    if (Array.isArray(sections)) {
      for (let i = 0; i < sections.length; i++) {
        const s = sections[i]
        let key = `section-${i}`
        let valStr = ''
        if (isString(s)) {
          valStr = s
        } else if (s && typeof s === 'object') {
          const obj = s as Record<string, unknown>
          if (isString(obj.name)) key = obj.name
          else if (isString(obj.key)) key = obj.key
          const content = obj.content ?? obj.text
          if (isString(content)) valStr = content
          else valStr = JSON.stringify(s)
        }
        if (valStr) {
          sectionChars += valStr.length
          const existing = ctx.sectionsMap.get(key)
          ctx.sectionsMap.set(key, existing ? `${existing}\n${valStr}` : valStr)
        }
      }
    } else {
      for (const [key, val] of Object.entries(sections as Record<string, unknown>)) {
        let valStr = ''
        if (isString(val)) {
          valStr = val
        } else if (val && typeof val === 'object') {
          valStr = JSON.stringify(val)
        }
        if (valStr) {
          sectionChars += valStr.length
          const existing = ctx.sectionsMap.get(key)
          ctx.sectionsMap.set(key, existing ? `${existing}\n${valStr}` : valStr)
        }
      }
    }
    if (sectionChars > 0) {
      ctx.systemTokens = Math.max(ctx.systemTokens, Math.ceil(sectionChars / 4))
    }
  }

  const isSystemType = record.type === 'system'
  const msg = record.message as Record<string, unknown> | undefined
  const isSystemRole = msg?.role === 'system' || record.role === 'system'

  if (isSystemType || isSystemRole) {
    const content = msg?.content ?? record.content ?? record.text ?? record.system
    const text = extractTextContent(content)
    if (text) {
      ctx.systemTokens = Math.max(ctx.systemTokens, Math.ceil(text.length / 4))
      ctx.systemText = ctx.systemText ? `${ctx.systemText}\n${text}` : text
    }
  }

  if (isSystemType || isSystemRole) {
    return true
  }

  return false
}

/**
 * 记录工具调用到 files 或 results part 集合
 */
export function recordToolCallToPrompt(
  ctx: ParserContext,
  toolCallId: string,
  toolName: string,
  gesture: TelemetryGesture,
  title: string,
  toolArgs: Record<string, unknown>
): void {
  const isFile = gesture === 'read' || gesture === 'edit'
  const payloadText = JSON.stringify(toolArgs)
  const initialTokens = Math.max(1, Math.ceil(payloadText.length / 4))
  const fileIdentifier = isFile ? extractFileIdentifier(title, toolArgs) : undefined

  if (isFile && fileIdentifier) {
    const existing = ctx.fileItems.get(fileIdentifier)
    if (existing) {
      existing.n = (existing.n ?? 1) + 1
      existing.tokens += initialTokens
      existing.tag = gesture === 'read' ? 'read' : 'edit'
      existing.content = payloadText
    } else {
      ctx.fileItems.set(fileIdentifier, {
        tag: gesture === 'read' ? 'read' : 'edit',
        name: fileIdentifier,
        tokens: initialTokens,
        n: 1,
        content: payloadText,
      })
    }
  } else {
    const existing = ctx.resultItems.get(toolName)
    if (existing) {
      existing.n = (existing.n ?? 1) + 1
      existing.tokens += initialTokens
      existing.tag = 'result'
      existing.content = payloadText
    } else {
      ctx.resultItems.set(toolName, {
        tag: 'result',
        name: toolName,
        tokens: initialTokens,
        n: 1,
        content: payloadText,
      })
    }
  }

  ctx.toolCallInfoMap.set(toolCallId, {
    gesture,
    toolName,
    fileIdentifier,
    currentTokens: initialTokens,
  })
}

/**
 * 依据工具执行结果更新 files 或 results 中对应的 token 与最新观测内容
 */
export function updateToolResultInPrompt(
  ctx: ParserContext,
  toolCallId: string,
  outputLines: string[]
): void {
  const toolInfo = ctx.toolCallInfoMap.get(toolCallId)
  if (!toolInfo) return

  const outputText = outputLines.join('\n')
  if (!outputText) return

  const newTokens = Math.max(1, Math.ceil(outputText.length / 4))
  const diff = newTokens - toolInfo.currentTokens
  toolInfo.currentTokens = newTokens

  if (toolInfo.fileIdentifier && ctx.fileItems.has(toolInfo.fileIdentifier)) {
    const item = ctx.fileItems.get(toolInfo.fileIdentifier)!
    item.tokens += diff
    item.content = outputText
  } else if (ctx.resultItems.has(toolInfo.toolName)) {
    const item = ctx.resultItems.get(toolInfo.toolName)!
    item.tokens += diff
    item.content = outputText
  }
}

/**
 * 安全解码 URI 编码文本（含中文路径等），解码失败段落原样保留
 *
 * @example
 * safeDecodeUri('Ghost/%E4%B8%AD%E6%96%87.md') // => 'Ghost/中文.md'
 */
export function safeDecodeUri(text: string): string {
  if (!/%[0-9a-fA-F]{2}/.test(text)) return text

  const [wholeErr, decoded] = tryit(() => decodeURIComponent(text))()
  if (!wholeErr && decoded) return decoded

  // 分段自愈：仅替换可解码片段，保留非法段落原文
  return text.replace(/(%[0-9a-fA-F]{2})+/g, (segment) => {
    const [segmentErr, piece] = tryit(() => decodeURIComponent(segment))()
    return segmentErr || !piece ? segment : piece
  })
}
