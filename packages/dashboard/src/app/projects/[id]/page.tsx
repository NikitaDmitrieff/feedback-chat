import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LoopPageClient } from '@/components/loop-page-client'
import { Github } from 'lucide-react'
import { DeleteProjectButton } from '@/components/delete-project-button'
import type { Proposal, FeedbackTheme, FeedbackSession } from '@/lib/types'

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, github_repo, github_installation_id')
    .eq('id', id)
    .single()

  if (!project) notFound()

  const [
    { data: proposals },
    { data: themes },
    { data: runs },
    { data: jobs },
    { data: recentSessions },
    { data: feedbackSessions },
  ] = await Promise.all([
    supabase
      .from('proposals')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('feedback_themes')
      .select('*')
      .eq('project_id', id)
      .order('message_count', { ascending: false }),
    supabase
      .from('pipeline_runs')
      .select('id, github_issue_number, github_pr_number, stage, triggered_by, started_at, completed_at, result')
      .eq('project_id', id)
      .order('started_at', { ascending: false })
      .limit(50),
    supabase
      .from('job_queue')
      .select('id, project_id, job_type, status, github_issue_number')
      .eq('project_id', id)
      .in('status', ['pending', 'processing']),
    supabase
      .from('feedback_sessions')
      .select('id, project_id, tester_id, tester_name, started_at, last_message_at, message_count, ai_summary, ai_themes, github_issue_number, status')
      .eq('project_id', id)
      .order('last_message_at', { ascending: false })
      .limit(10),
    // For enriching runs with feedback source
    supabase
      .from('feedback_sessions')
      .select('id, github_issue_number, tester_name, ai_summary, ai_themes')
      .eq('project_id', id)
      .not('github_issue_number', 'is', null),
  ])

  // Enrich runs with feedback source info
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
    <div className="mx-auto max-w-4xl px-6 pt-10 pb-16">
      {/* Project header */}
      <div className="mb-10 flex items-start justify-between">
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

      <LoopPageClient
        projectId={project.id}
        projectName={project.name}
        githubRepo={project.github_repo}
        proposals={(proposals ?? []) as Proposal[]}
        themes={(themes ?? []) as FeedbackTheme[]}
        runs={enrichedRuns}
        activeJobs={jobs ?? []}
        recentSessions={(recentSessions ?? []) as FeedbackSession[]}
      />
    </div>
  )
}
