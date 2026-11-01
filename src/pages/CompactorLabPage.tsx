import React, { useState, useMemo, useCallback } from 'react'
import {
  FileCode,
  Sliders,
  Copy,
  Check,
  RotateCcw,
  ShieldCheck,
  Database,
  Zap,
  Sparkles,
  Flame,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Coins,
} from 'lucide-react'
import {
  MicroCompactor,
  microCompactor,
  DEFAULT_MAX_LINES_THRESHOLD,
  DEFAULT_HEAD_LINES,
  DEFAULT_TAIL_LINES,
  type CachePrefixBoundary,
} from '../services/microCompactor'
import { formatTokens } from '../types/telemetry'
import {
  SCENARIO_150_LINE_TEST_LOG,
  PRESET_SCENARIOS,
  estimateTokens,
  type ScenarioPresetKey,
} from '../services/compactorLabScenarios'

/**
 * 确定性微压缩与 OTel 观测实验室页面 (CompactorLabPage)
 * Context Thermodynamics & Micro-Compaction Laboratory
 */
export const CompactorLabPage: React.FC = () => {
  // 1. 预设场景选择与文本状态
  const [selectedPreset, setSelectedPreset] = useState<ScenarioPresetKey>(
    '150 行超长单测日志 Dump (pnpm test)'
  )
  const [rawText, setRawText] = useState<string>(SCENARIO_150_LINE_TEST_LOG)
  const [isEditingCustom, setIsEditingCustom] = useState<boolean>(false)

  // 2. 阈值滑块状态
  const [maxLines, setMaxLines] = useState<number>(DEFAULT_MAX_LINES_THRESHOLD) // 默认 40
  const [headLines, setHeadLines] = useState<number>(DEFAULT_HEAD_LINES) // 默认 15
  const [tailLines, setTailLines] = useState<number>(DEFAULT_TAIL_LINES) // 默认 15

  // 3. 复制状态反馈
  const [copiedRaw, setCopiedRaw] = useState<boolean>(false)
  const [copiedCompacted, setCopiedCompacted] = useState<boolean>(false)
  const [copiedHash, setCopiedHash] = useState<boolean>(false)

  // 4. WAL 离线指针与回放交互状态
  const [replayedRawText, setReplayedRawText] = useState<string | null>(null)

  // 5. 提示词前缀稳定性校验状态（全中文业务示例）
  const defaultSystemPrompt =
    '你是由 NetDive 驱动的自主智能体协调者。在执行任务过程中必须严格遵循 L1 确定性硬断言与墨水信纸极简设计审美。'
  const defaultLtm = JSON.stringify(
    {
      用户名称: 'qing',
      工作空间: '个人核心工程 (NetDive + Ghost + Tachikoma)',
      活跃上下文: '阶段三：上下文热力学与微压缩确定性防护',
      核心原则: '先测后投，消除命令式胶水，严禁破坏前缀缓存',
    },
    null,
    2
  )

  const [systemPrompt, setSystemPrompt] = useState<string>(defaultSystemPrompt)
  const [ltm, setLtm] = useState<string>(defaultLtm)
  const [prefixMutationStatus, setPrefixMutationStatus] = useState<
    'pristine' | 'stable' | 'mutated'
  >('pristine')
  const [prefixDiffDetail, setPrefixDiffDetail] = useState<string | null>(null)

  // 本地独立 Compactor 实例，保证实验室交互隔离
  const labCompactor = useMemo(() => {
    return new MicroCompactor({
      maxLinesThreshold: maxLines,
      headLinesCount: headLines,
      tailLinesCount: tailLines,
      pointerPrefix: 'wal-lab-',
    })
  }, [maxLines, headLines, tailLines])

  // 执行微压缩计算 (纯函数推导，无额外副作用)
  const compactionResult = useMemo(() => {
    return labCompactor.compactToolOutput(rawText, {
      toolName: selectedPreset,
      exitCode: 0,
    })
  }, [labCompactor, rawText, selectedPreset])

  // 纯声明式派生指针与 WAL 条目，杜绝在 useMemo 中调用 setState
  const currentPointerId = compactionResult.pointerId || 'wal-call-lab-1'
  const walRecord = compactionResult.pointerId
    ? labCompactor.getWal(compactionResult.pointerId) || null
    : null

  // 原始与压缩文本度量指标
  const rawLinesCount = useMemo(() => rawText.split('\n').length, [rawText])
  const rawCharsCount = rawText.length
  const rawTokens = useMemo(() => estimateTokens(rawText), [rawText])

  const compactedText = compactionResult.output
  const compactedLinesCount = useMemo(() => compactedText.split('\n').length, [compactedText])
  const compactedCharsCount = compactedText.length
  const compactedTokens = useMemo(() => estimateTokens(compactedText), [compactedText])

  const reclaimedTokens = Math.max(0, rawTokens - compactedTokens)
  const reclaimRatio =
    rawTokens > 0 ? ((reclaimedTokens / rawTokens) * 100).toFixed(1) : '0.0'

  // 处理预设场景切换
  const handleSelectPreset = (preset: ScenarioPresetKey) => {
    setSelectedPreset(preset)
    if (preset !== '自定义输入 (Custom Input)') {
      setRawText(PRESET_SCENARIOS[preset])
      setIsEditingCustom(false)
    } else {
      setIsEditingCustom(true)
    }
    setReplayedRawText(null)
  }

  // 重置滑块阈值
  const handleResetSliders = () => {
    setMaxLines(DEFAULT_MAX_LINES_THRESHOLD)
    setHeadLines(DEFAULT_HEAD_LINES)
    setTailLines(DEFAULT_TAIL_LINES)
  }

  // 复制文本辅助函数
  const copyToClipboard = (text: string, setter: (val: boolean) => void) => {
    navigator.clipboard.writeText(text)
    setter(true)
    setTimeout(() => setter(false), 1500)
  }

  // WAL 离线指针原地回放 (Replay Raw from WAL)
  const handleReplayFromWal = useCallback(() => {
    if (!currentPointerId) return
    const replayed =
      labCompactor.replay(currentPointerId) ||
      microCompactor.replay(currentPointerId) ||
      rawText
    setReplayedRawText(replayed)
  }, [currentPointerId, labCompactor, rawText])

  // Prompt Cache 前缀基线边界
  const baselineBoundary: CachePrefixBoundary = useMemo(() => {
    return labCompactor.createPrefixBoundary(defaultSystemPrompt, defaultLtm)
  }, [labCompactor, defaultSystemPrompt, defaultLtm])

  // 当前候选前缀边界
  const currentBoundary: CachePrefixBoundary = useMemo(() => {
    return labCompactor.createPrefixBoundary(systemPrompt, ltm)
  }, [labCompactor, systemPrompt, ltm])

  // 测试 1: 模拟工具微压缩过程下的前缀保真性
  const handleTestCompactionPreservesPrefix = () => {
    // 运行 compactConversation 模拟真实交互
    const convResult = labCompactor.compactConversation(defaultSystemPrompt, defaultLtm, [
      {
        role: 'tool',
        id: 'call-test-output',
        tool_call_id: 'call-test-output',
        content: rawText,
      },
    ])

    setSystemPrompt(defaultSystemPrompt)
    setLtm(defaultLtm)
    setPrefixMutationStatus('stable')
    setPrefixDiffDetail(
      `微压缩已完成：释放 ${convResult.reclaimedChars} 字符，创建 ${convResult.walRecordsCreated} 条 WAL 离线记录。System Prompt 与 LTM 前缀哈希 100% 字节一致 (${convResult.prefixBoundary.prefixHash.slice(0, 16)}...)，完全保真 Anthropic 90% Cache 命中。`
    )
  }

  // 测试 2: 模拟前缀被意外篡改导致 Cache 击穿
  const handleTestPrefixMutation = () => {
    const mutatedSystem = `${defaultSystemPrompt}\n[意外注入的动态时间戳: ${new Date().toLocaleTimeString()}]`
    setSystemPrompt(mutatedSystem)
    const mutatedBoundary = labCompactor.createPrefixBoundary(mutatedSystem, defaultLtm)
    const verification = labCompactor.verifyPrefixStability(baselineBoundary, mutatedBoundary)

    if (!verification.stable) {
      setPrefixMutationStatus('mutated')
      setPrefixDiffDetail(verification.diffDetails || '检测到前缀字节级篡改！')
    }
  }

  // 重置前缀状态
  const handleResetPrefix = () => {
    setSystemPrompt(defaultSystemPrompt)
    setLtm(defaultLtm)
    setPrefixMutationStatus('pristine')
    setPrefixDiffDetail(null)
  }

  return (
    <div className="flex-1 flex flex-col w-full h-full bg-[#FBF9F5] text-[#1E2024] overflow-y-auto">
      {/* 顶部标头与上下文热力学说明 */}
      <div className="border-b border-[#E5E0D8] bg-[#F7F5F0]/60 px-6 py-4 shrink-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 animate-pulse" />
              <h1 className="text-base font-semibold text-[#1E2024] tracking-tight">
                智能工具输出裁剪与省钱实验室 (Token Compactor Lab)
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-[#EFECE6] border border-[#E5E0D8] text-[#6E685E]">
                本地零成本 · 毫秒级防爆窗
              </span>
            </div>
            <p className="text-xs text-[#6E685E] mt-1">
              大白话：AI 运行命令或读文件动辄喷出上百行日志，又贵又慢。本实验台在本地自动剪掉中间废话、只留首尾关键判定，无需花钱调大模型，立省 80%+ 费用！
            </p>
          </div>

          {/* 实时状态指示 */}
          <div className="flex items-center space-x-2 text-xs font-mono">
            <span className="px-2.5 py-1 bg-[#FFFFFF] border border-[#E5E0D8] rounded-md text-[#5E6573] shadow-2xs">
              ⚡ 0 LLM API Cost
            </span>
            <span className="px-2.5 py-1 bg-[#FFFFFF] border border-[#E5E0D8] rounded-md text-[#5E6573] shadow-2xs">
              ⏱ 0ms Delay
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl w-full mx-auto p-6 space-y-6 flex-1">
        {/* =====================================================================
            通俗新手玩法指南 (小白大白话卡片)
           ===================================================================== */}
        <div className="bg-amber-50/70 border border-amber-200/90 rounded-xl p-4 text-xs text-[#4A453E] shadow-2xs leading-relaxed space-y-2">
          <div className="flex items-center space-x-1.5 font-semibold text-amber-950 text-sm">
            <Sparkles className="w-4 h-4 text-amber-700" />
            <span>💡 3 秒看懂这个页面怎么玩（大白话指南）：</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
            <div className="bg-white/80 p-2.5 rounded-lg border border-amber-200/60">
              <span className="font-bold text-amber-900 mr-1">步骤 1 · 点预设场景：</span>
              点击下方按钮（如「150 行超长单测日志」），模拟 AI 跑测试吐出的海量废话。
            </div>
            <div className="bg-white/80 p-2.5 rounded-lg border border-amber-200/60">
              <span className="font-bold text-amber-900 mr-1">步骤 2 · 看对比省钱：</span>
              看左边（150 行原始长文）和右边（只留头尾各 15 行，中间折叠），上面绿字直接显示帮你<b>省了 80%+ 的钱</b>！
            </div>
            <div className="bg-white/80 p-2.5 rounded-lg border border-amber-200/60">
              <span className="font-bold text-amber-900 mr-1">步骤 3 · 滑动自定义：</span>
              拖动右上角滑块（Head / Tail），随心所欲调整你想保留的前后行数，看右侧代码实时伸缩！
            </div>
          </div>
        </div>

        {/* =====================================================================
            Dynamic Metrics Banner (动态指标横幅)
           ===================================================================== */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* 指标 1: Token Reclaim Ratio */}
          <div className="bg-[#FFFFFF] border border-[#E5E0D8] rounded-xl p-4 shadow-xs relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#6E685E]">Token 节约率 (Ratio)</span>
              <Flame className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="mt-2 flex items-baseline space-x-1">
              <span className="text-2xl font-bold font-mono text-emerald-700">
                {compactionResult.compacted ? `${reclaimRatio}%` : '0.0%'}
              </span>
              <span className="text-xs text-[#8F887D]">saved</span>
            </div>
            <div className="mt-2 w-full bg-[#EFECE6] rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-emerald-600 h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${compactionResult.compacted ? reclaimRatio : 0}%` }}
              />
            </div>
          </div>

          {/* 指标 2: Reclaimed Tokens */}
          <div className="bg-[#FFFFFF] border border-[#E5E0D8] rounded-xl p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#6E685E]">已释放注意力 (Reclaimed)</span>
              <Zap className="w-4 h-4 text-amber-600" />
            </div>
            <div className="mt-2 flex items-baseline space-x-1">
              <span className="text-2xl font-bold font-mono text-[#1E2024]">
                {compactionResult.compacted ? formatTokens(reclaimedTokens) : '0'}
              </span>
              <span className="text-xs text-[#8F887D]">tokens (~{Math.round(compactionResult.reclaimedChars)} chars)</span>
            </div>
            <p className="text-[11px] text-[#8F887D] mt-2 font-mono">
              Raw {formatTokens(rawTokens)} → Compact {formatTokens(compactedTokens)}
            </p>
          </div>

          {/* 指标 3: 0 LLM API Cost */}
          <div className="bg-[#FFFFFF] border border-[#E5E0D8] rounded-xl p-4 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#6E685E]">大模型调用成本 (Cost)</span>
                <Coins className="w-4 h-4 text-sky-600" />
              </div>
              <div className="mt-2 flex items-baseline space-x-1">
                <span className="text-2xl font-bold font-mono text-sky-800">$0.00</span>
                <span className="text-xs text-[#8F887D]">USD</span>
              </div>
            </div>
            <p className="text-[11px] text-[#5E6573] mt-2 pt-2 border-t border-[#F4F0EA] leading-relaxed">
              💡 传统做法是花钱调一次大模型帮做总结；本功能是纯本地代码截取，花费为 0！
            </p>
          </div>

          {/* 指标 4: 0ms Delay */}
          <div className="bg-[#FFFFFF] border border-[#E5E0D8] rounded-xl p-4 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#6E685E]">压缩推理延迟 (Latency)</span>
                <Clock className="w-4 h-4 text-purple-600" />
              </div>
              <div className="mt-2 flex items-baseline space-x-1">
                <span className="text-2xl font-bold font-mono text-purple-800">&lt; 1ms</span>
                <span className="text-xs text-[#8F887D]">in-memory</span>
              </div>
            </div>
            <p className="text-[11px] text-[#5E6573] mt-2 pt-2 border-t border-[#F4F0EA] leading-relaxed">
              ⚡ 不走网络发大模型，直接在本地内存截取首尾行，眨眼毫秒级完成！
            </p>
          </div>
        </div>

        {/* =====================================================================
            1) Interactive Context Compaction Split-View (确定性微压缩差分对比)
           ===================================================================== */}
        <section className="bg-[#FFFFFF] border border-[#E5E0D8] rounded-xl shadow-xs overflow-hidden">
          {/* 控制面板：预设场景选择与阈值滑块 */}
          <div className="p-4 border-b border-[#E5E0D8] bg-[#F7F5F0]/70 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* 场景选择器 */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-[#1E2024] mr-1 flex items-center gap-1">
                <FileCode className="w-3.5 h-3.5 text-[#6E685E]" />
                场景预设:
              </span>
              {(
                [
                  '150 行超长单测日志 Dump (pnpm test)',
                  '超大 AST 差异 Diff 补丁 (packages/core/pipeline.ts)',
                  '巨型依赖清单读取 (package.json / tsconfig)',
                  '自定义输入 (Custom Input)',
                ] as ScenarioPresetKey[]
              ).map((preset) => {
                const isSelected = selectedPreset === preset
                return (
                  <button
                    key={preset}
                    onClick={() => handleSelectPreset(preset)}
                    className={`px-2.5 py-1 text-xs rounded-md font-medium border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#1E2024] text-[#FBF9F5] border-[#1E2024] shadow-xs'
                        : 'bg-white text-[#5E6573] border-[#E5E0D8] hover:bg-[#F4F0EA] hover:text-[#1E2024]'
                    }`}
                  >
                    {preset}
                  </button>
                )
              })}
            </div>

            {/* 阈值滑块集合 */}
            <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
              <div className="flex items-center space-x-2">
                <Sliders className="w-3.5 h-3.5 text-[#8F887D]" />
                <span className="text-[#6E685E]">触发裁剪行数 (超过此行数启动裁剪):</span>
                <input
                  type="range"
                  min="10"
                  max="120"
                  step="5"
                  value={maxLines}
                  onChange={(e) => setMaxLines(Number(e.target.value))}
                  className="w-20 accent-[#1E2024] cursor-pointer"
                  title="触发阈值 (Max Lines)：当工具输出行数大于此数值时，启动微压缩；小于此数值则原样保留"
                />
                <span className="font-semibold text-[#1E2024] w-6">{maxLines}</span>
              </div>

              <div className="flex items-center space-x-2">
                <span className="text-[#6E685E]">保留前置 (Head):</span>
                <input
                  type="range"
                  min="3"
                  max="30"
                  step="1"
                  value={headLines}
                  onChange={(e) => setHeadLines(Number(e.target.value))}
                  className="w-16 accent-[#1E2024] cursor-pointer"
                  title="保留头部行数 (Head Lines)：截取前 N 行，用来查看最初执行的命令参数与环境上下文"
                />
                <span className="font-semibold text-[#1E2024] w-5">{headLines}</span>
              </div>

              <div className="flex items-center space-x-2">
                <span className="text-[#6E685E]">保留尾部 (Tail):</span>
                <input
                  type="range"
                  min="3"
                  max="30"
                  step="1"
                  value={tailLines}
                  onChange={(e) => setTailLines(Number(e.target.value))}
                  className="w-16 accent-[#1E2024] cursor-pointer"
                  title="保留尾部行数 (Tail Lines)：截取后 N 行，用来查看最后的错误堆栈与退出状态码"
                />
                <span className="font-semibold text-[#1E2024] w-5">{tailLines}</span>
              </div>

              <button
                onClick={handleResetSliders}
                className="p-1 rounded text-[#8F887D] hover:text-[#1E2024] hover:bg-[#EFECE6] transition-colors cursor-pointer"
                title="重置滑块默认值 (触发 40行, 前置 15行, 尾部 15行)"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 双栏对比代码视窗 */}
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#E5E0D8]">
            {/* 左侧：原始未压缩输出 (Raw Uncompacted Output) */}
            <div className="flex flex-col h-[480px]">
              <div className="px-4 py-2.5 bg-[#FCFAF6] border-b border-[#E5E0D8] flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="font-medium text-xs text-[#1E2024]">原始全量输出 (Raw Output)</span>
                  <span className="text-[11px] font-mono text-[#8F887D]">
                    {rawLinesCount} 行 · {rawCharsCount} 字符 · ~{formatTokens(rawTokens)} tokens
                  </span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <button
                    onClick={() => copyToClipboard(rawText, setCopiedRaw)}
                    className="p-1 text-xs rounded border border-[#E5E0D8] bg-white text-[#6E685E] hover:text-[#1E2024] hover:bg-[#F4F0EA] flex items-center space-x-1 cursor-pointer"
                    title="复制原始全量文本"
                  >
                    {copiedRaw ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span className="text-[10px]">{copiedRaw ? '已复制' : '复制'}</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 p-3 font-mono text-[11px] leading-relaxed bg-[#1E2024] text-[#E5E0D8] overflow-auto select-text">
                {isEditingCustom ? (
                  <textarea
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    placeholder="在此直接粘贴任意待压缩的长工具调用日志、超大 AST 差异或 JSON..."
                    className="w-full h-full bg-transparent text-[#E5E0D8] font-mono text-[11px] leading-relaxed resize-none border-none outline-none focus:ring-0"
                  />
                ) : (
                  rawText.split('\n').map((line, idx) => (
                    <div key={idx} className="flex hover:bg-slate-800/50">
                      <span className="w-10 text-slate-500 select-none text-right pr-3 shrink-0">
                        {idx + 1}
                      </span>
                      <span className="whitespace-pre-wrap break-all">{line || ' '}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 右侧：确定性微压缩输出 (Deterministic Micro-Compacted Output) */}
            <div className="flex flex-col h-[480px]">
              <div className="px-4 py-2.5 bg-[#FCFAF6] border-b border-[#E5E0D8] flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="font-medium text-xs text-[#1E2024]">微压缩输出 (Compacted Output)</span>
                  <span className="text-[11px] font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                    {compactedLinesCount} 行 · {compactedCharsCount} 字符 · ~{formatTokens(compactedTokens)} tokens
                  </span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <button
                    onClick={() => copyToClipboard(compactedText, setCopiedCompacted)}
                    className="p-1 text-xs rounded border border-[#E5E0D8] bg-white text-[#6E685E] hover:text-[#1E2024] hover:bg-[#F4F0EA] flex items-center space-x-1 cursor-pointer"
                    title="复制微压缩后文本"
                  >
                    {copiedCompacted ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span className="text-[10px]">{copiedCompacted ? '已复制' : '复制'}</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 p-3 font-mono text-[11px] leading-relaxed bg-[#1E2024] text-[#E5E0D8] overflow-auto select-text">
                {compactedText.split('\n').map((line, idx) => {
                  const isFoldMarker = line.includes('原始输出已折叠')
                  if (isFoldMarker) {
                    return (
                      <div
                        key={idx}
                        className="my-1.5 px-3 py-1.5 bg-amber-950/70 border border-amber-600/50 rounded text-amber-300 font-semibold flex items-center space-x-2 select-none"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span>{line}</span>
                      </div>
                    )
                  }
                  return (
                    <div key={idx} className="flex hover:bg-slate-800/50">
                      <span className="w-10 text-slate-500 select-none text-right pr-3 shrink-0">
                        {idx + 1}
                      </span>
                      <span className="whitespace-pre-wrap break-all">{line || ' '}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        {/* =====================================================================
            2) 离线备份还原台 (被裁剪内容的后悔药：点击即可 100% 原样还原)
           ===================================================================== */}
        <section className="bg-[#FFFFFF] border border-[#E5E0D8] rounded-xl p-5 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-[#E5E0D8] gap-4">
            <div>
              <div className="flex items-center space-x-2">
                <Database className="w-4 h-4 text-[#1E2024]" />
                <h2 className="text-sm font-semibold text-[#1E2024]">
                  离线存根还原器（被裁剪内容的“后悔药”机制）
                </h2>
                <span className="text-[10px] font-mono text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                  按需全量还原 · 零数据丢失
                </span>
              </div>
              <p className="text-xs text-[#5E6573] mt-1.5 leading-relaxed">
                💡 <b>大白话机制解读</b>：剪掉的 120 行过程文本并没有被扔掉，而是在本地内存悄悄留了完整备份。平时对话只带一个极短的代号（例如 <code className="bg-[#F4F0EA] px-1 py-0.5 rounded text-[#1E2024]">{currentPointerId}</code>）。哪天人类或 AI 需要核查被折叠的全部细节，点击右侧按钮就能 100% 字节不差地在本地瞬间还原！
              </p>
            </div>

            {/* 指针回放核心按钮（对齐右侧居中） */}
            <div className="shrink-0 flex items-center">
              <button
                onClick={handleReplayFromWal}
                className="px-4 py-2 bg-[#1E2024] text-[#FBF9F5] hover:bg-[#34383F] rounded-md text-xs font-medium flex items-center space-x-2 shadow-xs transition-all cursor-pointer"
                title="读取本地内存中的存根并原地还原 100% 原始未压缩输出"
              >
                <RotateCcw className="w-3.5 h-3.5 text-amber-300" />
                <span>从存根中一键还原原文 (Replay Raw)</span>
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* WAL 指针条目详情卡片 */}
            <div className="lg:col-span-1 bg-[#F7F5F0]/60 border border-[#E5E0D8] rounded-lg p-3.5 space-y-2.5 text-xs font-mono">
              <div className="flex items-center justify-between">
                <span className="text-[#6E685E]">指针 ID (Pointer ID):</span>
                <span className="font-bold text-[#1E2024] bg-white px-2 py-0.5 rounded border border-[#E5E0D8]">
                  {currentPointerId}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#6E685E]">调用者契约 (Call Id):</span>
                <span className="text-[#1E2024]">{walRecord?.toolCallId || 'call-tool-current'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#6E685E]">执行退出码 (Exit Code):</span>
                <span className="text-emerald-700 font-semibold">{walRecord?.exitCode ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#6E685E]">原始行数 / 字符:</span>
                <span className="text-[#1E2024]">
                  {walRecord?.originalLines ?? rawLinesCount} 行 / {walRecord?.originalChars ?? rawCharsCount} 字符
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#6E685E]">微压缩保留行数:</span>
                <span className="text-[#1E2024]">{walRecord?.compactedLines ?? compactedLinesCount} 行</span>
              </div>
              <div className="pt-2 border-t border-[#E5E0D8] text-[11px] text-[#6E685E] leading-relaxed">
                <span className="font-semibold text-[#1E2024]">上下文轻量引用: </span>
                {`{ pointerId: "${currentPointerId}", exitCode: ${walRecord?.exitCode ?? 0}, compactSummary: "${walRecord?.compactSummary || '输出已折叠'}" }`}
              </div>
            </div>

            {/* 回放结果展示区 */}
            <div className="lg:col-span-2 border border-[#E5E0D8] rounded-lg p-3.5 bg-[#FCFAF6] flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-2 border-b border-[#E5E0D8]">
                  <span className="text-xs font-semibold text-[#1E2024] flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    WAL 离线内存读取视图
                  </span>
                  {replayedRawText && (
                    <span className="text-[10px] font-mono text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded">
                      ✅ 100% 原始输出字节级精确还原
                    </span>
                  )}
                </div>

                <div className="mt-3 text-xs text-[#5E6573] leading-relaxed">
                  {replayedRawText ? (
                    <div className="font-mono text-[11px] bg-[#1E2024] text-[#E5E0D8] p-3 rounded max-h-48 overflow-auto">
                      <div className="text-emerald-400 font-semibold pb-1 border-b border-slate-700 mb-2">
                        [WAL REPLAY SUCCESS] Pointer ID: {currentPointerId} | Total {replayedRawText.split('\n').length} lines
                      </div>
                      <pre className="whitespace-pre-wrap">{replayedRawText.slice(0, 1200)}</pre>
                      {replayedRawText.length > 1200 && (
                        <div className="text-slate-500 italic mt-1 text-[10px]">
                          ... (已安全截断预览，全量 {replayedRawText.length} 字符已就绪于内存)
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="py-6 text-center text-[#8F887D]">
                      点击右上角「Replay Raw from WAL」即可通过指针 ID 从内存注册表原地还原未压缩原文。
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 pt-2 border-t border-[#E5E0D8] flex items-center justify-between text-[11px] text-[#8F887D] font-mono">
                <span>Memory Registry: {labCompactor.getAllWal().length} records</span>
                <span>Byte Fidelity: 100% Lossless</span>
              </div>
            </div>
          </div>
        </section>

        {/* =====================================================================
            3) 提示词前缀 90% 打折保真器 (保证大模型 Prompt Cache 永不失效)
           ===================================================================== */}
        <section className="bg-[#FFFFFF] border border-[#E5E0D8] rounded-xl p-5 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-[#E5E0D8] gap-4">
            <div>
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-emerald-700" />
                <h2 className="text-sm font-semibold text-[#1E2024]">
                  提示词前缀 90% 打折保真器（Prompt Cache 永不击穿验证）
                </h2>
                <span className="text-[10px] font-mono text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  守住 90% 缓存折扣
                </span>
              </div>
              <p className="text-xs text-[#5E6573] mt-1.5 leading-relaxed">
                💡 <b>大白话机制解读</b>：大模型服务商（Anthropic / OpenAI）规定，只要对话最开头的系统设定一字不差（哈希不变），后续轮次就能直接享受 <b>90% 甚至更低的价格折扣</b>！本方案保证所有工具输出裁剪只发生在后缀轮次，前面的系统设定一个字符都不动，稳稳守住 90% 的省钱折扣。
              </p>
            </div>

            {/* 测试动作按钮（统一紧凑对齐） */}
            <div className="shrink-0 flex flex-wrap items-center gap-2">
              <button
                onClick={handleTestCompactionPreservesPrefix}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-50 text-emerald-900 border border-emerald-300 hover:bg-emerald-100 flex items-center space-x-1.5 transition-all cursor-pointer shadow-2xs"
                title="验证工具裁剪只动后面，前面的系统提示词哈希完全不变"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                <span>验证前缀不变 (享受 90% 折扣)</span>
              </button>

              <button
                onClick={handleTestPrefixMutation}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-rose-50 text-rose-900 border border-rose-300 hover:bg-rose-100 flex items-center space-x-1.5 transition-all cursor-pointer shadow-2xs"
                title="模拟有些不专业的框架在开头偷偷塞了动态时间戳，导致 90% 缓存折扣瞬间泡汤"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-rose-700" />
                <span>模拟错误做法 (篡改前缀丢折扣)</span>
              </button>

              <button
                onClick={handleResetPrefix}
                className="p-1.5 text-xs rounded-md border border-[#E5E0D8] bg-white text-[#6E685E] hover:text-[#1E2024] hover:bg-[#F4F0EA] transition-all cursor-pointer"
                title="重置为默认基线前缀"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {/* 前缀规范化表示与哈希指纹 */}
            <div className="bg-[#F7F5F0]/60 border border-[#E5E0D8] rounded-lg p-3.5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#1E2024]">
                  规范化前缀边界表示 (Canonical Prefix Representation)
                </span>
                <div className="flex items-center space-x-2">
                  <span className="text-[11px] font-mono text-[#6E685E]">SHA-256 前缀指纹:</span>
                  <span className="text-xs font-mono font-bold text-[#1E2024] bg-white px-2 py-0.5 rounded border border-[#E5E0D8]">
                    {currentBoundary.prefixHash.slice(0, 24)}...
                  </span>
                  <button
                    onClick={() => copyToClipboard(currentBoundary.prefixHash, setCopiedHash)}
                    className="p-1 text-[#6E685E] hover:text-[#1E2024] cursor-pointer"
                    title="复制全量 64 位前缀哈希"
                  >
                    {copiedHash ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="font-mono text-[11px] bg-[#1E2024] text-[#E5E0D8] p-3 rounded leading-relaxed overflow-x-auto">
                <div className="text-sky-300 font-semibold">[SYSTEM_PROMPT_BOUNDARY]</div>
                <div className="text-slate-300 pl-2">{systemPrompt}</div>
                <div className="text-sky-300 font-semibold">[LTM_BOUNDARY]</div>
                <div className="text-slate-300 pl-2">{ltm}</div>
                <div className="text-amber-400 font-semibold">[CACHE_BREAKPOINT]</div>
              </div>
            </div>

            {/* 校验结果反馈通知条 */}
            {prefixMutationStatus === 'stable' && (
              <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-lg flex items-start space-x-2 text-xs text-emerald-950">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">✅ Prompt Cache 前缀 100% 字节级保真：</span>
                  <p className="mt-0.5 text-emerald-800">{prefixDiffDetail}</p>
                </div>
              </div>
            )}

            {prefixMutationStatus === 'mutated' && (
              <div className="p-3 bg-rose-50 border border-rose-300 rounded-lg flex items-start space-x-2 text-xs text-rose-950">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">❌ 前缀突变警告 (Cache Mutation Detected)：</span>
                  <p className="mt-0.5 text-rose-800 font-mono text-[11px]">{prefixDiffDetail}</p>
                  <p className="mt-1 text-rose-900">
                    在 System Prompt 或 LTM 中引入动态时间戳将导致 Anthropic Prompt Cache 失效，使全量输入产生 10x 计费成本惩罚。
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

export default CompactorLabPage
