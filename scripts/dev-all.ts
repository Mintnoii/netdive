import { spawn } from 'node:child_process'

// 零依赖跨平台并发启动 Vite 前端与 Hono 桥接后台
const isWin = process.platform === 'win32'
const npxCmd = isWin ? 'npx.cmd' : 'npx'

console.log('🚀 [NetDive] 正在并发启动全栈服务：Vite 前端 (5173) + Hono 桥接服务 (4560)...\n')

// 1. 启动 Hono 跨进程桥接服务 (4560)
const server = spawn(npxCmd, ['tsx', 'src/server/index.ts'], {
  stdio: 'inherit',
  shell: isWin,
})

// 2. 启动 Vite 前端页面 (5173)
const vite = spawn(npxCmd, ['vite'], {
  stdio: 'inherit',
  shell: isWin,
})

const cleanExit = () => {
  server.kill()
  vite.kill()
  process.exit(0)
}

process.on('SIGINT', cleanExit)
process.on('SIGTERM', cleanExit)
server.on('exit', (code) => {
  if (code !== 0 && code !== null) process.exit(code)
})
vite.on('exit', (code) => {
  if (code !== 0 && code !== null) process.exit(code)
})
