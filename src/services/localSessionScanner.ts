/**
 * @file src/services/localSessionScanner.ts
 * @description 本地 Pi / Claude 存量会话扫描纯函数服务。
 *
 * 契约：
 * 1. 路径运算 100% 依托 `pathe`，集合归约 100% 依托 `radash`，单层集合变换替代多层嵌套 for；
 * 2. 脏 JSONL 行经 `radash.tryit` 逐行自愈，绝不吞异常也不中断整轮扫描；
 * 3. 纯函数导出（可注入 root）便于测试，IO 只发生在 `scanLocalSessions` / `readLocalTranscript`。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'pathe'
import { isString, sift, tryit } from 'radash'

/** 会话扫描结果条目契约 */
export interface LocalSessionEntry {
  id: string
  fileName: string
  title: string
  lineCount: number
  folder: string
  fullPath: string
  mtime: number
  size: number
  project: string
  hasFailures?: boolean
  caseTag?: string
}

/** 单行 JSON 解析（包一层箭头函数，规避 JSON.parse reviver 重载歧义） */
function parseJsonLine(line: string): [Error | undefined, unknown] {
  const result = tryit(() => JSON.parse(line) as unknown)()
  return [result[0] ?? undefined, result[1] ?? null]
}

/** 标题嗅探窗口行数 */
const TITLE_SCAN_LINES = 30

/** 标题最大展示长度（超出截断并补省略号） */
const TITLE_MAX_LENGTH = 38

/** 文件名中的 UUID 会话标识 */
const SESSION_ID_PATTERN = /([0-9a-fA-F-]{36})\.jsonl$/

/** 从目录名解析工程名：优先匹配工作区命名规约，否则退化为去横线原名 */
const PROJECT_PATTERNS = [/Desktop-([A-Za-z0-9_-]+)--/, /workspaces-([A-Za-z0-9_-]+)--/]

/**
 * 本地会话根目录
 *
 * @example
 * localSessionsRoot() // => 'C:/Users/xxx/.pi/agent/sessions'
 */
export function localSessionsRoot(): string {
  return resolve(homedir(), '.pi/agent/sessions')
}

/**
 * 非空行计数（JSONL 有效事件行数）
 *
 * @example
 * countTranscriptLines('a\n\nb\n') // => 2
 */
export function countTranscriptLines(raw: string): number {
  return raw.split(/\r?\n/).filter((line) => line.trim().length > 0).length
}

/**
 * 由目录名解析工程名
 *
 * @example
 * resolveProjectName('--C--Users-wangqing-Desktop-netdive--') // => 'netdive'
 */
export function resolveProjectName(folder: string): string {
  const matched = PROJECT_PATTERNS.map((pattern) => folder.match(pattern)).find(Boolean)
  return matched?.[1] ?? folder.replace(/^-+|-+$/g, '')
}

/**
 * 由文件名解析会话 ID：优先 UUID，否则退化为去扩展名原名
 */
export function resolveSessionId(fileName: string): string {
  return fileName.match(SESSION_ID_PATTERN)?.[1] ?? fileName.replace(/\.jsonl$/, '')
}

/**
 * 从单条 JSONL 记录中提取标题候选
 * 优先级：session.title > 首条 user 消息首行（跳过 JSON 片段与过短噪声）
 */
function extractTitleCandidate(record: unknown, role: 'session' | 'user'): string | undefined {
  const item = record as {
    type?: string
    title?: unknown
    message?: { role?: string; content?: unknown }
  }
  if (!item) return undefined

  if (role === 'session' && item.type === 'session' && isString(item.title) && item.title.trim()) {
    return item.title.trim()
  }

  if (role === 'user' && item.type === 'message' && item.message?.role === 'user') {
    const content = item.message.content
    const text = isString(content)
      ? content
      : Array.isArray(content)
        ? content.map((block) => (block as { text?: string }).text ?? '').join('')
        : ''

    const firstLine = text.trim().split(/\r?\n/)[0]?.trim() ?? ''
    const isUsable = firstLine.length > 1 && !firstLine.startsWith('{')
    return isUsable ? firstLine : undefined
  }

  return undefined
}

/**
 * 从 JSONL 原文提取会话标题
 * 严格按文件顺序取首个命中候选，全无命中则回落文件名
 */
export function extractSessionTitle(raw: string, fallbackTitle: string): string {
  const records = raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, TITLE_SCAN_LINES)
    .map((line) => parseJsonLine(line)[1])

  // 两趟优先：session 正式标题 > 首条 user 意图首行
  const sessionTitle = sift(records.map((record) => extractTitleCandidate(record, 'session')))[0]
  const candidate =
    sessionTitle ?? sift(records.map((record) => extractTitleCandidate(record, 'user')))[0]

  if (!candidate) return fallbackTitle

  return candidate.length > TITLE_MAX_LENGTH ? `${candidate.slice(0, TITLE_MAX_LENGTH - 2)}...` : candidate
}

/**
 * 扫描本地存量会话目录，按 mtime 倒序截断
 * 目录不存在时返回空集合（未安装 Pi 属正常态，不视为异常）
 */
export function scanLocalSessions(limit = 30, root: string = localSessionsRoot()): LocalSessionEntry[] {
  const [scanErr, folders] = tryit(() =>
    readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  )()

  if (scanErr || !folders) return []

  // 第一阶段：轻量 stat 快速索引候选文件元数据，严禁全量载入 400MB+ 物理内容
  const candidates = folders.flatMap((folder) => {
    const folderPath = join(root, folder)
    const project = resolveProjectName(folder)

    const [readErr, fileNames] = tryit(() =>
      readdirSync(folderPath).filter((fileName) => fileName.endsWith('.jsonl'))
    )()

    if (readErr || !fileNames) return []

    return fileNames.flatMap((fileName) => {
      const fullPath = join(folderPath, fileName)
      const [statErr, stats] = tryit(() => statSync(fullPath))()
      if (statErr || !stats) return []

      return [
        {
          fileName,
          folder,
          fullPath,
          project,
          mtime: stats.mtimeMs,
          size: stats.size,
        },
      ]
    })
  })

  // 按最新修改时间倒序预截断，仅对 top limit 个候选文件做深度内容提取
  const topCandidates = candidates.sort((a, b) => b.mtime - a.mtime).slice(0, limit)

  // 第二阶段：仅对预截断后的文件读取物理内容与提取特征指纹
  return topCandidates.flatMap((item) => {
    const [readFileErr, raw] = tryit(() => readFileSync(item.fullPath, 'utf-8'))()
    if (readFileErr || !raw) return []

    const hasFailures =
      raw.includes('"status":"failed"') ||
      raw.includes('"status":"rejected"') ||
      raw.includes('"passed":false') ||
      /"exitCode":[1-9]/.test(raw) ||
      /"isError":\s*true/.test(raw) ||
      raw.includes('Command failed with exit code')

    const caseTagMatch = raw.match(/<!--\s*\[netdive-case:\s*([^\]]+)\]\s*-->/)
    const caseTag = caseTagMatch ? caseTagMatch[1].trim() : undefined

    return [
      {
        id: resolveSessionId(item.fileName),
        fileName: item.fileName,
        title: extractSessionTitle(raw, item.fileName.replace(/\.jsonl$/, '')),
        lineCount: countTranscriptLines(raw),
        folder: item.folder,
        fullPath: item.fullPath,
        mtime: item.mtime,
        size: item.size,
        project: item.project,
        hasFailures,
        caseTag,
      } satisfies LocalSessionEntry,
    ]
  })
}

/**
 * 按会话 ID 读取整份 JSONL 原文
 * 命中返回全文，未命中返回 null（由路由层映射为 404 信封）
 */
export function readLocalTranscript(sessionId: string, root: string = localSessionsRoot()): string | null {
  const [scanErr, folders] = tryit(() =>
    readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  )()

  if (scanErr || !folders) return null

  const targetPath = folders
    .map((folder) => {
      const folderPath = join(root, folder)
      const [readErr, fileNames] = tryit(() => readdirSync(folderPath))()
      if (readErr || !fileNames) return null
      const matched = fileNames.find((name) => name.includes(sessionId) && name.endsWith('.jsonl'))
      return matched ? join(folderPath, matched) : null
    })
    .find(Boolean)

  if (!targetPath) return null

  const [readErr, raw] = tryit(() => readFileSync(targetPath, 'utf-8'))()
  return readErr || !raw ? null : raw
}
