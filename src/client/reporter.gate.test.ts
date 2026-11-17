/**
 * @file src/client/reporter.gate.test.ts
 * @description Reporter 与 Bridge 的在线门禁契约回归测试
 *
 * 覆盖三个致命回归点：
 * 1. 人类拒绝必须被 Reporter 正确解读为 rejected（历史缺陷：恒为 approved）；
 * 2. 审批载荷必须携带真实命令文本（历史缺陷：字段名错配导致命令为空）；
 * 3. demoOnly 演示流必须隔离到 demo- 会话且旁路 L1 断言，绝不污染真实活跃会话。
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { startBridgeServer, type RunningBridgeServer } from '../server/bridge'
import { computeFailureSignature } from '../services/assertionEngine'
import { createReporter } from './reporter'

const TEST_PORT = 4588
const TEST_HOST = '127.0.0.1'
const BASE_URL = `http://${TEST_HOST}:${TEST_PORT}`

/**
 * 等待门禁挂起后执行人类裁决
 * 演示脚本与自动化测试共用同一入口，避免依赖固定 sleep 时长
 */
async function resolvePendingGate(
  bridgeServer: RunningBridgeServer,
  decision: { action: 'approve' | 'reject' | 'modify'; feedback?: string; modifiedCommand?: string }
): Promise<void> {
  const [pending] = await waitForPendingGate(bridgeServer)
  bridgeServer.gateManager.resolveGate(pending.gateId, decision)
}

async function waitForPendingGate(bridgeServer: RunningBridgeServer) {
  for (let i = 0; i < 50; i++) {
    const pending = bridgeServer.gateManager.getPendingGates()
    if (pending.length > 0) return pending
    await delay(20)
  }
  throw new Error('门禁未在预期时间内挂起')
}

describe('Reporter 与 Bridge 在线门禁契约', () => {
  let bridgeServer: RunningBridgeServer

  before(async () => {
    bridgeServer = await startBridgeServer({ port: TEST_PORT, host: TEST_HOST })
  })

  after(async () => {
    bridgeServer.gateManager.clear('test teardown')
    await bridgeServer.close()
  })

  it('人类拒绝必须回归为 rejected，绝不静默放行', async () => {
    const reporter = createReporter({ endpoint: BASE_URL, probeTimeoutMs: 200 })
    const gatePromise = reporter.gate({ action: 'git commit', summary: '提交核心改动' })

    await resolvePendingGate(bridgeServer, { action: 'reject', feedback: '保留在本地，暂不提交' })
    const result = await gatePromise

    assert.equal(result.decision, 'rejected')
    assert.equal(result.reason, '保留在本地，暂不提交')
  })

  it('人类批准回归为 approved，载荷携带真实命令与说明', async () => {
    const reporter = createReporter({ endpoint: BASE_URL, probeTimeoutMs: 200 })
    const gatePromise = reporter.gate({ action: 'git push origin main', summary: '推送至远端' })

    const [pending] = await waitForPendingGate(bridgeServer)
    assert.equal(pending.proposedAction.command, 'git push origin main')
    assert.equal(pending.proposedAction.explanation, '推送至远端')
    bridgeServer.gateManager.resolveGate(pending.gateId, { action: 'approve' })

    const result = await gatePromise
    assert.equal(result.decision, 'approved')
  })

  it('热纠偏放行回传人类改写后的命令', async () => {
    const reporter = createReporter({ endpoint: BASE_URL, probeTimeoutMs: 200 })
    const gatePromise = reporter.gate({ action: 'rm -rf ./dist', summary: '清理构建产物' })

    await resolvePendingGate(bridgeServer, {
      action: 'modify',
      feedback: '改为仅清理缓存目录',
      modifiedCommand: 'rm -rf ./cache',
    })

    const result = await gatePromise
    assert.equal(result.decision, 'approved')
    assert.equal(result.modifiedCommand, 'rm -rf ./cache')
  })

  it('等待超时返回显式 timeout，不谎报为已批准', async () => {
    const reporter = createReporter({
      endpoint: BASE_URL,
      probeTimeoutMs: 200,
      gateTimeoutMs: 80,
    })

    const result = await reporter.gate({ action: 'drop table users', summary: '危险操作' })
    assert.equal(result.decision, 'timeout')

    bridgeServer.gateManager.clear('timeout cleanup')
  })

  it('demoOnly 演示流隔离到 demo- 会话与 demo- 门禁 ID', async () => {
    const reporter = createReporter({
      endpoint: BASE_URL,
      probeTimeoutMs: 200,
      sessionId: 'live-wangqing',
    })
    const gatePromise = reporter.gate({ action: 'git commit -m "demo"', summary: '演示门禁' })

    const [pending] = await waitForPendingGate(bridgeServer)
    assert.equal(pending.demoOnly, true)
    assert.ok(pending.gateId.startsWith('demo-'), '演示门禁 ID 必须带 demo- 前缀')
    assert.equal(pending.sessionId, 'demo-live-wangqing')

    bridgeServer.gateManager.resolveGate(pending.gateId, { action: 'reject', feedback: '演示结束' })
    const result = await gatePromise
    assert.equal(result.decision, 'rejected')
  })

  it('demoOnly 遥测旁路 L1 断言，绝不写入真实失败指纹', async () => {
    const failingObservation = {
      nodeId: 'demo-node-assert',
      sessionId: 'live-wangqing',
      type: 'node_complete' as const,
      gesture: 'bash' as const,
      title: 'pnpm test',
      status: 'failed' as const,
      demoOnly: true,
      observation: { exitCode: 1, output: ['✖ 12 tests failed'] },
    }

    const res = await fetch(`${BASE_URL}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(failingObservation),
    })
    assert.equal(res.status, 200)
    const data = await res.json()

    assert.equal(data.assertion.rule, 'demo_bypass')
    assert.equal(data.assertion.triggerGate, false)

    const signature = computeFailureSignature({
      command: 'pnpm test',
      exitCode: 1,
      output: ['✖ 12 tests failed'],
    })
    assert.equal(
      bridgeServer.assertionEngine.getFailureCount(signature),
      0,
      '演示失败绝不进入真实失败历史'
    )
  })
})
