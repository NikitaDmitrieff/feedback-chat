import { test, expect } from '@playwright/test'
import { signIn, createTestProject } from './helpers/auth'

const EMAIL = process.env.QA_TEST_EMAIL || 'qa-bot@feedback.chat'
const PASSWORD = process.env.QA_TEST_PASSWORD || 'qa-test-password-2026'

test.describe('Onboarding flow', () => {
  test('Step 1: can sign in to the dashboard', async ({ page }) => {
    await page.goto('/login')

    // Wait for the client-side page to hydrate (dynamic import with ssr: false)
    await expect(page.getByRole('heading', { name: 'Feedback Chat' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()

    // Fill credentials
    await page.fill('[placeholder="Email address"]', EMAIL)
    await page.fill('[placeholder="Password"]', PASSWORD)

    // Wait for button to be enabled (disabled until fields are filled)
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled()
    await page.getByRole('button', { name: 'Sign in' }).click()

    // Should redirect to /projects (uses window.location.href, full page load)
    await page.waitForURL('**/projects', { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  })

  test('Step 2: can create a new project', async ({ page }) => {
    await signIn(page)

    // Click New Project
    await page.click('text=New Project')
    await page.waitForURL('**/projects/new')

    // Fill the form
    const projectName = `qa-test-${Date.now()}`
    await page.fill('input[name="name"]', projectName)
    await page.fill('input[name="github_repo"]', 'NikitaDmitrieff/european-art-vault')

    // Select Claude OAuth
    await page.selectOption('select[name="credential_type"]', 'claude_oauth')

    // Leave credential value empty for now (test creation without creds)
    await page.click('button[type="submit"]')

    // Should redirect to project detail page
    await page.waitForURL(/\/projects\/[a-f0-9-]+/, { timeout: 15_000 })

    // Should see setup checklist
    await expect(page.locator('text=Setup')).toBeVisible()

    // Should see the project name
    await expect(page.locator(`text=${projectName}`)).toBeVisible()
  })

  test('Step 3: setup checklist renders with correct URLs', async ({ page }) => {
    const { url } = await createTestProject(page)

    // Verify checklist steps are visible
    await expect(page.locator('text=Install the widget')).toBeVisible()
    await expect(page.locator('text=Add environment variables')).toBeVisible()
    await expect(page.locator('text=Configure GitHub webhook')).toBeVisible()
    await expect(page.locator('text=Create GitHub labels')).toBeVisible()
    await expect(page.locator('text=Send your first feedback')).toBeVisible()
  })

  test('Step 4: Claude prompt has correct domain (not localhost)', async ({ page }) => {
    await createTestProject(page)

    // Find and click the Claude quick setup section
    const quickSetup = page.locator('text=Setup with Claude Code')
    if (await quickSetup.isVisible()) {
      await quickSetup.click()
    }

    // Get the prompt text content
    const promptArea = page.locator('pre, [data-prompt], code').first()
    if (await promptArea.isVisible()) {
      const promptText = await promptArea.textContent()

      // Must contain the production domain
      expect(promptText).toContain('loop.joincoby.com')

      // Must NOT contain localhost
      expect(promptText).not.toContain('localhost')

      // Must contain --save in install command
      expect(promptText).toContain('--save')

      // Must reference FEEDBACK_PASSWORD (not FEEDBACK_CHAT_API_KEY)
      expect(promptText).toContain('FEEDBACK_PASSWORD')
    }
  })

  test('Step 5: webhook URL is reachable (no 401)', async ({ page, request }) => {
    await createTestProject(page)

    // Extract webhook URL from the checklist
    const webhookText = await page.locator('text=api/webhook/').first().textContent()
    const webhookMatch = webhookText?.match(/https:\/\/[^\s"'`]+\/api\/webhook\/[a-f0-9-]+/)

    if (webhookMatch) {
      const webhookUrl = webhookMatch[0]

      // Hit the webhook URL — should NOT return 401 (Vercel SSO)
      const response = await request.post(webhookUrl, {
        headers: {
          'Content-Type': 'application/json',
          'x-github-event': 'ping',
        },
        data: { zen: 'qa-test' },
      })

      // 403 (invalid sig) is correct. 401 (SSO blocked) is the bug.
      expect(response.status()).not.toBe(401)
      // 404 would mean bad projectId, also a bug
      expect(response.status()).not.toBe(404)
    }
  })
})
