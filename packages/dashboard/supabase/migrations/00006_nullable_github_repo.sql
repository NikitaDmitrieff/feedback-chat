ALTER TABLE feedback_chat.projects ALTER COLUMN github_repo DROP NOT NULL;
ALTER TABLE feedback_chat.projects ALTER COLUMN github_repo SET DEFAULT '';
