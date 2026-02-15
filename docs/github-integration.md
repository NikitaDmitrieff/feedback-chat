# Tier 2: GitHub Integration

Everything from [Chat only](./chat-only-setup.md) plus automatic GitHub issue creation. When the AI calls `submit_request`, a GitHub issue is created with the generated prompt, labels, and metadata.

## What you get (on top of Tier 1)

- GitHub issue created automatically when user submits feedback
- Issue link shown in chat after submission
- Structured issue body with `## Generated Prompt` code block
- Machine-readable `<!-- agent-meta: {...} -->` comment for automation
- Labels: `feedback-bot`, `auto-implement`

## Setup

Follow all steps from [Chat only setup](./chat-only-setup.md), then modify the chat route:

### Update the chat API route

```ts
import { createFeedbackHandler } from '@nikitadmitrieff/feedback-chat/server'

const handler = createFeedbackHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  github: {
    token: process.env.GITHUB_TOKEN!,
    repo: process.env.GITHUB_REPO!,
  },
})

export const POST = handler.POST
```

### Update the status API route

```ts
import { createStatusHandler } from '@nikitadmitrieff/feedback-chat/server'

const handler = createStatusHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  github: {
    token: process.env.GITHUB_TOKEN!,
    repo: process.env.GITHUB_REPO!,
  },
})

export const { GET, POST } = handler
```

### Environment variables

```env
ANTHROPIC_API_KEY=sk-ant-...
FEEDBACK_PASSWORD=your-password
GITHUB_TOKEN=ghp_...              # Needs 'repo' scope
GITHUB_REPO=owner/repo            # e.g. nikitadmitrieff/my-app
```

## GitHub issue format

When a user submits feedback, the widget creates an issue like this:

```markdown
## Generated Prompt

\`\`\`
Add a dark mode toggle to the navbar. The toggle should...
\`\`\`

## Spec Content

Goal: ...
Tasks: ...

## Metadata

- **Type:** simple
- **Submitted by:** Nikita

<!-- agent-meta: {"prompt_type": "simple", "visitor_name": "Nikita"} -->
```

### Labels applied

- `feedback-bot` — identifies widget-created issues
- `auto-implement` — signals the agent to pick it up (if Tier 3 is enabled)

## Cost

Same as Tier 1 (~$0.01/conversation) + GitHub API calls (free).
