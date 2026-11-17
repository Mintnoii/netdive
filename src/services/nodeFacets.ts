/**
 * @file src/services/nodeFacets.ts
 * @description 节点视图模型标量抽取（Lean View-Model）。
 *
 * 契약：
 * 1. 画布节点只允许携带「小标量」：命令、文件路径、搜索模式、退出码、输出首行与行数统计；
 * 2. 完整 `observation` / `payload` 一律不进 `node.data`，由外部 `eventsMap` JIT 取用（AGENTS.md §3.3）；
 * 3. 实时流与回放两条轨道共用本函数，保证节点模型同源。
 */

import { isString } from 'radash'
import type { TelemetryEvent } from '../types/telemetry'
import { normalizeObservationOutput } from '../types/telemetry'

/** 画布节点可携带的标量视图字段 */
export interface NodeFacets {
  /** 执行命令（payload.command 优先，回落到 observation.command） */
  command?: string
  /** 目标文件路径（兼容 path / file_path / filePath / file 多写法） */
  filePath?: string
  /** 搜索或匹配模式 */
  pattern?: string
  /** 进程退出码 */
  exitCode?: number
  /** 输出首行（用于失败徽标与预览，严格截断） */
  outputHead?: string
  /** 输出总行数 */
  outputLineCount?: number
  /** 输出总字符数 */
  outputChars?: number
  /** 是否携带 diff（决定手势升级为 edit） */
  hasDiff?: boolean
}

/** 首行预览最大长度 */
const OUTPUT_HEAD_MAX = 120

/**
 * 从遥测事件抽取节点标量视图字段
 *
 * @example
 * deriveNodeFacets({
 *   nodeId: 'n-1',
 *   type: 'node_complete',
 *   payload: { command: 'pnpm test' },
 *   observation: { exitCode: 1, output: ['✖ 3 failed', '...'] },
 * } as TelemetryEvent)
 * // => { command: 'pnpm test', exitCode: 1, outputHead: '✖ 3 failed', outputLineCount: 2, outputChars: 22 }
 */
export function deriveNodeFacets(event: TelemetryEvent): NodeFacets {
  const payload = event.payload ?? {}
  const observation = event.observation

  const command =
    (isString(payload.command) && payload.command.trim()) ||
    (isString(observation?.command) && observation?.command.trim()) ||
    undefined

  const rawPath = payload.path ?? payload.file_path ?? payload.filePath ?? payload.file
  const filePath = isString(rawPath) && rawPath.trim() ? rawPath.trim() : undefined

  const pattern = isString(payload.pattern) && payload.pattern.trim() ? payload.pattern.trim() : undefined

  const outputLines = normalizeObservationOutput(observation?.output)
  const outputHead = outputLines[0]
    ? outputLines[0].slice(0, OUTPUT_HEAD_MAX)
    : undefined

  const exitCode = typeof observation?.exitCode === 'number' ? observation.exitCode : undefined

  return {
    command,
    filePath,
    pattern,
    exitCode,
    outputHead,
    outputLineCount: outputLines.length > 0 ? outputLines.length : undefined,
    outputChars: outputLines.length > 0 ? outputLines.join('\n').length : undefined,
    hasDiff: Boolean(payload.diff),
  }
}

/**
 * 依据标量字段估算工具输出 Token 负载（4 字符 ≈ 1 token）
 *
 * @example
 * estimateFacetTokens({ outputChars: 4000, hasDiff: false }) // => 1000
 */
export function estimateFacetTokens(facets: NodeFacets): number | undefined {
  if (facets.outputChars === undefined && !facets.hasDiff) return undefined
  return Math.ceil((facets.outputChars ?? 0) / 4)
}
