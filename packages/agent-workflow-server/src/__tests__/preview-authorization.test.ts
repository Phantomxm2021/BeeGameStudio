import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentWorkflowApp } from '../app'
import { BeeGameAuthUnavailableError } from '../auth/user-context'

test('an issued preview remains readable when the identity upstream is unavailable; new access still requires auth', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-preview-auth-')))
  const projects = join(root, 'projects'), workspace = join(projects, 'users', 'owner', 'fixture')
  await mkdir(workspace, { recursive: true })
  await writeFile(join(workspace, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }))
  let unavailable = false, identityCalls = 0
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { return new Response('fixture') } })
  const cleanups: Array<() => void | Promise<void>> = []
  const app = createAgentWorkflowApp({
    currentUserResolver: async request => {
      identityCalls++
      if (unavailable) throw new BeeGameAuthUnavailableError()
      return request.headers.get('authorization') === 'Bearer fixture' ? { id: 'owner', role: 'owner' } : undefined
    },
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: projects,
    modelConfigStore: false, skillsConfig: false, registerCleanup: cleanup => cleanups.push(cleanup),
    sessionRunner: { async start() { throw new Error('No Agent may start') } },
    previewRunner: () => ({ kill() {} }), previewPortAllocator: async () => upstream.port!,
    previewReadinessProbe: async () => true,
  })
  const post = (path: string, body: unknown = {}) => app.request(path, { method: 'POST',
    headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    expect((await post('/api/projects', { id: 'fixture', name: 'Fixture', root_path: workspace, created_at: Date.now() })).status).toBe(200)
    await post('/api/model-configs', { name: 'Fake', provider: 'openai-compatible', apiKey: 'fake', models: { balanced: 'fake' }, isDefault: true })
    expect((await post('/api/projects/fixture/session/ensure')).status).toBe(200)
    const response = await post('/api/projects/fixture/preview')
    expect(response.status).toBe(200)
    const preview = await response.json()
    const calls = identityCalls
    unavailable = true
    const html = await app.request(preview.url)
    expect(html.status).toBe(200)
    expect(await html.text()).toBe('fixture')
    const path = new URL(preview.url, 'http://studio').pathname
    const module = await app.request(path + 'src/main.ts', { headers: { origin: 'null', 'sec-fetch-dest': 'script', 'sec-fetch-mode': 'cors' } })
    expect(module.status).toBe(200)
    await module.text()
    expect(identityCalls).toBe(calls)
    expect((await app.request(path)).status).toBe(503)
    expect(identityCalls).toBe(calls + 1)
  } finally {
    for (const cleanup of cleanups) await cleanup()
    upstream.stop(true)
    await rm(root, { recursive: true, force: true })
  }
})
