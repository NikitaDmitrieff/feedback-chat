# Dashboard Layout Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the top navbar with a hybrid left sidebar, add pipeline run detail views (slide-over + full page), aggregate stats on the project page, and loading skeletons.

**Architecture:** Four independent features layered onto the existing Next.js 15 + Supabase dashboard. The sidebar is a client component (needs `useState` for pin state). The run slide-over is a client component rendered inside the project page. The stats bar is server-rendered. Loading skeletons use Next.js `loading.tsx` convention (pure server, zero JS). A new API route fetches Vercel deployment info from GitHub commit statuses.

**Tech Stack:** Next.js 15 (App Router), React 19, Supabase SSR, Tailwind v4, Lucide React icons, TypeScript.

---

## Task 1: Add new CSS classes to globals.css

**Files:**
- Modify: `packages/dashboard/src/app/globals.css`

**Step 1: Add skeleton shimmer animation and new component classes**

Append after the `.stage-rejected` rule at the end of `globals.css`:

```css
/* ── Skeleton shimmer ── */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.skeleton {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.03) 25%,
    rgba(255, 255, 255, 0.06) 50%,
    rgba(255, 255, 255, 0.03) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  border-radius: 0.5rem;
}

/* ── Stat card ── */
.stat-card {
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(40px) saturate(1.3);
  -webkit-backdrop-filter: blur(40px) saturate(1.3);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 1rem;
  padding: 1rem 1.25rem;
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

/* ── Slide-over backdrop ── */
.slide-over-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
```

**Step 2: Verify the build still works**

Run: `cd packages/dashboard && npx next build 2>&1 | tail -5`
Expected: Build succeeds (or at least CSS compiles without errors).

**Step 3: Commit**

```bash
git add packages/dashboard/src/app/globals.css
git commit -m "feat(dashboard): add skeleton shimmer, stat-card, and slide-over-backdrop CSS"
```

---

## Task 2: Create the Sidebar component

**Files:**
- Create: `packages/dashboard/src/components/sidebar.tsx`

**Step 1: Create the sidebar client component**

Create `packages/dashboard/src/components/sidebar.tsx`:

```tsx
'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MessageSquareText, FolderKanban, LogOut, Pin, PinOff } from 'lucide-react'

export function Sidebar() {
  const pathname = usePathname()
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('sidebar-pinned')
    if (saved === 'true') setPinned(true)
  }, [])

  const togglePin = () => {
    const next = !pinned
    setPinned(next)
    localStorage.setItem('sidebar-pinned', String(next))
  }

  const expanded = pinned || hovered

  return (
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`fixed top-0 left-0 z-40 flex h-screen flex-col border-r border-edge bg-bg/80 backdrop-blur-xl transition-[width] duration-200 ease-in-out ${
        expanded ? 'w-[220px]' : 'w-[60px]'
      }`}
    >
      {/* Logo */}
      <Link
        href="/projects"
        className="flex h-14 items-center gap-2.5 px-4 text-sm font-medium text-fg transition-colors hover:text-white"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-elevated">
          <MessageSquareText className="h-4 w-4 text-muted" />
        </div>
        {expanded && <span className="truncate">Feedback Chat</span>}
      </Link>

      {/* Nav items */}
      <nav className="mt-2 flex flex-1 flex-col gap-1 px-2">
        <Link
          href="/projects"
          className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
            pathname === '/projects' || pathname === '/'
              ? 'bg-surface text-fg'
              : 'text-muted hover:bg-surface-hover hover:text-fg'
          }`}
        >
          <FolderKanban className="h-4 w-4 shrink-0" />
          {expanded && <span className="truncate">Projects</span>}
        </Link>
      </nav>

      {/* Bottom section */}
      <div className="flex flex-col gap-1 border-t border-edge px-2 py-3">
        {/* Pin toggle — only visible when expanded */}
        {expanded && (
          <button
            onClick={togglePin}
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            {pinned ? <PinOff className="h-3.5 w-3.5 shrink-0" /> : <Pin className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{pinned ? 'Unpin sidebar' : 'Pin sidebar'}</span>
          </button>
        )}

        {/* Sign out */}
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" />
            {expanded && <span className="truncate">Sign out</span>}
          </button>
        </form>
      </div>
    </aside>
  )
}
```

**Step 2: Verify build**

Run: `cd packages/dashboard && npx next build 2>&1 | tail -5`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add packages/dashboard/src/components/sidebar.tsx
git commit -m "feat(dashboard): add hybrid sidebar component with hover + pin"
```

---

## Task 3: Replace top nav with sidebar across all pages

**Files:**
- Modify: `packages/dashboard/src/app/projects/page.tsx`
- Modify: `packages/dashboard/src/app/projects/[id]/page.tsx`
- Modify: `packages/dashboard/src/app/projects/new/page.tsx`
- Modify: `packages/dashboard/src/app/layout.tsx`

The strategy: move the `<Sidebar />` into the root layout so every page gets it automatically. Remove `<Nav />` imports from individual pages. Replace `pt-24` padding (top nav offset) with `pl-[60px]` (sidebar offset). The sidebar width transition is handled client-side by the sidebar component itself, but the content area uses `pl-[60px]` as the base offset (collapsed sidebar width).

**Step 1: Update the root layout to include the Sidebar**

In `packages/dashboard/src/app/layout.tsx`, update to:

```tsx
import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { Sidebar } from '@/components/sidebar'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
})

export const metadata: Metadata = {
  title: 'Feedback Chat — Dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen font-[family-name:var(--font-inter)] antialiased">
        <Sidebar />
        <main className="pl-[60px] transition-[padding] duration-200">
          {children}
        </main>
      </body>
    </html>
  )
}
```

**Important nuance:** The sidebar is a client component, but the root layout is a server component. Next.js allows importing client components into server components — the `Sidebar` will be rendered on the client but the `<main>` wrapper stays server-rendered. The login page will also get the sidebar, which we need to handle — see Step 4.

**Step 2: Update projects list page — remove Nav import, adjust padding**

In `packages/dashboard/src/app/projects/page.tsx`:
- Remove: `import { Nav } from '@/components/nav'`
- Remove: `<Nav />`
- Change: `pt-24` → `pt-10`
- Remove the `<>...</>` fragment wrapper (no longer needed without Nav)

The page should become:

```tsx
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Plus, Github, ChevronRight, Folder } from 'lucide-react'

export default async function ProjectsPage() {
  const supabase = await createClient()
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, github_repo, created_at')
    .order('created_at', { ascending: false })

  return (
    <div className="mx-auto max-w-5xl px-6 pt-10 pb-16">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-lg font-medium text-fg">Projects</h1>
        <Link
          href="/projects/new"
          className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-bg transition-colors hover:bg-white/90"
        >
          <Plus className="h-3.5 w-3.5" />
          New Project
        </Link>
      </div>

      {/* Project list */}
      {!projects || projects.length === 0 ? (
        <div className="glass-card flex flex-col items-center px-8 py-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-elevated">
            <Folder className="h-5 w-5 text-muted" />
          </div>
          <p className="text-sm text-muted">No projects yet</p>
          <Link
            href="/projects/new"
            className="mt-4 flex items-center gap-1.5 text-sm text-fg transition-colors hover:text-white"
          >
            Create your first project
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="glass-card group flex items-center gap-4 px-5 py-4"
            >
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-medium text-fg group-hover:text-white">
                  {p.name}
                </h3>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                  <Github className="h-3 w-3 shrink-0" />
                  <span className="truncate">{p.github_repo}</span>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted/50 transition-colors group-hover:text-muted" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
```

**Step 3: Update new project page — remove Nav, adjust padding**

In `packages/dashboard/src/app/projects/new/page.tsx`:
- Remove: `import { Nav } from '@/components/nav'`
- Remove: `<Nav />`
- Change: `pt-24` → `pt-10`
- Remove the `<>...</>` fragment wrapper

**Step 4: Update project detail page — remove Nav, adjust padding**

In `packages/dashboard/src/app/projects/[id]/page.tsx`:
- Remove: `import { Nav } from '@/components/nav'`
- Remove: `<Nav />`
- Change: `pt-24` → `pt-10`
- Remove the `<>...</>` fragment wrapper

**Step 5: Handle the login page**

The login page (`/login`) should NOT show the sidebar (user isn't authenticated). Create a route group to separate authenticated and unauthenticated layouts.

Option: The simplest approach is to conditionally hide the sidebar in the root layout based on the pathname. But since the root layout is a server component, it can't use `usePathname`. Instead, wrap the `<Sidebar />` in a small client component that checks the pathname:

Create `packages/dashboard/src/components/sidebar-wrapper.tsx`:

```tsx
'use client'

import { usePathname } from 'next/navigation'
import { Sidebar } from './sidebar'

export function SidebarWrapper() {
  const pathname = usePathname()
  const hideSidebar = pathname === '/login' || pathname.startsWith('/auth/')
  if (hideSidebar) return null
  return <Sidebar />
}
```

Then in `layout.tsx`, import `SidebarWrapper` instead of `Sidebar`.

Similarly, wrap `<main>` in a component that conditionally applies the padding:

Create `packages/dashboard/src/components/main-content.tsx`:

```tsx
'use client'

import { usePathname } from 'next/navigation'

export function MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const hasSidebar = pathname !== '/login' && !pathname.startsWith('/auth/')
  return (
    <main className={hasSidebar ? 'pl-[60px] transition-[padding] duration-200' : ''}>
      {children}
    </main>
  )
}
```

Final `layout.tsx`:

```tsx
import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { SidebarWrapper } from '@/components/sidebar-wrapper'
import { MainContent } from '@/components/main-content'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
})

export const metadata: Metadata = {
  title: 'Feedback Chat — Dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen font-[family-name:var(--font-inter)] antialiased">
        <SidebarWrapper />
        <MainContent>{children}</MainContent>
      </body>
    </html>
  )
}
```

**Step 6: Verify build**

Run: `cd packages/dashboard && npx next build 2>&1 | tail -10`
Expected: Build succeeds. All pages render with sidebar instead of top nav.

**Step 7: Commit**

```bash
git add packages/dashboard/src/app/layout.tsx packages/dashboard/src/app/projects/page.tsx packages/dashboard/src/app/projects/new/page.tsx packages/dashboard/src/app/projects/\[id\]/page.tsx packages/dashboard/src/components/sidebar-wrapper.tsx packages/dashboard/src/components/main-content.tsx
git commit -m "feat(dashboard): replace top nav with left sidebar across all pages"
```

---

## Task 4: Create the StatsBar component

**Files:**
- Create: `packages/dashboard/src/components/stats-bar.tsx`

**Step 1: Create the server component**

Create `packages/dashboard/src/components/stats-bar.tsx`:

```tsx
import { Activity, CheckCircle, Clock, Zap } from 'lucide-react'

type Run = {
  stage: string
  started_at: string
  completed_at: string | null
  result: string | null
}

export function StatsBar({ runs }: { runs: Run[] }) {
  const total = runs.length
  const completed = runs.filter((r) => r.result !== null)
  const deployed = completed.filter((r) => r.result === 'success').length
  const successRate = completed.length > 0 ? Math.round((deployed / completed.length) * 100) : 0

  const durations = completed
    .filter((r) => r.completed_at)
    .map((r) => new Date(r.completed_at!).getTime() - new Date(r.started_at).getTime())
  const avgMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0
  const avgDuration = formatDuration(avgMs)

  const active = runs.filter((r) =>
    ['running', 'validating', 'queued'].includes(r.stage)
  ).length

  return (
    <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="stat-card">
        <div className="flex items-center gap-2 text-muted">
          <Activity className="h-3.5 w-3.5" />
          <span className="text-[11px] font-medium uppercase tracking-wider">Total Runs</span>
        </div>
        <p className="mt-1.5 text-2xl font-semibold tabular-nums text-fg">{total}</p>
      </div>

      <div className="stat-card">
        <div className="flex items-center gap-2 text-muted">
          <CheckCircle className="h-3.5 w-3.5" />
          <span className="text-[11px] font-medium uppercase tracking-wider">Success Rate</span>
        </div>
        <div className="mt-1.5 flex items-center gap-3">
          <p className="text-2xl font-semibold tabular-nums text-fg">{successRate}%</p>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface">
            <div
              className="h-full rounded-full bg-success transition-all duration-500"
              style={{ width: `${successRate}%` }}
            />
          </div>
        </div>
      </div>

      <div className="stat-card">
        <div className="flex items-center gap-2 text-muted">
          <Clock className="h-3.5 w-3.5" />
          <span className="text-[11px] font-medium uppercase tracking-wider">Avg Duration</span>
        </div>
        <p className="mt-1.5 text-2xl font-semibold tabular-nums text-fg">
          {avgDuration || <span className="text-dim">&mdash;</span>}
        </p>
      </div>

      <div className={`stat-card ${active > 0 ? 'border-accent/30' : ''}`}>
        <div className="flex items-center gap-2 text-muted">
          <Zap className="h-3.5 w-3.5" />
          <span className="text-[11px] font-medium uppercase tracking-wider">Active</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <p className="text-2xl font-semibold tabular-nums text-fg">{active}</p>
          {active > 0 && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-50" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function formatDuration(ms: number): string {
  if (ms <= 0) return ''
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}
```

**Step 2: Verify build**

Run: `cd packages/dashboard && npx next build 2>&1 | tail -5`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add packages/dashboard/src/components/stats-bar.tsx
git commit -m "feat(dashboard): add aggregate stats bar component"
```

---

## Task 5: Add StatsBar to the project detail page

**Files:**
- Modify: `packages/dashboard/src/app/projects/[id]/page.tsx`

**Step 1: Import and render StatsBar between the header and checklist**

In `packages/dashboard/src/app/projects/[id]/page.tsx`, add the import:

```tsx
import { StatsBar } from '@/components/stats-bar'
```

Insert `<StatsBar runs={runs ?? []} />` between the project header `</div>` and the `{/* Setup checklist */}` comment (i.e., after the `mb-8` header div, before `<SetupChecklist>`).

**Step 2: Verify build**

Run: `cd packages/dashboard && npx next build 2>&1 | tail -5`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add packages/dashboard/src/app/projects/\[id\]/page.tsx
git commit -m "feat(dashboard): add stats bar to project detail page"
```

---

## Task 6: Create loading skeletons

**Files:**
- Create: `packages/dashboard/src/app/projects/loading.tsx`
- Create: `packages/dashboard/src/app/projects/[id]/loading.tsx`

**Step 1: Create projects list loading skeleton**

Create `packages/dashboard/src/app/projects/loading.tsx`:

```tsx
export default function ProjectsLoading() {
  return (
    <div className="mx-auto max-w-5xl px-6 pt-10 pb-16">
      {/* Header skeleton */}
      <div className="mb-8 flex items-center justify-between">
        <div className="skeleton h-6 w-24" />
        <div className="skeleton h-9 w-32 rounded-xl" />
      </div>

      {/* Project cards skeleton */}
      <div className="grid gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="glass-card px-5 py-4">
            <div className="skeleton mb-2 h-4 w-40" />
            <div className="skeleton h-3 w-56" />
          </div>
        ))}
      </div>
    </div>
  )
}
```

**Step 2: Create project detail loading skeleton**

Create `packages/dashboard/src/app/projects/[id]/loading.tsx`:

```tsx
export default function ProjectDetailLoading() {
  return (
    <div className="mx-auto max-w-5xl px-6 pt-10 pb-16">
      {/* Breadcrumb skeleton */}
      <div className="skeleton mb-6 h-3 w-20" />

      {/* Header skeleton */}
      <div className="mb-8">
        <div className="skeleton mb-2 h-5 w-48" />
        <div className="skeleton h-3 w-32" />
      </div>

      {/* Stats bar skeleton */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="stat-card">
            <div className="skeleton mb-2 h-3 w-20" />
            <div className="skeleton h-7 w-16" />
          </div>
        ))}
      </div>

      {/* Checklist skeleton */}
      <div className="glass-card mb-8 p-6">
        <div className="skeleton mb-4 h-4 w-32" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton h-8 w-full" />
          ))}
        </div>
      </div>

      {/* Runs table skeleton */}
      <div className="mb-8">
        <div className="skeleton mb-4 h-4 w-28" />
        <div className="glass-card overflow-hidden">
          {/* Header row */}
          <div className="flex gap-4 border-b border-edge px-5 py-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="skeleton h-3 w-16" />
            ))}
          </div>
          {/* Data rows */}
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-4 border-b border-edge/50 px-5 py-3 last:border-0">
              {[1, 2, 3, 4, 5, 6].map((j) => (
                <div key={j} className="skeleton h-3 w-16" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

**Step 3: Verify build**

Run: `cd packages/dashboard && npx next build 2>&1 | tail -5`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add packages/dashboard/src/app/projects/loading.tsx packages/dashboard/src/app/projects/\[id\]/loading.tsx
git commit -m "feat(dashboard): add glass shimmer loading skeletons"
```

---

## Task 7: Extract StageBadge into a shared component

The `StageBadge` component is currently defined inline in the project detail page. Both the slide-over panel and the full detail page will need it, so extract it first.

**Files:**
- Create: `packages/dashboard/src/components/stage-badge.tsx`
- Modify: `packages/dashboard/src/app/projects/[id]/page.tsx`

**Step 1: Create the shared component**

Create `packages/dashboard/src/components/stage-badge.tsx`:

```tsx
const STAGE_LABELS: Record<string, string> = {
  created: 'Created',
  queued: 'Queued',
  running: 'Running',
  validating: 'Validating',
  preview_ready: 'Preview',
  deployed: 'Deployed',
  failed: 'Failed',
  rejected: 'Rejected',
}

export function StageBadge({ stage }: { stage: string }) {
  return (
    <span className={`stage-badge stage-${stage}`}>
      {stage === 'running' && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-50" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {STAGE_LABELS[stage] ?? stage}
    </span>
  )
}
```

**Step 2: Update the project detail page to import from the shared component**

In `packages/dashboard/src/app/projects/[id]/page.tsx`:
- Remove the `type Stage` declaration and the `StageBadge` function definition (lines 8-33)
- Add import: `import { StageBadge } from '@/components/stage-badge'`

**Step 3: Verify build**

Run: `cd packages/dashboard && npx next build 2>&1 | tail -5`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add packages/dashboard/src/components/stage-badge.tsx packages/dashboard/src/app/projects/\[id\]/page.tsx
git commit -m "refactor(dashboard): extract StageBadge into shared component"
```

---

## Task 8: Define the shared Run type

Multiple components will need the same run type. Create a shared types file.

**Files:**
- Create: `packages/dashboard/src/lib/types.ts`

**Step 1: Create the types file**

Create `packages/dashboard/src/lib/types.ts`:

```ts
export type PipelineRun = {
  id: string
  github_issue_number: number
  github_pr_number: number | null
  stage: string
  triggered_by: string | null
  started_at: string
  completed_at: string | null
  result: string | null
}

export type RunLog = {
  id: number
  timestamp: string
  level: string
  message: string
}

export type DeploymentInfo = {
  state: 'pending' | 'success' | 'failure' | 'error'
  previewUrl: string | null
  description: string | null
}
```

**Step 2: Update StatsBar to use the shared type**

In `packages/dashboard/src/components/stats-bar.tsx`, replace the local `Run` type with:

```tsx
import { type PipelineRun } from '@/lib/types'
```

And change the prop from `runs: Run[]` to `runs: PipelineRun[]`.

**Step 3: Commit**

```bash
git add packages/dashboard/src/lib/types.ts packages/dashboard/src/components/stats-bar.tsx
git commit -m "refactor(dashboard): add shared PipelineRun, RunLog, DeploymentInfo types"
```

---

## Task 9: Create the deployment API route

**Files:**
- Create: `packages/dashboard/src/app/api/runs/[projectId]/[runId]/deployment/route.ts`

**Step 1: Create the API route**

This route fetches the Vercel deployment status from GitHub commit statuses on the PR's head commit.

Create `packages/dashboard/src/app/api/runs/[projectId]/[runId]/deployment/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; runId: string }> }
) {
  const { projectId, runId } = await params
  const supabase = await createClient()

  // Get the run's PR number
  const { data: run } = await supabase
    .from('pipeline_runs')
    .select('github_pr_number')
    .eq('id', runId)
    .eq('project_id', projectId)
    .single()

  if (!run?.github_pr_number) {
    return NextResponse.json({ state: null, previewUrl: null, description: null })
  }

  // Get the project's GitHub repo
  const { data: project } = await supabase
    .from('projects')
    .select('github_repo')
    .eq('id', projectId)
    .single()

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const [owner, repo] = project.github_repo.split('/')

  // Fetch PR to get head SHA
  // Note: We use the user's GitHub token from credentials, or fall back to env
  const { data: cred } = await supabase
    .from('credentials')
    .select('encrypted_value')
    .eq('project_id', projectId)
    .limit(1)
    .single()

  // For now, use GITHUB_TOKEN from env as fallback
  const githubToken = process.env.GITHUB_TOKEN
  if (!githubToken) {
    return NextResponse.json({ state: null, previewUrl: null, description: 'No GitHub token configured' })
  }

  const headers = {
    Authorization: `Bearer ${githubToken}`,
    Accept: 'application/vnd.github.v3+json',
  }

  // Get PR head SHA
  const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${run.github_pr_number}`, { headers })
  if (!prRes.ok) {
    return NextResponse.json({ state: null, previewUrl: null, description: 'Failed to fetch PR' })
  }
  const prData = await prRes.json()
  const sha = prData.head?.sha

  if (!sha) {
    return NextResponse.json({ state: null, previewUrl: null, description: 'No head commit' })
  }

  // Get commit statuses
  const statusRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}/statuses`, { headers })
  if (!statusRes.ok) {
    return NextResponse.json({ state: null, previewUrl: null, description: 'Failed to fetch statuses' })
  }
  const statuses: Array<{ state: string; target_url: string; description: string; context: string }> = await statusRes.json()

  // Find Vercel deployment status
  const vercelStatus = statuses.find((s) => s.context.toLowerCase().includes('vercel'))

  if (!vercelStatus) {
    return NextResponse.json({ state: null, previewUrl: null, description: 'No Vercel deployment found' })
  }

  return NextResponse.json({
    state: vercelStatus.state,
    previewUrl: vercelStatus.target_url,
    description: vercelStatus.description,
  })
}
```

**Step 2: Verify build**

Run: `cd packages/dashboard && npx next build 2>&1 | tail -5`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add packages/dashboard/src/app/api/runs/\[projectId\]/\[runId\]/deployment/route.ts
git commit -m "feat(dashboard): add deployment status API route (GitHub commit statuses)"
```

---

## Task 10: Create the RunSlideOver client component

**Files:**
- Create: `packages/dashboard/src/components/run-slide-over.tsx`

**Step 1: Create the slide-over component**

Create `packages/dashboard/src/components/run-slide-over.tsx`:

```tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { X, ExternalLink, GitPullRequest, AlertCircle, Globe } from 'lucide-react'
import { StageBadge } from './stage-badge'
import type { PipelineRun, DeploymentInfo } from '@/lib/types'

const STAGE_ORDER = ['created', 'queued', 'running', 'validating', 'preview_ready', 'deployed']

type Props = {
  run: PipelineRun
  githubRepo: string
  projectId: string
  onClose: () => void
}

export function RunSlideOver({ run, githubRepo, projectId, onClose }: Props) {
  const [deployment, setDeployment] = useState<DeploymentInfo | null>(null)

  useEffect(() => {
    if (!run.github_pr_number) return
    fetch(`/api/runs/${projectId}/${run.id}/deployment`)
      .then((res) => res.json())
      .then(setDeployment)
      .catch(() => {})
  }, [run.id, run.github_pr_number, projectId])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const currentStageIndex = STAGE_ORDER.indexOf(run.stage)
  const isFailed = run.stage === 'failed' || run.stage === 'rejected'

  return (
    <>
      {/* Backdrop */}
      <div className="slide-over-backdrop" onClick={onClose} />

      {/* Panel */}
      <div className="fixed top-0 right-0 z-50 flex h-screen w-full max-w-[480px] flex-col border-l border-edge bg-bg/95 backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-edge px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="font-[family-name:var(--font-mono)] text-sm text-fg">
              #{run.github_issue_number}
            </span>
            <StageBadge stage={run.stage} />
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Triggered by */}
          {run.triggered_by && (
            <p className="mb-5 text-xs text-muted">
              Triggered by <span className="text-fg">{run.triggered_by}</span>
            </p>
          )}

          {/* Stage timeline */}
          <div className="mb-6">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">Timeline</h3>
            <div className="space-y-0">
              {STAGE_ORDER.map((stage, i) => {
                const isCompleted = i < currentStageIndex
                const isCurrent = stage === run.stage
                const isFutureOrFailed = !isCompleted && !isCurrent

                return (
                  <div key={stage} className="flex items-start gap-3">
                    {/* Dot + connector */}
                    <div className="flex flex-col items-center">
                      <div
                        className={`h-2.5 w-2.5 rounded-full border-2 ${
                          isCompleted
                            ? 'border-success bg-success'
                            : isCurrent
                              ? isFailed
                                ? 'border-danger bg-danger'
                                : 'border-accent bg-accent'
                              : 'border-edge bg-transparent'
                        }`}
                      />
                      {i < STAGE_ORDER.length - 1 && (
                        <div
                          className={`h-6 w-0.5 ${
                            isCompleted ? 'bg-success/30' : 'bg-edge'
                          }`}
                        />
                      )}
                    </div>
                    {/* Label */}
                    <span
                      className={`-mt-0.5 text-xs ${
                        isCompleted || isCurrent ? 'text-fg' : 'text-dim'
                      }`}
                    >
                      {stage.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                    </span>
                  </div>
                )
              })}
              {/* Show failed/rejected as final step if applicable */}
              {isFailed && (
                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <div className="h-2.5 w-2.5 rounded-full border-2 border-danger bg-danger" />
                  </div>
                  <span className="-mt-0.5 text-xs text-danger">
                    {run.stage === 'failed' ? 'Failed' : 'Rejected'}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* PR link */}
          {run.github_pr_number && (
            <div className="mb-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Pull Request</h3>
              <a
                href={`https://github.com/${githubRepo}/pull/${run.github_pr_number}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2.5 text-sm text-accent transition-colors hover:bg-surface-hover"
              >
                <GitPullRequest className="h-4 w-4 shrink-0" />
                <span>#{run.github_pr_number}</span>
                <ExternalLink className="ml-auto h-3 w-3 text-muted" />
              </a>
            </div>
          )}

          {/* Deployment info */}
          {deployment?.previewUrl && (
            <div className="mb-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Deployment</h3>
              <a
                href={deployment.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2.5 text-sm text-accent transition-colors hover:bg-surface-hover"
              >
                <Globe className="h-4 w-4 shrink-0" />
                <span className="truncate">{deployment.previewUrl.replace('https://', '')}</span>
                <ExternalLink className="ml-auto h-3 w-3 shrink-0 text-muted" />
              </a>
              {deployment.description && (
                <p className="mt-1.5 text-[11px] text-muted">{deployment.description}</p>
              )}
            </div>
          )}

          {/* GitHub issue link */}
          <div className="mb-4">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Issue</h3>
            <a
              href={`https://github.com/${githubRepo}/issues/${run.github_issue_number}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2.5 text-sm text-accent transition-colors hover:bg-surface-hover"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Issue #{run.github_issue_number}</span>
              <ExternalLink className="ml-auto h-3 w-3 text-muted" />
            </a>
          </div>

          {/* Timestamps */}
          <div className="mt-6 space-y-1.5 text-xs text-muted">
            <p>
              Started:{' '}
              <span className="tabular-nums text-fg">
                {new Date(run.started_at).toLocaleString()}
              </span>
            </p>
            {run.completed_at && (
              <p>
                Completed:{' '}
                <span className="tabular-nums text-fg">
                  {new Date(run.completed_at).toLocaleString()}
                </span>
              </p>
            )}
          </div>
        </div>

        {/* Footer — link to full detail page */}
        <div className="border-t border-edge px-6 py-4">
          <a
            href={`/projects/${projectId}/runs/${run.id}`}
            className="flex h-9 w-full items-center justify-center rounded-xl bg-surface text-sm font-medium text-fg transition-colors hover:bg-elevated"
          >
            View full details
          </a>
        </div>
      </div>
    </>
  )
}
```

**Step 2: Verify build**

Run: `cd packages/dashboard && npx next build 2>&1 | tail -5`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add packages/dashboard/src/components/run-slide-over.tsx
git commit -m "feat(dashboard): add pipeline run slide-over panel"
```

---

## Task 11: Make the runs table clickable with slide-over

**Files:**
- Modify: `packages/dashboard/src/app/projects/[id]/page.tsx`
- Create: `packages/dashboard/src/components/runs-table.tsx`

The project detail page is a server component. The runs table needs to become a client component to support the click-to-open slide-over interaction.

**Step 1: Extract the runs table into a client component**

Create `packages/dashboard/src/components/runs-table.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { StageBadge } from './stage-badge'
import { RunSlideOver } from './run-slide-over'
import type { PipelineRun } from '@/lib/types'

type Props = {
  runs: PipelineRun[]
  githubRepo: string
  projectId: string
}

export function RunsTable({ runs, githubRepo, projectId }: Props) {
  const [selectedRun, setSelectedRun] = useState<PipelineRun | null>(null)

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
              <th className="px-5 py-3 font-medium">Triggered by</th>
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
                <td className="px-5 py-3 text-xs text-muted">
                  {run.triggered_by ?? <span className="text-dim">&mdash;</span>}
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

**Step 2: Update the project detail page to use RunsTable**

In `packages/dashboard/src/app/projects/[id]/page.tsx`:
- Add import: `import { RunsTable } from '@/components/runs-table'`
- Replace the entire `{/* Runs table */}` section (the `<div className="mb-8">` containing the table) with:

```tsx
        {/* Runs table */}
        <div className="mb-8">
          <h2 className="mb-4 text-sm font-medium text-fg">Pipeline Runs</h2>
          <RunsTable runs={runs ?? []} githubRepo={project.github_repo} projectId={project.id} />
        </div>
```

- Remove the `ExternalLink` import from lucide-react (no longer used directly in this file, only in RunsTable)
- Remove the `StageBadge` import if it's no longer used directly (check — it was removed in Task 7)

**Step 3: Verify build**

Run: `cd packages/dashboard && npx next build 2>&1 | tail -5`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add packages/dashboard/src/components/runs-table.tsx packages/dashboard/src/app/projects/\[id\]/page.tsx
git commit -m "feat(dashboard): make runs table clickable with slide-over panel"
```

---

## Task 12: Create the full run detail page

**Files:**
- Create: `packages/dashboard/src/app/projects/[id]/runs/[runId]/page.tsx`
- Create: `packages/dashboard/src/components/log-viewer.tsx`

**Step 1: Create the log viewer component**

Create `packages/dashboard/src/components/log-viewer.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import type { RunLog } from '@/lib/types'

export function LogViewer({ projectId, runId }: { projectId: string; runId: string }) {
  const [logs, setLogs] = useState<RunLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/runs/${projectId}/${runId}/logs`)
      .then((res) => res.json())
      .then((data) => setLogs(data.logs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId, runId])

  if (loading) {
    return (
      <div className="code-block">
        <div className="skeleton h-4 w-64 mb-2" />
        <div className="skeleton h-4 w-48 mb-2" />
        <div className="skeleton h-4 w-56" />
      </div>
    )
  }

  if (logs.length === 0) {
    return (
      <div className="code-block text-center text-muted">
        No logs available for this run.
      </div>
    )
  }

  return (
    <div className="code-block max-h-[500px] overflow-y-auto whitespace-pre-wrap">
      {logs.map((log) => (
        <div key={log.id} className="flex gap-3">
          <span className="shrink-0 text-dim tabular-nums">
            {new Date(log.timestamp).toLocaleTimeString()}
          </span>
          <span
            className={
              log.level === 'error'
                ? 'text-danger'
                : log.level === 'warn'
                  ? 'text-[#fbbf24]'
                  : ''
            }
          >
            {log.message}
          </span>
        </div>
      ))}
    </div>
  )
}
```

**Step 2: Create the full run detail page**

Create `packages/dashboard/src/app/projects/[id]/runs/[runId]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { ArrowLeft, ExternalLink, GitPullRequest, AlertCircle, Globe } from 'lucide-react'
import { StageBadge } from '@/components/stage-badge'
import { LogViewer } from '@/components/log-viewer'
import { DeploymentPreview } from '@/components/deployment-preview'

const STAGE_ORDER = ['created', 'queued', 'running', 'validating', 'preview_ready', 'deployed']

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>
}) {
  const { id: projectId, runId } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, github_repo')
    .eq('id', projectId)
    .single()

  if (!project) notFound()

  const { data: run } = await supabase
    .from('pipeline_runs')
    .select('id, github_issue_number, github_pr_number, stage, triggered_by, started_at, completed_at, result')
    .eq('id', runId)
    .eq('project_id', projectId)
    .single()

  if (!run) notFound()

  const currentStageIndex = STAGE_ORDER.indexOf(run.stage)
  const isFailed = run.stage === 'failed' || run.stage === 'rejected'

  // Calculate duration
  let duration = ''
  if (run.completed_at) {
    const ms = new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()
    const totalSeconds = Math.round(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    duration = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
  }

  return (
    <div className="mx-auto max-w-5xl px-6 pt-10 pb-16">
      {/* Breadcrumb */}
      <Link
        href={`/projects/${projectId}`}
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-3 w-3" />
        {project.name}
      </Link>

      {/* Header */}
      <div className="mb-8 flex items-center gap-4">
        <h1 className="text-lg font-medium text-fg">
          Run <span className="font-[family-name:var(--font-mono)]">#{run.github_issue_number}</span>
        </h1>
        <StageBadge stage={run.stage} />
        {duration && (
          <span className="text-xs text-muted tabular-nums">{duration}</span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content — 2/3 width */}
        <div className="lg:col-span-2 space-y-6">
          {/* Logs */}
          <div>
            <h2 className="mb-3 text-sm font-medium text-fg">Logs</h2>
            <LogViewer projectId={projectId} runId={runId} />
          </div>

          {/* Deployment preview */}
          <div>
            <h2 className="mb-3 text-sm font-medium text-fg">Deployment Preview</h2>
            <DeploymentPreview projectId={projectId} runId={runId} />
          </div>
        </div>

        {/* Sidebar — 1/3 width */}
        <div className="space-y-6">
          {/* Stage timeline */}
          <div className="glass-card p-5">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">Timeline</h3>
            <div className="space-y-0">
              {STAGE_ORDER.map((stage, i) => {
                const isCompleted = i < currentStageIndex
                const isCurrent = stage === run.stage

                return (
                  <div key={stage} className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className={`h-2.5 w-2.5 rounded-full border-2 ${
                          isCompleted
                            ? 'border-success bg-success'
                            : isCurrent
                              ? isFailed
                                ? 'border-danger bg-danger'
                                : 'border-accent bg-accent'
                              : 'border-edge bg-transparent'
                        }`}
                      />
                      {i < STAGE_ORDER.length - 1 && (
                        <div
                          className={`h-6 w-0.5 ${isCompleted ? 'bg-success/30' : 'bg-edge'}`}
                        />
                      )}
                    </div>
                    <span
                      className={`-mt-0.5 text-xs ${
                        isCompleted || isCurrent ? 'text-fg' : 'text-dim'
                      }`}
                    >
                      {stage.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                    </span>
                  </div>
                )
              })}
              {isFailed && (
                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <div className="h-2.5 w-2.5 rounded-full border-2 border-danger bg-danger" />
                  </div>
                  <span className="-mt-0.5 text-xs text-danger">
                    {run.stage === 'failed' ? 'Failed' : 'Rejected'}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Links */}
          <div className="glass-card p-5 space-y-3">
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted">Links</h3>

            <a
              href={`https://github.com/${project.github_repo}/issues/${run.github_issue_number}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2.5 text-sm text-accent transition-colors hover:bg-surface-hover"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              Issue #{run.github_issue_number}
              <ExternalLink className="ml-auto h-3 w-3 text-muted" />
            </a>

            {run.github_pr_number && (
              <a
                href={`https://github.com/${project.github_repo}/pull/${run.github_pr_number}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2.5 text-sm text-accent transition-colors hover:bg-surface-hover"
              >
                <GitPullRequest className="h-4 w-4 shrink-0" />
                PR #{run.github_pr_number}
                <ExternalLink className="ml-auto h-3 w-3 text-muted" />
              </a>
            )}
          </div>

          {/* Metadata */}
          <div className="glass-card p-5">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">Details</h3>
            <dl className="space-y-2 text-xs">
              {run.triggered_by && (
                <>
                  <dt className="text-muted">Triggered by</dt>
                  <dd className="text-fg">{run.triggered_by}</dd>
                </>
              )}
              <dt className="text-muted">Started</dt>
              <dd className="tabular-nums text-fg">
                {new Date(run.started_at).toLocaleString()}
              </dd>
              {run.completed_at && (
                <>
                  <dt className="text-muted">Completed</dt>
                  <dd className="tabular-nums text-fg">
                    {new Date(run.completed_at).toLocaleString()}
                  </dd>
                </>
              )}
              {run.result && (
                <>
                  <dt className="text-muted">Result</dt>
                  <dd className="text-fg capitalize">{run.result}</dd>
                </>
              )}
            </dl>
          </div>
        </div>
      </div>
    </div>
  )
}
```

**Step 3: Create the DeploymentPreview component**

Create `packages/dashboard/src/components/deployment-preview.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Globe, ExternalLink } from 'lucide-react'
import type { DeploymentInfo } from '@/lib/types'

export function DeploymentPreview({ projectId, runId }: { projectId: string; runId: string }) {
  const [deployment, setDeployment] = useState<DeploymentInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/runs/${projectId}/${runId}/deployment`)
      .then((res) => res.json())
      .then(setDeployment)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId, runId])

  if (loading) {
    return (
      <div className="glass-card p-5">
        <div className="skeleton h-4 w-48 mb-2" />
        <div className="skeleton h-32 w-full" />
      </div>
    )
  }

  if (!deployment?.previewUrl) {
    return (
      <div className="glass-card px-5 py-8 text-center">
        <Globe className="mx-auto mb-2 h-5 w-5 text-muted" />
        <p className="text-sm text-muted">
          {deployment?.description ?? 'No deployment preview available.'}
        </p>
      </div>
    )
  }

  return (
    <div className="glass-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-muted">
          <Globe className="h-3.5 w-3.5" />
          <span className="truncate">{deployment.previewUrl.replace('https://', '')}</span>
        </div>
        <a
          href={deployment.previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-accent transition-colors hover:text-accent/80"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      <iframe
        src={deployment.previewUrl}
        className="h-[400px] w-full border-0 bg-white"
        title="Deployment preview"
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  )
}
```

**Step 4: Verify build**

Run: `cd packages/dashboard && npx next build 2>&1 | tail -5`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add packages/dashboard/src/app/projects/\[id\]/runs/\[runId\]/page.tsx packages/dashboard/src/components/log-viewer.tsx packages/dashboard/src/components/deployment-preview.tsx
git commit -m "feat(dashboard): add full run detail page with logs and deployment preview"
```

---

## Task 13: Delete the old Nav component

**Files:**
- Delete: `packages/dashboard/src/components/nav.tsx`

**Step 1: Verify no remaining imports**

Search for any remaining imports of `nav.tsx`:

Run: `grep -r "from.*components/nav" packages/dashboard/src/`
Expected: No results (all pages now use Sidebar via layout).

**Step 2: Delete the file**

Run: `rm packages/dashboard/src/components/nav.tsx`

**Step 3: Verify build**

Run: `cd packages/dashboard && npx next build 2>&1 | tail -5`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add -u packages/dashboard/src/components/nav.tsx
git commit -m "chore(dashboard): remove old top nav component"
```

---

## Task 14: Final build verification and visual check

**Step 1: Full build**

Run: `cd packages/dashboard && npx next build`
Expected: Build succeeds with no errors.

**Step 2: Start dev server and visually verify**

Run: `cd packages/dashboard && npm run dev`

Check the following pages:
1. `/login` — should NOT show sidebar
2. `/projects` — sidebar visible (collapsed), glass shimmer skeleton flashes briefly, then project list loads
3. `/projects/new` — sidebar visible, form renders with correct left offset
4. `/projects/{some-id}` — sidebar visible, stats bar shows 4 cards, runs table rows are clickable
5. Click a run row — slide-over should animate in from right with timeline and links
6. Click "View full details" — navigates to `/projects/{id}/runs/{runId}` with logs and deployment preview
7. Hover sidebar — should expand to 220px showing labels
8. Pin sidebar — should stay expanded, content shifts right
9. Refresh page — pin state should persist from localStorage

**Step 3: Commit any fixes if needed, then tag**

```bash
git commit -m "feat(dashboard): complete layout improvements — sidebar, run detail, stats, skeletons"
```
