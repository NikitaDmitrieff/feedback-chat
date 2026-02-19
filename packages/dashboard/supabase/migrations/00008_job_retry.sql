-- Add retry tracking columns to job_queue
ALTER TABLE feedback_chat.job_queue
  ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text;

-- Index for the stale-job reaper query
CREATE INDEX IF NOT EXISTS idx_job_queue_stale
  ON feedback_chat.job_queue(status, locked_at) WHERE status = 'processing';

-- Rebuild claim_next_job: skip jobs that have exhausted retries, increment attempt_count atomically
CREATE OR REPLACE FUNCTION feedback_chat.claim_next_job(
  p_worker_id text,
  p_skip_setup boolean DEFAULT true
)
RETURNS json AS $$
DECLARE
  claimed feedback_chat.job_queue%rowtype;
BEGIN
  SELECT * INTO claimed
  FROM feedback_chat.job_queue
  WHERE status = 'pending'
    AND attempt_count < 3
    AND (NOT p_skip_setup OR job_type != 'setup')
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF claimed.id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE feedback_chat.job_queue
  SET status = 'processing',
      worker_id = p_worker_id,
      locked_at = now(),
      attempt_count = attempt_count + 1
  WHERE id = claimed.id;

  RETURN row_to_json(claimed);
END;
$$ LANGUAGE plpgsql;
