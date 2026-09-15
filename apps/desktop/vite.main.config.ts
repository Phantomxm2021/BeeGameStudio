import { defineConfig } from 'vite'

const configuredAppUrl =
  process.env.BEEGAME_DESKTOP_APP_URL?.trim() ||
  process.env.VITE_BEEGAME_DESKTOP_APP_URL?.trim() ||
  ''

try {
  if (configuredAppUrl) {
    const url = new URL(configuredAppUrl)
    if (url.protocol !== 'https:')
      throw new Error('BEEGAME_DESKTOP_APP_URL must use HTTPS.')
  }
} catch (error) {
  throw new Error(
    error instanceof Error ? error.message : 'Invalid BEEGAME_DESKTOP_APP_URL.',
  )
}

export default defineConfig({
  define: { __BEEGAME_PACKAGED_APP_URL__: JSON.stringify(configuredAppUrl) },
  build: {
    rollupOptions: {
      input: 'src/main.ts',
      output: { entryFileNames: 'main.js', format: 'cjs' },
    },
  },
})
