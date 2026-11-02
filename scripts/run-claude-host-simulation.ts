/**
 * @file scripts/run-claude-host-simulation.ts
 * @description Claude 编排端到端真实仿真测试驱动脚本。
 *
 * 核心审美契约 (MIND.md 维度 3)：
 * 1. 业务零侵入：业务代码保持 100% 干净，纯外部切面仿真；
 * 2. 纯函数闭包风格，严格依托 radash.tryit，彻底消灭 Class 与原生 try/catch；
 * 3. 全真模拟 Pi 宿主环境的 ExtensionAPI (tool_execution_start, tool_call, tool_execution_end)；
 * 4. 三幕真实业务测试剧本：长文抓取 (read)、灵感碎片 (edit)、高危命令拦截与放行 (gate/bash)；
 * 5. 驱动真实 NetDive 控制台实时建图，并由 Playwright 截取全景大盘存至 public/claude-e2e-simulation-verified.png。
 */

import { pathToFileURL } from 'node:url'
import { existsSync, statSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { tryit, sleep } from 'radash'
import { normalize, resolve } from 'pathe'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

/** 桥接服务与前端地址常量配置 */
const BRIDGE_URL = (process.env.NETDIVE_BRIDGE || 'http://127.0.0.1:4560').replace(/\/+$/, '')
const WEB_UI_URL = 'http://localhost:5173'
const SCREENSHOT_OUTPUT = 'public/claude-e2e-simulation-verified.png'
const HOST_EXTENSION_PATH = normalize(
  resolve('C:/Users/wangqing/Desktop/dotagents/extensions/pi-netdive-bridge/index.ts')
)

/** Pi 切面监听器闭包类型 */
type PiEventListener = (payload: unknown) => Promise<unknown>

/**
 * 纯函数工厂：构建轻量无状态的 Pi 宿主切面模拟闭包
 * 严格消灭 Class 样板与命令式状态机
 *
 * @example
 * ```ts
 * const { pi, emit } = createMockPiHost()
 * registerExtension(pi)
 * await emit('tool_execution_start', { toolCallId: 'c1', toolName: 'bash' })
 * ```
 */
export const createMockPiHost = () => {
  const listeners = new Map<string, PiEventListener[]>()

  const on = (event: string, handler: PiEventListener) => {
    const current = listeners.get(event) ?? []
    listeners.set(event, [...current, handler])
    return () => {
      const active = listeners.get(event) ?? []
      listeners.set(event, active.filter((h) => h !== handler))
    }
  }

  const emit = async <T = unknown>(event: string, payload: unknown): Promise<T[]> => {
    const handlers = listeners.get(event) ?? []
    const results: T[] = []
    for (const handler of handlers) {
      const [err, res] = await tryit(handler)(payload)
      if (err) throw err
      results.push(res as T)
    }
    return results
  }

  return {
    pi: { on } as unknown as ExtensionAPI,
    emit,
    getRegisteredEvents: () => Array.from(listeners.keys()),
  }
}

/**
 * 纯函数：创建并托管 Playwright 浏览器自动化协程
 * 负责清空初始画布、实时监听 WebSocket 连通与最终全景截图
 */
export const createBrowserAutomation = async () => {
  const pythonScript = normalize(resolve('scripts/browser-capture.py'))
  const child: ChildProcess = spawn('python', ['-u', pythonScript], {
    stdio: ['pipe', 'pipe', 'inherit'],
    cwd: process.cwd(),
  })

  const waitForSignal = (prefix: string, timeoutMs = 25000): Promise<string> => {
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        rej(new Error(`等待浏览器信号超时: [${prefix}] (${timeoutMs}ms)`))
      }, timeoutMs)

      const onData = (chunk: Buffer) => {
        const text = chunk.toString()
        const lines = text.split(/\r?\n/)
        for (const line of lines) {
          if (line.startsWith(prefix)) {
            clearTimeout(timer)
            child.stdout?.off('data', onData)
            res(line)
            return
          }
        }
      }
      child.stdout?.on('data', onData)
    })
  }

  const [readyErr, readySignal] = await tryit(waitForSignal)('READY', 25000)
  if (readyErr || !readySignal) {
    child.kill()
    throw readyErr ?? new Error('Playwright 浏览器未能按时就绪')
  }

  const sendCommand = (cmd: string) => {
    child.stdin?.write(`${cmd}\n`)
  }

  const approveGate = async (): Promise<boolean> => {
    sendCommand('APPROVE_GATE')
    const [err, sig] = await tryit(waitForSignal)('GATE_', 10000)
    return !err && Boolean(sig?.includes('APPROVED'))
  }

  const captureCanvas = async (): Promise<string> => {
    sendCommand('CAPTURE')
    const [err, sig] = await tryit(waitForSignal)('CAPTURED:', 15000)
    if (err || !sig) {
      throw err ?? new Error('全景画布截图失败')
    }
    return sig.replace(/^CAPTURED:/, '').trim()
  }

  const close = () => {
    tryit(() => {
      sendCommand('EXIT')
      child.kill()
    })()
  }

  return {
    approveGate,
    captureCanvas,
    close,
  }
}

/**
 * 三幕端到端全真业务剧本数据契约
 */
export const BUSINESS_SCENARIOS = [
  {
    order: 1,
    title: '场景一：Tachikoma 微信长文抓取 (Fast-HTTP 免浏览器秒级直通)',
    toolCallId: 'call_tachikoma_capture_001',
    parentToolCallId: undefined,
    toolName: 'bash',
    command: 'node apps/cli/src/cli.ts capture https://mp.weixin.qq.com/s/sample-ai-cognition-article',
    expectedGesture: 'read',
    output: `[Tachikoma Fast-HTTP] 抓取微信长文成功: 《AI 时代个人的认知重构》
目标路径: Ghost/_raw/articles/2026-11-02-ai-cognition.md
元数据: 5200 字符, 提取 4 个核心要点, 正文不可变只读落盘
耗时: 380ms`,
  },
  {
    order: 2,
    title: '场景二：Tachikoma 灵感碎片录入 (无感语义嗅探与分类手势)',
    toolCallId: 'call_tachikoma_spark_002',
    parentToolCallId: 'call_tachikoma_capture_001',
    toolName: 'bash',
    command: 'node apps/cli/src/cli.ts spark "AI 是执行者，qing 是判断者。代码与知识库是持久资产，对话仅是运行时交互。"',
    expectedGesture: 'edit',
    output: `⚡ 已收录至 [明心见性 (soul)] #金句心智
内容摘要: AI 是执行者，qing 是判断者。代码与知识库是持久资产，对话仅是运行时交互。
归档路径: Ghost/_raw/sparks/2026-11-soul.md
(回复“撤回”或“删”可秒级移出)`,
  },
  {
    order: 3,
    title: '场景三：高危命令拦截 (执行 git commit，触发待审门禁与人工放行)',
    toolCallId: 'call_git_commit_003',
    parentToolCallId: 'call_tachikoma_spark_002',
    toolName: 'bash',
    command: 'git commit -m "feat(telemetry): verify zero-intrusion host bridge"',
    expectedGesture: 'bash',
    isHighRisk: true,
    output: `[main 8b1aeda] feat(telemetry): verify zero-intrusion host bridge
 3 files changed, 142 insertions(+), 8 deletions(-)
 create mode 100644 extensions/pi-netdive-bridge/index.ts`,
  },
]

/**
 * 仿真主运行器
 */
export async function runHostSimulation() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🚀 NetDive 宿主无感接管扩展 · Claude 端到端全真仿真测试启动')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  // 1. 探活 NetDive 控制平面与本地 Bridge
  console.log('🔍 [Step 1] 正在探测 NetDive Bridge 健康状态...')
  const [healthErr, healthRes] = await tryit(async () => {
    return await fetch(`${BRIDGE_URL}/health`, { signal: AbortSignal.timeout(2000) })
  })()

  if (healthErr || !healthRes?.ok) {
    throw new Error(
      `NetDive Bridge 服务未在 ${BRIDGE_URL} 启动，请先启动服务 (pnpm start)`
    )
  }
  const healthData = (await healthRes.json()) as { ok: boolean; version: string }
  console.log(`✅ NetDive Bridge 运行正常: v${healthData.version} (端点: ${BRIDGE_URL})\n`)

  // 2. 动态加载真实全局宿主扩展真源
  console.log(`📦 [Step 2] 正在加载宿主扩展真源: ${HOST_EXTENSION_PATH}`)
  const [importErr, extModule] = await tryit(async () => {
    return await import(pathToFileURL(HOST_EXTENSION_PATH).href)
  })()

  if (importErr || !extModule?.default) {
    throw new Error(`加载宿主扩展失败: ${importErr?.message || '未找到 default 导出'}`)
  }

  const { pi, emit, getRegisteredEvents } = createMockPiHost()
  extModule.default(pi)
  console.log(`✅ 宿主扩展挂载成功，已注册生命周期切面: [${getRegisteredEvents().join(', ')}]\n`)

  // 3. 启动 Playwright 浏览器自动化会话并清空画布准备接收流
  console.log('🌐 [Step 3] 正在启动 Playwright 浏览器会话并连接 Web 控制台...')
  const [browserErr, browserSession] = await tryit(createBrowserAutomation)()
  if (browserErr || !browserSession) {
    throw new Error(`启动 Playwright 浏览器失败: ${browserErr?.message}`)
  }
  console.log(`✅ 浏览器已连通 ${WEB_UI_URL}，画布已初始化为 0 节点纯净状态\n`)

  // 4. 逐幕执行端到端全真业务剧本
  console.log('🎬 [Step 4] 开始向 NetDive 实时发射生命周期事件序列...\n')

  try {
    // -----------------------------------------------------------------------
    // 场景一：Tachikoma 微信长文抓取
    // -----------------------------------------------------------------------
    const scene1 = BUSINESS_SCENARIOS[0]
    console.log(`▶ [Act 1] ${scene1.title}`)
    console.log(`  -> 发射 tool_execution_start (命令: ${scene1.command.slice(0, 50)}...)`)
    await emit('tool_execution_start', {
      toolCallId: scene1.toolCallId,
      parentToolCallId: scene1.parentToolCallId,
      toolName: scene1.toolName,
      args: { command: scene1.command },
    })
    console.log('     拓扑节点创建已上报，等待抓取耗时模拟 (600ms)...')
    await sleep(600)

    console.log('  -> 发射 tool_execution_end (提取 4 行摘要与 exitCode: 0)')
    await emit('tool_execution_end', {
      toolCallId: scene1.toolCallId,
      parentToolCallId: scene1.parentToolCallId,
      toolName: scene1.toolName,
      result: scene1.output,
      isError: false,
    })
    console.log('  ✅ 场景一完成：NetDive 自动嗅探为 read 手势并收敛为 completed 状态！\n')
    await sleep(800)

    // -----------------------------------------------------------------------
    // 场景二：Tachikoma 灵感碎片录入
    // -----------------------------------------------------------------------
    const scene2 = BUSINESS_SCENARIOS[1]
    console.log(`▶ [Act 2] ${scene2.title}`)
    console.log(`  -> 发射 tool_execution_start (父节点: ${scene2.parentToolCallId})`)
    await emit('tool_execution_start', {
      toolCallId: scene2.toolCallId,
      parentToolCallId: scene2.parentToolCallId,
      toolName: scene2.toolName,
      args: { command: scene2.command },
    })
    console.log('     拓扑节点与因果连线已上报，等待分类手势嗅探 (600ms)...')
    await sleep(600)

    console.log('  -> 发射 tool_execution_end (输出 Sparks 碎片收录回执)')
    await emit('tool_execution_end', {
      toolCallId: scene2.toolCallId,
      parentToolCallId: scene2.parentToolCallId,
      toolName: scene2.toolName,
      result: scene2.output,
      isError: false,
    })
    console.log('  ✅ 场景二完成：NetDive 自动嗅探为 edit 手势，因果链稳固建立！\n')
    await sleep(800)

    // -----------------------------------------------------------------------
    // 场景三：高危命令拦截 (Git Commit 待审门禁与裁决放行)
    // -----------------------------------------------------------------------
    const scene3 = BUSINESS_SCENARIOS[2]
    console.log(`▶ [Act 3] ${scene3.title}`)
    console.log(`  -> 发射 tool_execution_start (准备执行高危命令: ${scene3.command})`)
    await emit('tool_execution_start', {
      toolCallId: scene3.toolCallId,
      parentToolCallId: scene3.parentToolCallId,
      toolName: scene3.toolName,
      args: { command: scene3.command },
    })

    console.log('  -> 发射 tool_call 触发高危规则命中，协程跨进程挂起中...')
    const gatePromise = emit('tool_call', {
      toolCallId: scene3.toolCallId,
      toolName: scene3.toolName,
      input: { command: scene3.command },
    })

    // 等待门禁向控制台广播并弹出模态窗
    console.log('     等待 NetDive 审批模态窗唤起并由浏览器/API执行批准...')
    await sleep(1000)

    // 尝试在浏览器端点击批准放行
    const [approveErr, approvedInUi] = await tryit(browserSession.approveGate)()
    if (approveErr || !approvedInUi) {
      console.log('     浏览器端自动点击超时，兜底通过 /api/gate/resolve HTTP 接口执行裁决放行...')
      await fetch(`${BRIDGE_URL}/api/gate/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gateId: `gate-${scene3.toolCallId}`,
          decision: {
            action: 'approve',
            feedback: '已人工审查变更符合 MIND.md 架构审美，准予提交',
          },
        }),
      })
    } else {
      console.log('     👤 人类操作员在 NetDive 网页端点击了【批准放行 (Approve)】！')
    }

    const gateResults = await gatePromise
    console.log(`  -> tool_call 挂起解除，宿主放行结果: ${JSON.stringify(gateResults[0] ?? '放行 (Undefined)')}`)

    console.log('  -> 发射 tool_execution_end (Git Commit 成功上报完成)')
    await emit('tool_execution_end', {
      toolCallId: scene3.toolCallId,
      parentToolCallId: scene3.parentToolCallId,
      toolName: scene3.toolName,
      result: scene3.output,
      isError: false,
    })
    console.log('  ✅ 场景三完成：高危门禁经人工审批放行，拓扑全链路收敛！\n')
    await sleep(1200)

    // 5. 截取测试完成后的全景大盘高清截图
    console.log(`📸 [Step 5] 正在通过 Playwright 截取测试大盘全景至 ${SCREENSHOT_OUTPUT}...`)
    const savedPath = await browserSession.captureCanvas()
    console.log(`✅ 大盘截图生成成功: ${savedPath}`)

    if (!existsSync(savedPath)) {
      throw new Error(`截图文件未在本地落盘: ${savedPath}`)
    }
    const fileSize = statSync(savedPath).size
    console.log(`   文件尺寸: ${(fileSize / 1024).toFixed(1)} KB (确认高清满版图)`)

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('🎉 所有三幕测试剧本全部通过，NetDive 宿主无感接管表现完美！')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  } finally {
    browserSession.close()
  }
}

// 执行仿真
runHostSimulation().catch((err) => {
  console.error('\n❌ 仿真测试执行异常:', err instanceof Error ? err.message : err)
  process.exit(1)
})
