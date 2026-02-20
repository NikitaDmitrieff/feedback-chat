'use server'

import { createClient } from '@/lib/supabase/server'

export async function triggerStrategize(projectId: string) {
  const supabase = await createClient()

  const { error } = await supabase.from('job_queue').insert({
    project_id: projectId,
    job_type: 'strategize',
    github_issue_number: 0,
    issue_title: 'Manual strategize trigger',
    issue_body: '{}',
  })

  if (error) throw new Error(error.message)
  return { ok: true }
}
