'use client'

import { Plus, X } from 'lucide-react'
import type { Conversation } from './types'

type ConversationTabsProps = {
  conversations: Conversation[]
  activeId: string
  onSwitch: (id: string) => void
  onCreate: () => void
  onRemove: (id: string) => void
  onClose: () => void
}

export function ConversationTabs({
  conversations,
  activeId,
  onSwitch,
  onCreate,
  onRemove,
  onClose,
}: ConversationTabsProps) {
  const canDelete = conversations.length > 1

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <div className="flex items-center gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden min-w-0 flex-1">
        {conversations.map((conv) => {
          const isActive = conv.id === activeId

          return (
            <button
              key={conv.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => onSwitch(conv.id)}
              className={`feedback-tab group relative flex items-center gap-1 px-2.5 h-8 text-[12px] whitespace-nowrap rounded-lg transition-all ${
                isActive
                  ? 'feedback-tab-active'
                  : 'feedback-tab-inactive'
              }`}
            >
              <span className="max-w-[100px] truncate">{conv.title}</span>
              {canDelete && (
                <span
                  role="button"
                  aria-label={`Delete ${conv.title}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(conv.id)
                  }}
                  className="ml-0.5 hidden h-4 w-4 shrink-0 items-center justify-center rounded-md group-hover:inline-flex hover:bg-white/10"
                >
                  <X className="h-2.5 w-2.5" />
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex items-center shrink-0 gap-1">
        <button
          onClick={onCreate}
          className="feedback-tab-button flex h-7 w-7 items-center justify-center rounded-lg transition-all"
          aria-label="New chat"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onClose}
          className="feedback-tab-button flex h-7 w-7 items-center justify-center rounded-lg transition-all"
          aria-label="Close feedback"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
