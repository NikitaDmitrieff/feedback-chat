'use client'

import { usePathname } from 'next/navigation'

export function MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const hasSidebar = pathname !== '/login' && !pathname.startsWith('/auth/')
  return (
    <main className={hasSidebar ? 'pl-16' : ''}>
      {children}
    </main>
  )
}
