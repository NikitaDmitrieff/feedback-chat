import { execSync, execFileSync } from 'node:child_process'
import { existsSync, rmSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ensureValidToken } from './oauth.js'
import { DbLogger } from './logger.js'
import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>

const FEEDBACK_CHAT_REPO = 'NikitaDmitrieff/feedback-chat'
const STEP_TIMEOUT_MS = 5 * 60 * 1000
const CLAUDE_TIMEOUT_MS = 10 * 60 * 1000

export interface SelfImproveInput {
  jobId: string
  sourceRunId: string
  failureCategory: string
  failureAnalysis: string
  fixSummary: string
  originalIssueBody: string
  logExcerpts: string
  supabase: AnySupabaseClient
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
    const details = `Exit ${e.status}\nSTDERR: ${(e.stderr || '').slice(-2000)}\nSTDOUT: ${(e.stdout || '').slice(-2000)}`
    throw new Error(`Command failed: ${cmd}\n${details}`)
  }
}

async function claudeEnv(): Promise<NodeJS.ProcessEnv> {
  if (process.env.CLAUDE_CREDENTIALS_JSON) {
    const ok = await ensureValidToken()
    if (!ok) {
      const { CLAUDECODE: _cc, ...rest } = process.env
      return { ...rest, CI: 'true' }
    }
    try {
      const credsPath = join(homedir(), '.claude', '.credentials.json')
      const creds = JSON.parse(readFileSync(credsPath, 'utf-8'))
      const accessToken = creds?.claudeAiOauth?.accessToken
      if (accessToken) {
        const { ANTHROPIC_API_KEY: _, ...rest } = process.env
        const { CLAUDECODE: _cc, ...rest2 } = rest
        return { ...rest2, CLAUDE_CODE_OAUTH_TOKEN: accessToken, CI: 'true' }
      }
    } catch {}
  }
  const { CLAUDECODE: _cc, ...rest } = process.env
  return { ...rest, CI: 'true' }
}

function buildPrompt(input: SelfImproveInput): string {
  const scopeInstructions: Record<string, string> = {
    docs_gap: `Focus on updating documentation:
- CLAUDE.md (installation steps, gotchas, key patterns)
- Setup prompts in packages/agent/src/setup-worker.ts (the buildSetupPrompt function)
- Any README files that reference installation

Do NOT change source code unless the docs reference incorrect API/exports.`,

    widget_bug: `Focus on fixing widget source code in packages/widget/:
- Check exports in packages/widget/package.json and packages/widget/src/
- Check CSS in packages/widget/src/client/styles.css
- Check React components in packages/widget/src/client/
- Check server handlers in packages/widget/src/server/

Run \`npm run build\` from the repo root to verify the fix compiles.`,

    agent_bug: `Focus on fixing agent logic in packages/agent/:
- Check managed-worker.ts (job processing, retry logic)
- Check worker.ts (job execution, validation, Claude CLI invocation)
- Check setup-worker.ts (setup job flow)
- Check github.ts (GitHub API calls)

Run \`npm run build\` from the repo root to verify the fix compiles.`,
  }

  return `You are fixing the feedback-chat repository (https://github.com/NikitaDmitrieff/feedback-chat) based on a failure analysis.

## Failure Category: ${input.failureCategory}

## Failure Analysis
${input.failureAnalysis}

## Suggested Fix
${input.fixSummary}

## Original Issue That Triggered the Failed Run
${input.originalIssueBody.slice(0, 1000)}

## Error Logs From the Failed Run
${input.logExcerpts.slice(-3000)}

## Scope Instructions
${scopeInstructions[input.failureCategory] || 'Analyze the failure and make the minimal fix needed.'}

## Rules
- Make the MINIMAL change needed to prevent this specific failure from recurring
- Do NOT refactor unrelated code
- Do NOT add features
- Do NOT change test infrastructure
- If the fix requires changing multiple files, that's fine, but each change should be directly related to the failure
- Run \`npm run build\` to verify your changes compile`
}

export async function runSelfImproveJob(input: SelfImproveInput): Promise<{ prUrl: string | null }> {
  const { sourceRunId, failureCategory, supabase } = input
  const shortHash = sourceRunId.slice(0, 8)
  const branch = `fix/${failureCategory}-${shortHash}`
  const workDir = `/tmp/self-improve-${shortHash}`
  const logger = new DbLogger(supabase, sourceRunId)

  try {
    // 1. Clone feedback-chat
    await logger.log(`[self-improve] Cloning ${FEEDBACK_CHAT_REPO}...`)
    if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true })

    const token = process.env.GITHUB_TOKEN
    if (!token) throw new Error('GITHUB_TOKEN required for self-improvement jobs')

    // Validate push permissions before expensive Claude CLI run
    const permRes = await fetch(`https://api.github.com/repos/${FEEDBACK_CHAT_REPO}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    })
    if (permRes.ok) {
      const repo = await permRes.json()
      if (!repo.permissions?.push) {
        throw new Error(
          `GITHUB_TOKEN lacks push access to ${FEEDBACK_CHAT_REPO}. ` +
          'Self-improve requires a PAT (ghp_ prefix) with repo scope — GitHub App installation tokens are scoped to consumer repos.',
        )
      }
    }

    // Clone without token in URL to avoid leaking it in error messages
    run(`git clone --depth=1 https://github.com/${FEEDBACK_CHAT_REPO}.git ${workDir}`, '/tmp')
    // Set authenticated remote for push
    run(`git remote set-url origin https://x-access-token:${token}@github.com/${FEEDBACK_CHAT_REPO}.git`, workDir)
    run('npm install', workDir)

    // 2. Run Claude CLI with failure context
    await logger.log(`[self-improve] Running Claude CLI (category: ${failureCategory})...`)
    const prompt = buildPrompt(input)
    const env = await claudeEnv()

    execFileSync('claude', ['--dangerously-skip-permissions', '-p', prompt], {
      cwd: workDir,
      timeout: CLAUDE_TIMEOUT_MS,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    })

    // 3. Validate
    await logger.log('[self-improve] Validating (build + test)...')
    run('npm run build', workDir)

    // Run tests but don't fail on test errors — some tests may need env vars not available
    try {
      run('npm run test', workDir)
      await logger.log('[self-improve] Tests passed')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await logger.warn(`[self-improve] Tests had issues (proceeding): ${msg.slice(0, 500)}`)
    }

    // 4. Check if there are changes
    const diff = run('git diff --stat', workDir).trim()
    const untracked = run('git ls-files --others --exclude-standard', workDir).trim()
    if (!diff && !untracked) {
      await logger.warn('[self-improve] No changes generated — Claude did not modify any files')
      return { prUrl: null }
    }

    // 5. Branch, commit, push
    await logger.log(`[self-improve] Pushing branch ${branch}...`)
    run(`git checkout -b ${branch}`, workDir)
    run('git add -A', workDir)
    execFileSync(
      'git',
      ['commit', '-m', `fix(${failureCategory}): auto-fix from failed run ${shortHash}\n\nTriggered by failure analysis of run ${sourceRunId}.`],
      { cwd: workDir, timeout: STEP_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    )
    run(`git push -u origin ${branch}`, workDir)

    // 6. Create PR
    await logger.log('[self-improve] Creating PR...')
    const prBody = `## Self-Improvement Fix

**Category:** \`${failureCategory}\`
**Source run:** ${sourceRunId}

### Failure Analysis
${input.failureAnalysis}

### Suggested Fix
${input.fixSummary}

---
*Auto-generated by the self-improvement pipeline.*`

    const prTitle = `fix(${failureCategory}): ${input.fixSummary.slice(0, 60)}`

    const res = await fetch(`https://api.github.com/repos/${FEEDBACK_CHAT_REPO}/pulls`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        title: prTitle,
        body: prBody,
        head: branch,
        base: 'main',
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`PR creation failed: ${res.status} ${text}`)
    }

    const prData = await res.json()
    await logger.log(`[self-improve] PR created: ${prData.html_url}`)

    return { prUrl: prData.html_url }
  } finally {
    if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true })
  }
}
