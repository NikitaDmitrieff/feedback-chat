import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: { 'client/index': 'src/client/index.ts' },
    format: ['esm'],
    dts: true,
    external: [
      'react', 'react-dom', 'next',
      '@assistant-ui/react', '@assistant-ui/react-ai-sdk',
      '@assistant-ui/react-markdown', 'ai', '@ai-sdk/anthropic',
    ],
    banner: { js: '"use client";' },
  },
  {
    entry: { 'server/index': 'src/server/index.ts' },
    format: ['esm'],
    dts: true,
    external: ['next', 'ai', '@ai-sdk/anthropic', 'zod'],
  },
  // CLI build entry — uncomment when src/cli/init.ts is implemented
  // {
  //   entry: { 'cli/init': 'src/cli/init.ts' },
  //   format: ['esm'],
  //   banner: { js: '#!/usr/bin/env node' },
  // },
])
