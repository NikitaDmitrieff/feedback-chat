'use client'

import { useState, useEffect, useCallback, useTransition } from 'react'
import { Github, Loader2, Check, ExternalLink, AlertCircle, Zap } from 'lucide-react'
import { sileo } from 'sileo'
import { createClient } from '@/lib/supabase/client'
import { triggerSetup, resetSetupStatus } from '@/app/projects/[id]/actions'
import type { SetupStatus } from '@/lib/types'

type Props = {
  projectId: string
  githubRepo: string
  installationId: number | null
  initialStatus: SetupStatus
  initialPrUrl: string | null
  initialError: string | null
}

const STAGES: { key: SetupStatus; label: string }[] = [
  { key: 'queued', label: 'Waiting for worker' },
  { key: 'cloning', label: 'Cloning repository' },
  { key: 'generating', label: 'Generating setup files' },
  { key: 'committing', label: 'Creating pull request' },
]

const ACTIVE_STATUSES: SetupStatus[] = ['queued', 'cloning', 'generating', 'committing']

export function SetupWizard({ projectId, githubRepo, installationId, initialStatus, initialPrUrl, initialError }: Props) {
  const [status, setStatus] = useState<SetupStatus>(initialStatus)
  const [prUrl, setPrUrl] = useState<string | null>(initialPrUrl)
  const [error, setError] = useState<string | null>(initialError)
  const [isPending, startTransition] = useTransition()

  // Poll for status updates during active setup
  useEffect(() => {
    if (!ACTIVE_STATUSES.includes(status)) return

    const supabase = createClient()
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('projects')
        .select('setup_status, setup_pr_url, setup_error')
        .eq('id', projectId)
        .single()

      if (data) {
        setStatus(data.setup_status as SetupStatus)
        if (data.setup_pr_url) setPrUrl(data.setup_pr_url)
        if (data.setup_error) setError(data.setup_error)
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [status, projectId])

  const handleConnect = useCallback(() => {
    window.location.href = `/api/github-app/install?projectId=${projectId}`
  }, [projectId])

  const handleSetup = useCallback(() => {
    startTransition(async () => {
      const result = await triggerSetup(projectId)
      if (result.error) {
        sileo.error({ title: result.error })
        return
      }
      setStatus('queued')
      setError(null)
    })
  }, [projectId])

  const handleRetry = useCallback(() => {
    startTransition(async () => {
      await resetSetupStatus(projectId)
      setStatus('installing')
      setError(null)
      setPrUrl(null)
    })
  }, [projectId])

  // --- Not connected ---
  if (!installationId && status === 'pending') {
    return (
      <div className="mb-8">
        <div className="glass-card flex flex-col items-center px-8 py-10 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent/10">
            <Github className="h-5 w-5 text-accent" />
          </div>
          <h2 className="text-sm font-medium text-fg">Connect GitHub</h2>
          <p className="mt-1.5 max-w-xs text-xs text-muted">
            Link your repository to auto-install the feedback widget.
            We&apos;ll create a PR with everything configured.
          </p>
          <button
            onClick={handleConnect}
            className="mt-5 flex h-10 items-center gap-2 rounded-xl bg-white px-6 text-sm font-medium text-bg transition-colors hover:bg-white/90"
          >
            <Github className="h-4 w-4" />
            Connect GitHub
          </button>
        </div>
      </div>
    )
  }

  // --- Connected, ready to set up ---
  if (installationId && status === 'installing') {
    return (
      <div className="mb-8">
        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <Check className="h-5 w-5 text-success" />
            <h2 className="text-sm font-medium text-fg">GitHub Connected</h2>
          </div>
          <p className="text-xs text-muted mb-4">
            Ready to set up the feedback widget in <span className="text-fg font-medium">{githubRepo}</span>.
          </p>
          <button
            onClick={handleSetup}
            disabled={isPending}
            className="flex h-10 items-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-bg transition-colors hover:bg-white/90 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            Set up my repo
          </button>
        </div>
      </div>
    )
  }

  // --- Setting up (live progress) ---
  if (ACTIVE_STATUSES.includes(status)) {
    const activeIndex = STAGES.findIndex(s => s.key === status)
    return (
      <div className="mb-8">
        <div className="glass-card p-6">
          <h2 className="text-sm font-medium text-fg mb-4">Setting up your repo...</h2>
          <div className="space-y-3">
            {STAGES.map((stage, i) => {
              const isDone = i < activeIndex
              const isActive = i === activeIndex
              return (
                <div key={stage.key} className="flex items-center gap-3">
                  <div className="flex h-6 w-6 items-center justify-center">
                    {isDone ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : isActive ? (
                      <Loader2 className="h-4 w-4 text-accent animate-spin" />
                    ) : (
                      <div className="h-2 w-2 rounded-full bg-white/10" />
                    )}
                  </div>
                  <span className={`text-xs ${isActive ? 'text-fg' : isDone ? 'text-muted' : 'text-white/20'}`}>
                    {stage.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // --- PR created ---
  if (status === 'pr_created' || status === 'complete') {
    return (
      <div className="mb-8">
        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <Check className="h-5 w-5 text-success" />
            <h2 className="text-sm font-medium text-fg">
              {status === 'complete' ? 'Widget is live!' : 'PR ready!'}
            </h2>
          </div>
          {prUrl && status !== 'complete' && (
            <>
              <p className="text-xs text-muted mb-3">
                Merge the PR to activate the widget.
              </p>
              <a
                href={prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-bg transition-colors hover:bg-white/90"
              >
                <ExternalLink className="h-4 w-4" />
                View Pull Request
              </a>
              <div className="mt-4 rounded-lg bg-white/[0.04] p-3">
                <p className="text-xs font-medium text-fg mb-1">After merging:</p>
                <ol className="text-xs text-muted space-y-1 list-decimal list-inside">
                  <li>Add <code className="text-fg">ANTHROPIC_API_KEY</code> to <code className="text-fg">.env.local</code></li>
                  <li>Add <code className="text-fg">FEEDBACK_PASSWORD</code> to <code className="text-fg">.env.local</code></li>
                  <li>Restart your dev server</li>
                </ol>
              </div>
            </>
          )}
          {status === 'complete' && (
            <p className="text-xs text-success">
              The feedback widget is active in your app.
            </p>
          )}
        </div>
      </div>
    )
  }

  // --- Failed ---
  if (status === 'failed') {
    return (
      <div className="mb-8">
        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <AlertCircle className="h-5 w-5 text-danger" />
            <h2 className="text-sm font-medium text-fg">Setup failed</h2>
          </div>
          <p className="text-xs text-muted mb-3">{error ?? 'An unknown error occurred.'}</p>
          <button
            onClick={handleRetry}
            disabled={isPending}
            className="flex h-10 items-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-bg transition-colors hover:bg-white/90 disabled:opacity-50"
          >
            <Zap className="h-4 w-4" />
            Retry
          </button>
        </div>
      </div>
    )
  }

  return null
}
