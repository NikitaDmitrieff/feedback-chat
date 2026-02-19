'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, MessageCircle, Zap, CheckCircle } from 'lucide-react'
import { timeAgo } from '@/lib/format'
import { TesterTimeline } from '@/components/tester-timeline'
import { FeedbackSlideOver } from '@/components/feedback-slide-over'
import type { TesterProfile, FeedbackSession, FeedbackTheme } from '@/lib/types'

function InitialsAvatar({ name, size = 'lg' }: { name: string; size?: 'sm' | 'lg' }) {
  const initials = name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360

  const sizeClass = size === 'lg' ? 'h-12 w-12 text-lg' : 'h-8 w-8 text-xs'

  return (
    <div
      className={`flex ${sizeClass} items-center justify-center rounded-full font-semibold text-white`}
      style={{ backgroundColor: `hsl(${hue}, 50%, 40%)` }}
    >
      {initials}
    </div>
  )
}

export function TesterProfileClient({
  projectId,
  testerId,
  githubRepo,
  themes,
}: {
  projectId: string
  testerId: string
  githubRepo: string | null
  themes: FeedbackTheme[]
}) {
  const [profile, setProfile] = useState<TesterProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedSession, setSelectedSession] = useState<FeedbackSession | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/feedback/${projectId}/testers/${encodeURIComponent(testerId)}`)
      .then(res => res.ok ? res.json() : null)
      .then(json => setProfile(json?.profile ?? null))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false))
  }, [projectId, testerId])

  const handleSelectSession = useCallback((sessionId: string) => {
    const session = profile?.sessions.find(s => s.id === sessionId)
    if (session) setSelectedSession(session)
  }, [profile])

  const handleStatusChange = useCallback((sessionId: string, status: FeedbackSession['status']) => {
    if (selectedSession?.id === sessionId) {
      setSelectedSession(prev => prev ? { ...prev, status } : null)
    }
  }, [selectedSession?.id])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="py-20 text-center text-sm text-muted">Tester not found</div>
    )
  }

  const resolutionRate = profile.session_count > 0
    ? Math.round((profile.resolved_count / profile.session_count) * 100)
    : 0

  return (
    <>
      {/* Header */}
      <div className="mb-8 flex items-center gap-4">
        <InitialsAvatar name={profile.tester_name || 'Anonymous'} />
        <div>
          <h1 className="text-lg font-medium text-fg">{profile.tester_name || 'Anonymous'}</h1>
          <p className="text-xs text-muted">
            First seen {timeAgo(profile.first_seen)} &middot; Last active {timeAgo(profile.last_active)}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-3 gap-3">
        <div className="glass-card flex items-center gap-3 p-4">
          <MessageCircle className="h-4 w-4 text-accent" />
          <div>
            <p className="text-sm font-medium text-fg">{profile.session_count}</p>
            <p className="text-[11px] text-muted">Conversations</p>
          </div>
        </div>
        <div className="glass-card flex items-center gap-3 p-4">
          <Zap className="h-4 w-4 text-amber-400" />
          <div>
            <p className="text-sm font-medium text-fg">{profile.runs_triggered}</p>
            <p className="text-[11px] text-muted">Runs triggered</p>
          </div>
        </div>
        <div className="glass-card flex items-center gap-3 p-4">
          <CheckCircle className="h-4 w-4 text-success" />
          <div>
            <p className="text-sm font-medium text-fg">{resolutionRate}%</p>
            <p className="text-[11px] text-muted">Resolved</p>
          </div>
        </div>
      </div>

      {/* Top themes */}
      {profile.top_themes.length > 0 && (
        <div className="mb-8 flex flex-wrap gap-2">
          {profile.top_themes.map(theme => (
            <span
              key={theme.name}
              className="rounded-full px-2.5 py-1 text-xs font-medium"
              style={{ backgroundColor: `${theme.color}20`, color: theme.color }}
            >
              {theme.name} ({theme.count})
            </span>
          ))}
        </div>
      )}

      {/* Activity Timeline */}
      <div className="mb-8">
        <h2 className="mb-4 text-sm font-medium text-fg">Activity</h2>
        <div className="glass-card p-5">
          <TesterTimeline
            events={profile.timeline}
            projectId={projectId}
            githubRepo={githubRepo}
            onSelectSession={handleSelectSession}
          />
        </div>
      </div>

      {/* Sessions list */}
      <div>
        <h2 className="mb-4 text-sm font-medium text-fg">Conversations</h2>
        <div className="space-y-2">
          {profile.sessions.map(session => (
            <button
              key={session.id}
              onClick={() => setSelectedSession(session)}
              className="glass-card w-full p-4 text-left transition-colors hover:border-white/[0.08]"
            >
              <p className="truncate text-sm font-medium text-fg">
                {session.ai_summary || 'Conversation'}
              </p>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                <span>{timeAgo(session.last_message_at)}</span>
                <span className="text-white/10">&middot;</span>
                <span>{session.message_count} messages</span>
                <span className="text-white/10">&middot;</span>
                <span className="capitalize">{session.status}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {selectedSession && (
        <FeedbackSlideOver
          session={selectedSession}
          themes={themes}
          projectId={projectId}
          githubRepo={githubRepo}
          onClose={() => setSelectedSession(null)}
          onStatusChange={handleStatusChange}
        />
      )}
    </>
  )
}
