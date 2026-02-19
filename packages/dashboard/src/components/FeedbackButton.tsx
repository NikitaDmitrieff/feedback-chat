'use client'

import { useState } from 'react'
import { FeedbackPanel } from '@nikitadmitrieff/feedback-chat'
import '@nikitadmitrieff/feedback-chat/styles.css'

export function FeedbackButton() {
  const [open, setOpen] = useState(false)
  return (
    <FeedbackPanel
      isOpen={open}
      onToggle={() => setOpen(!open)}
      apiUrl="/api/feedback-widget/chat"
    />
  )
}
