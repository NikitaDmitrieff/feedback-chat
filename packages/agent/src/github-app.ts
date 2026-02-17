import { App } from '@octokit/app'

let _app: App | null = null

function getApp(): App {
  if (!_app) {
    const appId = process.env.GITHUB_APP_ID
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY
    if (!appId || !privateKey) {
      throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set')
    }
    _app = new App({
      appId,
      privateKey: privateKey.replace(/\\n/g, '\n'),
    })
  }
  return _app
}

/** Get a short-lived installation access token. */
export async function getInstallationToken(installationId: number): Promise<string> {
  const app = getApp()
  const octokit = await app.getInstallationOctokit(installationId)
  const { token } = (await octokit.auth({ type: 'installation' })) as { token: string }
  return token
}

/** Check if GitHub App credentials are configured. */
export function isGitHubAppConfigured(): boolean {
  return !!(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY)
}
