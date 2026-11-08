/**
 * NetDive Context Compactor Laboratory Scenarios & Utilities
 * 本文件只服务沙盒占位与纯本地 Token 测算，不含任何真实会话数据。
 * 真实会话的压缩机会剖析与真实账请见底部「上下文水位明细」抽屉。
 */

/** 极简沙盒占位提示文本（<=10 行示例输出，用于 textarea 初始 placeholder） */
export const SANDBOX_PLACEHOLDER = [
  '$ pnpm test',
  '▶ Local Sandbox Test Output',
  '  ✔ step 1: initialize test runner (10ms)',
  '  ✔ step 2: execute local sandbox case (12ms)',
  '  ✔ step 3: finish execution without errors (8ms)',
  '  ...（在此粘贴任意长文本，观察微压缩折叠效果）...',
  '✔ 3 passed, 0 failed (30ms)',
].join('\n')

/** 估算文本 Tokens 数 (~3.8 字符 / Token) */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.round(text.length / 3.8))
}
