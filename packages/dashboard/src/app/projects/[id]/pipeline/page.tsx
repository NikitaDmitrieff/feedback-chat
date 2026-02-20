import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PipelinePageClient } from './client'

export default async function PipelinePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, github_repo')
    .eq('id', id)
    .single()

  if (!project) notFound()

  // Fetch proposals
  const { data: proposals } = await supabase
    .from('proposals')
    .select('*')
    .eq('project_id', id)
    .order('created_at', { ascending: false })
    .limit(50)

  // Fetch recent pipeline runs
  const { data: runs } = await supabase
    .from('pipeline_runs')
    .select('id, github_issue_number, github_pr_number, stage, triggered_by, started_at, completed_at, result')
    .eq('project_id', id)
    .order('started_at', { ascending: false })
    .limit(50)

  // Fetch active jobs for stage info
  const { data: jobs } = await supabase
    .from('job_queue')
    .select('id, project_id, job_type, status, github_issue_number')
    .eq('project_id', id)
    .in('status', ['pending', 'processing'])

  return (
    <div className="mx-auto max-w-6xl px-6 pt-10 pb-16">
      <div className="mb-8">
        <h1 className="text-lg font-medium text-fg">Pipeline</h1>
        <p className="mt-1 text-xs text-muted">
          Track proposals from idea to deployment
        </p>
      </div>

      <PipelinePageClient
        projectId={project.id}
        githubRepo={project.github_repo}
        proposals={proposals ?? []}
        runs={runs ?? []}
        activeJobs={jobs ?? []}
      />
    </div>
  )
}
