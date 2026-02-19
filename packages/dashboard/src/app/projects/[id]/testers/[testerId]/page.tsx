import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { TesterProfileClient } from './client'
import type { FeedbackTheme } from '@/lib/types'

export default async function TesterProfilePage({
  params,
}: {
  params: Promise<{ id: string; testerId: string }>
}) {
  const { id: projectId, testerId } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, github_repo')
    .eq('id', projectId)
    .single()

  if (!project) notFound()

  const { data: themes } = await supabase
    .from('feedback_themes')
    .select('*')
    .eq('project_id', projectId)
    .order('message_count', { ascending: false })

  return (
    <div className="mx-auto max-w-5xl px-6 pt-10 pb-16">
      <Link
        href={`/projects/${projectId}/feedback`}
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-3 w-3" />
        Feedback
      </Link>

      <TesterProfileClient
        projectId={projectId}
        testerId={testerId}
        githubRepo={project.github_repo}
        themes={(themes ?? []) as FeedbackTheme[]}
      />
    </div>
  )
}
