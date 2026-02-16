# Managed Platform Design — feedback-chat

**Date:** 2026-02-15
**Status:** Approved
**Approach:** Hybrid (open-source widget + hosted agent service)

## Context

feedback-chat is an npm package that provides an AI feedback widget for Next.js apps. It has 3 tiers: Chat-only, +GitHub (auto-creates issues), and +Pipeline (agent writes code → PR). The Pipeline tier requires users to clone the repo and deploy the agent to Railway/Docker — this is the biggest friction point.

## Goal

Turn feedback-chat into a managed platform where users skip agent deployment entirely. Ship as Approach 2 (Proxy Mode) first, then upgrade to Approach 1 (GitHub App) later.

## Constraints

- **Stack target:** Next.js + GitHub first
- **Cost model:** BYOK (users bring their own Anthropic key / Claude OAuth)
- **Data model:** Flat (user → projects → runs), no organizations yet
- **Infra:** Vercel (dashboard) + Supabase (DB + auth) + Railway (worker)
- **Security/scale:** MVP-grade, harden later

## Data Flow

### Current (self-hosted Tier 3)

```
User → Widget → consumer's /api/feedback/chat → Anthropic (BYOK)
              → consumer's /api/feedback/status → user's Railway agent /health
GitHub webhook → user's Railway agent → clone → Claude CLI → PR
```

### Approach 2 (hosted agent)

```
User → Widget → consumer's /api/feedback/chat → Anthropic (BYOK)  [unchanged]
              → consumer's /api/feedback/status → platform API      [URL swap]
GitHub webhook → platform API → queue → managed worker → clone → Claude CLI (user's creds) → PR
```

### What the user no longer does

- Clone the feedback-chat repo
- Deploy to Railway/Docker
- Manage a Dockerfile, agent env vars, agent uptime
- Debug Docker/Railway issues

### What the user still does (eliminated in Approach 1 later)

- npm install + route files
- Set up GitHub PAT
- Configure a webhook pointing to the platform
- Provide Claude credentials (stored in dashboard)

## System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Consumer's Next.js App                                       │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────────┐  │
│  │ FeedbackPanel │  │ /api/feedback/ │  │ /api/feedback/   │  │
│  │ (widget)      │→ │ chat           │  │ status           │  │
│  └──────────────┘  └────────────────┘  └───────┬──────────┘  │
│                                                 │             │
└─────────────────────────────────────────────────┼─────────────┘
                          agentUrl=https://app.feedback.chat/...│
                                                  ▼
┌──────────────────────────────────────────────────────────────┐
│  Platform (Vercel + Supabase + Railway)                       │
│                                                               │
│  ┌─────────────────────┐    ┌───────────────────────────┐    │
│  │ Dashboard (Vercel)   │    │ Platform API (Vercel)      │    │
│  │                      │    │                            │    │
│  │ - Sign up / login    │    │ POST /api/webhook/:projId  │    │
│  │ - Create project     │    │ GET  /api/agent/:projId/   │    │
│  │ - View runs          │    │       health               │    │
│  │ - Manage credentials │    │ GET  /api/runs/:projId     │    │
│  │ - Collaborator view  │    │ POST /api/runs/.../action  │    │
│  └──────────┬──────────┘    └────────────┬───────────────┘    │
│             │                             │                    │
│             ▼                             ▼                    │
│  ┌───────────────────────────────────────────────────────┐    │
│  │ Supabase                                               │    │
│  │ Auth: users, sessions                                  │    │
│  │ Tables: projects, api_keys, credentials,               │    │
│  │         job_queue, pipeline_runs, run_logs              │    │
│  └────────────────────────────┬──────────────────────────┘    │
│                                │                               │
│                                ▼                               │
│  ┌────────────────────────────────┐                           │
│  │ Worker Pool (Railway)           │                           │
│  │ Polls job_queue → runs pipeline │                           │
│  │ Writes run_logs back            │                           │
│  └─────────────────────────────────┘                           │
└───────────────────────────────────────────────────────────────┘
```

## Supabase Schema

```sql
-- Users come from Supabase Auth (auth.users)

create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  github_repo text not null,
  webhook_secret text not null,
  created_at timestamptz default now()
);

create table api_keys (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  key_hash text not null,
  prefix text not null,
  created_at timestamptz default now()
);

create table credentials (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  type text not null check (type in ('anthropic_api_key', 'claude_oauth')),
  encrypted_value text not null,
  created_at timestamptz default now()
);

create table job_queue (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  github_issue_number int not null,
  issue_body text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed')),
  worker_id text,
  locked_at timestamptz,
  created_at timestamptz default now(),
  completed_at timestamptz
);

create table pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references job_queue(id) on delete cascade,
  project_id uuid references projects(id),
  github_issue_number int not null,
  github_pr_number int,
  stage text not null,
  triggered_by text,
  started_at timestamptz default now(),
  completed_at timestamptz,
  result text check (result in ('success', 'failed', 'rejected'))
);

create table run_logs (
  id bigint generated always as identity primary key,
  run_id uuid references pipeline_runs(id) on delete cascade,
  timestamp timestamptz default now(),
  level text default 'info',
  message text not null
);
```

## Dashboard Pages

- **`/login`** — Supabase Auth (email + GitHub OAuth)
- **`/projects`** — Project list with last run status, run count
- **`/projects/new`** — 3-step wizard: name + repo, credentials, integration details (API key, webhook URL, snippet)
- **`/projects/[id]`** — Runs tab (table: issue #, triggered by, stage, duration, result, PR link) + Settings tab
- **`/projects/[id]/runs/[runId]`** — Full run detail with timeline and log output

Collaborator activity is visible via `triggered_by` (GitHub username from the issue creator) — no invite system needed for MVP.

## Platform API Routes

All live inside the dashboard Next.js app as route handlers.

| Route | Auth | Purpose |
|-------|------|---------|
| `POST /api/webhook/:projectId` | HMAC signature | Receives GitHub events, enqueues jobs |
| `GET /api/agent/:projectId/health` | API key | Status proxy (same shape widget expects) |
| `GET /api/runs/:projectId` | Supabase session | Dashboard run history |
| `POST /api/runs/:projectId/:runId/action` | API key | Retry, approve, reject actions |

## Worker Changes

The current agent becomes a managed worker with 3 changes:

1. **Input:** Polls `job_queue` table instead of receiving HTTP webhooks
2. **Credentials:** Fetches from Supabase per job instead of env vars
3. **Output:** Writes to `run_logs` table instead of stdout

Core pipeline logic (clone → Claude CLI → validate → PR) is unchanged. One worker, sequential jobs.

## Codebase Changes

| Package | Change |
|---------|--------|
| `packages/widget` | None. `agentUrl` already works. |
| `packages/agent` | Refactor to poll Supabase queue, fetch creds per job, write logs to DB |
| `packages/dashboard` (new) | Next.js app: auth, project management, run viewer, API routes |

## User Experience After MVP

1. Sign up at dashboard
2. Create project → get API key + webhook URL
3. `npm install` the widget (same as today)
4. Set `AGENT_URL` + `FEEDBACK_CHAT_API_KEY` in `.env.local`
5. Add webhook to GitHub repo (one copy-paste)
6. Done — no Docker, no Railway, no agent deployment

## Approach 1 Upgrade Path

The GitHub App upgrade is additive — no rewrites:

- Add `github_installation_id` column to `projects`
- App installation replaces PATs (installation tokens)
- App receives webhooks directly (no manual webhook setup)
- App creates labels on install
- Existing Approach 2 users migrate by clicking "Connect GitHub App" in settings
- Worker, dashboard, API, widget, schema all stay the same
