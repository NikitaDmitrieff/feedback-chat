# Troubleshooting

## Widget renders unstyled / broken layout

**Cause:** Tailwind v4 excludes `node_modules` from automatic content detection, so the widget's utility classes aren't generated.

**Fix:** Add to your `globals.css` (after `@import "tailwindcss"`):

```css
@source "../node_modules/@nikitadmitrieff/feedback-chat/dist/**/*.js";
```

## `Tooltip must be used within TooltipProvider`

**Cause:** Versions `<=0.1.1` didn't wrap the component tree with `TooltipProvider`.

**Fix:** Update the package: `npm install @nikitadmitrieff/feedback-chat@latest`

## npm peer dependency warnings about React

**Cause:** `@ai-sdk/react` intentionally excludes `react@19.1.0` and `19.1.1` due to known issues.

**Fix:** Update React: `npm install react@latest react-dom@latest`

## Widget is invisible / doesn't appear

Make sure you imported the styles:

```tsx
import '@nikitadmitrieff/feedback-chat/styles.css'
```

And that `FeedbackPanel` is in a `'use client'` component.

## 401 errors on chat

Check that `FEEDBACK_PASSWORD` in `.env.local` matches what you enter in the widget's password gate.

## GitHub issues not created

1. Ensure both `GITHUB_TOKEN` and `GITHUB_REPO` are set in `.env.local`
2. Pass them to `createFeedbackHandler`:

```ts
createFeedbackHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  github: {
    token: process.env.GITHUB_TOKEN!,
    repo: process.env.GITHUB_REPO!,
  },
})
```

## Pipeline stuck at "queued"

- Check that the agent is running: `curl https://your-agent.railway.app/health`
- Check that the GitHub webhook is configured correctly (Issues events, correct secret)
- Check agent logs for webhook signature verification errors

## Pipeline stuck at "validating"

- The agent is building and linting. Check agent logs for build errors
- If it's been more than 25 minutes, the job budget may have been exceeded — check for `agent-failed` label

## Agent fails with build errors

The agent attempts auto-fix (up to 2 rounds). If it still fails:
1. Check the error comment on the GitHub issue
2. Fix the underlying issue in your codebase
3. Click "Retry" in the widget

## Agent uses API key instead of Max subscription

- Set `CLAUDE_CREDENTIALS_JSON` env var on the agent
- The agent reads the OAuth access token and passes it as `CLAUDE_CODE_OAUTH_TOKEN` to the CLI
- `ANTHROPIC_API_KEY` is stripped from the CLI environment when OAuth credentials exist
- Check agent logs for `[oauth] Token valid` or `[oauth] Token refreshed` messages

## Agent fails: "git: not found"

The Dockerfile must install git in the runtime stage. The shipped Dockerfile already does this — if you're using a custom Dockerfile, add:
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates && rm -rf /var/lib/apt/lists/*
```

## Agent fails: "--dangerously-skip-permissions cannot be used with root"

The Docker container must run as a non-root user. The shipped Dockerfile creates an `agent` user. If using a custom Dockerfile:
```dockerfile
RUN useradd -m -s /bin/bash agent
RUN chown -R agent:agent /app /tmp
USER agent
```

## Agent fails: "Not logged in" or "Invalid API key" with Max OAuth

The agent uses `CLAUDE_CODE_OAUTH_TOKEN` (not the credentials file) to authenticate in headless Docker. Ensure:
1. `CLAUDE_CREDENTIALS_JSON` is set on the agent service
2. The Dockerfile includes: `RUN echo '{"hasCompletedOnboarding":true}' > /home/agent/.claude.json`
3. Check agent logs for `[oauth] Token valid` or `[oauth] Token refreshed` messages

See [anthropics/claude-code#8938](https://github.com/anthropics/claude-code/issues/8938) for the onboarding workaround.

## Webhook returns 415 (Unsupported Media Type)

The webhook was created with `application/x-www-form-urlencoded` content type instead of `application/json`. Fix it:
```bash
gh api repos/OWNER/REPO/hooks/HOOK_ID --method PATCH \
  -f "config[content_type]=json" \
  -f "config[url]=https://your-agent.railway.app/webhook/github" \
  -f "config[secret]=YOUR_WEBHOOK_SECRET"
```

When creating webhooks via `gh api`, always use `config[content_type]=json`.

## GitHub issues silently not created

Check if `GITHUB_TOKEN` starts with `gho_` — these are short-lived GitHub OAuth tokens that expire after ~8 hours. Replace with a PAT (`ghp_` prefix) from [github.com/settings/tokens/new](https://github.com/settings/tokens/new) with `repo` + `workflow` scopes.

## "Request changes" doesn't trigger a retry

The agent looks for comments starting with `**Modifications demandées :**`. This is posted automatically by the widget's status handler. Make sure:
1. The comment was actually posted (check the GitHub issue)
2. The issue has the `auto-implement` label
3. The issue is open (the handler close/reopens it to trigger the webhook)

## Cross-tab pipeline status not syncing

The widget uses `localStorage['feedback_active_pipeline']` + a custom `pipeline-status` event. Both tabs need to be on the same origin.

## Railway: "No service linked" error

**Cause:** You tried to run `railway variables set` before linking a service. The Railway CLI requires a service to be created and linked first.

**Fix:** Follow this order:
1. `railway init` — create project
2. `railway up --detach` — deploy (this creates the service)
3. `railway service status --all` — find the service name
4. `railway service link <name>` — link it
5. Now `railway variables set` will work

## Railway: webhook URL invalid (422 from GitHub)

**Cause:** `railway domain` outputs decorated text like `Service Domain created: 🚀 https://...`. If you copy the full output, the URL contains invisible characters or emoji.

**Fix:** Extract the clean URL:
```bash
railway domain 2>&1 | grep -oE 'https://[^ ]+'
```

## `gh auth token` gives a short-lived token

**Cause:** `gh auth token` returns a `gho_` OAuth token that expires after ~8 hours. This is NOT a Personal Access Token.

**Fix:** Do not use `gh auth token` for `GITHUB_TOKEN`. Generate a PAT (`ghp_` prefix) at [github.com/settings/tokens/new](https://github.com/settings/tokens/new) with `repo` + `workflow` scopes. PATs don't expire (unless you set an expiry).

## Turbopack cache corruption (Next.js 15+)

**Cause:** Turbopack's persistent cache can corrupt after installing new dependencies or modifying `.env.local` while the dev server is running. Symptoms include:
- Routes returning unexpected 404 errors
- `thread 'tokio-runtime-worker' panicked` in terminal output
- `Persisting failed: Failed to compact database` errors
- `Unable to open static sorted file` errors

**Fix:**
```bash
rm -rf .next
npx next dev --turbopack=false
```

Using Webpack (`--turbopack=false`) avoids the cache corruption entirely. If you prefer Turbopack, stop the dev server before changing `.env.local` or installing packages, then clear `.next/` and restart.

## Widget shows raw HTML instead of chat response

**Cause:** The browser is connected to a dev server on a different port than the one that has the feedback routes. This happens when the dev server restarts on a new port after installation.

**Fix:**
1. Check which port the dev server is running on (terminal output)
2. Make sure the browser tab matches that port
3. If unsure, close all dev server instances and restart: `npm run dev`

## Routes return 404 after installing the widget

**Cause:** HMR may not pick up newly created route files, especially with Turbopack.

**Fix:**
1. Stop the dev server (Ctrl+C)
2. Clear the cache: `rm -rf .next`
3. Restart: `npm run dev`
