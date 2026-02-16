-- Add setup_progress JSONB column to track onboarding checklist state
-- Keys: install, env_vars, webhook, labels (boolean values)
ALTER TABLE feedback_chat.projects
ADD COLUMN IF NOT EXISTS setup_progress JSONB NOT NULL DEFAULT '{}'::jsonb;
