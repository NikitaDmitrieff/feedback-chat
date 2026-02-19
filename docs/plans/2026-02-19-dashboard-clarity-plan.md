# Dashboard Clarity & Tester Profiles Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add tester identity collection in the widget, tester profile pages with activity timelines in the dashboard, connect pipeline runs back to their originating feedback, and enhance the testers tab with avatars, run counts, and sort controls.

**Architecture:** Widget gets a name gate between password auth and chat. Dashboard gets new API routes for enriched runs (joined with feedback sessions) and tester profiles (merged timeline of sessions + runs). New tester profile page + enhanced existing components.

**Tech Stack:** React, Next.js 15 (App Router), Supabase (feedback_chat schema), TypeScript, Tailwind v4, Lucide icons.

---

### Task 1: Widget — Add Name Gate After Password Auth

**Files:**
- Modify: `packages/widget/src/client/feedback-panel.tsx:16-141`

**Context:** Currently the widget has two states: `authenticated === false` shows `PasswordGate`, `authenticated === true` shows `ChatContent`. We need a third state: authenticated but no name yet.

**Step 1: Add name storage key and state**

In `feedback-panel.tsx`, after line 16 (`const STORAGE_KEY = 'feedback_password'`), add the name storage key. Then modify the `FeedbackPanel` component to track name state.

```tsx
const STORAGE_KEY = 'feedback_password'
const NAME_KEY = 'feedback_tester_name'
```

In `FeedbackPanel`, after the `authenticated` state (line 19-21), add:

```tsx
const [testerName, setTesterName] = useState(
  () => typeof window !== 'undefined' ? localStorage.getItem(NAME_KEY) : null
)
```

**Step 2: Add NameGate component**

After the `PasswordGate` component (after line 332), add a new `NameGate` component:

```tsx
function NameGate({ onName, onClose }: { onName: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    localStorage.setItem(NAME_KEY, trimmed)
    onName(trimmed)
  }

  return (
    <div className="relative flex h-full flex-col items-center justify-center px-8">
      <button
        onClick={onClose}
        className="absolute top-3 right-3 flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Close"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Lightbulb className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="mb-8 text-center text-sm text-muted-foreground">
        What should we call you?
      </p>
      <form onSubmit={handleSubmit} className="w-full space-y-3">
        <input
          type="text"
          autoComplete="name"
          placeholder="Your name"
          aria-label="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-10 w-full rounded-xl border border-border bg-background px-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          Continue
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  )
}
```

**Step 3: Wire the three-state flow in FeedbackPanel**

Replace lines 124-136 (the `authenticated` ternary in the panel div) with:

```tsx
{authenticated && testerName ? (
  <ChatContent
    isOpen={isOpen}
    onClose={onToggle}
    pendingMessage={pendingMessage}
    onPendingMessageSent={clearPendingMessage}
    apiUrl={apiUrl}
    testerName={testerName}
  />
) : authenticated && !testerName ? (
  <div className="feedback-panel-glass flex h-full flex-col overflow-hidden">
    <NameGate onName={setTesterName} onClose={onToggle} />
  </div>
) : (
  <div className="feedback-panel-glass flex h-full flex-col overflow-hidden">
    <PasswordGate onAuth={() => setAuthenticated(true)} onClose={onToggle} apiUrl={apiUrl} />
  </div>
)}
```

**Step 4: Pass testerName through ChatContent to the API transport**

Modify `ChatContent` props to accept `testerName`:

```tsx
function ChatContent({
  isOpen,
  onClose,
  pendingMessage,
  onPendingMessageSent,
  apiUrl,
  testerName,
}: {
  isOpen: boolean
  onClose: () => void
  pendingMessage: string
  onPendingMessageSent: () => void
  apiUrl: string
  testerName: string
}) {
  const runtime = useChatRuntime({
    transport: new DefaultChatTransport({
      api: apiUrl,
      body: () => ({
        password: sessionStorage.getItem(STORAGE_KEY) || '',
        testerName,
      }),
    }),
  })
```

**Step 5: Build check**

Run: `cd packages/widget && npm run build`
Expected: Clean build, no type errors.

**Step 6: Commit**

```bash
git add packages/widget/src/client/feedback-panel.tsx
git commit -m "feat(widget): add name prompt after password auth"
```

---

### Task 2: Widget — Read testerName in Server Handler

**Files:**
- Modify: `packages/widget/src/server/handler.ts:48-106,112-115`

**Context:** The `persistFeedback` function currently hardcodes `tester_name: 'Anonymous'` and `tester_id: 'anonymous'`. We need to read `testerName` from the request body and pass it through.

**Step 1: Extract testerName from request body**

In the `POST` handler (line 112-115), change the destructuring to include `testerName`:

```tsx
const { messages, password, testerName }: { messages: UIMessage[]; password: string; testerName?: string } =
  await req.json()
```

**Step 2: Pass testerName to persistFeedback**

Change the `persistFeedback` call (line 176-178) to pass the name:

```tsx
if (config.supabase) {
  persistFeedback(config.supabase, messages, testerName).catch(() => {})
}
```

**Step 3: Update persistFeedback function signature and logic**

Change the function signature (line 48) and the hardcoded values (lines 52-53):

```tsx
async function persistFeedback(
  supabaseConfig: NonNullable<FeedbackHandlerConfig['supabase']>,
  messages: UIMessage[],
  testerName?: string
) {
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(
    supabaseConfig.url,
    supabaseConfig.serviceRoleKey,
    { db: { schema: 'feedback_chat' } }
  )

  const name = testerName || 'Anonymous'
  const testerId = testerName ? testerName.toLowerCase().replace(/\s+/g, '-') : 'anonymous'
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
```

Also update the insert call (around line 79) to use the variables:

```tsx
const { data: newSession, error } = await supabase
  .from('feedback_sessions')
  .insert({
    project_id: supabaseConfig.projectId,
    tester_id: testerId,
    tester_name: name,
  })
  .select('id')
  .single()
```

And the query for existing session (around line 60) to use `testerId`:

```tsx
const { data: existing } = await supabase
  .from('feedback_sessions')
  .select('id, message_count')
  .eq('project_id', supabaseConfig.projectId)
  .eq('tester_id', testerId)
  .gte('last_message_at', oneHourAgo)
  .order('last_message_at', { ascending: false })
  .limit(1)
  .single()
```

**Step 4: Build check**

Run: `cd packages/widget && npm run build`
Expected: Clean build.

**Step 5: Commit**

```bash
git add packages/widget/src/server/handler.ts
git commit -m "feat(widget): pass tester name from client to Supabase persistence"
```

---

### Task 3: Dashboard — Add New Types

**Files:**
- Modify: `packages/dashboard/src/lib/types.ts`

**Context:** We need types for enriched pipeline runs (with feedback source) and tester profile timeline events.

**Step 1: Add new types**

Append to `packages/dashboard/src/lib/types.ts`:

```tsx
export type FeedbackSource = {
  session_id: string
  tester_name: string | null
  ai_summary: string | null
  ai_themes: string[] | null
}

export type EnrichedPipelineRun = PipelineRun & {
  feedback_source: FeedbackSource | null
}

export type TimelineEvent = {
  id: string
  type: 'conversation_started' | 'issue_created' | 'run_triggered' | 'run_completed' | 'feedback_resolved'
  timestamp: string
  // Conversation events
  session_id?: string
  ai_summary?: string | null
  message_preview?: string
  // Issue events
  github_issue_number?: number
  issue_title?: string
  // Run events
  run_id?: string
  stage?: string
  result?: string | null
  github_pr_number?: number | null
}

export type TesterProfile = {
  tester_id: string
  tester_name: string | null
  first_seen: string
  last_active: string
  session_count: number
  resolved_count: number
  runs_triggered: number
  top_themes: { name: string; color: string; count: number }[]
  timeline: TimelineEvent[]
  sessions: FeedbackSession[]
}
```

**Step 2: Add `runs_triggered` to TesterSummary**

Modify the existing `TesterSummary` type (line 57-65) to add the runs count:

```tsx
export type TesterSummary = {
  tester_id: string
  tester_name: string | null
  session_count: number
  last_active: string
  top_themes: { name: string; color: string; count: number }[]
  resolved_count: number
  total_count: number
  runs_triggered: number
}
```

**Step 3: Build check**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Type errors in components that use `TesterSummary` (they don't pass `runs_triggered` yet). That's OK — we'll fix them in later tasks.

**Step 4: Commit**

```bash
git add packages/dashboard/src/lib/types.ts
git commit -m "feat(dashboard): add types for enriched runs, tester profiles, timeline events"
```

---

### Task 4: Dashboard — Extend Runs API with Feedback Source

**Files:**
- Modify: `packages/dashboard/src/app/api/runs/[projectId]/route.ts`

**Context:** The runs API currently returns bare pipeline_runs. We need to join with `feedback_sessions` via `github_issue_number` to include the feedback source (tester name, summary, themes).

**Step 1: Rewrite the GET handler**

Replace the entire file content:

```tsx
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { FeedbackSource } from '@/lib/types'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = await createClient()

  const [runsResult, sessionsResult] = await Promise.all([
    supabase
      .from('pipeline_runs')
      .select('id, github_issue_number, github_pr_number, stage, triggered_by, started_at, completed_at, result')
      .eq('project_id', projectId)
      .order('started_at', { ascending: false })
      .limit(50),
    supabase
      .from('feedback_sessions')
      .select('id, github_issue_number, tester_name, ai_summary, ai_themes')
      .eq('project_id', projectId)
      .not('github_issue_number', 'is', null),
  ])

  if (runsResult.error) {
    return NextResponse.json({ error: runsResult.error.message }, { status: 500 })
  }

  // Build lookup: issue_number -> feedback source
  const feedbackByIssue = new Map<number, FeedbackSource>()
  if (sessionsResult.data) {
    for (const s of sessionsResult.data) {
      if (s.github_issue_number != null) {
        feedbackByIssue.set(s.github_issue_number, {
          session_id: s.id,
          tester_name: s.tester_name,
          ai_summary: s.ai_summary,
          ai_themes: s.ai_themes,
        })
      }
    }
  }

  const runs = runsResult.data.map((run) => ({
    ...run,
    feedback_source: feedbackByIssue.get(run.github_issue_number) ?? null,
  }))

  return NextResponse.json({ runs })
}
```

**Step 2: Build check**

Run: `cd packages/dashboard && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/dashboard/src/app/api/runs/\[projectId\]/route.ts
git commit -m "feat(dashboard): enrich runs API with feedback source data"
```

---

### Task 5: Dashboard — Extend Testers API with Runs Count

**Files:**
- Modify: `packages/dashboard/src/app/api/feedback/[projectId]/testers/route.ts`

**Context:** The testers API groups sessions by tester but doesn't know about pipeline runs. We need to count runs triggered per tester via the `github_issue_number` join.

**Step 1: Add pipeline_runs query and join logic**

After the existing `Promise.all` for sessions and themes, add a pipeline_runs query. Replace the entire file:

```tsx
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { FeedbackSession, FeedbackTheme, TesterSummary } from '@/lib/types'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = await createClient()

  const [sessionsResult, themesResult, runsResult] = await Promise.all([
    supabase
      .from('feedback_sessions')
      .select('*')
      .eq('project_id', projectId),
    supabase
      .from('feedback_themes')
      .select('*')
      .eq('project_id', projectId),
    supabase
      .from('pipeline_runs')
      .select('github_issue_number')
      .eq('project_id', projectId),
  ])

  if (sessionsResult.error) {
    return NextResponse.json({ error: sessionsResult.error.message }, { status: 500 })
  }
  if (themesResult.error) {
    return NextResponse.json({ error: themesResult.error.message }, { status: 500 })
  }

  const sessions = sessionsResult.data as FeedbackSession[]
  const themes = themesResult.data as FeedbackTheme[]
  const themeMap = new Map(themes.map(t => [t.id, t]))

  // Build set of issue numbers that have runs
  const issueNumbersWithRuns = new Set<number>()
  if (runsResult.data) {
    for (const r of runsResult.data) {
      issueNumbersWithRuns.add(r.github_issue_number)
    }
  }

  const grouped = new Map<string, FeedbackSession[]>()
  for (const session of sessions) {
    const key = session.tester_id ?? 'anonymous'
    const group = grouped.get(key)
    if (group) {
      group.push(session)
    } else {
      grouped.set(key, [session])
    }
  }

  const testers: TesterSummary[] = []

  for (const [testerId, testerSessions] of grouped) {
    const lastActive = testerSessions.reduce(
      (max, s) => (s.last_message_at > max ? s.last_message_at : max),
      testerSessions[0].last_message_at
    )

    const themeCounts = new Map<string, number>()
    for (const s of testerSessions) {
      if (s.ai_themes) {
        for (const themeId of s.ai_themes) {
          themeCounts.set(themeId, (themeCounts.get(themeId) || 0) + 1)
        }
      }
    }

    const topThemes = [...themeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, count]) => {
        const theme = themeMap.get(id)
        return { name: theme?.name ?? 'Unknown', color: theme?.color ?? '#6366f1', count }
      })

    const resolvedCount = testerSessions.filter(s => s.status === 'resolved').length

    // Count runs triggered by this tester's feedback
    let runsTriggered = 0
    for (const s of testerSessions) {
      if (s.github_issue_number != null && issueNumbersWithRuns.has(s.github_issue_number)) {
        runsTriggered++
      }
    }

    testers.push({
      tester_id: testerId,
      tester_name: testerSessions[0].tester_name,
      session_count: testerSessions.length,
      last_active: lastActive,
      top_themes: topThemes,
      resolved_count: resolvedCount,
      total_count: testerSessions.length,
      runs_triggered: runsTriggered,
    })
  }

  testers.sort((a, b) => b.session_count - a.session_count)

  return NextResponse.json({ testers })
}
```

**Step 2: Build check**

Run: `cd packages/dashboard && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/dashboard/src/app/api/feedback/\[projectId\]/testers/route.ts
git commit -m "feat(dashboard): add runs_triggered count to testers API"
```

---

### Task 6: Dashboard — New Tester Profile API Route

**Files:**
- Create: `packages/dashboard/src/app/api/feedback/[projectId]/testers/[testerId]/route.ts`

**Context:** New API route that returns a tester's profile: stats, sessions, and a merged activity timeline built from feedback_sessions + pipeline_runs.

**Step 1: Create the route file**

```tsx
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { FeedbackSession, FeedbackTheme, TimelineEvent, TesterProfile } from '@/lib/types'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; testerId: string }> }
) {
  const { projectId, testerId } = await params
  const supabase = await createClient()

  const [sessionsResult, themesResult] = await Promise.all([
    supabase
      .from('feedback_sessions')
      .select('*')
      .eq('project_id', projectId)
      .eq('tester_id', testerId)
      .order('started_at', { ascending: false }),
    supabase
      .from('feedback_themes')
      .select('*')
      .eq('project_id', projectId),
  ])

  if (sessionsResult.error) {
    return NextResponse.json({ error: sessionsResult.error.message }, { status: 500 })
  }

  const sessions = sessionsResult.data as FeedbackSession[]
  if (sessions.length === 0) {
    return NextResponse.json({ error: 'Tester not found' }, { status: 404 })
  }

  const themes = (themesResult.data ?? []) as FeedbackTheme[]
  const themeMap = new Map(themes.map(t => [t.id, t]))

  // Get issue numbers from this tester's sessions
  const issueNumbers = sessions
    .filter(s => s.github_issue_number != null)
    .map(s => s.github_issue_number!)

  // Fetch pipeline runs for those issues
  let runs: { id: string; github_issue_number: number; github_pr_number: number | null; stage: string; started_at: string; completed_at: string | null; result: string | null }[] = []
  if (issueNumbers.length > 0) {
    const { data } = await supabase
      .from('pipeline_runs')
      .select('id, github_issue_number, github_pr_number, stage, started_at, completed_at, result')
      .eq('project_id', projectId)
      .in('github_issue_number', issueNumbers)
      .order('started_at', { ascending: false })
    runs = data ?? []
  }

  // Build timeline
  const timeline: TimelineEvent[] = []

  for (const session of sessions) {
    // Conversation started
    timeline.push({
      id: `conv-${session.id}`,
      type: 'conversation_started',
      timestamp: session.started_at,
      session_id: session.id,
      ai_summary: session.ai_summary,
    })

    // Issue created
    if (session.github_issue_number != null) {
      timeline.push({
        id: `issue-${session.id}`,
        type: 'issue_created',
        timestamp: session.started_at, // approximate — issue created around session time
        github_issue_number: session.github_issue_number,
      })
    }

    // Feedback resolved
    if (session.status === 'resolved') {
      timeline.push({
        id: `resolved-${session.id}`,
        type: 'feedback_resolved',
        timestamp: session.last_message_at,
        session_id: session.id,
      })
    }
  }

  for (const run of runs) {
    // Run triggered
    timeline.push({
      id: `run-start-${run.id}`,
      type: 'run_triggered',
      timestamp: run.started_at,
      run_id: run.id,
      github_issue_number: run.github_issue_number,
      stage: run.stage,
    })

    // Run completed
    if (run.completed_at) {
      timeline.push({
        id: `run-end-${run.id}`,
        type: 'run_completed',
        timestamp: run.completed_at,
        run_id: run.id,
        github_issue_number: run.github_issue_number,
        github_pr_number: run.github_pr_number,
        stage: run.stage,
        result: run.result,
      })
    }
  }

  // Sort by timestamp descending (most recent first)
  timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  // Compute stats
  const themeCounts = new Map<string, number>()
  for (const s of sessions) {
    if (s.ai_themes) {
      for (const themeId of s.ai_themes) {
        themeCounts.set(themeId, (themeCounts.get(themeId) || 0) + 1)
      }
    }
  }
  const topThemes = [...themeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => {
      const theme = themeMap.get(id)
      return { name: theme?.name ?? 'Unknown', color: theme?.color ?? '#6366f1', count }
    })

  const profile: TesterProfile = {
    tester_id: testerId,
    tester_name: sessions[0].tester_name,
    first_seen: sessions[sessions.length - 1].started_at,
    last_active: sessions[0].last_message_at,
    session_count: sessions.length,
    resolved_count: sessions.filter(s => s.status === 'resolved').length,
    runs_triggered: runs.length,
    top_themes: topThemes,
    timeline,
    sessions,
  }

  return NextResponse.json({ profile })
}
```

**Step 2: Build check**

Run: `cd packages/dashboard && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/dashboard/src/app/api/feedback/\[projectId\]/testers/\[testerId\]/route.ts
git commit -m "feat(dashboard): add tester profile API with timeline"
```

---

### Task 7: Dashboard — Tester Timeline Component

**Files:**
- Create: `packages/dashboard/src/components/tester-timeline.tsx`

**Context:** Renders the activity timeline on the tester profile page. Each event is a dot + connector line with event description and link.

**Step 1: Create the component**

```tsx
'use client'

import { MessageCircle, AlertCircle, Play, CheckCircle, XCircle, ThumbsUp } from 'lucide-react'
import { timeAgo } from '@/lib/format'
import { StageBadge } from './stage-badge'
import type { TimelineEvent } from '@/lib/types'

const EVENT_CONFIG: Record<TimelineEvent['type'], { icon: typeof MessageCircle; color: string; label: string }> = {
  conversation_started: { icon: MessageCircle, color: 'text-accent', label: 'Started a conversation' },
  issue_created: { icon: AlertCircle, color: 'text-amber-400', label: 'Feedback became an issue' },
  run_triggered: { icon: Play, color: 'text-blue-400', label: 'Agent started working' },
  run_completed: { icon: CheckCircle, color: 'text-success', label: 'Run completed' },
  feedback_resolved: { icon: ThumbsUp, color: 'text-success', label: 'Conversation resolved' },
}

export function TesterTimeline({
  events,
  projectId,
  githubRepo,
  onSelectSession,
}: {
  events: TimelineEvent[]
  projectId: string
  githubRepo: string | null
  onSelectSession?: (sessionId: string) => void
}) {
  if (events.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted">No activity yet</p>
    )
  }

  return (
    <div className="space-y-0">
      {events.map((event, i) => {
        const config = EVENT_CONFIG[event.type]
        const Icon = event.type === 'run_completed' && event.result === 'failed' ? XCircle : config.icon
        const color = event.type === 'run_completed' && event.result === 'failed' ? 'text-danger' : config.color

        return (
          <div key={event.id} className="flex items-start gap-3">
            {/* Dot + connector */}
            <div className="flex flex-col items-center pt-0.5">
              <div className={`flex h-6 w-6 items-center justify-center rounded-full bg-surface ${color}`}>
                <Icon className="h-3 w-3" />
              </div>
              {i < events.length - 1 && (
                <div className="h-8 w-0.5 bg-edge" />
              )}
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1 pb-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-fg">{config.label}</span>
                <span className="text-[11px] text-muted">{timeAgo(event.timestamp)}</span>
              </div>

              {/* Conversation detail */}
              {event.type === 'conversation_started' && (
                <p className="mt-1 truncate text-xs text-muted">
                  {event.ai_summary || event.message_preview || 'No summary'}
                </p>
              )}

              {/* Issue link */}
              {event.github_issue_number != null && event.type === 'issue_created' && githubRepo && (
                <a
                  href={`https://github.com/${githubRepo}/issues/${event.github_issue_number}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex text-xs text-accent hover:underline"
                >
                  Issue #{event.github_issue_number}
                </a>
              )}

              {/* Run detail */}
              {event.type === 'run_triggered' && event.stage && (
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-xs text-muted">Issue #{event.github_issue_number}</span>
                  <StageBadge stage={event.stage} />
                </div>
              )}

              {/* Run result */}
              {event.type === 'run_completed' && (
                <div className="mt-1 flex items-center gap-2">
                  {event.github_pr_number ? (
                    githubRepo ? (
                      <a
                        href={`https://github.com/${githubRepo}/pull/${event.github_pr_number}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-accent hover:underline"
                      >
                        PR #{event.github_pr_number}
                      </a>
                    ) : (
                      <span className="text-xs text-muted">PR #{event.github_pr_number}</span>
                    )
                  ) : (
                    <span className="text-xs text-muted capitalize">{event.result ?? 'unknown'}</span>
                  )}
                </div>
              )}

              {/* Session link */}
              {event.session_id && onSelectSession && (
                <button
                  onClick={() => onSelectSession(event.session_id!)}
                  className="mt-1 text-xs text-accent hover:underline"
                >
                  View conversation
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

**Step 2: Build check**

Run: `cd packages/dashboard && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/dashboard/src/components/tester-timeline.tsx
git commit -m "feat(dashboard): add tester timeline component"
```

---

### Task 8: Dashboard — Tester Profile Page

**Files:**
- Create: `packages/dashboard/src/app/projects/[id]/testers/[testerId]/page.tsx`
- Create: `packages/dashboard/src/app/projects/[id]/testers/[testerId]/client.tsx`

**Context:** New page that shows a tester's profile with header stats, activity timeline, and session list. Server component fetches project info, client component fetches the tester profile API.

**Step 1: Create the server page**

Create `packages/dashboard/src/app/projects/[id]/testers/[testerId]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { TesterProfileClient } from './client'
import type { FeedbackTheme } from '@/lib/types'

export default async function TesterProfilePage({
  params,
}: {
  params: Promise<{ id: string; testerId: string }>
}) {
  const { id: projectId, testerId } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, github_repo')
    .eq('id', projectId)
    .single()

  if (!project) notFound()

  const { data: themes } = await supabase
    .from('feedback_themes')
    .select('*')
    .eq('project_id', projectId)
    .order('message_count', { ascending: false })

  return (
    <div className="mx-auto max-w-5xl px-6 pt-10 pb-16">
      <Link
        href={`/projects/${projectId}/feedback`}
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-3 w-3" />
        Feedback
      </Link>

      <TesterProfileClient
        projectId={projectId}
        testerId={testerId}
        githubRepo={project.github_repo}
        themes={(themes ?? []) as FeedbackTheme[]}
      />
    </div>
  )
}
```

**Step 2: Create the client component**

Create `packages/dashboard/src/app/projects/[id]/testers/[testerId]/client.tsx`:

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, MessageCircle, Zap, CheckCircle } from 'lucide-react'
import { timeAgo } from '@/lib/format'
import { TesterTimeline } from '@/components/tester-timeline'
import { FeedbackSlideOver } from '@/components/feedback-slide-over'
import type { TesterProfile, FeedbackSession, FeedbackTheme } from '@/lib/types'

function InitialsAvatar({ name, size = 'lg' }: { name: string; size?: 'sm' | 'lg' }) {
  const initials = name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  // Deterministic color from name
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360

  const sizeClass = size === 'lg' ? 'h-12 w-12 text-lg' : 'h-8 w-8 text-xs'

  return (
    <div
      className={`flex ${sizeClass} items-center justify-center rounded-full font-semibold text-white`}
      style={{ backgroundColor: `hsl(${hue}, 50%, 40%)` }}
    >
      {initials}
    </div>
  )
}

export function TesterProfileClient({
  projectId,
  testerId,
  githubRepo,
  themes,
}: {
  projectId: string
  testerId: string
  githubRepo: string | null
  themes: FeedbackTheme[]
}) {
  const [profile, setProfile] = useState<TesterProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedSession, setSelectedSession] = useState<FeedbackSession | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/feedback/${projectId}/testers/${encodeURIComponent(testerId)}`)
      .then(res => res.ok ? res.json() : null)
      .then(json => setProfile(json?.profile ?? null))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false))
  }, [projectId, testerId])

  const handleSelectSession = useCallback((sessionId: string) => {
    const session = profile?.sessions.find(s => s.id === sessionId)
    if (session) setSelectedSession(session)
  }, [profile])

  const handleStatusChange = useCallback((sessionId: string, status: FeedbackSession['status']) => {
    if (selectedSession?.id === sessionId) {
      setSelectedSession(prev => prev ? { ...prev, status } : null)
    }
  }, [selectedSession?.id])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="py-20 text-center text-sm text-muted">Tester not found</div>
    )
  }

  const resolutionRate = profile.session_count > 0
    ? Math.round((profile.resolved_count / profile.session_count) * 100)
    : 0

  return (
    <>
      {/* Header */}
      <div className="mb-8 flex items-center gap-4">
        <InitialsAvatar name={profile.tester_name || 'Anonymous'} />
        <div>
          <h1 className="text-lg font-medium text-fg">{profile.tester_name || 'Anonymous'}</h1>
          <p className="text-xs text-muted">
            First seen {timeAgo(profile.first_seen)} &middot; Last active {timeAgo(profile.last_active)}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-3 gap-3">
        <div className="glass-card flex items-center gap-3 p-4">
          <MessageCircle className="h-4 w-4 text-accent" />
          <div>
            <p className="text-sm font-medium text-fg">{profile.session_count}</p>
            <p className="text-[11px] text-muted">Conversations</p>
          </div>
        </div>
        <div className="glass-card flex items-center gap-3 p-4">
          <Zap className="h-4 w-4 text-amber-400" />
          <div>
            <p className="text-sm font-medium text-fg">{profile.runs_triggered}</p>
            <p className="text-[11px] text-muted">Runs triggered</p>
          </div>
        </div>
        <div className="glass-card flex items-center gap-3 p-4">
          <CheckCircle className="h-4 w-4 text-success" />
          <div>
            <p className="text-sm font-medium text-fg">{resolutionRate}%</p>
            <p className="text-[11px] text-muted">Resolved</p>
          </div>
        </div>
      </div>

      {/* Top themes */}
      {profile.top_themes.length > 0 && (
        <div className="mb-8 flex flex-wrap gap-2">
          {profile.top_themes.map(theme => (
            <span
              key={theme.name}
              className="rounded-full px-2.5 py-1 text-xs font-medium"
              style={{ backgroundColor: `${theme.color}20`, color: theme.color }}
            >
              {theme.name} ({theme.count})
            </span>
          ))}
        </div>
      )}

      {/* Activity Timeline */}
      <div className="mb-8">
        <h2 className="mb-4 text-sm font-medium text-fg">Activity</h2>
        <div className="glass-card p-5">
          <TesterTimeline
            events={profile.timeline}
            projectId={projectId}
            githubRepo={githubRepo}
            onSelectSession={handleSelectSession}
          />
        </div>
      </div>

      {/* Sessions list */}
      <div>
        <h2 className="mb-4 text-sm font-medium text-fg">Conversations</h2>
        <div className="space-y-2">
          {profile.sessions.map(session => (
            <button
              key={session.id}
              onClick={() => setSelectedSession(session)}
              className="glass-card w-full p-4 text-left transition-colors hover:border-white/[0.08]"
            >
              <p className="truncate text-sm font-medium text-fg">
                {session.ai_summary || 'Conversation'}
              </p>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                <span>{timeAgo(session.last_message_at)}</span>
                <span className="text-white/10">&middot;</span>
                <span>{session.message_count} messages</span>
                <span className="text-white/10">&middot;</span>
                <span className="capitalize">{session.status}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {selectedSession && (
        <FeedbackSlideOver
          session={selectedSession}
          themes={themes}
          projectId={projectId}
          githubRepo={githubRepo}
          onClose={() => setSelectedSession(null)}
          onStatusChange={handleStatusChange}
        />
      )}
    </>
  )
}
```

**Step 3: Build check**

Run: `cd packages/dashboard && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add packages/dashboard/src/app/projects/\[id\]/testers/
git commit -m "feat(dashboard): add tester profile page with timeline and sessions"
```

---

### Task 9: Dashboard — Enhanced Testers Tab

**Files:**
- Modify: `packages/dashboard/src/components/tester-activity.tsx`
- Modify: `packages/dashboard/src/app/projects/[id]/feedback/client.tsx`

**Context:** Make tester cards link to the profile page. Add initials avatar, runs count, and sort controls.

**Step 1: Rewrite tester-activity.tsx**

Replace the entire file:

```tsx
'use client'

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Users, ArrowUpDown, Zap } from 'lucide-react'
import { timeAgo } from '@/lib/format'
import type { TesterSummary } from '@/lib/types'

type SortKey = 'last_active' | 'session_count' | 'runs_triggered'

function InitialsAvatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360

  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
      style={{ backgroundColor: `hsl(${hue}, 50%, 40%)` }}
    >
      {initials}
    </div>
  )
}

export function TesterActivity({ testers }: { testers: TesterSummary[] }) {
  const router = useRouter()
  const params = useParams()
  const projectId = params.id as string
  const [sortBy, setSortBy] = useState<SortKey>('last_active')

  const resolutionRate = (t: TesterSummary) =>
    t.session_count > 0 ? Math.round((t.resolved_count / t.session_count) * 100) : 0

  const sorted = [...testers].sort((a, b) => {
    switch (sortBy) {
      case 'session_count':
        return b.session_count - a.session_count
      case 'runs_triggered':
        return (b.runs_triggered ?? 0) - (a.runs_triggered ?? 0)
      case 'last_active':
      default:
        return new Date(b.last_active).getTime() - new Date(a.last_active).getTime()
    }
  })

  if (testers.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-muted">
        <Users className="h-8 w-8" />
        <p className="text-sm">No testers yet</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted">
          {testers.length} tester{testers.length !== 1 ? 's' : ''} active
        </p>
        <div className="flex items-center gap-1 rounded-lg bg-white/[0.04] p-0.5">
          <ArrowUpDown className="ml-2 h-3 w-3 text-muted" />
          {(['last_active', 'session_count', 'runs_triggered'] as const).map(key => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                sortBy === key ? 'bg-white/[0.08] text-fg' : 'text-muted hover:text-fg'
              }`}
            >
              {key === 'last_active' ? 'Recent' : key === 'session_count' ? 'Sessions' : 'Runs'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {sorted.map((tester) => {
          const rate = resolutionRate(tester)
          const name = tester.tester_name || 'Anonymous'
          return (
            <button
              key={tester.tester_id}
              onClick={() => router.push(`/projects/${projectId}/testers/${encodeURIComponent(tester.tester_id)}`)}
              className="glass-card w-full p-4 text-left transition-colors hover:border-white/[0.08]"
            >
              <div className="flex items-start gap-3">
                <InitialsAvatar name={name} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">{name}</p>

                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted">
                    <span>{tester.session_count} conversation{tester.session_count !== 1 ? 's' : ''}</span>
                    <span className="text-white/10">&middot;</span>
                    <span>{timeAgo(tester.last_active)}</span>
                    {(tester.runs_triggered ?? 0) > 0 && (
                      <>
                        <span className="text-white/10">&middot;</span>
                        <span className="flex items-center gap-0.5">
                          <Zap className="h-2.5 w-2.5 text-amber-400" />
                          {tester.runs_triggered} run{tester.runs_triggered !== 1 ? 's' : ''}
                        </span>
                      </>
                    )}
                    {tester.top_themes.length > 0 && (
                      <>
                        <span className="text-white/10">&middot;</span>
                        <div className="flex gap-1">
                          {tester.top_themes.map((theme) => (
                            <span
                              key={theme.name}
                              className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                              style={{
                                backgroundColor: `${theme.color}20`,
                                color: theme.color,
                              }}
                            >
                              {theme.name}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="mt-2.5 flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface">
                      <div
                        className="h-full rounded-full bg-success transition-all duration-500"
                        style={{ width: `${rate}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted">
                      {rate}% resolved
                    </span>
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

**Step 2: Update client.tsx to remove onSelectTester prop**

In `packages/dashboard/src/app/projects/[id]/feedback/client.tsx`, the `TesterActivity` component no longer needs `onSelectTester`. Replace the testers tab rendering (around lines 82-86):

Change:
```tsx
<TesterActivity
  testers={testers}
  onSelectTester={() => setTab('feedback')}
/>
```

To:
```tsx
<TesterActivity testers={testers} />
```

**Step 3: Build check**

Run: `cd packages/dashboard && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add packages/dashboard/src/components/tester-activity.tsx packages/dashboard/src/app/projects/\[id\]/feedback/client.tsx
git commit -m "feat(dashboard): enhanced testers tab with avatars, run count, sort, navigation"
```

---

### Task 10: Dashboard — Runs Table Source Column

**Files:**
- Modify: `packages/dashboard/src/components/runs-table.tsx`
- Modify: `packages/dashboard/src/app/projects/[id]/page.tsx:30-35`

**Context:** Add a "Source" column to the runs table showing the feedback tester name + summary. The project page currently fetches runs from Supabase directly — it should use the enriched API route instead.

**Step 1: Update project page to fetch enriched runs from API (client-side)**

This is tricky: the project page is a server component that fetches runs directly from Supabase. But the enriched runs API joins with feedback_sessions. The simplest approach: keep the server component but add a parallel feedback_sessions query to build the source map server-side.

In `packages/dashboard/src/app/projects/[id]/page.tsx`, add the feedback sessions query after the runs query (after line 35):

```tsx
// After the existing runs query, add:
const { data: feedbackSessions } = await supabase
  .from('feedback_sessions')
  .select('id, github_issue_number, tester_name, ai_summary, ai_themes')
  .eq('project_id', id)
  .not('github_issue_number', 'is', null)

// Build a map and enrich runs
const feedbackByIssue = new Map<number, { session_id: string; tester_name: string | null; ai_summary: string | null; ai_themes: string[] | null }>()
if (feedbackSessions) {
  for (const s of feedbackSessions) {
    if (s.github_issue_number != null) {
      feedbackByIssue.set(s.github_issue_number, {
        session_id: s.id,
        tester_name: s.tester_name,
        ai_summary: s.ai_summary,
        ai_themes: s.ai_themes,
      })
    }
  }
}

const enrichedRuns = (runs ?? []).map(run => ({
  ...run,
  feedback_source: feedbackByIssue.get(run.github_issue_number) ?? null,
}))
```

Then update the RunsTable prop (line 85):

```tsx
<RunsTable runs={enrichedRuns} githubRepo={project.github_repo} projectId={project.id} />
```

**Step 2: Update runs-table.tsx to show Source column**

Replace the entire file:

```tsx
'use client'

import { useState } from 'react'
import { ExternalLink, MessageCircle } from 'lucide-react'
import { StageBadge } from './stage-badge'
import { RunSlideOver } from './run-slide-over'
import type { EnrichedPipelineRun } from '@/lib/types'

type Props = {
  runs: EnrichedPipelineRun[]
  githubRepo: string
  projectId: string
}

export function RunsTable({ runs, githubRepo, projectId }: Props) {
  const [selectedRun, setSelectedRun] = useState<EnrichedPipelineRun | null>(null)

  if (runs.length === 0) {
    return (
      <div className="glass-card px-5 py-10 text-center">
        <p className="text-sm text-muted">
          Runs will appear here once you complete setup and send your first feedback.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="glass-card overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-edge text-xs text-muted">
              <th className="px-5 py-3 font-medium">Issue</th>
              <th className="px-5 py-3 font-medium">Source</th>
              <th className="px-5 py-3 font-medium">Stage</th>
              <th className="px-5 py-3 font-medium">Result</th>
              <th className="px-5 py-3 font-medium">PR</th>
              <th className="px-5 py-3 font-medium">Started</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr
                key={run.id}
                onClick={() => setSelectedRun(run)}
                className="cursor-pointer border-b border-edge/50 transition-colors last:border-0 hover:bg-surface-hover"
              >
                <td className="px-5 py-3 font-[family-name:var(--font-mono)] text-xs text-fg">
                  #{run.github_issue_number}
                </td>
                <td className="max-w-[200px] px-5 py-3">
                  {run.feedback_source ? (
                    <div className="flex items-center gap-1.5">
                      <MessageCircle className="h-3 w-3 shrink-0 text-accent" />
                      <span className="truncate text-xs text-fg">
                        {run.feedback_source.tester_name || 'Anonymous'}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-dim">Manual</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  <StageBadge stage={run.stage} />
                </td>
                <td className="px-5 py-3 text-xs text-muted">
                  {run.result ?? <span className="text-dim">&mdash;</span>}
                </td>
                <td className="px-5 py-3">
                  {run.github_pr_number ? (
                    <a
                      href={`https://github.com/${githubRepo}/pull/${run.github_pr_number}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-xs text-accent transition-colors hover:text-accent/80"
                    >
                      #{run.github_pr_number}
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  ) : (
                    <span className="text-xs text-dim">&mdash;</span>
                  )}
                </td>
                <td className="px-5 py-3 text-xs text-muted tabular-nums">
                  {new Date(run.started_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedRun && (
        <RunSlideOver
          run={selectedRun}
          githubRepo={githubRepo}
          projectId={projectId}
          onClose={() => setSelectedRun(null)}
        />
      )}
    </>
  )
}
```

**Step 3: Build check**

Run: `cd packages/dashboard && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add packages/dashboard/src/components/runs-table.tsx packages/dashboard/src/app/projects/\[id\]/page.tsx
git commit -m "feat(dashboard): add Source column to runs table linking feedback to runs"
```

---

### Task 11: Dashboard — Run Slide-Over Original Feedback Section

**Files:**
- Modify: `packages/dashboard/src/components/run-slide-over.tsx`

**Context:** Add an "Original Feedback" section at the top of the slide-over content, showing the tester name, summary, and theme badges from the linked feedback session.

**Step 1: Update the run prop type**

Change the import and type of `run` to use `EnrichedPipelineRun`:

```tsx
import type { EnrichedPipelineRun, DeploymentInfo } from '@/lib/types'

// ...

type Props = {
  run: EnrichedPipelineRun
  githubRepo: string
  projectId: string
  onClose: () => void
}
```

**Step 2: Add Original Feedback section**

After the "Triggered by" paragraph (after the `{run.triggered_by && ...}` block, around line 82), add:

```tsx
{/* Original Feedback */}
{run.feedback_source && (
  <div className="mb-5">
    <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Original Feedback</h3>
    <div className="rounded-lg bg-surface px-3 py-2.5">
      <p className="text-sm font-medium text-fg">
        {run.feedback_source.tester_name || 'Anonymous'}
      </p>
      {run.feedback_source.ai_summary && (
        <p className="mt-1 text-xs text-muted line-clamp-3">{run.feedback_source.ai_summary}</p>
      )}
      <a
        href={`/projects/${projectId}/feedback`}
        className="mt-2 inline-flex text-xs text-accent hover:underline"
      >
        View full conversation
      </a>
    </div>
  </div>
)}
```

**Step 3: Build check**

Run: `cd packages/dashboard && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add packages/dashboard/src/components/run-slide-over.tsx
git commit -m "feat(dashboard): add original feedback section to run slide-over"
```

---

### Task 12: Dashboard — Run Detail Page Feedback Card

**Files:**
- Modify: `packages/dashboard/src/app/projects/[id]/runs/[runId]/page.tsx`

**Context:** Add an "Original Feedback" card in the sidebar (alongside Timeline, Links, Details) showing the feedback session that triggered this run.

**Step 1: Add feedback session query**

After the existing `run` query (around line 37), add:

```tsx
// Fetch linked feedback session
let feedbackSource: { tester_name: string | null; ai_summary: string | null } | null = null
if (run.github_issue_number) {
  const { data: session } = await supabase
    .from('feedback_sessions')
    .select('tester_name, ai_summary')
    .eq('project_id', projectId)
    .eq('github_issue_number', run.github_issue_number)
    .limit(1)
    .single()
  feedbackSource = session ?? null
}
```

**Step 2: Add the feedback card in the sidebar**

In the sidebar section (after the Links glass-card, before the Details glass-card), add:

```tsx
{/* Original Feedback */}
{feedbackSource && (
  <div className="glass-card p-5">
    <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">Original Feedback</h3>
    <p className="text-sm font-medium text-fg">
      {feedbackSource.tester_name || 'Anonymous'}
    </p>
    {feedbackSource.ai_summary && (
      <p className="mt-1.5 text-xs text-muted leading-relaxed">{feedbackSource.ai_summary}</p>
    )}
    <a
      href={`/projects/${projectId}/feedback`}
      className="mt-2 inline-flex text-xs text-accent hover:underline"
    >
      View conversation
    </a>
  </div>
)}
```

Add this import if `MessageCircle` is used (or skip it since we're just using text).

**Step 3: Build check**

Run: `cd packages/dashboard && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add packages/dashboard/src/app/projects/\[id\]/runs/\[runId\]/page.tsx
git commit -m "feat(dashboard): add original feedback card to run detail sidebar"
```

---

### Task 13: Full Build + Manual Verification

**Step 1: Full build**

Run: `npm run build`
Expected: All packages build cleanly.

**Step 2: Dev server smoke test**

Run: `cd packages/dashboard && npm run dev`
Manually verify:
- Project page shows runs table with Source column
- Run slide-over shows Original Feedback section
- Feedback hub → Testers tab shows avatars, run counts, sort controls
- Clicking a tester navigates to `/projects/[id]/testers/[testerId]`
- Tester profile page shows header, stats, timeline, sessions

**Step 3: Widget smoke test**

In a consumer app with the widget:
- Open widget → password prompt → name prompt appears after auth
- Enter name → stored in localStorage, chat begins
- Subsequent opens skip name prompt

**Step 4: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix: build and integration fixups for dashboard clarity feature"
```
