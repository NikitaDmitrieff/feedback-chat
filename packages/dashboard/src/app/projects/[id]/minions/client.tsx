'use client'

import { useState } from 'react'
import { Lightbulb, Workflow } from 'lucide-react'
import { ProposalsTab } from './proposals-tab'
import { PipelineTab } from './pipeline-tab'
import type { Proposal, UserIdea } from '@/lib/types'

type Run = {
  id: string
  github_issue_number: number
  github_pr_number: number | null
  stage: string
  triggered_by: string | null
  started_at: string
  completed_at: string | null
  result: string | null
}

type Job = {
  id: string
  project_id: string
  job_type: string
  status: string
  github_issue_number: number
}

type Props = {
  projectId: string
  githubRepo: string | null
  proposals: Proposal[]
  ideas: UserIdea[]
  runs: Run[]
  activeJobs: Job[]
}

const TABS = [
  { key: 'proposals', label: 'Proposals', icon: Lightbulb },
  { key: 'pipeline', label: 'Pipeline', icon: Workflow },
] as const

type TabKey = (typeof TABS)[number]['key']

export function MinionsPageClient({ projectId, githubRepo, proposals, ideas, runs, activeJobs }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('proposals')

  return (
    <>
      {/* Tab switcher */}
      <div className="mb-8 flex justify-center">
        <div className="inline-flex items-center gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-1 backdrop-blur-xl">
          {TABS.map(tab => {
            const Icon = tab.icon
            const isActive = activeTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-white/[0.08] text-fg'
                    : 'text-muted hover:text-fg'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'proposals' ? (
        <ProposalsTab projectId={projectId} githubRepo={githubRepo} proposals={proposals} ideas={ideas} />
      ) : (
        <PipelineTab projectId={projectId} githubRepo={githubRepo} proposals={proposals} runs={runs} activeJobs={activeJobs} />
      )}
    </>
  )
}
