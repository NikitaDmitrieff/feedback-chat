import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getInstallationToken } from '@/lib/github-app'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; runId: string }> }
) {
  const { projectId, runId } = await params
  const supabase = await createClient()

  // Get the run's PR number
  const { data: run } = await supabase
    .from('pipeline_runs')
    .select('github_pr_number')
    .eq('id', runId)
    .eq('project_id', projectId)
    .single()

  if (!run?.github_pr_number) {
    return NextResponse.json({ state: null, previewUrl: null, description: null })
  }

  // Get the project's GitHub repo + installation ID
  const { data: project } = await supabase
    .from('projects')
    .select('github_repo, github_installation_id')
    .eq('id', projectId)
    .single()

  if (!project?.github_repo) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const [owner, repo] = project.github_repo.split('/')

  // Use GitHub App installation token if available, fall back to GITHUB_TOKEN env var
  let headers: Record<string, string>

  if (project.github_installation_id) {
    try {
      const token = await getInstallationToken(project.github_installation_id)
      headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[deployment] GitHub App auth failed:', msg)
      return NextResponse.json({ state: null, previewUrl: null, description: `GitHub App auth failed: ${msg.slice(0, 100)}` })
    }
  } else if (process.env.GITHUB_TOKEN) {
    headers = {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
    }
  } else {
    return NextResponse.json({
      state: null,
      previewUrl: null,
      description: 'Connect GitHub via Settings to enable deployment previews',
    })
  }

  // Get PR head SHA
  const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${run.github_pr_number}`, { headers })
  if (!prRes.ok) {
    return NextResponse.json({ state: null, previewUrl: null, description: 'Failed to fetch PR' })
  }
  const prData = await prRes.json()
  const sha = prData.head?.sha

  if (!sha) {
    return NextResponse.json({ state: null, previewUrl: null, description: 'No head commit' })
  }

  // Get commit statuses
  const statusRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}/statuses`, { headers })
  if (!statusRes.ok) {
    return NextResponse.json({ state: null, previewUrl: null, description: 'Failed to fetch statuses' })
  }
  const statuses: Array<{ state: string; target_url: string; description: string; context: string }> = await statusRes.json()

  // Find Vercel deployment status
  const vercelStatus = statuses.find((s) => s.context.toLowerCase().includes('vercel'))

  if (!vercelStatus) {
    return NextResponse.json({ state: null, previewUrl: null, description: 'No Vercel deployment found' })
  }

  return NextResponse.json({
    state: vercelStatus.state,
    previewUrl: vercelStatus.target_url,
    description: vercelStatus.description,
  })
}
