# Autonomous Agents — What's Built & How It Works

> Last updated: 2026-02-19

## Overview

There are **4 autonomous agent pipelines** and **2 QA workflows** implemented. All agent jobs flow through a single managed worker (`packages/agent/src/managed-worker.ts`) that polls a Supabase `job_queue` every 5 seconds.

```
                         ┌─────────────────────────────────┐
                         │        managed-worker.ts         │
                         │   polls job_queue every 5s       │
                         │   claims jobs with FOR UPDATE    │
                         │   SKIP LOCKED (no double-claim)  │
                         └──────────┬──────────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │                    │
         job_type:             job_type:            job_type:            job_type:
          agent               setup              self_improve          strategize
              │                     │                     │                    │
         worker.ts          setup-worker.ts    self-improve-worker.ts   strategize-worker.ts
              │                     │                     │                    │
      Clone consumer repo    Clone consumer repo   Clone feedback-chat    Read feedback data
      Run Claude CLI         Run Claude CLI         Run Claude CLI         Call Claude Haiku
      Build + Lint           Install widget         Build + Test           Score proposals
      Create PR              Create PR              Create PR              Insert to DB
```

---

## 1. Implement Pipeline

**What it does:** Takes a GitHub issue and turns it into a working PR with code changes.

**Trigger:** GitHub issue webhook — when an issue is `opened`, `reopened`, or has the `auto-implement` label added.

**Flow:**
```
GitHub issue (with auto-implement label)
  → webhook hits dashboard /api/github-app/webhook
  → job_queue row created (type: agent)
  → pipeline_runs row created (stage: queued)
  → managed-worker claims job
  → worker.ts:
      1. Clone consumer's repo (GitHub App installation token)
      2. npm install + write .env.local
      3. Pre-lint check (catch existing errors)
      4. Run Claude CLI with issue body as prompt (5min timeout)
      5. Build validation (npm run build)
      6. Lint validation (eslint, with 2 auto-fix attempts)
      7. Create branch: feedback/issue-{N}
      8. Force push + create PR
      9. Label: preview-pending
```

**Key files:**
- `packages/dashboard/src/app/api/github-app/webhook/route.ts` — webhook entry
- `packages/agent/src/worker.ts` — implementation logic
- `packages/agent/src/managed-worker.ts:306-328` — dispatcher

**How to test:** Create an issue on a connected repo with labels `feedback-bot` + `auto-implement`. The agent should pick it up within 5-10 seconds and start working. Watch Railway logs with `railway logs`.

---

## 2. Setup Pipeline

**What it does:** Auto-installs the feedback widget into a consumer's repo and creates a PR.

**Trigger:** "Set up my repo" button on the dashboard project page.

**Flow:**
```
Dashboard button → triggerSetup() server action
  → job_queue row (type: setup)
  → projects.setup_status = 'queued'
  → managed-worker claims job
  → setup-worker.ts:
      1. Clone consumer's repo
      2. Auto-detect repo from GitHub App installation if missing
      3. Run Claude CLI with installation prompt
         (installs widget, creates API routes, adds to layout)
      4. Build validation
      5. Create branch: feedback-chat/setup
      6. Create PR: "Add feedback-chat widget"
      7. Create 6 GitHub labels (feedback-bot, auto-implement, etc.)
      8. projects.setup_status = 'pr_created'
```

**Completion detection:** When the setup PR is merged, the webhook handler updates `setup_status = 'complete'`.

**Key files:**
- `packages/dashboard/src/app/projects/[id]/actions.ts` — triggerSetup()
- `packages/agent/src/setup-worker.ts` — setup logic

**How to test:** Install the GitHub App on a repo, create a project in the dashboard, click "Set up my repo". Watch the setup wizard progress in real-time.

---

## 3. Self-Fixing Bot

**What it does:** When an implement job fails, classifies the failure and — if it's our fault — creates a PR on the **feedback-chat repo itself** to fix the root cause.

**Trigger:** Automatic, when any implement job fails (after retry exhaustion or OAuth error).

**Flow:**
```
Implement job fails
  → handleFailedJob() in managed-worker.ts
  → Fetch run logs from run_logs table
  → classify-failure.ts calls Claude Haiku:
      Categories: docs_gap | widget_bug | agent_bug | consumer_error | transient
  → Store classification on pipeline_runs (failure_category, failure_analysis)
  → If category is docs_gap, widget_bug, or agent_bug:
      → Create new job (type: self_improve, source_run_id: failed run)
      → self-improve-worker.ts:
          1. Clone NikitaDmitrieff/feedback-chat
          2. Run Claude CLI with category-scoped prompt:
             - docs_gap → fix CLAUDE.md, setup prompts, README
             - widget_bug → fix packages/widget/ code
             - agent_bug → fix packages/agent/ code
          3. npm run build (must pass)
          4. npm run test (warns if fail, proceeds)
          5. Branch: fix/{category}-{runId.slice(0,8)}
          6. Create PR on feedback-chat repo
```

**Safety guards:**
- Recursion guard: self_improve and setup jobs never trigger the self-fix pipeline
- Only "our fault" categories spawn improvement jobs (consumer_error and transient are ignored)
- Max 3 retry attempts before marking as failed

**Key files:**
- `packages/agent/src/managed-worker.ts:126-224` — handleFailedJob()
- `packages/agent/src/classify-failure.ts` — Haiku classification
- `packages/agent/src/self-improve-worker.ts` — fix generation

**How to test:** Hard to trigger intentionally. You'd need a consumer repo where the implement job fails due to a widget/agent/docs issue. Check Railway logs for `[classify]` and `[self-improve]` prefixed messages. Check the [feedback-chat repo PRs](https://github.com/NikitaDmitrieff/feedback-chat/pulls) for `fix/*` branches.

**Requirements:** Needs both `ANTHROPIC_API_KEY` (for Haiku classification — OAuth doesn't work for direct API calls) and `GITHUB_TOKEN` (for pushing to feedback-chat repo).

---

## 4. Strategize Pipeline (NEW)

**What it does:** Reads accumulated user feedback themes and proposes product improvements. Human reviews and approves, which creates a GitHub issue that feeds into the implement pipeline.

**Trigger:**
- **Cron:** GitHub Actions workflow runs every Monday 9am UTC
- **Manual:** "Generate" button on the ProposalsCard in the dashboard
- **GitHub Actions dispatch:** `workflow_dispatch` with optional project_id

**Flow:**
```
Cron or manual trigger
  → job_queue row (type: strategize)
  → managed-worker claims job
  → strategize-worker.ts:
      1. Gather context:
         - Feedback themes (sorted by frequency)
         - Recent session summaries
         - Existing proposals (avoid duplicates)
         - Strategy memory (past rejections — learn from them)
         - Product context (vision/constraints)
      2. Claude Haiku generates 1-3 proposals
      3. Second Haiku call scores each on 4 dimensions:
         - Impact (user benefit based on theme frequency)
         - Feasibility (can an agent do this in one PR?)
         - Novelty (not already built or proposed)
         - Alignment (matches product vision)
      4. Filter: avg score < 0.6 → discarded
      5. Insert passing proposals to `proposals` table (status: draft)

Human reviews on dashboard (/projects/[id]/proposals):
  → Approve (optionally edit spec + add notes)
      → Creates GitHub issue with auto-implement label
      → Implement pipeline picks it up → PR
      → Records in strategy_memory (with edit distance)
  → Reject (with reason)
      → Records in strategy_memory (strategist learns to not re-propose)
```

**The closed loop:**
```
User feedback → themes → strategist → proposals → human review
    → approve → GitHub issue → implement pipeline → PR → deploy
    → more user feedback → better proposals next week
```

**Key files:**
- `packages/agent/src/strategize-worker.ts` — proposal generation
- `packages/dashboard/src/app/api/proposals/[projectId]/route.ts` — list + approve/reject API
- `packages/dashboard/src/app/projects/[id]/proposals/` — proposals page + actions
- `packages/dashboard/src/components/proposal-slide-over.tsx` — review UI
- `.github/workflows/strategize.yml` — weekly cron

**How to test:**
1. Go to a project on the dashboard that has feedback sessions/themes
2. Click "Generate" on the ProposalsCard
3. Wait ~30 seconds for the agent to process (check Railway logs for `[strategize]`)
4. Refresh the proposals page — you should see scored proposals
5. Click one to open the slide-over, review scores/spec, approve or reject

---

## 5. QA Workflows

Two GitHub Actions workflows that run E2E tests and auto-file issues on failure:

| Workflow | Tests | Labels on failure |
|----------|-------|-------------------|
| `qa-pipeline.yml` | `pipeline.spec.ts` | `feedback-bot`, `auto-implement`, `qa-pipeline` |
| `qa-onboarding.yml` | `onboarding.spec.ts` | `feedback-bot`, `auto-implement`, `qa-onboarding` |

**Trigger:** Manual dispatch, deployment success, or when a related QA issue is closed.

**Note:** These create issues with `auto-implement` — so the implement pipeline will attempt to fix test failures automatically.

---

## Infrastructure

| Component | Where | What |
|-----------|-------|------|
| Managed worker | Railway (`postbac-agent`) | Polls job_queue, dispatches all 4 job types |
| Dashboard | Vercel (`loop.joincoby.com`) | Webhook handler, proposals UI, setup wizard |
| Database | Supabase (`lilcfbtohnhegxmpcfpb`) | job_queue, pipeline_runs, proposals, strategy_memory |
| Cron | GitHub Actions | Weekly strategize, QA on deploy |

## Job Retry System

All jobs have automatic retry with exponential backoff:
- Max 3 attempts per job
- Stale job reaper runs every poll cycle (30min threshold)
- OAuth errors are permanent (no retry)
- `attempt_count` incremented atomically via `claim_next_job()` RPC

---

## Known Gaps

| Gap | Status | Notes |
|-----|--------|-------|
| Autonomy mode (`audit`/`assist`/`automate`) | Field exists, not enforced | Proposals always start as `draft` regardless |
| Proposal completion tracking | Schema ready, not wired | `implementing` and `done` statuses never set |
| PR merge detection | Not implemented | No webhook listens for merged PRs to update pipeline_runs |
| Self-fix requires ANTHROPIC_API_KEY | By design | OAuth tokens can't make direct API calls to Haiku |
| Mid-job token refresh | Not implemented | OAuth tokens refreshed only at job start |
