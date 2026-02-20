-- Proposals system: AI-generated improvement suggestions + strategy memory

-- Proposals: AI-generated improvement suggestions awaiting human review
CREATE TABLE IF NOT EXISTS feedback_chat.proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES feedback_chat.projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  rationale text NOT NULL,
  spec text NOT NULL,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'implementing', 'done', 'rejected')),
  source_theme_ids uuid[] DEFAULT '{}',
  source_session_ids uuid[] DEFAULT '{}',
  user_notes text,
  reject_reason text,
  github_issue_number int,
  scores jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  completed_at timestamptz
);

-- Strategy memory: tracks proposal outcomes for learning
CREATE TABLE IF NOT EXISTS feedback_chat.strategy_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES feedback_chat.projects(id) ON DELETE CASCADE,
  proposal_id uuid REFERENCES feedback_chat.proposals(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('proposed', 'approved', 'rejected', 'completed', 'failed')),
  title text NOT NULL,
  themes text[] DEFAULT '{}',
  outcome_notes text,
  edit_distance real,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_proposals_project ON feedback_chat.proposals(project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON feedback_chat.proposals(status) WHERE status IN ('draft', 'approved', 'implementing');
CREATE INDEX IF NOT EXISTS idx_strategy_memory_project ON feedback_chat.strategy_memory(project_id, created_at DESC);

-- Expand job_type to include 'strategize'
ALTER TABLE feedback_chat.job_queue DROP CONSTRAINT IF EXISTS job_queue_job_type_check;
ALTER TABLE feedback_chat.job_queue ADD CONSTRAINT job_queue_job_type_check
  CHECK (job_type IN ('agent', 'setup', 'self_improve', 'strategize'));

-- Add product_context to projects (vision/constraints for strategist)
ALTER TABLE feedback_chat.projects ADD COLUMN IF NOT EXISTS product_context text;

-- Add autonomy_mode to projects (audit → assist → automate)
ALTER TABLE feedback_chat.projects ADD COLUMN IF NOT EXISTS autonomy_mode text NOT NULL DEFAULT 'audit'
  CHECK (autonomy_mode IN ('audit', 'assist', 'automate'));

-- RLS policies (same pattern as existing tables — user sees own projects' data)
ALTER TABLE feedback_chat.proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proposals_all_own_project"
  ON feedback_chat.proposals
  FOR ALL USING (project_id IN (SELECT id FROM feedback_chat.projects WHERE user_id = auth.uid()));

ALTER TABLE feedback_chat.strategy_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "strategy_memory_all_own_project"
  ON feedback_chat.strategy_memory
  FOR ALL USING (project_id IN (SELECT id FROM feedback_chat.projects WHERE user_id = auth.uid()));
