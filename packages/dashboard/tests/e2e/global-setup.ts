import { ensureTestUser, cleanupTestProjects } from './helpers/seed'

export default async function globalSetup() {
  await ensureTestUser()
  await cleanupTestProjects()
}
