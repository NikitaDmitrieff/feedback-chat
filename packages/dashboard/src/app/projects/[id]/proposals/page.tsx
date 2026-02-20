import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { ProposalsPageClient } from './client'
import type { Proposal } from '@/lib/types'

export default async function ProposalsPage({
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

  const { data: proposals } = await supabase
    .from('proposals')
    .select('*')
    .eq('project_id', id)
    .order('created_at', { ascending: false })

  return (
    <div className="mx-auto max-w-5xl px-6 pt-10 pb-16">
      <Link
        href={`/projects/${id}`}
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-3 w-3" />
        {project.name}
      </Link>

      <h1 className="mb-8 text-lg font-medium text-fg">Proposals</h1>

      <ProposalsPageClient
        projectId={project.id}
        githubRepo={project.github_repo}
        proposals={(proposals ?? []) as Proposal[]}
      />
    </div>
  )
}
