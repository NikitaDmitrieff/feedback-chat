#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { platform } from 'node:os'

const ANTHROPIC_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token'
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'

function log(msg: string) { console.error(msg) }
function err(msg: string) { console.error(`\x1b[31m${msg}\x1b[0m`); process.exit(1) }
function ok(msg: string) { console.error(`\x1b[32m${msg}\x1b[0m`) }
function dim(msg: string) { console.error(`\x1b[2m${msg}\x1b[0m`) }

async function main() {
  if (platform() !== 'darwin') {
    err('This tool only works on macOS (reads from the system keychain).')
  }

  // 1. Extract from keychain
  log('Extracting Claude Code credentials from macOS keychain...')
  let raw: string
  try {
    raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -a "$USER" -w',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim()
  } catch {
    err(
      'Could not find "Claude Code-credentials" in keychain.\n' +
      'Make sure Claude Code is installed and you have logged in at least once.\n' +
      'Run: claude login',
    )
    return // unreachable, keeps TS happy
  }

  // 2. Parse and validate structure
  let creds: { claudeAiOauth?: {
    accessToken?: string
    refreshToken?: string
    expiresAt?: number
    scopes?: string[]
    subscriptionType?: string
  } }
  try {
    creds = JSON.parse(raw)
  } catch {
    err('Keychain entry is not valid JSON. Re-authenticate with: claude login')
    return
  }

  const oauth = creds.claudeAiOauth
  if (!oauth?.accessToken || !oauth?.refreshToken) {
    err(
      'Credentials found but missing accessToken or refreshToken.\n' +
      'Re-authenticate with: claude login',
    )
    return
  }

  ok('Credentials extracted from keychain')

  // 3. Check expiry
  const now = Date.now()
  const expiresAt = oauth.expiresAt ?? 0
  const expired = expiresAt <= now
  const minutesLeft = Math.round((expiresAt - now) / 60_000)

  if (expired) {
    log(`Access token expired ${Math.abs(minutesLeft)} min ago — refreshing...`)
  } else {
    dim(`Access token valid (${minutesLeft} min remaining)`)
  }

  // 4. Test refresh to validate the refresh token works
  log('Testing refresh token against Anthropic OAuth...')
  try {
    const res = await fetch(ANTHROPIC_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: oauth.refreshToken,
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      err(
        `Refresh token is invalid or expired (${res.status}).\n` +
        `Response: ${body}\n\n` +
        'Re-authenticate with: claude login\n' +
        'Then run this command again.',
      )
      return
    }

    const data = await res.json() as {
      access_token: string
      refresh_token: string
      expires_in: number
    }

    ok(`Refresh successful — new token valid for ${Math.round(data.expires_in / 60)} min`)

    // Build the output with the fresh tokens
    const freshCreds = {
      claudeAiOauth: {
        ...oauth,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: now + data.expires_in * 1000,
      },
    }

    const json = JSON.stringify(freshCreds)

    log('')
    ok('Ready to use. The JSON below has been printed to stdout (pipe-friendly).')
    dim('Example: npm run credentials | pbcopy')
    dim('Example: npm run credentials | railway variables set CLAUDE_CREDENTIALS_JSON=$(cat)')
    log('')

    // Print to stdout (not stderr) so it can be piped
    process.stdout.write(json + '\n')
  } catch (fetchErr) {
    err(`Network error during refresh: ${fetchErr}`)
  }
}

main()
