import { describe, it, expect, vi } from 'vitest'
import { runStrategizeJob } from './strategize-worker.js'

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  let callCount = 0
  return {
    default: class {
      messages = {
        create: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            // First call: generate proposals
            return Promise.resolve({
              content: [{ type: 'text', text: JSON.stringify([{
                title: 'Add keyboard shortcuts',
                rationale: 'Navigation theme has 15 mentions',
                spec: 'Add Ctrl+K for search, Ctrl+/ for help',
                priority: 'high',
                source_themes: ['navigation'],
              }])}],
            })
          }
          // Second call: score proposal
          return Promise.resolve({
            content: [{ type: 'text', text: JSON.stringify({
              impact: 0.8, feasibility: 0.7, novelty: 0.9, alignment: 0.85,
            })}],
          })
        }),
      }
    },
  }
})

describe('strategize-worker', () => {
  it('exports runStrategizeJob function', () => {
    expect(typeof runStrategizeJob).toBe('function')
  })

  it('skips when project has no feedback data and no product context', async () => {
    const mockChain = () => {
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn().mockReturnValue(chain)
      chain.eq = vi.fn().mockReturnValue(chain)
      chain.order = vi.fn().mockReturnValue(chain)
      chain.limit = vi.fn().mockResolvedValue({ data: [] })
      chain.single = vi.fn().mockResolvedValue({ data: { name: 'Test', github_repo: 'test/repo', product_context: null, strategic_nudges: [] } })
      return chain
    }

    const supabase = {
      from: vi.fn().mockImplementation(() => mockChain()),
    }

    // Should not throw — skips silently
    await runStrategizeJob({
      jobId: 'test-job',
      projectId: 'test-project',
      supabase: supabase as never,
    })
  })
})
