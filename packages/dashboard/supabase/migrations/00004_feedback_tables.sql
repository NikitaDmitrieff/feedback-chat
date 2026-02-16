-- Feedback sessions: one row per widget conversation
create table feedback_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade not null,
  tester_id text,
  tester_name text,
  started_at timestamptz default now(),
  last_message_at timestamptz default now(),
  message_count int default 0,
  ai_summary text,
  ai_themes jsonb,
  github_issue_number int,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'resolved', 'dismissed'))
);

-- Feedback messages: individual messages in a conversation
create table feedback_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references feedback_sessions(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz default now()
);

-- Feedback themes: AI-generated theme registry per project
create table feedback_themes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade not null,
  name text not null,
  description text,
  color text not null,
  message_count int default 0,
  last_seen_at timestamptz default now()
);

-- Indexes
create index idx_feedback_sessions_project on feedback_sessions(project_id, last_message_at desc);
create index idx_feedback_sessions_tester on feedback_sessions(project_id, tester_id);
create index idx_feedback_messages_session on feedback_messages(session_id, created_at);
create index idx_feedback_themes_project on feedback_themes(project_id);

-- RLS
alter table feedback_sessions enable row level security;
alter table feedback_messages enable row level security;
alter table feedback_themes enable row level security;

-- Users see own sessions (via project ownership)
create policy "Users see own sessions" on feedback_sessions
  for all using (project_id in (select id from projects where user_id = auth.uid()));

-- Users see own messages (via session → project ownership)
create policy "Users see own messages" on feedback_messages
  for all using (session_id in (
    select fs.id from feedback_sessions fs
    join projects p on fs.project_id = p.id
    where p.user_id = auth.uid()
  ));

-- Users see own themes (via project ownership)
create policy "Users see own themes" on feedback_themes
  for all using (project_id in (select id from projects where user_id = auth.uid()));
