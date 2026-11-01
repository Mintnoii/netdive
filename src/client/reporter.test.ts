/**
 * @file src/client/reporter.test.ts
 * @description Fail-Silent Reporter 函数式契约单元测试
 */

import { describe, it } from 'node:test'
import assert from 'node:assert'
import { createReporter } from './reporter.js'

describe('NetDiveReporter 函数式纯净契约测试', () => {
  it('工厂函数正确派发无状态闭包与配置项', () => {
    const reporter = createReporter({
      endpoint: 'http://127.0.0.1:4560/',
      probeTimeoutMs: 50,
      sessionId: 'test-session-1',
    })
    assert.strictEqual(reporter.sessionId, 'test-session-1')
    assert.strictEqual(typeof reporter.probe, 'function')
    assert.strictEqual(typeof reporter.step, 'function')
    assert.strictEqual(typeof reporter.gate, 'function')
  })

  it('离线环境下自动 Fail-Silent 静默跳过并透传业务返回值', async () => {
    // 指向一个绝对不存在的无效端口
    const offlineReporter = createReporter({
      endpoint: 'http://127.0.0.1:59999',
      probeTimeoutMs: 30,
    })

    const isOnline = await offlineReporter.probe()
    assert.strictEqual(isOnline, false, '探活应该确认离线')

    // 验证 step() 依然能够毫无阻碍地执行原业务函数并返回值
    const businessResult = await offlineReporter.step('test_step', () => {
      return { answer: 42, text: 'hello' }
    })

    assert.deepStrictEqual(businessResult, { answer: 42, text: 'hello' })
  })

  it('发生业务错误时 Fail-Fast 原样抛出，绝不吞掉真实异常', async () => {
    const offlineReporter = createReporter({
      endpoint: 'http://127.0.0.1:59999',
      probeTimeoutMs: 30,
    })

    await assert.rejects(
      async () => {
        await offlineReporter.step('failing_step', () => {
          throw new Error('Business operation failed')
        })
      },
      {
        name: 'Error',
        message: 'Business operation failed',
      }
    )
  })

  it('离线时 gate() 自动安全放行，绝不阻断或挂起后台脚本', async () => {
    const offlineReporter = createReporter({
      endpoint: 'http://127.0.0.1:59999',
      probeTimeoutMs: 30,
    })

    const result = await offlineReporter.gate({
      action: 'destructive_write',
      summary: '尝试写入重要数据',
    })

    assert.strictEqual(result.decision, 'approved')
    assert.match(result.reason || '', /离线/)
  })
})
