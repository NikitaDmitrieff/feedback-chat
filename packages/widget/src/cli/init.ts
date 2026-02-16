import prompts from 'prompts'
import { existsSync, writeFileSync, appendFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'

type Tier = 'chat' | 'github' | 'pipeline'

const CHAT_ROUTE_TEMPLATE = (tier: Tier) => `\
import { createFeedbackHandler } from '@nikitadmitrieff/feedback-chat/server'

const handler = createFeedbackHandler({
  password: process.env.FEEDBACK_PASSWORD!,${tier !== 'chat' ? `
  github: {
    token: process.env.GITHUB_TOKEN!,
    repo: process.env.GITHUB_REPO!,
  },` : ''}
  // projectContext: 'Describe your app here so the AI gives better responses',
})

export const POST = handler.POST
`

const STATUS_ROUTE_TEMPLATE = (tier: Tier) => {
  if (tier === 'chat') {
    return `\
import { createStatusHandler } from '@nikitadmitrieff/feedback-chat/server'

const handler = createStatusHandler({
  password: process.env.FEEDBACK_PASSWORD!,
})

export const { GET, POST } = handler
`
  }

  if (tier === 'github') {
    return `\
import { createStatusHandler } from '@nikitadmitrieff/feedback-chat/server'

const handler = createStatusHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  github: {
    token: process.env.GITHUB_TOKEN!,
    repo: process.env.GITHUB_REPO!,
  },
})

export const { GET, POST } = handler
`
  }

  // pipeline
  return `\
import { createStatusHandler } from '@nikitadmitrieff/feedback-chat/server'

const handler = createStatusHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  github: {
    token: process.env.GITHUB_TOKEN!,
    repo: process.env.GITHUB_REPO!,
  },
  agentUrl: process.env.AGENT_URL,
})

export const { GET, POST } = handler
`
}

const FEEDBACK_BUTTON_TEMPLATE = `\
'use client'

import { useState } from 'react'
import { FeedbackPanel } from '@nikitadmitrieff/feedback-chat'
import '@nikitadmitrieff/feedback-chat/styles.css'

export function FeedbackButton() {
  const [open, setOpen] = useState(false)
  return <FeedbackPanel isOpen={open} onToggle={() => setOpen(!open)} />
}
`

const SOURCE_DIRECTIVE = '@source "../node_modules/@nikitadmitrieff/feedback-chat/dist/**/*.js";'

const GITHUB_LABELS = [
  { name: 'feedback-bot', color: '0E8A16', description: 'Created by feedback widget' },
  { name: 'auto-implement', color: '1D76DB', description: 'Agent should implement this' },
  { name: 'in-progress', color: 'FBCA04', description: 'Agent is working on this' },
  { name: 'agent-failed', color: 'D93F0B', description: 'Agent build/lint failed' },
  { name: 'preview-pending', color: 'C5DEF5', description: 'PR ready, preview deploying' },
  { name: 'rejected', color: 'E4E669', description: 'User rejected changes' },
]

function findAppDir(cwd: string): string | null {
  const candidates = [
    join(cwd, 'src', 'app'),
    join(cwd, 'app'),
  ]
  for (const dir of candidates) {
    if (existsSync(dir)) return dir
  }
  return null
}

function findGlobalsCss(cwd: string): string | null {
  const candidates = [
    join(cwd, 'src', 'app', 'globals.css'),
    join(cwd, 'app', 'globals.css'),
    join(cwd, 'styles', 'globals.css'),
    join(cwd, 'src', 'styles', 'globals.css'),
  ]
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  return null
}

function injectSourceDirective(cssPath: string): boolean {
  const content = readFileSync(cssPath, 'utf-8')
  if (content.includes(SOURCE_DIRECTIVE)) return false

  // Insert after @import "tailwindcss" line
  const lines = content.split('\n')
  let insertIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('@import') && lines[i].includes('tailwindcss')) {
      insertIndex = i + 1
      break
    }
  }

  if (insertIndex === -1) {
    // No tailwindcss import found — prepend
    writeFileSync(cssPath, SOURCE_DIRECTIVE + '\n' + content)
  } else {
    lines.splice(insertIndex, 0, SOURCE_DIRECTIVE)
    writeFileSync(cssPath, lines.join('\n'))
  }
  return true
}

function safeWriteFile(filePath: string, content: string, overwrite: boolean): boolean {
  if (existsSync(filePath) && !overwrite) {
    console.log(`  Skipped ${filePath} (already exists)`)
    return false
  }
  const dir = filePath.substring(0, filePath.lastIndexOf('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, content)
  return true
}

function appendEnvVar(envPath: string, key: string, value: string): void {
  if (existsSync(envPath)) {
    const existing = readFileSync(envPath, 'utf-8')
    if (existing.includes(`${key}=`)) return
  }
  appendFileSync(envPath, `${key}=${value}\n`)
}

function checkReactVersion(cwd: string): void {
  const reactPkgPath = join(cwd, 'node_modules', 'react', 'package.json')
  if (!existsSync(reactPkgPath)) return

  try {
    const pkg = JSON.parse(readFileSync(reactPkgPath, 'utf-8'))
    const version: string = pkg.version
    if (version === '19.1.0' || version === '19.1.1') {
      console.error(`  \u2717 react@${version} detected \u2014 @ai-sdk/react excludes this version.`)
      console.error('    Fix: npm install react@latest react-dom@latest')
      console.error()
      process.exit(1)
    }
  } catch {
    // If we can't read/parse react's package.json, skip the check
  }
}

function hasGhCli(): boolean {
  try {
    execSync('which gh', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function createGitHubLabels(cwd: string): void {
  if (!hasGhCli()) {
    console.log('  \u26a0 GitHub CLI (gh) not found. Create these labels manually:')
    console.log()
    for (const label of GITHUB_LABELS) {
      console.log(`    gh label create ${label.name} --color ${label.color} --description "${label.description}" --force`)
    }
    console.log()
    return
  }

  console.log('  Creating GitHub labels...')
  for (const label of GITHUB_LABELS) {
    try {
      execSync(
        `gh label create ${label.name} --color ${label.color} --description "${label.description}" --force`,
        { cwd, stdio: 'ignore' },
      )
      console.log(`    Created label: ${label.name}`)
    } catch {
      console.log(`    \u26a0 Could not create label: ${label.name}`)
    }
  }
}

function detectComponentsDir(cwd: string): string {
  if (existsSync(join(cwd, 'src', 'app'))) {
    return join(cwd, 'src', 'components')
  }
  return join(cwd, 'components')
}

async function main() {
  const cwd = resolve(process.cwd())

  console.log()
  console.log('  feedback-chat setup wizard')
  console.log('  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500')
  console.log()

  // ── React version check ──────────────────────
  checkReactVersion(cwd)

  // Detect Next.js app directory
  const appDir = findAppDir(cwd)
  if (!appDir) {
    console.error('  Could not find app/ or src/app/ directory.')
    console.error('  Make sure you run this from a Next.js project root.')
    process.exit(1)
  }

  console.log(`  Found Next.js app directory: ${appDir}`)
  console.log()

  // ── Tier Selection ──────────────────────────
  console.log('  \u2500\u2500 Tier Selection \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500')
  console.log()

  const tierAnswer = await prompts({
    type: 'select',
    name: 'tier',
    message: 'Choose your tier',
    choices: [
      { title: 'Chat only (AI conversations, localStorage persistence)', value: 'chat' },
      { title: '+ GitHub (Chat + auto-creates GitHub issues)', value: 'github' },
      { title: '+ Pipeline (Chat + GitHub + agent \u2192 PR \u2192 preview \u2192 approve)', value: 'pipeline' },
    ],
    initial: 0,
  })

  if (tierAnswer.tier === undefined) {
    console.log('  Cancelled.')
    process.exit(0)
  }

  const tier: Tier = tierAnswer.tier

  // ── Widget Setup ──────────────────────────
  console.log()
  console.log('  \u2500\u2500 Widget Setup \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500')
  console.log()

  const widgetAnswers = await prompts([
    {
      type: 'password',
      name: 'apiKey',
      message: 'Anthropic API key (for chat, uses Haiku)',
    },
    {
      type: 'password',
      name: 'password',
      message: 'Feedback password (gates access to the chatbot)',
    },
  ])

  if (!widgetAnswers.apiKey || !widgetAnswers.password) {
    console.log('  Cancelled.')
    process.exit(0)
  }

  // ── GitHub Credentials ──────────────────────
  let githubToken = ''
  let githubRepo = ''

  if (tier !== 'chat') {
    console.log()
    console.log('  \u2500\u2500 GitHub Integration \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500')
    console.log()

    const ghAnswers = await prompts([
      {
        type: 'password',
        name: 'token',
        message: 'GitHub token (needs repo scope, must start with ghp_)',
      },
      {
        type: 'text',
        name: 'repo',
        message: 'GitHub repo (owner/name)',
      },
    ])
    githubToken = ghAnswers.token || ''
    githubRepo = ghAnswers.repo || ''
  }

  // ── Agent URL ──────────────────────
  let agentUrl = ''

  if (tier === 'pipeline') {
    console.log()
    console.log('  \u2500\u2500 Agent Setup \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500')
    console.log()

    const agentAnswer = await prompts({
      type: 'text',
      name: 'url',
      message: 'Agent URL (e.g., https://your-agent.railway.app)',
    })
    agentUrl = agentAnswer.url || ''
  }

  // ── Overwrite check ──────────────────────
  let overwrite = false
  const chatRoutePath = join(appDir, 'api', 'feedback', 'chat', 'route.ts')
  const statusRoutePath = join(appDir, 'api', 'feedback', 'status', 'route.ts')

  if (existsSync(chatRoutePath) || existsSync(statusRoutePath)) {
    const overwriteAnswer = await prompts({
      type: 'confirm',
      name: 'overwrite',
      message: 'Route files already exist. Overwrite?',
      initial: false,
    })
    overwrite = overwriteAnswer.overwrite ?? false
  }

  // ── Create route files ──────────────────────
  console.log()

  if (safeWriteFile(chatRoutePath, CHAT_ROUTE_TEMPLATE(tier), overwrite)) {
    console.log(`  Created ${chatRoutePath}`)
  }
  if (safeWriteFile(statusRoutePath, STATUS_ROUTE_TEMPLATE(tier), overwrite)) {
    console.log(`  Created ${statusRoutePath}`)
  }

  // ── Create client wrapper component ──────────────────────
  const componentsDir = detectComponentsDir(cwd)
  const feedbackButtonPath = join(componentsDir, 'FeedbackButton.tsx')

  if (safeWriteFile(feedbackButtonPath, FEEDBACK_BUTTON_TEMPLATE, overwrite)) {
    console.log(`  Created ${feedbackButtonPath}`)
  }

  // ── Patch Tailwind v4 CSS ──────────────────────
  const globalsCss = findGlobalsCss(cwd)
  if (globalsCss) {
    if (injectSourceDirective(globalsCss)) {
      console.log(`  Patched ${globalsCss} (added @source directive for Tailwind v4)`)
    } else {
      console.log(`  ${globalsCss} already has @source directive`)
    }
  } else {
    console.log()
    console.log('  \u26a0 Could not find globals.css \u2014 add this line manually:')
    console.log(`    ${SOURCE_DIRECTIVE}`)
  }

  // ── Append to .env.local ──────────────────────
  const envPath = join(cwd, '.env.local')

  appendEnvVar(envPath, 'ANTHROPIC_API_KEY', widgetAnswers.apiKey)
  appendEnvVar(envPath, 'FEEDBACK_PASSWORD', widgetAnswers.password)

  if (tier !== 'chat') {
    if (githubToken) appendEnvVar(envPath, 'GITHUB_TOKEN', githubToken)
    if (githubRepo) appendEnvVar(envPath, 'GITHUB_REPO', githubRepo)
  }

  if (tier === 'pipeline' && agentUrl) {
    appendEnvVar(envPath, 'AGENT_URL', agentUrl)
  }

  console.log(`  Updated ${envPath}`)

  // ── Create GitHub labels ──────────────────────
  if (tier !== 'chat') {
    console.log()
    createGitHubLabels(cwd)
  }

  // ── Next Steps ──────────────────────
  console.log()
  console.log('  \u2500\u2500 Next Steps \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500')
  console.log()

  // Import path depends on layout
  const usesSrc = existsSync(join(cwd, 'src', 'app'))
  const importPath = usesSrc ? '@/components/FeedbackButton' : '@/components/FeedbackButton'

  console.log('  1. Add to your layout.tsx:')
  console.log()
  console.log(`     import { FeedbackButton } from '${importPath}'`)
  console.log()
  console.log('     // Inside <body>:')
  console.log('     <FeedbackButton />')
  console.log()

  if (tier === 'chat') {
    console.log('  2. Run npm run dev and open the app.')
    console.log('     Click the feedback bar at the bottom, enter your password, and chat.')
  } else if (tier === 'github') {
    console.log('  2. Run npm run dev and open the app.')
    console.log('     Submit feedback to see issues created on your repo.')
  } else {
    console.log('  2. Run npm run dev and open the app.')
    console.log('     Submit feedback to see issues created on your repo.')
    console.log()
    console.log('  3. Deploy the agent service:')
    console.log('     See docs/agent-deployment.md or run: npx feedback-chat deploy-agent')
  }

  console.log()
  console.log('  Done.')
  console.log()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
