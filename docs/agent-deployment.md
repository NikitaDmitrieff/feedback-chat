# Agent Deployment

The agent service lives in `packages/agent/`. It's a Fastify server that receives GitHub webhooks and uses Claude Code CLI to implement feedback.

## Architecture

```
GitHub webhook (issue opened/reopened)
  → Verify HMAC-SHA256 signature
  → Check labels (needs 'feedback-bot')
  → Add to queue (max 5 jobs)
  → Process sequentially:
      1. Parse issue body (extract prompt)
      2. Clone repo (shallow)
      3. Install dependencies
      4. Run Claude Code CLI with prompt
      5. Build + lint validation
      6. Auto-fix loop (up to 2 attempts)
      7. Create branch + PR
      8. Mark as preview-pending
```

## Railway (recommended)

1. Fork the feedback-chat repo
2. Create a new Railway project from the `packages/agent/` directory
3. Set all environment variables (see below)
4. Create a GitHub webhook:
   - **URL:** `https://your-app.railway.app/webhook/github`
   - **Content type:** `application/json`
   - **Secret:** same as `WEBHOOK_SECRET`
   - **Events:** Issues only

## Docker

```bash
cd packages/agent
docker build -t feedback-agent .
docker run -p 3000:3000 --env-file .env feedback-agent
```

## Environment variables

### Required

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub token with `repo` + `workflow` scopes |
| `GITHUB_REPO` | Target repository (`owner/name`) |
| `WEBHOOK_SECRET` | Random string for webhook HMAC verification |

### Authentication (choose one)

| Variable | Description |
|----------|-------------|
| `CLAUDE_CREDENTIALS_JSON` | Claude Max OAuth credentials (JSON string) — **$0/run** |
| `ANTHROPIC_API_KEY` | API key fallback — pay per token |

Using Claude Max is recommended. The agent strips `ANTHROPIC_API_KEY` from the CLI environment when OAuth credentials exist, so the CLI uses your Max subscription.

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_INSTALL_CMD` | `npm ci` | Install command |
| `AGENT_BUILD_CMD` | `npm run build` | Build command |
| `AGENT_LINT_CMD` | `npm run lint` | Lint command |
| `AGENT_CLAUDE_TIMEOUT_MS` | `900000` (15 min) | Claude CLI timeout |
| `AGENT_JOB_BUDGET_MS` | `1500000` (25 min) | Total job time budget |
| `AGENT_ENV_FORWARD` | `NEXT_PUBLIC_*` | Comma-separated env var patterns to forward to cloned repo |
| `PORT` | `3000` | Fastify server port |

### Env forwarding patterns

`AGENT_ENV_FORWARD` supports glob patterns. The agent writes matching env vars to `.env.local` in the cloned repo:

```env
# Forward all NEXT_PUBLIC_ vars + a specific one
AGENT_ENV_FORWARD=NEXT_PUBLIC_*,DATABASE_URL
```

## Health endpoint

**GET /health**

```json
{
  "status": "ok",
  "currentJob": 42,       // issue number or null
  "queueLength": 1
}
```

The widget's status handler polls this to determine the `running` stage.

## Job workflow detail

### 1. Parse issue

Extracts the generated prompt from `## Generated Prompt` code block. Also reads `<!-- agent-meta: {...} -->` for metadata (prompt type, visitor name).

### 2. Clone + install

Shallow clone via `git clone --depth=1` using the GitHub token. Runs the install command.

### 3. Pre-lint check

Runs lint before Claude to detect pre-existing errors. If there are failures, they're included in the Claude prompt as context.

### 4. Retry detection

Checks the 5 most recent issue comments for `**Modifications demandées :**` (posted by the "request changes" action). If found, appends the user's feedback to the prompt.

### 5. Claude Code CLI

Runs `claude --dangerously-skip-permissions -p '{prompt}'`. Uses Max OAuth if available, API key fallback otherwise.

### 6. Validation loop

After Claude finishes:
1. Run build command
2. If build fails → post error, mark `agent-failed`
3. If build succeeds → lint changed files
4. If lint fails → attempt auto-fix (up to 2 rounds):
   - Round 1: `eslint --fix` on changed files
   - Round 2: Ask Claude to fix the errors
5. If still failing after 2 rounds → mark `agent-failed`

### 7. Create PR

- Branch: `feedback/issue-{N}`
- Commit: `feat: {title} (auto-implemented from #{N})`
- Force-pushes to handle retries
- PR body includes `Closes #{N}`

### 8. Mark preview-pending

Removes `in-progress` label, adds `preview-pending`. Vercel (or your CI) deploys a preview from the PR branch automatically.

## OAuth token management

The agent automatically refreshes Claude Max OAuth tokens before each job:
- Reads from `~/.claude/.credentials.json`
- Checks if token expires within 5 minutes
- If expiring: calls Anthropic OAuth endpoint with refresh token
- Updates credentials file

Initial credentials come from `CLAUDE_CREDENTIALS_JSON` env var (JSON string from the Max OAuth flow).

## GitHub labels managed by the agent

| Label | Meaning |
|-------|---------|
| `feedback-bot` | Issue created by widget |
| `auto-implement` | Agent should process this |
| `in-progress` | Agent is currently working |
| `agent-failed` | Build/lint/validation failed |
| `preview-pending` | PR ready, awaiting preview deployment |
| `rejected` | User rejected changes |
