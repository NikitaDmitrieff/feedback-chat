import { describe, it, expect } from 'vitest'
import { parseIssueBody } from './parse-issue.js'

const SIMPLE_ISSUE = `## Generated Prompt

\`\`\`
Fix the typo in the navbar: change "Acceuil" to "Accueil" in src/components/layout/Navbar.tsx
\`\`\`

## Metadata

- **Type:** simple
- **Submitted by:** Marie

<!-- agent-meta: {"prompt_type":"simple","visitor_name":"Marie"} -->`

const RALPH_LOOP_ISSUE = `## Generated Prompt

\`\`\`
Add a dark mode toggle to the site header that persists user preference in localStorage
\`\`\`

## Spec Content

### Goal
Add dark mode support across the entire site.

### Tasks
1. Add toggle button to Navbar
2. Create CSS custom properties for dark palette
3. Persist preference in localStorage

### Acceptance Criteria
- Toggle switches between light and dark
- Preference persists across page reloads

## Metadata

- **Type:** ralph_loop
- **Submitted by:** Anonymous

<!-- agent-meta: {"prompt_type":"ralph_loop","visitor_name":"Anonymous"} -->`

const MISSING_META_ISSUE = `## Generated Prompt

\`\`\`
Fix the button color
\`\`\`

## Metadata

- **Type:** simple
- **Submitted by:** Anonymous`

describe('parseIssueBody', () => {
  it('parses a simple issue', () => {
    const result = parseIssueBody(SIMPLE_ISSUE)
    expect(result.generatedPrompt).toBe(
      'Fix the typo in the navbar: change "Acceuil" to "Accueil" in src/components/layout/Navbar.tsx'
    )
    expect(result.specContent).toBeNull()
    expect(result.promptType).toBe('simple')
    expect(result.visitorName).toBe('Marie')
  })

  it('parses a ralph_loop issue with spec content', () => {
    const result = parseIssueBody(RALPH_LOOP_ISSUE)
    expect(result.generatedPrompt).toContain('dark mode toggle')
    expect(result.specContent).toContain('### Goal')
    expect(result.specContent).toContain('### Acceptance Criteria')
    expect(result.promptType).toBe('ralph_loop')
    expect(result.visitorName).toBe('Anonymous')
  })

  it('falls back to markdown parsing when agent-meta comment is missing', () => {
    const result = parseIssueBody(MISSING_META_ISSUE)
    expect(result.generatedPrompt).toBe('Fix the button color')
    expect(result.promptType).toBe('simple')
  })

  it('throws on completely unparseable body', () => {
    expect(() => parseIssueBody('hello world')).toThrow('Could not extract generated prompt')
  })
})
