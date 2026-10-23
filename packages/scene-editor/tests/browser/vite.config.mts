import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  resolve:{dedupe:['react','react-dom','three'],alias:{'@beegame/scene-editor':fileURLToPath(new URL('../../src/index.ts',import.meta.url))}},
  esbuild:{jsx:'automatic'},
  server:{host:'127.0.0.1',port:62291,strictPort:true},
})
