/**
 * @file src/client/reporter.ts
 * @description 极轻量级、工程函数式风格的 Fail-Silent 遥测探针中间件。
 *
 * 核心审美契约：
 * 1. 函数式一等公民：纯函数优先，消除 Class 面向对象样板与内部多重可变状态；
 * 2. 库优先：异步错误处理 100% 依托 `radash.tryit`，彻底消灭命令式 `try/catch` 胶水；
 * 3. 契约信任与静默熔断：探活失败自动静默无感透传，原生业务异常 Fail-Fast 抛出；
 * 4. 结构化 IPO 注释：关键转换函数明确标注输入与输出示例。
 *
 * @example
 * ```ts
 * const reporter = createReporter({ endpoint: 'http://127.0.0.1:4560' })
 * const content = await reporter.step('fetch_article', () => fetchArticle(url), {
 *   title: 'Tier-1 网页抓取',
 *   gesture: 'fetch',
 * })
 * ```
 */

import { tryit } from 'radash'

export interface ReporterConfig {
  /** NetDive Bridge 服务端根地址，默认 http://127.0.0.1:4560 */
  readonly endpoint?: string
  /** 探针连接超时（毫秒），默认 100ms */
  readonly probeTimeoutMs?: number
  /** 是否强制禁用（例如测试或 CI 纯静默环境） */
  readonly disabled?: boolean
  /** 当前流水线会话 ID，不传则自动生成 */
  readonly sessionId?: string
}

export interface StepOptions {
  /** 节点展示标题 */
  readonly title?: string
  /** 动作手势分类 */
  readonly gesture?: 'fetch' | 'clean' | 'classify' | 'disk' | 'gate' | 'tool'
  /** 附加元数据 (如耗时、协议、Token 数、提取标签等) */
  readonly metadata?: Record<string, unknown>
}

export interface GatePromptOptions {
  /** 门禁拦截操作名称 */
  readonly action: string
  /** 门禁原因摘要 */
  readonly summary: string
  /** 变更内容 Diff 或文件路径清单 */
  readonly diffPayload?: unknown
}

export interface GateDecisionResult {
  /** 决策结果：approved (批准放行) | rejected (拒绝中止) | timeout (超时) */
  readonly decision: 'approved' | 'rejected' | 'timeout'
  /** 操作员批注或原因 */
  readonly reason?: string
}

/** 探针运行时不可变状态句柄 */
export interface NetDiveReporter {
  readonly sessionId: string
  readonly probe: () => Promise<boolean>
  readonly step: <T>(
    stepName: string,
    executeFn: () => Promise<T> | T,
    options?: StepOptions
  ) => Promise<T>
  readonly gate: (options: GatePromptOptions) => Promise<GateDecisionResult>
}

/**
 * 安全探活：验证 NetDive Bridge 服务端健康状态
 * 纯函数风格，依托 AbortSignal 与 radash.tryit，彻底消除原生 try/catch
 */
async function probeBridgeHealth(endpoint: string, timeoutMs: number): Promise<boolean> {
  const [err, res] = await tryit(async () => {
    return await fetch(`${endpoint}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    })
  })()

  return !err && Boolean(res?.ok)
}

/**
 * 单向异步发射遥测事件 (Fail-Silent 静默吞吐，绝不阻断业务)
 */
async function postTelemetrySilently(
  endpoint: string,
  path: string,
  payload: Record<string, unknown>
): Promise<Response | null> {
  const [err, res] = await tryit(async () => {
    return await fetch(`${endpoint}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  })()

  return err ? null : res
}

/**
 * 工厂函数：创建原子、函数式、无 Class 样板的 NetDive Reporter 实例
 */
export function createReporter(config: ReporterConfig = {}): NetDiveReporter {
  const endpoint = (config.endpoint || 'http://127.0.0.1:4560').replace(/\/+$/, '')
  const probeTimeoutMs = config.probeTimeoutMs ?? 100
  const sessionId = config.sessionId ?? `session-${Date.now().toString(36)}`

  // 状态闭包（仅保存因果链 parentNodeId 与单调自增序号）
  let isOnlineCache: boolean | null = config.disabled ? false : null
  let parentNodeId: string | null = null
  let stepSequence = 0

  const probe = async (): Promise<boolean> => {
    if (isOnlineCache !== null) {
      return isOnlineCache
    }
    isOnlineCache = await probeBridgeHealth(endpoint, probeTimeoutMs)
    return isOnlineCache
  }

  const step = async <T>(
    stepName: string,
    executeFn: () => Promise<T> | T,
    options: StepOptions = {}
  ): Promise<T> => {
    const isReady = await probe()
    if (!isReady) {
      // 离线守门员：直接执行原函数返回，零开销、零干扰
      return await executeFn()
    }

    const currentSequence = ++stepSequence
    const nodeId = `${sessionId}-node-${currentSequence}`
    const parentId = parentNodeId
    const startTime = Date.now()

    // 发射步进开始事件
    await postTelemetrySilently(endpoint, '/api/telemetry', {
      type: 'node_start',
      nodeId,
      parentId,
      stepSequence: currentSequence,
      name: stepName,
      title: options.title || stepName,
      gesture: options.gesture || 'tool',
      timestamp: startTime,
      metadata: options.metadata,
    })

    // 执行核心业务 (依托 radash.tryit 优雅捕获执行结果与异常，消灭原生 try/catch)
    const [execError, result] = await tryit(async () => await executeFn())()
    const durationMs = Date.now() - startTime

    if (execError) {
      // 失败留痕，随后当场重新抛出业务原生异常 (Fail-Fast，绝不掩耳盗铃)
      await postTelemetrySilently(endpoint, '/api/telemetry', {
        type: 'node_complete',
        nodeId,
        parentId,
        stepSequence: currentSequence,
        name: stepName,
        title: options.title || stepName,
        gesture: options.gesture || 'tool',
        status: 'failed',
        durationMs,
        errorMessage: execError.message,
        timestamp: Date.now(),
      })
      throw execError
    }

    // 串联单向因果链指针
    parentNodeId = nodeId

    // 成功留痕
    await postTelemetrySilently(endpoint, '/api/telemetry', {
      type: 'node_complete',
      nodeId,
      parentId,
      stepSequence: currentSequence,
      name: stepName,
      title: options.title || stepName,
      gesture: options.gesture || 'tool',
      status: 'success',
      durationMs,
      timestamp: Date.now(),
      metadata: {
        ...options.metadata,
        durationMs,
      },
    })

    return result as T
  }

  const gate = async (options: GatePromptOptions): Promise<GateDecisionResult> => {
    const isReady = await probe()
    if (!isReady) {
      return { decision: 'approved', reason: 'NetDive 离线，自动静默放行' }
    }

    const gateId = `gate-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const currentSequence = ++stepSequence
    const nodeId = `${sessionId}-gate-${currentSequence}`

    const [reqErr, res] = await tryit(async () => {
      return await fetch(`${endpoint}/api/gate/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gateId,
          nodeId,
          parentId: parentNodeId,
          action: options.action,
          summary: options.summary,
          diffPayload: options.diffPayload,
          timestamp: Date.now(),
        }),
      })
    })()

    if (reqErr || !res?.ok) {
      return { decision: 'approved', reason: 'Bridge 通信降级，自动安全放行' }
    }

    const [parseErr, body] = await tryit(async () => (await res.json()) as { decision?: 'approved' | 'rejected'; reason?: string })()
    if (parseErr || !body) {
      return { decision: 'approved', reason: '解析裁决响应降级放行' }
    }

    parentNodeId = nodeId
    return {
      decision: body.decision || 'approved',
      reason: body.reason,
    }
  }

  return {
    sessionId,
    probe,
    step,
    gate,
  }
}

/** 默认导出一个开箱即用的函数式单例 */
export const defaultReporter = createReporter()
