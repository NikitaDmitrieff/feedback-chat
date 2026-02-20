# feedback-chat

AI-powered feedback widget for Next.js apps. Monorepo with two packages.

## Commands

```bash
npm install          # Install all workspace deps
npm run build        # Build all packages (turbo)
npm run dev          # Watch mode
npm run test         # Run tests
```

## Architecture

```
packages/
├── widget/    # npm package (@nikitadmitrieff/feedback-chat)
│   └── src/
│       ├── client/   # React components (FeedbackPanel, PipelineTracker, Thread)
│       ├── server/   # Route handler factories (createFeedbackHandler, createStatusHandler)
│       └── cli/      # npx setup wizard
├── agent/     # Managed worker — polls Supabase job_queue, runs Claude CLI → validate → PR
└── dashboard/ # Next.js dashboard with project management + feedback intelligence hub
```

## Package Exports

- `@nikitadmitrieff/feedback-chat` → client components (FeedbackPanel, useConversations, PipelineTracker)
- `@nikitadmitrieff/feedback-chat/server` → server factories (createFeedbackHandler, createStatusHandler)
- `@nikitadmitrieff/feedback-chat/styles.css` → self-contained dark glassmorphism styles

## Key Patterns

- Widget CSS is scoped under `.feedback-panel` — isolated from consumer themes
- Widget uses Tailwind utility classes that must be scanned by the consumer's Tailwind (see installation below)
- Client bundle has `"use client"` banner injected by tsup
- AI SDK v6: uses `inputSchema` (not `parameters`), `stepCountIs()`, `toUIMessageStreamResponse()`
- Build copies styles.css manually: `tsup && cp src/client/styles.css dist/styles.css`

## Dashboard

- Next.js app at `packages/dashboard/` with Supabase backend
- Feedback Intelligence Hub: `/projects/[id]/feedback` — AI digest, theme-filtered session list, thread slide-over, tester activity
- Tester profile page: `/projects/[id]/testers/[testerId]` — timeline, sessions, activity
- Run detail page: `/projects/[id]/runs/[runId]` — logs, deployment preview, stage timeline, original feedback
- Dashboard API routes:
  - `/api/feedback/[projectId]` (list), `/[sessionId]` (detail/update), `/classify` (AI via Claude Haiku), `/digest` (AI summary)
  - `/api/feedback/[projectId]/testers` (list), `/testers/[testerId]` (profile + timeline)
  - `/api/runs/[projectId]` (list with feedback source enrichment), `/[runId]/logs`, `/[runId]/deployment`
  - `/api/agent/[projectId]/health`, `/api/webhook/[projectId]`, `/api/github-app/webhook`, `/api/github-app/install`
  - `/api/proposals/[projectId]` — GET (list by status), POST (create user proposal), PATCH (approve/reject with GitHub issue creation)
  - `/api/ideas/[projectId]` — GET (list with optional status filter), POST (create user idea)
  - `/api/projects/[id]/settings` — GET/PATCH for product_context and strategic_nudges
  - `/api/projects/[id]/context/generate` — POST, fetches GitHub repo data and generates product summary via Haiku
- Settings page: `/projects/[id]/settings` — product context (auto-generated from GitHub + editable), strategic nudges (persistent directives), setup & config (moved from overview)
- Proposals page: `/projects/[id]/proposals` — "Your Input" card (quick idea box + create proposal), pending/active/completed sections, proposal slide-over with scores/edit/approve/reject
- ProposalsCard on project overview — shows pending count with "Generate" trigger button
- Supabase tables: `feedback_sessions`, `feedback_messages`, `feedback_themes`, `proposals`, `strategy_memory`, `user_ideas` (feedback_chat schema, RLS enabled)
- Widget persistence: `createFeedbackHandler` accepts optional `supabase` config for fire-and-forget conversation storage
- Dashboard uses `@ai-sdk/anthropic` + `ai` (v6) + `zod` for AI classification/digest
- Glass-card styling pattern: components use `glass-card`, `stat-card` CSS classes with Tailwind theme colors
- Dashboard async params: Next.js 15 route handlers use `const { projectId } = await params` pattern

## Proposals System (AI Strategist)

- **Purpose:** AI reads accumulated feedback themes and proposes product improvements for human review
- **Flow:** Feedback themes → strategize-worker (Claude Haiku multi-grader) → proposals table → dashboard review → approve → GitHub issue (auto-implement) → existing pipeline
- **Job type:** `strategize` — dispatched by managed-worker, runs `strategize-worker.ts`
- **Multi-grader evaluation:** Each proposal scored on 4 dimensions (impact, feasibility, novelty, alignment) — below 0.6 avg filtered out
- **Strategy memory:** `strategy_memory` table tracks proposal outcomes (approved/rejected) with edit distance to learn preferences
- **Edit distance:** Measures how much user changed the spec before approving (0 = unchanged, 1 = rewritten)
- **Progressive autonomy:** `autonomy_mode` column on projects (`audit` | `assist` | `automate`)
- **Cron trigger:** GitHub Actions `.github/workflows/strategize.yml` runs weekly Monday 9am UTC (+ manual dispatch)
- **Manual trigger:** "Generate" button on ProposalsCard calls `triggerStrategize` server action → job_queue
- **Tables:** `proposals` (id, project_id, title, rationale, spec, priority, status, scores, source_theme_ids), `strategy_memory` (id, project_id, proposal_id, event_type, themes, edit_distance), `user_ideas` (id, project_id, text, status)
- **New project columns:** `product_context` (text, vision/constraints), `autonomy_mode` (text, default 'audit'), `strategic_nudges` (text array, persistent directives for strategize runs)
- **Strategic nudges:** `projects.strategic_nudges` (text array) — persistent directives injected into strategize prompt as high-priority constraints
- **User ideas:** `user_ideas` table — submitted via dashboard, included in strategize prompt, marked `incorporated` or `dismissed` after each run
- **User proposals:** Users can create proposals directly (no AI scoring) — stored with empty `scores` object, shown with "User" badge

## Installing in a Consumer App

When asked to install this widget in a Next.js app, follow these steps exactly.

### Step 0: Choose a tier

**ALWAYS ask the user which tier they want before proceeding.** Do NOT infer the tier from env vars — the user may have GitHub credentials for other purposes. There are three tiers:

| Tier | What you get | What you need |
|------|-------------|---------------|
| **Chat only** | AI conversations, localStorage persistence | `ANTHROPIC_API_KEY` + `FEEDBACK_PASSWORD` |
| **+ GitHub** | Chat + auto-creates GitHub issues | + `GITHUB_TOKEN` + `GITHUB_REPO` |
| **+ Pipeline** | Chat + GitHub + agent writes code → PR → preview → approve | + `AGENT_URL` + Railway/Docker deployment |

If the user doesn't specify, default to **Chat only** and mention the other tiers are available.

### Before You Start

> **Common blockers that waste 30+ minutes if missed:**
>
> 1. **Tailwind v4 `@source` is mandatory** — the widget renders completely unstyled without it (Step 3)
> 2. **React 19.1.0 and 19.1.1 are excluded** by `@ai-sdk/react` — build will fail (Step 1)
> 3. **`FeedbackPanel` only accepts `isOpen` and `onToggle`** — no `statusUrl`, no `apiUrl` prop needed (it defaults to `/api/feedback/chat`)

### Step 1: Check React version

**This is a build breaker.** `@ai-sdk/react` explicitly excludes `react@19.1.0` and `19.1.1`.

Check: `npm ls react`

If the consumer has `react@19.1.0` or `19.1.1`, upgrade first:
```bash
npm install react@latest react-dom@latest
```

### Step 2: Install package + peer dependencies

```bash
npm install @nikitadmitrieff/feedback-chat @assistant-ui/react @assistant-ui/react-ai-sdk @assistant-ui/react-markdown ai @ai-sdk/anthropic
```

### Step 3: Configure Tailwind v4

Find the consumer's main CSS file (usually `globals.css` or `app/globals.css`). Add this line after `@import "tailwindcss"`:

```css
@source "../node_modules/@nikitadmitrieff/feedback-chat/dist/**/*.js";
```

This is CRITICAL. Without it, the widget renders completely unstyled because Tailwind v4 excludes `node_modules` from automatic content detection.

### Step 4: Create chat API route

Create `{app-dir}/api/feedback/chat/route.ts`.

**If Chat only:**

```ts
import { createFeedbackHandler } from '@nikitadmitrieff/feedback-chat/server'

const handler = createFeedbackHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  // projectContext: 'Brief description of your app for the AI advisor',
})

export const POST = handler.POST
```

**If + GitHub or + Pipeline:**

```ts
import { createFeedbackHandler } from '@nikitadmitrieff/feedback-chat/server'

const handler = createFeedbackHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  // projectContext: 'Brief description of your app for the AI advisor',
  github: {
    token: process.env.GITHUB_TOKEN!,
    repo: process.env.GITHUB_REPO!,
  },
})

export const POST = handler.POST
```

### Step 5: Create status API route

Create `{app-dir}/api/feedback/status/route.ts`.

**If Chat only:**

```ts
import { createStatusHandler } from '@nikitadmitrieff/feedback-chat/server'

const handler = createStatusHandler({
  password: process.env.FEEDBACK_PASSWORD!,
})

export const { GET, POST } = handler
```

**If + GitHub (no agent):**

```ts
import { createStatusHandler } from '@nikitadmitrieff/feedback-chat/server'

const handler = createStatusHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  github: {
    token: process.env.GITHUB_TOKEN!,
    repo: process.env.GITHUB_REPO!,
  },
  vercelBypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
})

export const { GET, POST } = handler
```

**If + Pipeline:**

```ts
import { createStatusHandler } from '@nikitadmitrieff/feedback-chat/server'

const handler = createStatusHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  github: {
    token: process.env.GITHUB_TOKEN!,
    repo: process.env.GITHUB_REPO!,
  },
  agentUrl: process.env.AGENT_URL,
  vercelBypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
})

export const { GET, POST } = handler
```

### Step 6: Create client wrapper component

Create a client component (e.g., `components/FeedbackButton.tsx`):

```tsx
'use client'

import { useState } from 'react'
import { FeedbackPanel } from '@nikitadmitrieff/feedback-chat'
import '@nikitadmitrieff/feedback-chat/styles.css'

export function FeedbackButton() {
  const [open, setOpen] = useState(false)
  return <FeedbackPanel isOpen={open} onToggle={() => setOpen(!open)} />
}
```

### Step 7: Add to layout

In the root layout (Server Component), import and render the client wrapper:

```tsx
import { FeedbackButton } from '@/components/FeedbackButton'

// Inside the <body>:
<FeedbackButton />
```

### Step 8: Environment variables

Add to `.env.local`:

**Chat only:**

```env
ANTHROPIC_API_KEY=sk-ant-...       # Required
FEEDBACK_PASSWORD=your-password    # Required
```

**+ GitHub:**

```env
ANTHROPIC_API_KEY=sk-ant-...       # Required
FEEDBACK_PASSWORD=your-password    # Required
GITHUB_TOKEN=ghp_...              # MUST be a PAT (ghp_ prefix), NOT an OAuth token (gho_)
GITHUB_REPO=owner/repo            # e.g. nikitadmitrieff/my-app
VERCEL_AUTOMATION_BYPASS_SECRET=...# Recommended — see Step 8b
```

**IMPORTANT: `GITHUB_TOKEN` must start with `ghp_` (Personal Access Token).** Tokens starting with `gho_` are short-lived GitHub OAuth tokens that expire after ~8 hours. Generate a PAT at https://github.com/settings/tokens/new with `repo` + `workflow` scopes.

> **WARNING:** `gh auth token` returns a short-lived `gho_` OAuth token that expires in ~8h. Do NOT use it as `GITHUB_TOKEN`. Generate a PAT (`ghp_` prefix) at github.com/settings/tokens/new with `repo` + `workflow` scopes.

**+ Pipeline:**

```env
ANTHROPIC_API_KEY=sk-ant-...       # Required
FEEDBACK_PASSWORD=your-password    # Required
GITHUB_TOKEN=ghp_...              # MUST be a PAT (ghp_ prefix)
GITHUB_REPO=owner/repo            # e.g. nikitadmitrieff/my-app
AGENT_URL=https://your-agent.railway.app
VERCEL_AUTOMATION_BYPASS_SECRET=...# Recommended — see Step 8b
```

### Step 8b: Configure Vercel preview bypass (+ GitHub and + Pipeline)

> **WARNING: Vercel SSO protection blocks webhook deliveries.** If your Vercel project uses team SSO, `*.vercel.app` URLs return 401 for all unauthenticated requests — including GitHub webhooks. Use a **custom domain** to bypass SSO protection.

**This step is required if your Vercel project has Deployment Protection enabled** (on by default for Pro/Enterprise plans). Without it, preview URLs in the widget return 401 and users can't see the agent's changes.

1. Go to your Vercel project → **Settings** → **Deployment Protection**
2. Under **Protection Bypass for Automation**, click **Generate Secret**
3. Copy the generated secret
4. Add it as `VERCEL_AUTOMATION_BYPASS_SECRET` in your `.env.local` **and** in your Vercel project's Environment Variables (so preview builds can also access it)

The status handler automatically appends this secret to preview URLs, bypassing Deployment Protection without disabling it.

> **How it works:** Vercel's bypass appends `?x-vercel-protection-bypass=<secret>` to the URL and sets a cookie so subsequent navigations on the preview also work. This is Vercel's official mechanism for CI/CD and automation tools.

### Step 9: Create GitHub labels (+ GitHub and + Pipeline only)

The package uses specific labels to track pipeline state. Create them on the consumer's repo:

```bash
gh label create feedback-bot --color 0E8A16 --description "Created by feedback widget"
gh label create auto-implement --color 1D76DB --description "Agent should implement this"
gh label create in-progress --color FBCA04 --description "Agent is working on this"
gh label create agent-failed --color D93F0B --description "Agent build/lint failed"
gh label create preview-pending --color C5DEF5 --description "PR ready, preview deploying"
gh label create rejected --color E4E669 --description "User rejected changes"
```

### Step 10: Deploy the agent (+ Pipeline only)

The agent is a separate service. The npm consumer doesn't have it — they need to clone it:

```bash
git clone https://github.com/NikitaDmitrieff/feedback-chat
cd feedback-chat/packages/agent
```

#### Claude authentication for the agent

The agent needs Claude Code CLI to implement changes. Two options:

**Option A: Claude Max subscription (recommended, $0/run)**

Extract and validate your OAuth credentials using the built-in script:
```bash
cd packages/agent
npm run credentials
```

This reads from the macOS keychain, tests the refresh token against Anthropic's OAuth endpoint, and prints a fresh `CLAUDE_CREDENTIALS_JSON` to stdout. Pipe-friendly:
```bash
npm run credentials 2>/dev/null | pbcopy   # copy to clipboard
```

> **OAuth tokens expire.** If the agent fails with `authentication_error` or `invalid_grant`, re-run `npm run credentials` to get fresh tokens and update the agent's env vars.

> **Note:** `~/.claude/.credentials.json` is written by the *agent inside Docker* from `CLAUDE_CREDENTIALS_JSON` — it does NOT exist on your local machine.

Set `CLAUDE_CREDENTIALS_JSON`. The agent uses `CLAUDE_CODE_OAUTH_TOKEN` internally to authenticate the CLI in headless Docker — this requires the Dockerfile to include `{"hasCompletedOnboarding": true}` in `~/.claude.json` (already configured).

**Option B: API key (pay per token)**

Set `ANTHROPIC_API_KEY` on the agent service. Simpler but costs per token.

#### Railway deployment

**IMPORTANT: When setting env vars on Railway, generate a single script the user can run themselves. Source values from `.env.local` — never read or echo secrets through individual tool calls.**

The Railway CLI workflow has specific ordering requirements:

```bash
# 1. Install CLI and login
npm install -g @railway/cli
railway login

# 2. Create project (from the packages/agent directory)
railway init

# 3. First deploy — creates the service
railway up --detach

# 4. Find and link the service (needed for variable management)
railway service status --all    # note the service name
railway service link <name>     # link it

# 5. Set env vars (Railway auto-redeploys on changes)
railway variables set GITHUB_TOKEN=ghp_...
railway variables set GITHUB_REPO=owner/repo
railway variables set WEBHOOK_SECRET=$(openssl rand -hex 32)
# Choose one auth method:
railway variables set CLAUDE_CREDENTIALS_JSON='{"claudeAiOauth":{...}}'
# or:
railway variables set ANTHROPIC_API_KEY=sk-ant-...

# 6. Get public domain
railway domain    # Save this URL for AGENT_URL and webhook
```

> **Railway CLI tips:**
> - `railway domain` outputs `Service Domain created: 🚀 https://...` — extract URL with `grep -oE 'https://[^ ]+'`
> - `railway service link` accepts the service name (from `railway service status --all`) or service ID
> - `railway variables set` can batch: `railway variables set KEY1=val1 KEY2=val2`

#### Docker deployment

```bash
cd packages/agent
docker build -t feedback-agent .
docker run -p 3000:3000 --env-file .env feedback-agent
```

### Step 11: Configure GitHub webhook (+ Pipeline only)

1. Go to repo → **Settings** → **Webhooks** → **Add webhook**
2. **Payload URL:** `https://<your-agent>.railway.app/webhook/github`
3. **Content type:** `application/json`
4. **Secret:** same value as `WEBHOOK_SECRET` on the agent
5. **Events:** Select "Let me select individual events" → check **Issues** only (the handler accepts `opened`, `reopened`, and `labeled` actions)
6. Click **Add webhook**

Or automate (**note the `config[content_type]=json` — without it, GitHub sends `form-urlencoded` and the agent returns 415**):

```bash
gh api repos/OWNER/REPO/hooks \
  -f name=web -F active=true \
  -f "config[url]=https://your-agent.railway.app/webhook/github" \
  -f "config[content_type]=json" \
  -f "config[secret]=WEBHOOK_SECRET_VALUE" \
  -f 'events[]=issues'
```

### Step 12: Verify

1. Run `npm run dev`
2. Open the app — you should see a feedback trigger bar at the bottom-center
3. Click it, enter your feedback password, send a message
4. The AI should respond and you can have a conversation
5. **(+ GitHub / + Pipeline)** Verify labels exist: `gh label list | grep feedback-bot`
6. **(+ GitHub)** Submit feedback and check the repo's Issues tab for a new issue with `feedback-bot` label
7. **(+ Pipeline)** The PipelineTracker should show stage progression: created → queued → running → validating → preview_ready
8. **(+ Pipeline)** At `preview_ready`, approve/reject/request changes buttons should appear

### Step 13: Update consumer's CLAUDE.md

Add this section to the consumer project's CLAUDE.md:

**Chat only:**

```markdown
## Feedback Widget

- Uses `@nikitadmitrieff/feedback-chat` for the feedback chatbot
- API routes: `/api/feedback/chat` (POST) and `/api/feedback/status` (GET, POST)
- Client: `<FeedbackPanel>` in a 'use client' wrapper, requires styles.css import
- Tailwind v4: `@source` directive in globals.css scans widget's dist for utility classes
- Env vars: `ANTHROPIC_API_KEY`, `FEEDBACK_PASSWORD`
- The widget is self-contained with its own dark theme — do not override its CSS
- localStorage keys: `feedback_conversations`, `feedback_conv_{id}`, `feedback_active_conv`
```

**+ GitHub:**

```markdown
## Feedback Widget

- Uses `@nikitadmitrieff/feedback-chat` for the feedback chatbot
- API routes: `/api/feedback/chat` (POST) and `/api/feedback/status` (GET, POST)
- Client: `<FeedbackPanel>` in a 'use client' wrapper, requires styles.css import
- Tailwind v4: `@source` directive in globals.css scans widget's dist for utility classes
- Env vars: `ANTHROPIC_API_KEY`, `FEEDBACK_PASSWORD`, `GITHUB_TOKEN`, `GITHUB_REPO`
- GitHub labels: `feedback-bot`, `auto-implement`, `in-progress`, `agent-failed`, `preview-pending`, `rejected`
- The widget is self-contained with its own dark theme — do not override its CSS
- localStorage keys: `feedback_conversations`, `feedback_conv_{id}`, `feedback_active_conv`
```

**+ Pipeline:**

```markdown
## Feedback Widget

- Uses `@nikitadmitrieff/feedback-chat` for the feedback chatbot
- API routes: `/api/feedback/chat` (POST) and `/api/feedback/status` (GET, POST)
- Client: `<FeedbackPanel>` in a 'use client' wrapper, requires styles.css import
- Tailwind v4: `@source` directive in globals.css scans widget's dist for utility classes
- Env vars: `ANTHROPIC_API_KEY`, `FEEDBACK_PASSWORD`, `GITHUB_TOKEN`, `GITHUB_REPO`, `AGENT_URL`
- GitHub labels: `feedback-bot`, `auto-implement`, `in-progress`, `agent-failed`, `preview-pending`, `rejected`
- Pipeline stages: created → queued → running → validating → preview_ready → deployed (+ failed/rejected)
- Agent deployed on Railway/Docker, webhook on Issues events
- The widget is self-contained with its own dark theme — do not override its CSS
- localStorage keys: `feedback_conversations`, `feedback_conv_{id}`, `feedback_active_conv`
```

## Infrastructure

### Vercel (Dashboard)

- **Project:** `nikitas-projects-a6f0a03c/dashboard` (project ID: `prj_gVz3JOXhJZSYZRKFYq16ZvZlAlJM`)
- **Production URL:** https://loop.joincoby.com
- **Default Vercel URL:** https://feedback-chat-dashboard.vercel.app (do not use — custom domain is canonical)
- **Root directory setting:** `packages/dashboard` — deploy from repo root or use `vercel redeploy`, NOT `vercel --prod` from `packages/dashboard/` (causes doubled path error)
- **Domain:** `feedback.chat` registered, `loop.joincoby.com` is the active production alias
- **Linked locally:** `packages/dashboard/.vercel/` — do NOT create a `.vercel/` at repo root (causes a duplicate project)
- **Env vars (production):** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`, `TURBO_DISABLED`, `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`
- **Auto-deploys** on push to `main` via Vercel Git integration

### Supabase

- **Project ref:** `lilcfbtohnhegxmpcfpb`
- **URL:** https://lilcfbtohnhegxmpcfpb.supabase.co
- **Schema:** `feedback_chat` (agent queries with `{ db: { schema: 'feedback_chat' } }`)
- **Tables:** `projects`, `job_queue`, `credentials`, `system_credentials`, `api_keys`, `run_logs`, `feedback_sessions`, `feedback_messages`, `feedback_themes`, `pipeline_runs`
- **`system_credentials`:** persists agent OAuth tokens across container restarts (key: `system_claude_oauth`)
- **Migrations:** `packages/dashboard/supabase/migrations/`

### GitHub App

- **Name:** looper-agent
- **App ID:** 2891060
- **Settings:** https://github.com/settings/apps/looper-agent
- **Public page:** https://github.com/apps/looper-agent
- **Setup URL (post-install redirect):** https://loop.joincoby.com/auth/github-app/setup
- **Webhook endpoint:** https://loop.joincoby.com/api/github-app/webhook
- **Private key:** stored in `packages/dashboard/.env.local` and `packages/agent/.env` as `GITHUB_APP_PRIVATE_KEY` (escaped `\n` format)
- **Code:** `packages/dashboard/src/lib/github-app.ts` (shared App singleton), `packages/agent/src/github-app.ts`

### Agent (Railway)

- **Railway project:** `postbac-agent` (ID: `ab0d7182-01e7-4f14-83c4-898ebdd9edfd`)
- **Service:** `postbac-agent` (ID: `ffbb52ca-c5e6-4fbf-9e39-d9241fa2f357`)
- **Public domain:** `postbac-agent-production.up.railway.app`
- **Source:** `packages/agent/`
- **Dockerfile:** multi-stage build, CMD is `managed-worker.js` (polls Supabase `job_queue`)
- **Auth:** OAuth (`CLAUDE_CREDENTIALS_JSON`) for Claude CLI jobs + `ANTHROPIC_API_KEY` for Haiku classification
- **OAuth auto-refresh:** tokens are refreshed before each job and persisted to Supabase `system_credentials` table. On container restart, the agent reads from Supabase (not the env var). You should only need to run `npm run credentials` once to seed the initial token.
- **Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `CLAUDE_CREDENTIALS_JSON`, `ANTHROPIC_API_KEY` (for Haiku classifier)
- **Deploy:** `cd packages/agent && railway up --detach`
- **Start command:** `npm start` runs `managed-worker.js` (not `server.js` — that's the legacy Fastify server)
- **Linked locally:** `packages/agent/` is linked to this Railway project via `railway` CLI
- **Job retry:** stale jobs (stuck in `processing` >30min) are reaped — retried up to 3 attempts with exponential backoff, or marked `failed` if exhausted. OAuth errors (`authentication_error`, `invalid_grant`, 401) are permanent failures (no retry). Columns: `job_queue.attempt_count`, `job_queue.last_error`
- **Self-improvement:** when runs fail, the agent classifies the failure with Haiku (categories: `docs_gap`, `widget_bug`, `agent_bug`, `consumer_error`, `transient`). For our-fault failures, it spawns a `self_improve` job that clones feedback-chat, runs Claude CLI with the failure context, and creates a PR. Self-improvement jobs never recursively spawn more self-improvement jobs.
- **New columns:** `pipeline_runs.failure_category`, `pipeline_runs.failure_analysis`, `pipeline_runs.improvement_job_id`; `job_queue.source_run_id`

### GitHub Repo

- **URL:** https://github.com/NikitaDmitrieff/feedback-chat
- **Main branch:** `main`
- **npm package:** `@nikitadmitrieff/feedback-chat` (published from `packages/widget/`)

## Gotchas

- `react@19.1.0` and `19.1.1` are excluded by `@ai-sdk/react` — consumer needs `>=19.1.2`. **Check before installing.**
- Tailwind v4 does NOT scan `node_modules` — the `@source` directive is mandatory
- FeedbackPanel MUST be in a `'use client'` component (uses useState, useEffect, sessionStorage)
- The `styles.css` import is required — without it the widget has no glassmorphism theme
- The widget renders as a fixed-position side panel (right edge) + bottom-center trigger bar
- For + Pipeline: `agentUrl` must be passed to `createStatusHandler` or the tracker can't check agent status
- GitHub labels must be created on the consumer's repo before the pipeline can function
- `GITHUB_TOKEN` must be a PAT (`ghp_` prefix). OAuth tokens (`gho_`) expire after ~8 hours and will silently break issue creation
- The agent Dockerfile uses a multi-stage build — `dist/` is NOT expected pre-built, it compiles in the builder stage. The CMD is `managed-worker.js` (polls Supabase job_queue), NOT `server.js` (standalone Fastify)
- The agent runs as a non-root `agent` user — Claude Code CLI refuses `--dangerously-skip-permissions` as root
- The agent uses `CLAUDE_CODE_OAUTH_TOKEN` env var (not credentials file) to authenticate the CLI in headless Docker. This requires `~/.claude.json` with `{"hasCompletedOnboarding": true}` (see [anthropics/claude-code#8938](https://github.com/anthropics/claude-code/issues/8938))
- Claude Max OAuth tokens expire — the agent auto-refreshes and persists to Supabase `system_credentials`. If it still fails with `authentication_error`, run `cd packages/agent && npm run credentials` (may require `claude login` first), then `railway variables set CLAUDE_CREDENTIALS_JSON='...'`
- The agent's `package.json` `start` script MUST point to `managed-worker.js`, not `server.js` — Railway/Nixpacks runs `npm start` and ignores the Dockerfile CMD
- Vercel team SSO protection blocks `*.vercel.app` webhook URLs with 401 — use a custom domain to bypass it
- The webhook handler accepts `labeled` events (when `auto-implement` is added), so users can re-trigger by toggling the label — not just `opened`/`reopened`
- When creating GitHub webhooks via `gh api`, you MUST use `config[content_type]=json` — the default is `form-urlencoded` which the Fastify agent rejects with 415
- When creating GitHub webhooks via `gh api`, use `-F active=true` (capital F) — lowercase `-f` sends the string `"true"` and GitHub returns 422
- `ANTHROPIC_API_KEY` is required in the consumer's `.env.local` — the AI chat handler reads it from the environment to create the Anthropic client
- `GITHUB_TOKEN` and `GITHUB_REPO` must be in `.env.local` or passed to both `createFeedbackHandler` and `createStatusHandler` — without them, issue creation silently fails and the status panel breaks
- After installing the widget routes, the consumer should restart the dev server — HMR may not pick up new route files
- Next.js 15+ with Turbopack may have cache corruption issues after dependency changes — if routes return 404 or the dev server panics, clear `.next/` and restart (or use `--turbopack=false`)
- `self_improve` jobs use `GITHUB_TOKEN` env var (not installation tokens) to push to `NikitaDmitrieff/feedback-chat`. For self-improvement to work, the agent needs a PAT (`ghp_` prefix) with push access to the feedback-chat repo — GitHub App installation tokens are scoped to consumer repos and won't work
- Self-improvement jobs that fail do NOT spawn further self-improvement jobs (hard recursion guard)
- The Haiku classification requires `ANTHROPIC_API_KEY` — OAuth tokens do NOT work for direct Anthropic API calls (only for Claude Code CLI). Without `ANTHROPIC_API_KEY`, classification is silently skipped

## Credential Security

When helping users set up the agent, **never read or echo secrets through individual tool calls**. Instead, generate a single bash script the user can run themselves that sources values from `.env.local` and system keychains. This avoids dozens of permission prompts for each secret.
