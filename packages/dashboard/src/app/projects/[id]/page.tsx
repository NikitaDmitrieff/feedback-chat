import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SetupChecklist } from '@/components/setup-checklist'
import { StatsBar } from '@/components/stats-bar'
import { RunsTable } from '@/components/runs-table'
import Link from 'next/link'
import { ArrowLeft, Github } from 'lucide-react'

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ apiKey?: string; webhookSecret?: string }>
}) {
  const { id } = await params
  const { apiKey, webhookSecret } = await searchParams
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, github_repo, webhook_secret, created_at, setup_progress')
    .eq('id', id)
    .single()

  if (!project) notFound()

  const { data: runs } = await supabase
    .from('pipeline_runs')
    .select('id, github_issue_number, github_pr_number, stage, triggered_by, started_at, completed_at, result')
    .eq('project_id', id)
    .order('started_at', { ascending: false })
    .limit(50)

  const hasRuns = !!runs && runs.length > 0
  const setupProgress = (project.setup_progress as Record<string, boolean>) ?? {}
  const baseUrl = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3001')
  const webhookUrl = `${baseUrl}/api/webhook/${project.id}`
  const agentUrl = `${baseUrl}/api/agent/${project.id}`

  return (
    <div className="mx-auto max-w-5xl px-6 pt-10 pb-16">
      {/* Breadcrumb */}
      <Link
        href="/projects"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-3 w-3" />
        All projects
      </Link>

      {/* Project header */}
      <div className="mb-8">
        <h1 className="text-lg font-medium text-fg">{project.name}</h1>
        <div className="mt-1.5 flex items-center gap-2 text-xs text-muted">
          <Github className="h-3 w-3" />
          {project.github_repo}
        </div>
      </div>

      {/* Stats bar */}
      <StatsBar runs={runs ?? []} />

      {/* Setup checklist */}
      <SetupChecklist
        projectId={project.id}
        githubRepo={project.github_repo}
        webhookSecret={webhookSecret ?? project.webhook_secret}
        apiKey={apiKey}
        webhookUrl={webhookUrl}
        agentUrl={agentUrl}
        setupProgress={setupProgress}
        hasRuns={hasRuns}
      />

      {/* Runs table */}
      <div className="mb-8">
        <h2 className="mb-4 text-sm font-medium text-fg">Pipeline Runs</h2>
        <RunsTable runs={runs ?? []} githubRepo={project.github_repo} projectId={project.id} />
      </div>
    </div>
  )
}
