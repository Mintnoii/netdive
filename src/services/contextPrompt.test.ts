import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseTranscript } from './transcriptParser'
import { REALISTIC_PI_TRANSCRIPT_SAMPLE } from './sampleTranscript'
import type { ContextPartKind, ContextPrompt } from '../types/telemetry'

const EXPECTED_PART_ORDER: ContextPartKind[] = [
  'system',
  'tools',
  'skills',
  'memory',
  'files',
  'results',
  'chat',
]

describe('Context Prompt Contract & Extraction Engine (yetone/magpie Alignment)', () => {
  it('1. REALISTIC_PI_TRANSCRIPT_SAMPLE 解析后 watermark.prompt 存在，Σ parts.tokens === prompt.tokens === watermark.total，parts 长度为 7', () => {
    const parsed = parseTranscript(REALISTIC_PI_TRANSCRIPT_SAMPLE)
    assert(parsed.watermark, 'watermark 必须存在')
    assert(parsed.watermark.prompt, 'watermark.prompt 必须存在')

    const prompt: ContextPrompt = parsed.watermark.prompt
    assert.equal(prompt.parts.length, 7, 'parts 数组长度必须恒等于 7')

    // 验证固定分类顺序
    for (let i = 0; i < EXPECTED_PART_ORDER.length; i++) {
      assert.equal(
        prompt.parts[i].kind,
        EXPECTED_PART_ORDER[i],
        `parts[${i}].kind 必须为 ${EXPECTED_PART_ORDER[i]}`
      )
    }

    // 验证每个 part 内的 tokens 严格等于其 items.tokens 之和
    for (const part of prompt.parts) {
      const itemSum = part.items.reduce((sum, it) => sum + it.tokens, 0)
      assert.equal(
        part.tokens,
        itemSum,
        `part ${part.kind} 的 tokens (${part.tokens}) 必须等于 items 之和 (${itemSum})`
      )
    }

    // 验证严格对账不变量：Σ parts.tokens === prompt.tokens === watermark.total
    const partsSum = prompt.parts.reduce((sum, p) => sum + p.tokens, 0)
    assert.equal(
      partsSum,
      prompt.tokens,
      `Σ parts.tokens (${partsSum}) 必须严格等于 prompt.tokens (${prompt.tokens})`
    )
    assert.equal(
      prompt.tokens,
      parsed.watermark.total,
      `prompt.tokens (${prompt.tokens}) 必须严格等于 watermark.total (${parsed.watermark.total})`
    )
  })

  it('2. 含 role:system 消息的 JSONL → system part 有 item 且 content 含原文片段', () => {
    const systemPromptSnippet = '你是一个具备控制论硬断言的智能体流水线专家'
    const jsonl = [
      JSON.stringify({
        type: 'session',
        id: 'test-session-system',
        cwd: '/netdive',
      }),
      JSON.stringify({
        type: 'message',
        id: 'msg-sys-1',
        message: {
          role: 'system',
          content: `### 系统提示词\n${systemPromptSnippet}\n遵循第一性原理进行因果拓扑追踪。`,
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'msg-user-1',
        message: {
          role: 'user',
          content: '请检查系统状态',
        },
      }),
    ].join('\n')

    const parsed = parseTranscript(jsonl)
    assert(parsed.watermark?.prompt, 'watermark.prompt 必须存在')

    const systemPart = parsed.watermark.prompt.parts.find((p) => p.kind === 'system')
    assert(systemPart, '必须存在 kind: system 的 part')
    assert(systemPart.items.length > 0, 'system part 必须包含 item')

    const promptItem = systemPart.items.find((it) => it.name === 'prompt')
    assert(promptItem, '必须存在 name: prompt 的条目')
    assert.equal(promptItem.tag, 'prompt')
    assert(promptItem.content, '条目必须保留原文 content')
    assert(
      promptItem.content.includes(systemPromptSnippet),
      `system 条目 content 必须包含片段: "${systemPromptSnippet}"`
    )
    assert(promptItem.tokens > 0, 'system 条目 tokens 必须大于 0')

    const partsSum = parsed.watermark.prompt.parts.reduce((sum, p) => sum + p.tokens, 0)
    assert.equal(partsSum, parsed.watermark.prompt.tokens)
    assert.equal(partsSum, parsed.watermark.total)
  })

  it('3. 含 bash 工具调用 → results part 有 item，n === 调用次数', () => {
    const jsonl = [
      JSON.stringify({
        type: 'session',
        id: 'test-session-tools',
      }),
      JSON.stringify({
        type: 'message',
        id: 'msg-u1',
        message: {
          role: 'user',
          content: '运行两次自动化单元测试',
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'msg-a1',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'call_bash_1',
              name: 'bash',
              arguments: {
                command: 'pnpm test:pipeline',
              },
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'msg-r1',
        message: {
          role: 'toolResult',
          toolCallId: 'call_bash_1',
          content: '✓ 146 tests passed (1.2s)',
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'msg-a2',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'call_bash_2',
              name: 'bash',
              arguments: {
                command: 'pnpm test:pipeline --retry',
              },
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'msg-r2',
        message: {
          role: 'toolResult',
          toolCallId: 'call_bash_2',
          content: '✓ 146 tests passed on retry (1.1s)',
        },
      }),
    ].join('\n')

    const parsed = parseTranscript(jsonl)
    assert(parsed.watermark?.prompt, 'prompt 必须存在')

    const resultsPart = parsed.watermark.prompt.parts.find((p) => p.kind === 'results')
    assert(resultsPart, '必须存在 kind: results 的 part')

    const bashItem = resultsPart.items.find((it) => it.name === 'bash')
    assert(bashItem, '必须存在 name: bash 的条目')
    assert.equal(bashItem.tag, 'result')
    assert.equal(bashItem.n, 2, 'n 必须严格等于调用次数 (2 次)')
    assert(bashItem.tokens > 0, 'tokens 必须大于 0')
    assert(
      bashItem.content?.includes('on retry'),
      'content 必须为最近一次的观测输出原文'
    )

    const partsSum = parsed.watermark.prompt.parts.reduce((sum, p) => sum + p.tokens, 0)
    assert.equal(partsSum, parsed.watermark.prompt.tokens)
    assert.equal(partsSum, parsed.watermark.total)
  })

  it('4. 含 read 调用 → files part 有 item 且 tag === read', () => {
    const jsonl = [
      JSON.stringify({ type: 'session', id: 'test-file-tool' }),
      JSON.stringify({
        type: 'message',
        id: 'm1',
        message: { role: 'user', content: '查看代码' },
      }),
      JSON.stringify({
        type: 'message',
        id: 'm2',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'call_read_1',
              name: 'read',
              arguments: { path: 'packages/core/src/pipeline.ts' },
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'm3',
        message: {
          role: 'toolResult',
          toolCallId: 'call_read_1',
          content: 'export const x = 1',
        },
      }),
    ].join('\n')

    const parsed = parseTranscript(jsonl)
    assert(parsed.watermark?.prompt, 'prompt 必须存在')

    const filesPart = parsed.watermark.prompt.parts.find((p) => p.kind === 'files')
    assert(filesPart, '必须存在 kind: files 的 part')

    const fileItem = filesPart.items.find((it) =>
      it.name.includes('pipeline.ts')
    )
    assert(fileItem, 'files part 必须包含对应文件的 item')
    assert.equal(fileItem.tag, 'read')
    assert.equal(fileItem.n, 1)
    assert.equal(fileItem.content, 'export const x = 1')
    assert(fileItem.tokens > 0)

    const partsSum = parsed.watermark.prompt.parts.reduce((sum, p) => sum + p.tokens, 0)
    assert.equal(partsSum, parsed.watermark.prompt.tokens)
  })

  it('5. 对话轮 → chat part 有 tag === turn 的 item', () => {
    const jsonl = [
      JSON.stringify({
        type: 'session',
        id: 'test-session-dialogue',
      }),
      JSON.stringify({
        type: 'message',
        id: 'msg-u1',
        message: {
          role: 'user',
          content: '第一轮用户提问',
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'msg-a1',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: '这是第一轮助手解答',
            },
          ],
        },
      }),
    ].join('\n')

    const parsed = parseTranscript(jsonl)
    assert(parsed.watermark?.prompt, 'prompt 必须存在')

    const chatPart = parsed.watermark.prompt.parts.find((p) => p.kind === 'chat')
    assert(chatPart, '必须存在 kind: chat 的 part')

    const turnItems = chatPart.items.filter((it) => it.tag === 'turn')
    assert(turnItems.length >= 2, '必须包含至少 2 条 tag === turn 的条目')

    const userTurn = turnItems.find((it) => it.content === '第一轮用户提问')
    assert(userTurn, '必须存在包含用户文本的 turn item')
    assert(userTurn.tokens > 0)

    const assistantTurn = turnItems.find((it) => it.content === '这是第一轮助手解答')
    assert(assistantTurn, '必须存在包含助手文本的 turn item')
    assert(assistantTurn.tokens > 0)

    const partsSum = parsed.watermark.prompt.parts.reduce((sum, p) => sum + p.tokens, 0)
    assert.equal(partsSum, parsed.watermark.prompt.tokens)
  })

  it('6. window === maxCapacity', () => {
    const parsed = parseTranscript(REALISTIC_PI_TRANSCRIPT_SAMPLE)
    assert(parsed.watermark?.prompt, 'prompt 必须存在')

    const expectedWindow =
      parsed.watermark.maxCapacity ?? parsed.watermark.totalLimit ?? 200000
    assert.equal(
      parsed.watermark.prompt.window,
      expectedWindow,
      `prompt.window (${parsed.watermark.prompt.window}) 必须等于 watermark.maxCapacity (${expectedWindow})`
    )
  })

  it('7. 同一会话多次命中系统提示词时合并为一个 prompt item，原文按顺序拼接', () => {
    const jsonl = [
      JSON.stringify({ type: 'session', id: 'test-merge-sys' }),
      JSON.stringify({
        type: 'message',
        message: { role: 'system', content: 'System Part 1' },
      }),
      JSON.stringify({
        type: 'message',
        message: { role: 'system', content: 'System Part 2' },
      }),
    ].join('\n')

    const parsed = parseTranscript(jsonl)
    const sysPart = parsed.watermark?.prompt?.parts.find((p) => p.kind === 'system')
    assert(sysPart, 'system part 必须存在')

    const promptItems = sysPart.items.filter((it) => it.name === 'prompt')
    assert.equal(promptItems.length, 1, '多次命中系统提示词必须合并为单个 prompt 条目')
    assert(promptItems[0].content?.includes('System Part 1'))
    assert(promptItems[0].content?.includes('System Part 2'))
    assert.equal(
      promptItems[0].tokens,
      Math.max(1, Math.ceil((promptItems[0].content?.length ?? 0) / 4))
    )
  })

  it('8. 当 items 总量超过 watermark.total 时等比缩放，仍严格保证 Σ parts.tokens === watermark.total', () => {
    const longText = 'A'.repeat(500000)
    const jsonl = [
      JSON.stringify({ type: 'session', id: 'test-scale' }),
      JSON.stringify({
        type: 'message',
        message: { role: 'user', content: longText },
      }),
    ].join('\n')

    const parsed = parseTranscript(jsonl)
    assert(parsed.watermark?.prompt)

    const partsSum = parsed.watermark.prompt.parts.reduce((sum, p) => sum + p.tokens, 0)
    assert.equal(
      partsSum,
      parsed.watermark.total,
      `缩放后 Σ parts.tokens (${partsSum}) 必须严格等于 watermark.total (${parsed.watermark.total})`
    )
    assert.equal(partsSum, parsed.watermark.prompt.tokens)
  })
})
