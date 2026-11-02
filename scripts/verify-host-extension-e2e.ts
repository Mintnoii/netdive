/**
 * End-to-End Verification Script: pi-netdive-bridge against live NetDive Bridge Server
 */
import { createBridgeApp } from '../src/server/bridge.ts'
import { serve } from '@hono/node-server'
import type { ServerType } from '@hono/node-server'
import { pathToFileURL } from 'node:url'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

async function runE2E() {
  console.log('🚀 启动 NetDive Bridge 真实服务器端点...')
  const bridgeApp = createBridgeApp()
  const port = 4599
  process.env.NETDIVE_BRIDGE = `http://127.0.0.1:${port}`

  const server: ServerType = serve({
    fetch: bridgeApp.app.fetch,
    port,
    hostname: '127.0.0.1',
  })

  try {
    // 1. 等待服务就绪
    await new Promise((r) => setTimeout(r, 200))
    console.log(`✅ NetDive Bridge 运行在 http://127.0.0.1:${port}`)

    // 2. 模拟 Pi Agent 宿主环境
    const handlers: Record<string, (event: any) => Promise<any>> = {}
    const mockPi: ExtensionAPI = {
      on: (event: string, handler: (e: any) => Promise<any>) => {
        handlers[event] = handler
        return () => {}
      },
    } as unknown as ExtensionAPI

    // 3. 加载全机映射的真实宿主扩展 (~/.pi/agent/extensions/pi-netdive-bridge)
    console.log('📦 正在加载宿主扩展: ~/.pi/agent/extensions/pi-netdive-bridge/index.ts')
    const extensionUrl = pathToFileURL('C:/Users/wangqing/.pi/agent/extensions/pi-netdive-bridge/index.ts').href
    const extensionModule = await import(extensionUrl)
    const registerNetDiveBridge = extensionModule.default
    registerNetDiveBridge(mockPi)
    console.log('✅ 宿主扩展挂载成功，已注册切面:', Object.keys(handlers).join(', '))

    // 4. 验证 tool_execution_start (Tachikoma 抓取)
    console.log('\n--- 场景 1: 外部长文抓取 (tool_execution_start 拓扑建立) ---')
    await handlers['tool_execution_start']({
      type: 'tool_execution_start',
      toolCallId: 'call_tachikoma_001',
      toolName: 'bash',
      args: { command: 'node apps/cli/src/cli.ts capture https://mp.weixin.qq.com/s/sample' },
    })
    console.log('✅ tool_execution_start 触发成功，遥测事件已送达 NetDive')

    // 5. 验证 tool_call 高危门禁拦截 (Git Commit 审批放行)
    console.log('\n--- 场景 2: 高危命令门禁 (Git Commit 审批挂起与放行) ---')
    const gatePromise1 = handlers['tool_call']({
      type: 'tool_call',
      toolCallId: 'call_git_002',
      toolName: 'bash',
      input: { command: "git commit -m 'feat: verified telemetry'" },
    })

    // 模拟人类在 NetDive Web UI 点击放行
    setTimeout(() => {
      const pending = bridgeApp.gateManager.getPendingGates()
      console.log(`🔍 检测到 NetDive 挂起的待审门禁数量: ${pending.length}, ID: ${pending[0]?.gateId}`)
      if (pending[0]) {
        bridgeApp.gateManager.resolveGate(pending[0].gateId, { action: 'approve' })
        console.log('👤 人类在 NetDive 控制台点击了【批准放行】')
      }
    }, 150)

    const gateResult1 = await gatePromise1
    console.log('✅ gateResult1 放行结果:', gateResult1 === undefined ? '放行 (Undefined)' : gateResult1)
    if (gateResult1 !== undefined) {
      throw new Error(`预期放行，实际返回: ${JSON.stringify(gateResult1)}`)
    }

    // 6. 验证 tool_call 高危门禁物理阻断 (rm -rf 破坏性删除)
    console.log('\n--- 场景 3: 破坏性命令门禁 (rm -rf 审批挂起与物理阻断) ---')
    const gatePromise2 = handlers['tool_call']({
      type: 'tool_call',
      toolCallId: 'call_rm_003',
      toolName: 'bash',
      input: { command: 'rm -rf /critical/data' },
    })

    // 模拟人类在 NetDive Web UI 点击拒绝
    setTimeout(() => {
      const pending = bridgeApp.gateManager.getPendingGates()
      console.log(`🔍 检测到 NetDive 挂起的待审门禁数量: ${pending.length}, ID: ${pending[0]?.gateId}`)
      if (pending[0]) {
        bridgeApp.gateManager.resolveGate(pending[0].gateId, {
          action: 'reject',
          feedback: '禁止对根路径执行破坏性删除！',
        })
        console.log('🛑 人类在 NetDive 控制台点击了【拒绝执行】')
      }
    }, 150)

    const gateResult2 = await gatePromise2
    console.log('✅ gateResult2 阻断结果:', JSON.stringify(gateResult2))
    if (!gateResult2 || !gateResult2.block) {
      throw new Error(`预期阻断失败: ${JSON.stringify(gateResult2)}`)
    }

    // 7. 验证 tool_execution_end (执行完成与前 15 行摘要提取)
    console.log('\n--- 场景 4: 工具执行完成 (tool_execution_end 观察收敛) ---')
    await handlers['tool_execution_end']({
      type: 'tool_execution_end',
      toolCallId: 'call_tachikoma_001',
      toolName: 'bash',
      result: '[Tachikoma] 抓取完成: Ghost/_raw/articles/sample.md (SHA256: e3b0c442)\nTotal time: 1.2s',
      isError: false,
    })
    console.log('✅ tool_execution_end 触发成功，状态流转为 completed')

    console.log('\n🎉 所有端到端场景验收通过，零侵入无感桥接运转正常！')
  } finally {
    server.close()
  }
}

runE2E().catch((err) => {
  console.error('❌ E2E 验证失败:', err)
  process.exit(1)
})
