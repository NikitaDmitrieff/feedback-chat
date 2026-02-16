import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = await createClient()

  const url = request.nextUrl
  const theme = url.searchParams.get('theme')
  const tester = url.searchParams.get('tester')
  const status = url.searchParams.get('status')

  let query = supabase
    .from('feedback_sessions')
    .select('*')
    .eq('project_id', projectId)

  if (theme) {
    query = query.contains('ai_themes', [theme])
  }
  if (tester) {
    query = query.eq('tester_id', tester)
  }
  if (status) {
    query = query.eq('status', status)
  }

  const { data: sessions, error } = await query
    .order('last_message_at', { ascending: false })
    .limit(100)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ sessions })
}
