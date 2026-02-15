# Quick Start

feedback-chat has **3 tiers** — pick the one that matches your needs:

| Tier | What you get | Required env vars |
|------|-------------|-------------------|
| **Chat only** | AI conversations in a side panel, localStorage persistence | `ANTHROPIC_API_KEY`, `FEEDBACK_PASSWORD` |
| **+ GitHub** | Chat + automatic GitHub issue creation with link shown in chat | + `GITHUB_TOKEN`, `GITHUB_REPO` |
| **+ Pipeline** | Chat + GitHub + autonomous agent writes code → PR → preview → approve/reject in widget | + `CLAUDE_CREDENTIALS_JSON` or `ANTHROPIC_API_KEY` (agent), `AGENT_URL`, Railway/Docker deployment |

## Installation

### Option A: Let Claude install it

If you use Claude Code, just say:

> Install @nikitadmitrieff/feedback-chat in my app

Claude will install the package, create API routes, configure Tailwind, and add the component.

### Option B: CLI wizard

```bash
npx feedback-chat init
```

Detects your Next.js app structure, prompts for env vars, creates routes, and patches your CSS.

### Option C: Manual setup

```bash
npm install @nikitadmitrieff/feedback-chat \
  @assistant-ui/react @assistant-ui/react-ai-sdk @assistant-ui/react-markdown \
  ai @ai-sdk/anthropic
```

Then follow one of the tier-specific guides:

- [Chat only setup](./chat-only-setup.md)
- [GitHub integration](./github-integration.md)
- [Pipeline setup](./pipeline-setup.md)

## React version note

If you're on React 19, you need `react@>=19.1.2` (not 19.1.0 or 19.1.1). The AI SDK's `@ai-sdk/react` intentionally excludes those versions:

```bash
npm install react@latest react-dom@latest
```

## Peer dependencies

```json
{
  "react": "^18 || ^19 (19.1.2+ if on React 19)",
  "react-dom": "^18 || ^19",
  "next": ">=14",
  "@assistant-ui/react": ">=0.12",
  "@assistant-ui/react-ai-sdk": ">=1.3",
  "@assistant-ui/react-markdown": ">=0.12",
  "ai": ">=6",
  "@ai-sdk/anthropic": ">=1"
}
```
