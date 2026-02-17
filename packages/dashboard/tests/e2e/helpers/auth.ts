import { Page, expect } from '@playwright/test'
import { adminClient, authAdmin } from './seed'
import crypto from 'node:crypto'

const EMAIL = process.env.QA_TEST_EMAIL || 'qa-bot@feedback.chat'
const PASSWORD = process.env.QA_TEST_PASSWORD || 'qa-test-password-2026'

export async function signIn(page: Page) {
  await page.goto('/login')
  // Wait for client-side hydration (dynamic import with ssr: false)
  await page.waitForSelector('[placeholder="Email address"]', { timeout: 10_000 })
  await page.fill('[placeholder="Email address"]', EMAIL)
  await page.fill('[placeholder="Password"]', PASSWORD)
  // Button is disabled until both fields are filled
  const submitBtn = page.getByRole('button', { name: 'Sign in' })
  await submitBtn.waitFor({ state: 'attached' })
  await page.waitForTimeout(500) // allow React state to propagate
  await submitBtn.click()
  await page.waitForURL('**/projects', { timeout: 15_000 })
  // Verify page fully rendered — not a transient URL match
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible({ timeout: 10_000 })
}

export async function createTestProject(page: Page, name?: string) {
  // Sign in first (each test gets a fresh browser context)
  await signIn(page)

  const projectName = name ?? `qa-test-${Date.now()}`

  // Look up the test user's ID
  const auth = authAdmin()
  const { data: { users } } = await auth.auth.admin.listUsers()
  const testUser = users.find((u) => u.email === EMAIL)
  if (!testUser) throw new Error('Test user not found — run global setup first')

  // Create project directly via admin API. Server action form submission
  // loses Supabase SSR auth cookies in headless CI environments (Next.js
  // server actions read cookies via `await cookies()` which can return
  // stale values after middleware token refresh).
  const supabase = adminClient()
  const webhookSecret = crypto.randomBytes(32).toString('hex')
  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      name: projectName,
      github_repo: 'NikitaDmitrieff/european-art-vault',
      webhook_secret: webhookSecret,
      user_id: testUser.id,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Failed to create project: ${error.message}`)

  // Navigate to the project detail page
  await page.goto(`/projects/${project.id}`)
  await page.waitForLoadState('networkidle')

  return { projectName, url: page.url() }
}

export async function createPipelineProject(page: Page) {
  await signIn(page)

  const projectName = `qa-pipeline-${Date.now()}`

  // Look up the test user's ID
  const auth = authAdmin()
  const { data: { users } } = await auth.auth.admin.listUsers()
  const testUser = users.find((u) => u.email === EMAIL)
  if (!testUser) throw new Error('Test user not found — run global setup first')

  // Create project pointing to the sandbox repo for pipeline E2E tests
  const supabase = adminClient()
  const webhookSecret = process.env.WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex')
  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      name: projectName,
      github_repo: process.env.SANDBOX_REPO || 'NikitaDmitrieff/qa-feedback-sandbox',
      webhook_secret: webhookSecret,
      user_id: testUser.id,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Failed to create pipeline project: ${error.message}`)

  // Copy credentials from an existing project so the managed worker can
  // authenticate Claude CLI when processing jobs for this test project.
  const { data: existingCreds } = await supabase
    .from('credentials')
    .select('type, encrypted_value')
    .eq('type', 'claude_oauth')
    .limit(1)
    .single()

  if (existingCreds) {
    await supabase.from('credentials').insert({
      project_id: project.id,
      type: existingCreds.type,
      encrypted_value: existingCreds.encrypted_value,
    })
  }

  // Navigate to the project detail page
  await page.goto(`/projects/${project.id}`)
  await page.waitForLoadState('networkidle')

  return { projectId: project.id, projectName, webhookSecret, url: page.url() }
}
