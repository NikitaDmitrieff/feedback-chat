'use client'

import { useState } from 'react'
import { makeAssistantToolUI } from '@assistant-ui/react'
import { useThreadRuntime } from '@assistant-ui/react'
import { Check } from 'lucide-react'

export const PresentOptionsToolUI = makeAssistantToolUI<
  { options: string[] },
  { presented: boolean; count: number }
>({
  toolName: 'present_options',
  render: function PresentOptions({ args }) {
    const threadRuntime = useThreadRuntime()
    const [selected, setSelected] = useState<string | null>(null)

    if (!args.options) return null

    if (selected) {
      return (
        <div className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
          <Check className="h-3.5 w-3.5" />
          {selected}
        </div>
      )
    }

    return (
      <div className="flex flex-wrap gap-2 py-2">
        {args.options.map((option, i) => (
          <button
            key={i}
            onClick={() => {
              setSelected(option)
              threadRuntime.append({
                role: 'user',
                content: [{ type: 'text', text: option }],
              })
            }}
            className="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-all hover:border-foreground/20 hover:bg-muted active:scale-95"
          >
            {option}
          </button>
        ))}
      </div>
    )
  },
})
