import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; runId: string }> }
) {
  const { projectId, runId } = await params
  const supabase = await createClient()
  const { searchParams } = request.nextUrl
  const after = searchParams.get('after')

  // Verify run belongs to this project
  const { data: run } = await supabase
    .from('pipeline_runs')
    .select('id, stage, result')
    .eq('id', runId)
    .eq('project_id', projectId)
    .single()

  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }

  let query = supabase
    .from('run_logs')
    .select('id, timestamp, level, message, event_type, payload')
    .eq('run_id', runId)
    .order('timestamp', { ascending: true })
    .limit(200)

  if (after) {
    query = query.gt('timestamp', after)
  }

  const { data: logs, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const done = run.result === 'success' || run.result === 'failed'

  return NextResponse.json({
    logs: logs ?? [],
    stage: run.stage,
    result: run.result,
    done,
  })
}
