'use client'

import { useState } from 'react'
import { makeAssistantToolUI } from '@assistant-ui/react'
import { Check, Copy, ChevronRight } from 'lucide-react'
import { PipelineTracker } from './pipeline-tracker'

type SubmitArgs = {
  summary: string
  generated_prompt: string
  spec_content?: string
}

type SubmitResult = {
  success: boolean
  github_issue_url?: string
  message?: string
}

type SubmissionResultProps = {
  args: SubmitArgs
  result?: SubmitResult
}

export const SubmitRequestToolUI = makeAssistantToolUI<SubmitArgs, SubmitResult>({
  toolName: 'submit_request',
  render: function SubmitRequest({ args, result, status }) {
    if (status.type === 'running') {
      return (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <div className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
          Submitting...
        </div>
      )
    }

    if (status.type === 'incomplete') {
      return (
        <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
          An error occurred while submitting.
        </div>
      )
    }

    if (!args.summary) return null

    return <div className="my-3"><SubmissionResult args={args} result={result} /></div>
  },
})

function SubmissionResult({ args, result }: SubmissionResultProps) {
  const [copied, setCopied] = useState(false)
  const [promptExpanded, setPromptExpanded] = useState(false)

  async function handleCopy(text: string): Promise<void> {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-muted/50 px-3 py-2.5">
        <p className="text-[13px] leading-relaxed">{args.summary}</p>
      </div>

      {result?.github_issue_url && (
        <PipelineTracker issueUrl={result.github_issue_url} />
      )}

      <div className="rounded-xl border border-border overflow-hidden">
        <button
          onClick={() => setPromptExpanded(!promptExpanded)}
          className="flex w-full items-center gap-1.5 px-3 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight
            className="h-3 w-3 transition-transform duration-150"
            style={{ transform: promptExpanded ? 'rotate(90deg)' : undefined }}
          />
          Generated prompt
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleCopy(args.generated_prompt)
            }}
            className="ml-auto inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {copied ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </button>
        {promptExpanded && (
          <pre
            className="max-h-40 overflow-auto border-t border-border bg-[#0a0a0a] px-3 py-2.5 text-[11px] leading-relaxed text-zinc-400"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {args.generated_prompt}
          </pre>
        )}
      </div>
    </div>
  )
}
