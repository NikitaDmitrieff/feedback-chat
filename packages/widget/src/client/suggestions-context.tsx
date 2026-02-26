'use client'

import { createContext, useContext } from 'react'
import type { SuggestionItem } from './types'

export const DEFAULT_SUGGESTIONS: SuggestionItem[] = [
  {
    title: 'Change the look & feel',
    description: 'Colors, layout, or visual style',
    prompt: '',
  },
  {
    title: 'Report a problem',
    description: 'Something broken or frustrating',
    prompt: '',
  },
  {
    title: 'Suggest a feature',
    description: 'An idea to make things better',
    prompt: '',
  },
]

const SuggestionsContext = createContext<SuggestionItem[]>(DEFAULT_SUGGESTIONS)

export const SuggestionsProvider = SuggestionsContext.Provider
export const useSuggestions = () => useContext(SuggestionsContext)
