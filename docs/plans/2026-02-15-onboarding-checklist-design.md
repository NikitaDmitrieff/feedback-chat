# Onboarding Checklist Design

**Goal:** Replace the one-time setup banner with a persistent step-by-step checklist that guides users from project creation to first pipeline run.

**Approach:** Setup checklist on the project detail page (Approach A). Progressive detail — quick titles by default, expandable sections with full commands.

## The Problem

After creating a project, users land on a page that dumps raw credentials and an empty runs table. There's no guidance on what to do next, in what order, or how to verify each step.

## Checklist Steps

| # | Step | Expandable content | Auto-detected? |
|---|------|--------------------|----------------|
| 1 | Install the widget | `npm install` command with peer deps | Manual check-off |
| 2 | Add environment variables | `AGENT_URL` + `FEEDBACK_CHAT_API_KEY` | Manual check-off |
| 3 | Configure GitHub webhook | URL, secret, content type, events + `gh api` one-liner | Manual check-off |
| 4 | Create GitHub labels | 6 `gh label create` commands | Manual check-off |
| 5 | Send your first feedback | Instructions to open app and send a message | Auto: pipeline_runs count > 0 |

## State Management

- Steps 1-4 tracked via `setup_progress` JSONB column on `projects` table
- Step 5 derived from pipeline_runs count
- First visit (apiKey in URL): step 2 auto-expands
- Returning visit: first incomplete step auto-expands
- "Mark as done" button inside each expanded step fires a Server Action

## Visual Treatment

Same visual language as the widget's PipelineTracker:
- Filled dot = completed (muted label)
- Pulsing dot = current step (white label)
- Empty dot = future (dim label)
- Vertical emerald progress line
- Glass card container with "Setup · 2/5" header

When all 5 complete: collapses to "Setup complete" one-liner, expandable for reference.

## Page Layout States

1. **Fresh project:** Checklist is primary, runs table dimmed with contextual empty message
2. **Setup complete:** Checklist collapsed to one line, runs table is primary
3. **Returning user:** Same as state 2
