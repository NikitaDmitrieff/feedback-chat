'use client'

import { useState, useTransition } from 'react'
import { Check, ChevronDown, Copy, Loader2, Terminal, AlertCircle } from 'lucide-react'
import { markStepDone } from '@/app/projects/[id]/actions'

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

  function handleMarkDone(key: StepKey) {
    setPendingStep(key)
    startTransition(async () => {
      await markStepDone(projectId, key)
      setProgress((prev) => ({ ...prev, [key]: true }))
      setPendingStep(null)
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
          <p className="text-xs text-muted">Install the widget and its peer dependencies:</p>
          <CodeBlock>
            {`npm install @nikitadmitrieff/feedback-chat \\
  @assistant-ui/react @assistant-ui/react-ai-sdk \\
  @assistant-ui/react-markdown ai @ai-sdk/anthropic`}
          </CodeBlock>
          <p className="text-xs text-muted">
            Then add the Tailwind v4 source directive to your <code className="rounded bg-elevated px-1 py-0.5 font-[family-name:var(--font-mono)] text-fg">globals.css</code>:
          </p>
          <CodeBlock>{`@source "../node_modules/@nikitadmitrieff/feedback-chat/dist/**/*.js";`}</CodeBlock>
        </div>
      )

    case 'env_vars':
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            Add to your app&apos;s <code className="rounded bg-elevated px-1 py-0.5 font-[family-name:var(--font-mono)] text-fg">.env.local</code>:
          </p>
          <CodeBlock>
            {`AGENT_URL=${agentUrl}
FEEDBACK_CHAT_API_KEY=${apiKey ?? 'fc_live_...'}`}
          </CodeBlock>
          {apiKey && (
            <div className="flex items-start gap-2 rounded-lg bg-danger/5 px-3 py-2">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-danger" />
              <p className="text-[11px] text-danger/80">
                Save the API key now — it won&apos;t be shown again.
              </p>
            </div>
          )}
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
  -f name=web -f active=true \\
  -f "config[url]=${webhookUrl}" \\
  -f "config[content_type]=json" \\
  -f "config[secret]=${webhookSecret}" \\
  -f 'events[]=issues'`}
          </CodeBlock>
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
