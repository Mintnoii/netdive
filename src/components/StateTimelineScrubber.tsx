import React, { useState, useEffect, useRef } from 'react'
import {
  Play,
  Pause,
  RotateCcw,
  SkipBack,
  SkipForward,
  FastForward,
  Layers,
} from 'lucide-react'

export interface StateTimelineScrubberProps {
  currentStep: number
  totalSteps: number
  isPlaying: boolean
  playbackSpeed: number
  isFoldingEnabled: boolean
  isFoldingVisible?: boolean
  unitLabel?: string
  onTogglePlay: () => void
  onStepBack: () => void
  onStepForward: () => void
  onSpeedChange: () => void
  onToggleFolding: () => void
  onSeekStep: (step: number) => void
  onResetCanvas?: () => void
}

/**
 * 统一状态因果时间轴 (Unified Causal Timeline Scrubber)
 * 具备防抖互锁保护：拖拽滑块时立即暂停播放，并使用 rAF 节流，杜绝主线程卡死
 */
export const StateTimelineScrubber: React.FC<StateTimelineScrubberProps> = ({
  currentStep,
  totalSteps,
  isPlaying,
  playbackSpeed,
  isFoldingEnabled,
  isFoldingVisible = true,
  unitLabel = '步',
  onTogglePlay,
  onStepBack,
  onStepForward,
  onSpeedChange,
  onToggleFolding,
  onSeekStep,
  onResetCanvas,
}) => {
  // 乐观本地滑块位置状态，拖拽时实现 0 延迟，松手后提交最终帧
  const [localStep, setLocalStep] = useState(currentStep)
  const isDraggingRef = useRef(false)
  const rafRef = useRef<number | null>(null)

  // 外部步数变化且未处于拖拽时，同步到本地
  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalStep(currentStep)
    }
  }, [currentStep])

  const handlePointerDown = () => {
    isDraggingRef.current = true
    // 如果正在播放，按下滑块时立刻暂停，杜绝定时器与拖拽竞态死锁
    if (isPlaying) {
      onTogglePlay()
    }
  }

  const handlePointerUp = () => {
    isDraggingRef.current = false
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    onSeekStep(localStep)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVal = Number(e.target.value)
    setLocalStep(nextVal)

    // 使用 requestAnimationFrame 节流向父级提交，防止每 16ms 数十次高频重排卡死
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
    }
    rafRef.current = requestAnimationFrame(() => {
      onSeekStep(nextVal)
      rafRef.current = null
    })
  }

  return (
    <footer className="h-12 border-t border-[#E5E0D8] bg-[#FAF8F5]/95 backdrop-blur-xs px-4 flex items-center shrink-0 text-xs font-sans select-none z-10 shadow-xs gap-3">
      {/* 左侧固定控制区 (shrink-0 紧凑排列) */}
      <div className="flex items-center space-x-1.5 shrink-0">
        {/* 1. 播放 / 暂停 */}
        <button
          onClick={onTogglePlay}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md border flex items-center space-x-1.5 transition-all cursor-pointer shadow-xs ${
            isPlaying
              ? 'bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200'
              : 'bg-[#1E2024] text-[#FBF9F5] border-[#1E2024] hover:bg-[#34383F]'
          }`}
          title={isPlaying ? '暂停回放' : '开始按时序回放'}
        >
          {isPlaying ? (
            <>
              <Pause className="w-3.5 h-3.5 fill-current text-amber-800" />
              <span>暂停</span>
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>时光回放</span>
            </>
          )}
        </button>

        {/* 2. 折叠 / 展开同构连续调用 (仅全量平铺视图有效) */}
        {isFoldingVisible && (
          <button
            onClick={onToggleFolding}
            className={`w-[88px] py-1.5 text-xs font-medium rounded-md border flex items-center justify-center space-x-1.5 transition-colors cursor-pointer shrink-0 ${
              isFoldingEnabled
                ? 'bg-[#EAE4D9] text-[#1E2024] border-[#C5BDAF]'
                : 'bg-white text-[#8F887D] border-[#E5E0D8] hover:text-[#1E2024]'
            }`}
            title="智能折叠连续同构工具调用 (例如连续只读同一文件折叠为 xN)"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>{isFoldingEnabled ? '折叠同构' : '展开同构'}</span>
          </button>
        )}

        {/* 3. 重置 */}
        {onResetCanvas && (
          <button
            onClick={onResetCanvas}
            className="p-1.5 rounded-md border border-[#E5E0D8] bg-white text-[#5E6573] hover:text-[#1E2024] hover:bg-[#F4F0EA] transition-colors cursor-pointer"
            title="重置画布为初始状态"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}

        {/* 4. 上一步 */}
        <button
          onClick={onStepBack}
          disabled={currentStep <= 1}
          className={`p-1.5 rounded-md border transition-colors cursor-pointer ${
            currentStep <= 1
              ? 'border-[#EAE6DF] bg-[#F7F5F0] text-[#B5AFA4] cursor-not-allowed'
              : 'border-[#E5E0D8] bg-white text-[#5E6573] hover:text-[#1E2024] hover:bg-[#F4F0EA]'
          }`}
          title="单步后退"
        >
          <SkipBack className="w-3.5 h-3.5" />
        </button>

        {/* 5. 倍速 */}
        <button
          onClick={onSpeedChange}
          className="px-2 py-1 text-xs font-mono font-medium rounded-md border border-[#E5E0D8] bg-white text-[#5E6573] hover:text-[#1E2024] hover:bg-[#F4F0EA] cursor-pointer transition-colors flex items-center space-x-0.5"
          title="切换回放倍速 (1x / 2x / 4x)"
        >
          <FastForward className="w-3 h-3 text-[#8F887D]" />
          <span>{playbackSpeed}x</span>
        </button>

        {/* 6. 下一步 */}
        <button
          onClick={onStepForward}
          disabled={currentStep >= totalSteps}
          className={`p-1.5 rounded-md border transition-colors cursor-pointer ${
            currentStep >= totalSteps
              ? 'border-[#EAE6DF] bg-[#F7F5F0] text-[#B5AFA4] cursor-not-allowed'
              : 'border-[#E5E0D8] bg-white text-[#5E6573] hover:text-[#1E2024] hover:bg-[#F4F0EA]'
          }`}
          title="单步前进"
        >
          <SkipForward className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 右侧 flex-1 填满的宽阔滑块轴区 */}
      <div className="flex-1 flex items-center space-x-3 min-w-0">
        <input
          type="range"
          min={1}
          max={Math.max(1, totalSteps)}
          value={localStep}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onChange={handleChange}
          className="w-full h-1.5 bg-[#E5E0D8] rounded-lg appearance-none cursor-pointer accent-[#1E2024] focus:outline-none"
        />
        <span className="font-mono text-xs text-[#5C5549] shrink-0 min-w-[70px] text-right">
          <strong className="text-[#1E2024]">{localStep}</strong> / {totalSteps} {unitLabel}
        </span>
      </div>
    </footer>
  )
}
