import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { DigestCard } from '@/components/digest-card'
import { StatsBar } from '@/components/stats-bar'
import { RunsTable } from '@/components/runs-table'
import { Github, Sparkles } from 'lucide-react'
import { DeleteProjectButton } from '@/components/delete-project-button'
import { ProposalsCard } from '@/components/proposals-card'

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, github_repo, product_context, webhook_secret, created_at, setup_progress, github_installation_id, setup_status, setup_pr_url, setup_error')
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

      {/* Settings nudge (if no product context) */}
      {!project.product_context && (
        <div className="mb-8 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
          <Sparkles className="h-4 w-4 shrink-0 text-accent" />
          <p className="flex-1 text-xs text-muted">
            Set up your product context to improve proposal quality.
          </p>
          <Link
            href={`/projects/${id}/settings`}
            className="shrink-0 text-[11px] font-medium text-accent hover:text-fg"
          >
            Go to Settings
          </Link>
        </div>
      )}

      {/* Setup incomplete banner */}
      {project.setup_status !== 'complete' && project.setup_status !== 'pr_created' && (
        <div className="mb-8 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
          <span className="text-xs text-muted">Setup incomplete</span>
          <Link
            href={`/projects/${id}/settings`}
            className="text-[11px] font-medium text-accent hover:text-fg"
          >
            Go to Settings
          </Link>
        </div>
      )}

      {/* Runs table */}
      <div className="mb-8">
        <h2 className="mb-4 text-sm font-medium text-fg">Pipeline Runs</h2>
        <RunsTable runs={enrichedRuns} githubRepo={project.github_repo} projectId={project.id} />
      </div>
    </div>
  )
}
