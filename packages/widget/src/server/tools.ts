import { tool } from 'ai'
import { z } from 'zod'

/**
 * Function signature for creating a GitHub issue.
 * Returns the issue URL on success, or null if GitHub is not configured.
 */
export type GitHubIssueCreator = (params: {
  title: string
  body: string
  labels?: string[]
}) => Promise<string | null>

/**
 * Creates the feedback chatbot tool definitions.
 * Uses dependency injection for the GitHub issue creator.
 */
export function createTools(createIssue?: GitHubIssueCreator) {
  return {
    present_options: tool({
      description:
        'Present clickable options to the user for selection. Use this whenever you want to offer choices instead of writing numbered lists. After calling this tool, end your message briefly — the user will click an option to continue.',
      inputSchema: z.object({
        options: z
          .array(z.string())
          .min(2)
          .max(5)
          .describe('The options to present as clickable buttons'),
      }),
      execute: async ({ options }) => ({ presented: true, count: options.length }),
    }),
    submit_request: tool({
      description:
        'Submit the finalized feedback request with a generated prompt for Claude Code.',
      inputSchema: z.object({
        summary: z.string().describe('Brief summary of the request'),
        prompt_type: z
          .enum(['simple', 'ralph_loop'])
          .describe(
            'simple for small changes, ralph_loop for large features'
          ),
        generated_prompt: z
          .string()
          .describe('The generated prompt in English for Claude Code'),
        spec_content: z
          .string()
          .optional()
          .describe(
            'Markdown spec content for ralph_loop type requests'
          ),
        visitor_name: z
          .string()
          .optional()
          .describe('Name of the person making the request'),
      }),
      execute: async (args) => {
        const bodyParts = [
          `## Generated Prompt\n\n\`\`\`\n${args.generated_prompt}\n\`\`\``,
        ]

        if (args.spec_content) {
          bodyParts.push(`## Spec Content\n\n${args.spec_content}`)
        }

        bodyParts.push(
          `## Metadata\n\n- **Type:** ${args.prompt_type}\n- **Submitted by:** ${args.visitor_name || 'Anonymous'}`
        )

        const agentMeta = JSON.stringify({
          prompt_type: args.prompt_type,
          visitor_name: args.visitor_name || 'Anonymous',
        })
        bodyParts.push(`<!-- agent-meta: ${agentMeta} -->`)

        const issueBody = bodyParts.join('\n\n')

        if (createIssue) {
          const githubUrl = await createIssue({
            title: `[Feedback] ${args.summary}`,
            body: issueBody,
            labels: ['feedback-bot', 'auto-implement'],
          })

          if (githubUrl) {
            return { success: true, github_issue_url: githubUrl }
          }
        }

        return { success: true, message: 'Saved locally' }
      },
    }),
  }
}
