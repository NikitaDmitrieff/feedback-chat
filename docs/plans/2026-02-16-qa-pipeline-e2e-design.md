# Full Pipeline E2E Test Suite — Design

## Goal

Test the complete feedback-chat pipeline end-to-end: submit feedback → GitHub issue → agent implementation → PR → Vercel preview → approve → merge → verify. Catches regressions across the entire system after every deploy.

## Architecture

Hybrid approach — Playwright for user interactions (submit feedback, approve changes), direct GitHub API + Supabase queries for state verification and polling. Real agent runs using Claude Max subscription.

## Infrastructure

### Sandbox Repository (`NikitaDmitrieff/qa-feedback-sandbox`)

A minimal Next.js app with one page. The agent's task is to add a `<footer id="qa-test-footer">Built with feedback-chat</footer>`.

**Required setup:**
- `app/page.tsx`: Simple homepage with a heading
- `package.json`: Next.js + build/lint scripts
- GitHub webhook → deployed Railway agent `/webhook/github` (Issues events, JSON content type)
- All 6 pipeline labels: `feedback-bot`, `auto-implement`, `in-progress`, `agent-failed`, `preview-pending`, `rejected`
- Vercel project connected for preview deploys

### Agent Configuration

The deployed Railway agent processes any repo that sends it a webhook — no changes needed. The sandbox repo fires webhooks like any other consumer repo.

### Dashboard Project

Each test run creates a dashboard project pointing to `NikitaDmitrieff/qa-feedback-sandbox` via Supabase admin API (same pattern as onboarding tests). Cleaned up afterward.

## Test Structure

### File Organization

```
packages/dashboard/tests/e2e/
├── onboarding.spec.ts          # Existing — 5 tests
├── pipeline.spec.ts            # NEW — full pipeline E2E
└── helpers/
    ├── auth.ts                 # Existing — signIn(), createTestProject()
    ├── seed.ts                 # Existing — adminClient(), cleanupTestProjects()
    ├── report.ts               # Existing — failure reporter
    ├── pipeline.ts             # NEW — GitHub API helpers, polling, cleanup
    └── sandbox.ts              # NEW — sandbox repo reset + state verification
```

### Test Flow (`pipeline.spec.ts`)

One `test.describe.serial()` block with 7 ordered tests sharing state via module-scope variables:

| # | Test | What It Does | Verification |
|---|------|-------------|--------------|
| 1 | Submit feedback | Sign in, create project → sandbox repo, submit feedback via widget | GitHub issue exists with `feedback-bot` + `auto-implement` labels |
| 2 | Agent picks up issue | Poll GitHub labels (max 60s) | `in-progress` label appears |
| 3 | Agent completes | Poll GitHub labels (max 180s) | `preview-pending` label, PR exists on `feedback/issue-{N}` |
| 4 | Preview deploys | Poll deployment status (max 120s) | Deployment `success`, preview URL reachable |
| 5 | Preview correct | Playwright navigates to preview URL | `#qa-test-footer` visible with expected text |
| 6 | Approve merges | Playwright clicks Approve in PipelineTracker | PR merged, issue closed (GitHub API) |
| 7 | Cleanup | Reset sandbox, delete project, close artifacts | Sandbox main branch at known-good SHA |

### Shared State

```typescript
let issueNumber: number
let projectId: string
let prNumber: number
let previewUrl: string
```

### Timeout Strategy

- Tests 1, 5, 6, 7: 30s each
- Test 2: 90s (agent startup + clone + install)
- Test 3: 240s (Claude CLI + validation)
- Test 4: 180s (Vercel build + deploy)
- Overall spec: 10 minutes

## Helper Functions

### `pipeline.ts`

```typescript
waitForLabel(repo, issueNumber, label, timeoutMs)    // Poll issue for label
waitForDeployment(repo, prNumber, timeoutMs)          // Poll PR deployments
getPreviewUrl(repo, headSha)                          // Extract preview URL
getIssueState(repo, issueNumber)                      // Labels + open/closed
findPR(repo, branch)                                  // Find PR by branch name
closeArtifacts(repo, issueNumber, prNumber)           // Close PR, issue, delete branch
```

### `sandbox.ts`

```typescript
resetSandbox(repo, knownGoodSha)                      // Force-push main to known SHA
verifySandboxClean(repo)                               // No open qa-test artifacts
```

## CI Integration

### Workflow: `.github/workflows/qa-pipeline.yml`

Separate from onboarding — different timeout profile (10 min vs 20s) and agent dependency.

**Triggers:** `workflow_dispatch`, `deployment_status:success`, `issues:closed` (with `qa-pipeline` label)

**Pre-check:** Agent health check (`GET {AGENT_URL}/health`) — skip test if agent is down or busy.

**Error reporting:** Same pattern as onboarding — auto-file issue with `qa-pipeline` label on failure, auto-close on success.

### Secrets & Variables

| Name | Type | Purpose |
|------|------|---------|
| `DASHBOARD_URL` | var | Dashboard base URL |
| `NEXT_PUBLIC_SUPABASE_URL` | secret | Supabase project creation |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | Admin API access |
| `QA_TEST_EMAIL` | var | Test user email |
| `QA_TEST_PASSWORD` | secret | Test user password |
| `GITHUB_TOKEN` | secret | GitHub API for sandbox repo |
| `AGENT_URL` | var | Agent health check |
| `SANDBOX_REPO` | var | `NikitaDmitrieff/qa-feedback-sandbox` |
| `SANDBOX_KNOWN_GOOD_SHA` | var | Commit to reset to after each run |

## Failure Modes

| Point | Behavior | Recovery |
|-------|----------|----------|
| Agent down | Health check fails, test skipped | Fix agent, re-trigger |
| Agent fails (build/lint) | Test 3 times out | Auto-issue filed; cleanup runs |
| Vercel deploy fails | Test 4 times out | Auto-issue filed; cleanup runs |
| Wrong preview content | Test 5 assertion fails (with screenshot) | Auto-issue filed; cleanup runs |
| Approve fails | Test 6 assertion fails | Auto-issue filed; cleanup runs |
| Cleanup fails | Test 7 fails | Next run's `verifySandboxClean()` force-resets |

## Idempotency

Before starting, the test verifies the sandbox is clean (no open `qa-test-*` issues/PRs). Leftover artifacts from failed runs are cleaned up before proceeding.

## Label State Machine Reference

```
Issue created:     feedback-bot + auto-implement        → queued
Agent picks up:    + in-progress                        → running
Agent succeeds:    − auto-implement − in-progress       → validating → preview_ready
                   + preview-pending
Agent fails:       − in-progress + agent-failed         → failed
User approves:     PR merged, issue closed              → deployed
User rejects:      + rejected, PR closed, issue closed  → rejected
User requests Δ:   − preview-pending + auto-implement   → queued (retry)
                   (close + reopen)
```
