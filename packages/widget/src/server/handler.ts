import { createAnthropic } from '@ai-sdk/anthropic'
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type LanguageModel,
  type UIMessage,
} from 'ai'
import { buildDefaultPrompt } from './default-prompt'
import { createTools, type GitHubIssueCreator } from './tools'
import { createGitHubIssue } from './github'

export type FeedbackHandlerConfig = {
  /** Password required for authentication */
  password: string
  /** AI model to use. Defaults to claude-haiku-4-5-20251001 */
  model?: LanguageModel
  /** Custom system prompt. If not provided, uses buildDefaultPrompt with projectContext */
  systemPrompt?: string
  /** Project context passed to buildDefaultPrompt (ignored if systemPrompt is provided) */
  projectContext?: string
  /** GitHub configuration for issue creation */
  github?: {
    token: string
    repo: string
    labels?: string[]
  }
}

/**
 * Creates a Next.js App Router POST handler for the feedback chat.
 * Returns `{ POST }` ready to be exported from a route.ts file.
 */
export function createFeedbackHandler(config: FeedbackHandlerConfig) {
  const POST = async (req: Request): Promise<Response> => {
    const { messages, password }: { messages: UIMessage[]; password: string } =
      await req.json()

    if (password !== config.password) {
      return Response.json({ error: 'Invalid password' }, { status: 401 })
    }

    // Password-only check (no messages) — return 200 to confirm access
    if (!messages.length) {
      return Response.json({ ok: true })
    }

    const model =
      config.model ?? createAnthropic()('claude-haiku-4-5-20251001')

    const systemPrompt =
      config.systemPrompt ?? buildDefaultPrompt(config.projectContext)

    // Build the GitHub issue creator if config is provided,
    // otherwise fall back to env-var-based creator
    let issueCreator: GitHubIssueCreator | undefined
    if (config.github) {
      const { token, repo, labels } = config.github
      issueCreator = async (params) => {
        const mergedLabels = [
          ...new Set([...(labels ?? []), ...(params.labels ?? [])]),
        ]
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
              body: JSON.stringify({
                title: params.title,
                body: params.body,
                labels: mergedLabels,
              }),
            }
          )
          if (!response.ok) return null
          const data = await response.json()
          return data.html_url
        } catch {
          return null
        }
      }
    } else {
      // Fall back to env-var-based GitHub issue creation
      issueCreator = createGitHubIssue
    }

    const tools = createTools(issueCreator)

    const result = streamText({
      model,
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
      stopWhen: stepCountIs(2),
      tools,
    })

    return result.toUIMessageStreamResponse()
  }

  return { POST }
}
