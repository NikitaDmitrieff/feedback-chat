import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LoopPageClient } from '@/components/loop-page-client'
import { Github } from 'lucide-react'
import { DeleteProjectButton } from '@/components/delete-project-button'
import type { Proposal, FeedbackTheme } from '@/lib/types'

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
  ])

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
        runs={runs ?? []}
        activeJobs={jobs ?? []}
      />
    </div>
  )
}
