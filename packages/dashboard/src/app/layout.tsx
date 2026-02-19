import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { SidebarWrapper } from '@/components/sidebar-wrapper'
import { MainContent } from '@/components/main-content'
import { FeedbackButton } from '@/components/FeedbackButton'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
})

export const metadata: Metadata = {
  title: 'Feedback Chat — Dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen font-[family-name:var(--font-inter)] antialiased">
        <SidebarWrapper />
        <MainContent>{children}</MainContent>
        <FeedbackButton />
      </body>
    </html>
  )
}
