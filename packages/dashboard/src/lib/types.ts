export type PipelineRun = {
  id: string
  github_issue_number: number
  github_pr_number: number | null
  stage: string
  triggered_by: string | null
  started_at: string
  completed_at: string | null
  result: string | null
}

export type RunLog = {
  id: number
  timestamp: string
  level: string
  message: string
}

export type DeploymentInfo = {
  state: 'pending' | 'success' | 'failure' | 'error'
  previewUrl: string | null
  description: string | null
}

export type FeedbackSession = {
  id: string
  project_id: string
  tester_id: string | null
  tester_name: string | null
  started_at: string
  last_message_at: string
  message_count: number
  ai_summary: string | null
  ai_themes: string[] | null
  github_issue_number: number | null
  status: 'open' | 'in_progress' | 'resolved' | 'dismissed'
}

export type FeedbackMessage = {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export type FeedbackTheme = {
  id: string
  project_id: string
  name: string
  description: string | null
  color: string
  message_count: number
  last_seen_at: string
}

export type TesterSummary = {
  tester_id: string
  tester_name: string | null
  session_count: number
  last_active: string
  top_themes: { name: string; color: string; count: number }[]
  resolved_count: number
  total_count: number
}

export type SetupStatus =
  | 'pending'
  | 'installing'
  | 'queued'
  | 'cloning'
  | 'generating'
  | 'committing'
  | 'pr_created'
  | 'complete'
  | 'failed'

export type ProjectSetupInfo = {
  github_installation_id: number | null
  setup_status: SetupStatus
  setup_pr_url: string | null
  setup_error: string | null
}
