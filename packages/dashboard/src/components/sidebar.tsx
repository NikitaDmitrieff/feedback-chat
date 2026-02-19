'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FolderKanban, MessageSquare, LogOut } from 'lucide-react'

export function Sidebar() {
  const pathname = usePathname()
  const [expanded, setExpanded] = useState(false)
  const collapseTimer = useRef<ReturnType<typeof setTimeout>>(null)

  const projectMatch = pathname.match(/\/projects\/([^/]+)/)
  const projectId = projectMatch && projectMatch[1] !== 'new' ? projectMatch[1] : null

  const expand = useCallback(() => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current)
    setExpanded(true)
  }, [])

  const scheduleCollapse = useCallback(() => {
    collapseTimer.current = setTimeout(() => setExpanded(false), 300)
  }, [])

  useEffect(() => {
    return () => {
      if (collapseTimer.current) clearTimeout(collapseTimer.current)
    }
  }, [])

  return (
    <aside
      onMouseEnter={expand}
      onMouseLeave={scheduleCollapse}
      className={`fixed left-3 top-1/2 z-40 -translate-y-1/2 overflow-hidden rounded-[24px] border border-white/[0.08] bg-white/[0.04] p-1.5 shadow-[0_8px_40px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.06),inset_0_-1px_0_rgba(255,255,255,0.02)] backdrop-blur-2xl transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
        expanded ? 'w-[172px]' : 'w-[52px]'
      }`}
    >
      {/* Projects */}
      <Link
        href="/projects"
        className={`flex items-center rounded-[16px] transition-colors ${
          pathname === '/projects' || pathname === '/'
            ? 'bg-white/[0.08] text-fg'
            : 'text-muted hover:bg-white/[0.06] hover:text-fg'
        } ${expanded ? 'gap-2.5 px-2 py-2' : 'justify-center p-1.5'}`}
      >
        <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center">
          <FolderKanban className="h-[15px] w-[15px]" />
        </div>
        {expanded && <span className="truncate text-xs">Projects</span>}
      </Link>

      {/* Feedback (contextual — only when inside a project) */}
      {projectId && (
        <Link
          href={`/projects/${projectId}/feedback`}
          className={`flex items-center rounded-[16px] transition-colors ${
            pathname.includes('/feedback')
              ? 'bg-white/[0.08] text-fg'
              : 'text-muted hover:bg-white/[0.06] hover:text-fg'
          } ${expanded ? 'gap-2.5 px-2 py-2' : 'justify-center p-1.5'}`}
        >
          <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center">
            <MessageSquare className="h-[15px] w-[15px]" />
          </div>
          {expanded && <span className="truncate text-xs">Feedback</span>}
        </Link>
      )}

      {/* Divider */}
      <div className={`my-1 h-px bg-white/[0.06] ${expanded ? 'mx-2' : 'mx-auto w-5'}`} />

      {/* Sign out */}
      <form action="/auth/signout" method="post">
        <button
          type="submit"
          className={`flex w-full items-center rounded-[16px] text-muted transition-colors hover:bg-white/[0.06] hover:text-fg ${
            expanded ? 'gap-2.5 px-2 py-2' : 'justify-center p-1.5'
          }`}
        >
          <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center">
            <LogOut className="h-[14px] w-[14px]" />
          </div>
          {expanded && <span className="truncate text-xs">Sign out</span>}
        </button>
      </form>
    </aside>
  )
}
