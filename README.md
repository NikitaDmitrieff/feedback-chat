# feedback-chat

AI-powered feedback chatbot that turns user ideas into code — from chat to PR, fully automated.

```
User submits idea → AI chat refines it → GitHub issue → Claude Code agent implements → PR opened → preview deployed → user approves in widget
```

## Architecture

```
┌─────────────────────────────────────┐
│  Your Next.js App                   │
│                                     │
│  <FeedbackPanel />                  │
│  import '@feedback-chat/styles.css' │
│                                     │
│  API routes (one-liner exports):    │
│    /api/feedback/chat               │
│    /api/feedback/status             │
└──────────────┬──────────────────────┘
               │
     GitHub Issues + Labels
               │
               ▼
┌──────────────────────────────────────┐
│  Agent Service (Railway/Docker)      │
│                                      │
│  Fastify server + GitHub webhook     │
│  Clone → Claude CLI → Validate → PR │
│  OAuth token refresh (Max sub)       │
│  Vercel preview via GitHub deploy    │
└──────────────────────────────────────┘
```

## Quick Start

### 1. Install

```bash
npm install @feedback-chat/widget
```

### 2. Run the setup wizard

```bash
npx feedback-chat init
```

This creates your API routes and configures `.env.local`.

### 3. Add to your layout

```tsx
import { FeedbackPanel } from '@feedback-chat/widget'
import '@feedback-chat/widget/styles.css'

export default function Layout({ children }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {children}
      <FeedbackPanel isOpen={open} onToggle={() => setOpen(v => !v)} />
    </>
  )
}
```

## Three Tiers

| Tier | What you get | Setup |
|------|-------------|-------|
| **Chat only** | AI conversations, localStorage persistence | API key + password |
| **+ GitHub** | Issues created automatically, link shown in chat | + GitHub token/repo |
| **+ Pipeline** | Agent writes code → PR → preview → approve/reject in widget | + Claude Max OAuth + Railway |

## Configuration

### Server — Route handler factory

```ts
// Minimal — one required field
createFeedbackHandler({
  password: process.env.FEEDBACK_PASSWORD!,
})

// Full config
createFeedbackHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  model: anthropic('claude-haiku-4-5-20251001'),
  systemPrompt: 'Your custom prompt...',
  github: {
    token: process.env.GITHUB_TOKEN!,
    repo: process.env.GITHUB_REPO!,
  },
})
```

### Client — Zero config by default

```tsx
<FeedbackPanel isOpen={open} onToggle={() => setOpen(v => !v)} />

// With overrides:
<FeedbackPanel
  isOpen={open}
  onToggle={() => setOpen(v => !v)}
  apiUrl="/api/feedback/chat"
/>
```

### Agent — Environment variables

```env
# Required
GITHUB_TOKEN=ghp_...
GITHUB_REPO=owner/repo
WEBHOOK_SECRET=random-secret

# Claude authentication (choose one)
CLAUDE_CREDENTIALS_JSON=   # Max subscription (recommended, $0/run)
ANTHROPIC_API_KEY=         # API key fallback (pay per token)

# Optional
AGENT_INSTALL_CMD=npm ci
AGENT_BUILD_CMD=npm run build
AGENT_LINT_CMD=npm run lint
```

## Cost

| Component | Cost | Auth method |
|-----------|------|-------------|
| Chat (Haiku) | ~$0.01/conversation | `ANTHROPIC_API_KEY` |
| Code agent | $0/implementation | Claude Max OAuth |
| Railway | ~$5/month (sleeps when idle) | Railway token |
| Vercel previews | Free (hobby) or included in Pro | Existing Vercel setup |

**If you have Claude Max ($200/mo), you get unlimited feedback-to-code automation for the cost of a ~$5/mo Railway instance.**

## Self-Hosting the Agent

The agent service lives in `packages/agent/`. Deploy it anywhere that runs Docker:

### Railway (recommended)

1. Fork this repo
2. Create a new Railway project from the `packages/agent/` directory
3. Set the environment variables (see `packages/agent/.env.example`)
4. Create a GitHub webhook pointing to `https://your-app.railway.app/webhook/github`

### Docker

```bash
cd packages/agent
docker build -t feedback-agent .
docker run -p 3000:3000 --env-file .env feedback-agent
```

## Customization

### System prompt

Pass a custom `systemPrompt` to `createFeedbackHandler()`:

```ts
createFeedbackHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  systemPrompt: 'You are a helpful product advisor for Acme Corp...',
})
```

Or use `projectContext` to inject app-specific context into the default prompt:

```ts
createFeedbackHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  projectContext: 'This is an e-commerce platform with product pages, cart, and checkout.',
})
```

### AI model

Any AI SDK-compatible model works:

```ts
import { createAnthropic } from '@ai-sdk/anthropic'

createFeedbackHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  model: createAnthropic()('claude-sonnet-4-5-20250929'),
})
```

## Conventions (fixed)

These are standardized by the package — convention over configuration:

- **Branch naming:** `feedback/issue-{N}`
- **GitHub labels:** `feedback-bot`, `auto-implement`, `in-progress`, `agent-failed`, `preview-pending`, `rejected`
- **Issue format:** `## Generated Prompt` code block + `<!-- agent-meta: {...} -->` HTML comment
- **localStorage keys:** `feedback_conversations`, `feedback_conv_{id}`, `feedback_active_conv`

## Contributing

```bash
git clone https://github.com/NikitaDmitrieff/feedback-chat
cd feedback-chat
npm install
npm run build    # Build all packages
npm run dev      # Watch mode
npm run test     # Run tests
```

### Project structure

```
feedback-chat/
├── packages/
│   ├── widget/    ← npm package (@feedback-chat/widget)
│   │   └── src/
│   │       ├── client/   ← React components + hooks
│   │       ├── server/   ← Route handler factories
│   │       └── cli/      ← npx setup wizard
│   └── agent/     ← Deployable service
│       └── src/   ← Fastify server + Claude CLI worker
├── turbo.json
└── package.json
```

## Peer Dependencies

```json
{
  "react": "^18 || ^19",
  "react-dom": "^18 || ^19",
  "next": ">=14",
  "@assistant-ui/react": ">=0.12",
  "@assistant-ui/react-ai-sdk": ">=1.3",
  "@assistant-ui/react-markdown": ">=0.12",
  "ai": ">=6",
  "@ai-sdk/anthropic": ">=1"
}
```

## License

MIT
