import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SetupSection } from '@/components/setup-section'
import type { SetupStatus } from '@/lib/types'
import { DigestCard } from '@/components/digest-card'
import { StatsBar } from '@/components/stats-bar'
import { RunsTable } from '@/components/runs-table'
import { Github } from 'lucide-react'
import { DeleteProjectButton } from '@/components/delete-project-button'
import { ProposalsCard } from '@/components/proposals-card'

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ apiKey?: string }>
}) {
  const { id } = await params
  const { apiKey } = await searchParams
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, github_repo, webhook_secret, created_at, setup_progress, github_installation_id, setup_status, setup_pr_url, setup_error')
    .eq('id', id)
    .single()

  if (!project) notFound()

  const { data: runs } = await supabase
    .from('pipeline_runs')
    .select('id, github_issue_number, github_pr_number, stage, triggered_by, started_at, completed_at, result')
    .eq('project_id', id)
    .order('started_at', { ascending: false })
    .limit(50)

  const { data: feedbackSessions } = await supabase
    .from('feedback_sessions')
    .select('id, github_issue_number, tester_name, ai_summary, ai_themes')
    .eq('project_id', id)
    .not('github_issue_number', 'is', null)

  const feedbackByIssue = new Map<number, { session_id: string; tester_name: string | null; ai_summary: string | null; ai_themes: string[] | null }>()
  if (feedbackSessions) {
    for (const s of feedbackSessions) {
      if (s.github_issue_number != null) {
        feedbackByIssue.set(s.github_issue_number, {
          session_id: s.id,
          tester_name: s.tester_name,
          ai_summary: s.ai_summary,
          ai_themes: s.ai_themes,
        })
      }
    }
  }

  const enrichedRuns = (runs ?? []).map(run => ({
    ...run,
    feedback_source: feedbackByIssue.get(run.github_issue_number) ?? null,
  }))

  const hasRuns = !!runs && runs.length > 0

  const agentUrl = process.env.AGENT_URL ?? ''
  const webhookUrl = agentUrl ? `${agentUrl}/webhook/github` : ''

  return (
    <div className="mx-auto max-w-5xl px-6 pt-10 pb-16">
      {/* Project header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-medium text-fg">{project.name}</h1>
          {project.github_repo && (
            <div className="mt-1.5 flex items-center gap-2 text-xs text-muted">
              <Github className="h-3 w-3" />
              {project.github_repo}
            </div>
          )}
        </div>
        <DeleteProjectButton projectId={project.id} />
      </div>

      {/* Stats bar */}
      <StatsBar runs={runs ?? []} />

      {/* Feedback digest */}
      <div className="mb-8">
        <DigestCard projectId={project.id} />
      </div>

      {/* Proposals */}
      <div className="mb-8">
        <ProposalsCard projectId={project.id} />
      </div>

      {/* Setup */}
      <SetupSection
        projectId={project.id}
        githubRepo={project.github_repo ?? ''}
        installationId={project.github_installation_id ?? null}
        initialStatus={(project.setup_status ?? 'pending') as SetupStatus}
        initialPrUrl={project.setup_pr_url ?? null}
        initialError={project.setup_error ?? null}
        webhookSecret={project.webhook_secret ?? ''}
        apiKey={apiKey}
        webhookUrl={webhookUrl}
        agentUrl={agentUrl}
        setupProgress={(project.setup_progress ?? {}) as Record<string, boolean>}
        hasRuns={hasRuns}
      />

      {/* Runs table */}
      <div className="mb-8">
        <h2 className="mb-4 text-sm font-medium text-fg">Pipeline Runs</h2>
        <RunsTable runs={enrichedRuns} githubRepo={project.github_repo} projectId={project.id} />
      </div>
    </div>
  )
}
