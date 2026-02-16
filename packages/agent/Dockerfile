# --- Build stage ---
FROM node:22-slim AS builder

WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.base.json tsconfig.json ./
COPY src/ src/
RUN npm run build

# --- Runtime stage ---
FROM node:22-slim

# System dependencies (git for cloning consumer repos, curl for health checks)
RUN apt-get update && \
    apt-get install -y --no-install-recommends git curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user — Claude Code CLI refuses --dangerously-skip-permissions as root
RUN useradd -m -s /bin/bash agent

WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY --from=builder /app/dist/ dist/

# Ownership for non-root user (app dir + /tmp for job working directories)
RUN chown -R agent:agent /app /tmp
USER agent

# Git config for commits created by the agent
RUN git config --global user.email "agent@feedback-chat" && \
    git config --global user.name "feedback-agent"

# Skip Claude Code onboarding prompt — required for CLAUDE_CODE_OAUTH_TOKEN to work
# See: https://github.com/anthropics/claude-code/issues/8938
RUN echo '{"hasCompletedOnboarding":true}' > /home/agent/.claude.json

CMD ["node", "dist/managed-worker.js"]
