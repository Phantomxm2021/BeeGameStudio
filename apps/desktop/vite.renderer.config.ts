import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: 'src/renderer.ts',
      output: { entryFileNames: 'renderer.js', format: 'cjs' },
    },
  },
})
