import { test, expect } from '@playwright/test'
import { createPipelineProject } from './helpers/auth'
import { findIssueByTitle, waitForLabel, findPR } from './helpers/pipeline'
import { verifySandboxClean, resetSandbox, cleanSandboxArtifacts } from './helpers/sandbox'
import { closeArtifacts } from './helpers/pipeline'

const SANDBOX_REPO = process.env.SANDBOX_REPO || 'NikitaDmitrieff/qa-feedback-sandbox'
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || 'qa-test-password-2026'

// ---------------------------------------------------------------------------
// Shared state across serial steps
// ---------------------------------------------------------------------------

let projectId: string
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
    await verifySandboxClean()
  })

  test.afterAll(async () => {
    try {
      if (issueNumber) {
        await closeArtifacts(SANDBOX_REPO, issueNumber, prNumber)
      }
      await cleanSandboxArtifacts()
      await resetSandbox()
    } catch {
      // Cleanup errors must not mask test failures
    }
  })

  test('Step 1: Submit feedback that creates a GitHub issue', async ({ page }) => {
    test.setTimeout(60_000)

    // Create a pipeline project and navigate to it
    const result = await createPipelineProject(page)
    projectId = result.projectId

    // Open the feedback panel via the trigger bar button
    const triggerBar = page.locator('.feedback-trigger-bar button')
    await triggerBar.waitFor({ state: 'visible', timeout: 15_000 })
    await triggerBar.click()

    // Wait for the feedback panel to appear
    const panel = page.locator('.feedback-panel')
    await panel.waitFor({ state: 'visible', timeout: 10_000 })

    // Enter the password in the password gate
    const passwordInput = panel.locator('input[type="password"]')
    await passwordInput.waitFor({ state: 'visible', timeout: 5_000 })
    await passwordInput.fill(QA_TEST_PASSWORD)
    await passwordInput.press('Enter')

    // Wait for the chat input to appear (password accepted)
    const chatInput = panel.locator('textarea, [role="textbox"]')
    await chatInput.waitFor({ state: 'visible', timeout: 10_000 })

    // Type and send the feedback message
    const feedbackMessage =
      'I need a small change: add a footer element with id=\'qa-test-footer\' that says ' +
      '\'Built with feedback-chat\' to the main page (app/page.tsx). This is a simple HTML ' +
      'addition, just add <footer id="qa-test-footer">Built with feedback-chat</footer> ' +
      'before the closing </main> tag.'
    await chatInput.fill(feedbackMessage)
    await chatInput.press('Enter')

    // Poll GitHub for the issue (the AI calls submit_request which creates it)
    let issue: Awaited<ReturnType<typeof findIssueByTitle>> = null
    for (let attempt = 0; attempt < 12; attempt++) {
      issue = await findIssueByTitle(SANDBOX_REPO, '[Feedback]')
      if (issue) break
      await sleep(5_000)
    }

    expect(issue, 'Expected a GitHub issue with "[Feedback]" prefix to be created').toBeTruthy()
    issueNumber = issue!.number
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
    expect(issue.labels).not.toContain('in-progress')

    // Find the PR created by the agent
    const branch = `feedback/issue-${issueNumber}`
    const pr = await findPR(SANDBOX_REPO, branch)
    expect(pr, `Expected an open PR from branch "${branch}"`).toBeTruthy()
    prNumber = pr!.number
  })
})
