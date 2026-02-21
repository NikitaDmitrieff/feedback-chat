'use client'

import type { Proposal, PipelineRun } from '@/lib/types'

type StepDotState = 'done' | 'active' | 'pending'

const STAGES = ['Draft', 'Approved', 'Building', 'Preview', 'Shipped'] as const

function computeSteps(proposal: Proposal, run?: PipelineRun | null): { states: StepDotState[]; label: string } {
  if (proposal.status === 'rejected') {
    return { states: ['done', 'pending', 'pending', 'pending', 'pending'], label: 'Rejected' }
  }
  if (proposal.status === 'done') {
    return { states: ['done', 'done', 'done', 'done', 'done'], label: 'Shipped' }
  }
  if (proposal.status === 'draft') {
    return { states: ['active', 'pending', 'pending', 'pending', 'pending'], label: 'Draft' }
  }

  // approved or implementing — check run status
  if (!run) {
    return { states: ['done', 'active', 'pending', 'pending', 'pending'], label: 'Approved' }
  }

  const stage = run.stage
  if (stage === 'queued' || stage === 'running') {
    return { states: ['done', 'done', 'active', 'pending', 'pending'], label: 'Building' }
  }
  if (stage === 'validating') {
    return { states: ['done', 'done', 'done', 'active', 'pending'], label: 'Validating' }
  }
  if (stage === 'preview_ready') {
    return { states: ['done', 'done', 'done', 'active', 'pending'], label: 'Preview ready' }
  }
  if (run.result === 'success' || stage === 'deployed') {
    return { states: ['done', 'done', 'done', 'done', 'done'], label: 'Shipped' }
  }
  if (run.result === 'failed') {
    return { states: ['done', 'done', 'done', 'pending', 'pending'], label: 'Failed' }
  }

  // Default: building
  return { states: ['done', 'done', 'active', 'pending', 'pending'], label: stage }
}

export function StepDots({ proposal, run }: { proposal: Proposal; run?: PipelineRun | null }) {
  const { states, label } = computeSteps(proposal, run)

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-0.5">
        {states.map((state, i) => (
          <div key={i} className="flex items-center">
            <div
              className={`h-1.5 w-1.5 rounded-full ${
                state === 'done'
                  ? 'bg-success'
                  : state === 'active'
                    ? 'bg-accent animate-pulse'
                    : 'bg-white/[0.1]'
              }`}
            />
            {i < states.length - 1 && (
              <div
                className={`h-px w-2 ${
                  state === 'done' && states[i + 1] !== 'pending'
                    ? 'bg-success'
                    : 'bg-white/[0.1]'
                }`}
              />
            )}
          </div>
        ))}
      </div>
      <span className="text-[11px] text-muted">{label}</span>
    </div>
  )
}
