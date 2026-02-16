import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'

const THEME_COLORS = [
  '#5e9eff',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#a855f7',
  '#ec4899',
  '#06b6d4',
  '#84cc16',
  '#f97316',
  '#6366f1',
]

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = await createClient()

  const body = await request.json()
  const { sessionId } = body

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  }

  // Fetch all messages for the session
  const { data: messages, error: messagesError } = await supabase
    .from('feedback_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (messagesError) {
    return NextResponse.json({ error: messagesError.message }, { status: 500 })
  }

  if (!messages || messages.length === 0) {
    return NextResponse.json({ error: 'No messages found for session' }, { status: 404 })
  }

  // Fetch existing themes for this project
  const { data: existingThemes, error: themesError } = await supabase
    .from('feedback_themes')
    .select('*')
    .eq('project_id', projectId)

  if (themesError) {
    return NextResponse.json({ error: themesError.message }, { status: 500 })
  }

  // Build conversation text for the AI
  const conversationText = messages
    .map((m: { role: string; content: string }) => `${m.role}: ${m.content}`)
    .join('\n')

  const existingThemeNames = (existingThemes || []).map((t: { name: string }) => t.name)

  // Call Claude Haiku for classification
  const { object: classification } = await generateObject({
    model: anthropic('claude-haiku-4-5-20251001'),
    schema: z.object({
      summary: z.string(),
      themes: z.array(z.string()).min(1).max(3),
      app_area: z.string(),
    }),
    prompt: `Analyze this feedback conversation and classify it.

${existingThemeNames.length > 0 ? `Existing themes in this project: ${existingThemeNames.join(', ')}. Prefer reusing existing theme names when appropriate.` : ''}

Conversation:
${conversationText}

Return:
- summary: A concise 1-2 sentence summary of the feedback
- themes: 1-3 theme labels (short, lowercase, e.g. "ui bug", "performance", "feature request"). Reuse existing theme names when they fit.
- app_area: The area of the app this feedback relates to (e.g. "navigation", "settings", "onboarding")`,
  })

  // Process themes: match existing or create new
  const themeIds: string[] = []

  for (const themeName of classification.themes) {
    const existing = (existingThemes || []).find(
      (t: { name: string }) => t.name.toLowerCase() === themeName.toLowerCase()
    )

    if (existing) {
      // Update existing theme
      await supabase
        .from('feedback_themes')
        .update({
          message_count: existing.message_count + 1,
          last_seen_at: new Date().toISOString(),
        })
        .eq('id', existing.id)

      themeIds.push(existing.id)
    } else {
      // Create new theme with auto-assigned color
      const usedColors = (existingThemes || []).map((t: { color: string }) => t.color)
      const availableColor =
        THEME_COLORS.find((c) => !usedColors.includes(c)) || THEME_COLORS[themeIds.length % THEME_COLORS.length]

      const { data: newTheme, error: createError } = await supabase
        .from('feedback_themes')
        .insert({
          project_id: projectId,
          name: themeName,
          color: availableColor,
          message_count: 1,
          last_seen_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (createError) {
        return NextResponse.json({ error: createError.message }, { status: 500 })
      }

      themeIds.push(newTheme.id)
    }
  }

  // Update session with AI summary and themes
  const { error: updateError } = await supabase
    .from('feedback_sessions')
    .update({
      ai_summary: classification.summary,
      ai_themes: themeIds,
    })
    .eq('id', sessionId)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({
    summary: classification.summary,
    themes: classification.themes,
    themeIds,
  })
}
