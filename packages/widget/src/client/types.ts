export type Stage =
  | 'created'
  | 'queued'
  | 'running'
  | 'validating'
  | 'preview_ready'
  | 'deployed'
  | 'failed'
  | 'rejected'

export type ActivityEntry = {
  message: string
  time: string
}

export type StatusResponse = {
  stage: Stage
  issueNumber: number
  issueUrl: string
  failReason?: string
  previewUrl?: string
  prNumber?: number
  prUrl?: string
  activity?: ActivityEntry[]
}

export type Conversation = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export type SuggestionItem = {
  title: string
  description: string
  prompt: string
}

export type FeedbackPanelProps = {
  isOpen: boolean
  onToggle: () => void
  /** Suggestion chips shown on the welcome screen. Defaults to built-in examples. */
  suggestions?: SuggestionItem[]
}
