/**
 * @file src/services/gateManager.test.ts
 * @description HITL 门禁状态机契约测试（挂起 / 裁决 / 超时 / 替换 / 订阅）
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import type { GatePromptPayload } from '../types/telemetry'
import { DEFAULT_GATE_TIMEOUT_MS, detachTimer, GateManager } from './gateManager'

/** 构造门禁载荷 */
function gatePayload(gateId: string): GatePromptPayload {
  return {
    gateId,
    title: '高危命令审批',
    riskLevel: 'critical',
    proposedAction: { command: 'git push', explanation: '同步远端' },
    timestamp: new Date().toISOString(),
  }
}

describe('GateManager 状态机契约', () => {
  it('注册门禁后进入待审清单，裁决后出列', async () => {
    const manager = new GateManager()
    const promise = manager.registerGate(gatePayload('g-1'))

    assert.equal(manager.hasPendingGates(), true)
    assert.equal(manager.getPendingGates().length, 1)

    assert.equal(manager.resolveGate('g-1', { action: 'approve' }), true)
    const decision = await promise

    assert.equal(decision.action, 'approve')
    assert.equal(manager.hasPendingGates(), false)
  })

  it('拒绝裁决原样透传人类反馈', async () => {
    const manager = new GateManager()
    const promise = manager.registerGate(gatePayload('g-2'))
    manager.resolveGate('g-2', { action: 'reject', feedback: '暂不推送' })

    const decision = await promise
    assert.equal(decision.action, 'reject')
    assert.equal(decision.feedback, '暂不推送')
  })

  it('裁决不存在的门禁返回 false，不抛异常', () => {
    const manager = new GateManager()
    assert.equal(manager.resolveGate('ghost', { action: 'approve' }), false)
  })

  it('同一 gateId 重复注册时旧门禁被安全回收', async () => {
    const manager = new GateManager()
    const first = manager.registerGate(gatePayload('g-dup'))
    const second = manager.registerGate(gatePayload('g-dup'))

    const firstDecision = await first
    assert.equal(firstDecision.action, 'reject', '被替换的旧门禁按拒绝回收')
    assert.equal(firstDecision.feedback, 'Superseded by new gate registration')

    manager.resolveGate('g-dup', { action: 'approve' })
    const secondDecision = await second
    assert.equal(secondDecision.action, 'approve')
  })

  it('兜底超时触发安全拦截，绝不无限挂起', async () => {
    // 纯逻辑测试无外部 handle 保活显式开 keepAlive，让短超时 timer 触发
    const manager = new GateManager(80, true)
    const decision = await manager.registerGate(gatePayload('g-timeout'))

    assert.equal(decision.action, 'reject')
    assert.match(decision.feedback || '', /超时/)
    assert.equal(manager.hasPendingGates(), false, '超时后不残留挂起门禁')
  })

  it('clear 批量回收所有挂起门禁', async () => {
    const manager = new GateManager()
    const first = manager.registerGate(gatePayload('g-a'))
    const second = manager.registerGate(gatePayload('g-b'))

    manager.clear('流重置')

    assert.equal((await first).feedback, '流重置')
    assert.equal((await second).feedback, '流重置')
    assert.equal(manager.hasPendingGates(), false)
  })

  it('订阅者在挂起与裁决时均被通知，退订后不再收到', async () => {
    const manager = new GateManager()
    let notifications = 0
    const unsubscribe = manager.subscribe(() => {
      notifications++
    })

    const promise = manager.registerGate(gatePayload('g-sub'))
    assert.equal(notifications, 1)

    manager.resolveGate('g-sub', { action: 'approve' })
    await promise
    assert.equal(notifications, 2)

    unsubscribe()
    manager.registerGate(gatePayload('g-sub-2'))
    assert.equal(notifications, 2, '退订后不再通知')
    manager.clear('cleanup')
  })

  it('默认超时为 5 分钟', () => {
    assert.equal(DEFAULT_GATE_TIMEOUT_MS, 300_000)
  })

  it('兜底定时器 unref 后不再保活事件循环，残留门禁不会挂死进程', () => {
    const timer = setTimeout(() => {}, 60_000)
    assert.equal(timer.hasRef(), true, 'unref 前定时器计入事件循环保活句柄')
    detachTimer(timer)
    assert.equal(timer.hasRef(), false, 'unref 后定时器不再阻止进程退出')
    clearTimeout(timer)
  })

  it('超时定时器在正常裁决后不再触发', async () => {
    const manager = new GateManager(50)
    const promise = manager.registerGate(gatePayload('g-fast'))
    manager.resolveGate('g-fast', { action: 'approve' })

    const decision = await promise
    assert.equal(decision.action, 'approve')

    await delay(80)
    assert.equal(manager.hasPendingGates(), false)
  })
})
