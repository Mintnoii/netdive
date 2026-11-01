/**
 * Realistic Bundled Pi / Claude JSONL Transcript Sample
 * 供 NetDive 会话时光机 (Session Replay) 页面开箱即用体验与演示
 */

export const REALISTIC_PI_TRANSCRIPT_SAMPLE = [
  JSON.stringify({
    type: 'session',
    version: 3,
    id: '01a195f4-beb3-75a8-9165-bffa1e306b28',
    timestamp: '2026-11-01T07:13:27.219Z',
    cwd: 'C:\\Users\\wangqing\\Desktop\\Ghost',
  }),
  JSON.stringify({
    type: 'model_change',
    id: '97724781',
    parentId: null,
    timestamp: '2026-11-01T07:13:27.739Z',
    provider: 'magpie',
    modelId: 'antigravity/gemini-3.8-flash',
  }),
  JSON.stringify({
    type: 'message',
    id: 'msg-user-1',
    parentId: '97724781',
    timestamp: '2026-11-01T07:13:30.000Z',
    message: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: '请重构 Ghost 数据清洗流 packages/core/src/pipeline.ts，消除命令式 try-catch 样板并跑通自动化回归测试。',
        },
      ],
    },
  }),
  JSON.stringify({
    type: 'message',
    id: 'msg-ast-1',
    parentId: 'msg-user-1',
    timestamp: '2026-11-01T07:13:32.000Z',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking:
            '接收到重构指令。首先检查 packages/core/src/pipeline.ts 的现有代码实现，并运行既有单元测试确定基准状态。',
        },
        {
          type: 'toolCall',
          id: 'call_read_pipeline',
          name: 'read',
          arguments: {
            path: 'packages/core/src/pipeline.ts',
            limit: 50,
          },
        },
      ],
    },
  }),
  JSON.stringify({
    type: 'message',
    id: 'msg-tool-res-1',
    parentId: 'msg-ast-1',
    timestamp: '2026-11-01T07:13:33.500Z',
    message: {
      role: 'toolResult',
      toolCallId: 'call_read_pipeline',
      toolName: 'read',
      content: [
        {
          type: 'text',
          text: 'export async function runPipeline() {\n  try {\n    return await execute();\n  } catch (err) {\n    logger.error(err);\n    return null;\n  }\n}',
        },
      ],
      isError: false,
      durationMs: 85,
    },
  }),
  JSON.stringify({
    type: 'message',
    id: 'msg-ast-2',
    parentId: 'msg-tool-res-1',
    timestamp: '2026-11-01T07:13:34.000Z',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking:
            '确认存在典型的 catch-and-swallow 样板。先跑现有测试确认初始用例状态。',
        },
        {
          type: 'toolCall',
          id: 'call_bash_test_initial',
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
    id: 'msg-tool-res-2',
    parentId: 'msg-ast-2',
    timestamp: '2026-11-01T07:13:36.000Z',
    message: {
      role: 'toolResult',
      toolCallId: 'call_bash_test_initial',
      toolName: 'bash',
      content: [
        {
          type: 'text',
          text: 'FAIL test/pipeline.test.ts\n✕ pipeline catches error and silently returns null\nAssertionError: expected null to be [Error, undefined]',
        },
      ],
      isError: true,
      durationMs: 1420,
    },
  }),
  JSON.stringify({
    type: 'message',
    id: 'msg-ast-3',
    parentId: 'msg-tool-res-2',
    timestamp: '2026-11-01T07:13:37.000Z',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking:
            '单测失败 (exitCode=1)，捕获到预期断言冲突。启动 ReAct 自愈分支，迁移至 radash.tryit 强类型元组返回。',
        },
        {
          type: 'toolCall',
          id: 'call_edit_pipeline',
          name: 'edit',
          arguments: {
            path: 'packages/core/src/pipeline.ts',
            edits: [
              {
                oldText: 'try { return await execute(); } catch (err) { ... }',
                newText: 'const [err, res] = await tryit(execute)(); return [err, res];',
              },
            ],
          },
        },
      ],
    },
  }),
  JSON.stringify({
    type: 'message',
    id: 'msg-tool-res-3',
    parentId: 'msg-ast-3',
    timestamp: '2026-11-01T07:13:38.200Z',
    message: {
      role: 'toolResult',
      toolCallId: 'call_edit_pipeline',
      toolName: 'edit',
      content: [
        {
          type: 'text',
          text: 'Successfully replaced 1 occurrence in packages/core/src/pipeline.ts',
        },
      ],
      isError: false,
      durationMs: 45,
    },
  }),
  JSON.stringify({
    type: 'message',
    id: 'msg-ast-4',
    parentId: 'msg-tool-res-3',
    timestamp: '2026-11-01T07:13:39.000Z',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking: '代码编辑已就绪，重新执行单测回归验证。',
        },
        {
          type: 'toolCall',
          id: 'call_bash_test_verify',
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
    id: 'msg-tool-res-4',
    parentId: 'msg-ast-4',
    timestamp: '2026-11-01T07:13:41.000Z',
    message: {
      role: 'toolResult',
      toolCallId: 'call_bash_test_verify',
      toolName: 'bash',
      content: [
        {
          type: 'text',
          text: '✓ test/pipeline.test.ts (156 passed, 0 failed)\nTest Suites: 1 passed, 1 total\nTime: 1.45s',
        },
      ],
      isError: false,
      durationMs: 1450,
    },
  }),
  JSON.stringify({
    type: 'message',
    id: 'msg-ast-5',
    parentId: 'msg-tool-res-4',
    timestamp: '2026-11-01T07:13:42.000Z',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: '重构完成！使用 radash.tryit 彻底消除了 try-catch 样板代码，单测回归全量通过 (156 passed, 0 failed)。',
        },
      ],
    },
  }),
].join('\n')
