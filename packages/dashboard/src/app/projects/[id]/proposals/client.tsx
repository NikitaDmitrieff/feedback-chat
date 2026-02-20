'use client'

import { useCallback, useState } from 'react'
import { Lightbulb } from 'lucide-react'
import { ProposalSlideOver } from '@/components/proposal-slide-over'
import type { Proposal } from '@/lib/types'

type Props = {
  projectId: string
  githubRepo: string | null
  proposals: Proposal[]
}

const PRIORITY_DOT: Record<string, string> = {
  high: 'bg-red-400',
  medium: 'bg-amber-400',
  low: 'bg-emerald-400',
}

const STATUS_GROUPS = {
  pending: ['draft'],
  active: ['approved', 'implementing'],
  completed: ['done', 'rejected'],
} as const

function avgScore(scores: Proposal['scores']): number {
  const vals = [scores.impact, scores.feasibility, scores.novelty, scores.alignment].filter(
    (v): v is number => v != null
  )
  if (vals.length === 0) return 0
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

export function ProposalsPageClient({ projectId, githubRepo, proposals: initialProposals }: Props) {
  const [proposals, setProposals] = useState(initialProposals)
  const [selected, setSelected] = useState<Proposal | null>(null)

  const pending = proposals.filter(p => STATUS_GROUPS.pending.includes(p.status as 'draft'))
  const active = proposals.filter(p => STATUS_GROUPS.active.includes(p.status as 'approved' | 'implementing'))
  const completed = proposals.filter(p => STATUS_GROUPS.completed.includes(p.status as 'done' | 'rejected')).slice(0, 10)

  const handleUpdate = useCallback((updated: Proposal) => {
    setProposals(prev => prev.map(p => p.id === updated.id ? updated : p))
    setSelected(null)
  }, [])

  return (
    <>
      {/* Pending Review */}
      <Section title="Pending Review" count={pending.length} emptyText="No proposals awaiting review.">
        {pending
          .sort((a, b) => {
            const priorityOrder = { high: 0, medium: 1, low: 2 }
            return (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1)
          })
          .map(p => (
            <ProposalCard key={p.id} proposal={p} onClick={() => setSelected(p)} />
          ))}
      </Section>

      {/* In Progress */}
      {active.length > 0 && (
        <Section title="In Progress" count={active.length}>
          {active.map(p => (
            <ProposalCard key={p.id} proposal={p} onClick={() => setSelected(p)} />
          ))}
        </Section>
      )}

      {/* Recently Completed */}
      {completed.length > 0 && (
        <Section title="Recently Completed" count={completed.length}>
          {completed.map(p => (
            <ProposalCard key={p.id} proposal={p} onClick={() => setSelected(p)} />
          ))}
        </Section>
      )}

      {/* Empty state */}
      {proposals.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Lightbulb className="mb-4 h-8 w-8 text-muted" />
          <p className="text-sm text-muted">No proposals yet.</p>
          <p className="mt-1 text-xs text-dim">The strategist generates proposals from your feedback data.</p>
        </div>
      )}

      {selected && (
        <ProposalSlideOver
          proposal={selected}
          projectId={projectId}
          githubRepo={githubRepo}
          onClose={() => setSelected(null)}
          onUpdate={handleUpdate}
        />
      )}
    </>
  )
}

function Section({
  title,
  count,
  emptyText,
  children,
}: {
  title: string
  count: number
  emptyText?: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-8">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-sm font-medium text-fg">{title}</h2>
        <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] tabular-nums text-muted">
          {count}
        </span>
      </div>
      {count === 0 && emptyText ? (
        <p className="py-6 text-center text-sm text-muted">{emptyText}</p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </div>
  )
}

function ProposalCard({ proposal, onClick }: { proposal: Proposal; onClick: () => void }) {
  const score = avgScore(proposal.scores)
  const statusColors: Record<string, string> = {
    draft: 'text-muted',
    approved: 'text-accent',
    implementing: 'text-amber-400',
    done: 'text-success',
    rejected: 'text-red-400',
  }

  return (
    <button
      onClick={onClick}
      className="glass-card flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-white/[0.06]"
    >
      <div className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[proposal.priority] ?? 'bg-gray-400'}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{proposal.title}</p>
        <p className="mt-0.5 truncate text-xs text-dim">{proposal.rationale.slice(0, 80)}</p>
      </div>
      {score > 0 && (
        <div className="flex shrink-0 items-center gap-2">
          <div className="h-1 w-12 overflow-hidden rounded-full bg-surface">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${score * 100}%` }}
            />
          </div>
          <span className="text-[11px] tabular-nums text-muted">{(score * 100).toFixed(0)}</span>
        </div>
      )}
      {proposal.status !== 'draft' && (
        <span className={`shrink-0 text-[11px] font-medium ${statusColors[proposal.status] ?? 'text-muted'}`}>
          {proposal.status}
        </span>
      )}
    </button>
  )
}
