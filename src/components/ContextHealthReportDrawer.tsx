import React, { useState } from 'react'
import { Check, ClipboardCopy, X } from 'lucide-react'
import { sift, tryit } from 'radash'
import type { ContextPartKind } from '../types/telemetry'
import { formatTokens } from '../types/telemetry'
import { PART_LABELS } from './ContextPromptMap'
import {
  toMarkdownReport,
  type ContextHealthReport,
  type ReportSeverity,
} from '../services/contextHealthReport'

export interface ContextHealthReportDrawerProps {
  isOpen: boolean
  onClose: () => void
  report: ContextHealthReport
  sessionTitle?: string
}

const SEVERITY_BADGES: Record<ReportSeverity, { label: string; cls: string }> = {
  high: { label: '高', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  medium: { label: '中', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  low: { label: '低', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  info: { label: '提示', cls: 'bg-slate-50 text-slate-600 border-slate-200' },
}

const PART_ORDER: ContextPartKind[] = [
  'system',
  'tools',
  'skills',
  'memory',
  'files',
  'results',
  'chat',
]

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold tracking-wide text-[#8F887D] uppercase mb-2">
      {children}
    </h3>
  )
}

export const ContextHealthReportDrawer: React.FC<ContextHealthReportDrawerProps> = ({
  isOpen,
  onClose,
  report,
  sessionTitle,
}) => {
  const [copied, setCopied] = useState(false)

  if (!isOpen) return null

  const onCopy = async () => {
    const [err] = await tryit(() =>
      navigator.clipboard.writeText(toMarkdownReport(report))
    )()
    if (err) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const parts = sift(
    PART_ORDER.map((kind) => report.parts.find((part) => part.kind === kind))
  ).filter((part) => part.tokens > 0)

  return (
    <div className="fixed right-0 top-11 bottom-0 w-[520px] max-w-[92vw] z-50 bg-[#FBF9F5] border-l border-[#E5E0D8] shadow-2xl flex flex-col">
      <div className="h-12 px-4 border-b border-[#E5E0D8] flex items-center justify-between shrink-0">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[#1E2024]">复盘诊断报告</div>
          <div className="text-[10px] text-[#8F887D] truncate max-w-[320px]">
            {sessionTitle || '当前会话'}
          </div>
        </div>
        <div className="flex items-center space-x-1.5">
          <button
            onClick={onCopy}
            title="复制 Markdown 诊断报告"
            className={`px-2 py-1 rounded border text-[10px] flex items-center space-x-1 cursor-pointer ${
              copied
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-white text-[#5C5549] border-[#E5E0D8] hover:bg-[#F4F0EA]'
            }`}
          >
            {copied ? <Check className="w-3 h-3" /> : <ClipboardCopy className="w-3 h-3" />}
            <span>{copied ? '已复制' : '复制报告'}</span>
          </button>
          <button
            onClick={onClose}
            title="关闭"
            className="p-1 rounded text-[#8F887D] hover:bg-[#F4F0EA] hover:text-[#1E2024] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        <section>
          <SectionTitle>会话概览</SectionTitle>
          <div className="rounded-lg border border-[#E5E0D8] bg-white p-3 grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-[10px] text-[#8F887D]">峰值水位</div>
              <div className="font-semibold font-mono">
                {formatTokens(report.overview.peakTokens)} / {formatTokens(report.overview.window)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[#8F887D]">占用与余量</div>
              <div className="font-semibold font-mono">
                {report.overview.utilizationPercent}% · {formatTokens(report.overview.headroomTokens)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[#8F887D]">事件 / 回合</div>
              <div className="font-mono">
                {report.overview.eventCount} / {report.overview.turnCount}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[#8F887D]">数据来源</div>
              <div className="font-mono">{report.overview.provenance}</div>
            </div>
          </div>
        </section>

        <section>
          <SectionTitle>上下文构成</SectionTitle>
          <div className="space-y-1.5">
            {parts.map((part) => (
              <div key={part.kind} className="flex items-center text-xs space-x-2">
                <span className="w-24 shrink-0 text-[#5C5549]">{PART_LABELS[part.kind]}</span>
                <div className="flex-1 h-1.5 rounded-full bg-[#EAE4D9] overflow-hidden">
                  <div className="h-full bg-[#1E2024]" style={{ width: `${Math.min(100, part.percent)}%` }} />
                </div>
                <span className="w-20 text-right font-mono text-[#5C5549]">
                  {part.percent}% · {formatTokens(part.tokens)}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle>压缩机会</SectionTitle>
          <div className="text-xs text-[#5C5549]">
            扫描 {report.compaction.scannedCount} 项，命中 {report.compaction.hitCount} 项，预计回收{' '}
            {formatTokens(report.compaction.totalReclaimedChars)} 字符。
          </div>
          <div className="mt-2 space-y-1">
            {report.compaction.topOpportunities.slice(0, 3).map((opp) => (
              <div key={opp.nodeId} className="text-[11px] font-mono text-[#8F887D] truncate">
                {opp.nodeId} · {opp.toolName} · 回收 {opp.reclaimedChars}
              </div>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle>前缀稳定性</SectionTitle>
          <div className="text-xs text-[#5C5549]">
            状态 {report.prefix.status}，快照哈希 {report.prefix.hashCount} 个。
          </div>
        </section>

        <section>
          <SectionTitle>失败与门禁</SectionTitle>
          <div className="text-xs text-[#5C5549]">
            失败 {report.failures.total} 个，门禁 {report.gates.length} 次。
          </div>
          {report.failures.groups.slice(0, 3).map((item) => (
            <div key={item.rule} className="mt-1 text-[11px] font-mono text-[#8F887D] truncate">
              {item.rule} ×{item.count} · {item.nodeIds.slice(0, 2).join(', ')}
            </div>
          ))}
        </section>

        <section>
          <SectionTitle>建议清单</SectionTitle>
          <div className="space-y-2">
            {report.suggestions.map((suggestion) => {
              const badge = SEVERITY_BADGES[suggestion.severity]
              return (
                <div key={suggestion.id} className="rounded-lg border border-[#E5E0D8] bg-white p-3">
                  <div className="flex items-start space-x-2">
                    <span className={`px-1.5 py-0.5 rounded border text-[10px] shrink-0 ${badge.cls}`}>
                      {badge.label}
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[#1E2024]">{suggestion.title}</div>
                      <div className="mt-1 text-[11px] text-[#5C5549] leading-relaxed">
                        {suggestion.detail}
                      </div>
                      <div className="mt-1 text-[11px] text-[#3D3831] leading-relaxed">
                        动作 {suggestion.action}
                      </div>
                      <div className="mt-1.5 text-[10px] font-mono text-[#8F887D] truncate">
                        证据 {suggestion.evidence.map((e) => e.nodeId || e.value).filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
