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
  /** Optional Supabase config for fire-and-forget conversation persistence */
  supabase?: {
    url: string
    serviceRoleKey: string
    projectId: string
  }
}

function extractTextContent(message: UIMessage): string {
  if (message.parts) {
    return message.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
  }
  return ''
}

async function persistFeedback(
  supabaseConfig: NonNullable<FeedbackHandlerConfig['supabase']>,
  messages: UIMessage[]
) {
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(
    supabaseConfig.url,
    supabaseConfig.serviceRoleKey,
    { db: { schema: 'feedback_chat' } }
  )

  const testerName = 'Anonymous'
  const testerId = 'anonymous'
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  // Find existing session for same project + tester within last hour
  const { data: existing } = await supabase
    .from('feedback_sessions')
    .select('id, message_count')
    .eq('project_id', supabaseConfig.projectId)
    .eq('tester_id', testerId)
    .gte('last_message_at', oneHourAgo)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .single()

  let sessionId: string
  let existingCount: number

  if (existing) {
    sessionId = existing.id
    existingCount = existing.message_count
  } else {
    const { data: newSession, error } = await supabase
      .from('feedback_sessions')
      .insert({
        project_id: supabaseConfig.projectId,
        tester_id: testerId,
        tester_name: testerName,
      })
      .select('id')
      .single()
    if (error || !newSession) return
    sessionId = newSession.id
    existingCount = 0
  }

  // Only insert messages not yet persisted (based on count comparison)
  const newMessages = messages.slice(existingCount)
  if (newMessages.length > 0) {
    const rows = newMessages.map((m) => ({
      session_id: sessionId,
      role: m.role,
      content: extractTextContent(m),
    }))
    await supabase.from('feedback_messages').insert(rows)
  }

  // Update session metadata
  await supabase
    .from('feedback_sessions')
    .update({
      last_message_at: new Date().toISOString(),
      message_count: messages.length,
    })
    .eq('id', sessionId)
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

    if (config.supabase) {
      persistFeedback(config.supabase, messages).catch(() => {})
    }

    return result.toUIMessageStreamResponse()
  }

  return { POST }
}
