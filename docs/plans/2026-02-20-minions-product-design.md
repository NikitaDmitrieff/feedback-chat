# Minions — Product Design

**Date:** 2026-02-20
**Status:** Approved
**One-liner:** Connect your GitHub repo, get an AI dev team that never stops improving it.

## Overview

Minions is a SaaS product for solo developers. You connect a GitHub repo, and a swarm of AI workers continuously analyzes and improves it — code quality, infrastructure, new features, everything. The dashboard is the product. The branch graph is the killing feature.

Forked from the feedback-chat monorepo (strip the widget, keep the agent + dashboard + job queue).

## Target User

Solo developer who wants their project to get better while they sleep. Low ceremony, fast setup, affordable. Claude Max subscription for unlimited builder runs.

## User Journey

1. **Sign up** — GitHub OAuth. Land on empty dashboard.
2. **Connect a repo** — Pick from GitHub account. Minions installs a GitHub App.
3. **Onboarding scan** — Scout runs full analysis (5-10 min). Dashboard shows progress.
4. **First proposals** — Strategist turns findings into 5-10 prioritized proposals. Kanban view.
5. **Approve & watch** — Approve a proposal. Builder implements, Reviewer checks, PR appears. Live logs, diff preview, one-click merge.
6. **Continuous loop** — Scouts keep scanning (daily default). New proposals appear. Strategy memory learns preferences.
7. **Steer with nudges** — High-level directives: "focus on performance", "add dark mode", "never touch auth module".

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    DASHBOARD (Next.js)                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │  Onboard  │  │  Branch   │  │  Health   │  │ Nudges  │ │
│  │  + Repo   │  │  Graph    │  │  Score    │  │ + Ideas │ │
│  │  Connect  │  │  (live)   │  │  Trend    │  │         │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────┐
│                    SUPABASE                               │
│  projects · job_queue · proposals · findings              │
│  run_logs · strategy_memory · health_snapshots            │
│  branch_events                                            │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────┐
│               WORKER SWARM (Railway)                      │
│  Managed worker poll loop → dispatch by job_type          │
│  Scout (Haiku) · Strategist (Haiku)                       │
│  Builder (Claude CLI/Max) · Reviewer (Claude CLI/Max)     │
│  Stale reaper · Retry budget · Failure classification     │
└───────────────────────────────────────────────────────────┘
```

## Worker Types

### Scout
- **Trigger:** Cron (daily/configurable)
- **Runtime:** Haiku API via `ANTHROPIC_API_KEY`
- **What it does:** Clones repo, analyzes with tree-sitter + Haiku. Produces structured findings: code smells, missing tests, outdated deps, security, perf, dead code, docs gaps. Stores in `findings` table.

### Strategist
- **Trigger:** After Scout completes, or manual "Generate" button
- **Runtime:** Haiku API
- **What it does:** Reads findings + health history + strategy memory + user nudges + user ideas. Generates prioritized proposals. Multi-grader scoring (impact, feasibility, novelty, alignment). Filters avg < 0.6. Stores as `draft` proposals.

### Builder
- **Trigger:** User approves a proposal
- **Runtime:** Claude CLI (Max subscription — unlimited, free)
- **What it does:** Clones repo, runs Claude Code with the proposal spec. Builds, lints, tests. Creates PR on `minions/*` branch.

### Reviewer
- **Trigger:** Builder creates a PR
- **Runtime:** Anthropic SDK (Haiku or Sonnet) — frees CLI sessions for Builders
- **What it does:** Reads the Builder's diff via GitHub API. Checks for regressions, edge cases, style, security, file-path risk tiers. Posts review comments to the GitHub PR or approves. User sees only reviewed PRs.

### Cost Model
Scout, Strategist, and Reviewer: cheap Haiku/Sonnet API calls (~$0.25/$1.25 per MTok).
Builder: Claude CLI under Max subscription — effectively unlimited. Reviewer uses API to free CLI sessions for Builders (CLI concurrency ceiling ~14 sessions).

## The Branch Graph (Killing Feature)

Visual, interactive graph showing every action the minions have taken and will take.

```
main ─────●─────────●──────────●─────────●──────── →
          │         │          │         │
          │         │          │         └─ minions/add-error-boundaries
          │         │          │            ├─ ● Builder: implementing
          │         │          │            └─ ● Reviewer: pending
          │         │          │
          │         │          └─ minions/upgrade-react-19 (MERGED ✓)
          │         │             ├─ ● Scout found: outdated dep
          │         │             ├─ ● Strategist proposed (score: 0.82)
          │         │             ├─ ● Builder: 3 files changed
          │         │             ├─ ● Reviewer: approved
          │         │             └─ ● Merged → main (Feb 18)
          │         │
          │         └─ minions/fix-n+1-queries (SHIPPED 🚀)
          │            ├─ ● Vercel preview: https://...
          │            └─ ● Deployed to production
          │
          └─ minions/remove-dead-exports (REJECTED ✗)
             └─ ● User rejected: "keeping for backwards compat"
```

### Node Click → Slide-Over Panel

- **Finding node** — File path, code snippet, severity, category
- **Proposal node** — Rationale, spec, scores, source findings
- **Builder node** — Full diff, files changed, build/lint/test output, CLI session logs
- **Reviewer node** — Review comments, approval status, issues found
- **Merge node** — PR link, commit SHA, changes to main
- **Deploy node** — Vercel preview URL (live iframe), deployment status
- **Rejected node** — User's rejection reason (feeds into strategy memory)

### Branch Visual States

| State | Visual | Meaning |
|---|---|---|
| Active | Pulsing line, animated dots | Worker currently building/reviewing |
| Awaiting approval | Dashed line, amber glow | Proposal ready, waiting for user |
| Merged | Solid line back to main, green | Successfully shipped |
| Rejected | Faded line, red | User declined, branch deleted |
| Failed | Broken line, red warning | Build/lint/test failed |
| Scheduled | Dotted line, ghost nodes | Future work the system plans to do |

### Data Model

`branch_events` table:
- `id`, `project_id`, `branch_name`, `event_type`, `event_data` (JSON), `actor`, `created_at`
- Event types: `scout_finding`, `proposal_created`, `proposal_approved`, `proposal_rejected`, `build_started`, `build_completed`, `review_started`, `review_approved`, `review_rejected`, `pr_created`, `pr_merged`, `deploy_preview`, `deploy_production`, `branch_deleted`

## Scheduled Actions Panel

Visible alongside the branch graph — shows the future, not just the past.

```
UPCOMING                                         SCHEDULE
┌─────────────────────────────────────────────┐
│ Scout scan                   in 4 hours     │  daily @ 6am
│   └─ Will analyze: deps, security, perf    │
│                                             │
│ Strategist run               after scout    │  auto
│   └─ Will process 23 open findings         │
│                                             │
│ Builder: "Add input validation"  queued     │  #3 in queue
│   └─ Approved 2h ago, waiting for Builder  │
│                                             │
│ Builder: "Migrate to ESM"        queued     │  #4 in queue
│   └─ Approved yesterday                    │
│                                             │
│ Next scout focus areas:                     │
│   └─ Performance (nudge: "focus on perf")  │
│   └─ Test coverage (score: 34/100)         │
│   └─ Security (last scan: 3 days ago)      │
└─────────────────────────────────────────────┘
```

## Dashboard Pages

### 1. Home / Projects List
- Connected repos with health score badge, last activity, active worker count
- "Connect Repo" button, onboarding empty state
- Portfolio view across all repos

### 2. Project → Branch Graph (default view)
- The graph is the main page
- Active workers shown as pulsing nodes
- Scheduled actions panel alongside
- Click any node for full detail slide-over

### 3. Project → Kanban Board
Four columns: Proposed → Approved → Building → Shipped
- Proposed: score bars, approve/reject/edit
- Building: live logs, elapsed time, cancel button
- Shipped: PR links, revert button

### 4. Project → Findings
- Filterable by category + severity
- File path, line range, description, suggested fix
- Bulk dismiss, mark as priority

### 5. Project → Health
- Score trend (0-100) over last 30 days
- Breakdown: code quality, test coverage, dep health, security, docs
- Before/after comparisons

### 6. Project → Settings
- Product context, strategic nudges
- Scout schedule (daily, twice daily, weekly)
- Autonomy mode (audit / assist / automate)
- GitHub App connection, Vercel integration
- API keys

### 7. Project → Your Input
- Quick idea submission
- Create manual proposal (bypass Scout/Strategist)
- Priority overrides

### Sidebar Navigation
```
🌳 Graph (default)
📋 Kanban
🔍 Findings
📊 Health
⚙️ Settings
💡 Your Input
```

## Onboarding & Repo Connection

### Initial Scan Steps
1. Clone repo into sandboxed workspace
2. Inventory — tree-sitter parse: languages, file count, structure map
3. Dependency audit — parse lockfiles, check outdated/vulnerable
4. Code quality — Haiku reviews sampled files: dead code, smells, type safety
5. Test coverage — detect framework, estimate from test:source ratio
6. Security — known vulnerability patterns, hardcoded secrets
7. Docs — README completeness, inline doc coverage
8. Baseline health snapshot — store initial scores

### GitHub App Permissions
| Permission | Why |
|---|---|
| Repository contents (read/write) | Clone, create branches, push commits |
| Pull requests (read/write) | Create PRs, post review comments |
| Issues (read) | Link proposals to issues |
| Webhooks | Notified of merges, branch deletes |
| Checks (write) | Report build/lint/test status |

### Multi-repo
Each repo gets independent: health score, findings, proposals, branch graph, scout schedule, nudges.

## Progressive Autonomy & Safety

### Three Modes

| Mode | Scout | Strategist | Builder | Reviewer | Merge |
|---|---|---|---|---|---|
| **Audit** (default) | Auto | Auto | Needs approval | Auto | Needs approval |
| **Assist** | Auto | Auto | Auto for low-risk | Auto | Needs approval |
| **Automate** | Auto | Auto | Auto | Auto | Auto if tests pass + Reviewer approves |

Low-risk (Assist auto-build): dependency patches, lint fixes, dead code removal, doc improvements.

### Safety Rails
- Never force-push. All work on `minions/*` branches
- Never touch protected branches. PRs only, user merges
- Scope limits: Builder gets scoped prompt for exactly one proposal
- Build gate: every PR must pass lint + typecheck + build + tests (tiered, fail fast)
- Reviewer gate: second Claude pass before user sees PR
- SHA-pinned reviews: Reviewer records the commit SHA it reviewed. Auto-merge verifies HEAD matches reviewed SHA. If HEAD advances, re-trigger review.
- File-path risk tiers: project settings define high-risk paths (auth, payments, migrations, env). Changes touching high-risk paths always require human review, regardless of autonomy mode.
- Automated remediation: when build/lint/test fails, Builder feeds error back to Claude CLI for self-repair (max 2 remediation attempts before marking failed)
- Sandbox safety: clone with `--config core.hooksPath=/dev/null` to disable git hooks. Strip repo CLAUDE.md to prevent prompt injection. Limit env vars passed to CLI.
- Revert button: one-click revert on any shipped PR
- Kill switch: "Pause all minions" stops all workers for project
- Branch cleanup: rejected/failed branches auto-deleted after 7 days
- Rate limit: max N concurrent branches per project (default 3)
- Reviewer posts comments to the actual GitHub PR (not just internal branch_events)

### Strategy Memory
- Track approvals vs. rejections
- Record edit distance (how much user modified spec)
- Feed back into Strategist prompt
- Proposals align more with user preferences over time
- Revert memory: when a shipped PR is reverted, capture the reason and feed into Reviewer + Strategist context to prevent similar mistakes

## Data Model (New/Modified Tables)

### `findings`
`id`, `project_id`, `category` (code_quality | tests | deps | security | perf | docs | dead_code), `severity` (low | medium | high | critical), `title`, `description`, `file_path`, `line_range`, `scout_run_id`, `status` (open | addressed | dismissed), `created_at`

### `health_snapshots`
`id`, `project_id`, `score` (0-100), `breakdown` (JSON: code_quality, test_coverage, dep_health, security, docs), `findings_count`, `snapshot_date`

### `branch_events`
`id`, `project_id`, `branch_name`, `event_type`, `event_data` (JSON), `actor`, `commit_sha` (text, nullable — set on build_completed, review_approved, pr_merged), `created_at`
- Event types: `scout_finding`, `proposal_created`, `proposal_approved`, `proposal_rejected`, `build_started`, `build_completed`, `build_failed`, `build_remediation`, `review_started`, `review_approved`, `review_rejected`, `pr_created`, `pr_merged`, `deploy_preview`, `deploy_production`, `branch_deleted`

### `proposals` (adapted from feedback-chat)
Same schema but `source_finding_ids` instead of `source_theme_ids`

### `projects` (extended)
Add: `repo_url`, `default_branch`, `scout_schedule`, `autonomy_mode`, `product_context`, `strategic_nudges`, `risk_paths` (jsonb — `{ high: ["src/auth/**", "migrations/**"], medium: ["src/api/**"] }`)

## Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Dashboard | Next.js 15 + Tailwind v4 | Fork from feedback-chat |
| Database | Supabase (PostgreSQL) | Proven job queue, RLS |
| Auth | GitHub OAuth via Supabase Auth | Natural for GitHub product |
| Worker host | Railway (Docker) | Keep existing infra |
| Builder/Reviewer | Claude CLI (Max subscription) | Free unlimited runs |
| Scout/Strategist | Haiku via ANTHROPIC_API_KEY | Cheap analysis |
| GitHub integration | GitHub App | Same pattern as looper-agent |
| Vercel integration | Vercel API + bypass secret | Preview URLs on deploy nodes |
| Branch graph | Custom SVG/Canvas or gitgraph.js | Core differentiator |
| Scheduling | Supabase cron or GitHub Actions | Scout triggers |

## What Gets Forked vs. Built vs. Stripped

### Keep as-is
- Supabase job queue + `claim_next_job` RPC
- Managed worker polling loop
- Failure classification (Haiku)
- Strategy memory
- Self-improve pipeline
- Retry/reap logic
- Glass-card component library

### Fork + adapt
- Dashboard layout + styling
- Strategize worker → Strategist (findings instead of themes)
- Proposals flow
- Kanban board
- Settings page
- GitHub App integration

### Build new
- Branch graph visualization
- Findings table + UI
- Health score system
- Scout worker
- Reviewer worker
- Onboarding flow
- Scheduled actions panel

### Strip
- Feedback widget (entire `packages/widget/`)
- Feedback sessions/messages/themes tables
- `createFeedbackHandler` / `createStatusHandler`
- Consumer installation flow
- Pipeline tracker component

## Competitive Landscape

Nobody owns "point at a repo, it gets better continuously." Closest:
- **Codex Automations** — scheduled tasks, but script-defined, not autonomous
- **GitHub Agentic Workflows** — technical preview Feb 2026, limited to predefined automations
- **Devin** — task-triggered, not continuous

Minions differentiators:
1. **The branch graph** — nobody has a visual history of AI agent work
2. **Continuous** — not task-triggered, scouts never stop looking
3. **Strategic** — proposes features, not just fixes
4. **Learning** — strategy memory tracks preferences over time
5. **Progressive autonomy** — earns trust, moves from audit → automate

## Key Risks

- **GitHub Agentic Workflows** could mature and offer similar capabilities natively with unbeatable distribution
- **Context degradation** — agents performing well for 30 min may become erratic over 8 hours. Scoped, short-lived jobs mitigate this
- **Quality** — 67% of AI-generated PRs get rejected industry-wide. The Reviewer worker is the quality gate
- **Max subscription dependency** — Builder/Reviewer costs depend on Claude Max remaining available and reasonably priced
