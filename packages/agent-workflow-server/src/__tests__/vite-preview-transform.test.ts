import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { startVitePreviewHost } from '../beegame/vite-preview-host'
import { proxyBeeGamePreviewRequest } from '../app'

test('managed Vite + proxy serve compiled TypeScript/TSX and CSS below a preview base', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'bgs-vite-transform-'))
  // Reuse installed dependencies, without installing or touching any user game.
  const modules = process.env.BGS_TEST_VITE_MODULES || resolve(import.meta.dir, '../../../../node_modules')
  const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') })
  const port = reservation.port!
  reservation.stop(true)
  let server: Awaited<ReturnType<typeof startVitePreviewHost>> | undefined
  try {
    await symlink(modules, join(workspace, 'node_modules'))
    await mkdir(join(workspace, 'src'))
    await mkdir(join(workspace, 'content'))
    await writeFile(join(workspace, 'content/index.json'), '{"schemaVersion":"1","scenes":[]}')
    await writeFile(join(workspace, 'package.json'), JSON.stringify({ type: 'module' }))
    const config = '{ cacheDir: "./.cache", optimizeDeps: { noDiscovery: true, include: [] } }'
    if (process.env.BGS_TEST_VITE_MODULES) {
      await writeFile(join(workspace, 'vite.config.ts'), `import { defineConfig } from 'vite'; import react from '@vitejs/plugin-react'; export default defineConfig({ ...${config}, plugins: [react()] });`)
    } else await writeFile(join(workspace, 'vite.config.mjs'), `export default ${config}`)
    await writeFile(join(workspace, 'index.html'), '<html><head></head><body><script type="module" src="/src/main.tsx"></script></body></html>')
    await writeFile(join(workspace, 'src/main.tsx'), 'import "./style.css"; export const content = import.meta.glob("/content/**/*.json", { query: "?raw", import: "default", eager: true }); const count: number = 1; export const view = <div>{count}</div>;')
    await writeFile(join(workspace, 'src/style.css'), 'body { color: red; }')
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
    const css = await read('src/style.css')
    expect(css).toContain('color: red')
    const rawJsonModule = await read('content/index.json?import&raw')
    expect(rawJsonModule).toContain('export default')
    expect(rawJsonModule).toContain('schemaVersion')
  } finally { await server?.close(); await rm(workspace, { recursive: true, force: true }) }
}, 30000)
