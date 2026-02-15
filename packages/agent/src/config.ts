export interface AgentConfig {
  installCommand: string
  buildCommand: string
  lintCommand: string
  claudeTimeoutMs: number
  jobBudgetMs: number
  envForwardPatterns: string[]
}

export function loadConfig(): AgentConfig {
  return {
    installCommand: process.env.AGENT_INSTALL_CMD ?? 'npm ci',
    buildCommand: process.env.AGENT_BUILD_CMD ?? 'npm run build',
    lintCommand: process.env.AGENT_LINT_CMD ?? 'npm run lint',
    claudeTimeoutMs: Number(process.env.AGENT_CLAUDE_TIMEOUT_MS) || 15 * 60 * 1000,
    jobBudgetMs: Number(process.env.AGENT_JOB_BUDGET_MS) || 25 * 60 * 1000,
    envForwardPatterns: (process.env.AGENT_ENV_FORWARD ?? 'NEXT_PUBLIC_*').split(','),
  }
}

/**
 * Check if an env key matches any of the forward patterns.
 * Supports simple glob: `NEXT_PUBLIC_*` matches any key starting with `NEXT_PUBLIC_`.
 */
export function matchesEnvPattern(key: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith('*')) {
      return key.startsWith(pattern.slice(0, -1))
    }
    return key === pattern
  })
}
