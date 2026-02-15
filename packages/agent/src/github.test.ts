import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  commentOnIssue,
  labelIssue,
  closeIssue,
  createPR,
  findOpenPR,
  removeLabelFromIssue,
  getIssueComments,
} from './github.js'

const mockFetch = vi.fn()
global.fetch = mockFetch

beforeEach(() => {
  vi.stubEnv('GITHUB_TOKEN', 'test-token')
  vi.stubEnv('GITHUB_REPO', 'user/repo')
  mockFetch.mockReset()
})

describe('commentOnIssue', () => {
  it('posts a comment to the correct URL', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })
    await commentOnIssue(42, 'Hello from agent')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/user/repo/issues/42/comments',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ body: 'Hello from agent' }),
      })
    )
  })
})

describe('labelIssue', () => {
  it('adds labels to the issue', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })
    await labelIssue(42, ['in-progress'])
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/user/repo/issues/42/labels',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ labels: ['in-progress'] }),
      })
    )
  })
})

describe('closeIssue', () => {
  it('patches the issue state to closed', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })
    await closeIssue(42)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/user/repo/issues/42',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ state: 'closed' }),
      })
    )
  })
})

describe('createPR', () => {
  it('creates a PR with correct head and base', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ number: 10, html_url: 'https://github.com/user/repo/pull/10' }),
    })
    const result = await createPR(42, 'feat: test', 'Closes #42')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/user/repo/pulls',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          title: 'feat: test',
          body: 'Closes #42',
          head: 'feedback/issue-42',
          base: 'main',
        }),
      })
    )
    expect(result).toEqual({ number: 10, html_url: 'https://github.com/user/repo/pull/10' })
  })

  it('throws on failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 422, text: async () => 'Validation Failed' })
    await expect(createPR(42, 'feat: test', 'body')).rejects.toThrow('Failed to create PR')
  })
})

describe('findOpenPR', () => {
  it('returns PR when one exists', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ number: 10, html_url: 'https://github.com/user/repo/pull/10' }],
    })
    const result = await findOpenPR(42)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/pulls?state=open&head='),
      expect.objectContaining({ method: 'GET' })
    )
    expect(result).toEqual({ number: 10, html_url: 'https://github.com/user/repo/pull/10' })
  })

  it('returns null when no PR exists', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] })
    const result = await findOpenPR(42)
    expect(result).toBeNull()
  })

  it('returns null on API failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    const result = await findOpenPR(42)
    expect(result).toBeNull()
  })
})

describe('removeLabelFromIssue', () => {
  it('sends DELETE to the label endpoint', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })
    await removeLabelFromIssue(42, 'in-progress')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/user/repo/issues/42/labels/in-progress',
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('tolerates 404 (label not present)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
    await removeLabelFromIssue(42, 'in-progress')
  })
})

describe('getIssueComments', () => {
  it('returns mapped comments', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { body: 'comment 1', created_at: '2025-01-01T00:00:00Z', id: 1, user: {} },
        { body: 'comment 2', created_at: '2025-01-02T00:00:00Z', id: 2, user: {} },
      ],
    })
    const result = await getIssueComments(42, 5)
    expect(result).toEqual([
      { body: 'comment 1', created_at: '2025-01-01T00:00:00Z' },
      { body: 'comment 2', created_at: '2025-01-02T00:00:00Z' },
    ])
  })

  it('returns empty array on failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    const result = await getIssueComments(42)
    expect(result).toEqual([])
  })
})
