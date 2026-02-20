'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Lightbulb,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  GitBranch,
  ExternalLink,
  ArrowRight,
} from 'lucide-react'
import { ProposalSlideOver } from '@/components/proposal-slide-over'
import { LiveLogTail } from '@/components/live-log-tail'
import type { Proposal } from '@/lib/types'

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
  githubRepo: string | null
  proposals: Proposal[]
  runs: Run[]
  activeJobs: Job[]
}

const PRIORITY_DOT: Record<string, string> = {
  high: 'bg-red-400',
  medium: 'bg-amber-400',
  low: 'bg-emerald-400',
}

function avgScore(scores: Proposal['scores']): number {
  const vals = [scores.impact, scores.feasibility, scores.novelty, scores.alignment].filter(
    (v): v is number => v != null
  )
  if (vals.length === 0) return 0
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function elapsed(start: string, end?: string | null): string {
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function StageBadge({ stage, result }: { stage: string; result: string | null }) {
  if (result === 'failed') {
    return <span className="flex items-center gap-1 text-[11px] font-medium text-red-400"><XCircle className="h-3 w-3" /> Failed</span>
  }
  if (result === 'success' || stage === 'deployed') {
    return <span className="flex items-center gap-1 text-[11px] font-medium text-success"><CheckCircle2 className="h-3 w-3" /> Deployed</span>
  }
  if (stage === 'running') {
    return <span className="flex items-center gap-1 text-[11px] font-medium text-accent"><Loader2 className="h-3 w-3 animate-spin" /> Running</span>
  }
  if (stage === 'validating') {
    return <span className="flex items-center gap-1 text-[11px] font-medium text-amber-400"><Loader2 className="h-3 w-3 animate-spin" /> Validating</span>
  }
  if (stage === 'queued') {
    return <span className="flex items-center gap-1 text-[11px] font-medium text-muted"><Clock className="h-3 w-3" /> Queued</span>
  }
  return <span className="text-[11px] font-medium text-muted">{stage}</span>
}

export function PipelinePageClient({ projectId, githubRepo, proposals: initialProposals, runs, activeJobs }: Props) {
  const [proposals, setProposals] = useState(initialProposals)
  const [selected, setSelected] = useState<Proposal | null>(null)
  const [expandedRun, setExpandedRun] = useState<string | null>(null)

  // Build a map: issue_number → run (for linking proposals to runs)
  const runByIssue = new Map<number, Run>()
  for (const r of runs) {
    if (!runByIssue.has(r.github_issue_number)) {
      runByIssue.set(r.github_issue_number, r)
    }
  }

  // Categorize proposals
  const draftProposals = proposals.filter(p => p.status === 'draft')
  const activeProposals = proposals.filter(p => ['approved', 'implementing'].includes(p.status))
  const completedProposals = proposals.filter(p => ['done', 'rejected'].includes(p.status)).slice(0, 10)

  // In-progress runs (that aren't linked to proposals)
  const proposalIssueNumbers = new Set(proposals.filter(p => p.github_issue_number).map(p => p.github_issue_number!))
  const activeRuns = runs.filter(r =>
    !r.result && !proposalIssueNumbers.has(r.github_issue_number)
  )

  // Completed runs not linked to proposals
  const completedRuns = runs.filter(r =>
    r.result && !proposalIssueNumbers.has(r.github_issue_number)
  ).slice(0, 10)

  // Stats
  const totalRuns = runs.length
  const successRuns = runs.filter(r => r.result === 'success').length
  const activeCount = activeProposals.length + activeRuns.length + activeJobs.filter(j => j.status === 'processing').length

  function handleUpdate(updated: Proposal) {
    setProposals(prev => prev.map(p => p.id === updated.id ? updated : p))
    setSelected(null)
  }

  return (
    <>
      {/* Stats bar */}
      <div className="mb-8 grid grid-cols-4 gap-3">
        <div className="glass-card flex items-center gap-3 p-4">
          <Lightbulb className="h-4 w-4 text-accent" />
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Pending</p>
            <p className="text-lg font-semibold tabular-nums text-fg">{draftProposals.length}</p>
          </div>
        </div>
        <div className="glass-card flex items-center gap-3 p-4">
          <Loader2 className={`h-4 w-4 ${activeCount > 0 ? 'animate-spin text-accent' : 'text-muted'}`} />
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Active</p>
            <p className="text-lg font-semibold tabular-nums text-fg">{activeCount}</p>
          </div>
        </div>
        <div className="glass-card flex items-center gap-3 p-4">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Success Rate</p>
            <p className="text-lg font-semibold tabular-nums text-fg">
              {totalRuns > 0 ? `${Math.round((successRuns / totalRuns) * 100)}%` : '—'}
            </p>
          </div>
        </div>
        <div className="glass-card flex items-center gap-3 p-4">
          <Clock className="h-4 w-4 text-muted" />
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Total Runs</p>
            <p className="text-lg font-semibold tabular-nums text-fg">{totalRuns}</p>
          </div>
        </div>
      </div>

      {/* Three-lane pipeline */}
      <div className="grid grid-cols-3 gap-4">
        {/* Lane 1: Proposals */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-accent" />
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted">Proposals</h2>
            <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] tabular-nums text-muted">
              {draftProposals.length}
            </span>
          </div>
          <div className="space-y-2">
            {draftProposals.length === 0 && (
              <p className="py-8 text-center text-xs text-dim">No pending proposals</p>
            )}
            {draftProposals.map(p => (
              <button
                key={p.id}
                onClick={() => setSelected(p)}
                className="glass-card w-full p-3 text-left transition-colors hover:bg-white/[0.06]"
              >
                <div className="flex items-center gap-2">
                  <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[p.priority] ?? 'bg-gray-400'}`} />
                  <p className="truncate text-sm font-medium text-fg">{p.title}</p>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${avgScore(p.scores) * 100}%` }} />
                  </div>
                  <span className="text-[10px] tabular-nums text-muted">{(avgScore(p.scores) * 100).toFixed(0)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Lane 2: In Progress */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted">In Progress</h2>
            <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] tabular-nums text-muted">
              {activeProposals.length + activeRuns.length}
            </span>
          </div>
          <div className="space-y-2">
            {activeProposals.length === 0 && activeRuns.length === 0 && (
              <p className="py-8 text-center text-xs text-dim">Nothing running</p>
            )}

            {/* Active proposals */}
            {activeProposals.map(p => {
              const run = p.github_issue_number ? runByIssue.get(p.github_issue_number) : null
              return (
                <div key={p.id} className="glass-card p-3">
                  <div className="flex items-center justify-between">
                    <p className="truncate text-sm font-medium text-fg">{p.title}</p>
                    {run && <StageBadge stage={run.stage} result={run.result} />}
                  </div>
                  {p.branch_name && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-dim">
                      <GitBranch className="h-3 w-3" />
                      {p.branch_name}
                    </div>
                  )}
                  {run && (
                    <div className="mt-1.5 text-[11px] text-muted">
                      {elapsed(run.started_at, run.completed_at)} elapsed
                    </div>
                  )}
                  {/* Expandable log tail */}
                  {run && !run.result && (
                    <div className="mt-2">
                      {expandedRun === run.id ? (
                        <>
                          <button
                            onClick={() => setExpandedRun(null)}
                            className="mb-2 text-[11px] text-accent hover:text-fg"
                          >
                            Hide logs
                          </button>
                          <LiveLogTail projectId={projectId} runId={run.id} compact maxLines={20} />
                        </>
                      ) : (
                        <button
                          onClick={() => setExpandedRun(run.id)}
                          className="text-[11px] text-accent hover:text-fg"
                        >
                          Show live logs
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Active runs (non-proposal) */}
            {activeRuns.map(r => (
              <Link
                key={r.id}
                href={`/projects/${projectId}/runs/${r.id}`}
                className="glass-card block p-3 transition-colors hover:bg-white/[0.06]"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-fg">Issue #{r.github_issue_number}</p>
                  <StageBadge stage={r.stage} result={r.result} />
                </div>
                <div className="mt-1.5 text-[11px] text-muted">
                  {elapsed(r.started_at)} elapsed
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Lane 3: Completed */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-success" />
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted">Completed</h2>
            <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] tabular-nums text-muted">
              {completedProposals.length + completedRuns.length}
            </span>
          </div>
          <div className="space-y-2">
            {completedProposals.length === 0 && completedRuns.length === 0 && (
              <p className="py-8 text-center text-xs text-dim">No completed items yet</p>
            )}

            {/* Completed proposals */}
            {completedProposals.map(p => {
              const run = p.github_issue_number ? runByIssue.get(p.github_issue_number) : null
              return (
                <div key={p.id} className="glass-card p-3">
                  <div className="flex items-center justify-between">
                    <p className="truncate text-sm font-medium text-fg">{p.title}</p>
                    {p.status === 'rejected' ? (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-red-400">
                        <XCircle className="h-3 w-3" /> Rejected
                      </span>
                    ) : run ? (
                      <StageBadge stage={run.stage} result={run.result} />
                    ) : (
                      <span className="text-[11px] font-medium text-success">{p.status}</span>
                    )}
                  </div>
                  {run?.github_pr_number && githubRepo && (
                    <a
                      href={`https://github.com/${githubRepo}/pull/${run.github_pr_number}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1.5 flex items-center gap-1.5 text-[11px] text-accent hover:text-fg"
                    >
                      PR #{run.github_pr_number}
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                </div>
              )
            })}

            {/* Completed runs (non-proposal) */}
            {completedRuns.map(r => (
              <Link
                key={r.id}
                href={`/projects/${projectId}/runs/${r.id}`}
                className="glass-card block p-3 transition-colors hover:bg-white/[0.06]"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-fg">Issue #{r.github_issue_number}</p>
                  <StageBadge stage={r.stage} result={r.result} />
                </div>
                {r.github_pr_number && githubRepo && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-accent">
                    PR #{r.github_pr_number}
                    <ExternalLink className="h-2.5 w-2.5" />
                  </div>
                )}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* View all runs link */}
      <div className="mt-6 text-center">
        <Link
          href={`/projects/${projectId}`}
          className="inline-flex items-center gap-1.5 text-xs text-accent transition-colors hover:text-fg"
        >
          View all runs
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

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
    </>
  )
}
