import { defineConfig } from 'vite'
export default defineConfig({
  resolve:{dedupe:['react','react-dom','three']},
  esbuild:{jsx:'automatic'},
  server:{host:'127.0.0.1',port:62291,strictPort:true},
})
