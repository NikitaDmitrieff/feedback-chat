import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

// Use service role to bypass RLS — this is a webhook endpoint, no user session
function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: 'feedback_chat' } },
  )
}

function verifySignature(payload: string, signature: string, secret: string): boolean {
  if (!signature) return false
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
  if (signature.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = supabaseAdmin()

  // Look up project + webhook secret
  const { data: project } = await supabase
    .from('projects')
    .select('id, webhook_secret, github_repo')
    .eq('id', projectId)
    .single()

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // Verify HMAC
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256') ?? ''
  if (!verifySignature(rawBody, signature, project.webhook_secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  // Parse event
  const event = request.headers.get('x-github-event')
  const payload = JSON.parse(rawBody)

  if (event !== 'issues') {
    return NextResponse.json({ status: 'ignored' })
  }

  const action = payload.action
  const labels: string[] = (payload.issue?.labels ?? []).map((l: { name: string }) => l.name)

  // Accept: opened, reopened, or labeled with auto-implement
  const isOpenOrReopen = action === 'opened' || action === 'reopened'
  const isAutoImplementLabeled = action === 'labeled' && labels.includes('auto-implement')

  if (!isOpenOrReopen && !isAutoImplementLabeled) {
    return NextResponse.json({ status: 'ignored' })
  }

  if (!labels.includes('feedback-bot')) {
    return NextResponse.json({ status: 'ignored' })
  }
  if (labels.includes('in-progress') || labels.includes('agent-failed')) {
    return NextResponse.json({ status: 'ignored' })
  }

  // Deduplicate: skip if a pending/processing job already exists for this issue
  const { count: existingJobs } = await supabase
    .from('job_queue')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', project.id)
    .eq('github_issue_number', payload.issue.number)
    .in('status', ['pending', 'processing'])

  if (existingJobs && existingJobs > 0) {
    return NextResponse.json({ status: 'already_queued' })
  }

  const issue = payload.issue
  const triggeredBy = payload.issue?.user?.login ?? null

  // Enqueue job
  const { data: job, error: jobError } = await supabase.from('job_queue').insert({
    project_id: project.id,
    github_issue_number: issue.number,
    issue_title: issue.title ?? '',
    issue_body: issue.body ?? '',
  }).select('id').single()

  if (jobError || !job) {
    return NextResponse.json({ error: 'Failed to enqueue' }, { status: 500 })
  }

  // Create pipeline run record linked to the job
  await supabase.from('pipeline_runs').insert({
    job_id: job.id,
    project_id: project.id,
    github_issue_number: issue.number,
    stage: 'queued',
    triggered_by: triggeredBy,
  })

  return NextResponse.json({ status: 'queued' })
}
