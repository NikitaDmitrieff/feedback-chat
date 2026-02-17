import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

export function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    db: { schema: 'feedback_chat' },
  })
}

export function authAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
}

/**
 * Ensure a test user exists and return their credentials.
 * Idempotent — safe to call multiple times.
 */
export async function ensureTestUser() {
  const email = process.env.QA_TEST_EMAIL || 'qa-bot@feedback.chat'
  const password = process.env.QA_TEST_PASSWORD || 'qa-test-password-2026'

  const auth = authAdmin()

  // Try to find existing user
  const { data: { users } } = await auth.auth.admin.listUsers()
  const existing = users.find((u) => u.email === email)

  if (!existing) {
    const { error } = await auth.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (error) throw new Error(`Failed to create test user: ${error.message}`)
  }

  return { email, password }
}

/**
 * Clean up projects created by the QA bot.
 * Call after each test run to avoid accumulating test data.
 */
export async function cleanupTestProjects() {
  const supabase = adminClient()
  // Clean up both onboarding (qa-test-*) and pipeline (qa-pipeline-*) projects
  const { data: projects } = await supabase
    .from('projects')
    .select('id')
    .or('name.like.qa-test-%,name.like.qa-pipeline-%')

  if (!projects || projects.length === 0) return

  const ids = projects.map((p) => p.id)

  // Delete in dependency order
  await supabase.from('pipeline_runs').delete().in('project_id', ids)
  await supabase.from('job_queue').delete().in('project_id', ids)
  await supabase.from('credentials').delete().in('project_id', ids)
  await supabase.from('api_keys').delete().in('project_id', ids)
  await supabase.from('projects').delete().in('id', ids)
}
