# Tier 1: Chat Only Setup

The simplest tier — an AI-powered feedback chatbot in a side panel. No GitHub, no agent. Conversations persist in localStorage.

## What you get

- Password-gated side panel with AI chat
- Multi-conversation support (up to 10 conversations)
- `present_options` tool: AI presents clickable choices
- `submit_request` tool: AI generates a structured prompt (copyable, no automation)
- All state in localStorage — no database needed

## 1. Install

```bash
npm install @nikitadmitrieff/feedback-chat \
  @assistant-ui/react @assistant-ui/react-ai-sdk @assistant-ui/react-markdown \
  ai @ai-sdk/anthropic
```

## 2. Configure Tailwind v4

Add this line to your `globals.css` **after** `@import "tailwindcss"`:

```css
@source "../node_modules/@nikitadmitrieff/feedback-chat/dist/**/*.js";
```

**This is mandatory.** Tailwind v4 excludes `node_modules` from automatic content detection. Without this line, the widget renders completely unstyled.

## 3. Create the chat API route

Create `app/api/feedback/chat/route.ts` (or `src/app/api/feedback/chat/route.ts`):

```ts
import { createFeedbackHandler } from '@nikitadmitrieff/feedback-chat/server'

const handler = createFeedbackHandler({
  password: process.env.FEEDBACK_PASSWORD!,
})

export const POST = handler.POST
```

## 4. Create the status API route

Even in chat-only mode, the status route is needed (the widget references it):

```ts
import { createStatusHandler } from '@nikitadmitrieff/feedback-chat/server'

const handler = createStatusHandler({
  password: process.env.FEEDBACK_PASSWORD!,
})

export const { GET, POST } = handler
```

## 5. Add FeedbackPanel to your app

Create a client component:

```tsx
'use client'

import { useState } from 'react'
import { FeedbackPanel } from '@nikitadmitrieff/feedback-chat'
import '@nikitadmitrieff/feedback-chat/styles.css'

export function FeedbackButton() {
  const [open, setOpen] = useState(false)
  return <FeedbackPanel isOpen={open} onToggle={() => setOpen(!open)} />
}
```

Render it in your root layout:

```tsx
import { FeedbackButton } from '@/components/FeedbackButton'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <FeedbackButton />
      </body>
    </html>
  )
}
```

## 6. Environment variables

```env
ANTHROPIC_API_KEY=sk-ant-...       # Powers the chat (Haiku by default)
FEEDBACK_PASSWORD=your-password    # Gates access to the widget
```

## Cost

~$0.01 per conversation (Haiku model).
