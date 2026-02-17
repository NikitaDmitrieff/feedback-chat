import { Page, expect } from '@playwright/test'

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
}

export async function createTestProject(page: Page, name?: string) {
  const projectName = name ?? `qa-test-${Date.now()}`
  await page.goto('/projects/new')
  await page.waitForLoadState('networkidle')
  await page.fill('input[name="name"]', projectName)
  await page.fill('input[name="github_repo"]', 'NikitaDmitrieff/european-art-vault')
  await page.selectOption('select[name="credential_type"]', 'claude_oauth')
  await page.click('button[type="submit"]')

  // Server action redirects on success; if it stays on /new, the action failed
  try {
    await page.waitForURL(/\/projects\/[a-f0-9-]+/, { timeout: 15_000 })
  } catch {
    // Capture page content for debugging
    const url = page.url()
    const bodyText = await page.locator('body').textContent()
    throw new Error(
      `Project creation failed — page stayed on ${url}.\n` +
      `Page content: ${bodyText?.slice(0, 500)}`
    )
  }
  return { projectName, url: page.url() }
}
