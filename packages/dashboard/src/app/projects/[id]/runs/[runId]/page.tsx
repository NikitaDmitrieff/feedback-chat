import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { ArrowLeft, ExternalLink, GitPullRequest, AlertCircle, Globe } from 'lucide-react'
import { StageBadge } from '@/components/stage-badge'
import { LogViewer } from '@/components/log-viewer'
import { DeploymentPreview } from '@/components/deployment-preview'

const STAGE_ORDER = ['created', 'queued', 'running', 'validating', 'preview_ready', 'deployed']

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>
}) {
  const { id: projectId, runId } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, github_repo')
    .eq('id', projectId)
    .single()

  if (!project) notFound()

  const { data: run } = await supabase
    .from('pipeline_runs')
    .select('id, github_issue_number, github_pr_number, stage, triggered_by, started_at, completed_at, result, failure_category, failure_analysis, improvement_job_id')
    .eq('id', runId)
    .eq('project_id', projectId)
    .single()

  if (!run) notFound()

  let feedbackSource: { tester_name: string | null; ai_summary: string | null } | null = null
  if (run.github_issue_number) {
    const { data: session } = await supabase
      .from('feedback_sessions')
      .select('tester_name, ai_summary')
      .eq('project_id', projectId)
      .eq('github_issue_number', run.github_issue_number)
      .limit(1)
      .single()
    feedbackSource = session ?? null
  }

  const currentStageIndex = STAGE_ORDER.indexOf(run.stage)
  const isFailed = run.stage === 'failed' || run.stage === 'rejected'

  // Calculate duration
  let duration = ''
  if (run.completed_at) {
    const ms = new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()
    const totalSeconds = Math.round(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    duration = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
  }

  return (
    <div className="mx-auto max-w-5xl px-6 pt-10 pb-16">
      {/* Breadcrumb */}
      <Link
        href={`/projects/${projectId}`}
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-3 w-3" />
        {project.name}
      </Link>

      {/* Header */}
      <div className="mb-8 flex items-center gap-4">
        <h1 className="text-lg font-medium text-fg">
          Run <span className="font-[family-name:var(--font-mono)]">#{run.github_issue_number}</span>
        </h1>
        <StageBadge stage={run.stage} />
        {duration && (
          <span className="text-xs text-muted tabular-nums">{duration}</span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content — 2/3 width */}
        <div className="lg:col-span-2 space-y-6">
          {/* Logs */}
          <div>
            <h2 className="mb-3 text-sm font-medium text-fg">Logs</h2>
            <LogViewer projectId={projectId} runId={runId} />
          </div>

          {/* Deployment preview */}
          <div>
            <h2 className="mb-3 text-sm font-medium text-fg">Deployment Preview</h2>
            <DeploymentPreview projectId={projectId} runId={runId} />
          </div>
        </div>

        {/* Sidebar — 1/3 width */}
        <div className="space-y-6">
          {/* Stage timeline */}
          <div className="glass-card p-5">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">Timeline</h3>
            <div className="space-y-0">
              {STAGE_ORDER.map((stage, i) => {
                const isCompleted = i < currentStageIndex
                const isCurrent = stage === run.stage

                return (
                  <div key={stage} className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className={`h-2.5 w-2.5 rounded-full border-2 ${
                          isCompleted
                            ? 'border-success bg-success'
                            : isCurrent
                              ? isFailed
                                ? 'border-danger bg-danger'
                                : 'border-accent bg-accent'
                              : 'border-edge bg-transparent'
                        }`}
                      />
                      {i < STAGE_ORDER.length - 1 && (
                        <div
                          className={`h-6 w-0.5 ${isCompleted ? 'bg-success/30' : 'bg-edge'}`}
                        />
                      )}
                    </div>
                    <span
                      className={`-mt-0.5 text-xs ${
                        isCompleted || isCurrent ? 'text-fg' : 'text-dim'
                      }`}
                    >
                      {stage.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                    </span>
                  </div>
                )
              })}
              {isFailed && (
                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <div className="h-2.5 w-2.5 rounded-full border-2 border-danger bg-danger" />
                  </div>
                  <span className="-mt-0.5 text-xs text-danger">
                    {run.stage === 'failed' ? 'Failed' : 'Rejected'}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Links */}
          <div className="glass-card p-5 space-y-3">
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted">Links</h3>

            <a
              href={`https://github.com/${project.github_repo}/issues/${run.github_issue_number}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2.5 text-sm text-accent transition-colors hover:bg-surface-hover"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              Issue #{run.github_issue_number}
              <ExternalLink className="ml-auto h-3 w-3 text-muted" />
            </a>

            {run.github_pr_number && (
              <a
                href={`https://github.com/${project.github_repo}/pull/${run.github_pr_number}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2.5 text-sm text-accent transition-colors hover:bg-surface-hover"
              >
                <GitPullRequest className="h-4 w-4 shrink-0" />
                PR #{run.github_pr_number}
                <ExternalLink className="ml-auto h-3 w-3 text-muted" />
              </a>
            )}
          </div>

          {/* Original Feedback */}
          {feedbackSource && (
            <div className="glass-card p-5">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">Original Feedback</h3>
              <p className="text-sm font-medium text-fg">
                {feedbackSource.tester_name || 'Anonymous'}
              </p>
              {feedbackSource.ai_summary && (
                <p className="mt-1.5 text-xs text-muted leading-relaxed">{feedbackSource.ai_summary}</p>
              )}
              <a
                href={`/projects/${projectId}/feedback`}
                className="mt-2 inline-flex text-xs text-accent hover:underline"
              >
                View conversation
              </a>
            </div>
          )}

          {/* Failure Analysis */}
          {run.failure_category && (
            <div className="glass-card p-5">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">Failure Analysis</h3>
              <div className="mb-2">
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                  run.failure_category === 'consumer_error' ? 'bg-warning/20 text-warning' :
                  run.failure_category === 'transient' ? 'bg-muted/20 text-muted' :
                  'bg-danger/20 text-danger'
                }`}>
                  {run.failure_category.replace('_', ' ')}
                </span>
              </div>
              {run.failure_analysis && (
                <p className="text-xs text-muted leading-relaxed">{run.failure_analysis}</p>
              )}
              {run.improvement_job_id && (
                <p className="mt-2 text-xs text-accent">
                  Improvement job spawned
                </p>
              )}
            </div>
          )}

          {/* Metadata */}
          <div className="glass-card p-5">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">Details</h3>
            <dl className="space-y-2 text-xs">
              {run.triggered_by && (
                <>
                  <dt className="text-muted">Triggered by</dt>
                  <dd className="text-fg">{run.triggered_by}</dd>
                </>
              )}
              <dt className="text-muted">Started</dt>
              <dd className="tabular-nums text-fg">
                {new Date(run.started_at).toLocaleString()}
              </dd>
              {run.completed_at && (
                <>
                  <dt className="text-muted">Completed</dt>
                  <dd className="tabular-nums text-fg">
                    {new Date(run.completed_at).toLocaleString()}
                  </dd>
                </>
              )}
              {run.result && (
                <>
                  <dt className="text-muted">Result</dt>
                  <dd className="text-fg capitalize">{run.result}</dd>
                </>
              )}
            </dl>
          </div>
        </div>
      </div>
    </div>
  )
}
