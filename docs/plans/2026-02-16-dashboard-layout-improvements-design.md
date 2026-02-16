# Dashboard Layout Improvements Design

## Overview

Four improvements to the dashboard: left sidebar navigation, pipeline run detail views, aggregate stats overview, and loading skeletons. All follow the existing dark glassmorphism design system.

## 1. Left Sidebar Navigation

Replace the fixed top navbar with a hybrid icon rail / expandable sidebar on the left.

**Collapsed state (default):** 60px wide vertical strip, fixed left, full viewport height. Shows only icons with tooltips on hover.

**Expanded state:** 220px wide. Triggered by hover (temporary) or pin toggle (persistent, stored in localStorage). Body content shifts right with animated `padding-left` transition.

**Nav items (static layout for now):**
- Top: Logo icon linking to `/projects`
- Middle: Projects (FolderKanban icon)
- Bottom: Sign out button

**Styling:** `bg-bg/80`, `backdrop-blur-xl`, `border-r border-edge`, matching the glass-card shadow treatment. Floats over content with `z-40`.

**Content offset:** Pages switch from `pt-24` (top nav) to `pl-[60px]` (collapsed) or `pl-[220px]` (pinned). Animated via CSS transition.

**Mobile:** Out of scope for this iteration.

## 2. Pipeline Run Detail

Two-layer detail system for inspecting pipeline runs.

### Layer 1: Slide-over Panel

Triggered by clicking any run row in the table. Glass panel slides in from the right (~480px wide) with a semi-transparent backdrop.

**Contents:**
- Run header: issue number, stage badge, triggered by
- Stage timeline: vertical step indicator with timestamps (created -> queued -> running -> validating -> preview_ready -> deployed/failed)
- PR link with title and branch name
- Vercel deployment link (extracted from GitHub commit statuses)
- "View full details" button linking to the full page
- External links to GitHub issue and PR

**Dismiss:** Click backdrop, press Escape, or click X button.

### Layer 2: Full Detail Page

Route: `/projects/[id]/runs/[runId]`

Everything from the slide-over plus:
- **Run logs:** Scrollable terminal-style log viewer using existing `/api/runs/[projectId]/[runId]/logs` endpoint, styled with the `code-block` pattern
- **Deployment preview:** Iframe or prominent link to the Vercel preview URL
- **PR diff summary:** List of changed files from the GitHub API
- **Full stage timeline** with computed durations between stages

### Vercel Deployment Data

New API route: `GET /api/runs/[projectId]/[runId]/deployment`

Flow:
1. Fetch the PR's head commit SHA via GitHub API (`GET /repos/{owner}/{repo}/pulls/{pr_number}`)
2. Fetch commit statuses (`GET /repos/{owner}/{repo}/commits/{sha}/statuses`)
3. Filter for Vercel status (context contains "vercel")
4. Return the `target_url` (preview URL) and `state` (pending/success/failure)

Uses the project's stored GitHub token. No additional credentials needed.

## 3. Aggregate Stats Overview

A stats bar placed between the project header and the setup checklist on the project detail page.

**Four glass stat cards** in a responsive grid (`grid-cols-4` desktop, `grid-cols-2` mobile):

| Stat | Computation | Display |
|------|------------|---------|
| Total runs | `runs.length` | Number + "runs" label |
| Success rate | `deployed / (deployed + failed + rejected)` | Percentage + small bar |
| Avg duration | `avg(completed_at - started_at)` for completed runs | "12m 34s" format |
| Active runs | `count(stage in [running, validating, queued])` | Number + animated dot |

**Visual treatment:**
- Compact glass cards (~80px tall), subtle border
- Icon + large number + muted label
- Active runs card gets a pulsing accent border when count > 0
- Computed server-side from the already-fetched runs array (no new API route)

## 4. Loading Skeletons

Glass shimmer skeletons using Next.js `loading.tsx` convention.

### Shimmer animation

```css
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
```

Applied as: `linear-gradient(90deg, transparent, rgba(255,255,255,0.04), transparent)` on a 1.5s loop.

### Skeleton pages

**`/projects/loading.tsx`:**
- Header: title rectangle + button rectangle
- Grid of 3 skeleton glass cards matching project card dimensions

**`/projects/[id]/loading.tsx`:**
- Breadcrumb: short line
- Header: title line + repo line
- Stats bar: 4 card outlines with shimmer
- Runs table: table header + 5 rows of pulsing cells

All skeletons use the same `glass-card` background with the shimmer overlay. Zero client JS — pure server-rendered loading states.

## Design System Additions

New CSS additions to `globals.css`:
- `.skeleton` class: base skeleton element with shimmer animation
- `.glass-sidebar` class: sidebar-specific glass treatment
- `.slide-over-backdrop` class: semi-transparent backdrop for the run detail panel
- `.stat-card` class: compact glass card variant for the stats bar

All new components use the existing color variables (`--color-*`) and design tokens. No new colors or fonts introduced.
