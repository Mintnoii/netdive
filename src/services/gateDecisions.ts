/**
 * @file src/services/gateDecisions.ts
 * @description 门禁裁决信封的纯函数构造器（审批窗与自动化脚本共用）。
 *
 * 契约：
 * 1. 裁决信封形状只在此处定义，UI 只负责收集人类输入；
 * 2. 热纠偏必须以 `modifiedCommand` 回传给 Agent，`feedback` 承载人类批注；
 * 3. 拒绝时若人类未填写理由，给出确定性兜底文案。
 */

import type { GateDecision } from '../types/telemetry'

/** 拒绝且未填理由时的兜底文案 */
export const DEFAULT_REJECT_FEEDBACK = '人类操作员拒绝放行'

/**
 * 构造批准放行信封
 *
 * @example
 * buildApproveDecision() // => { action: 'approve' }
 */
export function buildApproveDecision(): GateDecision {
  return { action: 'approve' }
}

/**
 * 构造热纠偏放行信封：人类改写后的命令即为新的执行指令
 *
 * @example
 * buildModifyDecision(' git commit --amend ')
 * // => { action: 'modify', feedback: 'git commit --amend', modifiedCommand: 'git commit --amend' }
 */
export function buildModifyDecision(steering: string): GateDecision {
  const text = steering.trim()
  return { action: 'modify', feedback: text, modifiedCommand: text }
}

/**
 * 构造拒绝拦截信封
 *
 * @example
 * buildRejectDecision('')   // => { action: 'reject', feedback: '人类操作员拒绝放行' }
 * buildRejectDecision('风险太高') // => { action: 'reject', feedback: '风险太高' }
 */
export function buildRejectDecision(steering: string): GateDecision {
  return { action: 'reject', feedback: steering.trim() || DEFAULT_REJECT_FEEDBACK }
}
