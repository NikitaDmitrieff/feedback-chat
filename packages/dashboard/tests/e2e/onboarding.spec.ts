import { test, expect } from '@playwright/test'

const EMAIL = process.env.QA_TEST_EMAIL || 'qa-bot@feedback.chat'
const PASSWORD = process.env.QA_TEST_PASSWORD || 'qa-test-password-2026'

test.describe('Onboarding flow', () => {
  test('Step 1: can sign in to the dashboard', async ({ page }) => {
    await page.goto('/login')

    // Should see the login page
    await expect(page.locator('text=Feedback Chat')).toBeVisible()
    await expect(page.locator('text=Sign in')).toBeVisible()

    // Fill credentials
    await page.fill('[placeholder="Email address"]', EMAIL)
    await page.fill('[placeholder="Password"]', PASSWORD)
    await page.click('button[type="submit"]')

    // Should redirect to /projects
    await page.waitForURL('**/projects', { timeout: 10_000 })
    await expect(page.locator('text=Projects')).toBeVisible()
  })
})
