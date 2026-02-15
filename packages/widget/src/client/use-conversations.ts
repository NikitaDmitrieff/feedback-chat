'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useThreadRuntime } from '@assistant-ui/react'
import type { Conversation } from './types'

// External state shape returned by threadRuntime.exportExternalState()
// Messages are plain AI SDK UIMessage objects (JSON-serializable, no Symbol keys)
type ExternalState = {
  headId?: string | null
  messages: Array<{
    parentId: string | null
    message: { id: string; role: string; parts?: Array<{ type: string; text?: string }>; content?: string; [key: string]: unknown }
  }>
}

const CONV_INDEX_KEY = 'feedback_conversations'
const CONV_PREFIX = 'feedback_conv_'
const ACTIVE_CONV_KEY = 'feedback_active_conv'
const MAX_CONVERSATIONS = 10
const AUTOSAVE_DELAY = 400
const DEFAULT_TITLE = 'New chat'

function loadIndex(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONV_INDEX_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveIndex(conversations: Conversation[]) {
  localStorage.setItem(CONV_INDEX_KEY, JSON.stringify(conversations))
}

function loadState(id: string): ExternalState | null {
  try {
    const raw = localStorage.getItem(CONV_PREFIX + id)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveState(id: string, state: ExternalState) {
  localStorage.setItem(CONV_PREFIX + id, JSON.stringify(state))
}

function deleteMessages(id: string) {
  localStorage.removeItem(CONV_PREFIX + id)
}

function makeConversation(): Conversation {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    title: DEFAULT_TITLE,
    createdAt: now,
    updatedAt: now,
  }
}

export function useConversations() {
  const threadRuntime = useThreadRuntime()

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState('')

  // Refs to avoid stale closures in auto-save
  const activeIdRef = useRef(activeId)
  const conversationsRef = useRef(conversations)
  useEffect(() => {
    activeIdRef.current = activeId
    conversationsRef.current = conversations
  })

  function saveCurrent() {
    try {
      const state = threadRuntime.exportExternalState() as ExternalState
      if (state && state.messages.length > 0) {
        saveState(activeIdRef.current, state)
        updateTitleIfNeeded(activeIdRef.current, state)
      }
    } catch {
      // exportExternalState can throw if runtime isn't ready
    }
  }

  function restoreOrReset(id: string) {
    const saved = loadState(id)
    if (saved && saved.messages.length > 0) {
      try {
        threadRuntime.importExternalState(saved)
      } catch {
        threadRuntime.reset()
      }
    } else {
      threadRuntime.reset()
    }
  }

  function activate(id: string) {
    setActiveId(id)
    localStorage.setItem(ACTIVE_CONV_KEY, id)
  }

  // Initialization — runs once
  const initialized = useRef(false)
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    let index = loadIndex()
    let currentId = localStorage.getItem(ACTIVE_CONV_KEY)

    if (index.length === 0) {
      const first = makeConversation()
      index = [first]
      currentId = first.id
      saveIndex(index)
      localStorage.setItem(ACTIVE_CONV_KEY, currentId)
    } else if (!currentId || !index.some((c) => c.id === currentId)) {
      currentId = index[0].id
      localStorage.setItem(ACTIVE_CONV_KEY, currentId)
    }

    setConversations(index)
    setActiveId(currentId)

    const saved = loadState(currentId)
    if (saved && saved.messages.length > 0) {
      try {
        threadRuntime.importExternalState(saved)
      } catch {
        // import can fail if runtime isn't ready
      }
    }
  }, [threadRuntime])

  const switchTo = useCallback(
    (id: string) => {
      if (id === activeIdRef.current) return
      saveCurrent()
      restoreOrReset(id)
      activate(id)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- helpers use refs, only threadRuntime matters
    [threadRuntime],
  )

  const create = useCallback(() => {
    saveCurrent()

    const newConv = makeConversation()
    let updated = [newConv, ...conversationsRef.current]

    // Enforce max conversations — delete oldest beyond limit
    if (updated.length > MAX_CONVERSATIONS) {
      const removed = updated.slice(MAX_CONVERSATIONS)
      for (const c of removed) deleteMessages(c.id)
      updated = updated.slice(0, MAX_CONVERSATIONS)
    }

    setConversations(updated)
    saveIndex(updated)

    threadRuntime.reset()
    activate(newConv.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- helpers use refs, only threadRuntime matters
  }, [threadRuntime])

  const remove = useCallback(
    (id: string) => {
      const current = conversationsRef.current
      const filtered = current.filter((c) => c.id !== id)
      deleteMessages(id)

      if (filtered.length === 0) {
        const fresh = makeConversation()
        setConversations([fresh])
        saveIndex([fresh])
        threadRuntime.reset()
        activate(fresh.id)
        return
      }

      if (id === activeIdRef.current) {
        const oldIndex = current.findIndex((c) => c.id === id)
        const nextIndex = Math.min(oldIndex, filtered.length - 1)
        const nextId = filtered[nextIndex].id
        restoreOrReset(nextId)
        activate(nextId)
      }

      setConversations(filtered)
      saveIndex(filtered)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- helpers use refs, only threadRuntime matters
    [threadRuntime],
  )

  const save = useCallback(() => {
    const id = activeIdRef.current
    if (!id) return
    try {
      const state = threadRuntime.exportExternalState() as ExternalState
      if (state && state.messages.length > 0) {
        saveState(id, state)
        updateTitleIfNeeded(id, state)
      }
    } catch {
      // exportExternalState can throw if runtime isn't ready
    }
    setConversations(loadIndex())
  }, [threadRuntime])

  // Auto-save: debounced write to localStorage on thread state changes
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const unsubscribe = threadRuntime.subscribe(() => {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(save, AUTOSAVE_DELAY)
    })

    return () => {
      unsubscribe()
      if (timeoutId) clearTimeout(timeoutId)
      // Flush an immediate save so closing the panel never loses data
      save()
    }
  }, [threadRuntime, save])

  const sorted = useMemo(
    () => [...conversations].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    ),
    [conversations],
  )

  return { conversations: sorted, activeId, switchTo, create, remove, save }
}

function updateTitleIfNeeded(id: string, state: ExternalState) {
  const index = loadIndex()
  const conv = index.find((c) => c.id === id)
  if (!conv) return

  // Auto-title from first user message (AI SDK UIMessage format)
  if (conv.title === DEFAULT_TITLE && state.messages.length > 0) {
    const firstUserMsg = state.messages.find((m) => m.message?.role === 'user')
    if (firstUserMsg?.message) {
      const msg = firstUserMsg.message
      // AI SDK v6 UIMessage: check parts first, then content string
      const textPart = msg.parts?.find(
        (p): p is { type: 'text'; text: string } => p.type === 'text' && !!p.text,
      )
      const text = textPart?.text ?? (typeof msg.content === 'string' ? msg.content : '')
      if (text) {
        conv.title = text.slice(0, 40)
      }
    }
  }

  conv.updatedAt = new Date().toISOString()
  saveIndex(index)
}
