import crypto from 'node:crypto'

export function verifySignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  if (!signature) return false

  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(payload)
  const expected = `sha256=${hmac.digest('hex')}`

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    )
  } catch {
    return false
  }
}

interface WebhookIssuePayload {
  action: string
  issue: {
    number: number
    title?: string
    body?: string
    labels: Array<{ name: string }>
  }
}

export function shouldProcessEvent(
  event: string,
  payload: WebhookIssuePayload | Record<string, unknown>
): boolean {
  if (event !== 'issues') return false

  const p = payload as WebhookIssuePayload
  if (!p.issue?.labels) return false

  const labelNames = p.issue.labels.map((l) => l.name)

  // Accept: opened, reopened, or labeled with auto-implement
  const isOpenOrReopen = p.action === 'opened' || p.action === 'reopened'
  const isAutoImplementLabeled = p.action === 'labeled' && labelNames.includes('auto-implement')

  if (!isOpenOrReopen && !isAutoImplementLabeled) return false

  if (!labelNames.includes('feedback-bot')) return false
  if (labelNames.includes('in-progress')) return false
  if (labelNames.includes('agent-failed')) return false

  return true
}
