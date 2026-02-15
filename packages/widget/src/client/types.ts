export type Stage =
  | 'created'
  | 'queued'
  | 'running'
  | 'validating'
  | 'preview_ready'
  | 'deployed'
  | 'failed'
  | 'rejected'

export type StatusResponse = {
  stage: Stage
  issueNumber: number
  issueUrl: string
  failReason?: string
  previewUrl?: string
  prNumber?: number
  prUrl?: string
}

export type Conversation = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export type FeedbackPanelProps = {
  isOpen: boolean
  onToggle: () => void
}
