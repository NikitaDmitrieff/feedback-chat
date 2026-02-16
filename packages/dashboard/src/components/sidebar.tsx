'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MessageSquareText, FolderKanban, LogOut, Pin, PinOff } from 'lucide-react'

export function Sidebar() {
  const pathname = usePathname()
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('sidebar-pinned')
    if (saved === 'true') setPinned(true)
  }, [])

  const togglePin = () => {
    const next = !pinned
    setPinned(next)
    localStorage.setItem('sidebar-pinned', String(next))
  }

  const expanded = pinned || hovered

  return (
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`fixed left-3 top-1/2 z-40 flex -translate-y-1/2 flex-col items-center gap-1 overflow-hidden rounded-[22px] border border-edge bg-bg/70 p-2 shadow-[0_8px_32px_rgba(0,0,0,0.24),0_2px_8px_rgba(0,0,0,0.12)] backdrop-blur-xl transition-all duration-200 ease-in-out ${
        expanded ? 'w-[180px]' : 'w-[48px]'
      }`}
    >
      {/* Logo */}
      <Link
        href="/projects"
        className="flex h-9 w-full shrink-0 items-center gap-2.5 rounded-[14px] px-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-elevated">
          <MessageSquareText className="h-3.5 w-3.5 text-muted" />
        </div>
        {expanded && <span className="truncate text-xs">Feedback Chat</span>}
      </Link>

      {/* Divider */}
      <div className="my-0.5 h-px w-6 bg-edge" />

      {/* Projects */}
      <Link
        href="/projects"
        className={`flex h-9 w-full shrink-0 items-center gap-2.5 rounded-[14px] px-2 text-sm transition-colors ${
          pathname === '/projects' || pathname === '/'
            ? 'bg-surface text-fg'
            : 'text-muted hover:bg-surface-hover hover:text-fg'
        }`}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center">
          <FolderKanban className="h-3.5 w-3.5" />
        </div>
        {expanded && <span className="truncate text-xs">Projects</span>}
      </Link>

      {/* Divider */}
      <div className="my-0.5 h-px w-6 bg-edge" />

      {/* Pin toggle — only when expanded */}
      {expanded && (
        <button
          onClick={togglePin}
          className="flex h-9 w-full shrink-0 items-center gap-2.5 rounded-[14px] px-2 text-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center">
            {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </div>
          <span className="truncate text-xs">{pinned ? 'Unpin' : 'Pin'}</span>
        </button>
      )}

      {/* Sign out */}
      <form action="/auth/signout" method="post" className="w-full">
        <button
          type="submit"
          className="flex h-9 w-full shrink-0 items-center gap-2.5 rounded-[14px] px-2 text-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center">
            <LogOut className="h-3.5 w-3.5" />
          </div>
          {expanded && <span className="truncate text-xs">Sign out</span>}
        </button>
      </form>
    </aside>
  )
}
