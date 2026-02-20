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
  runs_triggered: number
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

export type FeedbackSource = {
  session_id: string
  tester_name: string | null
  ai_summary: string | null
  ai_themes: string[] | null
}

export type EnrichedPipelineRun = PipelineRun & {
  feedback_source: FeedbackSource | null
}

export type TimelineEvent = {
  id: string
  type: 'conversation_started' | 'issue_created' | 'run_triggered' | 'run_completed' | 'feedback_resolved'
  timestamp: string
  session_id?: string
  ai_summary?: string | null
  message_preview?: string
  github_issue_number?: number
  issue_title?: string
  run_id?: string
  stage?: string
  result?: string | null
  github_pr_number?: number | null
}

export type TesterProfile = {
  tester_id: string
  tester_name: string | null
  first_seen: string
  last_active: string
  session_count: number
  resolved_count: number
  runs_triggered: number
  top_themes: { name: string; color: string; count: number }[]
  timeline: TimelineEvent[]
  sessions: FeedbackSession[]
}

export type Proposal = {
  id: string
  project_id: string
  title: string
  rationale: string
  spec: string
  priority: 'high' | 'medium' | 'low'
  status: 'draft' | 'approved' | 'implementing' | 'done' | 'rejected'
  source_theme_ids: string[]
  source_session_ids: string[]
  user_notes: string | null
  reject_reason: string | null
  github_issue_number: number | null
  branch_name: string | null
  scores: {
    impact?: number
    feasibility?: number
    novelty?: number
    alignment?: number
  }
  created_at: string
  reviewed_at: string | null
  completed_at: string | null
}

export type StrategyMemoryEvent = {
  id: string
  project_id: string
  proposal_id: string | null
  event_type: 'proposed' | 'approved' | 'rejected' | 'completed' | 'failed'
  title: string
  themes: string[]
  outcome_notes: string | null
  edit_distance: number | null
  created_at: string
}
