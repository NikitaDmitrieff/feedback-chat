import { execSync, execFileSync } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { parseIssueBody } from './parse-issue.js'
import {
  commentOnIssue,
  labelIssue,
  createPR,
  findOpenPR,
  removeLabelFromIssue,
  getIssueComments,
} from './github.js'
import { ensureValidToken } from './oauth.js'
import { loadConfig, matchesEnvPattern } from './config.js'

const STEP_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes per build/test step
const MAX_FIX_ATTEMPTS = 2
const MIN_RETRY_BUDGET_MS = 3 * 60 * 1000 // need at least 3 min for a retry

interface JobInput {
  issueNumber: number
  issueTitle: string
  issueBody: string
}

interface ValidationResult {
  success: boolean
  stage: 'build' | 'lint'
  errorOutput: string
  changedFiles: string[]
}

function run(cmd: string, cwd: string, timeoutMs = STEP_TIMEOUT_MS): string {
  try {
    return execSync(cmd, {
      cwd,
      timeout: timeoutMs,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CI: 'true' },
    })
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string; status?: number }
    const details = `Exit code: ${e.status}\nSTDERR: ${(e.stderr || '').slice(-2000)}\nSTDOUT: ${(e.stdout || '').slice(-2000)}`
    throw new Error(`Command failed: ${cmd}\n${details}`)
  }
}

// Build env for Claude CLI: strip ANTHROPIC_API_KEY when OAuth credentials exist
// so the CLI falls back to the Max subscription OAuth token
function claudeEnv(): NodeJS.ProcessEnv {
  if (!process.env.CLAUDE_CREDENTIALS_JSON) return process.env
  const { ANTHROPIC_API_KEY: _, ...rest } = process.env
  return rest
}

async function runClaude(prompt: string, workDir: string, issueNumber: number, timeoutMs: number): Promise<void> {
  // Refresh OAuth token if needed before invoking the CLI
  if (process.env.CLAUDE_CREDENTIALS_JSON) {
    const ok = await ensureValidToken()
    if (!ok) {
      throw new Error('OAuth token refresh failed — cannot run Claude CLI')
    }
  }

  console.log(`[job-${issueNumber}] Running Claude Code CLI...`)
  execFileSync(
    'claude',
    ['--dangerously-skip-permissions', '-p', prompt],
    {
      cwd: workDir,
      timeout: timeoutMs,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: claudeEnv(),
    }
  )
}

function getChangedFiles(workDir: string): string[] {
  const modified = run('git diff --name-only HEAD', workDir).trim()
  const untracked = run('git ls-files --others --exclude-standard', workDir).trim()
  return [modified, untracked]
    .filter(Boolean)
    .join('\n')
    .split('\n')
    .filter((f) => /\.(ts|tsx|js|jsx)$/.test(f))
}

function validate(workDir: string, issueNumber: number, buildCommand: string): ValidationResult {
  // Build
  try {
    console.log(`[job-${issueNumber}] Running build validation...`)
    run(buildCommand, workDir)
    console.log(`[job-${issueNumber}] Build passed`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, stage: 'build', errorOutput: msg, changedFiles: [] }
  }

  // Lint changed files only
  const changedFiles = getChangedFiles(workDir)
  if (changedFiles.length === 0) {
    return { success: true, stage: 'lint', errorOutput: '', changedFiles: [] }
  }

  try {
    console.log(`[job-${issueNumber}] Running lint on ${changedFiles.length} changed files...`)
    run(`npx eslint ${changedFiles.join(' ')}`, workDir)
    console.log(`[job-${issueNumber}] Lint passed`)
    return { success: true, stage: 'lint', errorOutput: '', changedFiles }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, stage: 'lint', errorOutput: msg, changedFiles }
  }
}

async function fail(issueNumber: number, reason: string, logs: string, workDir: string) {
  try {
    const truncated = logs.length > 3000 ? logs.slice(-3000) : logs
    await commentOnIssue(
      issueNumber,
      `Agent failed: ${reason}\n\n<details><summary>Logs (last 3000 chars)</summary>\n\n\`\`\`\n${truncated}\n\`\`\`\n\n</details>`
    )
    await removeLabelFromIssue(issueNumber, 'in-progress')
    await labelIssue(issueNumber, ['agent-failed'])
  } catch (err) {
    console.error(`[job-${issueNumber}] Failed to report error to GitHub:`, err)
  }
  cleanup(workDir)
}

function cleanup(workDir: string) {
  if (existsSync(workDir)) {
    rmSync(workDir, { recursive: true, force: true })
  }
}

export async function runJob(input: JobInput): Promise<void> {
  const config = loadConfig()
  const { issueNumber, issueTitle, issueBody } = input
  const workDir = `/tmp/job-${issueNumber}`
  const jobStart = Date.now()

  console.log(`[job-${issueNumber}] Starting`)

  // 1. Parse issue
  let parsed
  try {
    parsed = parseIssueBody(issueBody)
  } catch (err) {
    await commentOnIssue(issueNumber, `Agent could not parse issue body: ${err}`)
    await labelIssue(issueNumber, ['agent-failed'])
    return
  }

  // Mark as in-progress
  await labelIssue(issueNumber, ['in-progress'])
  await commentOnIssue(issueNumber, 'Picked up')

  // 2. Clone & setup
  const repo = process.env.GITHUB_REPO
  const token = process.env.GITHUB_TOKEN
  try {
    cleanup(workDir) // Clean any leftover from a previous failed run
    run(
      `git clone --depth=1 https://x-access-token:${token}@github.com/${repo}.git ${workDir}`,
      '/tmp'
    )
    run(config.installCommand, workDir)

    // Write .env.local for build (forward env vars matching configured patterns)
    const envKeys = Object.keys(process.env).filter(
      (k) => matchesEnvPattern(k, config.envForwardPatterns)
    )
    if (envKeys.length > 0) {
      const envContent = envKeys.map((k) => `${k}=${process.env[k]}`).join('\n')
      writeFileSync(`${workDir}/.env.local`, envContent + '\n')
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    await fail(issueNumber, `Clone or ${config.installCommand} failed`, msg, workDir)
    return
  }

  // 2b. Pre-lint: catch pre-existing errors before Claude touches anything
  let preLintErrors = ''
  try {
    run(config.lintCommand, workDir)
    console.log(`[job-${issueNumber}] Pre-lint clean`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    preLintErrors = msg
    console.log(`[job-${issueNumber}] Pre-existing lint errors found, will include in prompt`)
  }

  // 3. Retry detection — check for modification requests in recent comments
  let retryFeedback = ''
  try {
    const comments = await getIssueComments(issueNumber, 5)
    const modComment = comments.find((c) =>
      c.body.startsWith('**Modifications demandées :**')
    )
    if (modComment) {
      retryFeedback = modComment.body
      console.log(`[job-${issueNumber}] Retry detected — appending modification feedback`)
    }
  } catch (err) {
    console.log(`[job-${issueNumber}] Could not fetch comments for retry detection:`, err)
  }

  // 4. Run Claude Code CLI
  let prompt =
    parsed.promptType === 'ralph_loop' && parsed.specContent
      ? `${parsed.generatedPrompt}\n\nSpec:\n${parsed.specContent}`
      : parsed.generatedPrompt

  if (retryFeedback) {
    prompt += `\n\nIMPORTANT — This is a RETRY. The user reviewed the previous implementation and requested changes:\n\n${retryFeedback}\n\nAddress this feedback in your implementation.`
  }

  if (preLintErrors) {
    prompt += `\n\nIMPORTANT: Before implementing the above request, fix these pre-existing lint errors in the codebase:\n\n${preLintErrors}`
  }

  try {
    const initialTimeout = Math.min(config.claudeTimeoutMs, config.jobBudgetMs - (Date.now() - jobStart))
    console.log(`[job-${issueNumber}] Running Claude Code CLI with prompt: ${prompt.slice(0, 200)}...`)
    await runClaude(prompt, workDir, issueNumber, initialTimeout)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    const isTimeout = msg.includes('TIMEOUT') || msg.includes('timed out')
    await fail(
      issueNumber,
      isTimeout ? `Claude Code CLI timed out (${Math.round(config.claudeTimeoutMs / 60_000)} min limit)` : 'Claude Code CLI failed',
      msg,
      workDir
    )
    return
  }

  // 4. Validate with escalating fix retry loop
  let result = validate(workDir, issueNumber, config.buildCommand)

  for (let attempt = 1; attempt <= MAX_FIX_ATTEMPTS && !result.success; attempt++) {
    const elapsed = Date.now() - jobStart
    const remaining = config.jobBudgetMs - elapsed

    if (remaining < MIN_RETRY_BUDGET_MS) {
      console.log(`[job-${issueNumber}] Budget exhausted (${Math.round(elapsed / 1000)}s elapsed), cannot retry`)
      break
    }

    // Level 1: Try eslint --fix for lint errors (free, instant)
    if (result.stage === 'lint' && result.changedFiles.length > 0) {
      await commentOnIssue(issueNumber, `Auto-fix ${attempt}/${MAX_FIX_ATTEMPTS}`)
      console.log(`[job-${issueNumber}] Attempting eslint --fix (attempt ${attempt})...`)
      try {
        run(`npx eslint --fix ${result.changedFiles.join(' ')}`, workDir)
      } catch {
        // eslint --fix may exit non-zero even when it fixes some issues
      }
      result = validate(workDir, issueNumber, config.buildCommand)
      if (result.success) break
    }

    // Level 2: Ask Claude to fix the errors
    const fixPrompt = `The ${result.stage} step failed with the following errors. Fix them without changing any unrelated code:\n\n${result.errorOutput}`
    await commentOnIssue(issueNumber, `Retry ${attempt}/${MAX_FIX_ATTEMPTS} (${result.stage})`)

    try {
      const claudeTimeout = Math.min(remaining - 60_000, config.claudeTimeoutMs)
      await runClaude(fixPrompt, workDir, issueNumber, claudeTimeout)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`[job-${issueNumber}] Claude fix attempt ${attempt} failed: ${msg.slice(0, 200)}`)
    }

    result = validate(workDir, issueNumber, config.buildCommand)
  }

  if (!result.success) {
    await fail(
      issueNumber,
      `${result.stage === 'build' ? 'Build' : 'Lint'} still failing after ${MAX_FIX_ATTEMPTS} fix attempts`,
      result.errorOutput,
      workDir
    )
    return
  }

  // 5. Branch + PR
  const branch = `feedback/issue-${issueNumber}`
  try {
    run(`git checkout -b ${branch}`, workDir)
    run('git add -A', workDir)
    execFileSync(
      'git',
      ['commit', '-m', `feat: ${issueTitle} (auto-implemented from #${issueNumber})`],
      { cwd: workDir, timeout: STEP_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    )
    run(`git push -f origin ${branch}`, workDir)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    await fail(issueNumber, 'Git branch/push failed', msg, workDir)
    return
  }

  // 6. Create PR if none exists
  try {
    const existing = await findOpenPR(issueNumber)
    if (!existing) {
      const pr = await createPR(
        issueNumber,
        `feat: ${issueTitle} (auto-implemented from #${issueNumber})`,
        `Closes #${issueNumber}\n\nAuto-implemented by the feedback agent.`
      )
      console.log(`[job-${issueNumber}] Created PR #${pr.number}: ${pr.html_url}`)
    } else {
      console.log(`[job-${issueNumber}] PR already exists: #${existing.number}`)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    await fail(issueNumber, 'PR creation failed', msg, workDir)
    return
  }

  // 7. Update labels and comment
  await removeLabelFromIssue(issueNumber, 'in-progress')
  await removeLabelFromIssue(issueNumber, 'auto-implement')
  await labelIssue(issueNumber, ['preview-pending'])
  await commentOnIssue(
    issueNumber,
    'Preview deploying — Vercel will build the PR branch. Check the tracker for status.'
  )
  cleanup(workDir)
  console.log(`[job-${issueNumber}] Done — PR created, awaiting preview`)
}
