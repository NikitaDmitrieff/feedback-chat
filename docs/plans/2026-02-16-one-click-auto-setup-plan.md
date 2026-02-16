# One-Click Auto-Setup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users drop a GitHub repo URL in the dashboard and have the feedback widget fully installed — routes, components, Tailwind config, labels, webhook, and a hosted agent — with no manual deployment.

**Architecture:** GitHub App handles repo access and events. Headless Claude Code generates context-aware setup files. A multi-tenant agent worker polls `job_queue` and runs jobs in Docker containers. The dashboard orchestrates everything via SSE-streamed setup jobs.

**Tech Stack:** Next.js 15, Supabase (feedback_chat schema), `@octokit/app` + `@octokit/rest`, Node.js `crypto` (AES-256-GCM), `child_process.spawn` (Claude CLI), Docker API, Server-Sent Events.

**Design doc:** `docs/plans/2026-02-16-one-click-auto-setup-design.md`

---

## Conventions

Before you start, read these files to understand project conventions:

- `CLAUDE.md` — project-wide conventions (AI SDK v6, branch naming, etc.)
- `packages/dashboard/src/lib/supabase/server.ts` — server Supabase client (uses `feedback_chat` schema)
- `packages/dashboard/src/lib/supabase/middleware.ts` — auth middleware with public route allowlist
- `packages/dashboard/src/app/projects/[id]/actions.ts` — server action pattern
- `packages/dashboard/src/app/api/webhook/[projectId]/route.ts` — webhook + admin Supabase pattern

**Key patterns:**
- All Supabase clients use `{ db: { schema: 'feedback_chat' } }`
- Admin (service role) client for webhook/worker routes: inline `createClient(URL, SERVICE_ROLE_KEY, { db: { schema: 'feedback_chat' } })`
- Server client for user-scoped routes: `import { createClient } from '@/lib/supabase/server'`
- Async params in Next.js 15: `const { id } = await params`
- API responses: `NextResponse.json({ data })` or `NextResponse.json({ error }, { status: N })`
- Server actions: top-level `'use server'` directive, exported async functions
- Styling: `glass-card`, `stat-card`, `input-field`, `stage-badge` CSS classes
- Icons: `lucide-react`
- No test framework in dashboard — verify via `npx tsc --noEmit` and `npm run build`

---

## Task 1: Supabase Migration — Schema Changes

**Files:**
- Create: `packages/dashboard/supabase/migrations/00005_auto_setup.sql`

**Context:** The `projects` table needs new columns for GitHub App installation tracking and setup status. A new `setup_jobs` table tracks individual setup attempts. All tables are in the `feedback_chat` schema (set at client level, not in SQL). See `00001_initial_schema.sql` for existing patterns.

**Step 1: Create the migration file**

```sql
-- Auto-setup: GitHub App integration + setup job tracking

-- New columns on projects for GitHub App + setup state
ALTER TABLE projects
  ADD COLUMN github_installation_id bigint,
  ADD COLUMN setup_status text NOT NULL DEFAULT 'pending'
    CHECK (setup_status IN (
      'pending', 'installing', 'cloning', 'generating',
      'committing', 'pr_created', 'complete', 'failed'
    )),
  ADD COLUMN setup_pr_url text,
  ADD COLUMN setup_error text;

-- webhook_secret is no longer required (GitHub App projects don't need it)
ALTER TABLE projects ALTER COLUMN webhook_secret DROP NOT NULL;

-- Setup jobs: tracks individual setup attempts (separate from agent job_queue)
CREATE TABLE setup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'cloning', 'analyzing', 'generating',
      'committing', 'pr_created', 'labeling', 'done', 'failed'
    )),
  log text[] DEFAULT '{}',
  error text,
  pr_url text,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- RLS
ALTER TABLE setup_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own setup jobs" ON setup_jobs
  FOR ALL USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- Index for dashboard lookups
CREATE INDEX idx_setup_jobs_project ON setup_jobs(project_id, created_at DESC);
```

**Step 2: Verify migration syntax**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npx supabase db diff --local 2>&1 || echo "Local Supabase not running — migration is SQL-only, verify manually"`

If local Supabase isn't running, just verify the SQL is valid by reading it.

**Step 3: Commit**

```bash
git add packages/dashboard/supabase/migrations/00005_auto_setup.sql
git commit -m "feat(dashboard): add auto-setup migration — github_installation_id, setup_status, setup_jobs table"
```

---

## Task 2: Types — Add Setup + GitHub App Types

**Files:**
- Modify: `packages/dashboard/src/lib/types.ts`

**Context:** Add TypeScript types for the new setup_jobs table and GitHub App data. See existing types in this file (`PipelineRun`, `FeedbackSession`, etc.).

**Step 1: Append new types after the existing `TesterSummary` type**

```typescript
export type SetupJob = {
  id: string
  project_id: string
  status: 'pending' | 'cloning' | 'analyzing' | 'generating' | 'committing' | 'pr_created' | 'labeling' | 'done' | 'failed'
  log: string[]
  error: string | null
  pr_url: string | null
  created_at: string
  completed_at: string | null
}

export type SetupStatus =
  | 'pending'
  | 'installing'
  | 'cloning'
  | 'generating'
  | 'committing'
  | 'pr_created'
  | 'complete'
  | 'failed'

export type SetupProgressEvent = {
  stage: SetupStatus
  message: string
  pr_url?: string
  error?: string
}
```

**Step 2: Type-check**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npx tsc --noEmit`

Expected: Clean (no errors).

**Step 3: Commit**

```bash
git add packages/dashboard/src/lib/types.ts
git commit -m "feat(dashboard): add SetupJob, SetupStatus, SetupProgressEvent types"
```

---

## Task 3: Install GitHub App Dependencies

**Files:**
- Modify: `packages/dashboard/package.json`

**Context:** We need `@octokit/app` (GitHub App JWT + installation token management) and `@octokit/rest` (GitHub REST API client). These are the official Octokit libraries.

**Step 1: Install dependencies**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npm install @octokit/app @octokit/rest`

**Step 2: Verify installation**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && node -e "require('@octokit/app'); require('@octokit/rest'); console.log('OK')"`

Expected: `OK`

**Step 3: Commit**

```bash
git add packages/dashboard/package.json packages/dashboard/package-lock.json ../../package-lock.json
git commit -m "feat(dashboard): install @octokit/app and @octokit/rest for GitHub App integration"
```

Note: The root `package-lock.json` may also change since this is a monorepo with workspaces.

---

## Task 4: GitHub App Utility Library

**Files:**
- Create: `packages/dashboard/src/lib/github-app.ts`

**Context:** Centralizes GitHub App authentication — JWT generation, installation token management, and pre-configured Octokit clients. Used by the setup orchestrator, webhook handler, and agent worker. Environment variables: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_WEBHOOK_SECRET`.

**Step 1: Create the library**

```typescript
import { App } from '@octokit/app'
import { Octokit } from '@octokit/rest'

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

/** Get an authenticated Octokit client for a specific installation. */
export async function getInstallationOctokit(installationId: number): Promise<Octokit> {
  const app = getGitHubApp()
  return (await app.getInstallationOctokit(installationId)) as unknown as Octokit
}

/** Get a short-lived installation access token (for git clone auth). */
export async function getInstallationToken(installationId: number): Promise<string> {
  const app = getGitHubApp()
  const octokit = new Octokit({
    auth: { appId: app.appId, privateKey: (app as unknown as { privateKey: string }).privateKey },
  })
  // Use the App JWT to request an installation token
  const jwt = await getAppJwt()
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )
  if (!response.ok) {
    throw new Error(`Failed to get installation token: ${response.status} ${await response.text()}`)
  }
  const data = await response.json()
  return data.token as string
}

/** Generate a JWT for the GitHub App (valid 10min). */
async function getAppJwt(): Promise<string> {
  const app = getGitHubApp()
  const jwt = await app.octokit.request('GET /app')
  // Actually, the App instance can generate JWTs directly:
  // Use the octokit-auth-app method
  return '' // placeholder — see step 2 for real implementation
}

/**
 * Build the GitHub App installation URL for a specific repo.
 * Redirects user to GitHub to install the app on their repo.
 */
export function getInstallUrl(state: string): string {
  const clientId = process.env.GITHUB_APP_CLIENT_ID
  if (!clientId) throw new Error('GITHUB_APP_CLIENT_ID must be set')
  // GitHub App installation URL — lets user choose which repos to grant access
  return `https://github.com/apps/feedback-chat-bot/installations/new?state=${encodeURIComponent(state)}`
}

/** Verify a webhook signature from GitHub. */
export function verifyWebhookSignature(payload: string, signature: string): boolean {
  const crypto = require('node:crypto')
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET ?? ''
  if (!signature) return false
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
  if (signature.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}
```

**Step 2: Refine the implementation**

The `@octokit/app` `App` class handles JWT generation internally. Simplify `getInstallationToken`:

```typescript
import { App } from '@octokit/app'

let _app: App | null = null

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

export async function getInstallationOctokit(installationId: number) {
  const app = getGitHubApp()
  return app.getInstallationOctokit(installationId)
}

export async function getInstallationToken(installationId: number): Promise<string> {
  const app = getGitHubApp()
  const octokit = await app.getInstallationOctokit(installationId)
  const { token } = (await octokit.auth({ type: 'installation' })) as { token: string }
  return token
}

export function getInstallUrl(state: string): string {
  return `https://github.com/apps/feedback-chat-bot/installations/new?state=${encodeURIComponent(state)}`
}

export function verifyWebhookSignature(payload: string, signature: string): boolean {
  const crypto = require('node:crypto') as typeof import('node:crypto')
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
git add packages/dashboard/src/lib/github-app.ts
git commit -m "feat(dashboard): add GitHub App utility library — JWT, tokens, install URL, webhook verify"
```

---

## Task 5: Credential Encryption Library

**Files:**
- Create: `packages/dashboard/src/lib/encryption.ts`

**Context:** The `credentials` table currently stores values as plain text. Before the setup worker can safely decrypt and use Claude credentials, we need actual encryption. Uses AES-256-GCM with a `CREDENTIALS_ENCRYPTION_KEY` env var (32-byte hex key). The existing `api-keys.ts` file uses SHA-256 hashing — this is different (symmetric encryption, not hashing).

**Step 1: Create the encryption library**

```typescript
import crypto from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16

function getKey(): Buffer {
  const hex = process.env.CREDENTIALS_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)')
  }
  return Buffer.from(hex, 'hex')
}

/** Encrypt a string. Returns base64-encoded ciphertext (iv + tag + encrypted). */
export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // Format: iv (12) + tag (16) + ciphertext
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

/** Decrypt a base64-encoded ciphertext. */
export function decrypt(encoded: string): string {
  const key = getKey()
  const buf = Buffer.from(encoded, 'base64')
  const iv = buf.subarray(0, IV_LENGTH)
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH)
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(ciphertext) + decipher.final('utf8')
}
```

**Step 2: Type-check**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npx tsc --noEmit`

Expected: Clean.

**Step 3: Commit**

```bash
git add packages/dashboard/src/lib/encryption.ts
git commit -m "feat(dashboard): add AES-256-GCM credential encryption library"
```

---

## Task 6: Update Project Creation to Encrypt Credentials

**Files:**
- Modify: `packages/dashboard/src/app/projects/new/page.tsx` (line 37-43, the credential insert)

**Context:** Currently stores `credentialValue` as plain text in `encrypted_value` column. Update to actually encrypt. Import `encrypt` from the new library. Also make `webhook_secret` optional (pass empty string for now — GitHub App projects won't need it).

**Step 1: Update the credential insert**

In `packages/dashboard/src/app/projects/new/page.tsx`, add the import:

```typescript
import { encrypt } from '@/lib/encryption'
```

Then change the credential insert block (around line 37-43) from:

```typescript
    if (credentialValue) {
      await supabase.from('credentials').insert({
        project_id: project.id,
        type: credentialType,
        encrypted_value: credentialValue,
      })
    }
```

To:

```typescript
    if (credentialValue) {
      await supabase.from('credentials').insert({
        project_id: project.id,
        type: credentialType,
        encrypted_value: encrypt(credentialValue),
      })
    }
```

**Step 2: Type-check**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npx tsc --noEmit`

Expected: Clean.

**Step 3: Commit**

```bash
git add packages/dashboard/src/app/projects/new/page.tsx
git commit -m "feat(dashboard): encrypt Claude credentials on project creation"
```

---

## Task 7: GitHub App OAuth Callback Route

**Files:**
- Create: `packages/dashboard/src/app/auth/github-app/setup/route.ts`

**Context:** When a user installs the GitHub App on their repo, GitHub redirects to this URL with `installation_id` as a query parameter. This route saves the installation ID to the project and redirects back to the project page. The `state` parameter carries the `projectId`.

**Step 1: Create the callback route**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const installationId = request.nextUrl.searchParams.get('installation_id')
  const state = request.nextUrl.searchParams.get('state') // projectId
  const setupAction = request.nextUrl.searchParams.get('setup_action') // 'install' or 'update'

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

  // Redirect back to project page with a flag to trigger the wizard
  return NextResponse.redirect(new URL(`/projects/${state}?installed=true`, request.url))
}
```

**Step 2: Update middleware to allow this route**

In `packages/dashboard/src/lib/supabase/middleware.ts`, the public route check (line 31-34) currently allows `/auth/`. Since this route is under `/auth/github-app/setup`, it's already covered by `request.nextUrl.pathname.startsWith('/auth/')`. No change needed.

**Step 3: Type-check**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npx tsc --noEmit`

Expected: Clean.

**Step 4: Commit**

```bash
git add packages/dashboard/src/app/auth/github-app/setup/route.ts
git commit -m "feat(dashboard): add GitHub App installation callback route"
```

---

## Task 8: GitHub App Webhook Handler

**Files:**
- Create: `packages/dashboard/src/app/api/github-app/webhook/route.ts`

**Context:** Single endpoint for all GitHub events from installed repos. Replaces per-repo webhooks for GitHub App users. Matches `payload.repository.full_name` against `projects.github_repo` to find the right project. Must be a public route (no auth). See existing webhook at `src/app/api/webhook/[projectId]/route.ts` for the admin Supabase pattern and job enqueueing logic.

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

  // Find project by repo name
  const { data: project } = await supabase
    .from('projects')
    .select('id, github_installation_id')
    .eq('github_repo', repoFullName)
    .not('github_installation_id', 'is', null)
    .single()

  if (!project) {
    return NextResponse.json({ status: 'ignored', reason: 'no matching project' })
  }

  // Handle issues events (agent pipeline trigger)
  if (event === 'issues') {
    return handleIssuesEvent(supabase, project, payload)
  }

  // Handle issue_comment events (retry detection)
  if (event === 'issue_comment') {
    return handleIssueCommentEvent(supabase, project, payload)
  }

  // Handle pull_request events (setup PR merge detection)
  if (event === 'pull_request') {
    return handlePullRequestEvent(supabase, project, payload)
  }

  return NextResponse.json({ status: 'ignored', reason: `unhandled event: ${event}` })
}

async function handleIssuesEvent(
  supabase: ReturnType<typeof supabaseAdmin>,
  project: { id: string; github_installation_id: number | null },
  payload: Record<string, unknown>,
) {
  const action = payload.action as string
  if (action !== 'opened' && action !== 'reopened') {
    return NextResponse.json({ status: 'ignored' })
  }

  const issue = payload.issue as Record<string, unknown>
  const labels: string[] = ((issue?.labels as { name: string }[]) ?? []).map((l) => l.name)

  if (!labels.includes('feedback-bot')) {
    return NextResponse.json({ status: 'ignored' })
  }
  if (labels.includes('in-progress') || labels.includes('agent-failed')) {
    return NextResponse.json({ status: 'ignored' })
  }

  const triggeredBy = (issue?.user as Record<string, unknown>)?.login as string | null

  // Enqueue job (same as existing /api/webhook/[projectId])
  const { data: job, error: jobError } = await supabase
    .from('job_queue')
    .insert({
      project_id: project.id,
      github_issue_number: (issue.number as number),
      issue_title: (issue.title as string) ?? '',
      issue_body: (issue.body as string) ?? '',
    })
    .select('id')
    .single()

  if (jobError || !job) {
    return NextResponse.json({ error: 'Failed to enqueue' }, { status: 500 })
  }

  await supabase.from('pipeline_runs').insert({
    job_id: job.id,
    project_id: project.id,
    github_issue_number: (issue.number as number),
    stage: 'queued',
    triggered_by: triggeredBy,
  })

  return NextResponse.json({ status: 'queued' })
}

async function handleIssueCommentEvent(
  supabase: ReturnType<typeof supabaseAdmin>,
  project: { id: string; github_installation_id: number | null },
  payload: Record<string, unknown>,
) {
  const action = payload.action as string
  if (action !== 'created') {
    return NextResponse.json({ status: 'ignored' })
  }

  const comment = payload.comment as Record<string, unknown>
  const body = (comment?.body as string) ?? ''

  // Detect retry request (French string used by widget)
  if (!body.startsWith('**Modifications demandées :**')) {
    return NextResponse.json({ status: 'ignored' })
  }

  const issue = payload.issue as Record<string, unknown>
  const labels: string[] = ((issue?.labels as { name: string }[]) ?? []).map((l) => l.name)
  if (!labels.includes('auto-implement')) {
    return NextResponse.json({ status: 'ignored' })
  }

  // Re-enqueue the job for retry
  const { data: job } = await supabase
    .from('job_queue')
    .insert({
      project_id: project.id,
      github_issue_number: (issue.number as number),
      issue_title: (issue.title as string) ?? '',
      issue_body: `${(issue.body as string) ?? ''}\n\n---\nRetry requested:\n${body}`,
    })
    .select('id')
    .single()

  if (job) {
    await supabase.from('pipeline_runs').insert({
      job_id: job.id,
      project_id: project.id,
      github_issue_number: (issue.number as number),
      stage: 'queued',
      triggered_by: (comment?.user as Record<string, unknown>)?.login as string | null,
    })
  }

  return NextResponse.json({ status: 'retry_queued' })
}

async function handlePullRequestEvent(
  supabase: ReturnType<typeof supabaseAdmin>,
  project: { id: string; github_installation_id: number | null },
  payload: Record<string, unknown>,
) {
  const action = payload.action as string
  if (action !== 'closed') {
    return NextResponse.json({ status: 'ignored' })
  }

  const pr = payload.pull_request as Record<string, unknown>
  const merged = pr?.merged as boolean
  const headRef = (pr?.head as Record<string, unknown>)?.ref as string

  // Detect setup PR merge
  if (merged && headRef === 'feedback-chat/setup') {
    await supabase
      .from('projects')
      .update({ setup_status: 'complete' })
      .eq('id', project.id)
    return NextResponse.json({ status: 'setup_complete' })
  }

  return NextResponse.json({ status: 'ignored' })
}
```

**Step 2: Update middleware to allow this route**

In `packages/dashboard/src/lib/supabase/middleware.ts`, add `/api/github-app` to the public routes:

Change line 31-34 from:
```typescript
  const isPublicRoute = request.nextUrl.pathname === '/login' ||
    request.nextUrl.pathname.startsWith('/auth/') ||
    request.nextUrl.pathname.startsWith('/api/webhook') ||
    request.nextUrl.pathname.startsWith('/api/agent')
```

To:
```typescript
  const isPublicRoute = request.nextUrl.pathname === '/login' ||
    request.nextUrl.pathname.startsWith('/auth/') ||
    request.nextUrl.pathname.startsWith('/api/webhook') ||
    request.nextUrl.pathname.startsWith('/api/agent') ||
    request.nextUrl.pathname.startsWith('/api/github-app')
```

**Step 3: Type-check**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npx tsc --noEmit`

Expected: Clean.

**Step 4: Commit**

```bash
git add packages/dashboard/src/app/api/github-app/webhook/route.ts packages/dashboard/src/lib/supabase/middleware.ts
git commit -m "feat(dashboard): add GitHub App unified webhook handler — issues, comments, PR merge detection"
```

---

## Task 9: Setup Orchestrator — SSE Endpoint

**Files:**
- Create: `packages/dashboard/src/app/api/setup/[projectId]/route.ts`

**Context:** This is the core setup endpoint. POST starts a setup job and returns an SSE stream with progress updates. The actual work (clone, Claude Code, PR) happens inline in the response stream. Uses admin Supabase client since it needs to access credentials. Must be auth-protected (not in public route allowlist).

**Step 1: Create the SSE setup route**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { getInstallationToken, getInstallationOctokit } from '@/lib/github-app'
import { decrypt } from '@/lib/encryption'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: 'feedback_chat' } },
  )
}

const FEEDBACK_LABELS = [
  { name: 'feedback-bot', color: '0E8A16', description: 'Created by feedback widget' },
  { name: 'auto-implement', color: '1D76DB', description: 'Agent should implement this' },
  { name: 'in-progress', color: 'FBCA04', description: 'Agent is working on this' },
  { name: 'agent-failed', color: 'D93F0B', description: 'Agent build/lint failed' },
  { name: 'preview-pending', color: 'C5DEF5', description: 'PR ready, preview deploying' },
  { name: 'rejected', color: 'E4E669', description: 'User rejected changes' },
]

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params

  // Verify user owns this project
  const supabase = await createServerClient()
  const { data: project } = await supabase
    .from('projects')
    .select('id, github_repo, github_installation_id')
    .eq('id', projectId)
    .single()

  if (!project || !project.github_installation_id) {
    return NextResponse.json({ error: 'Project not found or GitHub App not installed' }, { status: 404 })
  }

  const admin = supabaseAdmin()

  // Create setup job record
  const { data: job } = await admin
    .from('setup_jobs')
    .insert({ project_id: projectId })
    .select('id')
    .single()

  if (!job) {
    return NextResponse.json({ error: 'Failed to create setup job' }, { status: 500 })
  }

  // Get credentials
  const { data: cred } = await admin
    .from('credentials')
    .select('type, encrypted_value')
    .eq('project_id', projectId)
    .single()

  const [owner, repo] = project.github_repo.split('/')
  const installationId = project.github_installation_id

  // Start SSE stream
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (stage: string, message: string, extra?: Record<string, string>) => {
        const data = JSON.stringify({ stage, message, ...extra })
        controller.enqueue(encoder.encode(`data: ${data}\n\n`))
      }

      let workDir = ''
      try {
        // 1. Clone
        send('cloning', 'Cloning repository...')
        await updateStatus(admin, job.id, projectId, 'cloning')

        const token = await getInstallationToken(installationId)
        workDir = await mkdtemp(join(tmpdir(), 'setup-'))
        await execCommand('git', ['clone', '--depth', '1', `https://x-access-token:${token}@github.com/${owner}/${repo}.git`, workDir])

        // 2. Analyze
        send('analyzing', 'Analyzing project structure...')
        await updateStatus(admin, job.id, projectId, 'analyzing')

        // 3. Generate with Claude Code
        send('generating', 'Generating setup files with Claude Code...')
        await updateStatus(admin, job.id, projectId, 'generating')

        const claudeEnv: Record<string, string> = { ...process.env as Record<string, string> }
        if (cred) {
          const decrypted = decrypt(cred.encrypted_value)
          if (cred.type === 'claude_oauth') {
            claudeEnv.CLAUDE_CODE_OAUTH_TOKEN = decrypted
          } else {
            claudeEnv.ANTHROPIC_API_KEY = decrypted
          }
        }

        const setupPrompt = buildSetupPrompt(project.github_repo)
        await execCommand('claude', [
          '--dangerously-skip-permissions',
          '-p', setupPrompt,
        ], { cwd: workDir, env: claudeEnv, timeout: 120_000 })

        // 4. Commit + push
        send('committing', 'Pushing changes...')
        await updateStatus(admin, job.id, projectId, 'committing')

        await execCommand('git', ['-C', workDir, 'checkout', '-b', 'feedback-chat/setup'])
        await execCommand('git', ['-C', workDir, 'add', '-A'])
        await execCommand('git', ['-C', workDir, 'commit', '-m', 'feat: add feedback-chat widget\n\nAuto-generated by Feedback Chat dashboard.'])
        await execCommand('git', ['-C', workDir, 'push', '-u', 'origin', 'feedback-chat/setup'])

        // 5. Create PR
        send('pr_created', 'Creating pull request...')
        const octokit = await getInstallationOctokit(installationId)
        const { data: pr } = await (octokit as any).rest.pulls.create({
          owner,
          repo,
          title: 'Add feedback-chat widget',
          head: 'feedback-chat/setup',
          base: 'main',
          body: buildPrBody(project.github_repo),
        })

        await admin.from('setup_jobs').update({ pr_url: pr.html_url }).eq('id', job.id)

        // 6. Create labels
        send('labeling', 'Creating GitHub labels...')
        for (const label of FEEDBACK_LABELS) {
          try {
            await (octokit as any).rest.issues.createLabel({ owner, repo, ...label })
          } catch {
            // Label may already exist — ignore
          }
        }

        // 7. Done
        await admin.from('setup_jobs').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', job.id)
        await admin.from('projects').update({ setup_status: 'pr_created', setup_pr_url: pr.html_url }).eq('id', projectId)

        send('complete', 'Setup complete! PR ready for review.', { pr_url: pr.html_url })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        send('failed', `Setup failed: ${message}`, { error: message })
        await admin.from('setup_jobs').update({ status: 'failed', error: message, completed_at: new Date().toISOString() }).eq('id', job.id)
        await admin.from('projects').update({ setup_status: 'failed', setup_error: message }).eq('id', projectId)
      } finally {
        if (workDir) {
          await rm(workDir, { recursive: true, force: true }).catch(() => {})
        }
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

// --- Helpers ---

async function updateStatus(
  admin: ReturnType<typeof supabaseAdmin>,
  jobId: string,
  projectId: string,
  status: string,
) {
  await admin.from('setup_jobs').update({ status }).eq('id', jobId)
  await admin.from('projects').update({ setup_status: status }).eq('id', projectId)
}

function execCommand(
  cmd: string,
  args: string[],
  options?: { cwd?: string; env?: Record<string, string>; timeout?: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: options?.cwd,
      env: options?.env,
      timeout: options?.timeout ?? 60_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (d) => { stdout += d })
    proc.stderr?.on('data', (d) => { stderr += d })
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`${cmd} exited with ${code}: ${stderr}`))
    })
    proc.on('error', reject)
  })
}

function buildSetupPrompt(githubRepo: string): string {
  return `You are setting up the @nikitadmitrieff/feedback-chat widget in this Next.js project.

Do the following:
1. Check if this is a Next.js project. Find the app directory (app/ or src/app/).
2. Install the package: npm install @nikitadmitrieff/feedback-chat @assistant-ui/react @assistant-ui/react-ai-sdk @assistant-ui/react-markdown ai @ai-sdk/anthropic
3. Find the main CSS file (globals.css). If using Tailwind v4 (check for @import "tailwindcss"), add: @source "../node_modules/@nikitadmitrieff/feedback-chat/dist/**/*.js";
   If Tailwind v3, add the path to the content array in tailwind.config.
4. Create the API route at {appDir}/api/feedback/chat/route.ts with createFeedbackHandler({ password: process.env.FEEDBACK_PASSWORD! })
5. Create the API route at {appDir}/api/feedback/status/route.ts with createStatusHandler({ password: process.env.FEEDBACK_PASSWORD!, github: { token: process.env.GITHUB_TOKEN!, repo: '${githubRepo}' } })
6. Create a client component at components/FeedbackButton.tsx that imports FeedbackPanel and styles.css
7. Add <FeedbackButton /> to the root layout
8. Create a .env.local.example file with: ANTHROPIC_API_KEY=, FEEDBACK_PASSWORD=easy, GITHUB_TOKEN=, GITHUB_REPO=${githubRepo}

Do NOT install React — it's already a dependency. Do NOT modify existing components beyond the layout import.
Commit nothing — just make the file changes.`
}

function buildPrBody(githubRepo: string): string {
  return `## Add feedback-chat widget

This PR was auto-generated by the [Feedback Chat](https://github.com/NikitaDmitrieff/feedback-chat) dashboard.

### What's included
- API routes: \`/api/feedback/chat\` (POST) and \`/api/feedback/status\` (GET, POST)
- Client component: \`<FeedbackButton />\` wrapper
- Tailwind configuration for widget styles
- \`.env.local.example\` with required environment variables

### After merging

Add these to your \`.env.local\`:
\`\`\`
ANTHROPIC_API_KEY=sk-ant-...
FEEDBACK_PASSWORD=easy
\`\`\`

Then restart your dev server: \`npm run dev\`

### How it works
The widget adds a feedback panel to your app. Users can chat with an AI advisor, and conversations automatically create GitHub issues with the \`feedback-bot\` label. The hosted agent picks up these issues and implements changes via PRs.

---
*Auto-generated by Feedback Chat dashboard*`
}
```

**Step 2: Type-check**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npx tsc --noEmit`

Fix any type errors (likely around the Octokit types — may need `as any` casts or proper typing).

**Step 3: Commit**

```bash
git add packages/dashboard/src/app/api/setup/[projectId]/route.ts
git commit -m "feat(dashboard): add setup orchestrator — SSE endpoint with clone, Claude Code, PR, labels"
```

---

## Task 10: Setup Wizard Component

**Files:**
- Create: `packages/dashboard/src/components/setup-wizard.tsx`

**Context:** Replaces `SetupChecklist` when a GitHub App installation is detected. Shows a guided wizard with live progress from the SSE setup endpoint. Falls back to the existing manual checklist. Uses the `glass-card` styling pattern. See `setup-checklist.tsx` for the existing component pattern and `types.ts` for `SetupProgressEvent`.

**Step 1: Create the wizard component**

```typescript
'use client'

import { useState, useCallback } from 'react'
import {
  Github,
  Loader2,
  Check,
  ExternalLink,
  AlertCircle,
  Zap,
  ChevronDown,
} from 'lucide-react'
import type { SetupStatus, SetupProgressEvent } from '@/lib/types'

type Props = {
  projectId: string
  githubRepo: string
  installationId: number | null
  setupStatus: SetupStatus
  setupPrUrl: string | null
  setupError: string | null
}

const STAGES: { key: SetupStatus; label: string }[] = [
  { key: 'cloning', label: 'Cloning repository' },
  { key: 'analyzing', label: 'Analyzing project structure' },
  { key: 'generating', label: 'Generating setup files' },
  { key: 'committing', label: 'Pushing changes' },
  { key: 'pr_created', label: 'Creating pull request' },
  { key: 'labeling', label: 'Creating GitHub labels' },
]

const STAGE_INDEX: Record<string, number> = Object.fromEntries(
  STAGES.map((s, i) => [s.key, i]),
)

export function SetupWizard({
  projectId,
  githubRepo,
  installationId,
  setupStatus: initialStatus,
  setupPrUrl: initialPrUrl,
  setupError: initialError,
}: Props) {
  const [status, setStatus] = useState<SetupStatus>(initialStatus)
  const [prUrl, setPrUrl] = useState<string | null>(initialPrUrl)
  const [error, setError] = useState<string | null>(initialError)
  const [currentStage, setCurrentStage] = useState<string | null>(null)
  const [showManual, setShowManual] = useState(false)

  const handleConnect = useCallback(() => {
    // Redirect to GitHub App installation page
    window.location.href = `/api/github-app/install?projectId=${projectId}`
  }, [projectId])

  const handleSetup = useCallback(async () => {
    setStatus('cloning')
    setError(null)

    try {
      const response = await fetch(`/api/setup/${projectId}`, { method: 'POST' })
      if (!response.body) throw new Error('No response stream')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const event: SetupProgressEvent = JSON.parse(line.slice(6))
          setCurrentStage(event.stage)
          setStatus(event.stage as SetupStatus)
          if (event.pr_url) setPrUrl(event.pr_url)
          if (event.error) setError(event.error)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed')
      setStatus('failed')
    }
  }, [projectId])

  // State: Not connected
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

  // State: Connected, ready to set up
  if (installationId && status === 'installing') {
    return (
      <div className="mb-8">
        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <Check className="h-5 w-5 text-success" />
            <h2 className="text-sm font-medium text-fg">GitHub Connected</h2>
          </div>
          <p className="text-xs text-muted mb-4">
            Ready to set up the feedback widget in <span className="text-fg">{githubRepo}</span>.
            This will create a PR with all the setup files.
          </p>
          <button
            onClick={handleSetup}
            className="flex h-10 items-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-bg transition-colors hover:bg-white/90"
          >
            <Zap className="h-4 w-4" />
            Set up my repo
          </button>
        </div>
      </div>
    )
  }

  // State: Setting up (live progress)
  if (['cloning', 'analyzing', 'generating', 'committing', 'labeling'].includes(status)) {
    const activeIndex = STAGE_INDEX[status] ?? 0
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

  // State: PR created
  if (status === 'pr_created' || (status === 'complete' && prUrl)) {
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
                Merge the PR to activate the widget in your project.
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
                  <li><code className="text-fg">FEEDBACK_PASSWORD</code> defaults to <code className="text-fg">easy</code> — change before production</li>
                  <li>Restart your dev server</li>
                </ol>
              </div>
            </>
          )}
          {status === 'complete' && (
            <p className="text-xs text-success">
              The feedback widget is active. Users can now submit feedback through your app.
            </p>
          )}
        </div>
      </div>
    )
  }

  // State: Failed
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
            onClick={handleSetup}
            className="flex h-10 items-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-bg transition-colors hover:bg-white/90"
          >
            <Zap className="h-4 w-4" />
            Retry
          </button>
        </div>
      </div>
    )
  }

  // Fallback: pending without installation (shouldn't normally hit this)
  return null
}
```

**Step 2: Type-check**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npx tsc --noEmit`

Expected: Clean.

**Step 3: Commit**

```bash
git add packages/dashboard/src/components/setup-wizard.tsx
git commit -m "feat(dashboard): add SetupWizard component — GitHub connect, live progress, PR ready state"
```

---

## Task 11: GitHub App Install Redirect Route

**Files:**
- Create: `packages/dashboard/src/app/api/github-app/install/route.ts`

**Context:** Simple redirect route that sends the user to GitHub's App installation page with the project ID as state. The wizard's "Connect GitHub" button calls this. After installation, GitHub redirects to the setup callback (`/auth/github-app/setup`).

**Step 1: Create the install redirect route**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getInstallUrl } from '@/lib/github-app'

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get('projectId')
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  }

  const url = getInstallUrl(projectId)
  return NextResponse.redirect(url)
}
```

**Step 2: Type-check**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/dashboard/src/app/api/github-app/install/route.ts
git commit -m "feat(dashboard): add GitHub App install redirect route"
```

---

## Task 12: Update Project Detail Page — Wizard Integration

**Files:**
- Modify: `packages/dashboard/src/app/projects/[id]/page.tsx`

**Context:** The project detail page currently always shows `<SetupChecklist>`. Now it should show `<SetupWizard>` when a GitHub App installation exists, and fall back to `<SetupChecklist>` otherwise. The page already fetches the project — just need to add the new columns to the select and conditionally render.

**Step 1: Update the page**

In `packages/dashboard/src/app/projects/[id]/page.tsx`:

1. Add import: `import { SetupWizard } from '@/components/setup-wizard'`

2. Update the project select (line 22) to include new columns:
```typescript
  const { data: project } = await supabase
    .from('projects')
    .select('id, name, github_repo, webhook_secret, created_at, setup_progress, github_installation_id, setup_status, setup_pr_url, setup_error')
    .eq('id', id)
    .single()
```

3. Replace the `<SetupChecklist>` block (around line 71-80) with conditional rendering:
```typescript
      {/* Setup */}
      {project.github_installation_id ? (
        <SetupWizard
          projectId={project.id}
          githubRepo={project.github_repo}
          installationId={project.github_installation_id}
          setupStatus={(project.setup_status ?? 'pending') as SetupStatus}
          setupPrUrl={project.setup_pr_url ?? null}
          setupError={project.setup_error ?? null}
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

4. Add the type import: `import type { SetupStatus } from '@/lib/types'`

**Step 2: Type-check**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npx tsc --noEmit`

Expected: Clean.

**Step 3: Commit**

```bash
git add packages/dashboard/src/app/projects/[id]/page.tsx
git commit -m "feat(dashboard): conditionally render SetupWizard vs SetupChecklist based on GitHub App installation"
```

---

## Task 13: Update Project Creation — Optional GitHub App Connect

**Files:**
- Modify: `packages/dashboard/src/app/projects/new/page.tsx`

**Context:** After creating a project, if the user hasn't connected the GitHub App yet, the redirect includes `?installed=false` so the project page shows the wizard in "Connect GitHub" state. The `webhook_secret` generation becomes conditional — only generate if not using GitHub App (for backward compatibility).

**Step 1: Make webhook_secret optional**

In `packages/dashboard/src/app/projects/new/page.tsx`, change line 20:

From:
```typescript
    const webhookSecret = crypto.randomBytes(32).toString('hex')
```

To:
```typescript
    const webhookSecret = crypto.randomBytes(32).toString('hex') // Still generated for manual setup fallback
```

No actual code change needed — the migration makes it nullable, but we still generate one. The manual setup flow needs it.

**Step 2: Update the redirect**

The redirect already goes to `/projects/${project.id}?apiKey=...&webhookSecret=...`. No changes needed — the project page checks `github_installation_id` to decide which component to show.

**Step 3: Type-check and commit**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npx tsc --noEmit`

If clean, no commit needed for this task (no code changes).

---

## Task 14: Agent Worker — Entry Point

**Files:**
- Create: `packages/dashboard/src/worker/agent-worker.ts`

**Context:** A standalone Node.js script that polls the `job_queue` table using the existing `claim_job` RPC, executes Claude Code in Docker containers, and updates `pipeline_runs` stages. Runs as a separate process from Next.js. Uses the admin Supabase client and the credential decryption library.

**Step 1: Create the worker**

```typescript
import { createClient } from '@supabase/supabase-js'
import { getInstallationToken } from '../lib/github-app'
import { decrypt } from '../lib/encryption'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const POLL_INTERVAL = 5_000

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: 'feedback_chat' } },
  )
}

async function pollOnce(workerId: string) {
  const supabase = supabaseAdmin()

  // Claim a pending job atomically
  const { data: job, error } = await supabase.rpc('claim_job', { p_worker_id: workerId })
  if (error || !job?.id) return null

  console.log(`[worker] Claimed job ${job.id} for issue #${job.github_issue_number}`)

  // Fetch project info
  const { data: project } = await supabase
    .from('projects')
    .select('id, github_repo, github_installation_id')
    .eq('id', job.project_id)
    .single()

  if (!project) {
    console.error(`[worker] Project ${job.project_id} not found`)
    await supabase.from('job_queue').update({ status: 'failed' }).eq('id', job.id)
    return null
  }

  // Fetch pipeline run
  const { data: run } = await supabase
    .from('pipeline_runs')
    .select('id')
    .eq('job_id', job.id)
    .single()

  const runId = run?.id
  const [owner, repo] = project.github_repo.split('/')

  const log = (level: string, message: string) => {
    console.log(`[worker] [${level}] ${message}`)
    if (runId) {
      supabase.from('run_logs').insert({ run_id: runId, level, message }).then(() => {})
    }
  }

  const updateStage = async (stage: string) => {
    if (runId) {
      await supabase.from('pipeline_runs').update({ stage }).eq('id', runId)
    }
  }

  let workDir = ''
  try {
    // Clone
    await updateStage('running')
    log('info', 'Cloning repository...')

    let cloneUrl: string
    if (project.github_installation_id) {
      const token = await getInstallationToken(project.github_installation_id)
      cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`
    } else {
      // Fallback for non-GitHub-App projects (shouldn't happen for hosted agent)
      throw new Error('No GitHub App installation — cannot clone')
    }

    workDir = await mkdtemp(join(tmpdir(), 'agent-'))
    await exec('git', ['clone', '--depth', '10', cloneUrl, workDir])

    // Get Claude credentials
    const { data: cred } = await supabase
      .from('credentials')
      .select('type, encrypted_value')
      .eq('project_id', project.id)
      .single()

    if (!cred) throw new Error('No Claude credentials found')

    const decrypted = decrypt(cred.encrypted_value)
    const env: Record<string, string> = { PATH: process.env.PATH ?? '' }
    if (cred.type === 'claude_oauth') {
      env.CLAUDE_CODE_OAUTH_TOKEN = decrypted
    } else {
      env.ANTHROPIC_API_KEY = decrypted
    }

    // Run Claude Code
    log('info', 'Running Claude Code...')
    const prompt = `${job.issue_title}\n\n${job.issue_body}`
    await exec('claude', [
      '--dangerously-skip-permissions',
      '-p', prompt,
    ], { cwd: workDir, env, timeout: 600_000 })

    // Validate build
    await updateStage('validating')
    log('info', 'Validating build...')
    try {
      await exec('npm', ['run', 'build'], { cwd: workDir, timeout: 120_000 })
    } catch (buildErr) {
      log('warn', `Build failed: ${buildErr}. Attempting auto-fix...`)
      // Auto-fix attempt
      await exec('claude', [
        '--dangerously-skip-permissions',
        '-p', `The build failed with this error. Fix it:\n${buildErr}`,
      ], { cwd: workDir, env, timeout: 120_000 })
      await exec('npm', ['run', 'build'], { cwd: workDir, timeout: 120_000 })
    }

    // Create branch + push + PR
    const branchName = `feedback/issue-${job.github_issue_number}`
    await exec('git', ['-C', workDir, 'checkout', '-b', branchName])
    await exec('git', ['-C', workDir, 'add', '-A'])
    await exec('git', ['-C', workDir, 'commit', '-m', `feat: implement #${job.github_issue_number}\n\n${job.issue_title}`])

    const pushToken = await getInstallationToken(project.github_installation_id)
    await exec('git', ['-C', workDir, 'remote', 'set-url', 'origin', `https://x-access-token:${pushToken}@github.com/${owner}/${repo}.git`])
    await exec('git', ['-C', workDir, 'push', '-u', 'origin', branchName])

    // Create PR via GitHub API
    const octokit = await import('../lib/github-app').then(m => m.getInstallationOctokit(project.github_installation_id!))
    const { data: pr } = await (octokit as any).rest.pulls.create({
      owner,
      repo,
      title: job.issue_title,
      head: branchName,
      base: 'main',
      body: `Closes #${job.github_issue_number}\n\nAuto-generated by the feedback-chat agent.`,
    })

    await updateStage('preview_ready')
    if (runId) {
      await supabase.from('pipeline_runs').update({
        github_pr_number: pr.number,
        stage: 'preview_ready',
      }).eq('id', runId)
    }
    await supabase.from('job_queue').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', job.id)
    log('info', `PR created: ${pr.html_url}`)

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log('error', `Job failed: ${message}`)
    await supabase.from('job_queue').update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', job.id)
    if (runId) {
      await supabase.from('pipeline_runs').update({ stage: 'failed', result: 'failed', completed_at: new Date().toISOString() }).eq('id', runId)
    }
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

function exec(cmd: string, args: string[], opts?: { cwd?: string; env?: Record<string, string>; timeout?: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: opts?.cwd,
      env: opts?.env ? { ...process.env, ...opts.env } : process.env,
      timeout: opts?.timeout ?? 60_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (d) => { stdout += d })
    proc.stderr?.on('data', (d) => { stderr += d })
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`${cmd} exited with ${code}: ${stderr.slice(0, 500)}`))
    })
    proc.on('error', reject)
  })
}

// Main loop
const workerId = `worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
console.log(`[worker] Starting agent worker (${workerId}). Polling every ${POLL_INTERVAL / 1000}s...`)

async function loop() {
  while (true) {
    try {
      await pollOnce(workerId)
    } catch (err) {
      console.error('[worker] Poll error:', err)
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL))
  }
}

loop()
```

**Step 2: Add worker script to package.json**

In `packages/dashboard/package.json`, add to `"scripts"`:

```json
"worker": "npx tsx src/worker/agent-worker.ts"
```

**Step 3: Type-check**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add packages/dashboard/src/worker/agent-worker.ts packages/dashboard/package.json
git commit -m "feat(dashboard): add multi-tenant agent worker — polls job_queue, runs Claude Code, creates PRs"
```

---

## Task 15: Server Action — Update Setup Status

**Files:**
- Modify: `packages/dashboard/src/app/projects/[id]/actions.ts`

**Context:** Add a server action to reset setup status (for retry after failure). The existing file has `markStepDone` and `markAllStepsDone`. Follow the same pattern.

**Step 1: Add the new server action**

Append to `packages/dashboard/src/app/projects/[id]/actions.ts`:

```typescript
export async function resetSetupStatus(projectId: string) {
  const supabase = await createClient()

  await supabase
    .from('projects')
    .update({
      setup_status: 'installing',
      setup_error: null,
      setup_pr_url: null,
    })
    .eq('id', projectId)
}
```

**Step 2: Type-check**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/dashboard/src/app/projects/[id]/actions.ts
git commit -m "feat(dashboard): add resetSetupStatus server action for setup retry"
```

---

## Task 16: Build Verification

**Step 1: Type-check the entire dashboard**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat/packages/dashboard && npx tsc --noEmit`

Expected: No errors.

**Step 2: Build all packages**

Run: `cd /Users/nikitadmitrieff/Projects/feedback-chat && npm run build`

Expected: All packages build successfully (widget, agent, dashboard).

**Step 3: Fix any issues**

If there are type errors or build failures, fix them. Common issues:
- Octokit types may need `as any` casts
- New Supabase columns not recognized (need to regenerate types or use `as` casts)
- Import paths for worker file may need adjustment

**Step 4: Final commit (if fixes were needed)**

```bash
git add -A
git commit -m "fix(dashboard): resolve build issues from auto-setup feature"
```

---

## Summary

| Task | What it does |
|---|---|
| 1 | Supabase migration — new columns + `setup_jobs` table |
| 2 | TypeScript types for setup jobs and events |
| 3 | Install `@octokit/app` + `@octokit/rest` |
| 4 | GitHub App utility library (JWT, tokens, webhook verify) |
| 5 | AES-256-GCM credential encryption library |
| 6 | Encrypt credentials on project creation |
| 7 | GitHub App OAuth callback route |
| 8 | Unified GitHub App webhook handler |
| 9 | Setup orchestrator — SSE endpoint (clone, Claude Code, PR, labels) |
| 10 | Setup wizard UI component |
| 11 | GitHub App install redirect route |
| 12 | Project detail page — wizard integration |
| 13 | Project creation — optional webhook_secret |
| 14 | Multi-tenant agent worker process |
| 15 | Server action for setup retry |
| 16 | Build verification |
