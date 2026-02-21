# Minions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fork the feedback-chat monorepo into a standalone "Minions" SaaS product — connect a GitHub repo, get AI workers that continuously improve it.

**Architecture:** Fork feedback-chat, strip the widget package, keep agent + dashboard + job queue. Add four worker types (Scout, Strategist, Builder, Reviewer). Build a branch graph visualization as the core UI. New Supabase tables for findings, health snapshots, and branch events.

**Tech Stack:** Next.js 15, Tailwind v4, Supabase (PostgreSQL), Railway (Docker), Claude CLI (Max subscription), Haiku API, GitHub App, Vercel API.

**Design doc:** `docs/plans/2026-02-20-minions-product-design.md`

---

## Phase 0: Fork & Strip

### Task 1: Create the Minions Repository

**Files:**
- Create: new GitHub repo `minions` (or chosen name)

**Step 1: Fork the repo on GitHub**

```bash
# Create a new repo on GitHub (not a GitHub fork — a clean copy)
gh repo create minions --private --clone=false
```

**Step 2: Copy feedback-chat contents into it**

```bash
cd ~/Projects
git clone https://github.com/NikitaDmitrieff/feedback-chat.git minions
cd minions
git remote remove origin
git remote add origin https://github.com/NikitaDmitrieff/minions.git
git push -u origin main
```

**Step 3: Verify the clone builds**

```bash
npm install
npm run build
```

Expected: both packages build successfully.

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: fork feedback-chat as minions base"
```

---

### Task 2: Strip the Widget Package

**Files:**
- Delete: `packages/widget/` (entire directory)
- Modify: `package.json` (root) — remove widget workspace
- Modify: `turbo.json` — remove widget references if any

**Step 1: Remove the widget package**

```bash
rm -rf packages/widget
```

**Step 2: Update root `package.json` workspaces**

Remove `"packages/widget"` from the `workspaces` array. Keep `"packages/dashboard"` and `"packages/agent"`.

**Step 3: Update turbo.json if it references widget**

Check `turbo.json` for any widget-specific pipeline entries and remove them.

**Step 4: Verify build still passes**

```bash
npm install
npm run build
```

Expected: agent and dashboard build without errors.

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: strip widget package"
```

---

### Task 3: Strip Feedback-Specific Code from Dashboard

**Files:**
- Delete: `packages/dashboard/src/app/projects/[id]/feedback/` (entire directory)
- Delete: `packages/dashboard/src/app/projects/[id]/testers/` (entire directory)
- Delete: `packages/dashboard/src/app/api/feedback/` (entire directory)
- Delete: `packages/dashboard/src/components/feedback-list.tsx`
- Delete: `packages/dashboard/src/components/feedback-slide-over.tsx`
- Delete: `packages/dashboard/src/components/digest-card.tsx`
- Delete: `packages/dashboard/src/components/tester-activity.tsx`
- Delete: `packages/dashboard/src/components/tester-timeline.tsx`
- Modify: `packages/dashboard/src/components/sidebar.tsx` — remove feedback/testers nav links
- Modify: `packages/dashboard/src/lib/types.ts` — remove `FeedbackSession`, `FeedbackMessage`, `FeedbackTheme`, `TesterProfile` types (keep `Proposal`, `StrategyMemoryEvent`, `UserIdea`, `PipelineRun`, `RunLog`, `DeploymentInfo`)

**Step 1: Delete feedback pages and API routes**

```bash
rm -rf packages/dashboard/src/app/projects/\[id\]/feedback
rm -rf packages/dashboard/src/app/projects/\[id\]/testers
rm -rf packages/dashboard/src/app/api/feedback
```

**Step 2: Delete feedback components**

```bash
rm packages/dashboard/src/components/feedback-list.tsx
rm packages/dashboard/src/components/feedback-slide-over.tsx
rm packages/dashboard/src/components/digest-card.tsx
rm packages/dashboard/src/components/tester-activity.tsx
rm packages/dashboard/src/components/tester-timeline.tsx
```

**Step 3: Update sidebar navigation**

In `packages/dashboard/src/components/sidebar.tsx`, remove the "Human" (feedback) nav item. Keep "Overview", "Minions", "Settings". Rename "Minions" nav items to match new sidebar: Graph, Kanban, Findings, Health, Settings, Your Input.

**Step 4: Clean up types.ts**

In `packages/dashboard/src/lib/types.ts`, remove feedback-specific types (`FeedbackSession`, `FeedbackMessage`, `FeedbackTheme`, `TesterProfile`, `TimelineEvent`). Keep all proposal/pipeline/run types.

**Step 5: Fix any broken imports**

```bash
npx tsc --noEmit
```

Fix any import errors from deleted files. The `loop-page-client.tsx` and `setup-checklist.tsx` likely reference feedback components — remove those references.

**Step 6: Verify build**

```bash
npm run build
```

**Step 7: Commit**

```bash
git add -A
git commit -m "chore: strip feedback-specific code from dashboard"
```

---

### Task 4: Strip Feedback-Specific Code from Agent

**Files:**
- Delete: `packages/agent/src/setup-worker.ts` — consumer repo setup, not needed
- Modify: `packages/agent/src/managed-worker.ts` — remove `setup` job type dispatch
- Modify: `packages/agent/src/managed-worker.ts` — rename `self_improve` references to target the minions repo instead of feedback-chat

**Step 1: Delete setup worker**

```bash
rm packages/agent/src/setup-worker.ts
```

**Step 2: Update managed-worker.ts**

Remove the `setup` case from the job type dispatch switch. Remove the `runSetupJob` import.

**Step 3: Update self-improve-worker.ts**

Change `FEEDBACK_CHAT_REPO` constant from `'NikitaDmitrieff/feedback-chat'` to the new minions repo name (`'NikitaDmitrieff/minions'` or whatever was chosen).

**Step 4: Verify build**

```bash
cd packages/agent && npm run build
```

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: strip feedback-specific code from agent"
```

---

## Phase 1: New Database Schema

### Task 5: Create Findings Table Migration

**Files:**
- Create: `packages/dashboard/supabase/migrations/00013_findings.sql`

**Step 1: Write the migration**

```sql
-- Findings table: Scout output
CREATE TABLE IF NOT EXISTS feedback_chat.findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES feedback_chat.projects(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN (
    'code_quality', 'tests', 'deps', 'security', 'perf', 'docs', 'dead_code'
  )),
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title text NOT NULL,
  description text NOT NULL,
  file_path text,
  line_range jsonb, -- { start: number, end: number }
  scout_run_id uuid,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'addressed', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE feedback_chat.findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own project findings"
  ON feedback_chat.findings FOR SELECT
  USING (project_id IN (
    SELECT id FROM feedback_chat.projects WHERE user_id = auth.uid()
  ));

-- Indexes
CREATE INDEX idx_findings_project ON feedback_chat.findings(project_id);
CREATE INDEX idx_findings_category ON feedback_chat.findings(project_id, category);
CREATE INDEX idx_findings_status ON feedback_chat.findings(project_id, status);
```

**Step 2: Apply migration locally**

```bash
cd packages/dashboard && npx supabase db push
```

**Step 3: Commit**

```bash
git add packages/dashboard/supabase/migrations/00013_findings.sql
git commit -m "feat: add findings table for scout output"
```

---

### Task 6: Create Health Snapshots Table Migration

**Files:**
- Create: `packages/dashboard/supabase/migrations/00014_health_snapshots.sql`

**Step 1: Write the migration**

```sql
-- Health snapshots: periodic health scores
CREATE TABLE IF NOT EXISTS feedback_chat.health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES feedback_chat.projects(id) ON DELETE CASCADE,
  score integer NOT NULL CHECK (score >= 0 AND score <= 100),
  breakdown jsonb NOT NULL DEFAULT '{}',
  -- { code_quality: 0-100, test_coverage: 0-100, dep_health: 0-100, security: 0-100, docs: 0-100 }
  findings_count integer NOT NULL DEFAULT 0,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, snapshot_date)
);

-- RLS
ALTER TABLE feedback_chat.health_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own project health"
  ON feedback_chat.health_snapshots FOR SELECT
  USING (project_id IN (
    SELECT id FROM feedback_chat.projects WHERE user_id = auth.uid()
  ));

-- Index
CREATE INDEX idx_health_project_date ON feedback_chat.health_snapshots(project_id, snapshot_date DESC);
```

**Step 2: Apply migration locally**

```bash
cd packages/dashboard && npx supabase db push
```

**Step 3: Commit**

```bash
git add packages/dashboard/supabase/migrations/00014_health_snapshots.sql
git commit -m "feat: add health snapshots table"
```

---

### Task 7: Create Branch Events Table Migration

**Files:**
- Create: `packages/dashboard/supabase/migrations/00015_branch_events.sql`

**Step 1: Write the migration**

```sql
-- Branch events: every action the minions take, powers the branch graph
CREATE TABLE IF NOT EXISTS feedback_chat.branch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES feedback_chat.projects(id) ON DELETE CASCADE,
  branch_name text, -- null for events not tied to a branch (e.g. scout_finding before proposal)
  event_type text NOT NULL CHECK (event_type IN (
    'scout_finding', 'proposal_created', 'proposal_approved', 'proposal_rejected',
    'build_started', 'build_completed', 'build_failed', 'build_remediation',
    'review_started', 'review_approved', 'review_rejected',
    'pr_created', 'pr_merged', 'deploy_preview', 'deploy_production',
    'branch_deleted'
  )),
  event_data jsonb NOT NULL DEFAULT '{}',
  -- Flexible payload: finding details, proposal scores, PR URL, diff stats, etc.
  actor text NOT NULL DEFAULT 'system',
  -- 'scout', 'strategist', 'builder', 'reviewer', 'user'
  commit_sha text, -- SHA of the commit this event relates to (set on build_completed, review_approved, pr_merged)
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE feedback_chat.branch_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own project branch events"
  ON feedback_chat.branch_events FOR SELECT
  USING (project_id IN (
    SELECT id FROM feedback_chat.projects WHERE user_id = auth.uid()
  ));

-- Indexes
CREATE INDEX idx_branch_events_project ON feedback_chat.branch_events(project_id, created_at DESC);
CREATE INDEX idx_branch_events_branch ON feedback_chat.branch_events(project_id, branch_name);
```

**Step 2: Apply migration locally**

```bash
cd packages/dashboard && npx supabase db push
```

**Step 3: Commit**

```bash
git add packages/dashboard/supabase/migrations/00015_branch_events.sql
git commit -m "feat: add branch events table for graph visualization"
```

---

### Task 8: Extend Projects Table + Update Job Types

**Files:**
- Create: `packages/dashboard/supabase/migrations/00016_minions_project_columns.sql`

**Step 1: Write the migration**

```sql
-- Add minions-specific columns to projects
ALTER TABLE feedback_chat.projects
  ADD COLUMN IF NOT EXISTS repo_url text,
  ADD COLUMN IF NOT EXISTS default_branch text DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS scout_schedule text DEFAULT '0 6 * * *',
  -- cron expression, default daily at 6am UTC
  ADD COLUMN IF NOT EXISTS max_concurrent_branches integer DEFAULT 3,
  ADD COLUMN IF NOT EXISTS paused boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS risk_paths jsonb DEFAULT '{"high": [], "medium": []}';
  -- File-path risk tiers: { high: ["src/auth/**", "migrations/**"], medium: ["src/api/**"] }

-- Update proposals to use source_finding_ids instead of source_theme_ids
ALTER TABLE feedback_chat.proposals
  ADD COLUMN IF NOT EXISTS source_finding_ids uuid[] DEFAULT '{}';

-- Expand job_type CHECK to include new worker types
ALTER TABLE feedback_chat.job_queue
  DROP CONSTRAINT IF EXISTS job_queue_job_type_check;
ALTER TABLE feedback_chat.job_queue
  ADD CONSTRAINT job_queue_job_type_check
  CHECK (job_type IN ('agent', 'setup', 'self_improve', 'strategize', 'scout', 'build', 'review'));
```

**Step 2: Apply migration locally**

```bash
cd packages/dashboard && npx supabase db push
```

**Step 3: Commit**

```bash
git add packages/dashboard/supabase/migrations/00016_minions_project_columns.sql
git commit -m "feat: extend projects table and job types for minions"
```

---

## Phase 2: Scout Worker

### Task 9: Create Scout Worker

**Files:**
- Create: `packages/agent/src/scout-worker.ts`

**Step 1: Write the scout worker**

The Scout clones the repo, runs Haiku to analyze code quality across categories, and stores findings. It follows the same pattern as `strategize-worker.ts` — uses Anthropic SDK directly (not CLI).

```typescript
// packages/agent/src/scout-worker.ts
import Anthropic from '@anthropic-ai/sdk';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createClient } from '@supabase/supabase-js';

const CATEGORIES = [
  'code_quality', 'tests', 'deps', 'security', 'perf', 'docs', 'dead_code'
] as const;

type Category = typeof CATEGORIES[number];
type Severity = 'low' | 'medium' | 'high' | 'critical';

interface Finding {
  category: Category;
  severity: Severity;
  title: string;
  description: string;
  file_path?: string;
  line_range?: { start: number; end: number };
}

interface ScoutJobInput {
  projectId: string;
  repoUrl: string;
  defaultBranch: string;
  installationToken: string;
}

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY required for Scout');
  return new Anthropic({ apiKey });
}

function cloneRepo(repoUrl: string, token: string, branch: string): string {
  const workdir = mkdtempSync(join(tmpdir(), 'minions-scout-'));
  const authedUrl = repoUrl.replace('https://', `https://x-access-token:${token}@`);
  // Disable git hooks to prevent arbitrary code execution from untrusted repos
  execSync(`git clone --depth 1 --branch ${branch} --config core.hooksPath=/dev/null ${authedUrl} repo`, {
    cwd: workdir,
    timeout: 60_000,
    stdio: 'pipe',
  });
  return join(workdir, 'repo');
}

function sampleFiles(repoDir: string, maxFiles: number = 30): string[] {
  const files: string[] = [];
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java'];

  function walk(dir: string) {
    if (files.length >= maxFiles) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', '.next', 'vendor'].includes(entry.name)) continue;
        walk(fullPath);
      } else if (extensions.some(ext => entry.name.endsWith(ext))) {
        const stat = statSync(fullPath);
        if (stat.size < 50_000) { // skip very large files
          files.push(fullPath);
        }
      }
    }
  }

  walk(repoDir);
  return files;
}

async function analyzeCategory(
  client: Anthropic,
  category: Category,
  fileContents: string,
  repoDir: string,
): Promise<Finding[]> {
  const prompts: Record<Category, string> = {
    code_quality: 'Find code smells, poor naming, overly complex functions, missing error handling, type safety gaps.',
    tests: 'Identify missing test coverage, untested edge cases, fragile tests, missing test files for source files.',
    deps: 'Check for outdated dependencies, unused dependencies, security advisories, missing lockfile entries.',
    security: 'Find hardcoded secrets, SQL injection risks, XSS vulnerabilities, insecure configurations, missing input validation.',
    perf: 'Identify N+1 queries, unnecessary re-renders, missing memoization, unoptimized loops, large bundle imports.',
    docs: 'Find missing README sections, undocumented public APIs, outdated comments, missing JSDoc/docstrings.',
    dead_code: 'Find unused exports, unreachable code, unused variables, deprecated functions still in codebase.',
  };

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `Analyze this codebase for: ${prompts[category]}

Return a JSON array of findings. Each finding: { "title": "...", "description": "...", "severity": "low|medium|high|critical", "file_path": "relative/path", "line_range": { "start": N, "end": N } }

If no issues found, return [].
No code fences, no markdown. Just the JSON array.

Files:
${fileContents}`
    }],
  });

  const text = (response.content[0] as { type: string; text: string }).text;
  const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();

  try {
    const parsed = JSON.parse(cleaned) as Array<{
      title: string; description: string; severity: Severity;
      file_path?: string; line_range?: { start: number; end: number };
    }>;
    return parsed.map(f => ({
      ...f,
      category,
      file_path: f.file_path?.replace(repoDir + '/', ''),
    }));
  } catch {
    console.error(`Failed to parse ${category} findings:`, cleaned.slice(0, 200));
    return [];
  }
}

function computeHealthScore(findings: Finding[]): {
  score: number;
  breakdown: Record<string, number>;
} {
  const breakdown: Record<string, number> = {};
  const severityPenalty = { low: 1, medium: 3, high: 7, critical: 15 };

  for (const cat of CATEGORIES) {
    const catFindings = findings.filter(f => f.category === cat);
    const penalty = catFindings.reduce((sum, f) => sum + severityPenalty[f.severity], 0);
    breakdown[cat] = Math.max(0, 100 - penalty * 2);
  }

  const score = Math.round(
    Object.values(breakdown).reduce((sum, v) => sum + v, 0) / CATEGORIES.length
  );

  return { score, breakdown };
}

export async function runScoutJob(input: ScoutJobInput): Promise<void> {
  const client = getAnthropicClient();
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: 'feedback_chat' } }
  );

  // Clone repo
  const repoDir = cloneRepo(input.repoUrl, input.installationToken, input.defaultBranch);

  try {
    // Sample files and build content string
    const files = sampleFiles(repoDir);
    const fileContents = files.map(f => {
      const relative = f.replace(repoDir + '/', '');
      const content = readFileSync(f, 'utf-8');
      return `--- ${relative} ---\n${content}\n`;
    }).join('\n');

    // Analyze each category in parallel
    const results = await Promise.all(
      CATEGORIES.map(cat => analyzeCategory(client, cat, fileContents, repoDir))
    );
    const allFindings = results.flat();

    // Deduplicate: fetch existing open findings to avoid inserting duplicates
    const { data: existing } = await supabase
      .from('findings')
      .select('title, file_path')
      .eq('project_id', input.projectId)
      .eq('status', 'open');

    const existingKeys = new Set(
      (existing || []).map(f => `${f.title}::${f.file_path || ''}`)
    );

    const newFindings = allFindings.filter(
      f => !existingKeys.has(`${f.title}::${f.file_path || ''}`)
    );

    // Store findings
    if (newFindings.length > 0) {
      const rows = newFindings.map(f => ({
        project_id: input.projectId,
        category: f.category,
        severity: f.severity,
        title: f.title,
        description: f.description,
        file_path: f.file_path || null,
        line_range: f.line_range || null,
        status: 'open',
      }));

      await supabase.from('findings').insert(rows);

      // Emit branch events for each new finding
      const events = newFindings.map(f => ({
        project_id: input.projectId,
        branch_name: null,
        event_type: 'scout_finding',
        event_data: { title: f.title, category: f.category, severity: f.severity, file_path: f.file_path },
        actor: 'scout',
      }));
      await supabase.from('branch_events').insert(events);
    }

    // Compute and store health snapshot
    const { score, breakdown } = computeHealthScore(allFindings);
    await supabase.from('health_snapshots').upsert({
      project_id: input.projectId,
      score,
      breakdown,
      findings_count: allFindings.length,
      snapshot_date: new Date().toISOString().split('T')[0],
    }, { onConflict: 'project_id,snapshot_date' });

    console.log(`Scout complete: ${allFindings.length} findings, health score: ${score}`);
  } finally {
    // Cleanup
    rmSync(repoDir.replace('/repo', ''), { recursive: true, force: true });
  }
}
```

**Step 2: Verify it compiles**

```bash
cd packages/agent && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add packages/agent/src/scout-worker.ts
git commit -m "feat: add scout worker for codebase analysis"
```

---

### Task 10: Wire Scout into Managed Worker

**Files:**
- Modify: `packages/agent/src/managed-worker.ts`

**Step 1: Add scout import and dispatch**

At the top of `managed-worker.ts`, add:
```typescript
import { runScoutJob } from './scout-worker.js';
```

In the `processJob()` dispatch switch, add a case for `'scout'`:
```typescript
case 'scout': {
  const token = await fetchInstallationToken(job.project_id);
  const project = await fetchProject(job.project_id);
  await runScoutJob({
    projectId: job.project_id,
    repoUrl: project.repo_url,
    defaultBranch: project.default_branch || 'main',
    installationToken: token,
  });
  break;
}
```

**Step 2: Add `fetchProject` helper** (if not already present)

```typescript
async function fetchProject(projectId: string) {
  const { data, error } = await supabase
    .from('projects')
    .select('repo_url, default_branch, scout_schedule, paused, max_concurrent_branches')
    .eq('id', projectId)
    .single();
  if (error || !data) throw new Error(`Project ${projectId} not found`);
  return data;
}
```

**Step 3: Auto-trigger strategist after scout completes**

After the scout case completes successfully, insert a strategize job:
```typescript
case 'scout': {
  // ... run scout ...

  // Auto-trigger strategist
  await supabase.from('job_queue').insert({
    project_id: job.project_id,
    job_type: 'strategize',
    status: 'pending',
    github_issue_number: 0,
    issue_title: 'Auto-strategize after scout',
    issue_body: JSON.stringify({ triggered_by: 'scout' }),
  });
  break;
}
```

**Step 4: Verify build**

```bash
cd packages/agent && npm run build
```

**Step 5: Commit**

```bash
git add packages/agent/src/managed-worker.ts
git commit -m "feat: wire scout worker into managed worker dispatch"
```

---

## Phase 3: Adapt Strategist

### Task 11: Adapt Strategize Worker for Findings

**Files:**
- Modify: `packages/agent/src/strategize-worker.ts`

**Step 1: Replace feedback theme fetching with findings fetching**

In `runStrategizeJob()`, replace the section that fetches `feedback_themes` and `feedback_sessions` with:

```typescript
// Fetch open findings (sorted by severity)
const { data: findings } = await supabase
  .from('findings')
  .select('id, category, severity, title, description, file_path')
  .eq('project_id', projectId)
  .eq('status', 'open')
  .order('severity', { ascending: false })
  .limit(50);
```

**Step 2: Update the generation prompt**

Replace theme references in the Haiku prompt with findings:

```
You are a product strategist analyzing codebase findings to propose improvements.

Findings (sorted by severity):
${JSON.stringify(findings, null, 2)}

Product context: ${productContext}
Strategic nudges (HIGH PRIORITY): ${nudges.join(', ')}
Previous proposals (avoid duplicates): ${existingProposals}
Strategy memory (learn from past decisions): ${memory}
User ideas: ${userIdeas}

Generate 1-3 improvement proposals. Each proposal should address one or more findings.
Return JSON array: [{ "title": "...", "rationale": "...", "spec": "...", "priority": "high|medium|low", "source_finding_ids": ["uuid", ...] }]
```

**Step 3: Update proposal insertion to use `source_finding_ids`**

When inserting proposals, use `source_finding_ids` from the Haiku response instead of `source_theme_ids`.

**Step 4: Mark addressed findings**

After proposals are created, update the source findings to `status: 'addressed'`:

```typescript
if (proposal.source_finding_ids?.length) {
  await supabase
    .from('findings')
    .update({ status: 'addressed' })
    .in('id', proposal.source_finding_ids);
}
```

**Step 5: Verify build**

```bash
cd packages/agent && npm run build
```

**Step 6: Commit**

```bash
git add packages/agent/src/strategize-worker.ts
git commit -m "feat: adapt strategist to use findings instead of feedback themes"
```

---

## Phase 4: Builder & Reviewer Workers

### Task 12: Create Builder Worker

**Files:**
- Create: `packages/agent/src/builder-worker.ts`

**Step 1: Write the builder worker**

The Builder follows the same pattern as `worker.ts` (runs Claude CLI via subprocess), but is scoped to a single proposal. It creates a `minions/*` branch and a PR. Key improvements over naive approach:
- **Sandbox safety:** disables git hooks, strips repo CLAUDE.md, limits env vars
- **Remediation loops:** on build/lint/test failure, feeds error back to CLI (max 2 retries)
- **Octokit for PRs:** uses GitHub REST API instead of `gh` CLI (not available in Docker)
- **SHA tracking:** records commit SHA on build_completed events

```typescript
// packages/agent/src/builder-worker.ts
import { execSync, spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createClient } from '@supabase/supabase-js';
import { Octokit } from '@octokit/rest';

const CLAUDE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const VALIDATION_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
const MAX_REMEDIATION_ATTEMPTS = 2;

interface BuilderJobInput {
  projectId: string;
  proposalId: string;
  proposalTitle: string;
  proposalSpec: string;
  repoUrl: string;
  defaultBranch: string;
  installationToken: string;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function runClaude(cwd: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', [
      '--dangerously-skip-permissions',
      '-p', prompt,
    ], {
      cwd,
      env: {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      },
      timeout: CLAUDE_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`Claude CLI exited ${code}: ${stderr.slice(0, 500)}`));
    });
    proc.on('error', reject);
  });
}

// Tiered validation: lint → typecheck → build → test (fail fast on cheapest)
function runValidation(repoDir: string): { passed: boolean; stage: string; error: string } {
  const stages = [
    { name: 'lint', cmd: 'npm run lint --if-present' },
    { name: 'typecheck', cmd: 'npx tsc --noEmit --pretty false' },
    { name: 'build', cmd: 'npm run build' },
    { name: 'test', cmd: 'npm test --if-present' },
  ];

  for (const stage of stages) {
    try {
      execSync(stage.cmd, { cwd: repoDir, timeout: VALIDATION_TIMEOUT_MS, stdio: 'pipe' });
    } catch (e) {
      return { passed: false, stage: stage.name, error: (e as Error).message.slice(0, 2000) };
    }
  }
  return { passed: true, stage: 'all', error: '' };
}

export async function runBuilderJob(input: BuilderJobInput): Promise<{
  branchName: string;
  prNumber: number;
  prUrl: string;
}> {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: 'feedback_chat' } }
  );

  const branchName = `minions/${slugify(input.proposalTitle)}`;
  const workdir = mkdtempSync(join(tmpdir(), 'minions-builder-'));
  const repoDir = join(workdir, 'repo');
  const authedUrl = input.repoUrl.replace('https://', `https://x-access-token:${input.installationToken}@`);

  // Parse owner/repo from URL
  const repoPath = input.repoUrl.replace('https://github.com/', '').replace(/\.git$/, '');
  const [owner, repo] = repoPath.split('/');
  const octokit = new Octokit({ auth: input.installationToken });

  try {
    // Clone with safety: disable git hooks to prevent arbitrary code execution
    execSync(
      `git clone --config core.hooksPath=/dev/null ${authedUrl} repo`,
      { cwd: workdir, timeout: 60_000, stdio: 'pipe' }
    );

    // Sandbox: strip repo's CLAUDE.md to prevent prompt injection
    const repoClaude = join(repoDir, 'CLAUDE.md');
    if (existsSync(repoClaude)) unlinkSync(repoClaude);

    execSync(`git checkout -b ${branchName}`, { cwd: repoDir, stdio: 'pipe' });

    // Emit build_started event
    await supabase.from('branch_events').insert({
      project_id: input.projectId,
      branch_name: branchName,
      event_type: 'build_started',
      event_data: { proposal_id: input.proposalId, proposal_title: input.proposalTitle },
      actor: 'builder',
    });

    // Scoped prompt for Claude CLI
    const prompt = `You are implementing a single, scoped change for this codebase.

## Proposal: ${input.proposalTitle}

${input.proposalSpec}

## Rules
- Implement ONLY what the proposal describes. Nothing else.
- Run build, lint, and tests to verify your changes work.
- Make minimal, focused changes.
- Do not refactor unrelated code.
- Do not add features beyond the proposal scope.`;

    // Run Claude CLI (initial attempt)
    await runClaude(repoDir, prompt);

    // Tiered validation with remediation loop
    let validation = runValidation(repoDir);
    let remediationAttempt = 0;

    while (!validation.passed && remediationAttempt < MAX_REMEDIATION_ATTEMPTS) {
      remediationAttempt++;

      // Emit remediation event
      await supabase.from('branch_events').insert({
        project_id: input.projectId,
        branch_name: branchName,
        event_type: 'build_remediation',
        event_data: {
          attempt: remediationAttempt,
          failed_stage: validation.stage,
          error: validation.error.slice(0, 1000),
        },
        actor: 'builder',
      });

      // Feed error back to Claude CLI for self-repair
      const fixPrompt = `The ${validation.stage} step failed with the following error. Fix it.

Error output:
${validation.error.slice(0, 5000)}

Rules:
- Fix ONLY the error described above.
- Do not change anything else.
- Run ${validation.stage} again after fixing.`;

      await runClaude(repoDir, fixPrompt);
      validation = runValidation(repoDir);
    }

    if (!validation.passed) {
      await supabase.from('branch_events').insert({
        project_id: input.projectId,
        branch_name: branchName,
        event_type: 'build_failed',
        event_data: {
          stage: validation.stage,
          error: validation.error.slice(0, 1000),
          remediation_attempts: remediationAttempt,
        },
        actor: 'builder',
      });
      throw new Error(`${validation.stage} failed after ${remediationAttempt} remediation attempts`);
    }

    // Check if there are actual changes
    const diff = execSync('git diff --stat', { cwd: repoDir, encoding: 'utf-8' });
    if (!diff.trim()) {
      throw new Error('Claude CLI produced no changes');
    }

    // Commit and push
    execSync('git add -A', { cwd: repoDir, stdio: 'pipe' });
    execSync(`git commit -m "feat: ${input.proposalTitle}"`, { cwd: repoDir, stdio: 'pipe' });
    const commitSha = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
    execSync(`git push origin ${branchName}`, { cwd: repoDir, timeout: 30_000, stdio: 'pipe' });

    // Create PR via Octokit (not gh CLI — Docker doesn't have it)
    const prBody = `## Proposal\n\n${input.proposalSpec}\n\n---\n*Built by Minions Builder*`;
    const { data: pr } = await octokit.pulls.create({
      owner,
      repo,
      title: input.proposalTitle,
      body: prBody,
      head: branchName,
      base: input.defaultBranch,
    });

    // Emit events with commit SHA
    await supabase.from('branch_events').insert([
      {
        project_id: input.projectId,
        branch_name: branchName,
        event_type: 'build_completed',
        event_data: { diff_stats: diff.trim(), proposal_id: input.proposalId },
        actor: 'builder',
        commit_sha: commitSha,
      },
      {
        project_id: input.projectId,
        branch_name: branchName,
        event_type: 'pr_created',
        event_data: { pr_number: pr.number, pr_url: pr.html_url },
        actor: 'builder',
        commit_sha: commitSha,
      },
    ]);

    // Update proposal status
    await supabase.from('proposals')
      .update({ status: 'implementing', github_issue_number: pr.number })
      .eq('id', input.proposalId);

    return { branchName, prNumber: pr.number, prUrl: pr.html_url };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}
```

**Step 2: Verify build**

```bash
cd packages/agent && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add packages/agent/src/builder-worker.ts
git commit -m "feat: add builder worker — implements proposals via Claude CLI"
```

---

### Task 13: Create Reviewer Worker

**Files:**
- Create: `packages/agent/src/reviewer-worker.ts`

**Step 1: Write the reviewer worker**

The Reviewer uses the Anthropic SDK (not Claude CLI) to free CLI sessions for Builders. Key improvements:
- **SDK instead of CLI:** Uses Haiku/Sonnet via `ANTHROPIC_API_KEY` — cheaper and frees CLI concurrency slots
- **SHA-pinned reviews:** Records the commit SHA it reviewed. Downstream merge checks verify HEAD matches.
- **File-path risk tiers:** Checks if changed files touch high-risk paths from project settings. Flags for human review.
- **Posts to GitHub PR:** Review comments are posted to the actual PR via Octokit, not just stored in branch_events.

```typescript
// packages/agent/src/reviewer-worker.ts
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { Octokit } from '@octokit/rest';
import { minimatch } from 'minimatch';

interface ReviewerJobInput {
  projectId: string;
  proposalId: string;
  branchName: string;
  prNumber: number;
  repoUrl: string;
  defaultBranch: string;
  installationToken: string;
}

interface ReviewResult {
  approved: boolean;
  comments: string[];
  risk_flags: string[];
}

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY required for Reviewer');
  return new Anthropic({ apiKey });
}

// Check if any changed files match high-risk or medium-risk path patterns
function checkRiskPaths(
  changedFiles: string[],
  riskPaths: { high: string[]; medium: string[] }
): { level: 'high' | 'medium' | 'low'; matches: string[] } {
  const highMatches = changedFiles.filter(f =>
    riskPaths.high.some(pattern => minimatch(f, pattern))
  );
  if (highMatches.length > 0) return { level: 'high', matches: highMatches };

  const mediumMatches = changedFiles.filter(f =>
    riskPaths.medium.some(pattern => minimatch(f, pattern))
  );
  if (mediumMatches.length > 0) return { level: 'medium', matches: mediumMatches };

  return { level: 'low', matches: [] };
}

export async function runReviewerJob(input: ReviewerJobInput): Promise<ReviewResult> {
  const anthropic = getAnthropicClient();
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: 'feedback_chat' } }
  );

  const repoPath = input.repoUrl.replace('https://github.com/', '').replace(/\.git$/, '');
  const [owner, repo] = repoPath.split('/');
  const octokit = new Octokit({ auth: input.installationToken });

  // Emit review_started
  await supabase.from('branch_events').insert({
    project_id: input.projectId,
    branch_name: input.branchName,
    event_type: 'review_started',
    event_data: { pr_number: input.prNumber },
    actor: 'reviewer',
  });

  // Fetch PR diff and changed files via GitHub API (no clone needed)
  const [{ data: files }, { data: pr }] = await Promise.all([
    octokit.pulls.listFiles({ owner, repo, pull_number: input.prNumber }),
    octokit.pulls.get({ owner, repo, pull_number: input.prNumber }),
  ]);

  const headSha = pr.head.sha;
  const changedFileNames = files.map(f => f.filename);
  const diffContent = files.map(f =>
    `--- ${f.filename} (${f.status}, +${f.additions} -${f.deletions})\n${f.patch || '(binary)'}`
  ).join('\n\n');

  // Check file-path risk tiers
  const { data: project } = await supabase
    .from('projects')
    .select('risk_paths')
    .eq('id', input.projectId)
    .single();

  const riskPaths = project?.risk_paths || { high: [], medium: [] };
  const risk = checkRiskPaths(changedFileNames, riskPaths);

  // Fetch revert lessons from strategy memory for context
  const { data: lessons } = await supabase
    .from('strategy_memory')
    .select('themes')
    .eq('project_id', input.projectId)
    .eq('event_type', 'reverted')
    .limit(10);

  const lessonsContext = lessons?.length
    ? `\nPast reverted changes (avoid similar mistakes):\n${lessons.map(l => `- ${l.themes}`).join('\n')}`
    : '';

  // Run Haiku/Sonnet review via Anthropic SDK
  const reviewPrompt = `You are reviewing a pull request. Analyze the diff for:
1. Bugs or logic errors
2. Security vulnerabilities
3. Performance regressions
4. Missing error handling
5. Style/convention violations
${risk.level !== 'low' ? `\n⚠️ HIGH-RISK FILES CHANGED: ${risk.matches.join(', ')}. Extra scrutiny required.` : ''}
${lessonsContext}

Changed files: ${changedFileNames.join(', ')}

Diff:
${diffContent.slice(0, 80_000)}

Respond with JSON: { "approved": boolean, "comments": ["issue description"] }
If the code is good, set approved: true and comments: [].
No code fences. Just the JSON object.`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [{ role: 'user', content: reviewPrompt }],
  });

  const text = (response.content[0] as { type: string; text: string }).text;
  const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();

  let result: ReviewResult;
  try {
    const parsed = JSON.parse(cleaned) as { approved: boolean; comments: string[] };
    result = { ...parsed, risk_flags: risk.matches };
  } catch {
    result = { approved: true, comments: ['Review parsing failed — defaulting to approved'], risk_flags: [] };
  }

  // If high-risk files are touched, force human review regardless of AI approval
  if (risk.level === 'high') {
    result.approved = false;
    result.comments.unshift(
      `⚠️ HIGH-RISK FILES MODIFIED: ${risk.matches.join(', ')}. Requires human review.`
    );
  }

  // Post review to the actual GitHub PR
  const reviewBody = result.approved
    ? '✅ **Minions Reviewer: Approved**\n\nNo issues found.'
    : `⚠️ **Minions Reviewer: Changes Requested**\n\n${result.comments.map((c, i) => `${i + 1}. ${c}`).join('\n')}`;

  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number: input.prNumber,
    event: result.approved ? 'APPROVE' : 'REQUEST_CHANGES',
    body: reviewBody,
  });

  // Emit review result event with SHA
  await supabase.from('branch_events').insert({
    project_id: input.projectId,
    branch_name: input.branchName,
    event_type: result.approved ? 'review_approved' : 'review_rejected',
    event_data: {
      pr_number: input.prNumber,
      comments: result.comments,
      risk_level: risk.level,
      risk_files: risk.matches,
    },
    actor: 'reviewer',
    commit_sha: headSha,
  });

  return result;
}
```

**Step 2: Verify build**

```bash
cd packages/agent && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add packages/agent/src/reviewer-worker.ts
git commit -m "feat: add reviewer worker — checks builder PRs via Claude CLI"
```

---

### Task 14: Wire Builder and Reviewer into Managed Worker

**Files:**
- Modify: `packages/agent/src/managed-worker.ts`

**Step 1: Add imports**

```typescript
import { runBuilderJob } from './builder-worker.js';
import { runReviewerJob } from './reviewer-worker.js';
```

**Step 2: Add `build` case to dispatch**

```typescript
case 'build': {
  const token = await fetchInstallationToken(job.project_id);
  const project = await fetchProject(job.project_id);
  const payload = JSON.parse(job.issue_body || '{}');

  const result = await runBuilderJob({
    projectId: job.project_id,
    proposalId: payload.proposal_id,
    proposalTitle: job.issue_title || 'Untitled proposal',
    proposalSpec: payload.spec || '',
    repoUrl: project.repo_url,
    defaultBranch: project.default_branch || 'main',
    installationToken: token,
  });

  // Auto-trigger reviewer
  await supabase.from('job_queue').insert({
    project_id: job.project_id,
    job_type: 'review',
    status: 'pending',
    github_issue_number: result.prNumber,
    issue_title: `Review: ${job.issue_title}`,
    issue_body: JSON.stringify({
      proposal_id: payload.proposal_id,
      branch_name: result.branchName,
      pr_number: result.prNumber,
    }),
  });
  break;
}
```

**Step 3: Add `review` case to dispatch**

```typescript
case 'review': {
  const token = await fetchInstallationToken(job.project_id);
  const project = await fetchProject(job.project_id);
  const payload = JSON.parse(job.issue_body || '{}');

  await runReviewerJob({
    projectId: job.project_id,
    proposalId: payload.proposal_id,
    branchName: payload.branch_name,
    prNumber: payload.pr_number,
    repoUrl: project.repo_url,
    defaultBranch: project.default_branch || 'main',
    installationToken: token,
  });
  break;
}
```

**Step 4: Verify build**

```bash
cd packages/agent && npm run build
```

**Step 5: Commit**

```bash
git add packages/agent/src/managed-worker.ts
git commit -m "feat: wire builder and reviewer into managed worker dispatch"
```

---

## Phase 5: Dashboard — Branch Graph

### Task 15: Create Branch Graph API Route

**Files:**
- Create: `packages/dashboard/src/app/api/graph/[projectId]/route.ts`

**Step 1: Write the API route**

```typescript
import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const supabase = await createClient();

  // Fetch branch events for the project, ordered by time
  const { data: events, error } = await supabase
    .from('branch_events')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Group events by branch
  const branches = new Map<string, typeof events>();
  const unbranched: typeof events = [];

  for (const event of events || []) {
    if (event.branch_name) {
      const existing = branches.get(event.branch_name) || [];
      existing.push(event);
      branches.set(event.branch_name, existing);
    } else {
      unbranched.push(event);
    }
  }

  // Determine branch states
  const branchStates = Array.from(branches.entries()).map(([name, events]) => {
    const lastEvent = events[events.length - 1];
    let state: string;

    if (lastEvent.event_type === 'pr_merged') state = 'merged';
    else if (lastEvent.event_type === 'proposal_rejected' || lastEvent.event_type === 'review_rejected') state = 'rejected';
    else if (lastEvent.event_type === 'build_failed') state = 'failed';
    else if (lastEvent.event_type === 'deploy_production') state = 'deployed';
    else if (lastEvent.event_type === 'build_started' || lastEvent.event_type === 'review_started') state = 'active';
    else if (lastEvent.event_type === 'review_approved' || lastEvent.event_type === 'build_completed') state = 'awaiting_approval';
    else state = 'pending';

    return { name, state, events, lastActivity: lastEvent.created_at };
  });

  // Fetch pending/queued jobs for "scheduled" view
  const { data: pendingJobs } = await supabase
    .from('job_queue')
    .select('id, job_type, status, issue_title, created_at')
    .eq('project_id', projectId)
    .in('status', ['pending', 'processing'])
    .order('created_at', { ascending: true });

  // Fetch next scout schedule
  const { data: project } = await supabase
    .from('projects')
    .select('scout_schedule, paused')
    .eq('id', projectId)
    .single();

  return NextResponse.json({
    branches: branchStates.sort((a, b) =>
      new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    ),
    unbranched,
    scheduled: {
      pending_jobs: pendingJobs || [],
      scout_schedule: project?.scout_schedule || '0 6 * * *',
      paused: project?.paused || false,
    },
  });
}
```

**Step 2: Verify build**

```bash
cd packages/dashboard && npm run build
```

**Step 3: Commit**

```bash
git add packages/dashboard/src/app/api/graph/
git commit -m "feat: add branch graph API route"
```

---

### Task 16: Create Branch Graph Component

**Files:**
- Create: `packages/dashboard/src/components/branch-graph.tsx`

**Step 1: Write the branch graph component**

This is the killing feature — a visual SVG-based graph showing branches, nodes, and their states. Build it as a client component with interactive click-to-expand nodes.

```tsx
'use client';

import { useState, useEffect, useMemo } from 'react';

// Types
interface BranchEvent {
  id: string;
  project_id: string;
  branch_name: string | null;
  event_type: string;
  event_data: Record<string, unknown>;
  actor: string;
  created_at: string;
}

interface Branch {
  name: string;
  state: 'active' | 'awaiting_approval' | 'merged' | 'rejected' | 'failed' | 'deployed' | 'pending';
  events: BranchEvent[];
  lastActivity: string;
}

interface GraphData {
  branches: Branch[];
  unbranched: BranchEvent[];
  scheduled: {
    pending_jobs: Array<{ id: string; job_type: string; status: string; issue_title: string; created_at: string }>;
    scout_schedule: string;
    paused: boolean;
  };
}

// State colors
const STATE_COLORS: Record<string, { line: string; glow: string; label: string }> = {
  active:             { line: '#3b82f6', glow: '#3b82f680', label: 'Building' },
  awaiting_approval:  { line: '#f59e0b', glow: '#f59e0b40', label: 'Awaiting Review' },
  merged:             { line: '#22c55e', glow: '#22c55e40', label: 'Merged' },
  rejected:           { line: '#ef4444', glow: '#ef444440', label: 'Rejected' },
  failed:             { line: '#ef4444', glow: '#ef444440', label: 'Failed' },
  deployed:           { line: '#8b5cf6', glow: '#8b5cf640', label: 'Deployed' },
  pending:            { line: '#6b7280', glow: '#6b728040', label: 'Pending' },
};

const EVENT_LABELS: Record<string, string> = {
  scout_finding: 'Scout found',
  proposal_created: 'Proposed',
  proposal_approved: 'Approved',
  proposal_rejected: 'Rejected',
  build_started: 'Builder started',
  build_completed: 'Build complete',
  build_failed: 'Build failed',
  review_started: 'Reviewer started',
  review_approved: 'Review approved',
  review_rejected: 'Review rejected',
  pr_created: 'PR created',
  pr_merged: 'Merged',
  deploy_preview: 'Preview deployed',
  deploy_production: 'Shipped',
  branch_deleted: 'Branch deleted',
};

// Node component
function EventNode({
  event, x, y, color, onClick
}: {
  event: BranchEvent; x: number; y: number; color: string;
  onClick: (event: BranchEvent) => void;
}) {
  const label = EVENT_LABELS[event.event_type] || event.event_type;
  const title = (event.event_data as { title?: string })?.title || label;

  return (
    <g
      className="cursor-pointer transition-opacity hover:opacity-80"
      onClick={() => onClick(event)}
    >
      <circle cx={x} cy={y} r={6} fill={color} stroke="white" strokeWidth={1.5} />
      <text x={x + 12} y={y + 4} fill="#d1d5db" fontSize={11} fontFamily="monospace">
        {title.length > 35 ? title.slice(0, 35) + '...' : title}
      </text>
    </g>
  );
}

// Main graph
export function BranchGraph({
  projectId,
  onEventClick,
}: {
  projectId: string;
  onEventClick?: (event: BranchEvent) => void;
}) {
  const [data, setData] = useState<GraphData | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<BranchEvent | null>(null);

  // Poll for updates
  useEffect(() => {
    const fetchData = async () => {
      const res = await fetch(`/api/graph/${projectId}`);
      if (res.ok) setData(await res.json());
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [projectId]);

  const handleClick = (event: BranchEvent) => {
    setSelectedEvent(event);
    onEventClick?.(event);
  };

  if (!data) {
    return (
      <div className="glass-card p-8 text-center text-gray-400">
        Loading branch graph...
      </div>
    );
  }

  if (data.branches.length === 0 && data.unbranched.length === 0) {
    return (
      <div className="glass-card p-8 text-center text-gray-400">
        No activity yet. Run a Scout scan to get started.
      </div>
    );
  }

  // Layout calculations
  const MAIN_Y = 40;
  const BRANCH_START_X = 80;
  const BRANCH_SPACING_Y = 120;
  const NODE_SPACING_X = 50;
  const NODE_SPACING_Y = 28;
  const width = Math.max(800, data.branches.reduce((max, b) =>
    Math.max(max, BRANCH_START_X + b.events.length * NODE_SPACING_X + 200), 0
  ));
  const height = MAIN_Y + (data.branches.length + 1) * BRANCH_SPACING_Y;

  return (
    <div className="glass-card p-4 overflow-x-auto">
      <svg width={width} height={height} className="min-w-full">
        {/* Main branch line */}
        <line x1={0} y1={MAIN_Y} x2={width} y2={MAIN_Y}
          stroke="#6b7280" strokeWidth={2} />
        <text x={10} y={MAIN_Y - 10} fill="#9ca3af" fontSize={12} fontFamily="monospace">
          main
        </text>

        {/* Branch lines and nodes */}
        {data.branches.map((branch, bi) => {
          const branchY = MAIN_Y + (bi + 1) * BRANCH_SPACING_Y;
          const forkX = BRANCH_START_X + bi * 60;
          const colors = STATE_COLORS[branch.state] || STATE_COLORS.pending;
          const isActive = branch.state === 'active';

          return (
            <g key={branch.name}>
              {/* Fork line from main */}
              <line x1={forkX} y1={MAIN_Y} x2={forkX} y2={branchY}
                stroke={colors.line} strokeWidth={1.5}
                strokeDasharray={branch.state === 'awaiting_approval' ? '6 3' : undefined}
              />

              {/* Branch merge line back to main (if merged) */}
              {branch.state === 'merged' && (
                <line
                  x1={forkX + branch.events.length * NODE_SPACING_X}
                  y1={branchY}
                  x2={forkX + branch.events.length * NODE_SPACING_X + 30}
                  y2={MAIN_Y}
                  stroke={colors.line} strokeWidth={1.5}
                />
              )}

              {/* Main dot on main line */}
              <circle cx={forkX} cy={MAIN_Y} r={4} fill={colors.line} />

              {/* Branch label */}
              <text x={forkX + 10} y={branchY - 8} fill={colors.line} fontSize={11} fontFamily="monospace">
                {branch.name.replace('minions/', '')}
              </text>

              {/* State badge */}
              <text x={forkX + 10} y={branchY + 16} fill={colors.line} fontSize={9} fontFamily="monospace" opacity={0.7}>
                {colors.label}
              </text>

              {/* Active pulse animation */}
              {isActive && (
                <circle cx={forkX} cy={branchY} r={10} fill="none"
                  stroke={colors.glow} strokeWidth={2}>
                  <animate attributeName="r" values="6;14;6" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
                </circle>
              )}

              {/* Event nodes */}
              {branch.events.map((event, ei) => (
                <EventNode
                  key={event.id}
                  event={event}
                  x={forkX + (ei + 1) * NODE_SPACING_X}
                  y={branchY + (ei % 2 === 0 ? 0 : NODE_SPACING_Y)}
                  color={colors.line}
                  onClick={handleClick}
                />
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
```

**Step 2: Verify build**

```bash
cd packages/dashboard && npm run build
```

**Step 3: Commit**

```bash
git add packages/dashboard/src/components/branch-graph.tsx
git commit -m "feat: add branch graph visualization component"
```

---

### Task 17: Create Event Detail Slide-Over

**Files:**
- Create: `packages/dashboard/src/components/event-slide-over.tsx`

**Step 1: Write the slide-over component**

This shows full details when a user clicks a node in the branch graph. Pattern matches the existing `proposal-slide-over.tsx` and `run-slide-over.tsx`.

The slide-over should show different content based on `event_type`:
- `scout_finding` — finding title, description, severity badge, file path, code context
- `proposal_created` — title, rationale, spec, scores (4-dimension bar chart)
- `build_started` / `build_completed` — diff stats, build output, elapsed time
- `build_failed` — error output, failure reason
- `review_started` / `review_approved` / `review_rejected` — review comments
- `pr_created` / `pr_merged` — PR link, commit SHA, files changed
- `deploy_preview` — Vercel preview URL (iframe embed if available)
- `deploy_production` — production URL

Use the same glass-card styling pattern from existing slide-overs. Include a close button and escape-key handler. The component receives an event object and renders the appropriate detail view.

**Step 2: Verify build**

```bash
cd packages/dashboard && npm run build
```

**Step 3: Commit**

```bash
git add packages/dashboard/src/components/event-slide-over.tsx
git commit -m "feat: add event detail slide-over for branch graph nodes"
```

---

### Task 18: Create Scheduled Actions Panel

**Files:**
- Create: `packages/dashboard/src/components/scheduled-panel.tsx`

**Step 1: Write the scheduled actions panel**

Shows upcoming work: next scout scan time, queued builder jobs, strategist runs, and focus areas based on nudges and lowest health scores. Displays alongside the branch graph.

Fetch data from the same `/api/graph/[projectId]` endpoint (the `scheduled` field). Also fetch health breakdown from `/api/health/[projectId]` to show focus areas.

Include:
- Countdown to next Scout scan (parse cron expression)
- List of queued/processing jobs with position numbers
- Focus areas derived from strategic nudges + lowest health scores
- "Pause all" / "Resume" button

**Step 2: Verify build**

```bash
cd packages/dashboard && npm run build
```

**Step 3: Commit**

```bash
git add packages/dashboard/src/components/scheduled-panel.tsx
git commit -m "feat: add scheduled actions panel"
```

---

## Phase 6: Dashboard Pages

### Task 19: Create Graph Page (Default Project View)

**Files:**
- Modify: `packages/dashboard/src/app/projects/[id]/page.tsx` — replace Loop page with Graph page
- Modify: `packages/dashboard/src/components/sidebar.tsx` — update nav to new structure

**Step 1: Replace the project overview page**

The graph page becomes the default view. It combines:
- `BranchGraph` component (full width)
- `ScheduledPanel` component (sidebar or bottom panel)
- Active worker indicators
- "Run Scout Now" button

**Step 2: Update sidebar navigation**

Replace existing nav items with:
```
Graph (default) — /projects/[id]
Kanban — /projects/[id]/kanban
Findings — /projects/[id]/findings
Health — /projects/[id]/health
Settings — /projects/[id]/settings
Your Input — /projects/[id]/input
```

**Step 3: Verify build and navigation**

```bash
cd packages/dashboard && npm run build
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: replace project overview with branch graph page"
```

---

### Task 20: Create Findings Page

**Files:**
- Create: `packages/dashboard/src/app/projects/[id]/findings/page.tsx`
- Create: `packages/dashboard/src/app/projects/[id]/findings/client.tsx`
- Create: `packages/dashboard/src/app/api/findings/[projectId]/route.ts`

**Step 1: Create findings API route**

GET endpoint that fetches findings for a project with optional filters (category, severity, status). Supports pagination.

**Step 2: Create findings page (server component)**

Fetches initial data server-side, passes to client component.

**Step 3: Create findings client component**

Filterable list with:
- Category filter chips (code_quality, tests, deps, security, perf, docs, dead_code)
- Severity filter (low, medium, high, critical)
- Status filter (open, addressed, dismissed)
- Each finding shows: severity badge, title, description, file path with line range
- Bulk actions: dismiss selected, mark as priority
- Click to expand: full description, suggested fix

**Step 4: Verify build**

```bash
cd packages/dashboard && npm run build
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add findings page with category and severity filters"
```

---

### Task 21: Create Health Page

**Files:**
- Create: `packages/dashboard/src/app/projects/[id]/health/page.tsx`
- Create: `packages/dashboard/src/app/projects/[id]/health/client.tsx`
- Create: `packages/dashboard/src/app/api/health/[projectId]/route.ts`

**Step 1: Create health API route**

GET endpoint that fetches health snapshots for a project. Returns array of snapshots sorted by date, plus the latest breakdown.

**Step 2: Create health page**

Shows:
- Big health score number (0-100) with color coding (red < 40, amber < 70, green >= 70)
- Sparkline chart showing score trend over last 30 days
- Breakdown bars: code quality, test coverage, dep health, security, docs — each 0-100
- Before/after comparison if multiple snapshots exist
- "Run Scout Now" button to trigger a fresh scan

**Step 3: Verify build**

```bash
cd packages/dashboard && npm run build
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add health score page with trend chart"
```

---

### Task 22: Adapt Kanban Page

**Files:**
- Modify: `packages/dashboard/src/app/projects/[id]/minions/` — rename to `kanban/` or keep and redirect

**Step 1: Adapt the existing minions pipeline-tab**

The existing `pipeline-tab.tsx` already has a 3-lane Kanban. Adapt it to the new 4-column layout: Proposed → Approved → Building → Shipped.

- **Proposed** column: shows proposals with `status: 'draft'`. Score bars. Approve/Reject/Edit buttons.
- **Approved** column: shows proposals with `status: 'approved'`. Queue position.
- **Building** column: shows proposals with `status: 'implementing'` + active build/review jobs. Live logs via `live-log-tail.tsx`. Elapsed time. Cancel button.
- **Shipped** column: shows proposals with `status: 'done'`. PR links. Revert button.

**Step 2: Update the proposals approval flow**

When a user approves a proposal from the Kanban, the API should:
1. Update proposal status to `approved`
2. Insert a `build` job into `job_queue` (not create a GitHub issue — the Builder creates the PR directly)
3. Insert a `proposal_approved` branch event

**Step 3: Verify build**

```bash
cd packages/dashboard && npm run build
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: adapt kanban page for minions proposal workflow"
```

---

### Task 23: Create Your Input Page

**Files:**
- Create: `packages/dashboard/src/app/projects/[id]/input/page.tsx`
- Create: `packages/dashboard/src/app/projects/[id]/input/client.tsx`

**Step 1: Create the input page**

Extracts the "Your Input" section from the existing proposals-tab. Three sections:
- **Quick Idea** — text input to submit ideas (stored in `user_ideas` table)
- **Manual Proposal** — form to create a proposal directly (title, spec, priority), bypasses Scout/Strategist
- **Priority Overrides** — drag findings or proposals to reorder their priority

**Step 2: Verify build**

```bash
cd packages/dashboard && npm run build
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add your input page for ideas and manual proposals"
```

---

### Task 24: Adapt Settings Page

**Files:**
- Modify: `packages/dashboard/src/app/projects/[id]/settings/client.tsx`

**Step 1: Update settings fields**

Keep existing fields (product context, strategic nudges). Add new fields:
- **Scout Schedule** — dropdown: "Daily (6am UTC)", "Twice daily (6am, 6pm)", "Weekly (Monday 6am)", "Custom cron"
- **Autonomy Mode** — radio group: Audit (default), Assist, Automate — with descriptions
- **Max Concurrent Branches** — number input (default 3)
- **Vercel Integration** — input for Vercel bypass secret
- **Pause/Resume** — toggle to pause all minion activity
- **Kill Switch** — "Pause All Minions" button with confirmation

**Step 2: Create settings API updates**

Update `/api/projects/[id]/settings/route.ts` to handle the new fields (scout_schedule, max_concurrent_branches, paused).

**Step 3: Verify build**

```bash
cd packages/dashboard && npm run build
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: adapt settings page for minions configuration"
```

---

## Phase 7: Onboarding & Repo Connection

### Task 25: Create Repo Connection Flow

**Files:**
- Modify: `packages/dashboard/src/app/page.tsx` — projects list with "Connect Repo" button
- Create: `packages/dashboard/src/app/connect/page.tsx` — repo picker
- Create: `packages/dashboard/src/app/api/connect/route.ts` — repo connection handler

**Step 1: Create the repo picker page**

After GitHub OAuth, show a list of the user's repos (fetched via GitHub App installation). User clicks a repo to connect it. On connection:
1. Insert project record with `repo_url`, `default_branch`
2. Immediately queue a `scout` job
3. Redirect to the project's graph page

**Step 2: Update the home page**

Show connected repos as cards with: repo name, health score badge, last activity, active worker count. "Connect Repo" CTA. Empty state for new users.

**Step 3: Verify build**

```bash
cd packages/dashboard && npm run build
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add repo connection flow and projects home page"
```

---

## Phase 8: Deployment

### Task 26: Create New GitHub App

**Step 1: Register a new GitHub App**

Go to https://github.com/settings/apps/new:
- Name: `minions-agent` (or chosen name)
- Homepage URL: your dashboard URL
- Webhook URL: `https://your-dashboard.vercel.app/api/github-app/webhook`
- Permissions: Contents (read/write), Pull requests (read/write), Issues (read), Checks (write)
- Events: Push, Pull request
- Setup URL: `https://your-dashboard.vercel.app/auth/github-app/setup`

**Step 2: Update env vars**

Update `packages/dashboard/.env.local` and `packages/agent/.env` with new GitHub App credentials.

**Step 3: Commit env changes (not secrets)**

```bash
git commit -m "chore: configure new GitHub App"
```

---

### Task 27: Create New Supabase Project

**Step 1: Create a new Supabase project for Minions**

```bash
cd packages/dashboard
npx supabase init  # if not already initialized
npx supabase db push  # apply all migrations to new project
```

**Step 2: Configure auth**

Enable GitHub OAuth in Supabase Auth settings.

**Step 3: Update env vars with new Supabase credentials**

---

### Task 28: Deploy Dashboard to Vercel

**Step 1: Create Vercel project**

```bash
cd packages/dashboard
vercel link
```

**Step 2: Set env vars on Vercel**

All `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_APP_*`, `APP_URL`.

**Step 3: Deploy**

```bash
vercel --prod
```

**Step 4: Verify dashboard loads**

---

### Task 29: Deploy Agent to Railway

**Step 1: Create new Railway project**

```bash
cd packages/agent
railway init
railway up --detach
```

**Step 2: Set env vars**

```bash
railway variables set \
  SUPABASE_URL=... \
  SUPABASE_SERVICE_ROLE_KEY=... \
  GITHUB_APP_ID=... \
  GITHUB_APP_PRIVATE_KEY=... \
  CLAUDE_CREDENTIALS_JSON='...' \
  ANTHROPIC_API_KEY=...
```

**Step 3: Get public domain**

```bash
railway domain
```

**Step 4: Verify agent is polling**

Check Railway logs for "Polling for jobs..." output.

---

### Task 30: Set Up Scout Cron

**Files:**
- Create: `.github/workflows/scout.yml`

**Step 1: Create GitHub Actions cron workflow**

```yaml
name: Scout Scan
on:
  schedule:
    - cron: '0 6 * * *'  # Daily at 6am UTC
  workflow_dispatch: {}

jobs:
  trigger-scout:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Scout for all active projects
        run: |
          curl -X POST "${{ secrets.DASHBOARD_URL }}/api/scout/trigger" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            -H "Content-Type: application/json"
```

**Step 2: Create the trigger API route**

Create `packages/dashboard/src/app/api/scout/trigger/route.ts` that inserts `scout` jobs for all non-paused projects.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add scout cron trigger via GitHub Actions"
```

---

## Phase 9: End-to-End Verification

### Task 31: Full Pipeline Test

**Step 1: Connect a test repo**

Connect a small test repo via the dashboard.

**Step 2: Trigger Scout scan**

Click "Run Scout Now" on the graph page.

**Step 3: Verify findings appear**

Check the Findings page — should show categorized issues.

**Step 4: Verify health score**

Check the Health page — should show initial score with breakdown.

**Step 5: Verify proposals**

Wait for Strategist to run (auto-triggered after Scout). Check Kanban for draft proposals.

**Step 6: Approve a proposal**

Approve one proposal. Watch the graph — Builder node should appear with pulsing animation.

**Step 7: Verify Builder creates PR**

Check the test repo for a new `minions/*` branch and PR.

**Step 8: Verify Reviewer runs**

After Builder completes, Reviewer should auto-trigger. Check graph for review node.

**Step 9: Verify branch graph shows full history**

The graph should show: Scout finding → Proposal → Build → Review → PR, with clickable nodes showing details.

**Step 10: Merge the PR**

One-click merge from dashboard (or from GitHub). Verify merge event appears on graph.

---

Plan complete and saved to `docs/plans/2026-02-20-minions-implementation-plan.md`.

**Execution options:**

1. **Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** — Open a new session with `executing-plans`, batch execution with checkpoints

3. **Team-Based (parallel, this session)** — Spawn an agent team with parallel implementers and reviewers, coordinated via shared task list

Which approach?