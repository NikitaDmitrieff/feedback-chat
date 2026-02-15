/**
 * GitHub issue creator.
 * Reads GITHUB_TOKEN and GITHUB_REPO from environment variables.
 * Returns null gracefully if env vars are missing.
 */
export async function createGitHubIssue({
  title,
  body,
  labels = ['feedback-bot'],
}: {
  title: string
  body: string
  labels?: string[]
}): Promise<string | null> {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPO

  if (!token || !repo) {
    return null
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/issues`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title, body, labels }),
      }
    )

    if (!response.ok) {
      console.error('GitHub issue creation failed:', response.status)
      return null
    }

    const data = await response.json()
    return data.html_url
  } catch (error) {
    console.error('GitHub issue creation error:', error)
    return null
  }
}
