import type { GateDecision, GatePromptPayload } from '../types/telemetry'

/**
 * ECMAScript 标准 Promise.withResolvers() 结果契约
 */
interface PromiseWithResolversResult<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

/**
 * Modern ECMAScript standard Promise.withResolvers() 优先调用，优雅降级为 new Promise
 */
function withResolvers<T>(): PromiseWithResolversResult<T> {
  const promiseConstructor = Promise as unknown as {
    withResolvers?: <V>() => PromiseWithResolversResult<V>
  }

  if (typeof promiseConstructor.withResolvers === 'function') {
    return promiseConstructor.withResolvers<T>()
  }

  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

interface PendingGateEntry {
  payload: GatePromptPayload
  resolvers: PromiseWithResolversResult<GateDecision>
  /** 兜底超时定时器句柄，裁决或清理时务必清除 */
  timer?: ReturnType<typeof setTimeout>
}

/** 默认兜底超时（毫秒）：无人值守时绝不无限挂起调用方 */
export const DEFAULT_GATE_TIMEOUT_MS = 5 * 60 * 1000

/**
 * 让兜底超时定时器脱离事件循环保活。
 * Node 下 unref 使无人裁决的残留 timer 不再阻塞进程退出（测试 runner 才不会被挂死）；
 * 浏览器端 setTimeout 返回 number 无此方法，可选链安全跳过。
 *
 * @example
 * detachTimer(setTimeout(fn, 5 * 60 * 1000)) // Node: timer 不再保活；浏览器: 无操作
 */
export function detachTimer(timer: ReturnType<typeof setTimeout> | undefined): void {
  const nodeTimer = timer as { unref?: () => void } | undefined
  nodeTimer?.unref?.()
}

/**
 * NetDive 决策门禁管理器 (Human-in-the-Loop Gate Manager)
 * 纯 Promise 挂起协程机制，无额外状态机胶水，实现主干拓扑的流式挂起与热纠偏放行
 */
export class GateManager {
  private pending = new Map<string, PendingGateEntry>()
  private listeners = new Set<() => void>()

  private readonly timeoutMs: number
  /** 兜底 timer 是否保活进程。生产默认 false 防残留挂死；纯逻辑超时测试显式开 true 保证 timer 触发 */
  private readonly keepAlive: boolean

  constructor(timeoutMs: number = DEFAULT_GATE_TIMEOUT_MS, keepAlive = false) {
    this.timeoutMs = timeoutMs
    this.keepAlive = keepAlive
  }

  /**
   * 注册并挂起一个决策门禁，返回一个等待人类操作员裁决的 Promise
   */
  registerGate(payload: GatePromptPayload): Promise<GateDecision> {
    // 若已存在相同 gateId 则先安全回收旧门禁
    if (this.pending.has(payload.gateId)) {
      this.rejectGate(payload.gateId, 'Superseded by new gate registration')
    }

    const resolvers = withResolvers<GateDecision>()
    const timer =
      this.timeoutMs > 0
        ? setTimeout(() => {
            this.resolveGate(payload.gateId, {
              action: 'reject',
              feedback: `门禁超时未裁决 (${Math.round(this.timeoutMs / 1000)}s)，按安全策略拦截`,
            })
          }, this.timeoutMs)
        : undefined

    this.pending.set(payload.gateId, { payload, resolvers, timer })
    if (timer && !this.keepAlive) detachTimer(timer)
    this.notify()

    resolvers.promise.finally(() => {
      const entry = this.pending.get(payload.gateId)
      if (entry?.timer) clearTimeout(entry.timer)
    })

    return resolvers.promise
  }

  /**
   * 裁决放行或修改放行指定决策门禁
   */
  resolveGate(gateId: string, decision: GateDecision): boolean {
    const entry = this.pending.get(gateId)
    if (!entry) return false

    if (entry.timer) clearTimeout(entry.timer)
    this.pending.delete(gateId)
    entry.resolvers.resolve(decision)
    this.notify()
    return true
  }

  /**
   * 拦截或拒绝指定决策门禁
   */
  rejectGate(gateId: string, reason?: string): boolean {
    return this.resolveGate(gateId, {
      action: 'reject',
      feedback: reason,
    })
  }

  /**
   * 获取所有等待人类裁决的门禁请求列表
   */
  getPendingGates(): GatePromptPayload[] {
    return Array.from(this.pending.values()).map((entry) => entry.payload)
  }

  /**
   * 获取指定的待决门禁
   */
  getGate(gateId: string): GatePromptPayload | undefined {
    return this.pending.get(gateId)?.payload
  }

  /**
   * 是否存在正在挂起等待的决策门禁
   */
  hasPendingGates(): boolean {
    return this.pending.size > 0
  }

  /**
   * 订阅门禁队列变更
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * 清空所有挂起门禁并标记拦截
   */
  clear(reason = 'Stream reset'): void {
    const gateIds = Array.from(this.pending.keys())
    for (const gateId of gateIds) {
      this.rejectGate(gateId, reason)
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}

/** 全局单例门禁管理器 */
export const gateManager = new GateManager()
