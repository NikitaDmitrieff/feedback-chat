'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Lightbulb, Loader2, Sparkles } from 'lucide-react'
import { triggerStrategize } from '@/app/projects/[id]/proposals/actions'
import type { Proposal } from '@/lib/types'

const PRIORITY_DOT: Record<string, string> = {
  high: 'bg-red-400',
  medium: 'bg-amber-400',
  low: 'bg-emerald-400',
}

export function ProposalsCard({ projectId }: { projectId: string }) {
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loading, setLoading] = useState(true)
  const [triggering, setTriggering] = useState(false)

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

  async function handleTrigger() {
    setTriggering(true)
    try {
      await triggerStrategize(projectId)
    } finally {
      setTriggering(false)
    }
  }

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-fg">
          <Lightbulb className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold">Proposals</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-muted transition-colors hover:bg-surface hover:text-fg disabled:opacity-50"
          >
            {triggering ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            Generate
          </button>
          <Link
            href={`/projects/${projectId}/proposals`}
            className="flex items-center gap-1 text-[11px] text-accent transition-colors hover:text-fg"
          >
            View all
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted" />
        </div>
      ) : proposals.length === 0 ? (
        <p className="mt-3 text-xs text-muted">
          No proposals yet. Click Generate to analyze feedback.
        </p>
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
