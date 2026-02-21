'use client'

import { useState } from 'react'
import { CheckCircle2, XCircle, Eye } from 'lucide-react'
import { StepDots } from '@/components/step-dots'
import { ProposalSlideOver } from '@/components/proposal-slide-over'
import { FeedbackList } from '@/components/feedback-list'
import { FeedbackSlideOver } from '@/components/feedback-slide-over'
import type { Proposal, PipelineRun, FeedbackTheme, FeedbackSession } from '@/lib/types'

type Run = {
  id: string
  github_issue_number: number
  github_pr_number: number | null
  stage: string
  triggered_by: string | null
  started_at: string
  completed_at: string | null
  result: string | null
}

type Job = {
  id: string
  project_id: string
  job_type: string
  status: string
  github_issue_number: number
}

type Props = {
  projectId: string
  projectName: string
  githubRepo: string | null
  proposals: Proposal[]
  themes: FeedbackTheme[]
  runs: Run[]
  activeJobs: Job[]
}

const PRIORITY_DOT: Record<string, string> = {
  high: 'bg-red-400',
  medium: 'bg-amber-400',
  low: 'bg-emerald-400',
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function LoopPageClient({ projectId, projectName, githubRepo, proposals: initialProposals, themes, runs, activeJobs }: Props) {
  const [proposals, setProposals] = useState(initialProposals)
  const [selected, setSelected] = useState<Proposal | null>(null)
  const [selectedTheme, setSelectedTheme] = useState<FeedbackTheme | null>(null)
  const [selectedSession, setSelectedSession] = useState<FeedbackSession | null>(null)

  // Build map: issue_number → run
  const runByIssue = new Map<number, Run>()
  for (const r of runs) {
    if (!runByIssue.has(r.github_issue_number)) {
      runByIssue.set(r.github_issue_number, r)
    }
  }

  // Build map: theme_id → theme (for source labels on proposal cards)
  const themeById = new Map(themes.map(t => [t.id, t]))

  // Categorize proposals
  const needsAttention = proposals.filter(p => {
    if (p.status === 'draft') return true
    if (p.status === 'approved' || p.status === 'implementing') {
      const run = p.github_issue_number ? runByIssue.get(p.github_issue_number) : null
      if (run?.stage === 'preview_ready') return true
    }
    return false
  })

  const shipped = proposals.filter(p => ['done', 'rejected'].includes(p.status)).slice(0, 15)

  function handleUpdate(updated: Proposal) {
    setProposals(prev => prev.map(p => p.id === updated.id ? updated : p))
    setSelected(null)
  }

  function getSourceThemes(p: Proposal): FeedbackTheme[] {
    if (!p.source_theme_ids?.length) return []
    return p.source_theme_ids.map(id => themeById.get(id)).filter((t): t is FeedbackTheme => !!t)
  }

  return (
    <>
      {/* Section 1: What's coming in */}
      <section className="mb-10">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted">
          What&apos;s coming in
        </h2>
        {themes.length === 0 ? (
          <p className="py-6 text-center text-xs text-dim">
            No feedback themes yet. Feedback from testers will appear here as themes.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {themes.map(theme => (
              <button
                key={theme.id}
                onClick={() => setSelectedTheme(theme)}
                className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-sm transition-colors hover:bg-white/[0.08]"
              >
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: theme.color }} />
                <span className="text-fg">{theme.name}</span>
                <span className="text-xs tabular-nums text-muted">{theme.message_count}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Section 2: Needs your attention */}
      <section className="mb-10">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted">
            Needs your attention
          </h2>
          {needsAttention.length > 0 && (
            <span className="rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-accent">
              {needsAttention.length}
            </span>
          )}
        </div>
        {needsAttention.length === 0 ? (
          <div className="glass-card py-8 text-center">
            <CheckCircle2 className="mx-auto mb-2 h-5 w-5 text-success/50" />
            <p className="text-xs text-dim">Nothing needs your attention right now.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {needsAttention.map(p => {
              const run = p.github_issue_number ? runByIssue.get(p.github_issue_number) : null
              const sourceThemes = getSourceThemes(p)
              return (
                <button
                  key={p.id}
                  onClick={() => setSelected(p)}
                  className="glass-card w-full p-4 text-left transition-colors hover:bg-white/[0.06]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[p.priority] ?? 'bg-gray-400'}`} />
                        <p className="truncate text-sm font-medium text-fg">{p.title}</p>
                      </div>
                      <div className="mt-2">
                        <StepDots proposal={p} run={run as PipelineRun | null} />
                      </div>
                      {sourceThemes.length > 0 && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <span className="text-[11px] text-dim">from</span>
                          {sourceThemes.slice(0, 2).map(t => (
                            <span key={t.id} className="flex items-center gap-1 text-[11px] text-muted">
                              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: t.color }} />
                              {t.name} ({t.message_count})
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {run?.stage === 'preview_ready' && (
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent/20 px-2 py-1 text-[11px] font-medium text-accent">
                        <Eye className="h-3 w-3" />
                        Preview ready
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* Section 3: Shipped */}
      <section>
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted">
          Shipped
        </h2>
        {shipped.length === 0 ? (
          <p className="py-6 text-center text-xs text-dim">
            No shipped proposals yet. Approved proposals will appear here once implemented.
          </p>
        ) : (
          <div className="space-y-2">
            {shipped.map(p => {
              const run = p.github_issue_number ? runByIssue.get(p.github_issue_number) : null
              const sourceThemes = getSourceThemes(p)
              return (
                <button
                  key={p.id}
                  onClick={() => setSelected(p)}
                  className="glass-card w-full p-4 text-left transition-colors hover:bg-white/[0.06]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {p.status === 'rejected' ? (
                          <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400/60" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                        )}
                        <p className={`truncate text-sm font-medium ${p.status === 'rejected' ? 'text-muted' : 'text-fg'}`}>
                          {p.title}
                        </p>
                      </div>
                      <div className="mt-2">
                        <StepDots proposal={p} run={run as PipelineRun | null} />
                      </div>
                      <div className="mt-2 flex items-center gap-3 text-[11px] text-dim">
                        {sourceThemes.length > 0 && (
                          <span className="flex items-center gap-1">
                            from
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: sourceThemes[0].color }} />
                            {sourceThemes[0].name} ({sourceThemes[0].message_count})
                          </span>
                        )}
                        {run?.github_pr_number && githubRepo && (
                          <span>PR #{run.github_pr_number}</span>
                        )}
                        {p.completed_at && <span>{timeAgo(p.completed_at)}</span>}
                        {p.status === 'rejected' && p.reviewed_at && <span>{timeAgo(p.reviewed_at)}</span>}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* Proposal slide-over */}
      {selected && (
        <ProposalSlideOver
          proposal={selected}
          projectId={projectId}
          githubRepo={githubRepo}
          onClose={() => setSelected(null)}
          onUpdate={handleUpdate}
          activeRunId={
            selected.github_issue_number
              ? runByIssue.get(selected.github_issue_number)?.id ?? null
              : null
          }
        />
      )}

      {/* Theme sessions slide-over */}
      {selectedTheme && !selectedSession && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setSelectedTheme(null)} />
          <div className="fixed top-0 right-0 z-50 flex h-screen w-full max-w-[480px] flex-col border-l border-edge bg-bg/95 backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-edge px-6 py-4">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: selectedTheme.color }} />
                <h3 className="text-sm font-medium text-fg">{selectedTheme.name}</h3>
                <span className="text-xs text-muted">{selectedTheme.message_count} sessions</span>
              </div>
              <button
                onClick={() => setSelectedTheme(null)}
                className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-fg"
              >
                <XCircle className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <FeedbackList
                projectId={projectId}
                themes={themes}
                initialThemeFilter={selectedTheme.id}
                onSelectSession={setSelectedSession}
              />
            </div>
          </div>
        </>
      )}

      {/* Feedback session slide-over */}
      {selectedSession && (
        <FeedbackSlideOver
          session={selectedSession}
          themes={themes}
          projectId={projectId}
          githubRepo={githubRepo}
          onClose={() => {
            setSelectedSession(null)
          }}
          onStatusChange={() => {}}
        />
      )}
    </>
  )
}
