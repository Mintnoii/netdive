import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { scanLocalSessions, readLocalTranscript } from './src/services/localSessionScanner.ts'

/**
 * NetDive 本地会话开发直通插件：
 * 让仅启动 `pnpm dev` 的前端也能直接通过 Vite Node 环境读取 ~/.pi/agent/sessions/ 存量账本，
 * 彻底消灭必须先单独开窗口起 4560 Sidecar 的前置摩擦！
 */
function localSessionDevPlugin(): Plugin {
  return {
    name: 'netdive-local-sessions-dev',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || ''
        if (url.startsWith('/api/sessions/local')) {
          if (url.includes('/transcript')) {
            const match = url.match(/\/api\/sessions\/local\/([^/?]+)\/transcript/)
            if (match) {
              const id = match[1]
              const content = readLocalTranscript(id)
              if (content) {
                res.setHeader('Content-Type', 'text/plain; charset=utf-8')
                res.end(content)
                return
              }
              res.statusCode = 404
              res.end('Transcript not found')
              return
            }
          }

          // 列表拉取
          const urlObj = new URL(url, 'http://localhost')
          const limit = Number(urlObj.searchParams.get('limit')) || 50
          const sessions = scanLocalSessions(limit)
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: true, sessions }))
          return
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    localSessionDevPlugin(),
  ],
})

