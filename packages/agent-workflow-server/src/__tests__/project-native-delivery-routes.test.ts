import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentWorkflowApp } from '../app'
import type { BeeGameSessionRunner, BeeGameSessionRunnerStartInput } from '../beegame/session-manager'
import { readProjectDelivery, PROJECT_DELIVERY_REPORT_PATH } from '../beegame/project-delivery'
import { BEEGAME_SCENE_MODEL } from '../beegame/game-content-package'
import { createRunStore } from '../beegame/delivery-workflow/run-store'
import { createTestDeliveryRun } from './delivery-workflow-test-helpers'

test('new project is owned by one native Agent and publishing uses current verified output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-native-delivery-route-'))
  const cleanups: Array<() => void | Promise<void>> = []
  const starts: BeeGameSessionRunnerStartInput[] = []
  const prompts: unknown[] = []
  const runner: BeeGameSessionRunner = { async start(input) {
    starts.push(input)
    return { stop() {}, async submit(turn) {
      prompts.push(turn.prompt)
      await mkdir(join(input.cwd, '.beegame/delivery'), { recursive: true })
      await mkdir(join(input.cwd, 'dist'), { recursive: true })
      await writeFile(join(input.cwd, 'game.ts'), 'export const game = 1')
      await writeFile(join(input.cwd, 'dist/game.js'), 'built game')
      await writeFile(join(input.cwd, '.beegame/delivery/browser.txt'), 'observed game')
      await writeFile(join(input.cwd, PROJECT_DELIVERY_REPORT_PATH), JSON.stringify({
        scope: 'delivery', status: 'passed', summary: 'Played and verified the build',
        environment: 'Browser preview', evidencePaths: ['.beegame/delivery/browser.txt'],
        artifactPaths: ['dist/game.js'],
        verification: { target: 'deployment', knownIssues: [], unverified: [] },
      }))
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Game delivered' })
    } }
  } }
  const app = createAgentWorkflowApp({
    currentUser: { id: 'native-owner', role: 'owner' },
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: join(root, 'projects'),
    modelConfigStore: false, skillsConfig: false, sessionRunner: runner,
    registerCleanup: cleanup => cleanups.push(cleanup),
  })
  try {
    const model = await app.request('/api/model-configs', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Offline', provider: 'openai-compatible', apiKey: 'fake',
        models: { balanced: 'fake' }, isDefault: true }) })
    expect(model.status).toBe(200)
    const projectId = 'native-project'
    const response = await app.request('/api/projects/bootstrap', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: { id: projectId, name: 'Native game', created_at: Date.now() },
        brief: { idea: 'Make a small game', creationMode: 'blueprint', resourceLibraryUsage: 'optional',
          document_language: 'en', game_user_visible_language: 'en', agent_response_language: 'en' } }) })
    expect(response.status).toBe(202)
    const { project, session } = await response.json() as { project: { root_path: string }; session: { id: string } }
    for (let i = 0; i < 100; i++) {
      const gate = await app.request(`/api/projects/${projectId}/deployment-readiness`)
      if ((await gate.json() as { allowed: boolean }).allowed) break
      await Bun.sleep(5)
    }
    expect(starts).toHaveLength(1)
    expect(starts[0]?.workflowWorker).toBeUndefined()
    expect(prompts).toHaveLength(1)
    expect((await readProjectDelivery(project.root_path, join(root, 'dashboard')))?.objective).toContain('Make a small game')
    expect(await Bun.file(join(project.root_path, '.beegame/workflow/run.json')).exists()).toBe(false)
    const readiness = await app.request(`/api/projects/${projectId}/deployment-readiness`)
    expect(await readiness.json()).toMatchObject({ allowed: true })
    const transcript = await app.request(`/api/beegame-sessions/${session.id}/events`)
    expect(transcript.status).toBe(200)
    await mkdir(join(project.root_path, 'content/scenes'), { recursive: true })
    await writeFile(join(project.root_path, 'content/index.json'), JSON.stringify({
      schema: 'beegame-content-package.v2', id: 'game', dimension: '2d',
      documentRevision: 'a'.repeat(64), assetManifestRevision: 'b'.repeat(64),
      entryScene: 'scene', sceneModel: BEEGAME_SCENE_MODEL, files: ['scenes/main.json'],
    }))
    await writeFile(join(project.root_path, 'content/scenes/main.json'), JSON.stringify({
      schema: 'beegame-content.v1', id: 'scene', kind: 'scene-2d', assetRefs: [],
      data: { settings: { coordinateSystem: { origin: 'top-left', units: 'logical-pixels',
        width: 1280, height: 720, pixelsPerUnit: 1 } }, nodes: [{ id: 'root', components: [] }] },
    }))
    const content = await app.request(`/api/projects/${projectId}/game-content?metadata=1`)
    const contentBody = await content.json()
    expect({ status: content.status, body: contentBody }).toMatchObject({ status: 200, body: { state: 'ready', documents: [{ id: 'scene' }] } })
    await writeFile(join(project.root_path, 'game.ts'), 'export const game = 2')
    const stale = await app.request(`/api/projects/${projectId}/deployment-readiness`)
    expect(await stale.json()).toMatchObject({ allowed: false })
    const state = JSON.stringify(await readProjectDelivery(project.root_path, join(root, 'dashboard')))
    expect(state).not.toContain('DOCUMENT_DRAFTING')
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})

test('explicit stop pauses one Agent and Continue resumes it without starting a workflow', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-native-delivery-resume-'))
  const cleanups: Array<() => void | Promise<void>> = []
  let turns = 0
  const runner: BeeGameSessionRunner = { async start() {
    return { stop() {}, async submit(turn) {
      turns++
      await turn.onMessage({ type: 'result', subtype: 'success', result: `Turn ${turns}` })
    } }
  } }
  const app = createAgentWorkflowApp({ currentUser: { id: 'resume-owner', role: 'owner' },
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: join(root, 'projects'),
    modelConfigStore: false, skillsConfig: false, sessionRunner: runner,
    registerCleanup: cleanup => cleanups.push(cleanup) })
  try {
    await app.request('/api/model-configs', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Offline', provider: 'openai-compatible', apiKey: 'fake',
        models: { balanced: 'fake' }, isDefault: true }) })
    const projectId = 'resume-project'
    const bootstrap = await app.request('/api/projects/bootstrap', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: { id: projectId, name: 'Resume', created_at: Date.now() },
        brief: { idea: 'Create a game', resourceLibraryUsage: 'optional', document_language: 'en',
          game_user_visible_language: 'en', agent_response_language: 'en' } }) })
    expect(bootstrap.status).toBe(202)
    const { project, session } = await bootstrap.json() as { project: { root_path: string }; session: { id: string } }
    for (let i = 0; i < 100 && turns < 1; i++) await Bun.sleep(5)
    const stopped = await app.request(`/api/projects/${projectId}/stop`, { method: 'POST' })
    expect(stopped.status).toBe(200)
    expect((await readProjectDelivery(project.root_path, join(root, 'dashboard')))?.status).toBe('paused')
    const continued = await app.request(`/api/beegame-sessions/${session.id}/continue`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(continued.status).toBe(202)
    for (let i = 0; i < 100 && turns < 2; i++) await Bun.sleep(5)
    expect(turns).toBe(2)
    expect((await readProjectDelivery(project.root_path, join(root, 'dashboard')))?.status).toBe('active')
    expect(await Bun.file(join(project.root_path, '.beegame/workflow/run.json')).exists()).toBe(false)
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})

test('a project follow-up returns to the original objective without duplicating the visible request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-native-delivery-followup-'))
  const cleanups: Array<() => void | Promise<void>> = []
  const prompts: unknown[] = []
  const runner: BeeGameSessionRunner = { async start(input) {
    return { stop() {}, async submit(turn) {
      prompts.push(turn.prompt)
      if (prompts.length === 3) {
        await mkdir(join(input.cwd, '.beegame/delivery'), { recursive: true })
        await mkdir(join(input.cwd, 'dist'), { recursive: true })
        await writeFile(join(input.cwd, 'game.ts'), 'complete')
        await writeFile(join(input.cwd, 'dist/game.js'), 'built')
        await writeFile(join(input.cwd, '.beegame/delivery/verified.txt'), 'browser result')
        await writeFile(join(input.cwd, PROJECT_DELIVERY_REPORT_PATH), JSON.stringify({
          scope: 'delivery', status: 'passed', summary: 'Verified current build',
          environment: 'Browser preview', evidencePaths: ['.beegame/delivery/verified.txt'],
          artifactPaths: ['dist/game.js'], verification: { target: 'deployment', knownIssues: [], unverified: [] },
        }))
      }
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
    } }
  } }
  const app = createAgentWorkflowApp({ currentUser: { id: 'followup-owner', role: 'owner' },
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: join(root, 'projects'),
    modelConfigStore: false, skillsConfig: false, sessionRunner: runner,
    registerCleanup: cleanup => cleanups.push(cleanup) })
  try {
    await app.request('/api/model-configs', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Offline', provider: 'openai-compatible', apiKey: 'fake',
        models: { balanced: 'fake' }, isDefault: true }) })
    const projectId = 'followup-project'
    const bootstrap = await app.request('/api/projects/bootstrap', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: { id: projectId, name: 'Followup', created_at: Date.now() },
        brief: { idea: 'Create a game', resourceLibraryUsage: 'optional', document_language: 'en',
          game_user_visible_language: 'en', agent_response_language: 'en' } }) })
    expect(bootstrap.status).toBe(202)
    const { session, project } = await bootstrap.json() as { session: { id: string }; project: { root_path: string } }
    for (let i = 0; i < 100 && prompts.length < 1; i++) await Bun.sleep(5)
    await Bun.sleep(10)
    const followup = await app.request(`/api/beegame-sessions/${session.id}/input`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'What is left?', clientMessageId: 'question-one' }) })
    expect(followup.status).toBe(202)
    for (let i = 0; i < 100; i++) {
      if (prompts.length === 3 && (await readProjectDelivery(project.root_path, join(root, 'dashboard')))?.accepted) break
      await Bun.sleep(5)
    }
    expect(prompts).toHaveLength(3)
    const readiness = await app.request(`/api/projects/${projectId}/deployment-readiness`)
    expect(await readiness.json()).toMatchObject({ allowed: true })
    const history = await app.request(`/api/beegame-sessions/${session.id}/events`)
    const events = await history.json() as Array<{ type: string; payload?: { displayKind?: string } }>
    expect(events.filter(event => event.type === 'user.message').map(event => event.payload?.displayKind))
      .toEqual(['confirmed_brief', 'project_request', 'delivery_continue'])
    expect(await Bun.file(join(project.root_path, '.beegame/workflow/run.json')).exists()).toBe(false)
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})

test('a stopped historical run migrates to a read-only checkpoint before Continue uses the native Agent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-native-delivery-migrate-'))
  const cleanups: Array<() => void | Promise<void>> = []
  let nativeTurns = 0
  let releaseTurn: (() => void) | undefined
  const app = createAgentWorkflowApp({ currentUser: { id: 'migration-owner', role: 'owner' },
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: join(root, 'projects'),
    modelConfigStore: false, skillsConfig: false,
    sessionRunner: { async start(input) {
      expect(input.workflowWorker).toBeUndefined()
      return { stop() {}, async submit(turn) {
        nativeTurns++
        await new Promise<void>(resolve => { releaseTurn = resolve })
        await turn.onMessage({ type: 'result', subtype: 'success', result: 'Continuing original game' })
      } }
    } }, registerCleanup: cleanup => cleanups.push(cleanup) })
  try {
    const ownerId = 'migration-owner'
    const projectId = 'migration-project'
    const workspace = join(root, 'projects/users', ownerId, projectId)
    await mkdir(workspace, { recursive: true })
    await app.request('/api/model-configs', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Offline', provider: 'openai-compatible', apiKey: 'fake',
        models: { balanced: 'fake' }, isDefault: true }) })
    const created = await app.request('/api/projects', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: projectId, name: 'Migration', root_path: workspace, created_at: Date.now() }) })
    expect(created.status).toBe(200)
    const ensured = await app.request(`/api/projects/${projectId}/session/ensure`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{}' })
    const { session } = await ensured.json() as { session: { id: string; cwd: string } }
    expect(session.cwd).toBe(await realpath(workspace))
    const store = createRunStore(workspace, ownerId)
    const run = { ...createTestDeliveryRun({ ownerId, projectId, confirmedBriefContext: 'Build a migration game' }),
      status: 'stopped' as const, phase: 'IMPLEMENTATION' as const }
    await store.commit(run, { runId: run.runId, type: 'run.stopped', phase: run.phase,
      status: run.status, revision: run.revision })
    const snapshot = await readFile(store.paths.snapshot, 'utf8')
    const continued = await Promise.all([0, 1].map(() =>
      app.request(`/api/beegame-sessions/${session.id}/continue`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: '{}' })))
    expect(continued.map(response => response.status)).toEqual([202, 202])
    for (let i = 0; i < 100 && nativeTurns < 1; i++) await Bun.sleep(5)
    expect(nativeTurns).toBe(1)
    releaseTurn?.()
    expect((await readProjectDelivery(workspace, join(root, 'dashboard')))?.objective).toBe('Build a migration game')
    expect(await readFile(store.paths.snapshot, 'utf8')).toBe(snapshot)
    const legacyResume = await app.request(`/api/projects/${projectId}/workflow/resume`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(legacyResume.status).toBe(409)
  } finally {
    releaseTurn?.()
    for (const cleanup of cleanups.reverse()) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})
