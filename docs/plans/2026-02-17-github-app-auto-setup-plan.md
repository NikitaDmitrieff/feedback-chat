# GitHub App Auto-Setup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users create a project on the dashboard, install a GitHub App, click "Set up my repo," and get a PR with the fully configured feedback widget — no manual steps except merging the PR and adding two env vars.

**Architecture:** A GitHub App replaces user-managed PATs and manual webhooks. The dashboard handles App installation and event routing. The existing Railway worker (`packages/agent`) gains a `setup` job type that clones the repo, runs Claude Code to generate setup files, creates a PR, and creates labels. The worker uses GitHub App installation tokens instead of personal access tokens for GitHub App projects, while remaining backward-compatible with legacy PAT-based projects.

**Tech Stack:** Next.js 15 (App Router), Supabase (`feedback_chat` schema), `@octokit/app` (GitHub App JWT + installation tokens), existing Railway worker (`packages/agent`), Claude Code CLI.

**Design doc:** `docs/plans/2026-02-16-one-click-auto-setup-design.md` (reference — some details superseded by this plan)

---

## Conventions

Before each task, read these files to understand project patterns:

- `CLAUDE.md` — project-wide conventions
- `packages/dashboard/src/lib/supabase/server.ts` — server Supabase client (uses `feedback_chat` schema, cookie-based auth)
- `packages/dashboard/src/app/api/webhook/[projectId]/route.ts` — admin Supabase client pattern (service-role key, bypasses RLS), HMAC verification, job enqueue pattern
- `packages/dashboard/src/app/projects/[id]/actions.ts` — server action pattern (`'use server'`, uses `createClient()`)
- `packages/dashboard/src/components/setup-checklist.tsx` — existing onboarding UI (will be kept as manual fallback)
- `packages/agent/src/managed-worker.ts` — worker polling loop, per-job credential/config fetching
- `packages/agent/src/worker.ts` — job execution: clone → Claude → validate → PR
- `packages/agent/src/github.ts` — GitHub REST API helpers with retry

**Key patterns:**
- All Supabase clients use `{ db: { schema: 'feedback_chat' } }`
- Admin client (webhooks, worker): `createClient(URL, SERVICE_ROLE_KEY, { db: { schema: 'feedback_chat' } })`
- Server client (user-scoped): `import { createClient } from '@/lib/supabase/server'`
- Next.js 15 async params: `const { id } = await params`
- Worker is ESM (`"type": "module"`) — imports use `.js` extensions
- Styling: `glass-card`, `stat-card`, `input-field` CSS classes
- Icons: `lucide-react`

---

## Task 1: Supabase Migration — GitHub App Columns + Setup Job Type

**Files:**
- Create: `packages/dashboard/supabase/migrations/00005_github_app_setup.sql`

**Context:** The `projects` table needs new columns for GitHub App installation tracking and setup progress. The `job_queue` table needs a `job_type` discriminator so the worker can handle both agent and setup jobs. The `webhook_secret` column becomes nullable (GitHub App projects don't need per-repo secrets). All tables are in the `feedback_chat` schema (set at client level, not in SQL).

**Step 1: Create the migration file**

```sql
-- GitHub App auto-setup: installation tracking + setup job type

-- New columns on projects for GitHub App + setup state
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS github_installation_id bigint,
  ADD COLUMN IF NOT EXISTS setup_status text NOT NULL DEFAULT 'pending'
    CHECK (setup_status IN (
      'pending', 'installing', 'queued', 'cloning', 'generating',
      'committing', 'pr_created', 'complete', 'failed'
    )),
  ADD COLUMN IF NOT EXISTS setup_pr_url text,
  ADD COLUMN IF NOT EXISTS setup_error text;

-- webhook_secret is no longer required (GitHub App projects don't need it)
ALTER TABLE projects ALTER COLUMN webhook_secret DROP NOT NULL;

-- Job type discriminator: 'agent' (default, existing behavior) or 'setup'
ALTER TABLE job_queue
  ADD COLUMN IF NOT EXISTS job_type text NOT NULL DEFAULT 'agent'
    CHECK (job_type IN ('agent', 'setup'));

-- Index for worker to optionally filter by job_type
CREATE INDEX IF NOT EXISTS idx_job_queue_type_status
  ON job_queue(job_type, status) WHERE status = 'pending';
```

**Step 2: Verify SQL syntax**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && cat supabase/migrations/00005_github_app_setup.sql`

Read the file back and verify no syntax errors.

**Step 3: Commit**

```bash
git add packages/dashboard/supabase/migrations/00005_github_app_setup.sql
git commit -m "feat(dashboard): add migration — github_installation_id, setup_status, job_type"
```

---

## Task 2: TypeScript Types

**Files:**
- Modify: `packages/dashboard/src/lib/types.ts`

**Context:** Add types for the new setup status flow. These are used by the SetupWizard component and the setup trigger action. See existing types in this file (`PipelineRun`, `FeedbackSession`, etc.).

**Step 1: Append new types after the existing `TesterSummary` type**

```typescript
export type SetupStatus =
  | 'pending'
  | 'installing'
  | 'queued'
  | 'cloning'
  | 'generating'
  | 'committing'
  | 'pr_created'
  | 'complete'
  | 'failed'

export type ProjectSetupInfo = {
  github_installation_id: number | null
  setup_status: SetupStatus
  setup_pr_url: string | null
  setup_error: string | null
}
```

**Step 2: Type-check**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npx tsc --noEmit`

Expected: Clean (no errors).

**Step 3: Commit**

```bash
git add packages/dashboard/src/lib/types.ts
git commit -m "feat(dashboard): add SetupStatus and ProjectSetupInfo types"
```

---

## Task 3: Dashboard — GitHub App Utility Library

**Files:**
- Create: `packages/dashboard/src/lib/github-app.ts`
- Modify: `packages/dashboard/package.json` (new dependency)

**Context:** Centralizes GitHub App authentication — installation token generation and webhook signature verification. Uses `@octokit/app` for JWT handling and token management. Environment variables: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`.

**Step 1: Install dependencies**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npm install @octokit/app @octokit/rest`

**Step 2: Create the library**

```typescript
import { App } from '@octokit/app'
import crypto from 'node:crypto'

let _app: App | null = null

/** Get the singleton GitHub App instance. */
export function getGitHubApp(): App {
  if (!_app) {
    const appId = process.env.GITHUB_APP_ID
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY
    if (!appId || !privateKey) {
      throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set')
    }
    _app = new App({
      appId,
      privateKey: privateKey.replace(/\\n/g, '\n'),
      webhooks: { secret: process.env.GITHUB_APP_WEBHOOK_SECRET ?? '' },
    })
  }
  return _app
}

/** Get an authenticated Octokit client scoped to a specific installation. */
export async function getInstallationOctokit(installationId: number) {
  const app = getGitHubApp()
  return app.getInstallationOctokit(installationId)
}

/** Get a short-lived installation access token (for git clone auth). */
export async function getInstallationToken(installationId: number): Promise<string> {
  const app = getGitHubApp()
  const octokit = await app.getInstallationOctokit(installationId)
  const { token } = (await octokit.auth({ type: 'installation' })) as { token: string }
  return token
}

/** Build the GitHub App installation URL. state carries the projectId. */
export function getInstallUrl(state: string): string {
  return `https://github.com/apps/feedback-chat-bot/installations/new?state=${encodeURIComponent(state)}`
}

/** Verify a GitHub webhook HMAC-SHA256 signature (timing-safe). */
export function verifyWebhookSignature(payload: string, signature: string): boolean {
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET ?? ''
  if (!signature) return false
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
  if (signature.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}
```

**Step 3: Type-check**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npx tsc --noEmit`

Expected: Clean.

**Step 4: Commit**

```bash
git add packages/dashboard/package.json package-lock.json packages/dashboard/src/lib/github-app.ts
git commit -m "feat(dashboard): add GitHub App utility library — tokens, install URL, webhook verify"
```

---

## Task 4: Dashboard — GitHub App Installation Routes

**Files:**
- Create: `packages/dashboard/src/app/api/github-app/install/route.ts`
- Create: `packages/dashboard/src/app/auth/github-app/setup/route.ts`

**Context:** Two routes handle the GitHub App installation flow. The install route redirects the user to GitHub. The setup callback route receives the redirect back from GitHub with the `installation_id` and saves it to the project. The `state` query parameter carries the `projectId` through the round-trip.

**Step 1: Create the install redirect route**

File: `packages/dashboard/src/app/api/github-app/install/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getInstallUrl } from '@/lib/github-app'

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get('projectId')
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  }
  return NextResponse.redirect(getInstallUrl(projectId))
}
```

**Step 2: Create the callback route**

File: `packages/dashboard/src/app/auth/github-app/setup/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const installationId = request.nextUrl.searchParams.get('installation_id')
  const state = request.nextUrl.searchParams.get('state') // projectId

  if (!installationId || !state) {
    return NextResponse.redirect(new URL('/projects', request.url))
  }

  const supabase = await createClient()

  // Verify user owns this project
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', state)
    .single()

  if (!project) {
    return NextResponse.redirect(new URL('/projects', request.url))
  }

  // Save installation ID + update setup status
  await supabase
    .from('projects')
    .update({
      github_installation_id: parseInt(installationId, 10),
      setup_status: 'installing',
    })
    .eq('id', state)

  return NextResponse.redirect(new URL(`/projects/${state}?installed=true`, request.url))
}
```

**Step 3: Type-check**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add packages/dashboard/src/app/api/github-app/install/route.ts packages/dashboard/src/app/auth/github-app/setup/route.ts
git commit -m "feat(dashboard): add GitHub App install redirect and callback routes"
```

---

## Task 5: Dashboard — Middleware Update

**Files:**
- Modify: `packages/dashboard/src/lib/supabase/middleware.ts`

**Context:** The GitHub App webhook endpoint must be public (no cookie session — GitHub sends raw POST requests). The install redirect also needs to work without full auth validation. The `/auth/github-app/setup` callback is already covered by the `/auth/` prefix. Only `/api/github-app` needs to be added.

**Step 1: Add the public route**

In `packages/dashboard/src/lib/supabase/middleware.ts`, find the `isPublicRoute` check (around line 31) and add `/api/github-app`:

```typescript
  const isPublicRoute = request.nextUrl.pathname === '/login' ||
    request.nextUrl.pathname.startsWith('/auth/') ||
    request.nextUrl.pathname.startsWith('/api/webhook') ||
    request.nextUrl.pathname.startsWith('/api/agent') ||
    request.nextUrl.pathname.startsWith('/api/github-app')
```

**Step 2: Type-check**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/dashboard/src/lib/supabase/middleware.ts
git commit -m "feat(dashboard): add /api/github-app to public route allowlist"
```

---

## Task 6: Dashboard — GitHub App Webhook Handler

**Files:**
- Create: `packages/dashboard/src/app/api/github-app/webhook/route.ts`

**Context:** Single endpoint for ALL GitHub events from repos with the App installed. Replaces per-repo webhooks for GitHub App users. Matches `payload.repository.full_name` against `projects.github_repo` to find the right project. Uses the admin Supabase client (service-role key, bypasses RLS) — same pattern as the existing `/api/webhook/[projectId]/route.ts`. Must handle three event types: `issues` (agent pipeline trigger), `issue_comment` (retry detection), and `pull_request` (setup PR merge detection).

**Step 1: Create the webhook route**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyWebhookSignature } from '@/lib/github-app'

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: 'feedback_chat' } },
  )
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256') ?? ''

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  const event = request.headers.get('x-github-event')
  const payload = JSON.parse(rawBody)
  const repoFullName = payload.repository?.full_name

  if (!repoFullName) {
    return NextResponse.json({ status: 'ignored', reason: 'no repository' })
  }

  const supabase = supabaseAdmin()

  // Find project by repo name (only GitHub App projects)
  const { data: project } = await supabase
    .from('projects')
    .select('id, github_installation_id')
    .eq('github_repo', repoFullName)
    .not('github_installation_id', 'is', null)
    .limit(1)
    .single()

  if (!project) {
    return NextResponse.json({ status: 'ignored', reason: 'no matching project' })
  }

  if (event === 'issues') return handleIssues(supabase, project.id, payload)
  if (event === 'issue_comment') return handleComment(supabase, project.id, payload)
  if (event === 'pull_request') return handlePR(supabase, project.id, payload)

  return NextResponse.json({ status: 'ignored', reason: `unhandled event: ${event}` })
}

// --- Issues: trigger agent pipeline (same logic as /api/webhook/[projectId]) ---

async function handleIssues(
  supabase: ReturnType<typeof supabaseAdmin>,
  projectId: string,
  payload: Record<string, unknown>,
) {
  const action = payload.action as string
  const issue = payload.issue as Record<string, unknown>
  const labels: string[] = ((issue?.labels as { name: string }[]) ?? []).map(l => l.name)

  // Accept: opened, reopened, or labeled with auto-implement
  const isTriggering =
    action === 'opened' ||
    action === 'reopened' ||
    (action === 'labeled' && labels.includes('auto-implement'))

  if (!isTriggering) return NextResponse.json({ status: 'ignored' })
  if (!labels.includes('feedback-bot')) return NextResponse.json({ status: 'ignored' })
  if (labels.includes('in-progress') || labels.includes('agent-failed')) {
    return NextResponse.json({ status: 'ignored' })
  }

  const issueNumber = issue.number as number

  // Dedup check
  const { count } = await supabase
    .from('job_queue')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('github_issue_number', issueNumber)
    .in('status', ['pending', 'processing'])

  if (count && count > 0) {
    return NextResponse.json({ status: 'already_queued' })
  }

  // Enqueue agent job
  const { data: job } = await supabase
    .from('job_queue')
    .insert({
      project_id: projectId,
      job_type: 'agent',
      github_issue_number: issueNumber,
      issue_title: (issue.title as string) ?? '',
      issue_body: (issue.body as string) ?? '',
    })
    .select('id')
    .single()

  if (!job) return NextResponse.json({ error: 'Failed to enqueue' }, { status: 500 })

  await supabase.from('pipeline_runs').insert({
    job_id: job.id,
    project_id: projectId,
    github_issue_number: issueNumber,
    stage: 'queued',
    triggered_by: (issue?.user as Record<string, unknown>)?.login as string | null,
  })

  return NextResponse.json({ status: 'queued' })
}

// --- Issue comments: detect retry requests ---

async function handleComment(
  supabase: ReturnType<typeof supabaseAdmin>,
  projectId: string,
  payload: Record<string, unknown>,
) {
  if ((payload.action as string) !== 'created') {
    return NextResponse.json({ status: 'ignored' })
  }

  const comment = payload.comment as Record<string, unknown>
  const body = (comment?.body as string) ?? ''
  if (!body.startsWith('**Modifications demandées :**')) {
    return NextResponse.json({ status: 'ignored' })
  }

  const issue = payload.issue as Record<string, unknown>
  const labels: string[] = ((issue?.labels as { name: string }[]) ?? []).map(l => l.name)
  if (!labels.includes('auto-implement')) {
    return NextResponse.json({ status: 'ignored' })
  }

  const { data: job } = await supabase
    .from('job_queue')
    .insert({
      project_id: projectId,
      job_type: 'agent',
      github_issue_number: issue.number as number,
      issue_title: (issue.title as string) ?? '',
      issue_body: `${(issue.body as string) ?? ''}\n\n---\nRetry requested:\n${body}`,
    })
    .select('id')
    .single()

  if (job) {
    await supabase.from('pipeline_runs').insert({
      job_id: job.id,
      project_id: projectId,
      github_issue_number: issue.number as number,
      stage: 'queued',
      triggered_by: (comment?.user as Record<string, unknown>)?.login as string | null,
    })
  }

  return NextResponse.json({ status: 'retry_queued' })
}

// --- Pull request merge: detect setup PR completion ---

async function handlePR(
  supabase: ReturnType<typeof supabaseAdmin>,
  projectId: string,
  payload: Record<string, unknown>,
) {
  if ((payload.action as string) !== 'closed') {
    return NextResponse.json({ status: 'ignored' })
  }

  const pr = payload.pull_request as Record<string, unknown>
  const merged = pr?.merged as boolean
  const headRef = (pr?.head as Record<string, unknown>)?.ref as string

  if (merged && headRef === 'feedback-chat/setup') {
    await supabase
      .from('projects')
      .update({ setup_status: 'complete' })
      .eq('id', projectId)
    return NextResponse.json({ status: 'setup_complete' })
  }

  return NextResponse.json({ status: 'ignored' })
}
```

**Step 2: Type-check**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/dashboard/src/app/api/github-app/webhook/route.ts
git commit -m "feat(dashboard): add unified GitHub App webhook handler — issues, comments, PR merge"
```

---

## Task 7: Dashboard — Setup Trigger Server Action

**Files:**
- Modify: `packages/dashboard/src/app/projects/[id]/actions.ts`

**Context:** Add a server action that creates a setup job in `job_queue`. Called by the SetupWizard when the user clicks "Set up my repo." Uses the cookie-based Supabase client (RLS ensures users can only create jobs for their own projects). The worker picks up the job via the existing `claim_next_job` RPC.

**Step 1: Add the `triggerSetup` server action**

Append to `packages/dashboard/src/app/projects/[id]/actions.ts`:

```typescript
export async function triggerSetup(projectId: string) {
  const supabase = await createClient()

  // Verify project exists and has GitHub App installed
  const { data: project } = await supabase
    .from('projects')
    .select('id, github_repo, github_installation_id, setup_status')
    .eq('id', projectId)
    .single()

  if (!project) return { error: 'Project not found' }
  if (!project.github_installation_id) return { error: 'GitHub App not installed' }
  if (project.setup_status === 'queued' || project.setup_status === 'cloning' || project.setup_status === 'generating' || project.setup_status === 'committing') {
    return { error: 'Setup already in progress' }
  }

  // Create setup job
  const { error: jobError } = await supabase
    .from('job_queue')
    .insert({
      project_id: projectId,
      job_type: 'setup',
      issue_title: `Setup: ${project.github_repo}`,
    })

  if (jobError) return { error: 'Failed to create setup job' }

  // Update project status
  await supabase
    .from('projects')
    .update({ setup_status: 'queued', setup_error: null })
    .eq('id', projectId)

  return { success: true }
}

export async function resetSetupStatus(projectId: string) {
  const supabase = await createClient()
  await supabase
    .from('projects')
    .update({ setup_status: 'installing', setup_error: null, setup_pr_url: null })
    .eq('id', projectId)
}
```

**Step 2: Type-check**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/dashboard/src/app/projects/[id]/actions.ts
git commit -m "feat(dashboard): add triggerSetup and resetSetupStatus server actions"
```

---

## Task 8: Dashboard — SetupWizard Component

**Files:**
- Create: `packages/dashboard/src/components/setup-wizard.tsx`

**Context:** Replaces `SetupChecklist` when a GitHub App installation is detected. Shows a guided wizard with stages: connect GitHub → set up repo → live progress → PR ready → complete. Polls `projects` table for status updates every 2 seconds during setup. Falls back to the existing manual checklist via a collapsible "Manual setup" link. Uses `glass-card` styling, `lucide-react` icons, and the `sileo` toast library.

**Step 1: Create the wizard component**

```typescript
'use client'

import { useState, useEffect, useCallback, useTransition } from 'react'
import { Github, Loader2, Check, ExternalLink, AlertCircle, Zap, ChevronDown } from 'lucide-react'
import { toast } from 'sileo'
import { createClient } from '@/lib/supabase/client'
import { triggerSetup, resetSetupStatus } from '@/app/projects/[id]/actions'
import type { SetupStatus } from '@/lib/types'

type Props = {
  projectId: string
  githubRepo: string
  installationId: number | null
  initialStatus: SetupStatus
  initialPrUrl: string | null
  initialError: string | null
}

const STAGES: { key: SetupStatus; label: string }[] = [
  { key: 'queued', label: 'Waiting for worker' },
  { key: 'cloning', label: 'Cloning repository' },
  { key: 'generating', label: 'Generating setup files' },
  { key: 'committing', label: 'Creating pull request' },
]

const ACTIVE_STATUSES: SetupStatus[] = ['queued', 'cloning', 'generating', 'committing']

export function SetupWizard({ projectId, githubRepo, installationId, initialStatus, initialPrUrl, initialError }: Props) {
  const [status, setStatus] = useState<SetupStatus>(initialStatus)
  const [prUrl, setPrUrl] = useState<string | null>(initialPrUrl)
  const [error, setError] = useState<string | null>(initialError)
  const [showManual, setShowManual] = useState(false)
  const [isPending, startTransition] = useTransition()

  // Poll for status updates during active setup
  useEffect(() => {
    if (!ACTIVE_STATUSES.includes(status)) return

    const supabase = createClient()
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('projects')
        .select('setup_status, setup_pr_url, setup_error')
        .eq('id', projectId)
        .single()

      if (data) {
        setStatus(data.setup_status as SetupStatus)
        if (data.setup_pr_url) setPrUrl(data.setup_pr_url)
        if (data.setup_error) setError(data.setup_error)
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [status, projectId])

  const handleConnect = useCallback(() => {
    window.location.href = `/api/github-app/install?projectId=${projectId}`
  }, [projectId])

  const handleSetup = useCallback(() => {
    startTransition(async () => {
      const result = await triggerSetup(projectId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      setStatus('queued')
      setError(null)
    })
  }, [projectId])

  const handleRetry = useCallback(() => {
    startTransition(async () => {
      await resetSetupStatus(projectId)
      setStatus('installing')
      setError(null)
      setPrUrl(null)
    })
  }, [projectId])

  // --- Not connected ---
  if (!installationId && status === 'pending') {
    return (
      <div className="mb-8">
        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <Zap className="h-5 w-5 text-accent" />
            <h2 className="text-sm font-medium text-fg">Quick Setup</h2>
          </div>
          <p className="text-xs text-muted mb-4">
            Connect your GitHub repository to automatically install the feedback widget.
            We&apos;ll create a PR with everything configured.
          </p>
          <button
            onClick={handleConnect}
            className="flex h-10 items-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-bg transition-colors hover:bg-white/90"
          >
            <Github className="h-4 w-4" />
            Connect GitHub
          </button>
          <button
            onClick={() => setShowManual(!showManual)}
            className="mt-3 flex items-center gap-1 text-xs text-muted hover:text-fg transition-colors"
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${showManual ? 'rotate-180' : ''}`} />
            Manual setup
          </button>
        </div>
      </div>
    )
  }

  // --- Connected, ready to set up ---
  if (installationId && status === 'installing') {
    return (
      <div className="mb-8">
        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <Check className="h-5 w-5 text-success" />
            <h2 className="text-sm font-medium text-fg">GitHub Connected</h2>
          </div>
          <p className="text-xs text-muted mb-4">
            Ready to set up the feedback widget in <span className="text-fg font-medium">{githubRepo}</span>.
          </p>
          <button
            onClick={handleSetup}
            disabled={isPending}
            className="flex h-10 items-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-bg transition-colors hover:bg-white/90 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            Set up my repo
          </button>
        </div>
      </div>
    )
  }

  // --- Setting up (live progress) ---
  if (ACTIVE_STATUSES.includes(status)) {
    const activeIndex = STAGES.findIndex(s => s.key === status)
    return (
      <div className="mb-8">
        <div className="glass-card p-6">
          <h2 className="text-sm font-medium text-fg mb-4">Setting up your repo...</h2>
          <div className="space-y-3">
            {STAGES.map((stage, i) => {
              const isDone = i < activeIndex
              const isActive = i === activeIndex
              return (
                <div key={stage.key} className="flex items-center gap-3">
                  <div className="flex h-6 w-6 items-center justify-center">
                    {isDone ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : isActive ? (
                      <Loader2 className="h-4 w-4 text-accent animate-spin" />
                    ) : (
                      <div className="h-2 w-2 rounded-full bg-white/10" />
                    )}
                  </div>
                  <span className={`text-xs ${isActive ? 'text-fg' : isDone ? 'text-muted' : 'text-white/20'}`}>
                    {stage.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // --- PR created ---
  if (status === 'pr_created' || status === 'complete') {
    return (
      <div className="mb-8">
        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <Check className="h-5 w-5 text-success" />
            <h2 className="text-sm font-medium text-fg">
              {status === 'complete' ? 'Widget is live!' : 'PR ready!'}
            </h2>
          </div>
          {prUrl && status !== 'complete' && (
            <>
              <p className="text-xs text-muted mb-3">
                Merge the PR to activate the widget.
              </p>
              <a
                href={prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-bg transition-colors hover:bg-white/90"
              >
                <ExternalLink className="h-4 w-4" />
                View Pull Request
              </a>
              <div className="mt-4 rounded-lg bg-white/[0.04] p-3">
                <p className="text-xs font-medium text-fg mb-1">After merging:</p>
                <ol className="text-xs text-muted space-y-1 list-decimal list-inside">
                  <li>Add <code className="text-fg">ANTHROPIC_API_KEY</code> to <code className="text-fg">.env.local</code></li>
                  <li>Add <code className="text-fg">FEEDBACK_PASSWORD</code> to <code className="text-fg">.env.local</code></li>
                  <li>Restart your dev server</li>
                </ol>
              </div>
            </>
          )}
          {status === 'complete' && (
            <p className="text-xs text-success">
              The feedback widget is active in your app.
            </p>
          )}
        </div>
      </div>
    )
  }

  // --- Failed ---
  if (status === 'failed') {
    return (
      <div className="mb-8">
        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <AlertCircle className="h-5 w-5 text-danger" />
            <h2 className="text-sm font-medium text-fg">Setup failed</h2>
          </div>
          <p className="text-xs text-muted mb-3">{error ?? 'An unknown error occurred.'}</p>
          <button
            onClick={handleRetry}
            disabled={isPending}
            className="flex h-10 items-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-bg transition-colors hover:bg-white/90 disabled:opacity-50"
          >
            <Zap className="h-4 w-4" />
            Retry
          </button>
        </div>
      </div>
    )
  }

  return null
}
```

**Step 2: Type-check**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/dashboard/src/components/setup-wizard.tsx
git commit -m "feat(dashboard): add SetupWizard component — connect, progress, PR ready, retry"
```

---

## Task 9: Dashboard — Project Detail Page Integration

**Files:**
- Modify: `packages/dashboard/src/app/projects/[id]/page.tsx`

**Context:** The project detail page currently always renders `<SetupChecklist>`. Update it to render `<SetupWizard>` when the project has a `github_installation_id`, and fall back to `<SetupChecklist>` otherwise. Add the new columns to the project `select` query. Import the new component and the `SetupStatus` type.

**Step 1: Update the project query select**

In `packages/dashboard/src/app/projects/[id]/page.tsx`, find the project query (around line 22):

Change from:
```typescript
.select('id, name, github_repo, webhook_secret, created_at, setup_progress')
```

To:
```typescript
.select('id, name, github_repo, webhook_secret, created_at, setup_progress, github_installation_id, setup_status, setup_pr_url, setup_error')
```

**Step 2: Add imports**

```typescript
import { SetupWizard } from '@/components/setup-wizard'
import type { SetupStatus } from '@/lib/types'
```

**Step 3: Replace the `<SetupChecklist>` render block**

Find where `<SetupChecklist>` is rendered and wrap it in a conditional:

```typescript
      {project.github_installation_id ? (
        <SetupWizard
          projectId={project.id}
          githubRepo={project.github_repo}
          installationId={project.github_installation_id}
          initialStatus={(project.setup_status ?? 'pending') as SetupStatus}
          initialPrUrl={project.setup_pr_url ?? null}
          initialError={project.setup_error ?? null}
        />
      ) : (
        <SetupChecklist
          projectId={project.id}
          githubRepo={project.github_repo}
          webhookSecret={webhookSecret ?? project.webhook_secret}
          apiKey={apiKey}
          webhookUrl={webhookUrl}
          agentUrl={agentUrl}
          setupProgress={setupProgress}
          hasRuns={hasRuns}
        />
      )}
```

**Step 4: Type-check**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npx tsc --noEmit`

**Step 5: Commit**

```bash
git add packages/dashboard/src/app/projects/[id]/page.tsx
git commit -m "feat(dashboard): show SetupWizard for GitHub App projects, SetupChecklist for manual"
```

---

## Task 10: Agent — GitHub App Token Support

**Files:**
- Modify: `packages/agent/package.json` (new dependency)
- Create: `packages/agent/src/github-app.ts`

**Context:** The worker needs to generate installation tokens for GitHub App projects. Uses `@octokit/app` — same library as the dashboard. Environment variables: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`. These must be set on the Railway deployment.

**Step 1: Install @octokit/app**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/agent && npm install @octokit/app`

**Step 2: Create the token utility**

File: `packages/agent/src/github-app.ts`

```typescript
import { App } from '@octokit/app'

let _app: App | null = null

function getApp(): App {
  if (!_app) {
    const appId = process.env.GITHUB_APP_ID
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY
    if (!appId || !privateKey) {
      throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set')
    }
    _app = new App({
      appId,
      privateKey: privateKey.replace(/\\n/g, '\n'),
    })
  }
  return _app
}

/** Get a short-lived installation access token. */
export async function getInstallationToken(installationId: number): Promise<string> {
  const app = getApp()
  const octokit = await app.getInstallationOctokit(installationId)
  const { token } = (await octokit.auth({ type: 'installation' })) as { token: string }
  return token
}

/** Check if GitHub App credentials are configured. */
export function isGitHubAppConfigured(): boolean {
  return !!(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY)
}
```

**Step 3: Type-check**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/agent && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add packages/agent/package.json package-lock.json packages/agent/src/github-app.ts
git commit -m "feat(agent): add GitHub App installation token utility"
```

---

## Task 11: Agent — Setup Job Handler

**Files:**
- Create: `packages/agent/src/setup-worker.ts`
- Modify: `packages/agent/src/managed-worker.ts`

**Context:** The worker needs to handle `job_type='setup'` jobs. The setup handler clones the repo, runs Claude Code with a setup prompt, commits to a `feedback-chat/setup` branch, pushes, creates a PR, creates 6 labels, and updates `projects.setup_status` throughout. Uses installation tokens for GitHub access. The managed worker dispatches based on `job_type`.

**Step 1: Create the setup job handler**

File: `packages/agent/src/setup-worker.ts`

```typescript
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getInstallationToken } from './github-app.js'
import { initCredentials, ensureValidToken } from './oauth.js'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

type SetupJobInput = {
  jobId: string
  projectId: string
  githubRepo: string
  installationId: number
  supabase: SupabaseClient
}

const FEEDBACK_LABELS = [
  { name: 'feedback-bot', color: '0E8A16', description: 'Created by feedback widget' },
  { name: 'auto-implement', color: '1D76DB', description: 'Agent should implement this' },
  { name: 'in-progress', color: 'FBCA04', description: 'Agent is working on this' },
  { name: 'agent-failed', color: 'D93F0B', description: 'Agent build/lint failed' },
  { name: 'preview-pending', color: 'C5DEF5', description: 'PR ready, preview deploying' },
  { name: 'rejected', color: 'E4E669', description: 'User rejected changes' },
]

function updateStatus(supabase: SupabaseClient, projectId: string, status: string, extra?: Record<string, string | null>) {
  return supabase
    .from('projects')
    .update({ setup_status: status, ...extra })
    .eq('id', projectId)
}

function run(cmd: string, args: string[], cwd: string, env?: Record<string, string | undefined>): string {
  return execFileSync(cmd, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    encoding: 'utf-8',
    timeout: 300_000,
    maxBuffer: 10 * 1024 * 1024,
  })
}

export async function runSetupJob(input: SetupJobInput): Promise<void> {
  const { jobId, projectId, githubRepo, installationId, supabase } = input
  const [owner, repo] = githubRepo.split('/')
  let workDir = ''

  try {
    // 1. Clone
    await updateStatus(supabase, projectId, 'cloning')
    console.log(`[setup] Cloning ${githubRepo}...`)

    const token = await getInstallationToken(installationId)
    workDir = mkdtempSync(join(tmpdir(), 'setup-'))
    run('git', ['clone', '--depth', '1', `https://x-access-token:${token}@github.com/${owner}/${repo}.git`, '.'], workDir)

    // 2. Generate with Claude Code
    await updateStatus(supabase, projectId, 'generating')
    console.log('[setup] Running Claude Code...')

    // Build Claude env
    const claudeEnv: Record<string, string | undefined> = { ...process.env }

    // Check for project-level credentials
    const { data: cred } = await supabase
      .from('credentials')
      .select('type, encrypted_value')
      .eq('project_id', projectId)
      .limit(1)
      .single()

    if (cred) {
      if (cred.type === 'claude_oauth') {
        // Set CLAUDE_CREDENTIALS_JSON so initCredentials() writes the file
        process.env.CLAUDE_CREDENTIALS_JSON = cred.encrypted_value
        initCredentials()
        await ensureValidToken()
        const credsPath = join(homedir(), '.claude', '.credentials.json')
        if (existsSync(credsPath)) {
          const credsData = JSON.parse(readFileSync(credsPath, 'utf-8'))
          claudeEnv.CLAUDE_CODE_OAUTH_TOKEN = credsData?.claudeAiOauth?.accessToken
          delete claudeEnv.ANTHROPIC_API_KEY
        }
      } else {
        claudeEnv.ANTHROPIC_API_KEY = cred.encrypted_value
      }
    }

    claudeEnv.CI = 'true'

    const setupPrompt = buildSetupPrompt(githubRepo)
    run('claude', ['--dangerously-skip-permissions', '-p', setupPrompt], workDir, claudeEnv)

    // 3. Commit + push
    await updateStatus(supabase, projectId, 'committing')
    console.log('[setup] Pushing changes...')

    run('git', ['checkout', '-b', 'feedback-chat/setup'], workDir)
    run('git', ['add', '-A'], workDir)

    // Check if there are changes to commit
    try {
      run('git', ['diff', '--cached', '--quiet'], workDir)
      // If no error, there are no changes — Claude didn't modify anything
      throw new Error('Claude Code did not generate any files. The setup prompt may need adjustment.')
    } catch (e) {
      // git diff --cached --quiet exits 1 when there ARE changes — that's what we want
      if (e instanceof Error && e.message.includes('did not generate')) throw e
    }

    run('git', ['commit', '-m', 'feat: add feedback-chat widget\n\nAuto-generated by Feedback Chat dashboard.'], workDir)

    // Get fresh token for push (original may have been used a while ago)
    const pushToken = await getInstallationToken(installationId)
    run('git', ['remote', 'set-url', 'origin', `https://x-access-token:${pushToken}@github.com/${owner}/${repo}.git`], workDir)
    run('git', ['push', '-u', 'origin', 'feedback-chat/setup', '--force'], workDir)

    // 4. Create PR via GitHub API
    console.log('[setup] Creating PR...')
    const prResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pushToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        title: 'Add feedback-chat widget',
        head: 'feedback-chat/setup',
        base: 'main',
        body: buildPrBody(githubRepo),
      }),
    })

    if (!prResponse.ok) {
      const text = await prResponse.text()
      // 422 = PR already exists (branch already has a PR)
      if (prResponse.status !== 422) {
        throw new Error(`Failed to create PR: ${prResponse.status} ${text}`)
      }
    }

    const prData = await prResponse.json()
    const prUrl = prData.html_url ?? null

    // 5. Create labels (idempotent)
    console.log('[setup] Creating labels...')
    for (const label of FEEDBACK_LABELS) {
      await fetch(`https://api.github.com/repos/${owner}/${repo}/labels`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pushToken}`,
          Accept: 'application/vnd.github+json',
        },
        body: JSON.stringify(label),
      }).catch(() => {}) // Ignore errors (label may already exist)
    }

    // 6. Done
    await updateStatus(supabase, projectId, 'pr_created', { setup_pr_url: prUrl })
    console.log(`[setup] Done! PR: ${prUrl}`)

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[setup] Failed: ${message}`)
    await updateStatus(supabase, projectId, 'failed', { setup_error: message })
    throw err
  } finally {
    if (workDir) rmSync(workDir, { recursive: true, force: true })
  }
}

function buildSetupPrompt(githubRepo: string): string {
  return `You are setting up the @nikitadmitrieff/feedback-chat widget in this Next.js project.

Do the following steps in order:

1. Check if this is a Next.js project. Find the app directory (usually app/ or src/app/).
2. Install the package and peer dependencies:
   npm install @nikitadmitrieff/feedback-chat @assistant-ui/react @assistant-ui/react-ai-sdk @assistant-ui/react-markdown ai @ai-sdk/anthropic
3. Find the main CSS file (usually globals.css or app/globals.css).
   - If using Tailwind v4 (has @import "tailwindcss"), add AFTER that import:
     @source "../node_modules/@nikitadmitrieff/feedback-chat/dist/**/*.js";
   - If using Tailwind v3, add the path to the content array in tailwind.config.
4. Create the chat API route at {appDir}/api/feedback/chat/route.ts:
   import { createFeedbackHandler } from '@nikitadmitrieff/feedback-chat/server'
   const handler = createFeedbackHandler({
     password: process.env.FEEDBACK_PASSWORD!,
     github: {
       token: process.env.GITHUB_TOKEN!,
       repo: '${githubRepo}',
     },
   })
   export const POST = handler.POST
5. Create the status API route at {appDir}/api/feedback/status/route.ts:
   import { createStatusHandler } from '@nikitadmitrieff/feedback-chat/server'
   const handler = createStatusHandler({
     password: process.env.FEEDBACK_PASSWORD!,
     github: {
       token: process.env.GITHUB_TOKEN!,
       repo: '${githubRepo}',
     },
   })
   export const { GET, POST } = handler
6. Create a client component at components/FeedbackButton.tsx:
   'use client'
   import { useState } from 'react'
   import { FeedbackPanel } from '@nikitadmitrieff/feedback-chat'
   import '@nikitadmitrieff/feedback-chat/styles.css'
   export function FeedbackButton() {
     const [open, setOpen] = useState(false)
     return <FeedbackPanel isOpen={open} onToggle={() => setOpen(!open)} />
   }
7. Add <FeedbackButton /> to the root layout inside the <body> tag.
   Import it: import { FeedbackButton } from '@/components/FeedbackButton'
8. Create a .env.local.example file listing the required env vars:
   ANTHROPIC_API_KEY=sk-ant-...
   FEEDBACK_PASSWORD=easy
   GITHUB_TOKEN=ghp_...
   GITHUB_REPO=${githubRepo}

IMPORTANT:
- Do NOT install React — it is already a dependency.
- Do NOT modify existing components beyond adding the FeedbackButton import to the layout.
- Do NOT commit anything — just make the file changes.
- If you cannot find the app directory, look for a next.config file to confirm it is a Next.js project.`
}

function buildPrBody(githubRepo: string): string {
  return `## Add feedback-chat widget

This PR was auto-generated by the [Feedback Chat](https://github.com/NikitaDmitrieff/feedback-chat) dashboard.

### What's included
- \`/api/feedback/chat\` — AI conversation endpoint
- \`/api/feedback/status\` — Pipeline status endpoint
- \`<FeedbackButton />\` — Client component wrapper
- Tailwind configuration for widget styles
- \`.env.local.example\` — Required environment variables

### After merging

Add these to your \`.env.local\`:
\`\`\`
ANTHROPIC_API_KEY=sk-ant-...
FEEDBACK_PASSWORD=easy
\`\`\`

Then restart your dev server: \`npm run dev\`

The feedback password defaults to \`easy\` — change it before going to production.

---
*Auto-generated by [Feedback Chat](https://github.com/NikitaDmitrieff/feedback-chat) dashboard*`
}
```

**Step 2: Update the managed worker to dispatch setup jobs**

In `packages/agent/src/managed-worker.ts`, modify `processJob` to check `job.job_type`:

Add import at the top:
```typescript
import { runSetupJob } from './setup-worker.js'
```

In the `processJob` function, before calling `runManagedJob`, add:

```typescript
    // Dispatch based on job type
    if (job.job_type === 'setup') {
      const { data: project } = await supabase
        .from('projects')
        .select('github_repo, github_installation_id')
        .eq('id', job.project_id)
        .single()

      if (!project?.github_installation_id) {
        throw new Error('Setup job requires github_installation_id on the project')
      }

      await runSetupJob({
        jobId: job.id,
        projectId: job.project_id,
        githubRepo: project.github_repo,
        installationId: project.github_installation_id,
        supabase,
      })
      return // skip the regular agent job flow
    }
```

**Step 3: Type-check**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/agent && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add packages/agent/src/setup-worker.ts packages/agent/src/managed-worker.ts
git commit -m "feat(agent): add setup job handler — clone, Claude Code, PR, labels"
```

---

## Task 12: Agent — Use Installation Tokens for Agent Jobs

**Files:**
- Modify: `packages/agent/src/managed-worker.ts`

**Context:** For GitHub App projects (where `github_installation_id` is set), the worker should use an installation token instead of the `GITHUB_TOKEN` env var. This makes the agent fully functional without the user providing a GitHub PAT. The existing `runManagedJob` already injects `GITHUB_TOKEN` into process.env per-job — we just need to source it from the installation token when available.

**Step 1: Modify `processJob` to use installation tokens**

In `packages/agent/src/managed-worker.ts`, in the `processJob` function, after `fetchGithubConfig` but before `runManagedJob`:

```typescript
    // For GitHub App projects, get an installation token
    let githubToken = github.token
    if (!githubToken) {
      const { data: proj } = await supabase
        .from('projects')
        .select('github_installation_id')
        .eq('id', job.project_id)
        .single()

      if (proj?.github_installation_id) {
        const { isGitHubAppConfigured } = await import('./github-app.js')
        if (isGitHubAppConfigured()) {
          const { getInstallationToken } = await import('./github-app.js')
          githubToken = await getInstallationToken(proj.github_installation_id)
        }
      }
    }
```

Then pass `githubToken` (instead of `github.token`) to `runManagedJob`.

**Step 2: Type-check**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/agent && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/agent/src/managed-worker.ts
git commit -m "feat(agent): use GitHub App installation tokens for agent jobs when available"
```

---

## Task 13: Build Verification

**Step 1: Type-check dashboard**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npx tsc --noEmit`

Expected: No errors.

**Step 2: Type-check agent**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/agent && npx tsc --noEmit`

Expected: No errors.

**Step 3: Build all packages**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat && npm run build`

Expected: All packages build successfully.

**Step 4: Fix any build errors**

If there are type errors or build failures, fix them. Common issues:
- Octokit types may need `as unknown as` casts
- New Supabase columns not in generated types (use `as` casts)
- ESM import extensions (`.js`) required in agent package

**Step 5: Commit fixes if needed**

```bash
git add -A
git commit -m "fix: resolve build issues from GitHub App auto-setup feature"
```

---

## Task 14: GitHub App Registration (Manual — One-Time)

This is a manual step, not a code task. Must be done before testing the feature.

**Step 1: Register the App at https://github.com/settings/apps/new**

| Field | Value |
|---|---|
| App name | `feedback-chat-bot` |
| Homepage URL | Dashboard URL (e.g., `https://loop.joincoby.com`) |
| Callback URL | `{DASHBOARD_URL}/auth/github-app/setup` |
| Setup URL | `{DASHBOARD_URL}/auth/github-app/setup` (same) |
| Webhook URL | `{DASHBOARD_URL}/api/github-app/webhook` |
| Webhook secret | Generate: `openssl rand -hex 32` |

**Step 2: Set permissions**

| Permission | Access |
|---|---|
| Contents | Read & Write |
| Pull requests | Read & Write |
| Issues | Read & Write |
| Metadata | Read |

**Step 3: Subscribe to events**

- `issues`
- `issue_comment`
- `pull_request`

**Step 4: Generate a private key**

On the App settings page, click "Generate a private key." Download the `.pem` file.

**Step 5: Set environment variables**

On the dashboard (Vercel):
```
GITHUB_APP_ID=<App ID from settings page>
GITHUB_APP_PRIVATE_KEY=<contents of .pem file, with \n for newlines>
GITHUB_APP_WEBHOOK_SECRET=<the webhook secret you generated>
GITHUB_APP_CLIENT_ID=<Client ID from settings page>
GITHUB_APP_CLIENT_SECRET=<Client secret from settings page>
```

On the agent (Railway):
```
GITHUB_APP_ID=<same App ID>
GITHUB_APP_PRIVATE_KEY=<same .pem contents>
```

The agent only needs `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` (for installation token generation). The webhook secret, client ID, and client secret are dashboard-only.

---

## Summary

| Task | What it does | Package |
|---|---|---|
| 1 | Supabase migration — new columns + job_type | dashboard |
| 2 | TypeScript types for setup flow | dashboard |
| 3 | GitHub App utility library + @octokit/app | dashboard |
| 4 | GitHub App installation routes (redirect + callback) | dashboard |
| 5 | Middleware — add /api/github-app to public routes | dashboard |
| 6 | Unified GitHub App webhook handler | dashboard |
| 7 | Setup trigger server action | dashboard |
| 8 | SetupWizard component | dashboard |
| 9 | Project detail page — conditional wizard/checklist | dashboard |
| 10 | GitHub App token utility + @octokit/app | agent |
| 11 | Setup job handler (clone → Claude → PR → labels) | agent |
| 12 | Installation tokens for agent jobs | agent |
| 13 | Build verification | both |
| 14 | GitHub App registration (manual) | infra |

**User flow after implementation:**
1. Create project (name + repo URL + Claude credentials)
2. Click "Connect GitHub" → install GitHub App on repo
3. Click "Set up my repo" → watch live progress → get PR link
4. Merge PR → add 2 env vars → restart dev server → done

**What users no longer need to do:**
- Manage a GitHub PAT
- Create a webhook manually
- Create GitHub labels manually
- Deploy a standalone agent
- Configure Tailwind manually
- Create API routes manually
