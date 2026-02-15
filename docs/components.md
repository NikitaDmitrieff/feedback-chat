# Client Components

## FeedbackPanel

The main widget. Renders a bottom-center trigger bar and a 400px side panel.

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

### Anatomy

```
┌──────────────────────────────────────────────────────────────────┐
│ App                                                              │
│                                                                  │
│                                    ┌────────────────────────────┐│
│                                    │ Side Panel (400px)         ││
│                                    │ ┌────────────────────────┐ ││
│                                    │ │ ConversationTabs       │ ││
│                                    │ │ [Chat 1] [Chat 2] [+] │ ││
│                                    │ └────────────────────────┘ ││
│                                    │                            ││
│                                    │ Thread (messages)          ││
│                                    │ - AI messages (markdown)   ││
│                                    │ - User messages            ││
│                                    │ - Tool UIs:                ││
│                                    │   - present_options chips  ││
│                                    │   - submit_request result  ││
│                                    │     (with PipelineTracker) ││
│                                    │                            ││
│                                    │ ┌────────────────────────┐ ││
│                                    │ │ Composer (input)       │ ││
│                                    │ └────────────────────────┘ ││
│                                    └────────────────────────────┘│
│                                                                  │
│               ┌──────────────────────┐                           │
│               │ Trigger Bar (bottom) │                           │
│               └──────────────────────┘                           │
└──────────────────────────────────────────────────────────────────┘
```

### Password gate

On first open, the user enters the password (matched against `FEEDBACK_PASSWORD` server-side). Stored in `sessionStorage` — clears when the tab closes.

### Pipeline status indicator

When a pipeline is active (issue being processed by the agent), the trigger bar shows a green pulsing dot. This is driven by:
- `localStorage['feedback_active_pipeline']` — `{ issueNumber, stage }`
- Custom `pipeline-status` event on `window`

---

## ConversationTabs

Browser-style tabs for switching between conversations. Rendered inside FeedbackPanel.

- Shows tab title (auto-generated from first message, max 40 chars)
- `+` button creates a new conversation
- `×` button deletes a conversation
- Max 10 conversations (oldest removed when limit reached)

---

## PipelineTracker

Real-time pipeline progress display with user actions.

```tsx
import { PipelineTracker } from '@nikitadmitrieff/feedback-chat'

<PipelineTracker
  issueUrl="https://github.com/owner/repo/issues/42"
  statusEndpoint="/api/feedback/status"  // optional, this is the default
/>
```

### Stages displayed

```
✓ Created → ✓ Queued → ● Running → ○ Validating → ○ Preview → ○ Deployed
```

- Completed stages: checkmark
- Active stage: pulsing dot with activity sub-line
- Future stages: empty circle

### Activity sub-line

Under the active step, shows:
- Latest GitHub issue comment (or fallback stage message)
- Timer (`m:ss`) that resets on stage change

### User actions

At **preview_ready**:
- **Approve** — squash-merges PR, deploys
- **Reject** — closes PR, marks rejected
- **Request changes** — opens text input, posts as issue comment, triggers retry

At **failed**:
- **Retry** — resets labels, reopens issue

---

## Tool UIs

### present_options

When the AI uses the `present_options` tool, the widget renders 2-5 clickable chips. Clicking one sends the selection as a user message.

### submit_request

When the AI uses `submit_request`, the widget renders:
1. A summary box
2. The PipelineTracker (if a GitHub issue was created)
3. An expandable "Generated prompt" code block for copying

---

## useConversations Hook

Manages multi-conversation state with localStorage persistence.

```ts
const {
  conversations,   // Conversation[] — sorted by updatedAt desc, max 10
  activeId,        // string — current conversation ID
  switchTo,        // (id) => void — switch to existing conversation
  create,          // () => void — save current, create new
  remove,          // (id) => void — delete conversation
  save,            // () => void — manual save (auto-save is debounced 400ms)
} = useConversations()
```

### localStorage keys

| Key | Content |
|-----|---------|
| `feedback_conversations` | JSON array of `Conversation` objects |
| `feedback_conv_{id}` | Serialized thread state (AI SDK `exportExternalState` format) |
| `feedback_active_conv` | ID of the active conversation |

### Auto-save behavior

- Debounced with 400ms delay on any thread state change
- Immediate save on panel close
- Immediate save on conversation switch
