import React, { useState, useEffect, useRef } from 'react'
import type { Node } from '@xyflow/react'
import {
  Copy,
  Check,
  Search,
  RotateCcw,
  GitBranch,
} from 'lucide-react'
import type { ActiveSessionItem } from '../types/telemetry'
import {
  calculateContextMenuPosition,
  copyNodeReferenceToClipboard,
} from '../types/telemetry'
import type { AgentNodeData } from './AgentNode'

export interface NodeContextMenuProps {
  x: number
  y: number
  node: Node
  sessionMeta?: ActiveSessionItem
  onClose: () => void
  onInspect: (node: Node) => void
}

/**
 * NetDive 节点右键上下文菜单组件 (Paper & Ink 素雅手绘纸本质感设计)
 */
export const NodeContextMenu: React.FC<NodeContextMenuProps> = ({
  x,
  y,
  node,
  sessionMeta,
  onClose,
  onInspect,
}) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  // 视口翻转防溢出位置
  const pos = calculateContextMenuPosition(x, y)

  // 监听 Esc 键盘关闭、点击外部关闭与滚轮关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) {
        onClose()
      }
    }

    const handleWheel = () => {
      onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('wheel', handleWheel, { passive: true })

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('wheel', handleWheel)
    }
  }, [onClose])

  const handleCopyClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await copyNodeReferenceToClipboard({
      node,
      sessionId: sessionMeta?.id,
      sessionTitle: sessionMeta?.title,
      project: sessionMeta?.project,
    })
    setCopied(true)
    setTimeout(() => {
      setCopied(false)
      onClose()
    }, 1000)
  }

  const handleInspectClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onInspect(node)
    onClose()
  }

  const nodeData = (node?.data ?? {}) as Partial<AgentNodeData>
  const title = nodeData.title || node.id

  return (
    <div
      ref={menuRef}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 min-w-[210px] max-w-[250px] rounded-lg border border-[#D5CDBD] bg-[#FAF8F5]/98 text-[#1E2024] shadow-lg shadow-black/8 overflow-hidden text-xs select-none backdrop-blur-xs animate-in fade-in duration-100"
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
    >
      {/* 复制成功 Floating Toast 纸墨徽标 */}
      {copied && (
        <div className="absolute -top-8 left-0 right-0 mx-auto px-2.5 py-1 rounded bg-[#1E2024] text-[#FBF9F5] text-[11px] font-mono flex items-center justify-center space-x-1.5 shadow-md">
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span>已复制节点指纹引用</span>
        </div>
      )}

      {/* 节点指纹元信息标题头 */}
      <div className="px-3 py-1.5 border-b border-[#E5E0D8] bg-[#F4F0EA]/80 flex items-center justify-between">
        <div className="flex items-center space-x-1.5 min-w-0">
          <span className="w-2 h-2 rounded-full bg-[#1E2024] shrink-0" />
          <span className="font-mono text-[11px] font-semibold text-[#1E2024] truncate max-w-[130px]">
            {title}
          </span>
        </div>
        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#E5E0D8]/70 text-[#5E6573] shrink-0">
          {nodeData.gesture || 'node'}
        </span>
      </div>

      {/* 菜单项列表 */}
      <div className="py-1">
        {/* 1. 复制节点引用 */}
        <button
          onClick={handleCopyClick}
          className="w-full px-3 py-1.5 flex items-center justify-between text-left hover:bg-[#EAE4D9]/80 transition-colors cursor-pointer group"
        >
          <div className="flex items-center space-x-2 min-w-0">
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-[#5E6573] group-hover:text-[#1E2024] shrink-0" />
            )}
            <span className={copied ? 'text-emerald-700 font-medium' : 'text-[#1E2024]'}>
              {copied ? '已复制到剪贴板' : '复制节点引用'}
            </span>
          </div>
          <span className="text-[10px] font-mono text-[#8F887D] ml-2">Markdown</span>
        </button>

        {/* 2. 检视执行详情 */}
        <button
          onClick={handleInspectClick}
          className="w-full px-3 py-1.5 flex items-center justify-between text-left hover:bg-[#EAE4D9]/80 transition-colors cursor-pointer group"
        >
          <div className="flex items-center space-x-2 min-w-0">
            <Search className="w-3.5 h-3.5 text-[#5E6573] group-hover:text-[#1E2024] shrink-0" />
            <span className="text-[#1E2024]">检视执行详情</span>
          </div>
          <span className="text-[10px] font-mono text-[#8F887D] ml-2">Inspector</span>
        </button>

        {/* 分割线 */}
        <div className="my-1 border-t border-[#E5E0D8]" />

        {/* 3. 预留禁用项：从此处重放 */}
        <div
          className="w-full px-3 py-1.5 flex items-center justify-between text-left opacity-45 cursor-not-allowed"
          title="节点重放引擎规划中"
        >
          <div className="flex items-center space-x-2 min-w-0">
            <RotateCcw className="w-3.5 h-3.5 text-[#8F887D] shrink-0" />
            <span className="text-[#8F887D]">从此处重放</span>
          </div>
          <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-[#EAE4D9] text-[#8F887D]">
            即将推出
          </span>
        </div>

        {/* 4. 预留禁用项：派生自愈分支 */}
        <div
          className="w-full px-3 py-1.5 flex items-center justify-between text-left opacity-45 cursor-not-allowed"
          title="多分支派生引擎规划中"
        >
          <div className="flex items-center space-x-2 min-w-0">
            <GitBranch className="w-3.5 h-3.5 text-[#8F887D] shrink-0" />
            <span className="text-[#8F887D]">派生自愈分支</span>
          </div>
          <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-[#EAE4D9] text-[#8F887D]">
            即将推出
          </span>
        </div>
      </div>
    </div>
  )
}
