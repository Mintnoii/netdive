import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  AgentNode,
  AGENT_NODE_WIDTH,
  FAR_ZOOM_THRESHOLD,
  isFarZoom,
  extractBillboardText,
  type AgentNodeData,
} from './AgentNode'
import {
  calculateInverseScaleFactor,
  extractLandmarkLabel,
  extractRealIntent,
} from '../services/agentNodeLOD'

describe('AgentNode 1+2 混合方案与固定 w-[280px] 卡片物理守恒测试', () => {
  describe('1. 节点物理尺寸固定 280px 与 1+2 混合方案 LOD 契约', () => {
    it('节点物理宽度永远固定为标准 280px，彻底废除 165px 胶囊与 scaleFactor 假放大', () => {
      assert.equal(AGENT_NODE_WIDTH, 280)
    })

    it('视距阈值严格锁定为 0.85：zoom < 0.85 为远景大标牌，zoom >= 0.85 为完整信纸卡片', () => {
      assert.equal(FAR_ZOOM_THRESHOLD, 0.85)
      assert.equal(isFarZoom(0.84), true)
      assert.equal(isFarZoom(0.65), true)
      assert.equal(isFarZoom(0.59), true)
      assert.equal(isFarZoom(0.45), true)
      assert.equal(isFarZoom(0.2), true)
      assert.equal(isFarZoom(0.85), false)
      assert.equal(isFarZoom(0.9), false)
      assert.equal(isFarZoom(1.0), false)
    })

    it('在缩小远景下 (zoom < 0.85) 提取加粗、清晰、大字号真实动宾核心意图标牌', () => {
      // 思考手势：🎯 真实动宾意图提取
      const thinkNode: AgentNodeData = {
        gesture: 'think',
        title: '检查App.tsx切片',
        status: 'completed',
      }
      assert.equal(extractBillboardText(thinkNode), '🎯 检查App.tsx切片')

      // 文件读取/编辑手势：📄 醒目文件标牌
      const readNode: AgentNodeData = {
        gesture: 'read',
        title: '读取App源码',
        status: 'completed',
        payload: { path: 'src/App.tsx' },
      }
      assert.equal(extractBillboardText(readNode), '📄 App.tsx')

      const editNode: AgentNodeData = {
        gesture: 'edit',
        title: '修改样式',
        status: 'completed',
        payload: { file_path: 'src/components/AgentNode.tsx' },
      }
      assert.equal(extractBillboardText(editNode), '📄 AgentNode.tsx')

      // 命令行手势：$ 完整命令标牌 (如 $ pnpm test)
      const bashNode: AgentNodeData = {
        gesture: 'bash',
        title: '执行单测',
        status: 'completed',
        payload: { command: 'pnpm test' },
      }
      assert.equal(extractBillboardText(bashNode), '$ pnpm test')

      // 异常手势：❌ 报错
      const failedNode: AgentNodeData = {
        gesture: 'bash',
        title: '执行构建',
        status: 'failed',
      }
      assert.equal(extractBillboardText(failedNode), '❌ 报错')

      // 门禁待审手势：🛡️ 门禁待审
      const gateNode: AgentNodeData = {
        gesture: 'gate',
        title: '高危阻断',
        status: 'gate',
      }
      assert.equal(extractBillboardText(gateNode), '🛡️ 门禁待审')

      // 剪枝修剪节点：✂️ 标牌
      const prunedNode: AgentNodeData = {
        gesture: 'read',
        title: '修剪冗余节点',
        status: 'completed',
        pruned: true,
        payload: { path: 'debug.log' },
      }
      assert.equal(extractBillboardText(prunedNode), '✂️ debug.log')
    })

    it('标牌文本空间充足，支持展示达 45~50 字符完整首句，自然折行绝不截断', () => {
      const complexThink: AgentNodeData = {
        gesture: 'think',
        title: '目标规划与分解',
        delta: '好的，我现在需要重构AgentNode远景常数视网膜尺寸渲染逻辑以杜绝蚂蚁字。接下来我会继续...',
        status: 'completed',
      }
      const billboard = extractBillboardText(complexThink)
      assert.equal(billboard, '🎯 重构AgentNode远景常数视网膜尺寸渲染逻辑以杜绝蚂蚁字')
      assert.ok(billboard.length <= 50, `标牌文本长度 ${billboard.length} 超过 50 字符限制`)
    })

    it('命令行标牌在 280px 卡片下展现完整动宾命令与目标参数（支持达 45~50 字符）', () => {
      const longBashNode: AgentNodeData = {
        gesture: 'bash',
        title: '执行单测',
        status: 'completed',
        payload: { command: 'pnpm test src/components/AgentNode.test.ts' },
      }
      assert.equal(extractBillboardText(longBashNode), '$ pnpm test src/components/AgentNode.test.ts')
    })
  })

  describe('2. extractRealIntent 确定性思考意图提纯纯函数算法', () => {
    it('成功剥离“好的，我现在需要”等礼貌客套前缀并提取首句动宾短语核心', () => {
      const raw = '好的，我现在需要先检查App切片是否有断链。接下来我会继续修复其他问题。'
      assert.equal(extractRealIntent(raw, '默认规划'), '检查App切片是否有断链')
    })

    it('成功剥离“准备开始”前缀并保留核心意图', () => {
      const raw = '准备开始补齐类型声明以通过自动化单测'
      assert.equal(extractRealIntent(raw, '默认规划'), '补齐类型声明以通过自动化单测')
    })

    it('成功剥离“接下来我将”与“首先我们需要”等步骤套话', () => {
      assert.equal(extractRealIntent('接下来我将修复切片断链', '默认'), '修复切片断链')
      assert.equal(extractRealIntent('首先我们需要重构AgentNode组件', '默认'), '重构AgentNode组件')
      assert.equal(extractRealIntent('让我先检查网络连通性', '默认'), '检查网络连通性')
    })

    it('支持连续复合套话前缀的循环递归剥离', () => {
      const compound = '好的，我现在需要准备开始检查App切片'
      assert.equal(extractRealIntent(compound, '默认'), '检查App切片')
    })

    it('支持英文客套前缀（"OK, I need to...", "Let me check..."）的提纯并完整保留句意', () => {
      assert.equal(extractRealIntent('OK, I need to inspect the file system', 'default'), 'inspect the file system')
      assert.equal(extractRealIntent('Let me verify tests', 'default'), 'verify tests')
    })

    it('支持冒号句式提取冒号前的核心动宾意图', () => {
      const text = '检查App切片: 发现 3 处孤岛断链节点'
      assert.equal(extractRealIntent(text, '默认'), '检查App切片')
    })

    it('完整首句支持展示达 45~50 字符，彻底废除 12~16 字符强制截断', () => {
      const longText = '重构AgentNode远景常数视网膜尺寸渲染逻辑以杜绝蚂蚁字'
      const intent = extractRealIntent(longText, '默认')
      // 30 字符完整保留，绝不强行切成残缺短句
      assert.equal(intent, '重构AgentNode远景常数视网膜尺寸渲染逻辑以杜绝蚂蚁字')
      assert.equal(intent.length, 30)

      // 超过 50 字符时安全平滑约束在 50 字符以内
      const extraLong = '好的，我现在需要彻底重构整个拓扑图核心渲染管道并同步优化微压缩机制与会话时光机逻辑以确保大吞吐量下的画布稳定流畅'
      const extraIntent = extractRealIntent(extraLong, '默认')
      assert.ok(extraIntent.length <= 50, `提纯意图长度 ${extraIntent.length} 超过 50 字符限制`)
      assert.ok(extraIntent.length >= 45, `提纯意图长度 ${extraIntent.length} 小于 45 字符`)
    })

    it('当输入为空白、纯标点或仅含套话时，安全回退到 fallback 默认标题', () => {
      assert.equal(extractRealIntent('', '目标规划'), '目标规划')
      assert.equal(extractRealIntent('   ', '目标规划'), '目标规划')
      assert.equal(extractRealIntent('好的，我现在需要', '目标规划'), '目标规划')
      assert.equal(extractRealIntent(null, '决策输出'), '决策输出')
      assert.equal(extractRealIntent(undefined, '决策输出'), '决策输出')
    })

    it('自动剥离前置 Markdown 标记与已有手势表情符号', () => {
      assert.equal(extractRealIntent('## 检查拓扑连线', '默认'), '检查拓扑连线')
      assert.equal(extractRealIntent('🎯 检查App切片', '默认'), '检查App切片')
      assert.equal(extractRealIntent('💭 目标规划任务', '默认'), '目标规划任务')
    })
  })

  describe('3. extractLandmarkLabel 远景地标标签提纯算法', () => {
    describe('3.1 异常提取：优先提纯 ❌ 报错 与 ❌ 已拦截', () => {
      it('当 status === "failed" 时提取 ❌ 报错', () => {
        const data: AgentNodeData = {
          gesture: 'bash',
          title: 'pnpm test:pipeline',
          status: 'failed',
        }
        assert.equal(extractLandmarkLabel(data), '❌ 报错')
      })

      it('当 status === "rejected" 时提取 ❌ 已拦截', () => {
        const data: AgentNodeData = {
          gesture: 'gate',
          title: 'rm -rf production_data',
          status: 'rejected',
        }
        assert.equal(extractLandmarkLabel(data), '❌ 已拦截')
      })

      it('当 observation.exitCode !== 0 时哪怕 title 正常亦强制提取 ❌ 报错', () => {
        const data: AgentNodeData = {
          gesture: 'bash',
          title: '执行构建',
          status: 'completed',
          observation: {
            exitCode: 1,
            output: ['Error: Build failed'],
          },
        }
        assert.equal(extractLandmarkLabel(data), '❌ 报错')
      })

      it('当 assertion.passed === false 时强制提取 ❌ 报错', () => {
        const data: AgentNodeData = {
          gesture: 'bash',
          title: '执行单测',
          status: 'completed',
          assertion: {
            passed: false,
            triggerSelfCorrection: true,
            triggerGate: false,
            severity: 'critical',
            rule: 'exit_code',
            reason: 'Unit tests failed with code 1',
          },
        }
        assert.equal(extractLandmarkLabel(data), '❌ 报错')
      })
    })

    describe('3.2 轮询提取：提纯 ⚡ 轮询 xN', () => {
      it('当 title 包含 "轮询" 且存在 aggregateCount 时提取 ⚡ 轮询 xN', () => {
        const data: AgentNodeData = {
          gesture: 'bash',
          title: 'terminal poll: term_worker_01',
          status: 'completed',
          isAggregated: true,
          aggregateCount: 4,
        }
        assert.equal(extractLandmarkLabel(data), '⚡ 轮询 x4')
      })

      it('当 summary 包含 terminal read/poll 轮询指令时智能识别为 ⚡ 轮询 xN', () => {
        const data: AgentNodeData = {
          gesture: 'bash',
          title: '等待后台 Worker 结束',
          summary: '执行 terminal read --wait 状态轮询',
          status: 'completed',
          aggregateCount: 5,
        }
        assert.equal(extractLandmarkLabel(data), '⚡ 轮询 x5')
      })

      it('未显式设置 aggregateCount 时默认给出 x2 计数', () => {
        const data: AgentNodeData = {
          gesture: 'bash',
          title: '状态轮询',
          status: 'completed',
        }
        assert.equal(extractLandmarkLabel(data), '⚡ 轮询 x2')
      })
    })

    describe('3.3 文件类型：提纯清晰的文件名', () => {
      it('从 payload.path 提取 basename 文件名', () => {
        const data: AgentNodeData = {
          gesture: 'read',
          title: '读取前端拓扑组件源码',
          status: 'completed',
          payload: {
            path: 'src/components/AgentNode.tsx',
          },
        }
        assert.equal(extractLandmarkLabel(data), 'AgentNode.tsx')
      })

      it('从 payload.file_path 提取 basename 文件名', () => {
        const data: AgentNodeData = {
          gesture: 'edit',
          title: '打补丁修复流水线',
          status: 'completed',
          payload: {
            file_path: 'packages/core/src/pipeline.ts',
          },
        }
        assert.equal(extractLandmarkLabel(data), 'pipeline.ts')
      })

      it('从 read: / edit: title 中提取纯净文件名', () => {
        const data1: AgentNodeData = {
          gesture: 'read',
          title: 'read: src/services/transcriptParser.ts',
          status: 'completed',
        }
        assert.equal(extractLandmarkLabel(data1), 'transcriptParser.ts')

        const data2: AgentNodeData = {
          gesture: 'edit',
          title: 'edit: src/App.tsx (添加 LOD 模式)',
          status: 'completed',
        }
        assert.equal(extractLandmarkLabel(data2), 'App.tsx')
      })

      it('搜索模式下返回搜索特征', () => {
        const data: AgentNodeData = {
          gesture: 'read',
          title: '代码符号检索',
          status: 'completed',
          payload: {
            pattern: 'useTelemetryStream',
          },
        }
        assert.equal(extractLandmarkLabel(data), '🔍 useTelemetryStream')
      })
    })

    describe('3.4 命令类型：提纯 $ 命令首词', () => {
      it('从 payload.command 中提取首词并附带 $ 符号', () => {
        const data: AgentNodeData = {
          gesture: 'bash',
          title: '执行单元测试',
          status: 'completed',
          payload: {
            command: 'pnpm test:pipeline --run',
          },
        }
        assert.equal(extractLandmarkLabel(data), '$ pnpm')
      })

      it('针对 orca 编排命令精准提取 $ orca', () => {
        const data: AgentNodeData = {
          gesture: 'bash',
          title: '调度 Worker',
          status: 'completed',
          payload: {
            command: 'orca orchestration worker-start --agent claude',
          },
        }
        assert.equal(extractLandmarkLabel(data), '$ orca')
      })

      it('针对 git 命令精准提取 $ git', () => {
        const data: AgentNodeData = {
          gesture: 'bash',
          title: '查看变更',
          status: 'completed',
          payload: {
            command: 'git status --porcelain',
          },
        }
        assert.equal(extractLandmarkLabel(data), '$ git')
      })

      it('当 payload 无 command 时自动从 title 中提取 $ 命令首词', () => {
        const data: AgentNodeData = {
          gesture: 'bash',
          title: 'bash: cargo build --release',
          status: 'completed',
        }
        assert.equal(extractLandmarkLabel(data), '$ cargo')
      })
    })

    describe('3.5 其他手势（思考真实意图提纯、记忆、门禁、自愈分支与修剪）', () => {
      it('思考手势优先提取真实动宾意图并呈现 🎯 地标 (杜绝死板套话)', () => {
        assert.equal(
          extractLandmarkLabel({ gesture: 'think', title: '检查App切片', status: 'completed' }),
          '🎯 检查App切片'
        )
        assert.equal(
          extractLandmarkLabel({ gesture: 'think', title: '补齐类型声明', status: 'completed' }),
          '🎯 补齐类型声明'
        )

        assert.equal(
          extractLandmarkLabel({
            gesture: 'think',
            title: '目标规划与分解',
            delta: '好的，我现在需要修复切片断链以通过测试。',
            status: 'completed',
          }),
          '🎯 修复切片断链以通过测试'
        )

        assert.equal(
          extractLandmarkLabel({
            gesture: 'think',
            title: '决策输出与复盘',
            summary: '准备开始重构AgentNode组件',
            status: 'completed',
          }),
          '🎯 重构AgentNode组件'
        )
      })

      it('当思考节点仅有死板套话且无 delta/summary 时优雅降级为 💭 规划分类', () => {
        assert.equal(
          extractLandmarkLabel({ gesture: 'think', title: '目标规划与任务分解', status: 'completed' }),
          '💭 目标规划'
        )
        assert.equal(
          extractLandmarkLabel({ gesture: 'think', title: '内部推演与反思', status: 'completed' }),
          '💭 内部推演'
        )
        assert.equal(
          extractLandmarkLabel({ gesture: 'think', title: '决策输出与复盘', status: 'completed' }),
          '💭 决策输出'
        )
      })

      it('记忆手势提纯 🧠 记忆存取', () => {
        assert.equal(
          extractLandmarkLabel({ gesture: 'memory', title: 'Honcho 阿赖耶识沉淀', status: 'completed' }),
          '🧠 记忆存取'
        )
      })

      it('门禁状态提纯 🛡️ 门禁待审', () => {
        assert.equal(
          extractLandmarkLabel({ gesture: 'gate', title: '高危命令阻断', status: 'gate' }),
          '🛡️ 门禁待审'
        )
      })

      it('剪枝节点提纯 ✂️ 已修剪 或 ✂️ 文件名', () => {
        assert.equal(
          extractLandmarkLabel({ gesture: 'read', title: '修剪冗余节点', status: 'completed', pruned: true }),
          '✂️ 已修剪'
        )
        assert.equal(
          extractLandmarkLabel({
            gesture: 'read',
            title: '修剪冗余节点',
            status: 'completed',
            pruned: true,
            payload: { path: 'debug.log' },
          }),
          '✂️ debug.log'
        )
      })

      it('自愈分支标记提纯 ✨ 自愈分支', () => {
        assert.equal(
          extractLandmarkLabel({
            gesture: 'think',
            title: '重试策略推演',
            status: 'completed',
            isCorrectionBranch: true,
          }),
          '✨ 自愈分支'
        )
      })
    })
  })

  describe('4. AgentNode 组件契约与 Handle 锚点位置守恒', () => {
    it('作为合法的 React 组件函数成功导出', () => {
      assert.equal(typeof AgentNode, 'function')
    })

    it('所有强契约常量与纯函数接口零外部副作用且导出了预期类型契约', () => {
      assert.equal(typeof AGENT_NODE_WIDTH, 'number')
      assert.equal(AGENT_NODE_WIDTH, 280)
      assert.equal(typeof FAR_ZOOM_THRESHOLD, 'number')
      assert.equal(FAR_ZOOM_THRESHOLD, 0.85)
      assert.equal(typeof isFarZoom, 'function')
      assert.equal(typeof extractBillboardText, 'function')
      assert.equal(typeof extractLandmarkLabel, 'function')
      assert.equal(typeof extractRealIntent, 'function')
      assert.equal(typeof calculateInverseScaleFactor, 'function')
    })
  })
})
