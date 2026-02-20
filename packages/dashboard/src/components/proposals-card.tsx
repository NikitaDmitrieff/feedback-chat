'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Lightbulb, Loader2 } from 'lucide-react'
import type { Proposal } from '@/lib/types'

const PRIORITY_DOT: Record<string, string> = {
  high: 'bg-red-400',
  medium: 'bg-amber-400',
  low: 'bg-emerald-400',
}

export function ProposalsCard({ projectId }: { projectId: string }) {
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loading, setLoading] = useState(true)

  const fetchProposals = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/proposals/${projectId}?status=draft`)
      if (res.ok) {
        const json = await res.json()
        setProposals(json.proposals ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchProposals()
  }, [fetchProposals])

  if (!loading && proposals.length === 0) return null

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-fg">
          <Lightbulb className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold">Proposals</span>
        </div>
        <Link
          href={`/projects/${projectId}/proposals`}
          className="flex items-center gap-1 text-[11px] text-accent transition-colors hover:text-fg"
        >
          View all
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted" />
        </div>
      ) : (
        <>
          <p className="mt-2 text-xs text-muted">
            {proposals.length} proposal{proposals.length !== 1 ? 's' : ''} awaiting review
          </p>
          <div className="mt-3 space-y-1.5">
            {proposals.slice(0, 3).map(p => (
              <Link
                key={p.id}
                href={`/projects/${projectId}/proposals`}
                className="flex items-center gap-3 rounded-lg bg-surface p-2.5 transition-colors hover:bg-surface-hover"
              >
                <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[p.priority] ?? 'bg-gray-400'}`} />
                <span className="truncate text-sm text-fg">{p.title}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
