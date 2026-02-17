/**
 * GitHub REST API helpers for pipeline E2E tests.
 *
 * All functions use raw fetch — no `gh` CLI dependency.
 * Expects GITHUB_TOKEN or GH_TOKEN in the environment.
 */

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
const API = 'https://api.github.com'

function headers(): Record<string, string> {
  return {
    Authorization: `token ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IssueState {
  number: number
  state: 'open' | 'closed'
  labels: string[]
}

export interface PRInfo {
  number: number
  html_url: string
  head_sha: string
}

// ---------------------------------------------------------------------------
// Issue helpers
// ---------------------------------------------------------------------------

export async function getIssueState(repo: string, issueNumber: number): Promise<IssueState> {
  const res = await fetch(`${API}/repos/${repo}/issues/${issueNumber}`, {
    headers: headers(),
  })
  if (!res.ok) {
    throw new Error(`getIssueState failed: ${res.status} ${await res.text()}`)
  }
  const data = await res.json()
  return {
    number: data.number,
    state: data.state as 'open' | 'closed',
    labels: (data.labels as Array<{ name: string }>).map((l) => l.name),
  }
}

/**
 * Poll an issue until the given label appears.
 * Returns early if `agent-failed` is detected (throws).
 */
export async function waitForLabel(
  repo: string,
  issueNumber: number,
  label: string,
  timeoutMs: number = 120_000,
): Promise<IssueState> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const issue = await getIssueState(repo, issueNumber)

    if (issue.labels.includes(label)) {
      return issue
    }

    // Early exit if the agent failed
    if (label !== 'agent-failed' && issue.labels.includes('agent-failed')) {
      throw new Error(
        `waitForLabel: agent-failed detected on issue #${issueNumber} while waiting for "${label}"`,
      )
    }

    await sleep(5_000)
  }

  throw new Error(
    `waitForLabel: timed out after ${timeoutMs}ms waiting for label "${label}" on issue #${issueNumber}`,
  )
}

/**
 * Find the most recent open issue whose title starts with the given prefix.
 * Skips pull requests (GitHub returns PRs in the issues endpoint too).
 */
export async function findIssueByTitle(
  repo: string,
  titlePrefix: string,
): Promise<IssueState | null> {
  const res = await fetch(
    `${API}/repos/${repo}/issues?state=open&sort=created&direction=desc&per_page=30`,
    { headers: headers() },
  )
  if (!res.ok) {
    throw new Error(`findIssueByTitle failed: ${res.status} ${await res.text()}`)
  }

  const issues = (await res.json()) as Array<{
    number: number
    title: string
    state: string
    labels: Array<{ name: string }>
    pull_request?: unknown
  }>

  for (const issue of issues) {
    // Skip pull requests — they also appear in the issues endpoint
    if (issue.pull_request) continue

    if (issue.title.startsWith(titlePrefix)) {
      return {
        number: issue.number,
        state: issue.state as 'open' | 'closed',
        labels: issue.labels.map((l) => l.name),
      }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// PR helpers
// ---------------------------------------------------------------------------

export async function findPR(repo: string, branch: string): Promise<PRInfo | null> {
  const owner = repo.split('/')[0]
  const res = await fetch(
    `${API}/repos/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open`,
    { headers: headers() },
  )
  if (!res.ok) {
    throw new Error(`findPR failed: ${res.status} ${await res.text()}`)
  }

  const pulls = (await res.json()) as Array<{
    number: number
    html_url: string
    head: { sha: string }
  }>

  if (pulls.length === 0) return null

  return {
    number: pulls[0].number,
    html_url: pulls[0].html_url,
    head_sha: pulls[0].head.sha,
  }
}

// ---------------------------------------------------------------------------
// Deployment helpers
// ---------------------------------------------------------------------------

/**
 * Poll deployments for the given SHA until one reaches "success" with an
 * environment_url (the Vercel preview URL).
 */
export async function waitForDeployment(
  repo: string,
  headSha: string,
  timeoutMs: number = 300_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const res = await fetch(`${API}/repos/${repo}/deployments?sha=${headSha}&per_page=10`, {
      headers: headers(),
    })
    if (!res.ok) {
      throw new Error(`waitForDeployment: deployments fetch failed: ${res.status}`)
    }

    const deployments = (await res.json()) as Array<{ id: number; statuses_url: string }>

    for (const deployment of deployments) {
      const statusRes = await fetch(deployment.statuses_url, { headers: headers() })
      if (!statusRes.ok) continue

      const statuses = (await statusRes.json()) as Array<{
        state: string
        environment_url?: string
      }>

      // Statuses are returned newest-first
      const success = statuses.find(
        (s) => s.state === 'success' && s.environment_url,
      )
      if (success) {
        return success.environment_url!
      }
    }

    await sleep(10_000)
  }

  throw new Error(
    `waitForDeployment: timed out after ${timeoutMs}ms waiting for deployment of ${headSha}`,
  )
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Close test artifacts: close the PR (if any), close the issue, and delete
 * the feature branch (feedback/issue-{N}).
 */
export async function closeArtifacts(
  repo: string,
  issueNumber: number,
  prNumber: number | null,
): Promise<void> {
  // Close PR if it exists
  if (prNumber) {
    await fetch(`${API}/repos/${repo}/pulls/${prNumber}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ state: 'closed' }),
    })
  }

  // Close the issue
  await fetch(`${API}/repos/${repo}/issues/${issueNumber}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ state: 'closed' }),
  })

  // Delete the feature branch
  const branch = `feedback/issue-${issueNumber}`
  await fetch(`${API}/repos/${repo}/git/refs/heads/${branch}`, {
    method: 'DELETE',
    headers: headers(),
  })
  // Branch deletion may 422 if it doesn't exist — that's fine
}

// ---------------------------------------------------------------------------
// Webhook management (dynamic per test run)
// ---------------------------------------------------------------------------

/**
 * Create a webhook on the sandbox repo pointing to the dashboard webhook endpoint.
 * The webhook URL includes the projectId so the dashboard knows which project to enqueue for.
 * Returns the webhook ID for later deletion.
 */
export async function createWebhook(
  repo: string,
  webhookUrl: string,
  secret: string,
): Promise<number> {
  const res = await fetch(`${API}/repos/${repo}/hooks`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      name: 'web',
      active: true,
      config: {
        url: webhookUrl,
        content_type: 'json',
        secret,
      },
      events: ['issues'],
    }),
  })
  if (!res.ok) {
    throw new Error(`createWebhook failed: ${res.status} ${await res.text()}`)
  }
  const data = await res.json()
  return data.id as number
}

/**
 * Delete a webhook from a repo.
 */
export async function deleteWebhook(repo: string, webhookId: number): Promise<void> {
  await fetch(`${API}/repos/${repo}/hooks/${webhookId}`, {
    method: 'DELETE',
    headers: headers(),
  })
  // 404 is fine — already deleted
}
