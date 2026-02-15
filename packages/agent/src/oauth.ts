import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ANTHROPIC_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token'
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const REFRESH_BUFFER_MS = 5 * 60 * 1000 // refresh 5 min before expiry

interface OAuthCredentials {
  claudeAiOauth: {
    accessToken: string
    refreshToken: string
    expiresAt: number
    scopes: string[]
    subscriptionType?: string
    rateLimitTier?: string
  }
}

const credsPath = join(homedir(), '.claude', '.credentials.json')

/** Write initial credentials from env var at startup */
export function initCredentials(): boolean {
  const credsJson = process.env.CLAUDE_CREDENTIALS_JSON
  if (!credsJson) return false

  mkdirSync(join(homedir(), '.claude'), { recursive: true })
  writeFileSync(credsPath, credsJson)
  console.log('[oauth] Wrote initial credentials to', credsPath)
  return true
}

function readCredentials(): OAuthCredentials | null {
  try {
    return JSON.parse(readFileSync(credsPath, 'utf-8'))
  } catch {
    return null
  }
}

function writeCredentials(creds: OAuthCredentials): void {
  writeFileSync(credsPath, JSON.stringify(creds))
}

/**
 * Ensure the OAuth access token is valid before running Claude CLI.
 * If expired (or about to expire), refresh it using the refresh token.
 * Returns true if credentials are ready, false if unavailable.
 */
export async function ensureValidToken(): Promise<boolean> {
  const creds = readCredentials()
  if (!creds) {
    console.warn('[oauth] No credentials file found')
    return false
  }

  const oauth = creds.claudeAiOauth
  const now = Date.now()

  if (oauth.expiresAt > now + REFRESH_BUFFER_MS) {
    const minutesLeft = Math.round((oauth.expiresAt - now) / 60_000)
    console.log(`[oauth] Token valid (${minutesLeft} min remaining)`)
    return true
  }

  console.log('[oauth] Token expired or expiring soon, refreshing...')

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
      console.error(`[oauth] Refresh failed (${res.status}): ${body}`)
      return false
    }

    const data = (await res.json()) as {
      access_token: string
      refresh_token: string
      expires_in: number
    }

    creds.claudeAiOauth = {
      ...oauth,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: now + data.expires_in * 1000,
    }

    writeCredentials(creds)
    console.log(
      `[oauth] Token refreshed, valid for ${Math.round(data.expires_in / 60)} min`
    )
    return true
  } catch (err) {
    console.error('[oauth] Refresh request failed:', err)
    return false
  }
}
