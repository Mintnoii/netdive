# 功能留档：WAL 真实账接口改为直连 bridge 基址，修 dev 下误判离线

## 变更描述

实机验证（Playwright + 真实 bridge + 30 个真会话）时发现：抽屉压缩机会摘要条一直显示「bridge 未连接，仅显示推演账」，但 bridge 实际在跑。根因是 useWalStats 与 CompactionPreviewOverlay 使用了相对路径 fetch('/api/wal')，在 Vite dev（5175）下打到前端服务器返回 404，被判为离线；而 useBridgeConnection 一直是直连 http://127.0.0.1:4560。修法：让 useBridgeConnection 导出 DEFAULT_BRIDGE_HTTP_URL 作为 bridge HTTP 基址唯一真源，两处 fetch 改为该基址下的绝对 URL。复测摘要条正确显示「bridge 已折叠 1 条 · 释放 527 字符」真实 WAL 账。同时完成本轮要点实测：首屏自动切真实会话、provenance 显示「实测 Counted」、模型窗口按 gemini 规则解析为 1.05M、抽屉七行 + 压缩机会条 + 查看预演浮层均正常、假修剪按钮已消失、页面零 JS 错误。

## 涉及文件

- `src/hooks/useBridgeConnection.ts` — 导出 DEFAULT_BRIDGE_WS_URL / DEFAULT_BRIDGE_HTTP_URL 作为 bridge 地址唯一真源，内部默认值改引用它们
- `src/hooks/useWalStats.ts` — fetch 地址由相对路径 '/api/wal' 改为 `${DEFAULT_BRIDGE_HTTP_URL}/api/wal`
- `src/components/CompactionPreviewOverlay.tsx` — 原文回放 fetch 地址改为 `${DEFAULT_BRIDGE_HTTP_URL}/api/wal/:pointerId/replay`

## 备注

推论：所有面向 bridge 的新端点都必须走 DEFAULT_BRIDGE_HTTP_URL，禁止使用相对路径，否则 dev 环境会静默降级为离线态（这正是 memory 里「静默降级必须暴露失败原因」同一条教训的复现）。
