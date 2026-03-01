# feedback-chat

AI-powered feedback widget for Next.js. Users chat with an AI advisor, feedback becomes GitHub issues, an autonomous agent implements them, and the system learns from its own failures.

```
User chats → GitHub issue → Claude agent implements → PR → preview → approve
                                    ↓ (on failure)
                              Haiku classifies → self-improve job → fix PR
```

## Demo

<video src="https://github.com/NikitaDmitrieff/feedback-chat/raw/main/docs/demo.mp4" controls width="100%"></video>

## Quick Actions

```bash
npm run dev          # Start everything (widget + dashboard + agent dev)
npm run build        # Build all packages
npm run test         # Run tests
npm run switch       # Toggle worker between local and Railway
```

### Switch worker location

The agent worker can run on Railway (24/7) or locally (for development/debugging). Toggle with:

```bash
npm run switch       # Local → Railway, or Railway → local
```

First run starts the worker locally and pauses Railway. Run again to stop local and resume Railway.

### Dashboard

```bash
npm run dev          # → http://localhost:3001
```

Production: [loop.joincoby.com](https://loop.joincoby.com)

The dashboard shows projects, pipeline runs, failure classifications, self-improvement PRs, feedback sessions, tester activity, and AI-generated proposals.

---

## Architecture

```
feedback-chat/
├── packages/
│   ├── widget/      ← npm package (@nikitadmitrieff/feedback-chat)
│   │   └── src/
│   │       ├── client/   ← React components (FeedbackPanel, PipelineTracker)
│   │       ├── server/   ← Route handler factories
│   │       └── cli/      ← npx setup wizard + deploy script
│   ├── agent/       ← Managed worker (polls Supabase, runs Claude CLI)
│   │   └── src/
│   │       ├── managed-worker.ts   ← Job loop (claim → process → retry/fail)
│   │       ├── worker.ts           ← Implement jobs (clone → Claude → validate → PR)
│   │       ├── setup-worker.ts     ← Setup jobs (widget installation on consumer repos)
│   │       ├── self-improve-worker.ts ← Self-fix jobs (clone feedback-chat → fix → PR)
│   │       ├── strategize-worker.ts   ← AI proposals from feedback themes
│   │       ├── classify-failure.ts    ← Haiku failure classification
│   │       └── oauth.ts              ← Claude Max token refresh
│   └── dashboard/   ← Next.js app (Supabase backend)
│       ├── src/app/projects/   ← Project management, runs, feedback, proposals
│       └── supabase/migrations/
├── scripts/
│   └── switch-worker.sh   ← Local/Railway toggle
└── docs/
```

### How the pipeline works

1. **Feedback** — User chats via the widget, AI refines the idea into a GitHub issue
2. **Queue** — Issue webhook enqueues a job in Supabase `job_queue`
3. **Implement** — Worker claims job, clones consumer repo, runs Claude CLI, validates build, creates PR
4. **Retry** — Failed jobs retry up to 3 times with exponential backoff. Stale jobs (>30min) are reaped.
5. **Classify** — After 3 failures, Haiku classifies the root cause: `docs_gap`, `widget_bug`, `agent_bug`, `consumer_error`, or `transient`
6. **Self-improve** — For our-fault failures (`docs_gap`/`widget_bug`/`agent_bug`), a `self_improve` job clones this repo, runs Claude CLI with the failure context, and creates a fix PR
7. **Strategize** — AI reads accumulated feedback themes and proposes product improvements for human review (weekly cron + manual trigger)

---

## Install the Widget

### 1. Install

```bash
npm install @nikitadmitrieff/feedback-chat \
  @assistant-ui/react @assistant-ui/react-ai-sdk @assistant-ui/react-markdown \
  ai @ai-sdk/anthropic
```

> **React 19.1.0 and 19.1.1 are excluded** by `@ai-sdk/react`. Check with `npm ls react` — upgrade if needed.

### 2. Configure Tailwind v4

In `globals.css`, after `@import "tailwindcss"`:

```css
@source "../node_modules/@nikitadmitrieff/feedback-chat/dist/**/*.js";
```

**Mandatory.** Without this, the widget renders unstyled.

### 3. Create API routes

**`api/feedback/chat/route.ts`**

```ts
import { createFeedbackHandler } from '@nikitadmitrieff/feedback-chat/server'

const handler = createFeedbackHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  // github: { token: process.env.GITHUB_TOKEN!, repo: process.env.GITHUB_REPO! },
})

export const POST = handler.POST
```

**`api/feedback/status/route.ts`**

```ts
import { createStatusHandler } from '@nikitadmitrieff/feedback-chat/server'

const handler = createStatusHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  // github: { token: process.env.GITHUB_TOKEN!, repo: process.env.GITHUB_REPO! },
  // agentUrl: process.env.AGENT_URL,
})

export const { GET, POST } = handler
```

Uncomment lines matching your tier: **Chat only** (default), **+GitHub**, or **+Pipeline**.

### 4. Add the component

```tsx
'use client'
import { useState } from 'react'
import { FeedbackPanel } from '@nikitadmitrieff/feedback-chat'
import '@nikitadmitrieff/feedback-chat/styles.css'

export function FeedbackButton() {
  const [open, setOpen] = useState(false)
  return <FeedbackPanel isOpen={open} onToggle={() => setOpen(!open)} />
}
```

Add `<FeedbackButton />` to your root layout.

### 5. Environment variables

```env
ANTHROPIC_API_KEY=sk-ant-...
FEEDBACK_PASSWORD=your-password
# GITHUB_TOKEN=ghp_...       # +GitHub/+Pipeline (must be PAT, not gho_)
# GITHUB_REPO=owner/repo     # +GitHub/+Pipeline
# AGENT_URL=https://...      # +Pipeline only
```

### 6. Verify

`npm run dev` → click the feedback bar → enter password → chat.

---

## +GitHub: Create Labels

```bash
gh label create feedback-bot --color 0E8A16 --description "Created by feedback widget" --force
gh label create auto-implement --color 1D76DB --description "Agent should implement this" --force
gh label create in-progress --color FBCA04 --description "Agent is working on this" --force
gh label create agent-failed --color D93F0B --description "Agent build/lint failed" --force
gh label create preview-pending --color C5DEF5 --description "PR ready, preview deploying" --force
gh label create rejected --color E4E669 --description "User rejected changes" --force
```

---

## +Pipeline: Deploy the Agent

### Railway

```bash
git clone --depth 1 https://github.com/NikitaDmitrieff/feedback-chat
cd feedback-chat/packages/agent
railway init && railway up --detach
railway service status --all          # note service name
railway service link <service-name>
railway variables set GITHUB_TOKEN=ghp_... GITHUB_REPO=owner/repo WEBHOOK_SECRET=$(openssl rand -hex 32)
# Claude auth — pick one:
railway variables set CLAUDE_CREDENTIALS_JSON='...'   # Max ($0/run)
railway variables set ANTHROPIC_API_KEY=sk-ant-...     # API key (pay per token)
railway domain
```

### Docker

```bash
cd packages/agent
docker build -t feedback-agent .
docker run -p 3000:3000 --env-file .env feedback-agent
```

### Webhook

```bash
gh api repos/OWNER/REPO/hooks \
  -f name=web -F active=true \
  -f "config[url]=https://YOUR-AGENT-URL/webhook/github" \
  -f "config[content_type]=json" \
  -f "config[secret]=YOUR_WEBHOOK_SECRET" \
  -f 'events[]=issues'
```

---

## Automated Setup

```bash
npx feedback-chat init            # Interactive wizard (routes, Tailwind, env, labels)
npx feedback-chat deploy-agent    # Generates Railway deployment script
```

Or with [Claude Code](https://claude.ai/code): *"Install @nikitadmitrieff/feedback-chat — I want the +Pipeline tier"*

---

## Customization

```ts
createFeedbackHandler({
  password: string                    // Required
  model?: LanguageModel               // Default: claude-haiku-4-5-20251001
  systemPrompt?: string               // Replaces default prompt
  projectContext?: string             // Injected into default prompt
  github?: { token: string, repo: string, labels?: string[] }
})

createStatusHandler({
  password: string
  github?: { token: string, repo: string }
  agentUrl?: string
})
```

`FeedbackPanel` props: `isOpen: boolean`, `onToggle: () => void`. No other config needed.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Widget unstyled | Add `@source` directive in `globals.css` |
| Widget invisible | Add `import '@nikitadmitrieff/feedback-chat/styles.css'` |
| Build fails on React 19 | `npm install react@latest react-dom@latest` |
| Issues not created | Check `GITHUB_TOKEN` is a PAT (`ghp_`), not OAuth (`gho_`) |
| Pipeline stuck at "queued" | Check agent health, webhook config (Issues events, `content_type=json`) |
| Agent auth error | Run `npm run credentials` (Max) or check `ANTHROPIC_API_KEY` |
| Classification skipped | Set `ANTHROPIC_API_KEY` on the agent — OAuth tokens don't work for direct API calls |
| Webhook 401 on Vercel | Team SSO blocks `*.vercel.app` — use a custom domain |

---

## Contributing

```bash
git clone https://github.com/NikitaDmitrieff/feedback-chat
cd feedback-chat
npm install
npm run build
npm run dev       # watch mode
npm run test      # vitest
```

## License

MIT
