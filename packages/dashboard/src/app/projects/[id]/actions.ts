'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function deleteProject(projectId: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', projectId)

  if (error) throw new Error('Failed to delete project')

  redirect('/projects')
}

export async function markAllStepsDone(projectId: string) {
  const supabase = await createClient()

  await supabase
    .from('projects')
    .update({
      setup_progress: {
        install: true,
        env_vars: true,
        webhook: true,
        labels: true,
      },
    })
    .eq('id', projectId)
}

export async function markStepDone(projectId: string, stepKey: string) {
  const supabase = await createClient()

  // Read current progress
  const { data: project } = await supabase
    .from('projects')
    .select('setup_progress')
    .eq('id', projectId)
    .single()

  if (!project) throw new Error('Project not found')

  const progress = (project.setup_progress as Record<string, boolean>) ?? {}
  progress[stepKey] = true

  await supabase
    .from('projects')
    .update({ setup_progress: progress })
    .eq('id', projectId)
}

export async function triggerSetup(projectId: string) {
  const supabase = await createClient()

  // Verify project exists and has GitHub App installed
  const { data: project } = await supabase
    .from('projects')
    .select('id, github_repo, github_installation_id, setup_status')
    .eq('id', projectId)
    .single()

  if (!project) return { error: 'Project not found' }
  if (!project.github_installation_id) return { error: 'GitHub App not installed' }
  if (project.setup_status === 'queued' || project.setup_status === 'cloning' || project.setup_status === 'generating' || project.setup_status === 'committing') {
    return { error: 'Setup already in progress' }
  }

  // Create setup job (github_issue_number/issue_body not applicable for setup jobs)
  const { error: jobError } = await supabase
    .from('job_queue')
    .insert({
      project_id: projectId,
      job_type: 'setup',
      github_issue_number: 0,
      issue_title: `Setup: ${project.github_repo}`,
      issue_body: '',
    })

  if (jobError) return { error: 'Failed to create setup job' }

  // Update project status
  await supabase
    .from('projects')
    .update({ setup_status: 'queued', setup_error: null })
    .eq('id', projectId)

  return { success: true }
}

export async function resetSetupStatus(projectId: string) {
  const supabase = await createClient()
  await supabase
    .from('projects')
    .update({ setup_status: 'installing', setup_error: null, setup_pr_url: null })
    .eq('id', projectId)
}
