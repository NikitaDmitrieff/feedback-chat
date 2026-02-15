'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Check, X, Loader2, ExternalLink, RotateCcw, Eye, MessageSquare } from 'lucide-react'
import type { Stage, StatusResponse } from './types'

type StepState = 'completed' | 'active' | 'failed' | 'future'

type PipelineTrackerProps = {
  issueUrl: string
  statusEndpoint?: string
}

const STEPS: { label: string; stage: Stage }[] = [
  { label: 'Issue created', stage: 'created' },
  { label: 'Queued', stage: 'queued' },
  { label: 'Agent running', stage: 'running' },
  { label: 'Validating', stage: 'validating' },
  { label: 'Preview ready', stage: 'preview_ready' },
  { label: 'Deployed', stage: 'deployed' },
]

const STAGE_INDEX: Record<Stage, number> = {
  created: 0,
  queued: 1,
  running: 2,
  validating: 3,
  preview_ready: 4,
  deployed: 5,
  failed: -1,
  rejected: -1,
}

const TERMINAL_STAGES: Stage[] = ['deployed', 'failed', 'rejected']
const POLL_INTERVAL_MS = 5000
const PREVIEW_POLL_INTERVAL_MS = 15000
const ACTIVE_PIPELINE_KEY = 'feedback_active_pipeline'

/** Broadcast pipeline activity to trigger bar status indicator */
function setPipelineActive(issueNumber: number, stage: Stage) {
  if (TERMINAL_STAGES.includes(stage)) {
    localStorage.removeItem(ACTIVE_PIPELINE_KEY)
  } else {
    localStorage.setItem(ACTIVE_PIPELINE_KEY, JSON.stringify({ issueNumber, stage }))
  }
  window.dispatchEvent(new Event('pipeline-status'))
}

function getPassword(): string {
  return sessionStorage.getItem('feedback_password') ?? ''
}

function getFailedStepIndex(previousStage: Stage | null): number {
  if (previousStage && previousStage !== 'failed') {
    return STAGE_INDEX[previousStage]
  }
  return 2
}

function deriveStepState(
  stepIndex: number,
  currentIndex: number,
  failedAtIndex: number,
  stage: Stage,
): StepState {
  const isFailed = stage === 'failed'
  const isDeployed = stage === 'deployed'

  if (isFailed && stepIndex === failedAtIndex) return 'failed'
  if (isFailed && stepIndex < failedAtIndex) return 'completed'
  if (isFailed) return 'future'

  if (isDeployed) return 'completed'

  if (currentIndex > stepIndex) return 'completed'
  if (currentIndex === stepIndex) return 'active'
  return 'future'
}

const STEP_DOT_CLASS: Record<StepState, string> = {
  completed: 'h-[7px] w-[7px] rounded-full bg-emerald-500',
  active: 'h-[7px] w-[7px] rounded-full bg-foreground animate-pulse',
  failed: 'h-[7px] w-[7px] rounded-full bg-destructive',
  future: 'h-[5px] w-[5px] rounded-full bg-muted-foreground/25',
}

function StepDot({ state }: { state: StepState }): React.ReactNode {
  return (
    <div className="flex h-4 w-4 shrink-0 items-center justify-center">
      <div className={STEP_DOT_CLASS[state]} />
    </div>
  )
}

const STEP_LABEL_CLASS: Record<StepState, string> = {
  completed: 'text-muted-foreground',
  active: 'text-foreground',
  failed: 'text-destructive',
  future: 'text-muted-foreground/40',
}

export function PipelineTracker({
  issueUrl,
  statusEndpoint = '/api/feedback/status',
}: PipelineTrackerProps) {
  const issueNumber = parseInt(issueUrl.split('/').pop() ?? '0', 10)

  const [status, setStatus] = useState<StatusResponse>({
    stage: 'created',
    issueNumber,
    issueUrl,
  })
  const [polling, setPolling] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showChangeInput, setShowChangeInput] = useState(false)
  const [changeComment, setChangeComment] = useState('')
  const [confirmReject, setConfirmReject] = useState(false)
  const previousStageRef = useRef<Stage | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${statusEndpoint}?issue=${issueNumber}`)
      if (!res.ok) return
      const data: StatusResponse = await res.json()
      setStatus(data)
      setPipelineActive(issueNumber, data.stage)
      if (TERMINAL_STAGES.includes(data.stage)) {
        setPolling(false)
      }
    } catch {
      // Keep last known state on network errors
    }
  }, [statusEndpoint, issueNumber])

  // Track previous stage in a ref — must be in useEffect, not during render (React Compiler rule)
  useEffect(() => {
    if (status.stage !== 'failed') {
      previousStageRef.current = status.stage
    }
  }, [status.stage])

  useEffect(() => {
    setPipelineActive(issueNumber, 'created')
    fetchStatus()
    if (!polling) return
    const interval = setInterval(
      fetchStatus,
      status.stage === 'preview_ready' ? PREVIEW_POLL_INTERVAL_MS : POLL_INTERVAL_MS,
    )
    return () => clearInterval(interval)
  }, [fetchStatus, polling, issueNumber, status.stage])

  async function handleAction(action: string, extraBody?: Record<string, string>): Promise<void> {
    setActionLoading(action)
    try {
      const res = await fetch(`${statusEndpoint}?issue=${issueNumber}&action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: getPassword(), ...extraBody }),
      })
      if (!res.ok) return

      switch (action) {
        case 'retry':
        case 'request_changes':
          setStatus({ stage: 'created', issueNumber, issueUrl })
          setPipelineActive(issueNumber, 'created')
          setPolling(true)
          setChangeComment('')
          setShowChangeInput(false)
          break
        case 'approve':
          setStatus((prev) => ({ ...prev, stage: 'deployed' }))
          setPipelineActive(issueNumber, 'deployed')
          setPolling(false)
          break
        case 'reject':
          setStatus((prev) => ({ ...prev, stage: 'rejected' }))
          setPipelineActive(issueNumber, 'rejected')
          setPolling(false)
          break
      }
    } finally {
      setActionLoading(null)
      setConfirmReject(false)
    }
  }

  const currentIndex = STAGE_INDEX[status.stage]
  const isFailed = status.stage === 'failed'
  const failedAtIndex = isFailed ? getFailedStepIndex(previousStageRef.current) : -1

  return (
    <div className="rounded-2xl border border-border bg-card p-3 space-y-2">
      <div className="space-y-0">
        {STEPS.map((step, i) => {
          const state = deriveStepState(i, currentIndex, failedAtIndex, status.stage)

          return (
            <div key={step.stage} className="flex items-center gap-2 h-6">
              <StepDot state={state} />
              <span className={`text-xs ${STEP_LABEL_CLASS[state]}`}>
                {state === 'failed' && status.failReason
                  ? status.failReason
                  : step.label}
              </span>
              {i === 0 && (
                <span className="ml-auto text-[11px] text-muted-foreground/60">
                  #{issueNumber}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {status.stage === 'preview_ready' && status.previewUrl && (
        <div className="space-y-2.5 pt-2 border-t border-border">
          <a
            href={status.previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 transition-all hover:border-emerald-500/30 hover:bg-emerald-500/5"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-500/10">
              <Eye className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="block text-xs font-medium text-foreground">View preview</span>
              <span className="block text-[10px] text-muted-foreground truncate">{status.previewUrl.replace(/^https?:\/\//, '')}</span>
            </div>
            <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground/70" />
          </a>

          <div className="flex items-stretch gap-1.5">
            <button
              onClick={() => handleAction('approve')}
              disabled={actionLoading !== null}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 px-2 py-2 text-[11px] font-medium text-emerald-400 transition-all hover:bg-emerald-500/25 disabled:opacity-50"
            >
              {actionLoading === 'approve' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              Approve
            </button>
            <button
              onClick={() => setShowChangeInput((v) => !v)}
              disabled={actionLoading !== null}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] font-medium transition-all disabled:opacity-50 ${
                showChangeInput
                  ? 'border-foreground/20 bg-foreground/5 text-foreground'
                  : 'border-border text-muted-foreground hover:border-foreground/15 hover:text-foreground'
              }`}
            >
              <MessageSquare className="h-3 w-3" />
              Changes
            </button>
            <button
              onClick={() => {
                if (confirmReject) {
                  handleAction('reject')
                } else {
                  setConfirmReject(true)
                }
              }}
              disabled={actionLoading !== null}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-medium transition-all disabled:opacity-50 ${
                confirmReject
                  ? 'bg-red-500/20 text-red-400'
                  : 'border border-border text-muted-foreground hover:border-red-500/20 hover:text-red-400'
              }`}
            >
              {actionLoading === 'reject' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <X className="h-3 w-3" />
              )}
              {confirmReject ? 'Confirm' : 'Reject'}
            </button>
          </div>

          {showChangeInput && (
            <div className="space-y-1.5">
              <textarea
                value={changeComment}
                onChange={(e) => setChangeComment(e.target.value)}
                placeholder="Describe the changes you want..."
                className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-foreground/20 resize-none"
                rows={3}
              />
              <button
                onClick={() => handleAction('request_changes', { comment: changeComment })}
                disabled={actionLoading !== null || changeComment.trim() === ''}
                className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[11px] font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
              >
                {actionLoading === 'request_changes' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : null}
                Send
              </button>
            </div>
          )}
        </div>
      )}

      {status.stage === 'rejected' && (
        <p className="text-xs text-muted-foreground">Request rejected</p>
      )}

      <div className="flex items-center gap-2 pt-1 border-t border-border">
        {isFailed && (
          <button
            onClick={() => handleAction('retry')}
            disabled={actionLoading !== null}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {actionLoading === 'retry' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCcw className="h-3 w-3" />
            )}
            Retry
          </button>
        )}
        <a
          href={issueUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ExternalLink className="h-3 w-3" />
          View on GitHub
        </a>
      </div>
    </div>
  )
}
