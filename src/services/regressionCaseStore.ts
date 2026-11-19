/**
 * @file src/services/regressionCaseStore.ts
 * @description 回归用例本地持久化。单一 localStorage key，读写错误一律显式降级为空集合。
 */
import { tryit, unique } from 'radash'
import type { RegressionCase } from './regressionCase'

export const REGRESSION_CASE_STORAGE_KEY = 'netdive.regression.cases.v1'

export const DEFAULT_SEED_CASE: RegressionCase = {
  id: 'case-ghost-distill-pipeline',
  taskKey: 'ghost-distill-pipeline',
  title: 'Ghost 知识库炼化流水线 (死循环与微压缩回归)',
  sourceSessionId: 'demo-session',
  createdAt: 1774000000000,
  baseline: {
    failureTotal: 2,
    peakTokens: 38400,
    utilizationPercent: 19,
    compactionHits: 1,
    reclaimedChars: 4200,
    prefixStatus: 'drifted',
    gateCount: 1,
  },
  evidence: [
    {
      nodeId: 'node-sc-2',
      title: '管道单测初次执行 (退出码 1)',
      rule: 'failed | pnpm test:pipeline (exit: 1)',
      command: 'pnpm test:pipeline',
      outputHead: [
        'FAIL packages/core/test/pipeline.test.ts',
        'AssertionError: Expected status 200, got 500 (Empty input escaping)',
        '    at DistillPipeline.execute (src/pipeline.ts:88:12)',
        '    at processTicksAndRejections (node:internal/process/task_queues:95:5)',
        'Command failed with exit code 1.',
      ],
      pointerId: 'wal-demo-pipe-01',
    },
    {
      nodeId: 'node-sc-3',
      title: '尝试自愈二次重试 (死循环共振)',
      rule: 'failed | pnpm test:pipeline (exit: 1)',
      command: 'pnpm test:pipeline',
      outputHead: [
        'FAIL packages/core/test/pipeline.test.ts',
        'AssertionError: Expected status 200, got 500 (Uncaught null reference)',
        '    at DistillPipeline.execute (src/pipeline.ts:92:15)',
        'Fatal loop resonance detected: same failed command repeated 2 times.',
      ],
      pointerId: 'wal-demo-pipe-02',
    },
  ],
  expectations: [
    {
      rule: 'failed | pnpm test:pipeline (exit: 1)',
      description: '单测退出码必须为 0，消灭空输入逃逸引发的 500 异常与死循环共振',
    },
  ],
}

export function loadRegressionCases(): RegressionCase[] {
  if (typeof localStorage === 'undefined') return [DEFAULT_SEED_CASE]
  const [readErr, raw] = tryit(() => localStorage.getItem(REGRESSION_CASE_STORAGE_KEY))()
  if (readErr || !raw) return [DEFAULT_SEED_CASE]
  const [parseErr, parsed] = tryit(() => JSON.parse(raw) as unknown)()
  if (parseErr || !Array.isArray(parsed) || parsed.length === 0) return [DEFAULT_SEED_CASE]
  // 去除存量可能残留的重复用例（同一来源会话只保留一份单一真源）
  return unique(parsed as RegressionCase[], (item) => item.sourceSessionId || item.id)
}

export function saveRegressionCases(cases: RegressionCase[]): boolean {
  const [err] = tryit(() =>
    localStorage.setItem(REGRESSION_CASE_STORAGE_KEY, JSON.stringify(cases))
  )()
  return !err
}

export function upsertRegressionCase(caseItem: RegressionCase): RegressionCase[] {
  const cases = loadRegressionCases()
  const existsIndex = cases.findIndex(
    (item) =>
      item.id === caseItem.id ||
      (Boolean(caseItem.sourceSessionId) && item.sourceSessionId === caseItem.sourceSessionId)
  )
  const next =
    existsIndex >= 0
      ? cases.map((item, idx) => (idx === existsIndex ? caseItem : item))
      : [caseItem, ...cases]
  saveRegressionCases(next)
  return next
}

export function removeRegressionCase(id: string): RegressionCase[] {
  const next = loadRegressionCases().filter((item) => item.id !== id)
  saveRegressionCases(next)
  return next
}
