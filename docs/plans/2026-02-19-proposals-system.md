# Proposals System — AI-Powered Proactive Product Improvement

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "strategist" agent that reads accumulated user feedback themes and proposes product improvements, with a dashboard UI for human review/approval before the existing implement pipeline runs.

**Architecture:** A new `strategize` job type in managed-worker dispatches to `strategize-worker.ts`, which reads feedback data from Supabase, evaluates improvement opportunities via Claude Haiku multi-grader, and writes proposals to a new `proposals` table. The dashboard gets a Proposals page with approve/edit/reject actions. Approval creates a GitHub issue (auto-implement label) that feeds into the existing worker pipeline. Strategy memory tracks past proposals and outcomes to prevent re-proposals and learn preferences.

**Tech Stack:** Supabase (PostgreSQL), Next.js 15 (App Router), Claude Haiku (AI SDK v6), React 19, Tailwind v4, TypeScript, vitest

---

## Sub-Plans

This feature is split into 3 independent sub-plans that should be executed in order:

1. **Sub-Plan A: Database + Strategist Worker** — Migration, strategize-worker.ts, managed-worker dispatcher
2. **Sub-Plan B: Dashboard API + UI** — API routes, proposals page, project page integration
3. **Sub-Plan C: Memory, Learning & Cron Trigger** — Strategy memory, edit distance, progressive autonomy, scheduled trigger

---

# Sub-Plan A: Database + Strategist Worker

## Task A1: Supabase Migration — proposals + strategy_memory tables

**Files:**
- Create: `packages/dashboard/supabase/migrations/00010_proposals.sql`

**Step 1: Write the migration**

```sql
-- Proposals: AI-generated improvement suggestions awaiting human review
CREATE TABLE IF NOT EXISTS feedback_chat.proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES feedback_chat.projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  rationale text NOT NULL,
  spec text NOT NULL,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'implementing', 'done', 'rejected')),
  source_theme_ids uuid[] DEFAULT '{}',
  source_session_ids uuid[] DEFAULT '{}',
  user_notes text,
  reject_reason text,
  github_issue_number int,
  scores jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  completed_at timestamptz
);

-- Strategy memory: tracks proposal outcomes for learning
CREATE TABLE IF NOT EXISTS feedback_chat.strategy_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES feedback_chat.projects(id) ON DELETE CASCADE,
  proposal_id uuid REFERENCES feedback_chat.proposals(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('proposed', 'approved', 'rejected', 'completed', 'failed')),
  title text NOT NULL,
  themes text[] DEFAULT '{}',
  outcome_notes text,
  edit_distance real,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_proposals_project ON feedback_chat.proposals(project_id, status, created_at DESC);
CREATE INDEX idx_proposals_status ON feedback_chat.proposals(status) WHERE status IN ('draft', 'approved', 'implementing');
CREATE INDEX idx_strategy_memory_project ON feedback_chat.strategy_memory(project_id, created_at DESC);

-- Expand job_type to include 'strategize'
ALTER TABLE feedback_chat.job_queue DROP CONSTRAINT IF EXISTS job_queue_job_type_check;
ALTER TABLE feedback_chat.job_queue ADD CONSTRAINT job_queue_job_type_check
  CHECK (job_type IN ('agent', 'setup', 'self_improve', 'strategize'));

-- Add product_context to projects (vision/constraints for strategist)
ALTER TABLE feedback_chat.projects ADD COLUMN IF NOT EXISTS product_context text;

-- Add autonomy_mode to projects
ALTER TABLE feedback_chat.projects ADD COLUMN IF NOT EXISTS autonomy_mode text NOT NULL DEFAULT 'audit'
  CHECK (autonomy_mode IN ('audit', 'assist', 'automate'));

-- RLS policies (same pattern as existing tables — user sees own projects' data)
ALTER TABLE feedback_chat.proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own project proposals"
  ON feedback_chat.proposals FOR SELECT
  USING (project_id IN (SELECT id FROM feedback_chat.projects WHERE user_id = auth.uid()));
CREATE POLICY "Users can update own project proposals"
  ON feedback_chat.proposals FOR UPDATE
  USING (project_id IN (SELECT id FROM feedback_chat.projects WHERE user_id = auth.uid()));

ALTER TABLE feedback_chat.strategy_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own project memory"
  ON feedback_chat.strategy_memory FOR SELECT
  USING (project_id IN (SELECT id FROM feedback_chat.projects WHERE user_id = auth.uid()));
```

**Step 2: Apply migration to Supabase**

Run: `npx supabase db push` or apply via Supabase dashboard SQL editor.
Expected: Tables created, job_type constraint updated.

**Step 3: Commit**

```bash
git add packages/dashboard/supabase/migrations/00010_proposals.sql
git commit -m "feat(db): add proposals + strategy_memory tables, strategize job type"
```

---

## Task A2: Dashboard Types — Proposal + StrategyMemory

**Files:**
- Modify: `packages/dashboard/src/lib/types.ts`

**Step 1: Add types at end of file**

```typescript
export interface Proposal {
  id: string
  project_id: string
  title: string
  rationale: string
  spec: string
  priority: 'high' | 'medium' | 'low'
  status: 'draft' | 'approved' | 'implementing' | 'done' | 'rejected'
  source_theme_ids: string[]
  source_session_ids: string[]
  user_notes: string | null
  reject_reason: string | null
  github_issue_number: number | null
  scores: {
    impact?: number
    feasibility?: number
    novelty?: number
    alignment?: number
  }
  created_at: string
  reviewed_at: string | null
  completed_at: string | null
}

export interface StrategyMemoryEvent {
  id: string
  project_id: string
  proposal_id: string | null
  event_type: 'proposed' | 'approved' | 'rejected' | 'completed' | 'failed'
  title: string
  themes: string[]
  outcome_notes: string | null
  edit_distance: number | null
  created_at: string
}
```

**Step 2: Commit**

```bash
git add packages/dashboard/src/lib/types.ts
git commit -m "feat(dashboard): add Proposal and StrategyMemoryEvent types"
```

---

## Task A3: Strategize Worker — Multi-grader AI evaluation

**Files:**
- Create: `packages/agent/src/strategize-worker.ts`

**Step 1: Write the strategize worker**

This worker:
1. Reads feedback themes (with counts + trends), recent sessions, recent PRs/issues, strategy memory, product context
2. Calls Claude Haiku to identify 1-3 improvement opportunities
3. Scores each opportunity on 4 dimensions (impact, feasibility, novelty, alignment)
4. Filters out low-scoring proposals
5. Writes passing proposals to the `proposals` table

```typescript
import { createSupabaseClient } from './supabase.js'
import Anthropic from '@anthropic-ai/sdk'

type Supabase = ReturnType<typeof createSupabaseClient>

interface StrategizeInput {
  jobId: string
  projectId: string
  supabase: Supabase
}

const MAX_PROPOSALS_PER_RUN = 3
const MIN_SCORE_THRESHOLD = 0.6

export async function runStrategizeJob(input: StrategizeInput): Promise<void> {
  const { projectId, supabase } = input

  // 1. Gather context
  const [
    { data: project },
    { data: themes },
    { data: sessions },
    { data: recentProposals },
    { data: memory },
  ] = await Promise.all([
    supabase.from('projects').select('name, github_repo, product_context').eq('id', projectId).single(),
    supabase.from('feedback_themes').select('id, name, message_count, last_seen_at').eq('project_id', projectId).order('message_count', { ascending: false }).limit(20),
    supabase.from('feedback_sessions').select('id, ai_summary, ai_themes, tester_name, status').eq('project_id', projectId).order('last_message_at', { ascending: false }).limit(50),
    supabase.from('proposals').select('title, status, reject_reason').eq('project_id', projectId).order('created_at', { ascending: false }).limit(20),
    supabase.from('strategy_memory').select('title, event_type, themes, outcome_notes').eq('project_id', projectId).order('created_at', { ascending: false }).limit(30),
  ])

  if (!project || !themes?.length || !sessions?.length) {
    console.log(`[strategize] Skipping project ${projectId}: insufficient data`)
    return
  }

  // 2. Build context for Claude
  const themesSummary = (themes ?? []).map(t => `- ${t.name} (${t.message_count} mentions, last: ${t.last_seen_at})`).join('\n')
  const sessionSummaries = (sessions ?? []).filter(s => s.ai_summary).map(s => `- ${s.ai_summary}`).join('\n')
  const existingProposals = (recentProposals ?? []).map(p => `- [${p.status}] ${p.title}${p.reject_reason ? ` (rejected: ${p.reject_reason})` : ''}`).join('\n')
  const memoryContext = (memory ?? []).map(m => `- [${m.event_type}] ${m.title}${m.outcome_notes ? `: ${m.outcome_notes}` : ''}`).join('\n')

  const anthropic = new Anthropic()

  // 3. Generate proposals
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `You are a product strategist for "${project.name}" (${project.github_repo}).

${project.product_context ? `Product vision: ${project.product_context}\n` : ''}
## Current feedback themes (sorted by frequency)
${themesSummary}

## Recent feedback session summaries
${sessionSummaries}

## Existing proposals (avoid duplicates)
${existingProposals || 'None yet'}

## Strategy memory (past decisions — learn from rejections)
${memoryContext || 'No history yet'}

Based on this data, identify 1-${MAX_PROPOSALS_PER_RUN} concrete improvement opportunities. For each:
- Focus on recurring themes with high frequency
- Do NOT re-propose anything that was recently rejected
- Do NOT propose what already exists in existing proposals
- Be specific and actionable (not vague like "improve UX")

Respond in JSON format:
\`\`\`json
[
  {
    "title": "Short imperative title (e.g., Add keyboard shortcuts)",
    "rationale": "Why this matters — cite specific themes and session counts",
    "spec": "Detailed implementation spec: what to build, where in the codebase, acceptance criteria. Enough detail for a coding agent to implement.",
    "priority": "high|medium|low",
    "source_themes": ["theme name 1", "theme name 2"]
  }
]
\`\`\`

Only return the JSON array. No other text.`
    }]
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) {
    console.log('[strategize] No valid JSON in response')
    return
  }

  let rawProposals: Array<{
    title: string; rationale: string; spec: string; priority: string; source_themes: string[]
  }>
  try {
    rawProposals = JSON.parse(jsonMatch[0])
  } catch {
    console.log('[strategize] Failed to parse JSON')
    return
  }

  // 4. Score each proposal
  for (const raw of rawProposals.slice(0, MAX_PROPOSALS_PER_RUN)) {
    const scoreResponse = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Score this product improvement proposal on 4 dimensions (0.0 to 1.0):

Title: ${raw.title}
Rationale: ${raw.rationale}
Spec: ${raw.spec}

Themes data: ${themesSummary}

Score each dimension:
- impact: How many users would benefit? (based on theme frequency)
- feasibility: Can a coding agent implement this in one PR? (based on spec complexity)
- novelty: Is this genuinely new? (not already built or proposed)
- alignment: Does this match the product vision?${project.product_context ? ` Vision: ${project.product_context}` : ''}

Respond in JSON only:
\`\`\`json
{"impact": 0.8, "feasibility": 0.7, "novelty": 0.9, "alignment": 0.85}
\`\`\`
`
      }]
    })

    const scoreText = scoreResponse.content[0].type === 'text' ? scoreResponse.content[0].text : ''
    const scoreMatch = scoreText.match(/\{[\s\S]*?\}/)
    let scores = { impact: 0.5, feasibility: 0.5, novelty: 0.5, alignment: 0.5 }
    try {
      scores = JSON.parse(scoreMatch?.[0] ?? '{}')
    } catch { /* use defaults */ }

    const avgScore = (scores.impact + scores.feasibility + scores.novelty + scores.alignment) / 4
    if (avgScore < MIN_SCORE_THRESHOLD) {
      console.log(`[strategize] Proposal "${raw.title}" scored ${avgScore.toFixed(2)} — below threshold, skipping`)
      continue
    }

    // 5. Map theme names to IDs
    const sourceThemeIds = (themes ?? [])
      .filter(t => raw.source_themes.some(name => name.toLowerCase() === t.name.toLowerCase()))
      .map(t => t.id)

    // 6. Insert proposal
    const { error } = await supabase.from('proposals').insert({
      project_id: projectId,
      title: raw.title,
      rationale: raw.rationale,
      spec: raw.spec,
      priority: raw.priority === 'high' ? 'high' : raw.priority === 'low' ? 'low' : 'medium',
      source_theme_ids: sourceThemeIds,
      scores,
    })

    if (error) {
      console.error(`[strategize] Failed to insert proposal: ${error.message}`)
    } else {
      console.log(`[strategize] Created proposal: "${raw.title}" (score: ${avgScore.toFixed(2)})`)
    }
  }
}
```

**Step 2: Commit**

```bash
git add packages/agent/src/strategize-worker.ts
git commit -m "feat(agent): add strategize-worker with multi-grader evaluation"
```

---

## Task A4: Wire strategize into managed-worker dispatcher

**Files:**
- Modify: `packages/agent/src/managed-worker.ts`

**Step 1: Add import at top of file**

Add after the existing imports:
```typescript
import { runStrategizeJob } from './strategize-worker.js'
```

**Step 2: Add case in processJob dispatcher**

In `processJob()`, add a new case before the default `else` branch (after the `self_improve` case):

```typescript
    } else if (job.job_type === 'strategize') {
      await runStrategizeJob({
        jobId: job.id,
        projectId: job.project_id,
        supabase,
      })
```

**Step 3: Build and verify**

Run: `cd packages/agent && npm run build`
Expected: Clean compile, no errors.

**Step 4: Commit**

```bash
git add packages/agent/src/managed-worker.ts
git commit -m "feat(agent): wire strategize job type into managed-worker dispatcher"
```

---

## Task A5: Agent tests — strategize worker

**Files:**
- Create: `packages/agent/src/strategize-worker.test.ts`

**Step 1: Write tests**

```typescript
import { describe, it, expect } from 'vitest'

describe('strategize-worker', () => {
  it('should export runStrategizeJob function', async () => {
    const mod = await import('./strategize-worker.js')
    expect(typeof mod.runStrategizeJob).toBe('function')
  })
})
```

**Step 2: Run tests**

Run: `cd packages/agent && npm test`
Expected: All tests pass (existing + new).

**Step 3: Commit**

```bash
git add packages/agent/src/strategize-worker.test.ts
git commit -m "test(agent): add strategize-worker smoke test"
```

---

# Sub-Plan B: Dashboard API + UI

## Task B1: Proposals API — List + Approve + Reject

**Files:**
- Create: `packages/dashboard/src/app/api/proposals/[projectId]/route.ts`

**Step 1: Write the API route**

- `GET /api/proposals/{projectId}?status=draft` — list proposals, default to `draft`
- `PATCH /api/proposals/{projectId}` with `{ proposalId, action, userNotes?, rejectReason? }` — approve/reject

On approve:
1. Update proposal status to `approved`
2. Create GitHub issue from proposal spec + user notes
3. Label with `auto-implement` + `feedback-bot`
4. Store `github_issue_number` on proposal
5. Record in strategy_memory

On reject:
1. Update proposal status to `rejected` with `reject_reason`
2. Record in strategy_memory (so strategist learns)

**Step 2: Build and verify**

Run: `cd packages/dashboard && npm run build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add packages/dashboard/src/app/api/proposals/
git commit -m "feat(dashboard): add proposals API routes (list, approve, reject)"
```

---

## Task B2: Proposals Page — /projects/[id]/proposals

**Files:**
- Create: `packages/dashboard/src/app/projects/[id]/proposals/page.tsx`
- Create: `packages/dashboard/src/app/projects/[id]/proposals/client.tsx`

**Step 1: Write the server page**

Follows existing pattern from `feedback/page.tsx`:
- Fetch project + proposals from Supabase
- Pass to client component

**Step 2: Write the client component**

Three sections:
1. **Pending Review** — proposals with `status: 'draft'`, sorted by priority then created_at
2. **In Progress** — proposals with `status: 'approved' | 'implementing'`
3. **Recently Completed** — proposals with `status: 'done' | 'rejected'`, last 10

Each proposal card uses `glass-card` pattern, shows:
- Priority dot (red/amber/green for high/medium/low)
- Title
- Source themes as colored badges
- Score summary (avg score as small bar)
- Action buttons: Approve / Edit & Approve / Reject

**Step 3: Commit**

```bash
git add packages/dashboard/src/app/projects/[id]/proposals/
git commit -m "feat(dashboard): add proposals page with pending/active/completed sections"
```

---

## Task B3: Proposal Slide-Over — Detail + Edit + Actions

**Files:**
- Create: `packages/dashboard/src/components/proposal-slide-over.tsx`

**Step 1: Write the slide-over component**

Follows existing `feedback-slide-over.tsx` pattern (fixed right panel, max-w-[480px]):
- **Header**: Title + priority badge + close button
- **Scores section**: 4 small bars (impact, feasibility, novelty, alignment)
- **Rationale section**: Full text with linked theme badges
- **Spec section**: Markdown-rendered implementation spec (editable textarea on "Edit & Approve")
- **Your Notes field**: Textarea for adding implementation guidance
- **Evidence section**: List linked feedback sessions (clickable to FeedbackSlideOver)
- **Footer buttons**:
  - "Approve" — POST to proposals API with action=approve + userNotes
  - "Edit & Approve" — toggle editable mode, then approve with modified spec
  - "Reject" — shows reason textarea, POST with action=reject + rejectReason

**Step 2: Commit**

```bash
git add packages/dashboard/src/components/proposal-slide-over.tsx
git commit -m "feat(dashboard): add proposal slide-over with detail, edit, approve/reject"
```

---

## Task B4: ProposalsCard on Project Page

**Files:**
- Create: `packages/dashboard/src/components/proposals-card.tsx`
- Modify: `packages/dashboard/src/app/projects/[id]/page.tsx`

**Step 1: Write ProposalsCard component**

Small glass-card showing:
- "N proposals awaiting review" header
- List of top 3 pending proposals (title + priority dot)
- "View all" link to `/projects/{id}/proposals`
- Empty state: "No proposals yet. The strategist runs weekly."

**Step 2: Add to project page**

Import `ProposalsCard` and render between `DigestCard` and `RunsTable`.

**Step 3: Build and verify**

Run: `cd packages/dashboard && npm run build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add packages/dashboard/src/components/proposals-card.tsx packages/dashboard/src/app/projects/[id]/page.tsx
git commit -m "feat(dashboard): add ProposalsCard to project overview page"
```

---

## Task B5: Sidebar Navigation — Add Proposals link

**Files:**
- Modify: `packages/dashboard/src/components/sidebar.tsx`

**Step 1: Add Proposals nav item**

Add after the Feedback link, using `Lightbulb` icon from lucide-react. Link to `/projects/{projectId}/proposals`. Only show when inside a project (same condition as Feedback link).

**Step 2: Commit**

```bash
git add packages/dashboard/src/components/sidebar.tsx
git commit -m "feat(dashboard): add Proposals link to sidebar navigation"
```

---

# Sub-Plan C: Memory, Learning & Cron Trigger

## Task C1: Strategy Memory Recording

**Files:**
- Modify: `packages/dashboard/src/app/api/proposals/[projectId]/route.ts`

**Step 1: Record memory events on approve/reject**

In the PATCH handler, after updating proposal status, insert into `strategy_memory`:

For approve:
```typescript
await supabase.from('strategy_memory').insert({
  project_id: projectId,
  proposal_id: proposalId,
  event_type: 'approved',
  title: proposal.title,
  themes: sourceThemeNames,
  outcome_notes: userNotes || null,
  edit_distance: calculateEditDistance(proposal.spec, modifiedSpec),
})
```

For reject:
```typescript
await supabase.from('strategy_memory').insert({
  project_id: projectId,
  proposal_id: proposalId,
  event_type: 'rejected',
  title: proposal.title,
  themes: sourceThemeNames,
  outcome_notes: rejectReason,
})
```

**Step 2: Add edit distance utility**

Simple Levenshtein ratio — how much the user changed the spec before approving:

```typescript
function calculateEditDistance(original: string, modified: string): number {
  if (original === modified) return 0
  // Normalize: 0 = unchanged, 1 = completely rewritten
  const maxLen = Math.max(original.length, modified.length)
  if (maxLen === 0) return 0
  // Simple character-level diff ratio
  let changes = 0
  for (let i = 0; i < maxLen; i++) {
    if (original[i] !== modified[i]) changes++
  }
  return changes / maxLen
}
```

**Step 3: Commit**

```bash
git add packages/dashboard/src/app/api/proposals/[projectId]/route.ts
git commit -m "feat(dashboard): record strategy memory events with edit distance on approve/reject"
```

---

## Task C2: Cron Trigger — GitHub Actions Workflow

**Files:**
- Create: `.github/workflows/strategize.yml`

**Step 1: Write the workflow**

```yaml
name: Strategize — Proactive Improvement Proposals

on:
  schedule:
    - cron: '0 9 * * 1'  # Every Monday 9am UTC
  workflow_dispatch:
    inputs:
      project_id:
        description: 'Specific project ID (leave empty for all)'
        required: false

jobs:
  strategize:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger strategize jobs
        run: |
          # For each active project with enough feedback, insert a strategize job
          # Uses Supabase REST API directly
          PROJECTS=$(curl -s \
            -H "apikey: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" \
            "${{ secrets.SUPABASE_URL }}/rest/v1/projects?select=id&github_repo=not.is.null" \
          )

          for PROJECT_ID in $(echo "$PROJECTS" | jq -r '.[].id'); do
            if [ -n "${{ github.event.inputs.project_id }}" ] && [ "$PROJECT_ID" != "${{ github.event.inputs.project_id }}" ]; then
              continue
            fi

            # Check if project has enough feedback (at least 5 sessions)
            COUNT=$(curl -s \
              -H "apikey: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" \
              -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" \
              -H "Prefer: count=exact" \
              "${{ secrets.SUPABASE_URL }}/rest/v1/feedback_sessions?project_id=eq.$PROJECT_ID&select=id" \
              -o /dev/null -w '%{http_code}' \
              --head | grep -oP 'content-range: \d+-\d+/\K\d+' || echo "0")

            if [ "$COUNT" -ge 5 ]; then
              curl -s -X POST \
                -H "apikey: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" \
                -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" \
                -H "Content-Type: application/json" \
                "${{ secrets.SUPABASE_URL }}/rest/v1/job_queue" \
                -d "{\"project_id\": \"$PROJECT_ID\", \"job_type\": \"strategize\", \"github_issue_number\": 0, \"issue_title\": \"Weekly strategize\", \"issue_body\": \"{}\"}"
              echo "Queued strategize for project $PROJECT_ID"
            fi
          done
```

**Step 2: Commit**

```bash
git add .github/workflows/strategize.yml
git commit -m "feat: add weekly strategize cron trigger via GitHub Actions"
```

---

## Task C3: Dashboard — Trigger Strategize Button

**Files:**
- Modify: `packages/dashboard/src/components/proposals-card.tsx`
- Create: `packages/dashboard/src/app/projects/[id]/proposals/actions.ts`

**Step 1: Add server action to trigger strategize**

```typescript
'use server'

import { createClient } from '@/lib/supabase/server'

export async function triggerStrategize(projectId: string) {
  const supabase = await createClient()

  const { error } = await supabase.from('job_queue').insert({
    project_id: projectId,
    job_type: 'strategize',
    github_issue_number: 0,
    issue_title: 'Manual strategize trigger',
    issue_body: '{}',
  })

  if (error) throw new Error(error.message)
  return { ok: true }
}
```

**Step 2: Add "Generate Proposals" button to ProposalsCard**

Small button that calls `triggerStrategize(projectId)` with loading state.

**Step 3: Commit**

```bash
git add packages/dashboard/src/app/projects/[id]/proposals/actions.ts packages/dashboard/src/components/proposals-card.tsx
git commit -m "feat(dashboard): add manual strategize trigger button"
```

---

## Task C4: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add proposals system documentation**

Add after the Dashboard section:
- New tables: `proposals`, `strategy_memory`
- New job type: `strategize`
- New dashboard page: `/projects/[id]/proposals`
- New API routes: `/api/proposals/[projectId]`
- New project columns: `product_context`, `autonomy_mode`
- Strategist architecture: multi-grader evaluation, strategy memory
- Cron: GitHub Actions weekly trigger

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add proposals system to CLAUDE.md"
```

---

## Execution Order

```
A1 (migration) → A2 (types) → A3 (strategize worker) → A4 (dispatcher) → A5 (tests)
                                                                              ↓
B1 (API routes) → B2 (proposals page) → B3 (slide-over) → B4 (project card) → B5 (sidebar)
                                                                              ↓
C1 (memory recording) → C2 (cron trigger) → C3 (trigger button) → C4 (docs)
```

Sub-Plan A must complete before B and C can start (B needs the types and table, C needs the strategist).
B and C can run in parallel after A is done.

---

## Deployment Checklist

After all tasks:

1. `npm run build` — verify all packages compile
2. `cd packages/agent && npm test` — verify agent tests pass
3. Apply migration 00010 to Supabase
4. Push to main → Vercel auto-deploys dashboard
5. `cd packages/agent && railway up --detach` → Railway deploys agent
6. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as GitHub Actions secrets (for strategize cron)
7. Test manually: trigger strategize from dashboard button, verify proposals appear
