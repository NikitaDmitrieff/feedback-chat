-- Pipeline execution enhancements: branch picker + structured log streaming

-- Allow proposals to store a custom branch name
alter table proposals add column if not exists branch_name text;

-- Add structured event columns to run_logs for tool-level streaming
alter table run_logs add column if not exists event_type text;
alter table run_logs add column if not exists payload jsonb;

-- Index for efficient log polling (used by live tail endpoint)
create index if not exists idx_run_logs_timestamp on run_logs(run_id, timestamp desc);
