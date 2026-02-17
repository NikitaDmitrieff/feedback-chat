import { test, expect } from '@playwright/test'
import { createPipelineProject } from './helpers/auth'
import {
  findIssueByTitle,
  waitForLabel,
  findPR,
  getIssueState,
  closeArtifacts,
  waitForDeployment,
  createWebhook,
  deleteWebhook,
  createIssue,
  mergePR,
} from './helpers/pipeline'
import { verifySandboxClean, resetSandbox, cleanSandboxArtifacts } from './helpers/sandbox'
import { cleanupTestProjects } from './helpers/seed'

const SANDBOX_REPO = process.env.SANDBOX_REPO || 'NikitaDmitrieff/qa-feedback-sandbox'
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://loop.joincoby.com'

// ---------------------------------------------------------------------------
// Shared state across serial steps
// ---------------------------------------------------------------------------

let projectId: string
let webhookId: number
let issueNumber: number
let prNumber: number | null = null
let previewUrl: string

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Pipeline E2E — serial steps
// ---------------------------------------------------------------------------

test.describe.serial('Pipeline E2E', () => {
  test.beforeAll(async () => {
    await cleanupTestProjects()
    await verifySandboxClean()
  })

  test.afterAll(async () => {
    try {
      if (webhookId) await deleteWebhook(SANDBOX_REPO, webhookId)
      if (issueNumber) await closeArtifacts(SANDBOX_REPO, issueNumber, prNumber)
      await cleanSandboxArtifacts()
      await resetSandbox()
      await cleanupTestProjects()
    } catch {
      // Cleanup errors must not mask test failures
    }
  })

  test('Step 1: Create project, webhook, and GitHub issue', async ({ page }) => {
    test.setTimeout(60_000)

    // Create a pipeline project on the dashboard (needed for webhook routing)
    const result = await createPipelineProject(page)
    projectId = result.projectId

    // Create a webhook on the sandbox repo pointing to the dashboard webhook endpoint.
    // The dashboard receives the issue event and enqueues a job for the worker.
    const webhookUrl = `${DASHBOARD_URL}/api/webhook/${projectId}`
    webhookId = await createWebhook(SANDBOX_REPO, webhookUrl, result.webhookSecret)

    // Create the issue directly via GitHub API (matches widget's submit_request format).
    // This triggers the webhook → dashboard enqueues → agent picks up.
    const prompt =
      'Add a footer element with id="qa-test-footer" that says "Built with feedback-chat" ' +
      'to the main page (app/page.tsx). Add <footer id="qa-test-footer">Built with feedback-chat</footer> ' +
      'before the closing </main> tag.'
    const issue = await createIssue(SANDBOX_REPO, prompt)

    expect(issue.number).toBeGreaterThan(0)
    expect(issue.labels).toContain('feedback-bot')
    expect(issue.labels).toContain('auto-implement')
    issueNumber = issue.number
  })

  test('Step 2: Agent picks up the issue', async () => {
    test.setTimeout(90_000)
    expect(issueNumber, 'issueNumber must be set by Step 1').toBeTruthy()

    const issue = await waitForLabel(SANDBOX_REPO, issueNumber, 'in-progress', 60_000)
    expect(issue.labels).toContain('in-progress')
  })

  test('Step 3: Agent completes implementation', async () => {
    test.setTimeout(240_000)
    expect(issueNumber, 'issueNumber must be set by Step 1').toBeTruthy()

    const issue = await waitForLabel(SANDBOX_REPO, issueNumber, 'preview-pending', 210_000)
    expect(issue.labels).toContain('preview-pending')

    // Find the PR created by the agent
    const branch = `feedback/issue-${issueNumber}`
    const pr = await findPR(SANDBOX_REPO, branch)
    expect(pr, `Expected an open PR from branch "${branch}"`).toBeTruthy()
    prNumber = pr!.number
  })

  test('Step 4: Vercel preview deploys successfully', async () => {
    test.setTimeout(180_000)
    expect(prNumber, 'prNumber must be set by Step 3').toBeTruthy()

    // Get the PR's head SHA for deployment lookup
    const pr = await findPR(SANDBOX_REPO, `feedback/issue-${issueNumber}`)
    expect(pr).toBeTruthy()

    // Poll for a successful deployment on the PR's head SHA
    previewUrl = await waitForDeployment(SANDBOX_REPO, pr!.head_sha, 150_000)
    expect(previewUrl).toBeTruthy()
    expect(previewUrl).toContain('https://')
  })

  test('Step 5: Preview contains the expected change', async ({ page }) => {
    test.setTimeout(30_000)
    expect(previewUrl, 'previewUrl must be set by Step 4').toBeTruthy()

    // Navigate to the preview URL
    await page.goto(previewUrl)
    await page.waitForLoadState('networkidle')

    // Verify the footer element exists with correct text
    const footer = page.locator('#qa-test-footer')
    await expect(footer).toBeVisible({ timeout: 10_000 })
    await expect(footer).toContainText('Built with feedback-chat')
  })

  test('Step 6: Merge the PR and close the issue', async () => {
    test.setTimeout(30_000)
    expect(issueNumber, 'issueNumber must be set by Step 1').toBeTruthy()
    expect(prNumber, 'prNumber must be set by Step 3').toBeTruthy()

    // Merge the PR via GitHub API (squash merge)
    await mergePR(SANDBOX_REPO, prNumber!)

    // Close the issue (agent normally does this, but we're testing the pipeline)
    await closeArtifacts(SANDBOX_REPO, issueNumber, null)

    // Verify: issue is closed
    await sleep(2_000) // allow GitHub to process
    const issueState = await getIssueState(SANDBOX_REPO, issueNumber)
    expect(issueState.state).toBe('closed')
  })

  test('Step 7: Cleanup — reset sandbox to known-good state', async () => {
    test.setTimeout(30_000)

    // Delete the dynamic webhook
    if (webhookId) await deleteWebhook(SANDBOX_REPO, webhookId)

    // Close any remaining artifacts
    if (issueNumber) {
      await closeArtifacts(SANDBOX_REPO, issueNumber, prNumber)
    }
    await cleanSandboxArtifacts()
    await resetSandbox()

    // Verify sandbox is clean
    const issue = await findIssueByTitle(SANDBOX_REPO, '[Feedback]')
    expect(issue).toBeNull()
  })
})
