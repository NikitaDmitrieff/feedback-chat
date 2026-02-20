import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type FailureCategory = 'docs_gap' | 'widget_bug' | 'agent_bug' | 'consumer_error' | 'transient'

export type FailureClassification = {
  category: FailureCategory
  analysis: string
  fix_summary: string
}

type LogEntry = { level: string; message: string }

interface ClassifyInput {
  logs: LogEntry[]
  lastError: string
  issueBody: string
  jobType: string
}

const VALID_CATEGORIES: FailureCategory[] = ['docs_gap', 'widget_bug', 'agent_bug', 'consumer_error', 'transient']

function getAnthropicClient(): Anthropic {
  // If we have an API key, use it directly (cheapest path for classification)
  if (process.env.ANTHROPIC_API_KEY) {
    return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }

  // Otherwise, try reading the OAuth access token
  try {
    const credsPath = join(homedir(), '.claude', '.credentials.json')
    const creds = JSON.parse(readFileSync(credsPath, 'utf-8'))
    const accessToken = creds?.claudeAiOauth?.accessToken
    if (accessToken) {
      return new Anthropic({ apiKey: accessToken })
    }
  } catch {}

  // Fallback: let the SDK try default env vars
  return new Anthropic()
}

export async function classifyFailure(input: ClassifyInput): Promise<FailureClassification | null> {
  const { logs, lastError, issueBody, jobType } = input

  if (logs.length === 0 && !lastError) return null

  const logText = logs
    .map((l) => `[${l.level}] ${l.message}`)
    .join('\n')

  const client = getAnthropicClient()

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `You are analyzing a failed agent run. The agent tried to implement a feature on a consumer's Next.js repo using the @nikitadmitrieff/feedback-chat widget.

Classify this failure into ONE of these categories:
- **docs_gap**: The failure happened because CLAUDE.md, installation instructions, or gotchas in the feedback-chat repo are incomplete or wrong. The agent didn't know how to handle a situation that should have been documented.
- **widget_bug**: The failure happened because the widget's source code (packages/widget/) has a bug — wrong exports, broken CSS, incompatible patterns, etc.
- **agent_bug**: The failure happened because the agent's own workflow logic (packages/agent/) is broken — cloning issues, validation logic, prompt construction, etc.
- **consumer_error**: The failure is the consumer's fault — bad config, missing env vars, incompatible dependencies, unusual project structure that we shouldn't need to support.
- **transient**: Network timeout, rate limit, flaky CI, GitHub API outage, or other temporary issue.

Job type: ${jobType}

Original issue body:
${issueBody.slice(0, 1000)}

Last error:
${lastError.slice(0, 1000)}

Run logs (last entries):
${logText.slice(-3000)}

Respond with ONLY a JSON object (no markdown, no code fences):
{"category": "one_of_the_five", "analysis": "One paragraph explaining what went wrong and why this category.", "fix_summary": "One sentence: what should be changed in the feedback-chat repo to prevent this. Use 'N/A' for consumer_error and transient."}`,
      },
    ],
  })

  try {
    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const parsed = JSON.parse(text)

    if (!VALID_CATEGORIES.includes(parsed.category)) return null

    return {
      category: parsed.category,
      analysis: String(parsed.analysis || ''),
      fix_summary: String(parsed.fix_summary || ''),
    }
  } catch {
    console.error('[classify] Failed to parse Haiku response')
    return null
  }
}
