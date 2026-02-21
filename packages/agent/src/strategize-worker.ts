import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = SupabaseClient<any, any, any>

export interface StrategizeInput {
  jobId: string
  projectId: string
  supabase: Supabase
}

const MAX_PROPOSALS_PER_RUN = 3
const MIN_SCORE_THRESHOLD = 0.6

function getAnthropicClient(): Anthropic {
  if (process.env.ANTHROPIC_API_KEY) {
    return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return new Anthropic()
}

export async function runStrategizeJob(input: StrategizeInput): Promise<void> {
  const { projectId, supabase } = input

  // 1. Gather context
  const [
    { data: project },
    { data: themes },
    { data: sessions },
    { data: recentProposals },
    { data: memory },
    { data: pendingIdeas },
  ] = await Promise.all([
    supabase.from('projects').select('name, github_repo, product_context, strategic_nudges').eq('id', projectId).single(),
    supabase.from('feedback_themes').select('id, name, message_count, last_seen_at').eq('project_id', projectId).order('message_count', { ascending: false }).limit(20),
    supabase.from('feedback_sessions').select('id, ai_summary, ai_themes, tester_name, status').eq('project_id', projectId).order('last_message_at', { ascending: false }).limit(50),
    supabase.from('proposals').select('title, status, reject_reason').eq('project_id', projectId).order('created_at', { ascending: false }).limit(20),
    supabase.from('strategy_memory').select('title, event_type, themes, outcome_notes').eq('project_id', projectId).order('created_at', { ascending: false }).limit(30),
    supabase.from('user_ideas').select('id, text, status').eq('project_id', projectId).eq('status', 'pending').order('created_at', { ascending: false }).limit(20),
  ])

  if (!project) {
    console.log(`[strategize] Project ${projectId} not found, skipping`)
    return
  }

  const hasFeedback = !!(themes?.length || sessions?.length)
  const hasContext = !!(project.product_context || (project.strategic_nudges as string[] ?? []).length || pendingIdeas?.length)

  if (!hasFeedback && !hasContext) {
    console.log(`[strategize] Skipping project ${projectId}: no feedback data and no product context`)
    return
  }

  // 2. Build context for Claude
  const themesSummary = (themes ?? [])
    .map(t => `- ${t.name} (${t.message_count} mentions, last: ${t.last_seen_at})`)
    .join('\n') || 'No themes yet'

  const sessionSummaries = (sessions ?? [])
    .filter(s => s.ai_summary)
    .map(s => `- ${s.ai_summary}`)
    .join('\n') || 'No session summaries'

  const existingProposals = (recentProposals ?? [])
    .map(p => `- [${p.status}] ${p.title}${p.reject_reason ? ` (rejected: ${p.reject_reason})` : ''}`)
    .join('\n') || 'None yet'

  const memoryContext = (memory ?? [])
    .map(m => `- [${m.event_type}] ${m.title}${m.outcome_notes ? `: ${m.outcome_notes}` : ''}`)
    .join('\n') || 'No history yet'

  const nudgesContext = (project.strategic_nudges ?? []).length > 0
    ? (project.strategic_nudges as string[]).map((n: string) => `- ${n}`).join('\n')
    : ''

  const ideasContext = (pendingIdeas ?? [])
    .map(i => `- ${i.text}`)
    .join('\n') || ''

  const anthropic = getAnthropicClient()

  // 3. Generate proposals
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `You are a product strategist for "${project.name}" (${project.github_repo || 'no repo'}).

${project.product_context ? `Product vision: ${project.product_context}\n` : ''}
## Current feedback themes (sorted by frequency)
${themesSummary}

## Recent feedback session summaries
${sessionSummaries}

## Existing proposals (avoid duplicates)
${existingProposals}

## Strategy memory (past decisions — learn from rejections)
${memoryContext}
${nudgesContext ? `\n## Strategic directives from the product owner (HIGH PRIORITY — follow these)\n${nudgesContext}\n` : ''}
${ideasContext ? `\n## User-submitted ideas to consider\n${ideasContext}\n` : ''}
Based on this data, identify 1-${MAX_PROPOSALS_PER_RUN} concrete improvement opportunities. For each:
- If feedback themes exist, focus on recurring themes with high frequency
- If no feedback exists yet, derive proposals from the product vision, strategic directives, and user ideas
- Do NOT re-propose anything that was recently rejected
- Do NOT propose what already exists in existing proposals
- Be specific and actionable (not vague like "improve UX")

Respond in JSON format:
\`\`\`json
[
  {
    "title": "Short imperative title (e.g., Add keyboard shortcuts)",
    "rationale": "Why this matters — cite specific themes and session counts",
    "spec": "Detailed implementation spec: what to build, where in the codebase, acceptance criteria. Enough detail for a coding agent to implement.",
    "priority": "high|medium|low",
    "source_themes": ["theme name 1", "theme name 2"]
  }
]
\`\`\`

Only return the JSON array. No other text.`,
    }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) {
    console.log('[strategize] No valid JSON in response')
    return
  }

  let rawProposals: Array<{
    title: string; rationale: string; spec: string; priority: string; source_themes: string[]
  }>
  try {
    rawProposals = JSON.parse(jsonMatch[0])
  } catch {
    console.log('[strategize] Failed to parse JSON')
    return
  }

  // 4. Score each proposal with multi-grader evaluation
  for (const raw of rawProposals.slice(0, MAX_PROPOSALS_PER_RUN)) {
    const scoreResponse = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Score this product improvement proposal on 4 dimensions (0.0 to 1.0):

Title: ${raw.title}
Rationale: ${raw.rationale}
Spec: ${raw.spec}

Themes data: ${themesSummary}

Score each dimension:
- impact: How many users would benefit? (based on theme frequency)
- feasibility: Can a coding agent implement this in one PR? (based on spec complexity)
- novelty: Is this genuinely new? (not already built or proposed)
- alignment: Does this match the product vision?${project.product_context ? ` Vision: ${project.product_context}` : ''}

Respond in JSON only:
\`\`\`json
{"impact": 0.8, "feasibility": 0.7, "novelty": 0.9, "alignment": 0.85}
\`\`\``,
      }],
    })

    const scoreText = scoreResponse.content[0].type === 'text' ? scoreResponse.content[0].text : ''
    const scoreMatch = scoreText.match(/\{[\s\S]*?\}/)
    let scores = { impact: 0.5, feasibility: 0.5, novelty: 0.5, alignment: 0.5 }
    try {
      scores = JSON.parse(scoreMatch?.[0] ?? '{}')
    } catch { /* use defaults */ }

    const avgScore = (scores.impact + scores.feasibility + scores.novelty + scores.alignment) / 4
    if (avgScore < MIN_SCORE_THRESHOLD) {
      console.log(`[strategize] Proposal "${raw.title}" scored ${avgScore.toFixed(2)} — below threshold, skipping`)
      continue
    }

    // 5. Map theme names to IDs
    const sourceThemeIds = (themes ?? [])
      .filter(t => raw.source_themes.some(name => name.toLowerCase() === t.name.toLowerCase()))
      .map(t => t.id)

    // 6. Insert proposal
    const { error } = await supabase.from('proposals').insert({
      project_id: projectId,
      title: raw.title,
      rationale: raw.rationale,
      spec: raw.spec,
      priority: raw.priority === 'high' ? 'high' : raw.priority === 'low' ? 'low' : 'medium',
      source_theme_ids: sourceThemeIds,
      scores,
    })

    if (error) {
      console.error(`[strategize] Failed to insert proposal: ${error.message}`)
    } else {
      console.log(`[strategize] Created proposal: "${raw.title}" (score: ${avgScore.toFixed(2)})`)
    }
  }

  // Mark user ideas as incorporated or dismissed
  if (pendingIdeas?.length) {
    const proposalTexts = rawProposals.map(p => p.title.toLowerCase() + ' ' + p.rationale.toLowerCase())
    for (const idea of pendingIdeas) {
      const ideaWords = idea.text.toLowerCase().split(/\s+/)
      const incorporated = proposalTexts.some(text =>
        ideaWords.filter((w: string) => w.length > 3).some((word: string) => text.includes(word))
      )
      await supabase
        .from('user_ideas')
        .update({ status: incorporated ? 'incorporated' : 'dismissed' })
        .eq('id', idea.id)
    }
  }
}
