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
      className={`fixed top-0 left-0 z-40 flex h-screen flex-col border-r border-edge bg-bg/80 backdrop-blur-xl transition-[width] duration-200 ease-in-out ${
        expanded ? 'w-[220px]' : 'w-[60px]'
      }`}
    >
      {/* Logo */}
      <Link
        href="/projects"
        className="flex h-14 items-center gap-2.5 px-4 text-sm font-medium text-fg transition-colors hover:text-white"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-elevated">
          <MessageSquareText className="h-4 w-4 text-muted" />
        </div>
        {expanded && <span className="truncate">Feedback Chat</span>}
      </Link>

      {/* Nav items */}
      <nav className="mt-2 flex flex-1 flex-col gap-1 px-2">
        <Link
          href="/projects"
          className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
            pathname === '/projects' || pathname === '/'
              ? 'bg-surface text-fg'
              : 'text-muted hover:bg-surface-hover hover:text-fg'
          }`}
        >
          <FolderKanban className="h-4 w-4 shrink-0" />
          {expanded && <span className="truncate">Projects</span>}
        </Link>
      </nav>

      {/* Bottom section */}
      <div className="flex flex-col gap-1 border-t border-edge px-2 py-3">
        {/* Pin toggle — only visible when expanded */}
        {expanded && (
          <button
            onClick={togglePin}
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            {pinned ? <PinOff className="h-3.5 w-3.5 shrink-0" /> : <Pin className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{pinned ? 'Unpin sidebar' : 'Pin sidebar'}</span>
          </button>
        )}

        {/* Sign out */}
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" />
            {expanded && <span className="truncate">Sign out</span>}
          </button>
        </form>
      </div>
    </aside>
  )
}
