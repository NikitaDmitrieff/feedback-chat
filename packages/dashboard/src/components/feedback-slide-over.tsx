'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, Sparkles, X, ExternalLink, AlertCircle } from 'lucide-react'
import { sileo } from 'sileo'
import type { FeedbackMessage, FeedbackSession, FeedbackTheme } from '@/lib/types'

type Props = {
  session: FeedbackSession
  themes: FeedbackTheme[]
  projectId: string
  githubRepo: string | null
  onClose: () => void
  onStatusChange: (sessionId: string, status: FeedbackSession['status']) => void
}

export function FeedbackSlideOver({
  session,
  themes,
  projectId,
  githubRepo,
  onClose,
  onStatusChange,
}: Props) {
  const [messages, setMessages] = useState<FeedbackMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [classifying, setClassifying] = useState(false)
  const [localSession, setLocalSession] = useState(session)
  const threadRef = useRef<HTMLDivElement>(null)

  const themeMap = useMemo(() => new Map(themes.map((t) => [t.id, t])), [themes])

  useEffect(() => {
    setLoading(true)
    fetch(`/api/feedback/${projectId}/${session.id}`)
      .then((res) => res.json())
      .then((json) => setMessages(json.messages ?? []))
      .catch(() => sileo.error({ title: 'Failed to load messages' }))
      .finally(() => setLoading(false))
  }, [projectId, session.id])

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  async function handleClassify() {
    setClassifying(true)
    try {
      const res = await fetch(`/api/feedback/${projectId}/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id }),
      })
      if (res.ok) {
        const json = await res.json()
        setLocalSession((prev) => ({
          ...prev,
          ai_summary: json.summary,
          ai_themes: json.themeIds,
        }))
        sileo.success({ title: 'Session classified' })
      } else {
        sileo.error({ title: 'Classification failed' })
      }
    } catch {
      sileo.error({ title: 'Classification failed' })
    } finally {
      setClassifying(false)
    }
  }

  async function handleStatusChange(status: FeedbackSession['status']) {
    try {
      const res = await fetch(`/api/feedback/${projectId}/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (res.ok) {
        setLocalSession((prev) => ({ ...prev, status }))
        onStatusChange(session.id, status)
        const label = status === 'resolved' ? 'Resolved' : status === 'dismissed' ? 'Dismissed' : status
        sileo.success({ title: `Feedback ${label.toLowerCase()}` })
      } else {
        sileo.error({ title: 'Failed to update status' })
      }
    } catch {
      sileo.error({ title: 'Failed to update status' })
    }
  }

  return (
    <>
      <div className="slide-over-backdrop" onClick={onClose} />

      <div className="fixed top-0 right-0 z-50 flex h-screen w-full max-w-[480px] flex-col border-l border-edge bg-bg/95 backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-edge px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-fg">
              {localSession.tester_name || 'Anonymous'}
            </span>
            <span className="text-xs tabular-nums text-muted">
              {localSession.message_count} messages
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5" ref={threadRef}>
          {localSession.ai_summary && (
            <div className="mb-5 rounded-lg bg-surface p-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
                AI Summary
              </h3>
              <p className="text-sm text-fg">{localSession.ai_summary}</p>
              {localSession.ai_themes && localSession.ai_themes.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {localSession.ai_themes.map((themeId) => {
                    const theme = themeMap.get(themeId)
                    if (!theme) return null
                    return (
                      <span
                        key={themeId}
                        className="rounded-full px-2 py-0.5 text-[11px] font-medium"
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
              )}
            </div>
          )}

          {localSession.github_issue_number && githubRepo && (
            <div className="mb-5">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
                Issue
              </h3>
              <a
                href={`https://github.com/${githubRepo}/issues/${localSession.github_issue_number}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2.5 text-sm text-accent transition-colors hover:bg-surface-hover"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Issue #{localSession.github_issue_number}</span>
                <ExternalLink className="ml-auto h-3 w-3 text-muted" />
              </a>
            </div>
          )}

          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Conversation
          </h3>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted" />
            </div>
          ) : messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No messages found</p>
          ) : (
            <div className="space-y-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm ${
                      msg.role === 'user'
                        ? 'bg-accent/20 text-fg'
                        : 'bg-surface text-fg'
                    }`}
                  >
                    <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted">
                      {msg.role === 'user' ? 'User' : 'Assistant'}
                    </span>
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-edge px-6 py-4">
          {!localSession.ai_summary && (
            <button
              onClick={handleClassify}
              disabled={classifying}
              className="flex h-9 items-center gap-2 rounded-xl bg-surface px-4 text-sm font-medium text-fg transition-colors hover:bg-elevated disabled:opacity-50"
            >
              {classifying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Classify
            </button>
          )}
          {localSession.status === 'open' && (
            <>
              <button
                onClick={() => handleStatusChange('resolved')}
                className="flex h-9 items-center gap-2 rounded-xl bg-success/20 px-4 text-sm font-medium text-success transition-colors hover:bg-success/30"
              >
                <Check className="h-4 w-4" />
                Resolve
              </button>
              <button
                onClick={() => handleStatusChange('dismissed')}
                className="flex h-9 items-center gap-2 rounded-xl bg-surface px-4 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-fg"
              >
                <X className="h-4 w-4" />
                Dismiss
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}
