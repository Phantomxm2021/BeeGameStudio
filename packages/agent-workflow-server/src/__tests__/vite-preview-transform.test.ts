import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, readdir, writeFile, symlink, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { startVitePreviewHost } from '../beegame/vite-preview-host'
import { proxyBeeGamePreviewRequest } from '../app'

test.each([false,true])('managed Vite + proxy serve compiled modules and optimized dependencies with private cache: %j', async managed => {
  const temporary = await mkdtemp(join(tmpdir(), 'bgs-vite-transform-'))
  const workspace = join(temporary,'project'), privateCache = join(temporary,'runtime/cache/vite')
  const originalCache = process.env.BGS_VITE_CACHE_DIR
  // Reuse installed packages; the dependency/cache directory itself stays local.
  const modules = process.env.BGS_TEST_VITE_MODULES || resolve(import.meta.dir, '../../../../node_modules')
  const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') })
  const port = reservation.port!
  reservation.stop(true)
  let server: Awaited<ReturnType<typeof startVitePreviewHost>> | undefined
  try {
    await mkdir(join(workspace,'node_modules'),{recursive:true})
    for(const name of ['vite','react',...(process.env.BGS_TEST_VITE_MODULES?['@vitejs']:[])])
      await symlink(join(modules,name),join(workspace,'node_modules',name),'dir')
    const oldCache=join(workspace,'node_modules/.vite')
    await mkdir(oldCache)
    await writeFile(join(oldCache,'legacy-marker'),'Retained installed-tree bytes')
    await mkdir(join(workspace, 'src'))
    await mkdir(join(workspace, 'content'))
    await writeFile(join(workspace, 'content/index.json'), '{"schemaVersion":"1","scenes":[]}')
    await writeFile(join(workspace, 'package.json'), JSON.stringify({ type: 'module' }))
    const config = `{ ${managed?'':'cacheDir: "./.cache",'} optimizeDeps: { noDiscovery: true, include: ['react'] } }`
    if (process.env.BGS_TEST_VITE_MODULES) {
      await writeFile(join(workspace, 'vite.config.ts'), `import { defineConfig } from 'vite'; import react from '@vitejs/plugin-react'; export default defineConfig({ ...${config}, plugins: [react()] });`)
    } else await writeFile(join(workspace, 'vite.config.mjs'), `export default ${config}`)
    await writeFile(join(workspace, 'index.html'), '<html><head></head><body><script type="module" src="/src/main.tsx"></script></body></html>')
    await writeFile(join(workspace, 'src/main.tsx'), 'import React from "react"; import "./style.css"; export const element=React.createElement("div"); export const content = import.meta.glob("/content/**/*.json", { query: "?raw", import: "default", eager: true }); const count: number = 1; export const view = <div>{count}</div>;')
    await writeFile(join(workspace, 'src/style.css'), 'body { color: red; }')
    if(managed)process.env.BGS_VITE_CACHE_DIR=privateCache
    else delete process.env.BGS_VITE_CACHE_DIR
    server = await startVitePreviewHost(workspace, { host: '127.0.0.1', port, base: '/previews/test/' })
    const base = `http://127.0.0.1:${port}`
    const read = async (path: string) => {
      const response = await proxyBeeGamePreviewRequest(new Request(`http://studio/previews/test/${path}`), 'test', base, true)
      expect(response.status).toBe(200)
      return response.text()
    }
    const html = await read('')
    expect(html).toContain('/previews/test/src/main.tsx')
    expect(html).not.toContain('src="/previews/test/@vite/client"')
    const script = await read('src/main.tsx')
    expect(script).not.toContain('count: number')
    expect(script).not.toContain('<div>')
    expect(script).toContain('/previews/test/src/style.css')
    const optimized=script.match(/["']([^"']*\/deps\/react\.js(?:\?[^"']*)?)["']/)
    expect(optimized,script).not.toBeNull()
    const response=await proxyBeeGamePreviewRequest(new Request(new URL(optimized![1]!, 'http://studio')), 'test', base, true)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('createElement')
    const privateFile=join(temporary,'runtime/private.txt')
    await mkdir(join(temporary,'runtime'),{recursive:true})
    await writeFile(privateFile,'Fixture private runtime data')
    const denied=await proxyBeeGamePreviewRequest(new Request(`http://studio/previews/test/@fs${privateFile}`), 'test', base, true)
    expect(denied.status).toBe(403)
    expect(await denied.text()).not.toContain('Fixture private runtime data')
    const cache=managed?privateCache:join(workspace,'.cache')
    const metadata=join(cache,'deps/_metadata.json')
    for(let i=0;i<200&&!await Bun.file(metadata).exists();i++)await Bun.sleep(25)
    expect(JSON.parse(await readFile(metadata,'utf8')).optimized.react).toBeDefined()
    expect(await readdir(oldCache)).toEqual(['legacy-marker'])
    expect(await readFile(join(oldCache,'legacy-marker'),'utf8')).toBe('Retained installed-tree bytes')
    const css = await read('src/style.css')
    expect(css).toContain('color: red;')
    const rawJsonModule = await read('content/index.json?import&raw')
    expect(rawJsonModule).toContain('export default')
    expect(rawJsonModule).toContain('schemaVersion')
  } finally {
    await server?.close()
    if(originalCache===undefined)delete process.env.BGS_VITE_CACHE_DIR
    else process.env.BGS_VITE_CACHE_DIR=originalCache
    await rm(temporary, { recursive: true, force: true })
  }
}, 30000)
