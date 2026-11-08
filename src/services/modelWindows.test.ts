import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  FALLBACK_CONTEXT_WINDOW,
  resolveContextWindow,
  effectiveContextWindow,
} from './modelWindows'

describe('resolveContextWindow 模型上下文窗口解析器', () => {
  it('1. 无参或空值时返回 FALLBACK_CONTEXT_WINDOW 且 source 为 default', () => {
    const resNoArg = resolveContextWindow()
    assert.equal(resNoArg.window, FALLBACK_CONTEXT_WINDOW)
    assert.equal(resNoArg.source, 'default')

    const resNull = resolveContextWindow(null)
    assert.equal(resNull.window, FALLBACK_CONTEXT_WINDOW)
    assert.equal(resNull.source, 'default')

    const resEmpty = resolveContextWindow('')
    assert.equal(resEmpty.window, FALLBACK_CONTEXT_WINDOW)
    assert.equal(resEmpty.source, 'default')

    const resWhitespace = resolveContextWindow('   ')
    assert.equal(resWhitespace.window, FALLBACK_CONTEXT_WINDOW)
    assert.equal(resWhitespace.source, 'default')
  })

  it('2. siliconflow/deepseek-ai/DeepSeek-V4.1-Flash 匹配 deepseek-v4 且 window > 1000000', () => {
    const res = resolveContextWindow('siliconflow/deepseek-ai/DeepSeek-V4.1-Flash')
    assert.equal(res.source, 'known')
    assert.equal(res.matchedRule, 'deepseek-v4')
    assert.equal(res.window, 1048576)
    assert(res.window > 1000000)
  })

  it('3. gemini-3.8-flash-high 匹配 gemini- 且 window 为 1048576', () => {
    const res = resolveContextWindow('gemini-3.8-flash-high')
    assert.equal(res.source, 'known')
    assert.equal(res.matchedRule, 'gemini-')
    assert.equal(res.window, 1048576)
  })

  it('4. claude-sonnet-4-6 匹配 claude- 且 window 为 200000', () => {
    const res = resolveContextWindow('claude-sonnet-4-6')
    assert.equal(res.source, 'known')
    assert.equal(res.matchedRule, 'claude-')
    assert.equal(res.window, 200000)
  })

  it('5. 未收录模型 (如 glm-5.3-flash) 走兜底且 source 为 default', () => {
    const res = resolveContextWindow('glm-5.3-flash')
    assert.equal(res.source, 'default')
    assert.equal(res.window, FALLBACK_CONTEXT_WINDOW)
    assert.equal(res.matchedRule, undefined)
  })

  it('6. 大小写不敏感：CLAUDE-SONNET-4-6 与 claude-sonnet-4-6 结果一致', () => {
    const upper = resolveContextWindow('CLAUDE-SONNET-4-6')
    const lower = resolveContextWindow('claude-sonnet-4-6')
    assert.deepEqual(upper, lower)
  })

  it('7. gpt-oss 匹配 128k (131072)', () => {
    const res = resolveContextWindow('openai/gpt-oss-120b')
    assert.equal(res.source, 'known')
    assert.equal(res.matchedRule, 'gpt-oss')
    assert.equal(res.window, 131072)
  })
})

describe('effectiveContextWindow 生效上下文窗口计算 (Magpie scale 不变量)', () => {
  it('1. 用量小于窗口：clamped 为 false，window 不变，source/matchedRule 保持', () => {
    const known = resolveContextWindow('gemini-3.8-flash-high')
    const res = effectiveContextWindow(known, 50000)
    assert.equal(res.clamped, false)
    assert.equal(res.window, 1048576)
    assert.equal(res.source, 'known')
    assert.equal(res.matchedRule, 'gemini-')
  })

  it('2. 用量大于窗口：clamped 为 true，window 撑开至 usedTokens，source/matchedRule 保持（含 default 与 known 两种情况）', () => {
    // default 未知模型情况
    const def = resolveContextWindow('unknown-custom-model')
    const resDef = effectiveContextWindow(def, 369800)
    assert.equal(resDef.clamped, true)
    assert.equal(resDef.window, 369800)
    assert.equal(resDef.source, 'default')
    assert.equal(resDef.matchedRule, undefined)

    // known 已知模型情况
    const known = resolveContextWindow('openai/gpt-oss-120b')
    const resKnown = effectiveContextWindow(known, 150000)
    assert.equal(resKnown.clamped, true)
    assert.equal(resKnown.window, 150000)
    assert.equal(resKnown.source, 'known')
    assert.equal(resKnown.matchedRule, 'gpt-oss')
  })

  it('3. 用量恰好等于窗口：clamped 为 false', () => {
    const known = resolveContextWindow('claude-sonnet-4-6')
    const res = effectiveContextWindow(known, 200000)
    assert.equal(res.clamped, false)
    assert.equal(res.window, 200000)
    assert.equal(res.source, 'known')
    assert.equal(res.matchedRule, 'claude-')
  })

  it('4. usedTokens = 0：clamped 为 false', () => {
    const def = resolveContextWindow()
    const res = effectiveContextWindow(def, 0)
    assert.equal(res.clamped, false)
    assert.equal(res.window, FALLBACK_CONTEXT_WINDOW)
    assert.equal(res.source, 'default')
  })
})
