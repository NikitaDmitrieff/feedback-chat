# API Reference

## Package exports

```
@nikitadmitrieff/feedback-chat          → Client components + hooks
@nikitadmitrieff/feedback-chat/server   → Server route factories
@nikitadmitrieff/feedback-chat/styles.css → Dark glassmorphism styles
```

---

## Server: `@nikitadmitrieff/feedback-chat/server`

### createFeedbackHandler(config)

Creates a Next.js App Router POST handler for the chat endpoint.

```ts
import { createFeedbackHandler } from '@nikitadmitrieff/feedback-chat/server'

const handler = createFeedbackHandler({
  // Required
  password: string,

  // Optional: AI model (default: claude-haiku-4-5-20251001)
  model?: LanguageModel,

  // Optional: replace the entire system prompt
  systemPrompt?: string,

  // Optional: inject context into the default prompt
  projectContext?: string,

  // Optional: enable GitHub issue creation
  github?: {
    token: string,
    repo: string,        // "owner/name" format
    labels?: string[],   // extra labels beyond feedback-bot + auto-implement
  },
})

export const POST = handler.POST
```

**Request format:**

```json
{
  "messages": [],           // UIMessage[] from AI SDK
  "password": "secret"      // validated against config.password
}
```

- Empty `messages` array = password check only (returns 200)
- Non-empty = streams AI response via `toUIMessageStreamResponse()`
- Stops after 2 tool calls via `stepCountIs(2)`
- Returns 401 if password is wrong

### createStatusHandler(config)

Creates GET and POST handlers for pipeline status tracking.

```ts
import { createStatusHandler } from '@nikitadmitrieff/feedback-chat/server'

const handler = createStatusHandler({
  // Required
  password: string,

  // Optional: GitHub integration (for reading labels, PRs, comments)
  github?: {
    token: string,
    repo: string,
  },

  // Optional: agent URL for health check polling
  agentUrl?: string,
})

export const { GET, POST } = handler
```

**GET /api/feedback/status?issue=N**

Returns the current pipeline stage derived from GitHub issue state:

```ts
type StatusResponse = {
  stage: Stage
  issueNumber: number
  issueUrl: string
  failReason?: string      // from "Agent failed: ..." comment
  previewUrl?: string      // Vercel deployment URL
  prNumber?: number
  prUrl?: string
  activity?: ActivityEntry[] // up to 3 recent issue comments
}

type Stage =
  | 'created'
  | 'queued'
  | 'running'
  | 'validating'
  | 'preview_ready'
  | 'deployed'
  | 'failed'
  | 'rejected'

type ActivityEntry = {
  body: string
  created_at: string
}
```

**Stage derivation logic:**

1. Has `agent-failed` label → `failed`
2. Has `rejected` label → `rejected`
3. Issue is closed → `deployed`
4. Agent health endpoint shows job running → `running`
5. Has `preview-pending` label + PR + preview URL → `preview_ready`
6. Has `preview-pending` label but no preview → `validating`
7. Has `in-progress` label → `validating`
8. Has `feedback-bot` label → `queued`
9. Default → `created`

**POST /api/feedback/status?issue=N&action=ACTION**

```json
{
  "password": "secret",
  "comment": "optional feedback text"
}
```

| Action | What it does |
|--------|-------------|
| `retry` | Removes `agent-failed`/`in-progress` labels, close/reopen issue |
| `approve` | Merges PR (squash), closes issue, deletes feedback branch |
| `reject` | Closes PR, adds `rejected` label, closes issue, deletes branch |
| `request_changes` | Posts comment, removes `preview-pending`, adds `auto-implement`, close/reopen |

### buildDefaultPrompt(projectContext?)

Returns the default system prompt string. Useful if you want to extend rather than replace it:

```ts
import { buildDefaultPrompt } from '@nikitadmitrieff/feedback-chat/server'

const handler = createFeedbackHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  systemPrompt: buildDefaultPrompt('This is an e-commerce app') + '\n\nAlways suggest A/B testing.',
})
```

### createTools(createIssue?)

Returns the AI SDK tool definitions (`present_options` and `submit_request`). Rarely needed directly — `createFeedbackHandler` uses it internally.

### createGitHubIssue(params)

Low-level function for creating issues. Falls back to `GITHUB_TOKEN` and `GITHUB_REPO` env vars:

```ts
import { createGitHubIssue } from '@nikitadmitrieff/feedback-chat/server'

const url = await createGitHubIssue({
  title: 'Add dark mode',
  body: '## Generated Prompt\n```\n...\n```',
  labels: ['feedback-bot', 'auto-implement'],
})
```

---

## Client: `@nikitadmitrieff/feedback-chat`

### FeedbackPanel

Main widget component. Must be in a `'use client'` component.

```tsx
import { FeedbackPanel } from '@nikitadmitrieff/feedback-chat'
import '@nikitadmitrieff/feedback-chat/styles.css'

<FeedbackPanel
  isOpen={boolean}            // Controls panel visibility
  onToggle={() => void}       // Called when user opens/closes
  apiUrl?: string             // Default: '/api/feedback/chat'
/>
```

Features:
- Password gate (stored in `sessionStorage['feedback_password']`)
- Bottom-center trigger bar with composer input
- 400px side panel sliding from right
- Click outside to close
- Green pulsing dot when pipeline is active
- Multi-conversation tabs (browser-style)

### useConversations()

Hook for multi-conversation state management.

```ts
import { useConversations } from '@nikitadmitrieff/feedback-chat'

const {
  conversations,   // Conversation[] (sorted by createdAt desc, max 10)
  activeId,        // Current conversation ID
  switchTo,        // (id: string) => void
  create,          // () => void — saves current, creates new
  remove,          // (id: string) => void
  save,            // () => void — manual save
} = useConversations()
```

```ts
type Conversation = {
  id: string          // UUID
  title: string       // Auto-generated from first user message (max 40 chars)
  createdAt: string   // ISO timestamp
  updatedAt: string
}
```

### PipelineTracker

Standalone pipeline progress component. Used internally by `SubmitRequestToolUI` but can be used independently:

```tsx
import { PipelineTracker } from '@nikitadmitrieff/feedback-chat'

<PipelineTracker
  issueUrl={string}             // GitHub issue URL (e.g. "https://github.com/owner/repo/issues/42")
  statusEndpoint?: string       // Default: '/api/feedback/status'
/>
```

Polls status endpoint every 5s (15s during `preview_ready`). Shows approve/reject/request changes buttons at `preview_ready` stage.

---

## Types

All types are exported from both the main and server entry points:

```ts
import type { Stage, StatusResponse, Conversation, FeedbackPanelProps } from '@nikitadmitrieff/feedback-chat'
// or
import type { Stage, StatusResponse, FeedbackHandlerConfig, StatusHandlerConfig } from '@nikitadmitrieff/feedback-chat/server'
```
