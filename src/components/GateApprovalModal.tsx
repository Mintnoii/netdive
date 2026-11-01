import React, { useState, useEffect, useCallback } from 'react'
import {
  ShieldAlert,
  Check,
  XCircle,
  Sparkles,
  Terminal,
  X,
  FileCode2,
} from 'lucide-react'
import type { GateDecision, GatePromptPayload } from '../types/telemetry'

export interface GateApprovalModalProps {
  payload: GatePromptPayload | null
  onResolve: (decision: GateDecision) => void
}

/**
 * 决策门禁审批模态窗 (Paper & Ink 风格)
 * 支持批准放行、拒绝拦截、热纠偏放行与全局键盘快捷键
 */
export const GateApprovalModal: React.FC<GateApprovalModalProps> = ({
  payload,
  onResolve,
}) => {
  const [steering, setSteering] = useState('')
  const [prevGateId, setPrevGateId] = useState(payload?.gateId)

  // 门禁切换时在渲染阶段重置纠偏输入框 (符合 React 19 最佳实践)
  if (payload?.gateId !== prevGateId) {
    setPrevGateId(payload?.gateId)
    setSteering('')
  }

  const handleApprove = useCallback(() => {
    if (!payload) return
    onResolve({
      action: 'approve',
    })
  }, [payload, onResolve])

  const handleModify = useCallback(() => {
    if (!payload) return
    const text = steering.trim()
    onResolve({
      action: 'modify',
      feedback: text,
      modifiedCommand: text,
    })
  }, [payload, steering, onResolve])

  const handleReject = useCallback(() => {
    if (!payload) return
    onResolve({
      action: 'reject',
      feedback: steering.trim() || '人类操作员拒绝放行',
    })
  }, [payload, steering, onResolve])

  // 键盘全局快捷键：Esc 拦截，Ctrl+Enter / Meta+Enter 提交放行
  useEffect(() => {
    if (!payload) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleReject()
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        if (steering.trim()) {
          handleModify()
        } else {
          handleApprove()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [payload, steering, handleReject, handleModify, handleApprove])

  if (!payload) return null

  const isCritical = payload.riskLevel === 'critical'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1E2024]/40 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-xl bg-[#FBF9F5] border border-[#E5E0D8] shadow-2xl overflow-hidden text-[#1E2024] font-sans flex flex-col">
        {/* 顶部标题区 */}
        <header className="px-5 py-3.5 border-b border-[#E5E0D8] bg-[#F4F0EA] flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div
              className={`p-1.5 rounded-lg border ${
                isCritical
                  ? 'bg-rose-100/80 border-rose-300 text-rose-700'
                  : 'bg-amber-100/80 border-amber-300 text-amber-800'
              }`}
            >
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-[#1E2024] leading-tight flex items-center space-x-2">
                <span>{payload.title}</span>
                <span
                  className={`text-[9px] font-mono px-1.5 py-0.5 rounded uppercase font-semibold border ${
                    isCritical
                      ? 'bg-rose-100 text-rose-800 border-rose-300'
                      : 'bg-amber-100 text-amber-800 border-amber-300'
                  }`}
                >
                  {payload.riskLevel} risk
                </span>
              </h3>
              <p className="text-[10px] text-[#8F887D] font-mono mt-0.5">
                ID: {payload.gateId} ·{' '}
                {payload.timestamp
                  ? new Date(payload.timestamp).toLocaleTimeString()
                  : ''}
              </p>
            </div>
          </div>

          <button
            onClick={handleReject}
            className="p-1 text-[#8F887D] hover:text-[#1E2024] rounded-md hover:bg-[#E5E0D8]/60 transition-colors cursor-pointer"
            title="关闭并拦截 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* 模态窗内容 */}
        <div className="p-5 space-y-4 text-xs overflow-y-auto max-h-[75vh]">
          {/* 说明阐述 */}
          <div className="text-[#5E6573] leading-relaxed bg-[#F4F0EA]/50 p-2.5 rounded-lg border border-[#E5E0D8]/60">
            {payload.proposedAction.explanation}
          </div>

          {/* 拟执行指令代码区 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-[#8F887D]">
              <span className="flex items-center space-x-1 uppercase tracking-wider">
                <Terminal className="w-3 h-3 text-[#1E2024]" />
                <span>拟执行命令 (Proposed Action)</span>
              </span>
            </div>
            <div className="p-3 rounded-lg bg-[#1E2024] text-[#FBF9F5] font-mono text-xs overflow-x-auto selection:bg-amber-400 selection:text-black shadow-inner">
              <code className="text-[#A5D6A7] font-semibold">$ </code>
              <code className="text-gray-100">{payload.proposedAction.command}</code>
            </div>
          </div>

          {/* Diff 变更差异查看器 (如有) */}
          {payload.proposedAction.diff && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-mono text-[#8F887D]">
                <span className="flex items-center space-x-1 uppercase tracking-wider">
                  <FileCode2 className="w-3 h-3 text-[#1E2024]" />
                  <span>代码变更差异 (Diff)</span>
                </span>
              </div>
              <pre className="p-3 rounded-lg bg-white border border-[#E5E0D8] font-mono text-[11px] text-[#1E2024] max-h-36 overflow-y-auto whitespace-pre leading-relaxed shadow-2xs">
                {payload.proposedAction.diff}
              </pre>
            </div>
          )}

          {/* 人类热纠偏指令输入区 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-medium text-[#1E2024]">
              <span className="flex items-center space-x-1">
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                <span>人类热纠偏指令 / 批示建议 (Human Steering)</span>
              </span>
              <span className="text-[10px] font-mono text-[#8F887D]">可选</span>
            </div>
            <textarea
              value={steering}
              onChange={(e) => setSteering(e.target.value)}
              placeholder="输入纠偏后的指令或批示意见 (例如修改 commit 参数或指定运行命令)..."
              rows={2}
              className="w-full rounded-lg border border-[#E5E0D8] bg-white p-2.5 text-xs text-[#1E2024] placeholder:text-[#8F887D] focus:border-[#1E2024] focus:ring-1 focus:ring-[#1E2024] outline-none font-mono resize-none transition-colors shadow-2xs"
            />
          </div>
        </div>

        {/* 底部动作操作区 */}
        <footer className="px-5 py-3.5 border-t border-[#E5E0D8] bg-[#F4F0EA] flex items-center justify-between">
          <button
            onClick={handleReject}
            className="px-3.5 py-1.5 text-xs font-medium rounded-md border border-rose-300 bg-white text-rose-700 hover:bg-rose-50 hover:border-rose-400 transition-colors cursor-pointer flex items-center space-x-1.5 shadow-2xs"
          >
            <XCircle className="w-3.5 h-3.5 text-rose-600" />
            <span>拒绝拦截 (Reject)</span>
            <kbd className="text-[9px] font-mono px-1 py-0.2 rounded bg-rose-100 text-rose-800 ml-1">
              Esc
            </kbd>
          </button>

          <div className="flex items-center space-x-2">
            {steering.trim() && (
              <button
                onClick={handleModify}
                className="px-3.5 py-1.5 text-xs font-medium rounded-md border border-amber-500 bg-amber-600 text-white hover:bg-amber-700 transition-colors cursor-pointer flex items-center space-x-1.5 shadow-xs"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-200" />
                <span>热纠偏放行 (Modify)</span>
              </button>
            )}

            <button
              onClick={handleApprove}
              className="px-4 py-1.5 text-xs font-medium rounded-md border border-[#1E2024] bg-[#1E2024] text-[#FBF9F5] hover:bg-[#34383F] transition-colors cursor-pointer flex items-center space-x-1.5 shadow-xs"
            >
              <Check className="w-3.5 h-3.5" />
              <span>批准放行 (Approve)</span>
              <kbd className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-white/20 text-white ml-1">
                Ctrl+↵
              </kbd>
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
