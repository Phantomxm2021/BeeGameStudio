import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModelConfig, resetModelConfigs } from '@bee-game-studio/agent-workflow'
import { createAgentWorkflowApp } from '../app'
import { createLocalWorkflowStore } from '../beegame/workflow-v3/store'
import { createRun } from '../beegame/workflow-v3/state'

test.each([false, true])('description drafts use owned project documents and one mock generation without publishing; V3=%s', async v3 => {
  const root = await mkdtemp(join(tmpdir(), 'description-route-'))
  const workspace = join(root, 'project')
  const store = createLocalWorkflowStore(join(root, 'workflow'))
  if (v3) {
    const run = createRun({ projectId: 'copy-project', ownerId: 'owner', workspacePath: workspace, chatSessionId: 'chat',
      requestKey: 'fixture', text: 'Fixture', constraints: {}, ids: ['goal'] })
    await store.commit(run.projectId, run.ownerId, 0, run, 'fixture')
  }
  const cleanups: Array<() => void | Promise<void>> = []
  let role: 'owner' | 'viewer' = 'owner', calls = 0, publications = 0, fail = false
  resetModelConfigs()
  createModelConfig('owner', { name: 'Fixture', provider: 'openai-compatible', apiKey: 'fixture-only', model: 'fixture-model', isDefault: true })
  const app = createAgentWorkflowApp({
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: root, workflowV3Store: v3 ? store : false,
    modelConfigStore: false, skillsConfig: false,
    currentUserResolver: async () => ({ id: 'owner', role }),
    sessionRunner: { async start() { throw Error('No project task allowed') } },
    deploymentPublisher: { async publishStaticDirectory() { publications++; throw Error('No publication allowed'); } },
    modelRuntimeHost: {
      async generate() { throw Error('Usage accounting is required') },
      async generateWithUsage(input) {
        calls++
        expect(input.messages[0].content).toContain('Arrow keys to move')
        expect(input.messages[0].content).not.toContain('Private implementation')
        expect(input.querySource).toBe('beegame_publication_description')
        if (fail) throw Error('Synthetic generation failure')
        return { content: 'How to play\nUse arrow keys to reach the lighthouse.',
          usage: { input_tokens: 100, output_tokens: 20, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 120 } }
      },
    },
    registerCleanup: fn => cleanups.push(fn),
  })
  const post = (path: string, body: unknown = {}) => app.request(path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  try {
    await mkdir(join(workspace, 'docs'), { recursive: true })
    await writeFile(join(workspace, 'docs/GDD.md'), 'Reach the lighthouse. Arrow keys to move.')
    await writeFile(join(workspace, 'docs/TECHNICAL_DESIGN.md'), 'Private implementation')
    expect((await post('/api/projects', { id: 'copy-project', name: 'Fixture', root_path: workspace, created_at: Date.now() })).status).toBe(200)
    role = 'viewer'
    expect((await post('/api/projects/copy-project/publication-description')).status).toBe(403)
    role = 'owner'
    expect((await post('/api/projects/missing/publication-description')).status).toBe(404)
    expect(calls).toBe(0)
    const draft = await post('/api/projects/copy-project/publication-description', { language: 'en' })
    expect(draft.status).toBe(200)
    expect(await draft.json()).toEqual({ description: 'How to play\nUse arrow keys to reach the lighthouse.' })
    expect(calls).toBe(1)
    expect(draft.headers.get('cache-control')).toBe('private, no-store')
    fail = true
    expect((await post('/api/projects/copy-project/publication-description')).status).toBe(400)
    expect(calls).toBe(2) // No automatic repair or retry.
    expect(publications).toBe(0)
  } finally {
    for (const cleanup of cleanups) await cleanup()
    resetModelConfigs()
    await rm(root, { recursive: true, force: true })
  }
})
