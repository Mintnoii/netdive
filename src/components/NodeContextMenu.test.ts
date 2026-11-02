import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Node } from '@xyflow/react'
import type { AgentNodeData } from './AgentNode'
import {
  formatNodeReference,
  calculateContextMenuPosition,
  copyNodeReferenceToClipboard,
  MENU_DEFAULT_WIDTH,
  MENU_DEFAULT_HEIGHT,
  MENU_VIEWPORT_MARGIN,
} from '../types/telemetry'
import { NodeContextMenu } from './NodeContextMenu'

describe('NodeContextMenu & Node Reference Fingerprint Unit Tests', () => {
  describe('1. formatNodeReference 结构化高密度引用纯函数', () => {
    it('全量字段提供时输出严谨合规的 6 行 Markdown 指纹', () => {
      const mockNode: Node = {
        id: 'node-edit-42',
        position: { x: 300, y: 200 },
        data: {
          title: '重构 Ghost pipeline 异常处理',
          actor: 'Claude 3.7 (Worker)',
          gesture: 'edit',
          status: 'completed',
          summary: '使用 radash.tryit 消除原生 try-catch 样板代码',
        } satisfies AgentNodeData,
      }

      const output = formatNodeReference({
        node: mockNode,
        sessionId: 'sess-alpha-001',
        sessionTitle: 'Pipeline 异常治理',
        project: 'Ghost',
      })

      const expected = [
        '[NetDive Node Reference]',
        '- 会话: sess-alpha-001 (Pipeline 异常治理)',
        '- 节点: node-edit-42 (重构 Ghost pipeline 异常处理)',
        '- 执行主体: Claude 3.7 (Worker)',
        '- 手势/状态: edit · completed',
        '- 摘要: 使用 radash.tryit 消除原生 try-catch 样板代码',
      ].join('\n')

      assert.equal(output, expected)
    })

    it('当缺少 sessionTitle 但提供 project 时，会话行回退至所属工程', () => {
      const mockNode: Node = {
        id: 'node-bash-1',
        position: { x: 100, y: 100 },
        data: {
          title: '单元测试执行',
          actor: 'Pi (Coordinator)',
          gesture: 'bash',
          status: 'running',
          summary: 'pnpm test:pipeline running...',
        } satisfies AgentNodeData,
      }

      const output = formatNodeReference({
        node: mockNode,
        sessionId: 'sess-beta-002',
        project: 'Tachikoma',
      })

      assert.ok(output.includes('- 会话: sess-beta-002 (Tachikoma)'))
      assert.ok(output.includes('- 节点: node-bash-1 (单元测试执行)'))
      assert.ok(output.includes('- 执行主体: Pi (Coordinator)'))
      assert.ok(output.includes('- 手势/状态: bash · running'))
      assert.ok(output.includes('- 摘要: pnpm test:pipeline running...'))
    })

    it('当所有可选字段均缺省时，安全优雅降级回退默认值，绝不抛出异常', () => {
      const minimalNode: Node = {
        id: 'node-min-0',
        position: { x: 0, y: 0 },
        data: {},
      }

      const output = formatNodeReference({
        node: minimalNode,
      })

      assert.ok(output.startsWith('[NetDive Node Reference]'))
      assert.ok(output.includes('- 会话: default-session (当前会话)'))
      assert.ok(output.includes('- 节点: node-min-0 (node-min-0)'))
      assert.ok(output.includes('- 执行主体: 未知主体'))
      assert.ok(output.includes('- 手势/状态: unknown · unknown'))
      assert.ok(output.includes('- 摘要: 无详细摘要'))
    })

    it('当摘要为对象且包含嵌套结构时，formatNodeSummary 提取文本并消除 [object Object]', () => {
      const mockNode: Node = {
        id: 'node-obj-9',
        position: { x: 0, y: 0 },
        data: {
          title: 'Git 提交拦截',
          actor: 'Human Operator',
          gesture: 'gate',
          status: 'gate',
          summary: {
            command: 'git commit -m "feat: gate hitl"',
            text: '人类操作员决策放行',
          } as unknown as string,
        } satisfies AgentNodeData,
      }

      const output = formatNodeReference({
        node: mockNode,
        sessionId: 'sess-gate-1',
        sessionTitle: 'HITL 门禁',
      })

      assert.ok(output.includes('- 摘要: 人类操作员决策放行'))
      assert.ok(!output.includes('[object Object]'))
    })
  })

  describe('2. calculateContextMenuPosition 视口防溢出纯函数', () => {
    const VIEWPORT_W = 1920
    const VIEWPORT_H = 1080

    it('居中安全坐标下不翻转，直接保持原始点击物理坐标', () => {
      const pos = calculateContextMenuPosition(500, 300, MENU_DEFAULT_WIDTH, MENU_DEFAULT_HEIGHT, VIEWPORT_W, VIEWPORT_H)
      assert.equal(pos.x, 500)
      assert.equal(pos.y, 300)
      assert.equal(pos.flippedX, false)
      assert.equal(pos.flippedY, false)
    })

    it('右边缘贴边时自动向左翻转 (flippedX = true)', () => {
      const clickX = 1850 // 1850 + 220 = 2070 > 1920 - 8 (1912)
      const pos = calculateContextMenuPosition(clickX, 300, 220, 190, VIEWPORT_W, VIEWPORT_H)
      assert.equal(pos.flippedX, true)
      assert.equal(pos.flippedY, false)
      assert.equal(pos.x, clickX - 220)
      assert.equal(pos.y, 300)
    })

    it('下边缘贴边时自动向上翻转 (flippedY = true)', () => {
      const clickY = 1000 // 1000 + 190 = 1190 > 1080 - 8 (1072)
      const pos = calculateContextMenuPosition(500, clickY, 220, 190, VIEWPORT_W, VIEWPORT_H)
      assert.equal(pos.flippedX, false)
      assert.equal(pos.flippedY, true)
      assert.equal(pos.x, 500)
      assert.equal(pos.y, clickY - 190)
    })

    it('右下角极端贴边时双向翻转 (flippedX & flippedY 均为 true)', () => {
      const clickX = 1910
      const clickY = 1070
      const pos = calculateContextMenuPosition(clickX, clickY, 220, 190, VIEWPORT_W, VIEWPORT_H)
      assert.equal(pos.flippedX, true)
      assert.equal(pos.flippedY, true)
      assert.equal(pos.x, clickX - 220)
      assert.equal(pos.y, clickY - 190)
    })

    it('极端超界或负坐标时约束在 margin 安全视口边界内', () => {
      const pos = calculateContextMenuPosition(-50, -30, 220, 190, VIEWPORT_W, VIEWPORT_H, MENU_VIEWPORT_MARGIN)
      assert.equal(pos.x, MENU_VIEWPORT_MARGIN)
      assert.equal(pos.y, MENU_VIEWPORT_MARGIN)
    })
  })

  describe('3. copyNodeReferenceToClipboard 剪贴板复制逻辑与 Fallback', () => {
    it('调用注入的 mock clipboard.writeText 并准确传入格式化文本', async () => {
      let writtenText = ''
      const mockClipboard = {
        writeText: async (text: string) => {
          writtenText = text
        },
      }

      const mockNode: Node = {
        id: 'node-test-copy',
        position: { x: 0, y: 0 },
        data: {
          title: '复制测试节点',
          actor: 'Claude 3.7 (Worker)',
          gesture: 'edit',
          status: 'completed',
          summary: '测试写入剪贴板',
        } satisfies AgentNodeData,
      }

      const result = await copyNodeReferenceToClipboard({
        node: mockNode,
        sessionId: 'sess-cp-1',
        sessionTitle: '剪贴板测试',
        clipboard: mockClipboard,
      })

      assert.equal(result.success, true)
      assert.equal(writtenText, result.text)
      assert.ok(result.text.includes('- 节点: node-test-copy (复制测试节点)'))
      assert.ok(result.text.includes('- 会话: sess-cp-1 (剪贴板测试)'))
    })

    it('当 clipboard.writeText 抛出异常时降级捕获并不导致崩溃', async () => {
      const failingClipboard = {
        writeText: async () => {
          throw new Error('Clipboard permission denied')
        },
      }

      const mockNode: Node = {
        id: 'node-fail-test',
        position: { x: 0, y: 0 },
        data: {},
      }

      const result = await copyNodeReferenceToClipboard({
        node: mockNode,
        clipboard: failingClipboard,
      })

      // 在 node 测试环境下 fallback document 不存在，故安全返回 success: false
      assert.equal(typeof result.success, 'boolean')
      assert.ok(result.text.includes('[NetDive Node Reference]'))
    })
  })

  describe('4. NodeContextMenu 组件契约', () => {
    it('作为合法的 React 组件函数成功导出', () => {
      assert.equal(typeof NodeContextMenu, 'function')
      assert.equal(NodeContextMenu.name, 'NodeContextMenu')
    })
  })
})
