# Dashboard Clarity & Tester Profiles Design

**Date:** 2026-02-19
**Approach:** B — Tester Profiles + Linked Runs

## Problem

The dashboard lacks clarity for monitoring feedback runs. Testers are anonymous, pipeline runs are disconnected from the conversations that triggered them, and there's no user-centric view to trace a tester's full impact.

## Solution Overview

Four interconnected changes:

1. **Widget name prompt** — collect tester identity at conversation start
2. **Tester profile page** — activity timeline + sessions per tester
3. **Feedback-linked runs** — connect runs back to originating conversations
4. **Enhanced testers tab** — clickable cards, runs count, sort, avatars

## 1. Widget Name Prompt

**Flow:** Password check (existing) → Name prompt (new) → Chat

- After auth, check `localStorage` for `feedback_tester_name`
- If missing, show name input (same glass-card styling, single text field)
- Store name in `localStorage`, send with every message as `testerName` in request body
- `createFeedbackHandler` reads `testerName` and populates `feedback_sessions.tester_name`
- On repeat visits, skip name prompt (localStorage persists)

**Schema:** No changes — `tester_name` column already exists on `feedback_sessions`.

**Validation:** Require at least 1 character. Empty name blocked.

## 2. Tester Profile Page

**Route:** `/projects/[id]/testers/[testerId]`

**Layout:**

### Header
- Tester name (large text)
- "First seen: X days ago" / "Last active: 2h ago"
- Stats row: Total sessions | Top themes | Resolution rate

### Activity Timeline
Chronological feed, most recent first. Event types:
- **Conversation started** — AI summary snippet or first message preview
- **Issue created** — "Feedback became Issue #N" + title
- **Run triggered** — "Agent started on Issue #N" + stage badge
- **Run completed** — "PR #N ready" or "Run failed" + result badge
- **Feedback resolved** — "Conversation marked as resolved"

Each event links to relevant detail (session slide-over, run detail, GitHub).

### Sessions List
Same card format as feedback hub, filtered to this tester. Clickable → feedback slide-over.

**New API route:** `GET /api/feedback/[projectId]/testers/[testerId]`
- Fetches sessions + pipeline runs for this tester
- Joins via `feedback_sessions.github_issue_number` ↔ `pipeline_runs.github_issue_number`
- Constructs merged timeline sorted by timestamp

**Navigation:** Testers tab cards → profile page. Breadcrumb: Project → Testers → [Name].

## 3. Feedback-Linked Runs

**Join key:** `project_id` + `github_issue_number` between `feedback_sessions` and `pipeline_runs`.

### Runs Table (project page)
New column **"Source"**:
- Tester name + truncated AI summary
- Clickable → opens feedback slide-over
- Falls back to "Manual" if no linked feedback session

### Run Slide-Over
New section at top: **"Original Feedback"**
- Tester name, conversation summary, theme badges
- "View full conversation" link

### Run Detail Page
"Original Feedback" card in sidebar with first few messages from the conversation.

**No schema changes needed.**

## 4. Enhanced Testers Tab

Changes to existing testers tab in feedback hub:

- **Cards become links** → navigate to `/projects/[id]/testers/[testerId]`
- **Add "Runs triggered" count** — pipeline runs from this tester's feedback
- **Sort options** — by last active (default), session count, runs triggered
- **Initials avatar** — colored circle from name hash for visual distinction

Existing `/api/feedback/[projectId]/testers` route extended with pipeline_runs count.

## Files Changed

### Widget (`packages/widget/`)
- `src/client/FeedbackPanel.tsx` — add name prompt state/screen after auth
- `src/server/feedback-handler.ts` — read `testerName` from body, pass to Supabase

### Dashboard (`packages/dashboard/`)
- `src/app/projects/[id]/testers/[testerId]/page.tsx` — new tester profile page
- `src/app/projects/[id]/testers/[testerId]/client.tsx` — client component
- `src/app/api/feedback/[projectId]/testers/[testerId]/route.ts` — new API route
- `src/app/api/feedback/[projectId]/testers/route.ts` — extend with runs count
- `src/app/api/runs/[projectId]/route.ts` — extend with feedback session join
- `src/components/tester-activity.tsx` — make cards clickable, add avatar + runs count
- `src/components/tester-profile.tsx` — new: activity timeline component
- `src/components/tester-timeline.tsx` — new: timeline event rendering
- `src/components/runs-table.tsx` — add "Source" column
- `src/components/run-slide-over.tsx` — add "Original Feedback" section
- `src/app/projects/[id]/runs/[runId]/page.tsx` — add feedback card to sidebar
