import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: 'feedback_chat' } },
  )
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = supabaseAdmin()

  // Find currently processing job for this project
  const { data: currentJobRow } = await supabase
    .from('job_queue')
    .select('github_issue_number')
    .eq('project_id', projectId)
    .eq('status', 'processing')
    .limit(1)
    .single()

  // Count pending jobs
  const { count } = await supabase
    .from('job_queue')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('status', 'pending')

  return NextResponse.json({
    status: 'ok',
    currentJob: currentJobRow?.github_issue_number ?? null,
    queueLength: count ?? 0,
  })
}
