# Loop Page Revamp Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace 5 fragmented dashboard pages with a single Loop page showing the feedback-to-shipping cycle.

**Architecture:** Server component fetches all data (themes, proposals, runs, jobs) in parallel, passes to a client component that renders three vertical sections: "What's coming in" (themes), "Needs your attention" (actionable proposals), "What shipped" (completed proposals). Each proposal card has a step-dots lifecycle indicator. Detail views open as slide-overs.

**Tech Stack:** Next.js 15 (App Router), React 19, Supabase, Tailwind CSS, Lucide icons, existing glass-card design system.

---

### Task 1: Create the StepDots component

**Files:**
- Create: `packages/dashboard/src/components/step-dots.tsx`

**Step 1: Create StepDots component**

This is a pure presentational component. It takes a proposal status and an optional pipeline run, and renders 5 dots connected by lines.

```tsx
'use client'

import type { Proposal, PipelineRun } from '@/lib/types'

type StepDotState = 'done' | 'active' | 'pending'

const STAGES = ['Draft', 'Approved', 'Building', 'Preview', 'Shipped'] as const

function computeSteps(proposal: Proposal, run?: PipelineRun | null): { states: StepDotState[]; label: string } {
  if (proposal.status === 'rejected') {
    return { states: ['done', 'pending', 'pending', 'pending', 'pending'], label: 'Rejected' }
  }
  if (proposal.status === 'done') {
    return { states: ['done', 'done', 'done', 'done', 'done'], label: 'Shipped' }
  }
  if (proposal.status === 'draft') {
    return { states: ['active', 'pending', 'pending', 'pending', 'pending'], label: 'Draft' }
  }

  // approved or implementing — check run status
  if (!run) {
    return { states: ['done', 'active', 'pending', 'pending', 'pending'], label: 'Approved' }
  }

  const stage = run.stage
  if (stage === 'queued' || stage === 'running') {
    return { states: ['done', 'done', 'active', 'pending', 'pending'], label: 'Building' }
  }
  if (stage === 'validating') {
    return { states: ['done', 'done', 'done', 'active', 'pending'], label: 'Validating' }
  }
  if (stage === 'preview_ready') {
    return { states: ['done', 'done', 'done', 'active', 'pending'], label: 'Preview ready' }
  }
  if (run.result === 'success' || stage === 'deployed') {
    return { states: ['done', 'done', 'done', 'done', 'done'], label: 'Shipped' }
  }
  if (run.result === 'failed') {
    return { states: ['done', 'done', 'done', 'pending', 'pending'], label: 'Failed' }
  }

  // Default: building
  return { states: ['done', 'done', 'active', 'pending', 'pending'], label: stage }
}

export function StepDots({ proposal, run }: { proposal: Proposal; run?: PipelineRun | null }) {
  const { states, label } = computeSteps(proposal, run)

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-0.5">
        {states.map((state, i) => (
          <div key={i} className="flex items-center">
            <div
              className={`h-1.5 w-1.5 rounded-full ${
                state === 'done'
                  ? 'bg-success'
                  : state === 'active'
                    ? 'bg-accent animate-pulse'
                    : 'bg-white/[0.1]'
              }`}
            />
            {i < states.length - 1 && (
              <div
                className={`h-px w-2 ${
                  state === 'done' && states[i + 1] !== 'pending'
                    ? 'bg-success'
                    : 'bg-white/[0.1]'
                }`}
              />
            )}
          </div>
        ))}
      </div>
      <span className="text-[11px] text-muted">{label}</span>
    </div>
  )
}
```

**Step 2: Verify it compiles**

Run: `npm run build --workspace=packages/dashboard 2>&1 | grep "Compiled"`
Expected: `✓ Compiled successfully`

**Step 3: Commit**

```bash
git add packages/dashboard/src/components/step-dots.tsx
git commit -m "feat: add StepDots lifecycle indicator component"
```

---

### Task 2: Create the LoopPageClient component

**Files:**
- Create: `packages/dashboard/src/components/loop-page-client.tsx`

**Step 1: Create the LoopPageClient component**

This is the main client component for the Loop page. It receives all data from the server and renders three sections. It reuses `ProposalSlideOver` for detail views and `FeedbackList`/`FeedbackSlideOver` for theme click-through.

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Lightbulb, Clock, CheckCircle2, XCircle, ExternalLink, Eye } from 'lucide-react'
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
          <div className="slide-over-backdrop" onClick={() => setSelectedTheme(null)} />
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
            <div className="flex-1 overflow-y-auto">
              <FeedbackList
                projectId={projectId}
                githubRepo={githubRepo}
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
```

**Step 2: Verify it compiles**

Run: `npm run build --workspace=packages/dashboard 2>&1 | grep "Compiled"`
Expected: `✓ Compiled successfully`

**Step 3: Commit**

```bash
git add packages/dashboard/src/components/loop-page-client.tsx
git commit -m "feat: add LoopPageClient component with three-section layout"
```

---

### Task 3: Rewrite the project overview page as the Loop page

**Files:**
- Modify: `packages/dashboard/src/app/projects/[id]/page.tsx` (full rewrite)

**Step 1: Rewrite page.tsx as the Loop page server component**

Replace the entire overview page with the new Loop page that fetches themes, proposals, runs, and jobs in parallel and passes them to `LoopPageClient`.

```tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LoopPageClient } from '@/components/loop-page-client'
import { Github } from 'lucide-react'
import { DeleteProjectButton } from '@/components/delete-project-button'
import type { Proposal, FeedbackTheme } from '@/lib/types'

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, github_repo, github_installation_id')
    .eq('id', id)
    .single()

  if (!project) notFound()

  const [
    { data: proposals },
    { data: themes },
    { data: runs },
    { data: jobs },
  ] = await Promise.all([
    supabase
      .from('proposals')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('feedback_themes')
      .select('*')
      .eq('project_id', id)
      .order('message_count', { ascending: false }),
    supabase
      .from('pipeline_runs')
      .select('id, github_issue_number, github_pr_number, stage, triggered_by, started_at, completed_at, result')
      .eq('project_id', id)
      .order('started_at', { ascending: false })
      .limit(50),
    supabase
      .from('job_queue')
      .select('id, project_id, job_type, status, github_issue_number')
      .eq('project_id', id)
      .in('status', ['pending', 'processing']),
  ])

  return (
    <div className="mx-auto max-w-4xl px-6 pt-10 pb-16">
      {/* Project header */}
      <div className="mb-10 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-medium text-fg">{project.name}</h1>
          {project.github_repo && (
            <div className="mt-1.5 flex items-center gap-2 text-xs text-muted">
              <Github className="h-3 w-3" />
              {project.github_repo}
            </div>
          )}
        </div>
        <DeleteProjectButton projectId={project.id} />
      </div>

      <LoopPageClient
        projectId={project.id}
        projectName={project.name}
        githubRepo={project.github_repo}
        proposals={(proposals ?? []) as Proposal[]}
        themes={(themes ?? []) as FeedbackTheme[]}
        runs={runs ?? []}
        activeJobs={jobs ?? []}
      />
    </div>
  )
}
```

**Step 2: Verify it compiles**

Run: `npm run build --workspace=packages/dashboard 2>&1 | grep "Compiled"`
Expected: `✓ Compiled successfully`

**Step 3: Commit**

```bash
git add "packages/dashboard/src/app/projects/[id]/page.tsx"
git commit -m "feat: rewrite overview page as Loop page"
```

---

### Task 4: Update sidebar navigation

**Files:**
- Modify: `packages/dashboard/src/components/sidebar.tsx`

**Step 1: Remove Human and Minions links, rename Overview to Loop**

Edit `sidebar.tsx`:
- Remove the "Human" link block (lines 71-86)
- Remove the "Minions" link block (lines 88-103)
- Change "Overview" label to "Loop" (line 67)
- Change the icon from `LayoutDashboard` to `Lightbulb` (import it, replace usage)
- Update the active-state detection: highlight on any `/projects/[id]` path that isn't `/settings`

The sidebar should now have: Projects | Loop | Settings | Sign out

```tsx
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FolderKanban, RefreshCw, Settings, LogOut } from 'lucide-react'

export function Sidebar() {
  const pathname = usePathname()
  const [expanded, setExpanded] = useState(false)
  const collapseTimer = useRef<ReturnType<typeof setTimeout>>(null)

  const projectMatch = pathname.match(/\/projects\/([^/]+)/)
  const projectId = projectMatch && projectMatch[1] !== 'new' ? projectMatch[1] : null

  const isLoopActive = !!projectId && !pathname.includes('/settings') && !pathname.includes('/runs/') && !pathname.includes('/testers/')

  const expand = useCallback(() => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current)
    setExpanded(true)
  }, [])

  const scheduleCollapse = useCallback(() => {
    collapseTimer.current = setTimeout(() => setExpanded(false), 300)
  }, [])

  useEffect(() => {
    return () => {
      if (collapseTimer.current) clearTimeout(collapseTimer.current)
    }
  }, [])

  return (
    <aside
      onMouseEnter={expand}
      onMouseLeave={scheduleCollapse}
      className={`fixed left-3 top-1/2 z-40 -translate-y-1/2 overflow-hidden rounded-[24px] border border-white/[0.08] bg-white/[0.04] p-1.5 shadow-[0_8px_40px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.06),inset_0_-1px_0_rgba(255,255,255,0.02)] backdrop-blur-2xl transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
        expanded ? 'w-[172px]' : 'w-[52px]'
      }`}
    >
      {/* Projects */}
      <Link
        href="/projects"
        className={`flex items-center rounded-[16px] transition-colors ${
          pathname === '/projects' || pathname === '/'
            ? 'bg-white/[0.08] text-fg'
            : 'text-muted hover:bg-white/[0.06] hover:text-fg'
        } ${expanded ? 'gap-2.5 px-2 py-2' : 'justify-center p-1.5'}`}
      >
        <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center">
          <FolderKanban className="h-[15px] w-[15px]" />
        </div>
        {expanded && <span className="truncate text-xs">Projects</span>}
      </Link>

      {/* Loop (contextual — only when inside a project) */}
      {projectId && (
        <Link
          href={`/projects/${projectId}`}
          className={`flex items-center rounded-[16px] transition-colors ${
            isLoopActive
              ? 'bg-white/[0.08] text-fg'
              : 'text-muted hover:bg-white/[0.06] hover:text-fg'
          } ${expanded ? 'gap-2.5 px-2 py-2' : 'justify-center p-1.5'}`}
        >
          <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center">
            <RefreshCw className="h-[15px] w-[15px]" />
          </div>
          {expanded && <span className="truncate text-xs">Loop</span>}
        </Link>
      )}

      {/* Settings (contextual — only when inside a project) */}
      {projectId && (
        <Link
          href={`/projects/${projectId}/settings`}
          className={`flex items-center rounded-[16px] transition-colors ${
            pathname.includes('/settings')
              ? 'bg-white/[0.08] text-fg'
              : 'text-muted hover:bg-white/[0.06] hover:text-fg'
          } ${expanded ? 'gap-2.5 px-2 py-2' : 'justify-center p-1.5'}`}
        >
          <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center">
            <Settings className="h-[15px] w-[15px]" />
          </div>
          {expanded && <span className="truncate text-xs">Settings</span>}
        </Link>
      )}

      {/* Divider */}
      <div className={`my-1 h-px bg-white/[0.06] ${expanded ? 'mx-2' : 'mx-auto w-5'}`} />

      {/* Sign out */}
      <form action="/auth/signout" method="post">
        <button
          type="submit"
          className={`flex w-full items-center rounded-[16px] text-muted transition-colors hover:bg-white/[0.06] hover:text-fg ${
            expanded ? 'gap-2.5 px-2 py-2' : 'justify-center p-1.5'
          }`}
        >
          <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center">
            <LogOut className="h-[14px] w-[14px]" />
          </div>
          {expanded && <span className="truncate text-xs">Sign out</span>}
        </button>
      </form>
    </aside>
  )
}
```

**Step 2: Verify it compiles**

Run: `npm run build --workspace=packages/dashboard 2>&1 | grep "Compiled"`
Expected: `✓ Compiled successfully`

**Step 3: Commit**

```bash
git add packages/dashboard/src/components/sidebar.tsx
git commit -m "feat: simplify sidebar to Loop + Settings"
```

---

### Task 5: Add redirects for old pages

**Files:**
- Modify: `packages/dashboard/src/app/projects/[id]/feedback/page.tsx`
- Verify: `packages/dashboard/src/app/projects/[id]/minions/page.tsx` (already has content, will be unused once sidebar stops linking)
- Verify: `packages/dashboard/src/app/projects/[id]/pipeline/page.tsx` (already redirects)
- Verify: `packages/dashboard/src/app/projects/[id]/proposals/page.tsx` (already redirects)

**Step 1: Update feedback page to redirect**

Replace `packages/dashboard/src/app/projects/[id]/feedback/page.tsx`:

```tsx
import { redirect } from 'next/navigation'

export default async function FeedbackPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/projects/${id}`)
}
```

**Step 2: Update minions page to redirect**

Replace `packages/dashboard/src/app/projects/[id]/minions/page.tsx`:

```tsx
import { redirect } from 'next/navigation'

export default async function MinionsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/projects/${id}`)
}
```

**Step 3: Update pipeline redirect target**

Replace `packages/dashboard/src/app/projects/[id]/pipeline/page.tsx`:

```tsx
import { redirect } from 'next/navigation'

export default async function PipelinePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/projects/${id}`)
}
```

**Step 4: Update proposals redirect target**

Replace `packages/dashboard/src/app/projects/[id]/proposals/page.tsx`:

```tsx
import { redirect } from 'next/navigation'

export default async function ProposalsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/projects/${id}`)
}
```

**Step 5: Verify it compiles**

Run: `npm run build --workspace=packages/dashboard 2>&1 | grep "Compiled"`
Expected: `✓ Compiled successfully`

**Step 6: Commit**

```bash
git add "packages/dashboard/src/app/projects/[id]/feedback/page.tsx" \
       "packages/dashboard/src/app/projects/[id]/minions/page.tsx" \
       "packages/dashboard/src/app/projects/[id]/pipeline/page.tsx" \
       "packages/dashboard/src/app/projects/[id]/proposals/page.tsx"
git commit -m "feat: redirect old pages (feedback, minions, pipeline, proposals) to Loop"
```

---

### Task 6: Check FeedbackList compatibility with LoopPageClient

**Files:**
- Inspect: `packages/dashboard/src/components/feedback-list.tsx`

**Step 1: Check FeedbackList props**

Read `packages/dashboard/src/components/feedback-list.tsx` and verify it accepts:
- `projectId: string`
- `githubRepo: string | null`
- `themes: FeedbackTheme[]`
- `initialThemeFilter?: string` (the theme ID to pre-filter by)
- `onSelectSession: (session: FeedbackSession) => void`

If the props don't match (e.g., `initialThemeFilter` doesn't exist, or `onSelectSession` is named differently), update the `LoopPageClient` component to match the actual prop names.

**Step 2: Check FeedbackSlideOver props**

Read `packages/dashboard/src/components/feedback-slide-over.tsx` and verify it accepts:
- `session: FeedbackSession`
- `projectId: string`
- `githubRepo: string | null`
- `onClose: () => void`
- `onStatusChange: (sessionId: string, status: string) => void`

If props don't match, update `LoopPageClient`.

**Step 3: Build and fix any type errors**

Run: `npm run build --workspace=packages/dashboard 2>&1 | grep -E "error|Compiled"`
Fix any type mismatches found.

**Step 4: Commit if changes were needed**

```bash
git add packages/dashboard/src/components/loop-page-client.tsx
git commit -m "fix: align LoopPageClient with actual FeedbackList/SlideOver props"
```

---

### Task 7: Full build + visual verification

**Step 1: Full build**

Run: `npm run build --workspace=packages/dashboard 2>&1; echo "EXIT: $?"`
Expected: EXIT: 0

**Step 2: Dev server test**

Run: `npm run dev --workspace=packages/dashboard`

Verify:
1. Navigate to `/projects/[id]` — see the three-section Loop page
2. Theme chips appear in "What's coming in" — click one to see sessions slide-over
3. Draft proposals appear in "Needs attention" with step dots showing "Draft"
4. Completed proposals appear in "Shipped" with filled dots
5. Click any proposal → slide-over opens with detail + deployment preview
6. Sidebar shows only: Projects, Loop, Settings, Sign out
7. Old URLs (`/feedback`, `/minions`, `/pipeline`, `/proposals`) redirect to the Loop page

**Step 3: Commit all remaining fixes**

```bash
git add -A
git commit -m "fix: visual polish and compatibility fixes for Loop page"
```
