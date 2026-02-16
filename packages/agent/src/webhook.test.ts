import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import { verifySignature, shouldProcessEvent } from './webhook.js'

const SECRET = 'test-secret'

function sign(payload: string): string {
  const hmac = crypto.createHmac('sha256', SECRET)
  hmac.update(payload)
  return `sha256=${hmac.digest('hex')}`
}

describe('verifySignature', () => {
  it('accepts a valid signature', () => {
    const payload = '{"action":"opened"}'
    const signature = sign(payload)
    expect(verifySignature(payload, signature, SECRET)).toBe(true)
  })

  it('rejects an invalid signature', () => {
    const payload = '{"action":"opened"}'
    expect(verifySignature(payload, 'sha256=invalid', SECRET)).toBe(false)
  })

  it('rejects a missing signature', () => {
    expect(verifySignature('{}', '', SECRET)).toBe(false)
  })
})

describe('shouldProcessEvent', () => {
  it('accepts an opened issue with feedback-bot label', () => {
    const payload = {
      action: 'opened',
      issue: {
        number: 1,
        labels: [{ name: 'feedback-bot' }],
      },
    }
    expect(shouldProcessEvent('issues', payload)).toBe(true)
  })

  it('rejects non-issues events', () => {
    expect(shouldProcessEvent('push', {})).toBe(false)
  })

  it('accepts a labeled event with auto-implement + feedback-bot', () => {
    const payload = {
      action: 'labeled',
      issue: {
        number: 1,
        labels: [{ name: 'feedback-bot' }, { name: 'auto-implement' }],
      },
    }
    expect(shouldProcessEvent('issues', payload)).toBe(true)
  })

  it('rejects a labeled event without auto-implement', () => {
    const payload = {
      action: 'labeled',
      issue: {
        number: 1,
        labels: [{ name: 'feedback-bot' }, { name: 'bug' }],
      },
    }
    expect(shouldProcessEvent('issues', payload)).toBe(false)
  })

  it('rejects non-opened/labeled actions', () => {
    const payload = {
      action: 'closed',
      issue: { number: 1, labels: [{ name: 'feedback-bot' }] },
    }
    expect(shouldProcessEvent('issues', payload)).toBe(false)
  })

  it('rejects issues without feedback-bot label', () => {
    const payload = {
      action: 'opened',
      issue: { number: 1, labels: [{ name: 'bug' }] },
    }
    expect(shouldProcessEvent('issues', payload)).toBe(false)
  })

  it('rejects issues already labeled in-progress', () => {
    const payload = {
      action: 'opened',
      issue: {
        number: 1,
        labels: [{ name: 'feedback-bot' }, { name: 'in-progress' }],
      },
    }
    expect(shouldProcessEvent('issues', payload)).toBe(false)
  })

  it('rejects issues labeled agent-failed', () => {
    const payload = {
      action: 'opened',
      issue: {
        number: 1,
        labels: [{ name: 'feedback-bot' }, { name: 'agent-failed' }],
      },
    }
    expect(shouldProcessEvent('issues', payload)).toBe(false)
  })
})
