import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { MinionsPageClient } from './client'
import type { Proposal, UserIdea } from '@/lib/types'

export default async function MinionsPage({
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
    { data: ideas },
    { data: runs },
    { data: jobs },
  ] = await Promise.all([
    supabase
      .from('proposals')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('user_ideas')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
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
    <div className="mx-auto max-w-6xl px-6 pt-10 pb-16">
      <MinionsPageClient
        projectId={project.id}
        githubRepo={project.github_repo}
        proposals={(proposals ?? []) as Proposal[]}
        ideas={(ideas ?? []) as UserIdea[]}
        runs={runs ?? []}
        activeJobs={jobs ?? []}
      />
    </div>
  )
}
