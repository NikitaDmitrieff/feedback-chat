import { App } from '@octokit/app'
import crypto from 'node:crypto'

let _app: App | null = null

/** Get the singleton GitHub App instance. */
export function getGitHubApp(): App {
  if (!_app) {
    const appId = process.env.GITHUB_APP_ID
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY
    if (!appId || !privateKey) {
      throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set')
    }
    _app = new App({
      appId,
      privateKey: privateKey.replace(/\\n/g, '\n'),
      webhooks: { secret: process.env.GITHUB_APP_WEBHOOK_SECRET || 'unused' },
    })
  }
  return _app
}

/** Get an authenticated Octokit client scoped to a specific installation. */
export async function getInstallationOctokit(installationId: number) {
  const app = getGitHubApp()
  return app.getInstallationOctokit(installationId)
}

/** Get a short-lived installation access token (for git clone auth). */
export async function getInstallationToken(installationId: number): Promise<string> {
  const app = getGitHubApp()
  const octokit = await app.getInstallationOctokit(installationId)
  const { token } = (await octokit.auth({ type: 'installation' })) as { token: string }
  return token
}

/** Build the GitHub App installation URL. state carries the projectId. */
export function getInstallUrl(state: string): string {
  const slug = process.env.GITHUB_APP_SLUG
  if (!slug) throw new Error('GITHUB_APP_SLUG must be set')
  return `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`
}

/** Verify a GitHub webhook HMAC-SHA256 signature (timing-safe). */
export function verifyWebhookSignature(payload: string, signature: string): boolean {
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET ?? ''
  if (!signature) return false
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
  if (signature.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}
