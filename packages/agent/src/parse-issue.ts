export interface ParsedIssue {
  generatedPrompt: string
  specContent: string | null
  promptType: 'simple' | 'ralph_loop'
  visitorName: string
}

export function parseIssueBody(body: string): ParsedIssue {
  // Extract generated prompt from code block
  const promptMatch = body.match(/## Generated Prompt\s+```\n([\s\S]*?)\n```/)
  if (!promptMatch) {
    throw new Error('Could not extract generated prompt from issue body')
  }
  const generatedPrompt = promptMatch[1].trim()

  // Extract spec content (between "## Spec Content" and the next "## " heading)
  let specContent: string | null = null
  const specMatch = body.match(/## Spec Content\s+([\s\S]*?)(?=\n## (?!Spec))/)
  if (specMatch) {
    specContent = specMatch[1].trim()
  }

  // Try agent-meta HTML comment first (machine-readable)
  let promptType: 'simple' | 'ralph_loop' = 'simple'
  let visitorName = 'Anonymous'
  let metaParsed = false

  const metaMatch = body.match(/<!-- agent-meta: ({.*?}) -->/)
  if (metaMatch) {
    try {
      const meta = JSON.parse(metaMatch[1])
      promptType = meta.prompt_type === 'ralph_loop' ? 'ralph_loop' : 'simple'
      visitorName = meta.visitor_name || 'Anonymous'
      metaParsed = true
    } catch {
      // Fall through to markdown parsing
    }
  }

  // Fallback: parse from markdown metadata section
  if (!metaParsed) {
    const typeMatch = body.match(/\*\*Type:\*\*\s*(simple|ralph_loop)/)
    if (typeMatch) {
      promptType = typeMatch[1] as 'simple' | 'ralph_loop'
    }
    const nameMatch = body.match(/\*\*Submitted by:\*\*\s*(.+)/)
    if (nameMatch) {
      visitorName = nameMatch[1].trim()
    }
  }

  return { generatedPrompt, specContent, promptType, visitorName }
}
