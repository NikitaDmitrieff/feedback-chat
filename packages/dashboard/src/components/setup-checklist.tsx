'use client'

import { useState, useTransition } from 'react'
import { Check, ChevronDown, Copy, Loader2, Terminal, AlertCircle, Wand2 } from 'lucide-react'
import { markStepDone, markAllStepsDone } from '@/app/projects/[id]/actions'
import { sileo } from 'sileo'

type StepKey = 'install' | 'env_vars' | 'webhook' | 'labels'

type SetupChecklistProps = {
  projectId: string
  githubRepo: string
  webhookSecret: string
  apiKey?: string
  webhookUrl: string
  agentUrl: string
  setupProgress: Record<string, boolean>
  hasRuns: boolean
}

type StepDef = {
  key: StepKey | 'first_feedback'
  title: string
  manual: boolean
}

const STEPS: StepDef[] = [
  { key: 'install', title: 'Install the widget', manual: true },
  { key: 'env_vars', title: 'Add environment variables', manual: true },
  { key: 'webhook', title: 'Configure GitHub webhook', manual: true },
  { key: 'labels', title: 'Create GitHub labels', manual: true },
  { key: 'first_feedback', title: 'Send your first feedback', manual: false },
]

function isStepComplete(
  key: string,
  progress: Record<string, boolean>,
  hasRuns: boolean,
): boolean {
  if (key === 'first_feedback') return hasRuns
  return !!progress[key]
}

function generateClaudePrompt({
  githubRepo,
  webhookUrl,
  webhookSecret,
  agentUrl,
  apiKey,
}: {
  githubRepo: string
  webhookUrl: string
  webhookSecret: string
  agentUrl: string
  apiKey?: string
}): string {
  const passwordValue = apiKey ?? 'easy'

  return `Install @nikitadmitrieff/feedback-chat (full Pipeline tier) in this Next.js project.

## Before you start — blockers that waste 30+ minutes if missed

1. **Tailwind @source is mandatory** — the widget renders completely unstyled without it (step 3). Tailwind v4 uses \`@source\` in CSS; Tailwind v3 uses the \`content\` array in \`tailwind.config\`.
2. **React 19.1.0 and 19.1.1 are excluded** by \`@ai-sdk/react\` — build will fail (step 1)
3. **FeedbackPanel only accepts \`isOpen\` and \`onToggle\`** — no statusUrl, no apiUrl prop needed (defaults to \`/api/feedback/chat\`)
4. **All 5 env vars are required** — \`ANTHROPIC_API_KEY\`, \`FEEDBACK_PASSWORD\`, \`GITHUB_TOKEN\`, \`GITHUB_REPO\`, \`AGENT_URL\`
5. **\`GITHUB_TOKEN\` must be a PAT (\`ghp_\` prefix)** — do NOT use \`gh auth token\` (returns \`gho_\` OAuth token that expires in ~8h)

## Dashboard credentials (pre-filled — do NOT change these values)
FEEDBACK_PASSWORD=${passwordValue}
GITHUB_REPO=${githubRepo}
AGENT_URL=${agentUrl}

## Steps

### 1. Check React version
Run \`npm ls react\`. If the version is 19.1.0 or 19.1.1, upgrade first:
\`\`\`bash
npm install react@latest react-dom@latest
\`\`\`

### 2. Install dependencies
\`\`\`bash
npm install --save @nikitadmitrieff/feedback-chat @assistant-ui/react @assistant-ui/react-ai-sdk @assistant-ui/react-markdown ai @ai-sdk/anthropic
\`\`\`
**Verify** that all 6 packages appear in \`package.json\` under \`dependencies\`. If any are missing, run the install again with \`--save\`. Without them in \`package.json\`, Vercel builds will fail.

### 3. Configure Tailwind to scan the widget (CRITICAL — widget is unstyled without this)
Find the main CSS file. Run \`find . -name "globals.css" -not -path "*/node_modules/*"\` to locate it.

**If using Tailwind v4** (the CSS file contains \`@import "tailwindcss"\`):
Add this line AFTER the \`@import "tailwindcss"\` line:
\`\`\`css
@source "../node_modules/@nikitadmitrieff/feedback-chat/dist/**/*.js";
\`\`\`

**If using Tailwind v3** (project has \`tailwind.config.js\` or \`tailwind.config.ts\`):
Add to the \`content\` array:
\`\`\`js
"./node_modules/@nikitadmitrieff/feedback-chat/dist/**/*.js"
\`\`\`

### 4. Set environment variables in .env.local
Detect the app directory first: run \`ls app 2>/dev/null || ls src/app 2>/dev/null\` to determine if routes live in \`app/\` or \`src/app/\`.

Check which of these already exist in \`.env.local\` and add any that are missing:
\`\`\`env
ANTHROPIC_API_KEY=<REQUIRED — powers the AI chat. Ask the user if not already set>
FEEDBACK_PASSWORD=${passwordValue}
GITHUB_TOKEN=<REQUIRED — must be a ghp_ PAT from github.com/settings/tokens/new with repo + workflow scopes>
GITHUB_REPO=${githubRepo}
AGENT_URL=${agentUrl}
\`\`\`

### 5. Create chat API route
Create the route in whichever app directory exists (\`app/\` or \`src/app/\`):
File: \`<app-dir>/api/feedback/chat/route.ts\`

\`\`\`ts
import { createFeedbackHandler } from '@nikitadmitrieff/feedback-chat/server'

const handler = createFeedbackHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  github: {
    token: process.env.GITHUB_TOKEN!,
    repo: process.env.GITHUB_REPO!,
  },
})

export const POST = handler.POST
\`\`\`

### 6. Create status API route
File: \`<app-dir>/api/feedback/status/route.ts\`

\`\`\`ts
import { createStatusHandler } from '@nikitadmitrieff/feedback-chat/server'

const handler = createStatusHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  github: {
    token: process.env.GITHUB_TOKEN!,
    repo: process.env.GITHUB_REPO!,
  },
  agentUrl: process.env.AGENT_URL,
})

export const { GET, POST } = handler
\`\`\`

### 7. Create client wrapper component
Create \`components/FeedbackButton.tsx\` (or \`src/components/FeedbackButton.tsx\` if using \`src/\`):

\`\`\`tsx
'use client'
import { useState } from 'react'
import { FeedbackPanel } from '@nikitadmitrieff/feedback-chat'
import '@nikitadmitrieff/feedback-chat/styles.css'

export function FeedbackButton() {
  const [open, setOpen] = useState(false)
  return <FeedbackPanel isOpen={open} onToggle={() => setOpen(!open)} />
}
\`\`\`

### 8. Add to root layout
Import and render \`<FeedbackButton />\` inside \`<body>\` in the root layout (Server Component).

### 9. Create GitHub labels
\`\`\`bash
gh label create feedback-bot --color 0E8A16 --repo ${githubRepo} --force
gh label create auto-implement --color 1D76DB --repo ${githubRepo} --force
gh label create in-progress --color FBCA04 --repo ${githubRepo} --force
gh label create agent-failed --color D93F0B --repo ${githubRepo} --force
gh label create preview-pending --color C5DEF5 --repo ${githubRepo} --force
gh label create rejected --color E4E669 --repo ${githubRepo} --force
\`\`\`

### 10. Configure GitHub webhook
\`\`\`bash
gh api repos/${githubRepo}/hooks \\
  -f name=web -F active=true \\
  -f "config[url]=${webhookUrl}" \\
  -f "config[content_type]=json" \\
  -f "config[secret]=${webhookSecret}" \\
  -f 'events[]=issues'
\`\`\`
IMPORTANT: Use \`-F\` (capital F) for \`active=true\` — lowercase \`-f\` sends the string "true" and GitHub returns 422. The \`config[content_type]=json\` is also required — without it the default is form-urlencoded and the agent returns 415.

## After installation — MUST DO
1. **Restart the dev server** — HMR may not pick up new route files
2. **Verify the browser is on the correct port** — if the dev server started on a new port, make sure the browser tab matches
3. If routes return 404 or the widget shows raw HTML instead of a response, clear the cache: \`rm -rf .next && npm run dev\`
4. If using Next.js 15+ with Turbopack and seeing persistence/panic errors, switch to Webpack: \`npx next dev --turbopack=false\`
5. The password to enter in the widget is: ${passwordValue}`
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-muted transition-colors hover:bg-elevated hover:text-fg"
    >
      {copied ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function CodeBlock({ children, copyText }: { children: string; copyText?: string }) {
  return (
    <div className="relative">
      <div className="absolute right-2 top-2">
        <CopyButton text={copyText ?? children} />
      </div>
      <pre className="code-block pr-20">{children}</pre>
    </div>
  )
}

export function SetupChecklist({
  projectId,
  githubRepo,
  webhookSecret,
  apiKey,
  webhookUrl,
  agentUrl,
  setupProgress,
  hasRuns,
}: SetupChecklistProps) {
  const completedCount = STEPS.filter((s) =>
    isStepComplete(s.key, setupProgress, hasRuns),
  ).length
  const allDone = completedCount === STEPS.length

  // Find first incomplete step, or auto-expand step 2 if apiKey is in URL
  const firstIncomplete = STEPS.findIndex(
    (s) => !isStepComplete(s.key, setupProgress, hasRuns),
  )
  const initialExpanded = apiKey ? 1 : firstIncomplete >= 0 ? firstIncomplete : -1

  const [expandedIndex, setExpandedIndex] = useState(initialExpanded)
  const [progress, setProgress] = useState(setupProgress)
  const [isPending, startTransition] = useTransition()
  const [pendingStep, setPendingStep] = useState<string | null>(null)
  const [showClaudePrompt, setShowClaudePrompt] = useState(false)

  const claudePrompt = generateClaudePrompt({
    githubRepo,
    webhookUrl,
    webhookSecret,
    agentUrl,
    apiKey,
  })

  function handleMarkAllDone() {
    setPendingStep('all')
    startTransition(async () => {
      await markAllStepsDone(projectId)
      setProgress({ install: true, env_vars: true, webhook: true, labels: true })
      setPendingStep(null)
      setShowClaudePrompt(false)
      setExpandedIndex(-1)
      sileo.success({ title: 'Setup complete' })
    })
  }

  function handleMarkDone(key: StepKey) {
    setPendingStep(key)
    startTransition(async () => {
      await markStepDone(projectId, key)
      setProgress((prev) => ({ ...prev, [key]: true }))
      setPendingStep(null)
      const stepTitle = STEPS.find((s) => s.key === key)?.title ?? 'Step'
      sileo.success({ title: `${stepTitle} — done` })
      // Auto-advance to next incomplete step
      const currentIdx = STEPS.findIndex((s) => s.key === key)
      const nextIncomplete = STEPS.findIndex(
        (s, i) => i > currentIdx && !isStepComplete(s.key, { ...progress, [key]: true }, hasRuns),
      )
      setExpandedIndex(nextIncomplete >= 0 ? nextIncomplete : -1)
    })
  }

  function toggleStep(index: number) {
    setExpandedIndex((prev) => (prev === index ? -1 : index))
  }

  // Collapsed state when all done
  if (allDone) {
    return (
      <div className="glass-card mb-8">
        <button
          onClick={() => setExpandedIndex(expandedIndex === -2 ? -1 : -2)}
          className="flex w-full items-center gap-3 px-5 py-3 text-left"
        >
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-success/20">
            <Check className="h-3 w-3 text-success" />
          </div>
          <span className="flex-1 text-sm font-medium text-fg">Setup complete</span>
          <ChevronDown
            className={`h-3.5 w-3.5 text-muted transition-transform ${expandedIndex === -2 ? 'rotate-180' : ''}`}
          />
        </button>
        {expandedIndex === -2 && (
          <div className="space-y-3 border-t border-edge px-5 py-4">
            <SettingsReference webhookUrl={webhookUrl} webhookSecret={webhookSecret} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="glass-card mb-8 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-edge">
        <Terminal className="h-4 w-4 text-muted" />
        <span className="flex-1 text-sm font-medium text-fg">Setup</span>
        <span className="text-xs text-muted tabular-nums">{completedCount}/{STEPS.length}</span>
      </div>

      {/* Claude Code quick setup */}
      <div className="border-b border-edge">
        <button
          onClick={() => setShowClaudePrompt(!showClaudePrompt)}
          className="flex w-full items-center gap-2.5 px-5 py-2.5 text-left transition-colors hover:bg-surface-hover"
        >
          <Wand2 className="h-3.5 w-3.5 text-accent" />
          <span className="flex-1 text-xs font-medium text-fg">Setup with Claude Code</span>
          <ChevronDown
            className={`h-3 w-3 text-muted/50 transition-transform ${showClaudePrompt ? 'rotate-180' : ''}`}
          />
        </button>
        {showClaudePrompt && (
          <div className="space-y-3 px-5 pb-4">
            <p className="text-xs text-muted">
              Copy this prompt and paste it into Claude Code in your project directory.
              It contains all your project credentials and setup instructions.
            </p>
            <div className="relative">
              <div className="absolute right-2 top-2 z-10">
                <CopyButton text={claudePrompt} />
              </div>
              <pre className="code-block max-h-48 overflow-y-auto pr-20 text-[10px] leading-relaxed">
                {claudePrompt}
              </pre>
            </div>
            {!apiKey && (
              <div className="flex items-start gap-2 rounded-lg bg-elevated/50 px-3 py-2">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-muted" />
                <p className="text-[11px] text-muted">
                  The API key placeholder needs to be replaced with the key you saved during project creation.
                </p>
              </div>
            )}
            <button
              onClick={handleMarkAllDone}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-accent transition-all hover:bg-accent/20 disabled:opacity-50"
            >
              {pendingStep === 'all' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              I&apos;ve completed setup
            </button>
          </div>
        )}
      </div>

      {/* Steps */}
      <div className="px-5 py-3">
        <div className="relative">
          {/* Background track */}
          <div className="absolute left-[7.5px] top-3 bottom-3 w-px bg-edge" />

          {/* Progress line */}
          {completedCount > 0 && (
            <div
              className="absolute left-[7.5px] top-3 w-px bg-success/50 transition-all duration-700 ease-out"
              style={{ height: `${Math.max(0, completedCount - 1) * 40 + (completedCount > 0 ? 8 : 0)}px` }}
            />
          )}

          {STEPS.map((step, i) => {
            const done = isStepComplete(step.key, progress, hasRuns)
            const isFirst = i === firstIncomplete && !done
            const expanded = expandedIndex === i

            return (
              <div key={step.key}>
                <button
                  onClick={() => toggleStep(i)}
                  className="relative flex w-full items-center gap-2 h-10 text-left"
                >
                  {/* Dot */}
                  <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                    {done ? (
                      <div className="h-[7px] w-[7px] rounded-full bg-success" />
                    ) : isFirst ? (
                      <div className="h-[7px] w-[7px] rounded-full bg-fg animate-pulse" />
                    ) : (
                      <div className="h-[5px] w-[5px] rounded-full bg-dim/25" />
                    )}
                  </div>

                  {/* Label */}
                  <span
                    className={`flex-1 text-xs ${
                      done ? 'text-muted' : isFirst ? 'text-fg font-medium' : 'text-dim'
                    }`}
                  >
                    {step.title}
                  </span>

                  {/* Chevron */}
                  <ChevronDown
                    className={`h-3 w-3 text-muted/50 transition-transform ${expanded ? 'rotate-180' : ''}`}
                  />
                </button>

                {/* Expanded content */}
                {expanded && (
                  <div className="ml-6 mb-3 space-y-3">
                    <StepContent
                      stepKey={step.key}
                      projectId={projectId}
                      githubRepo={githubRepo}
                      webhookUrl={webhookUrl}
                      webhookSecret={webhookSecret}
                      agentUrl={agentUrl}
                      apiKey={apiKey}
                    />
                    {step.manual && !done && (
                      <button
                        onClick={() => handleMarkDone(step.key as StepKey)}
                        disabled={isPending}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-[11px] font-medium text-fg transition-all hover:border-edge-hover hover:bg-surface-hover disabled:opacity-50"
                      >
                        {pendingStep === step.key ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Check className="h-3 w-3" />
                        )}
                        Mark as done
                      </button>
                    )}
                    {step.key === 'first_feedback' && !done && (
                      <p className="text-[11px] text-dim">
                        This step completes automatically when your first pipeline run appears.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function StepContent({
  stepKey,
  projectId,
  githubRepo,
  webhookUrl,
  webhookSecret,
  agentUrl,
  apiKey,
}: {
  stepKey: string
  projectId: string
  githubRepo: string
  webhookUrl: string
  webhookSecret: string
  agentUrl: string
  apiKey?: string
}) {
  switch (stepKey) {
    case 'install':
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            First, check your React version — <code className="rounded bg-elevated px-1 py-0.5 font-[family-name:var(--font-mono)] text-fg">react@19.1.0</code> and <code className="rounded bg-elevated px-1 py-0.5 font-[family-name:var(--font-mono)] text-fg">19.1.1</code> are excluded by <code className="rounded bg-elevated px-1 py-0.5 font-[family-name:var(--font-mono)] text-fg">@ai-sdk/react</code>. Run <code className="rounded bg-elevated px-1 py-0.5 font-[family-name:var(--font-mono)] text-fg">npm ls react</code> and upgrade if needed.
          </p>
          <p className="text-xs text-muted">Install the widget and its peer dependencies:</p>
          <CodeBlock>
            {`npm install @nikitadmitrieff/feedback-chat \\
  @assistant-ui/react @assistant-ui/react-ai-sdk \\
  @assistant-ui/react-markdown ai @ai-sdk/anthropic`}
          </CodeBlock>
          <p className="text-xs text-muted">
            Then add the Tailwind source directive to your <code className="rounded bg-elevated px-1 py-0.5 font-[family-name:var(--font-mono)] text-fg">globals.css</code>. <strong>Tailwind v4</strong> (after <code className="rounded bg-elevated px-1 py-0.5 font-[family-name:var(--font-mono)] text-fg">@import &quot;tailwindcss&quot;</code>):
          </p>
          <CodeBlock>{`@source "../node_modules/@nikitadmitrieff/feedback-chat/dist/**/*.js";`}</CodeBlock>
          <p className="text-xs text-muted">
            <strong>Tailwind v3</strong> — add to the <code className="rounded bg-elevated px-1 py-0.5 font-[family-name:var(--font-mono)] text-fg">content</code> array in <code className="rounded bg-elevated px-1 py-0.5 font-[family-name:var(--font-mono)] text-fg">tailwind.config.js</code>:
          </p>
          <CodeBlock>{`"./node_modules/@nikitadmitrieff/feedback-chat/dist/**/*.js"`}</CodeBlock>
          <div className="flex items-start gap-2 rounded-lg bg-danger/5 px-3 py-2">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-danger" />
            <p className="text-[11px] text-danger/80">
              Without this directive, the widget renders completely unstyled.
            </p>
          </div>
        </div>
      )

    case 'env_vars':
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            Add to your app&apos;s <code className="rounded bg-elevated px-1 py-0.5 font-[family-name:var(--font-mono)] text-fg">.env.local</code>:
          </p>
          <CodeBlock>
            {`ANTHROPIC_API_KEY=<your Anthropic API key>
FEEDBACK_PASSWORD=${apiKey ?? 'easy'}
GITHUB_TOKEN=<ghp_ PAT with repo + workflow scopes>
GITHUB_REPO=${githubRepo}
AGENT_URL=${agentUrl}`}
          </CodeBlock>
          {apiKey && (
            <div className="flex items-start gap-2 rounded-lg bg-danger/5 px-3 py-2">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-danger" />
              <p className="text-[11px] text-danger/80">
                Save the API key now — it won&apos;t be shown again.
              </p>
            </div>
          )}
          <div className="flex items-start gap-2 rounded-lg bg-elevated/50 px-3 py-2">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-muted" />
            <p className="text-[11px] text-muted">
              <code className="rounded bg-elevated px-1 py-0.5 font-[family-name:var(--font-mono)] text-fg">GITHUB_TOKEN</code> must be a <code className="rounded bg-elevated px-1 py-0.5 font-[family-name:var(--font-mono)] text-fg">ghp_</code> PAT. Tokens from <code className="rounded bg-elevated px-1 py-0.5 font-[family-name:var(--font-mono)] text-fg">gh auth token</code> (<code className="rounded bg-elevated px-1 py-0.5 font-[family-name:var(--font-mono)] text-fg">gho_</code>) expire in ~8h.
            </p>
          </div>
        </div>
      )

    case 'webhook':
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            Go to <code className="rounded bg-elevated px-1 py-0.5 font-[family-name:var(--font-mono)] text-fg">{githubRepo}</code> &rarr; Settings &rarr; Webhooks &rarr; Add webhook:
          </p>
          <CodeBlock>
            {`URL: ${webhookUrl}
Secret: ${webhookSecret}
Content type: application/json
Events: Issues`}
          </CodeBlock>
          <p className="text-xs text-muted">Or run this command:</p>
          <CodeBlock>
            {`gh api repos/${githubRepo}/hooks \\
  -f name=web -F active=true \\
  -f "config[url]=${webhookUrl}" \\
  -f "config[content_type]=json" \\
  -f "config[secret]=${webhookSecret}" \\
  -f 'events[]=issues'`}
          </CodeBlock>
          <div className="flex items-start gap-2 rounded-lg bg-elevated/50 px-3 py-2">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-muted" />
            <p className="text-[11px] text-muted">
              Use <code className="rounded bg-elevated px-1 py-0.5 font-[family-name:var(--font-mono)] text-fg">-F</code> (capital) for <code className="rounded bg-elevated px-1 py-0.5 font-[family-name:var(--font-mono)] text-fg">active=true</code> — lowercase <code className="rounded bg-elevated px-1 py-0.5 font-[family-name:var(--font-mono)] text-fg">-f</code> sends the string &quot;true&quot; and GitHub returns 422.
            </p>
          </div>
        </div>
      )

    case 'labels':
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted">Create the required labels on your repo:</p>
          <CodeBlock>
            {`gh label create feedback-bot --color 0E8A16 --repo ${githubRepo}
gh label create auto-implement --color 1D76DB --repo ${githubRepo}
gh label create in-progress --color FBCA04 --repo ${githubRepo}
gh label create agent-failed --color D93F0B --repo ${githubRepo}
gh label create preview-pending --color C5DEF5 --repo ${githubRepo}
gh label create rejected --color E4E669 --repo ${githubRepo}`}
          </CodeBlock>
        </div>
      )

    case 'first_feedback':
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            Open your app, click the feedback bar at the bottom, and send a message describing
            a change you&apos;d like. The AI will summarize it and create a GitHub issue with the{' '}
            <code className="rounded bg-elevated px-1 py-0.5 font-[family-name:var(--font-mono)] text-fg">feedback-bot</code> label.
          </p>
          <p className="text-xs text-muted">
            Once the agent picks up the issue, your first pipeline run will appear in the table below.
          </p>
        </div>
      )

    default:
      return null
  }
}

function SettingsReference({
  webhookUrl,
  webhookSecret,
}: {
  webhookUrl: string
  webhookSecret: string
}) {
  return (
    <>
      <div className="space-y-1">
        <span className="text-[11px] font-medium text-muted">Webhook URL</span>
        <div className="code-block flex items-start gap-2">
          <code className="min-w-0 flex-1 break-all">{webhookUrl}</code>
        </div>
      </div>
      <div className="space-y-1">
        <span className="text-[11px] font-medium text-muted">Webhook Secret</span>
        <div className="code-block flex items-start gap-2">
          <code className="min-w-0 flex-1 break-all">{webhookSecret}</code>
        </div>
      </div>
    </>
  )
}
