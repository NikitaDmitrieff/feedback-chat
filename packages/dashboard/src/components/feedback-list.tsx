'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Loader2, MessageCircle } from 'lucide-react'
import { timeAgo } from '@/lib/format'
import type { FeedbackSession, FeedbackTheme } from '@/lib/types'

const STATUS_DOT: Record<FeedbackSession['status'], string> = {
  open: 'bg-success',
  in_progress: 'bg-amber-400',
  resolved: '',
  dismissed: 'bg-white/20',
}

export function FeedbackList({
  projectId,
  themes,
  onSelectSession,
  initialThemeFilter,
}: {
  projectId: string
  themes: FeedbackTheme[]
  onSelectSession: (session: FeedbackSession) => void
  initialThemeFilter?: string | null
}) {
  const [sessions, setSessions] = useState<FeedbackSession[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTheme, setActiveTheme] = useState<string | null>(initialThemeFilter ?? null)

  const themeMap = useMemo(() => new Map(themes.map((t) => [t.id, t])), [themes])

  const fetchSessions = useCallback(async () => {
    setLoading(true)
    try {
      const qs = activeTheme ? `?theme=${activeTheme}` : ''
      const res = await fetch(`/api/feedback/${projectId}${qs}`)
      if (res.ok) {
        const json = await res.json()
        setSessions(json.sessions ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [projectId, activeTheme])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          onClick={() => setActiveTheme(null)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            activeTheme === null
              ? 'bg-accent/20 text-accent'
              : 'bg-surface text-muted hover:text-fg'
          }`}
        >
          All ({sessions.length})
        </button>
        {themes.map((theme) => (
          <button
            key={theme.id}
            onClick={() => setActiveTheme(activeTheme === theme.id ? null : theme.id)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              activeTheme === theme.id
                ? 'bg-accent/20 text-accent'
                : 'bg-surface text-muted hover:text-fg'
            }`}
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: theme.color }}
            />
            {theme.name} ({theme.message_count})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="skeleton h-20 rounded-lg" />
          <div className="skeleton h-20 rounded-lg" />
          <div className="skeleton h-20 rounded-lg" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-muted">
          <MessageCircle className="h-8 w-8" />
          <p className="text-sm">No feedback conversations yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => onSelectSession(session)}
              className="glass-card w-full p-4 text-left transition-colors hover:border-white/[0.08]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {session.status === 'resolved' ? (
                      <Check className="h-3 w-3 shrink-0 text-success" />
                    ) : (
                      <span
                        className={`inline-block h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[session.status]}`}
                      />
                    )}
                    <p className="truncate text-sm font-medium text-fg">
                      {session.ai_summary || `Conversation with ${session.tester_name || 'Anonymous'}`}
                    </p>
                  </div>

                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted">
                    <span>{session.tester_name || 'Anonymous'}</span>
                    <span className="text-white/10">&middot;</span>
                    <span>{timeAgo(session.last_message_at)}</span>
                    {session.ai_themes && session.ai_themes.length > 0 && (
                      <>
                        <span className="text-white/10">&middot;</span>
                        <div className="flex gap-1">
                          {session.ai_themes.map((themeId) => {
                            const theme = themeMap.get(themeId)
                            if (!theme) return null
                            return (
                              <span
                                key={themeId}
                                className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                                style={{
                                  backgroundColor: `${theme.color}20`,
                                  color: theme.color,
                                }}
                              >
                                {theme.name}
                              </span>
                            )
                          })}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <span className="shrink-0 text-xs tabular-nums text-muted">
                  {session.message_count}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
