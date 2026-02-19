'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, Sparkles } from 'lucide-react'

type DigestData = {
  digest: string
  stats: { total: number; needsAttention: number; resolved: number }
  topThemes: { id: string; name: string; count: number }[]
}

export function DigestCard({ projectId }: { projectId: string }) {
  const [period, setPeriod] = useState<'day' | 'week'>('day')
  const [data, setData] = useState<DigestData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchDigest = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/feedback/${projectId}/digest?period=${period}`)
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [projectId, period])

  useEffect(() => {
    fetchDigest()
  }, [fetchDigest])

  if (!loading && (!data || data.stats.total === 0)) return null

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-fg">
          <Sparkles className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold">AI Digest</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-surface p-0.5">
            <button
              onClick={() => setPeriod('day')}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                period === 'day' ? 'bg-elevated text-fg' : 'text-muted hover:text-fg'
              }`}
            >
              Day
            </button>
            <button
              onClick={() => setPeriod('week')}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                period === 'week' ? 'bg-elevated text-fg' : 'text-muted hover:text-fg'
              }`}
            >
              Week
            </button>
          </div>
          <button
            onClick={fetchDigest}
            disabled={loading}
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface hover:text-fg disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="skeleton h-14 rounded-lg" />
          <div className="skeleton h-14 rounded-lg" />
          <div className="skeleton h-14 rounded-lg" />
        </div>
      ) : data ? (
        <>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="stat-card">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted">
                Conversations
              </span>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-fg">{data.stats.total}</p>
            </div>
            <div className="stat-card">
              <span className="text-[11px] font-medium uppercase tracking-wider text-amber-400">
                Needs Attention
              </span>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-400">
                {data.stats.needsAttention}
              </p>
            </div>
            <div className="stat-card">
              <span className="text-[11px] font-medium uppercase tracking-wider text-success">
                Resolved
              </span>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-success">
                {data.stats.resolved}
              </p>
            </div>
          </div>

          <div className="mt-4">
            {data.stats.total === 0 ? (
              <p className="text-sm text-muted">No feedback this {period}.</p>
            ) : (
              <p className="text-sm leading-relaxed text-dim">{data.digest}</p>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}
