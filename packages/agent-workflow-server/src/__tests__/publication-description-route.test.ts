import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentWorkflowApp } from '../app'
import { createLocalWorkflowStore } from '../beegame/workflow-v3/store'
import { createRun, digest } from '../beegame/workflow-v3/state'
import { appendChatTranscript, projectChatPath } from '../beegame/project-records'
import { PUBLIC_DESCRIPTION_BRIEF_MISSING } from '../beegame/publication-description'

test.each([false, true])('fills from the owned confirmed brief with saved GDD controls and without a model or publication; V3=%s', async v3 => {
  const root = await mkdtemp(join(tmpdir(), 'description-brief-route-'))
  const workspace = join(root, 'project')
  const store = createLocalWorkflowStore(join(root, 'workflow'))
  const brief = { kind: 'confirmed_build_brief', selected_option: { title: 'Harbor Run', pitch: 'Reach the lighthouse', gameplay: 'Collect the beacon and reach the lighthouse' },
    settings: { inputs: ['Gamepad'], notes: 'PRIVATE_NOTES' }, idea: 'PRIVATE_REQUEST', user_messages: [{ text: 'PRIVATE_CHAT' }] }
  let role: 'owner' | 'viewer' = 'owner', calls = 0, publications = 0, tasks = 0
  const cleanups: Array<() => void | Promise<void>> = []
  const app = createAgentWorkflowApp({
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: root, workflowV3Store: v3 ? store : false,
    modelConfigStore: false, skillsConfig: false, currentUserResolver: async () => ({ id: 'owner', role }),
    sessionRunner: { async start() { tasks++; throw Error('No project task allowed') } },
    deploymentPublisher: { async publishStaticDirectory() { publications++; throw Error('No publication allowed') } },
    modelRuntimeHost: { async generate() { calls++; throw Error('No model allowed') },
      async generateWithUsage() { calls++; throw Error('No model allowed') } },
    registerCleanup: fn => cleanups.push(fn),
  })
  const post = (path: string, body: unknown = {}) => app.request(path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  let transcriptEventId = 0
  const saveBrief = async (text: string) => {
    if (v3) {
      const current = await store.read('copy-project', 'owner')
      const run = current ?? createRun({ projectId: 'copy-project', ownerId: 'owner', workspacePath: workspace, chatSessionId: 'chat',
        requestKey: 'fixture', text, constraints: {}, ids: ['goal'] })
      const expectedVersion = current?.version ?? 0
      if (current) {
        const before = structuredClone(run.requirements)
        run.version++
        run.planRevision++
        run.requirements = { ...before, text, revision: crypto.randomUUID(),
          sha256: digest(JSON.stringify({ text, constraints: before.constraints, ids: before.ids })) }
        run.requirementChanges = [...(run.requirementChanges ?? []), { requestKey: crypto.randomUUID(),
          actorId: 'owner', at: new Date().toISOString(), before, after: run.requirements }]
      }
      await store.commit(run.projectId, run.ownerId, expectedVersion, run, 'fixture')
    } else {
      appendChatTranscript(projectChatPath(workspace), { id: ++transcriptEventId, sessionId: 'chat', type: 'user.message',
        text: 'Private request body', createdAt: new Date(), payload: { displayKind: 'confirmed_brief', confirmedBriefContext: text } })
    }
  }
  try {
    await mkdir(join(workspace, 'docs'), { recursive: true })
    const gdd = '# Design\n' + 'PRIVATE_DESIGN\n'.repeat(12000) + '\n## Controls\n- `Enter`: confirm\n- `Escape`: pause\n\n## Implementation\nPRIVATE_INTERNAL'
    await writeFile(join(workspace, 'docs/GDD.md'), gdd)
    await saveBrief(JSON.stringify(brief))
    expect((await post('/api/projects', { id: 'copy-project', name: 'Fixture', root_path: workspace, created_at: Date.now() })).status).toBe(200)
    role = 'viewer'
    expect((await post('/api/projects/copy-project/publication-description')).status).toBe(403)
    role = 'owner'
    expect((await post('/api/projects/missing/publication-description')).status).toBe(404)
    const before = v3 ? JSON.stringify(await store.read('copy-project', 'owner')) : await readFile(projectChatPath(workspace), 'utf8')
    const draft = await post('/api/projects/copy-project/publication-description', { language: 'en' })
    expect(draft.status).toBe(200)
    expect(await draft.json()).toEqual({ description: '# Harbor Run\n\n## Controls\n- `Enter`: confirm\n- `Escape`: pause\n\n## Introduction\nReach the lighthouse\n\n## How to play\nCollect the beacon and reach the lighthouse' })
    expect(draft.headers.get('cache-control')).toBe('private, no-store')
    expect(v3 ? JSON.stringify(await store.read('copy-project', 'owner')) : await readFile(projectChatPath(workspace), 'utf8')).toBe(before)
    expect(await readFile(join(workspace, 'docs/GDD.md'), 'utf8')).toBe(gdd)
    await rm(join(workspace, 'docs/GDD.md'))
    expect((await post('/api/projects/copy-project/publication-description')).status).toBe(200)
    await saveBrief(JSON.stringify({ ...brief, selected_option: { gameplay: 'Updated confirmed gameplay' } }))
    expect(await (await post('/api/projects/copy-project/publication-description', { language: 'en' })).json())
      .toEqual({ description: '## Controls\n- Gamepad\n\nDetailed controls are not documented. Add them before publishing.\n\n## How to play\nUpdated confirmed gameplay' })
    await saveBrief('{}')
    const missing = await post('/api/projects/copy-project/publication-description')
    expect(missing.status).toBe(400)
    expect(await missing.json()).toEqual({ error: PUBLIC_DESCRIPTION_BRIEF_MISSING })
    expect(calls).toBe(0)
    expect(tasks).toBe(0)
    expect(publications).toBe(0)
  } finally {
    for (const cleanup of cleanups) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})
