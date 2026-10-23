import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: 'src/preload.ts',
      output: { entryFileNames: 'preload.js', format: 'cjs' },
    },
  },
})
