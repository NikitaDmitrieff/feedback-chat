# Customization

## System prompt

### Option 1: Replace entirely

```ts
createFeedbackHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  systemPrompt: 'You are a helpful product advisor for Acme Corp...',
})
```

### Option 2: Inject project context into the default prompt

The default prompt is a feedback advisor that guides users through 2-3 exchanges, then submits a structured request. Use `projectContext` to add app-specific knowledge:

```ts
createFeedbackHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  projectContext: 'This is an e-commerce platform with product pages, cart, and checkout. Tech stack: Next.js 15, Supabase, Stripe.',
})
```

### Option 3: Extend the default prompt

```ts
import { buildDefaultPrompt } from '@nikitadmitrieff/feedback-chat/server'

createFeedbackHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  systemPrompt: buildDefaultPrompt('E-commerce platform') + '\n\nAlways suggest A/B testing for UI changes.',
})
```

### Default prompt behavior

The built-in prompt:
- Understands deeper intent behind vague requests
- Proposes concrete solutions
- Uses `present_options` tool for choices (clickable chips, NOT numbered lists)
- Avoids technical jargon (no "component", "API", "database")
- Keeps conversations to 2-3 exchanges before submission
- Generates prompts always in English (for developer consumption)
- Supports two prompt types:
  - `simple`: clear description + relevant files + expected outcome
  - `ralph_loop`: high-level + spec with Goal, numbered Tasks, Acceptance Criteria

## AI model

Any AI SDK-compatible model works. Default is Haiku (~$0.01/conversation):

```ts
import { createAnthropic } from '@ai-sdk/anthropic'

// Use Sonnet for higher quality
createFeedbackHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  model: createAnthropic()('claude-sonnet-4-5-20250929'),
})
```

```ts
// Use any provider
import { createOpenAI } from '@ai-sdk/openai'

createFeedbackHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  model: createOpenAI()('gpt-4o'),
})
```

## Extra GitHub labels

Add custom labels to every issue created by the widget:

```ts
createFeedbackHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  github: {
    token: process.env.GITHUB_TOKEN!,
    repo: process.env.GITHUB_REPO!,
    labels: ['enhancement', 'user-feedback'],  // added on top of feedback-bot + auto-implement
  },
})
```

## Agent commands

Customize what the agent runs in the cloned repo:

```env
AGENT_INSTALL_CMD=bun install        # Use bun instead of npm
AGENT_BUILD_CMD=bun run build
AGENT_LINT_CMD=bun run lint
```

## Env forwarding

Control which env vars the agent writes to `.env.local` in the cloned repo:

```env
# Default: only NEXT_PUBLIC_* vars
AGENT_ENV_FORWARD=NEXT_PUBLIC_*

# Forward specific vars too
AGENT_ENV_FORWARD=NEXT_PUBLIC_*,DATABASE_URL,STRIPE_SECRET_KEY
```

## Timeouts

```env
AGENT_CLAUDE_TIMEOUT_MS=1200000   # 20 minutes for Claude CLI
AGENT_JOB_BUDGET_MS=2400000       # 40 minutes total per job
```

## CSS isolation

The widget CSS is scoped under `.feedback-panel` — it won't affect your app's styles. The dark glassmorphism theme is self-contained in `styles.css`. Do not override it with consumer styles.
