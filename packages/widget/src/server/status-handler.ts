export type StatusHandlerConfig = {
  /** Password required for POST actions */
  password: string
  /** GitHub configuration. If not provided, reads from GITHUB_TOKEN / GITHUB_REPO env vars */
  github?: {
    token: string
    repo: string
  }
  /** Agent URL for checking if the agent is currently running a job */
  agentUrl?: string
}

export type Stage =
  | 'created'
  | 'queued'
  | 'running'
  | 'validating'
  | 'preview_ready'
  | 'deployed'
  | 'failed'
  | 'rejected'

export type StatusResponse = {
  stage: Stage
  issueNumber: number
  issueUrl: string
  failReason?: string
  previewUrl?: string
  prNumber?: number
  prUrl?: string
}

type GitHubConfig = { repo: string; token: string }

const GITHUB_API = 'https://api.github.com/repos'

function issueEndpoint(config: GitHubConfig, issueNumber: number): string {
  return `${GITHUB_API}/${config.repo}/issues/${issueNumber}`
}

function parseIssueNumber(param: string | null): number | null {
  if (!param) return null
  const n = parseInt(param, 10)
  return isNaN(n) ? null : n
}

function githubHeaders(token: string, withBody = false): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
  }
  if (withBody) {
    headers['Content-Type'] = 'application/json'
  }
  return headers
}

async function getIssue(config: GitHubConfig, issueNumber: number) {
  const res = await fetch(issueEndpoint(config, issueNumber), {
    headers: githubHeaders(config.token),
    cache: 'no-store',
  })
  if (!res.ok) return null
  return res.json()
}

async function findPR(
  config: GitHubConfig,
  issueNumber: number,
): Promise<{ number: number; html_url: string; head_sha: string } | null> {
  const [owner] = config.repo.split('/')
  const res = await fetch(
    `${GITHUB_API}/${config.repo}/pulls?head=${owner}:feedback/issue-${issueNumber}&state=open`,
    { headers: githubHeaders(config.token), cache: 'no-store' },
  )
  if (!res.ok) return null
  const pulls = await res.json()
  if (!Array.isArray(pulls) || pulls.length === 0) return null
  const pr = pulls[0]
  return { number: pr.number, html_url: pr.html_url, head_sha: pr.head?.sha }
}

async function getPreviewUrl(
  config: GitHubConfig,
  sha: string,
): Promise<string | null> {
  const res = await fetch(
    `${GITHUB_API}/${config.repo}/deployments?sha=${sha}&per_page=5`,
    { headers: githubHeaders(config.token), cache: 'no-store' },
  )
  if (!res.ok) return null
  const deployments = await res.json()
  if (!Array.isArray(deployments)) return null

  for (const deployment of deployments) {
    const statusRes = await fetch(deployment.statuses_url, {
      headers: githubHeaders(config.token),
      cache: 'no-store',
    })
    if (!statusRes.ok) continue
    const statuses = await statusRes.json()
    const success = statuses.find(
      (s: { state: string; environment_url?: string }) =>
        s.state === 'success' && s.environment_url,
    )
    if (success) return success.environment_url
  }
  return null
}

async function getFailReason(config: GitHubConfig, issueNumber: number): Promise<string | undefined> {
  const res = await fetch(
    `${issueEndpoint(config, issueNumber)}/comments?per_page=5&direction=desc`,
    { headers: githubHeaders(config.token), cache: 'no-store' },
  )
  if (!res.ok) return undefined
  const comments = await res.json()
  const failComment = comments.find((c: { body?: string }) =>
    c.body?.startsWith('Agent failed:'),
  )
  return failComment?.body?.replace('Agent failed:', '').trim()
}

async function isAgentRunning(agentUrl: string | undefined, issueNumber: number): Promise<boolean> {
  if (!agentUrl) return false
  try {
    const res = await fetch(`${agentUrl}/health`, { cache: 'no-store' })
    if (!res.ok) return false
    const data = await res.json()
    return data.currentJob === issueNumber
  } catch {
    return false
  }
}

type DeriveResult = Omit<StatusResponse, 'issueNumber'>

async function deriveStage(
  config: GitHubConfig,
  issueNumber: number,
  agentUrl?: string,
): Promise<DeriveResult | null> {
  const issue = await getIssue(config, issueNumber)
  if (!issue) return null

  const labels: string[] = (issue.labels ?? []).map((l: { name: string }) => l.name)
  const issueUrl: string = issue.html_url

  if (labels.includes('agent-failed')) {
    const failReason = await getFailReason(config, issueNumber)
    return { stage: 'failed', issueUrl, failReason }
  }

  if (labels.includes('rejected')) {
    return { stage: 'rejected', issueUrl }
  }

  if (issue.state === 'closed') {
    return { stage: 'deployed', issueUrl }
  }

  if (await isAgentRunning(agentUrl, issueNumber)) {
    return { stage: 'running', issueUrl }
  }

  if (labels.includes('preview-pending')) {
    const pr = await findPR(config, issueNumber)
    if (pr) {
      const previewUrl = await getPreviewUrl(config, pr.head_sha)
      if (previewUrl) {
        return {
          stage: 'preview_ready',
          issueUrl,
          previewUrl,
          prNumber: pr.number,
          prUrl: pr.html_url,
        }
      }
    }
    return { stage: 'validating', issueUrl }
  }

  if (labels.includes('in-progress')) {
    return { stage: 'validating', issueUrl }
  }

  if (labels.includes('feedback-bot')) {
    return { stage: 'queued', issueUrl }
  }

  return { stage: 'created', issueUrl }
}

async function closeAndReopenIssue(
  url: string,
  headers: Record<string, string>,
): Promise<Response | null> {
  const closeRes = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ state: 'closed' }),
  })
  if (!closeRes.ok) {
    return Response.json({ error: 'Failed to close issue' }, { status: 500 })
  }

  await new Promise((resolve) => setTimeout(resolve, 1000))

  const reopenRes = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ state: 'open' }),
  })
  if (!reopenRes.ok) {
    return Response.json({ error: 'Failed to reopen issue' }, { status: 500 })
  }

  return null
}

function deleteFeedbackBranch(
  config: GitHubConfig,
  issueNumber: number,
  headers: Record<string, string>,
): Promise<globalThis.Response> {
  return fetch(
    `${GITHUB_API}/${config.repo}/git/refs/heads/feedback/issue-${issueNumber}`,
    { method: 'DELETE', headers },
  )
}

async function handleRetry(config: GitHubConfig, issueNumber: number): Promise<Response> {
  const headers = githubHeaders(config.token, true)
  const url = issueEndpoint(config, issueNumber)

  for (const label of ['agent-failed', 'in-progress']) {
    const res = await fetch(`${url}/labels/${encodeURIComponent(label)}`, {
      method: 'DELETE',
      headers,
    })
    if (!res.ok && res.status !== 404) {
      return Response.json({ error: 'Failed to remove labels' }, { status: 500 })
    }
  }

  const error = await closeAndReopenIssue(url, headers)
  if (error) return error

  return Response.json({ retried: true })
}

async function handleApprove(config: GitHubConfig, issueNumber: number): Promise<Response> {
  const headers = githubHeaders(config.token, true)
  const url = issueEndpoint(config, issueNumber)

  const pr = await findPR(config, issueNumber)
  if (!pr) {
    return Response.json({ error: 'Pull request not found' }, { status: 404 })
  }

  const mergeRes = await fetch(
    `${GITHUB_API}/${config.repo}/pulls/${pr.number}/merge`,
    {
      method: 'PUT',
      headers,
      body: JSON.stringify({ merge_method: 'squash' }),
    },
  )
  if (!mergeRes.ok) {
    if (mergeRes.status === 409) {
      return Response.json(
        { error: 'Merge conflict — contact administrator' },
        { status: 409 },
      )
    }
    return Response.json({ error: 'Merge failed' }, { status: 500 })
  }

  await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ state: 'closed' }),
  })

  await deleteFeedbackBranch(config, issueNumber, headers)

  return Response.json({ approved: true })
}

async function handleReject(config: GitHubConfig, issueNumber: number): Promise<Response> {
  const headers = githubHeaders(config.token, true)
  const url = issueEndpoint(config, issueNumber)

  const pr = await findPR(config, issueNumber)
  if (pr) {
    await fetch(`${GITHUB_API}/${config.repo}/pulls/${pr.number}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ state: 'closed' }),
    })
  }

  await fetch(`${url}/labels`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ labels: ['rejected'] }),
  })

  await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ state: 'closed' }),
  })

  await deleteFeedbackBranch(config, issueNumber, headers)

  return Response.json({ rejected: true })
}

async function handleRequestChanges(
  config: GitHubConfig,
  issueNumber: number,
  comment?: string,
): Promise<Response> {
  const headers = githubHeaders(config.token, true)
  const url = issueEndpoint(config, issueNumber)

  if (comment) {
    await fetch(`${url}/comments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ body: `**Changes requested:**\n\n${comment}` }),
    })
  }

  await fetch(`${url}/labels/${encodeURIComponent('preview-pending')}`, {
    method: 'DELETE',
    headers,
  })

  await fetch(`${url}/labels`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ labels: ['auto-implement'] }),
  })

  const error = await closeAndReopenIssue(url, headers)
  if (error) return error

  return Response.json({ requested_changes: true })
}

const VALID_ACTIONS = ['retry', 'approve', 'reject', 'request_changes'] as const
type Action = (typeof VALID_ACTIONS)[number]

function resolveGitHubConfig(config: StatusHandlerConfig): GitHubConfig | null {
  if (config.github) {
    return config.github
  }
  const repo = process.env.GITHUB_REPO
  const token = process.env.GITHUB_TOKEN
  if (!repo || !token) return null
  return { repo, token }
}

function resolveAgentUrl(config: StatusHandlerConfig): string | undefined {
  return config.agentUrl ?? process.env.AGENT_URL
}

/**
 * Creates Next.js App Router GET and POST handlers for the feedback status endpoint.
 * Returns `{ GET, POST }` ready to be exported from a route.ts file.
 *
 * GET /api/feedback/status?issue=N — returns current pipeline stage
 * POST /api/feedback/status?action=retry|approve|reject|request_changes&issue=N — performs action
 */
export function createStatusHandler(config: StatusHandlerConfig) {
  const GET = async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    const issueNumber = parseIssueNumber(url.searchParams.get('issue'))
    if (!issueNumber) {
      return Response.json({ error: 'Missing or invalid issue parameter' }, { status: 400 })
    }

    const ghConfig = resolveGitHubConfig(config)
    if (!ghConfig) {
      return Response.json({ error: 'GitHub not configured' }, { status: 500 })
    }

    const agentUrl = resolveAgentUrl(config)
    const result = await deriveStage(ghConfig, issueNumber, agentUrl)
    if (!result) {
      return Response.json({ error: 'Issue not found' }, { status: 404 })
    }

    const response: StatusResponse = { issueNumber, ...result }
    return Response.json(response)
  }

  const POST = async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    const action = url.searchParams.get('action') as Action | null
    if (!action || !VALID_ACTIONS.includes(action)) {
      return Response.json({ error: 'Invalid action' }, { status: 400 })
    }

    const issueNumber = parseIssueNumber(url.searchParams.get('issue'))
    if (!issueNumber) {
      return Response.json({ error: 'Missing or invalid issue parameter' }, { status: 400 })
    }

    let body: { password?: string; comment?: string } = {}
    try {
      body = await req.json()
    } catch {
      // Body may be empty for older retry calls
    }

    if (!config.password || body.password !== config.password) {
      return Response.json({ error: 'Invalid password' }, { status: 401 })
    }

    const ghConfig = resolveGitHubConfig(config)
    if (!ghConfig) {
      return Response.json({ error: 'GitHub not configured' }, { status: 500 })
    }

    switch (action) {
      case 'retry':
        return handleRetry(ghConfig, issueNumber)
      case 'approve':
        return handleApprove(ghConfig, issueNumber)
      case 'reject':
        return handleReject(ghConfig, issueNumber)
      case 'request_changes':
        return handleRequestChanges(ghConfig, issueNumber, body.comment)
    }
  }

  return { GET, POST }
}
