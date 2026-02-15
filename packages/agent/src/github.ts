function getConfig() {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPO
  if (!token || !repo) {
    throw new Error('GITHUB_TOKEN and GITHUB_REPO must be set')
  }
  return { token, repo }
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  }
}

async function ghFetch(url: string, options: RequestInit, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options)
      return res
    } catch (err) {
      if (i === retries - 1) throw err
      console.log(`GitHub API retry ${i + 1}/${retries} for ${url}`)
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)))
    }
  }
  throw new Error('unreachable')
}

export async function commentOnIssue(issueNumber: number, body: string): Promise<void> {
  const { token, repo } = getConfig()
  const res = await ghFetch(
    `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`,
    {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ body }),
    }
  )
  if (!res.ok) {
    console.error(`Failed to comment on issue #${issueNumber}: ${res.status}`)
  }
}

export async function labelIssue(issueNumber: number, labels: string[]): Promise<void> {
  const { token, repo } = getConfig()
  const res = await ghFetch(
    `https://api.github.com/repos/${repo}/issues/${issueNumber}/labels`,
    {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ labels }),
    }
  )
  if (!res.ok) {
    console.error(`Failed to label issue #${issueNumber}: ${res.status}`)
  }
}

export async function closeIssue(issueNumber: number): Promise<void> {
  const { token, repo } = getConfig()
  const res = await ghFetch(
    `https://api.github.com/repos/${repo}/issues/${issueNumber}`,
    {
      method: 'PATCH',
      headers: headers(token),
      body: JSON.stringify({ state: 'closed' }),
    }
  )
  if (!res.ok) {
    console.error(`Failed to close issue #${issueNumber}: ${res.status}`)
  }
}

export async function createPR(
  issueNumber: number,
  title: string,
  body: string
): Promise<{ number: number; html_url: string }> {
  const { token, repo } = getConfig()
  const res = await ghFetch(
    `https://api.github.com/repos/${repo}/pulls`,
    {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({
        title,
        body,
        head: `feedback/issue-${issueNumber}`,
        base: 'main',
      }),
    }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to create PR for issue #${issueNumber}: ${res.status} ${text}`)
  }
  const data = await res.json()
  return { number: data.number, html_url: data.html_url }
}

export async function findOpenPR(
  issueNumber: number
): Promise<{ number: number; html_url: string } | null> {
  const { token, repo } = getConfig()
  const [owner] = repo.split('/')
  const head = `${owner}:feedback/issue-${issueNumber}`
  const res = await ghFetch(
    `https://api.github.com/repos/${repo}/pulls?state=open&head=${encodeURIComponent(head)}`,
    {
      method: 'GET',
      headers: headers(token),
    }
  )
  if (!res.ok) {
    console.error(`Failed to find open PR for issue #${issueNumber}: ${res.status}`)
    return null
  }
  const data = await res.json()
  if (data.length === 0) return null
  return { number: data[0].number, html_url: data[0].html_url }
}

export async function removeLabelFromIssue(
  issueNumber: number,
  label: string
): Promise<void> {
  const { token, repo } = getConfig()
  const res = await ghFetch(
    `https://api.github.com/repos/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
    {
      method: 'DELETE',
      headers: headers(token),
    }
  )
  if (!res.ok && res.status !== 404) {
    console.error(`Failed to remove label '${label}' from issue #${issueNumber}: ${res.status}`)
  }
}

export async function getIssueComments(
  issueNumber: number,
  count = 5
): Promise<{ body: string; created_at: string }[]> {
  const { token, repo } = getConfig()
  const res = await ghFetch(
    `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments?per_page=${count}&sort=created&direction=desc`,
    {
      method: 'GET',
      headers: headers(token),
    }
  )
  if (!res.ok) {
    console.error(`Failed to get comments for issue #${issueNumber}: ${res.status}`)
    return []
  }
  const data = await res.json()
  return data.map((c: { body: string; created_at: string }) => ({
    body: c.body,
    created_at: c.created_at,
  }))
}
