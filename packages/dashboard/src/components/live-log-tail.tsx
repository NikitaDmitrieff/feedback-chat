'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FileText,
  Pencil,
  Terminal,
  Search,
  AlertCircle,
  Loader2,
  CheckCircle2,
} from 'lucide-react'

type LogEntry = {
  id: number
  timestamp: string
  level: string
  message: string
  event_type: string | null
  payload: Record<string, unknown> | null
}

const TOOL_ICONS: Record<string, typeof FileText> = {
  Read: FileText,
  Edit: Pencil,
  Write: FileText,
  Bash: Terminal,
  Glob: Search,
  Grep: Search,
}

function LogIcon({ eventType, payload }: { eventType: string | null; payload: Record<string, unknown> | null }) {
  if (eventType === 'tool_use' && payload?.tool) {
    const Icon = TOOL_ICONS[payload.tool as string] ?? Terminal
    return <Icon className="h-3 w-3 shrink-0 text-accent" />
  }
  if (eventType === 'error') {
    return <AlertCircle className="h-3 w-3 shrink-0 text-red-400" />
  }
  return <div className="h-3 w-3 shrink-0 rounded-full bg-muted/30" />
}

export function LiveLogTail({
  projectId,
  runId,
  maxLines = 50,
  compact = false,
}: {
  projectId: string
  runId: string
  maxLines?: number
  compact?: boolean
}) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [done, setDone] = useState(false)
  const [stage, setStage] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const afterRef = useRef<string | null>(null)

  const poll = useCallback(async () => {
    const qs = afterRef.current ? `?after=${encodeURIComponent(afterRef.current)}` : ''
    try {
      const res = await fetch(`/api/runs/${projectId}/${runId}/logs${qs}`)
      if (!res.ok) return
      const json = await res.json()

      if (json.logs?.length > 0) {
        setLogs(prev => {
          const combined = [...prev, ...json.logs]
          return combined.slice(-maxLines)
        })
        afterRef.current = json.logs[json.logs.length - 1].timestamp
      }

      setStage(json.stage ?? null)
      if (json.done) setDone(true)
    } catch {
      // Network error, retry next cycle
    }
  }, [projectId, runId, maxLines])

  useEffect(() => {
    poll()
    const interval = setInterval(() => {
      if (!done) poll()
    }, 3000)
    return () => clearInterval(interval)
  }, [poll, done])

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  if (logs.length === 0 && !done) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted">
        <Loader2 className="h-3 w-3 animate-spin" />
        Waiting for agent logs...
      </div>
    )
  }

  return (
    <div className={compact ? '' : 'rounded-lg bg-surface'}>
      {/* Status header */}
      {!compact && (
        <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
          {done ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          ) : (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
          )}
          <span className="text-[11px] font-medium text-muted uppercase tracking-wider">
            {done ? 'Completed' : stage ?? 'Running'}
          </span>
        </div>
      )}

      {/* Log lines */}
      <div
        ref={scrollRef}
        className={`overflow-y-auto font-mono text-[12px] leading-5 ${
          compact ? 'max-h-[200px]' : 'max-h-[320px] p-3'
        }`}
      >
        {logs.map(log => (
          <div
            key={log.id}
            className={`flex items-start gap-2 ${
              log.event_type === 'error' ? 'text-red-400' : 'text-fg/80'
            }`}
          >
            <LogIcon eventType={log.event_type} payload={log.payload} />
            <span className="break-all">{log.message}</span>
          </div>
        ))}
        {!done && (
          <div className="flex items-center gap-2 text-muted">
            <Loader2 className="h-3 w-3 animate-spin" />
          </div>
        )}
      </div>
    </div>
  )
}
