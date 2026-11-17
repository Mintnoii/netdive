import { useState, useEffect, useCallback, useRef } from 'react'
import { DEFAULT_BRIDGE_HTTP_URL } from '../config/bridge'
import { httpJson } from '../utils/http'

export interface WalStats {
  totalEntries: number
  totalRawChars: number
  totalCompactedChars: number
  totalReclaimedChars: number
}

interface WalApiResponse {
  ok?: boolean
  stats?: {
    totalEntries?: number
    totalRawChars?: number
    totalCompactedChars?: number
    totalReclaimedChars?: number
  }
}

export function useWalStats(enabled: boolean): {
  stats: WalStats | null
  isOffline: boolean
  isLoading: boolean
  refresh: () => void
} {
  const [stats, setStats] = useState<WalStats | null>(null)
  const [isOffline, setIsOffline] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  const fetchWal = useCallback(async () => {
    if (!enabled) {
      return
    }

    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller

    setIsLoading(true)

    const [err, body] = await httpJson<WalApiResponse>(`${DEFAULT_BRIDGE_HTTP_URL}/api/wal`, {
      signal: controller.signal,
    })

    if (controller.signal.aborted) {
      return
    }

    const stats = body?.ok ? body.stats : undefined

    if (err || !stats) {
      setIsOffline(true)
      setStats(null)
      setIsLoading(false)
      return
    }

    const { totalEntries, totalRawChars, totalCompactedChars, totalReclaimedChars } = stats

    if (
      typeof totalEntries === 'number' &&
      typeof totalRawChars === 'number' &&
      typeof totalCompactedChars === 'number' &&
      typeof totalReclaimedChars === 'number'
    ) {
      setStats({ totalEntries, totalRawChars, totalCompactedChars, totalReclaimedChars })
      setIsOffline(false)
    } else {
      setIsOffline(true)
      setStats(null)
    }

    setIsLoading(false)
  }, [enabled])

  useEffect(() => {
    if (enabled) {
      fetchWal()
    } else {
      setStats(null)
      setIsOffline(false)
      setIsLoading(false)
    }

    return () => {
      abortControllerRef.current?.abort()
    }
  }, [enabled, fetchWal])

  return {
    stats,
    isOffline,
    isLoading,
    refresh: fetchWal,
  }
}
