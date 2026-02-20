'use client'

import { useEffect, useState } from 'react'
import { Check, Edit3, Loader2, X, ExternalLink, GitBranch } from 'lucide-react'
import type { Proposal } from '@/lib/types'
import { LiveLogTail } from './live-log-tail'

type Props = {
  proposal: Proposal
  projectId: string
  githubRepo: string | null
  onClose: () => void
  onUpdate: (updated: Proposal) => void
  /** If the proposal has an active pipeline run, pass its ID for live log tailing */
  activeRunId?: string | null
}

const PRIORITY_LABEL: Record<string, { label: string; color: string }> = {
  high: { label: 'High', color: 'text-red-400 bg-red-400/10' },
  medium: { label: 'Medium', color: 'text-amber-400 bg-amber-400/10' },
  low: { label: 'Low', color: 'text-emerald-400 bg-emerald-400/10' },
}

const SCORE_LABELS = [
  { key: 'impact' as const, label: 'Impact' },
  { key: 'feasibility' as const, label: 'Feasibility' },
  { key: 'novelty' as const, label: 'Novelty' },
  { key: 'alignment' as const, label: 'Alignment' },
]

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

export function ProposalSlideOver({ proposal, projectId, githubRepo, onClose, onUpdate, activeRunId }: Props) {
  const [editing, setEditing] = useState(false)
  const [editedSpec, setEditedSpec] = useState(proposal.spec)
  const [userNotes, setUserNotes] = useState(proposal.user_notes || '')
  const [rejectReason, setRejectReason] = useState('')
  const [showReject, setShowReject] = useState(false)
  const [loading, setLoading] = useState(false)
  const [branchName, setBranchName] = useState(
    proposal.branch_name || `proposals/${slugify(proposal.title)}`
  )

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  async function handleAction(action: 'approve' | 'reject') {
    setLoading(true)
    try {
      const res = await fetch(`/api/proposals/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: proposal.id,
          action,
          userNotes: action === 'approve' ? userNotes || undefined : undefined,
          modifiedSpec: action === 'approve' && editing ? editedSpec : undefined,
          branchName: action === 'approve' ? branchName || undefined : undefined,
          rejectReason: action === 'reject' ? rejectReason || undefined : undefined,
        }),
      })

      if (res.ok) {
        const json = await res.json()
        onUpdate({
          ...proposal,
          status: action === 'approve' ? 'approved' : 'rejected',
          reviewed_at: new Date().toISOString(),
          spec: editing ? editedSpec : proposal.spec,
          user_notes: userNotes || null,
          reject_reason: action === 'reject' ? rejectReason || null : null,
          github_issue_number: json.github_issue_number ?? proposal.github_issue_number,
        })
      }
    } finally {
      setLoading(false)
    }
  }

  const priority = PRIORITY_LABEL[proposal.priority] ?? PRIORITY_LABEL.medium

  return (
    <>
      <div className="slide-over-backdrop" onClick={onClose} />

      <div className="fixed top-0 right-0 z-50 flex h-screen w-full max-w-[480px] flex-col border-l border-edge bg-bg/95 backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-edge px-6 py-4">
          <div className="flex items-center gap-3">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${priority.color}`}>
              {priority.label}
            </span>
            <span className="text-xs text-muted">{proposal.status}</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <h2 className="mb-4 text-base font-medium text-fg">{proposal.title}</h2>

          {/* Scores */}
          <div className="mb-5 grid grid-cols-2 gap-3">
            {SCORE_LABELS.map(({ key, label }) => {
              const val = proposal.scores[key]
              return (
                <div key={key} className="rounded-lg bg-surface p-3">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted">
                    {label}
                  </span>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${(val ?? 0) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs tabular-nums text-fg">
                      {val != null ? (val * 100).toFixed(0) : '—'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Rationale */}
          <div className="mb-5">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
              Rationale
            </h3>
            <p className="text-sm leading-relaxed text-fg">{proposal.rationale}</p>
          </div>

          {/* Spec */}
          <div className="mb-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted">Spec</h3>
              {proposal.status === 'draft' && (
                <button
                  onClick={() => setEditing(!editing)}
                  className="flex items-center gap-1 text-[11px] text-accent transition-colors hover:text-fg"
                >
                  <Edit3 className="h-3 w-3" />
                  {editing ? 'Preview' : 'Edit'}
                </button>
              )}
            </div>
            {editing ? (
              <textarea
                value={editedSpec}
                onChange={e => setEditedSpec(e.target.value)}
                className="h-48 w-full rounded-lg bg-surface p-3 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
              />
            ) : (
              <div className="rounded-lg bg-surface p-3">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">
                  {editing ? editedSpec : proposal.spec}
                </p>
              </div>
            )}
          </div>

          {/* Branch picker (draft only) */}
          {proposal.status === 'draft' && (
            <div className="mb-5">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
                Branch
              </h3>
              <div className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2.5">
                <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted" />
                <input
                  type="text"
                  value={branchName}
                  onChange={e => setBranchName(e.target.value)}
                  placeholder="proposals/feature-name"
                  className="flex-1 bg-transparent text-sm text-fg placeholder:text-muted focus:outline-none"
                />
              </div>
              <p className="mt-1 text-[11px] text-dim">Branch where the agent will push changes</p>
            </div>
          )}

          {/* GitHub issue link */}
          {proposal.github_issue_number && githubRepo && (
            <div className="mb-5">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
                Issue
              </h3>
              <a
                href={`https://github.com/${githubRepo}/issues/${proposal.github_issue_number}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2.5 text-sm text-accent transition-colors hover:bg-surface-hover"
              >
                Issue #{proposal.github_issue_number}
                <ExternalLink className="ml-auto h-3 w-3 text-muted" />
              </a>
            </div>
          )}

          {/* Live progress tracker (approved proposals with active runs) */}
          {proposal.status === 'approved' && activeRunId && (
            <div className="mb-5">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
                Agent Progress
              </h3>
              <LiveLogTail projectId={projectId} runId={activeRunId} />
            </div>
          )}

          {/* User notes */}
          {proposal.status === 'draft' && (
            <div className="mb-5">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
                Your Notes
              </h3>
              <textarea
                value={userNotes}
                onChange={e => setUserNotes(e.target.value)}
                placeholder="Add implementation guidance..."
                className="h-20 w-full rounded-lg bg-surface p-3 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          )}

          {/* Reject reason */}
          {showReject && (
            <div className="mb-5">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
                Rejection Reason
              </h3>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="Why is this proposal not suitable?"
                className="h-20 w-full rounded-lg bg-surface p-3 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          )}
        </div>

        {/* Footer actions */}
        {proposal.status === 'draft' && (
          <div className="flex items-center gap-2 border-t border-edge px-6 py-4">
            <button
              onClick={() => handleAction('approve')}
              disabled={loading}
              className="flex h-9 items-center gap-2 rounded-xl bg-success/20 px-4 text-sm font-medium text-success transition-colors hover:bg-success/30 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {editing ? 'Save & Approve' : 'Approve'}
            </button>
            {!showReject ? (
              <button
                onClick={() => setShowReject(true)}
                className="flex h-9 items-center gap-2 rounded-xl bg-surface px-4 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-fg"
              >
                <X className="h-4 w-4" />
                Reject
              </button>
            ) : (
              <button
                onClick={() => handleAction('reject')}
                disabled={loading}
                className="flex h-9 items-center gap-2 rounded-xl bg-red-400/20 px-4 text-sm font-medium text-red-400 transition-colors hover:bg-red-400/30 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                Confirm Reject
              </button>
            )}
          </div>
        )}
      </div>
    </>
  )
}
