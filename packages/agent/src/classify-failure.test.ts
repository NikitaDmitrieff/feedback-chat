import { describe, it, expect, vi } from 'vitest'
import { classifyFailure, type FailureClassification } from './classify-failure.js'

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class {
      messages = {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: JSON.stringify({
            category: 'widget_bug',
            analysis: 'The widget CSS import path is wrong, causing the build to fail on Tailwind scanning.',
            fix_summary: 'Fix the CSS import path in styles.css',
          })}],
        }),
      }
    },
  }
})

describe('classifyFailure', () => {
  it('returns a valid classification from log data', async () => {
    const result = await classifyFailure({
      logs: [
        { level: 'info', message: 'Starting job for issue #5' },
        { level: 'error', message: 'Build failed: Cannot find module @nikitadmitrieff/feedback-chat/styles.css' },
      ],
      lastError: 'Build still failing after 2 fix attempts',
      issueBody: 'Please add a dark mode toggle',
      jobType: 'implement',
    })

    expect(result).toBeDefined()
    expect(result!.category).toBe('widget_bug')
    expect(result!.analysis).toContain('CSS')
    expect(result!.fix_summary).toBeDefined()
  })

  it('returns null for empty logs', async () => {
    const result = await classifyFailure({
      logs: [],
      lastError: '',
      issueBody: '',
      jobType: 'implement',
    })

    expect(result).toBeNull()
  })
})
