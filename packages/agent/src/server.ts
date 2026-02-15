import Fastify from 'fastify'
import { verifySignature, shouldProcessEvent } from './webhook.js'
import { runJob } from './worker.js'
import { commentOnIssue } from './github.js'
import { initCredentials } from './oauth.js'

// Write Claude OAuth credentials from env var at startup
if (!initCredentials()) {
  console.warn('CLAUDE_CREDENTIALS_JSON not set — Claude CLI will use ANTHROPIC_API_KEY')
}

const MAX_QUEUE = 5

const server = Fastify({ logger: true })

let currentJob: number | null = null
const queue: Array<{ issueNumber: number; issueTitle: string; issueBody: string }> = []

async function processQueue() {
  if (currentJob !== null || queue.length === 0) return

  const job = queue.shift()!
  currentJob = job.issueNumber

  try {
    await runJob(job)
  } catch (err) {
    console.error(`[job-${job.issueNumber}] Unhandled error:`, err)
  } finally {
    currentJob = null
    processQueue()
  }
}

server.post('/webhook/github', async (request, reply) => {
  const secret = process.env.WEBHOOK_SECRET
  if (!secret) {
    server.log.error('WEBHOOK_SECRET not configured')
    return reply.code(500).send({ error: 'Server misconfigured' })
  }

  const signature = request.headers['x-hub-signature-256'] as string
  const rawBody = JSON.stringify(request.body)
  if (!verifySignature(rawBody, signature, secret)) {
    return reply.code(403).send({ error: 'Invalid signature' })
  }

  const event = request.headers['x-github-event'] as string
  const payload = request.body as Record<string, unknown>
  if (!shouldProcessEvent(event, payload)) {
    return reply.code(200).send({ status: 'ignored' })
  }

  const issue = (payload as { issue: { number: number; title: string; body: string } }).issue

  if (queue.length >= MAX_QUEUE) {
    await commentOnIssue(issue.number, 'Agent queue is full. Please try again later.')
    return reply.code(200).send({ status: 'queue_full' })
  }

  queue.push({
    issueNumber: issue.number,
    issueTitle: issue.title,
    issueBody: issue.body,
  })

  processQueue()

  return reply.code(200).send({ status: 'queued', position: queue.length })
})

server.get('/health', async () => {
  return {
    status: 'ok',
    currentJob,
    queueLength: queue.length,
  }
})

const port = Number(process.env.PORT) || 3000
server.listen({ port, host: '0.0.0.0' }, (err) => {
  if (err) {
    server.log.error(err)
    process.exit(1)
  }
  server.log.info(`Agent server listening on port ${port}`)
})
