/**
 * @file src/config/bridge.ts
 * @description NetDive Local Sidecar Bridge 端点单一真源。
 *
 * 契约：
 * 1. 端口与地址只在此处定义，任何模块严禁再写字面量；
 * 2. 服务端启动端口按「显式入参 > PORT 环境变量 > 默认常量」阶梯解析；
 * 3. 客户端 Base URL 归一化统一去尾斜杠，WebSocket 端点由 Base URL 推导。
 */

/** 默认监听主机（仅本机回环，绝不对外暴露） */
export const DEFAULT_BRIDGE_HOST = '127.0.0.1'

/** 默认监听端口 */
export const DEFAULT_BRIDGE_PORT = 4560

/** 桥接服务 HTTP 基址（供 /api/* 端点复用） */
export const DEFAULT_BRIDGE_HTTP_URL = `http://${DEFAULT_BRIDGE_HOST}:${DEFAULT_BRIDGE_PORT}`

/** 桥接服务 WebSocket 端点 */
export const DEFAULT_BRIDGE_WS_URL = `ws://${DEFAULT_BRIDGE_HOST}:${DEFAULT_BRIDGE_PORT}/ws`

/**
 * 归一化 Base URL：去掉尾部所有斜杠
 *
 * @example
 * normalizeBaseUrl('http://127.0.0.1:4560//') // => 'http://127.0.0.1:4560'
 */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

/**
 * 解析服务端监听端口：显式入参 > PORT 环境变量 > 默认常量
 * 仅供 Node 服务端调用，浏览器侧不会触达 process 分支
 */
export function resolveBridgePort(explicitPort?: number): number {
  if (explicitPort !== undefined) return explicitPort
  const envPort = typeof process !== 'undefined' ? process.env?.PORT : undefined
  return envPort ? Number(envPort) : DEFAULT_BRIDGE_PORT
}

/**
 * 解析服务端监听主机：显式入参 > HOST 环境变量 > 默认常量
 */
export function resolveBridgeHost(explicitHost?: string): string {
  if (explicitHost) return explicitHost
  const envHost = typeof process !== 'undefined' ? process.env?.HOST : undefined
  return envHost || DEFAULT_BRIDGE_HOST
}
