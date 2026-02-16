'use client'

import { Toaster } from 'sileo'

export function MainContent({ children }: { children: React.ReactNode }) {
  return (
    <main>
      {children}
      <Toaster position="bottom-right" />
    </main>
  )
}
