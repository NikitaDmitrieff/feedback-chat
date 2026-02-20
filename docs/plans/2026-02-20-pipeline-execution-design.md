# Pipeline Execution & Visibility Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give users human control gates over proposal execution (branch picker, live Claude tool-level logs) and a visual pipeline overview page showing proposals → runs → completions.

**Architecture:** Extend the existing proposal slide-over with pre-approval branch picker and post-approval live log tail. Add a new pipeline overview page with three swim lanes. Upgrade the agent worker to emit structured tool-level events from Claude CLI via `--output-format stream-json`.

**Tech Stack:** Next.js 15 (app router), Supabase (postgres), Claude CLI (stream-json), lucide-react icons, existing glass-card design system.

---

## Task 1: Migration — Schema Enhancements

**Files:**
- Create: `packages/dashboard/supabase/migrations/00011_pipeline_enhancements.sql`

**Step 1:** Write migration adding:
- `proposals.branch_name` (text, nullable)
- `run_logs.event_type` (text, nullable) — 'text' | 'tool_use' | 'tool_result' | 'error'
- `run_logs.payload` (jsonb, nullable)

**Step 2:** Apply migration via Supabase MCP tool.

**Step 3:** Verify columns exist.

---

## Task 2: Agent — Structured Log Streaming from Claude CLI

**Files:**
- Modify: `packages/agent/src/worker.ts` — switch to `--output-format stream-json`, parse events, write to run_logs

**Step 1:** Change the Claude CLI spawn to use `--output-format stream-json`.

**Step 2:** Parse the JSON stream line-by-line. For each event, write a structured log entry to `run_logs` with `event_type` and `payload`.

**Step 3:** Read branch name from issue body (`Branch: {name}` line). Use it instead of `feedback/issue-{N}` if present.

**Step 4:** Add verbose logging at every step (clone, install, build, lint, push, PR) with structured events.

---

## Task 3: API — Proposals Branch Name & Logs Endpoint

**Files:**
- Modify: `packages/dashboard/src/app/api/proposals/[projectId]/route.ts` — include branch_name in approval flow
- Create: `packages/dashboard/src/app/api/runs/[projectId]/[runId]/logs/route.ts` — structured log streaming endpoint

**Step 1:** Update approval PATCH to store `branch_name` on proposal and embed `Branch: {name}` in GitHub issue body.

**Step 2:** Create logs endpoint: `GET /api/runs/[projectId]/[runId]/logs?after={iso_timestamp}` returning structured log entries ordered by created_at.

---

## Task 4: Component — LiveLogTail

**Files:**
- Create: `packages/dashboard/src/components/live-log-tail.tsx`

**Step 1:** Build a reusable component that polls the logs endpoint every 3s, renders tool-level events with icons (file read, edit, terminal, error), auto-scrolls, and stops when the run is done.

---

## Task 5: Enhanced Proposal Slide-Over

**Files:**
- Modify: `packages/dashboard/src/components/proposal-slide-over.tsx`

**Step 1:** Add branch name text input (default: `proposals/{slug}`) before the Approve button. Only shown for draft proposals.

**Step 2:** Add post-approval tracker view: when proposal status is 'approved' and has a linked pipeline run, show stage timeline + LiveLogTail + preview URL when ready.

---

## Task 6: Pipeline Overview Page

**Files:**
- Create: `packages/dashboard/src/app/projects/[id]/pipeline/page.tsx` — server component
- Create: `packages/dashboard/src/app/projects/[id]/pipeline/client.tsx` — three-lane client component

**Step 1:** Server component fetches proposals + pipeline_runs + job_queue for the project.

**Step 2:** Client component renders three swim lanes:
- Lane 1 (Proposals): draft proposals with scores, priority, "Review" button
- Lane 2 (In Progress): approved proposals with active runs, stage badge, branch name, live log expandable
- Lane 3 (Completed): deployed/failed/rejected items with result badge, PR link

**Step 3:** Top stats row: Pending | Active | Success Rate | Avg Deploy Time.

---

## Task 7: Sidebar — Pipeline Nav Item

**Files:**
- Modify: `packages/dashboard/src/components/sidebar.tsx`

**Step 1:** Add Pipeline link with LayoutDashboard icon between Proposals and the divider. Same conditional pattern (only shown when projectId exists).

---

## Task 8: Build Verification & Commit

**Step 1:** Run `npm run build` from repo root to verify dashboard compiles.
**Step 2:** Run `npm test` in packages/agent to verify worker changes.
**Step 3:** Commit all changes.
