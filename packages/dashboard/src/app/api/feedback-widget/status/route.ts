import { createStatusHandler } from '@nikitadmitrieff/feedback-chat/server'

const handler = createStatusHandler({
  password: process.env.FEEDBACK_PASSWORD!,
  github: {
    token: process.env.GITHUB_TOKEN!,
    repo: 'NikitaDmitrieff/feedback-chat',
  },
})

export const { GET, POST } = handler
