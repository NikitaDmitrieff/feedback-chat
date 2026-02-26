'use client'

import { createContext, useContext } from 'react'
import type { SuggestionItem } from './types'

export const DEFAULT_SUGGESTIONS: SuggestionItem[] = [
  {
    title: 'Report a friction point',
    description: 'Something in the app is harder than it should be',
    prompt:
      'I keep losing my work when I accidentally navigate away from the page. There\'s no warning or auto-save feature.',
  },
  {
    title: 'Suggest an improvement',
    description: 'An idea to make the experience better',
    prompt:
      'It would be really helpful to have a way to export my data. I need to share reports with my team.',
  },
]

const SuggestionsContext = createContext<SuggestionItem[]>(DEFAULT_SUGGESTIONS)

export const SuggestionsProvider = SuggestionsContext.Provider
export const useSuggestions = () => useContext(SuggestionsContext)
