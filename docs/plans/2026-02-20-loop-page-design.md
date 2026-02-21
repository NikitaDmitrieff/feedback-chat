# Dashboard Loop Page Revamp — Design

## Goal

Replace the fragmented dashboard (Overview, Feedback, Minions, Pipeline, Proposals — five views for one workflow) with a single **Loop** page that shows the feedback-to-shipping cycle as one unified view.

## Architecture

Two pages: **Loop** (the main page) + **Settings** (unchanged).

The Loop page answers three questions top-to-bottom:
1. **What's coming in?** — Feedback themes with session counts
2. **What needs me?** — Proposals awaiting review or previews awaiting approval
3. **What shipped?** — Completed proposals with full chain (theme → PR → date)

Detail views open as slide-overs (existing components). Run detail and tester profile remain as deep-link pages.

## Layout

Vertical sections, scrollable. Each proposal card shows a **step dots** lifecycle indicator:

```
Draft → Approved → Building → Preview → Shipped
  ●        ●         ◔         ○        ○
```

- `●` = completed stage
- `◔` = current/in-progress stage
- `○` = pending stage

### Section 1: What's Coming In

Horizontal row of theme chips. Each chip shows theme name + session count. Click opens a slide-over with filtered feedback sessions (reuses `FeedbackList`).

### Section 2: Needs Your Attention

Cards for proposals requiring human action:
- **Draft proposals** — step dots at stage 1, with approve/edit/reject actions
- **Preview-ready proposals** — step dots at stage 4, with "View Preview" action

Each card shows: title, step dots + label, priority badge, source theme link.

### Section 3: Shipped

Cards for completed proposals:
- **Done** — all dots filled, shows PR link + shipped date + source theme
- **Rejected** — dots stop at stage 1, shows rejection reason

Click any card → proposal slide-over with full detail + deployment preview iframe.

## Step Dots Logic

| Proposal Status | Run Status | Dots | Label |
|---|---|---|---|
| `draft` | — | `◔─○─○─○─○` | Draft |
| `approved` | no run yet | `●─◔─○─○─○` | Approved |
| `approved` | queued/running | `●─●─◔─○─○` | Building |
| `approved` | validating | `●─●─●─◔─○` | Validating |
| `implementing` | preview_ready | `●─●─●─◔─○` | Preview ready |
| `done` | success | `●─●─●─●─●` | Shipped |
| `rejected` | — | `●─○─○─○─○` | Rejected |

## New Components

- **`LoopPage`** — server component, parallel fetch of themes + proposals + runs + jobs
- **`LoopPageClient`** — client component, renders three sections
- **`StepDots`** — lifecycle indicator (proposal + optional run → dot states)
- **`ProposalCard`** — title, step dots, priority, source theme, contextual actions
- **`ThemeChip`** — clickable chip (name + count), opens sessions slide-over

## Reused Components

- `ProposalSlideOver` — proposal detail + deployment preview (already built)
- `FeedbackSlideOver` — session detail + messages
- `FeedbackList` — theme-filtered session list (inside slide-over)
- `LiveLogTail` — live logs during building (inside proposal card)
- `DeploymentPreview` — Vercel preview iframe (inside proposal slide-over)

## Deleted Components

- `MinionsPageClient`, `ProposalsTab`, `PipelineTab` — replaced by `LoopPageClient`
- `StatsBar`, `DigestCard`, `ProposalsCard`, `RunsTable` — replaced by section layout

## Navigation Changes

Sidebar: remove "Human" and "Minions" items. Keep "Overview" (renamed/repurposed as Loop) + "Settings".

Redirects: `/feedback`, `/minions`, `/pipeline`, `/proposals` all redirect to `/projects/[id]`.

## Data Flow

Single server-side fetch in `LoopPage`:
- `proposals` — all, ordered by created_at desc
- `feedback_themes` — ordered by message_count desc
- `pipeline_runs` — recent (limit 50)
- `job_queue` — active jobs (pending/processing)

Same queries that already exist across the current pages, combined into one.

## Unchanged

- Settings page
- Run detail page (`/runs/[runId]`)
- Tester profile page (`/testers/[testerId]`)
- All API routes
- Widget package
- Agent package
