import { startBridgeServer } from './bridge'

const PORT = Number(process.env.PORT || 4560)
const HOST = process.env.HOST || '127.0.0.1'

async function main() {
  const instance = await startBridgeServer({ port: PORT, host: HOST })

  console.log(`
┌────────────────────────────────────────────────────────┐
│  NetDive Local Sidecar Bridge (HTTP/WebSocket) v0.1.0  │
├────────────────────────────────────────────────────────┤
│  HTTP API:       http://${instance.host}:${instance.port}                 │
│  Health Probe:   GET  http://${instance.host}:${instance.port}/health        │
│  Telemetry In:   POST http://${instance.host}:${instance.port}/api/telemetry │
│  Gate Suspend:   POST http://${instance.host}:${instance.port}/api/gate/prompt│
│  Gate Resolve:   POST http://${instance.host}:${instance.port}/api/gate/resolve│
│  WebSocket:      ws://${instance.host}:${instance.port}/ws                   │
└────────────────────────────────────────────────────────┘
  `)

  const shutdown = async () => {
    console.log('\n[NetDive Bridge] Shutting down bridge server gracefully...')
    await instance.close()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('[NetDive Bridge] Fatal startup error:', err)
  process.exit(1)
})
