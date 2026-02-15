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
- The agent automatically strips `ANTHROPIC_API_KEY` from the CLI environment when OAuth credentials exist
- Check agent logs for "OAuth token refreshed" messages

## "Request changes" doesn't trigger a retry

The agent looks for comments starting with `**Modifications demandées :**`. This is posted automatically by the widget's status handler. Make sure:
1. The comment was actually posted (check the GitHub issue)
2. The issue has the `auto-implement` label
3. The issue is open (the handler close/reopens it to trigger the webhook)

## Cross-tab pipeline status not syncing

The widget uses `localStorage['feedback_active_pipeline']` + a custom `pipeline-status` event. Both tabs need to be on the same origin.
