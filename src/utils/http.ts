/**
 * @file src/utils/http.ts
 * @description 全仓唯一网络请求底座。
 *
 * 契约：
 * 1. 一切请求经 `radash.tryit` 解构为 `[err, data]`，业务侧零原生 try/catch；
 * 2. 默认携带 JSON Content-Type 与超时信号，杜绝请求悬挂；
 * 3. Fail-Silent 场景（遥测上报）走 `httpPostSilent`，永不抛错、永不阻断业务。
 */

import { tryit } from 'radash'

/** 默认请求超时（毫秒） */
export const DEFAULT_HTTP_TIMEOUT_MS = 5000

/** 请求选项：在原生 RequestInit 上补充超时控制 */
export interface HttpOptions extends Omit<RequestInit, 'signal'> {
  /** 超时毫秒，传 0 表示不设超时 */
  timeoutMs?: number
  /** 外部取消信号，优先于内置超时 */
  signal?: AbortSignal
}

/**
 * 组装原生 RequestInit：注入 JSON Content-Type 与超时信号
 */
function toRequestInit(options: HttpOptions): RequestInit {
  const { timeoutMs, signal, headers, ...rest } = options
  const timeout = timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS

  return {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...headers },
    signal: signal ?? (timeout > 0 ? AbortSignal.timeout(timeout) : undefined),
  }
}

/**
 * 发起请求并返回原始响应
 *
 * @example
 * const [err, res] = await httpFetch('http://127.0.0.1:4560/health', { timeoutMs: 100 })
 * // => [undefined, Response]
 */
export async function httpFetch(
  url: string,
  options: HttpOptions = {}
): Promise<[Error | undefined, Response | null]> {
  const [err, res] = await tryit(async () => await fetch(url, toRequestInit(options)))()
  return [err ?? undefined, res ?? null]
}

/**
 * 发起请求并解析 JSON，非 2xx 直接作为错误返回
 *
 * @example
 * const [err, data] = await httpJson<{ ok: boolean }>(`${base}/health`)
 * // => [undefined, { ok: true }]
 */
export async function httpJson<T>(
  url: string,
  options: HttpOptions = {}
): Promise<[Error | undefined, T | null]> {
  const [err, data] = await tryit(async () => {
    const res = await fetch(url, toRequestInit(options))
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} @ ${url}`)
    return (await res.json()) as T
  })()

  return [err ?? undefined, data ?? null]
}

/**
 * 发起请求并解析纯文本
 */
export async function httpText(
  url: string,
  options: HttpOptions = {}
): Promise<[Error | undefined, string | null]> {
  const [err, text] = await tryit(async () => {
    const res = await fetch(url, toRequestInit(options))
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} @ ${url}`)
    return await res.text()
  })()

  return [err ?? undefined, text ?? null]
}

/**
 * 静默 POST JSON：遥测上报等 Fail-Silent 场景专用
 * 永不抛错，仅返回是否成功送达
 */
export async function httpPostSilent(
  url: string,
  body: unknown,
  options: HttpOptions = {}
): Promise<boolean> {
  const [, res] = await httpFetch(url, {
    ...options,
    method: 'POST',
    body: JSON.stringify(body),
  })

  return Boolean(res?.ok)
}
