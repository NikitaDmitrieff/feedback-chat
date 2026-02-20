import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getInstallationOctokit } from '@/lib/github-app'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = await createClient()

  const { searchParams } = request.nextUrl
  const status = searchParams.get('status')

  let query = supabase
    .from('proposals')
    .select('*')
    .eq('project_id', projectId)

  if (status) {
    query = query.eq('status', status)
  }

  const { data: proposals, error } = await query
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ proposals })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = await createClient()

  const body = await request.json()
  const { title, spec, priority } = body as { title: string; spec: string; priority: string }

  if (!title?.trim() || !spec?.trim()) {
    return NextResponse.json({ error: 'Title and spec are required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('proposals')
    .insert({
      project_id: projectId,
      title: title.trim(),
      rationale: 'User-created proposal',
      spec: spec.trim(),
      priority: priority === 'high' ? 'high' : priority === 'low' ? 'low' : 'medium',
      scores: {},
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ proposal: data })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = await createClient()

  const body = await request.json()
  const { proposalId, action, userNotes, rejectReason, modifiedSpec, branchName } = body as {
    proposalId: string
    action: 'approve' | 'reject'
    userNotes?: string
    rejectReason?: string
    modifiedSpec?: string
    branchName?: string
  }

  if (!proposalId || !action) {
    return NextResponse.json({ error: 'proposalId and action are required' }, { status: 400 })
  }

  // Fetch proposal
  const { data: proposal, error: fetchError } = await supabase
    .from('proposals')
    .select('*')
    .eq('id', proposalId)
    .eq('project_id', projectId)
    .single()

  if (fetchError || !proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
  }

  if (action === 'reject') {
    const { error } = await supabase
      .from('proposals')
      .update({
        status: 'rejected',
        reject_reason: rejectReason || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', proposalId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Record in strategy memory
    await supabase.from('strategy_memory').insert({
      project_id: projectId,
      proposal_id: proposalId,
      event_type: 'rejected',
      title: proposal.title,
      themes: proposal.source_theme_ids?.length
        ? await resolveThemeNames(supabase, proposal.source_theme_ids)
        : [],
      outcome_notes: rejectReason || null,
    })

    return NextResponse.json({ ok: true, status: 'rejected' })
  }

  if (action === 'approve') {
    // Use modified spec if user edited it, otherwise use original
    const finalSpec = modifiedSpec || proposal.spec

    // Update proposal
    const { error } = await supabase
      .from('proposals')
      .update({
        status: 'approved',
        spec: finalSpec,
        user_notes: userNotes || null,
        branch_name: branchName || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', proposalId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Create GitHub issue
    let issueNumber: number | null = null
    try {
      issueNumber = await createGitHubIssue(supabase, projectId, proposal.title, finalSpec, userNotes, branchName)
      if (issueNumber) {
        await supabase
          .from('proposals')
          .update({ github_issue_number: issueNumber })
          .eq('id', proposalId)
      }
    } catch (err) {
      console.error('[proposals] Failed to create GitHub issue:', err)
    }

    // Record in strategy memory with edit distance
    const editDist = modifiedSpec ? calculateEditDistance(proposal.spec, modifiedSpec) : 0
    const themeNames = proposal.source_theme_ids?.length
      ? await resolveThemeNames(supabase, proposal.source_theme_ids)
      : []

    await supabase.from('strategy_memory').insert({
      project_id: projectId,
      proposal_id: proposalId,
      event_type: 'approved',
      title: proposal.title,
      themes: themeNames,
      outcome_notes: userNotes || null,
      edit_distance: editDist,
    })

    return NextResponse.json({ ok: true, status: 'approved', github_issue_number: issueNumber })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}

async function resolveThemeNames(supabase: Awaited<ReturnType<typeof createClient>>, themeIds: string[]): Promise<string[]> {
  if (!themeIds.length) return []
  const { data } = await supabase
    .from('feedback_themes')
    .select('name')
    .in('id', themeIds)
  return (data ?? []).map(t => t.name)
}

async function createGitHubIssue(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  title: string,
  spec: string,
  userNotes?: string,
  branchName?: string,
): Promise<number | null> {
  const { data: project } = await supabase
    .from('projects')
    .select('github_repo, github_installation_id')
    .eq('id', projectId)
    .single()

  if (!project?.github_repo || !project?.github_installation_id) return null

  const [owner, repo] = project.github_repo.split('/')
  if (!owner || !repo) return null

  const octokit = await getInstallationOctokit(project.github_installation_id)

  const metadata = branchName ? `\n## Metadata\nBranch: ${branchName}` : ''
  const body = `## Proposal

${spec}

${userNotes ? `## Additional Guidance\n\n${userNotes}` : ''}
${metadata}

---
*Auto-generated by the proposals system.*`

  const { data: issue } = await octokit.request('POST /repos/{owner}/{repo}/issues', {
    owner,
    repo,
    title,
    body,
    labels: ['feedback-bot', 'auto-implement'],
  })

  return issue.number
}

function calculateEditDistance(original: string, modified: string): number {
  if (original === modified) return 0
  const maxLen = Math.max(original.length, modified.length)
  if (maxLen === 0) return 0
  let changes = 0
  for (let i = 0; i < maxLen; i++) {
    if (original[i] !== modified[i]) changes++
  }
  return changes / maxLen
}
