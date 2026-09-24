import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sanitizePath } from '../../../../src/utils/sessionStoragePortable'
import { createAgentWorkflowApp } from '../app'
import type { BeeGameSessionRunner, BeeGameSessionRunnerStartInput } from '../beegame/session-manager'
import { pauseProjectDelivery, readProjectDelivery, PROJECT_DELIVERY_REPORT_PATH } from '../beegame/project-delivery'
import { BEEGAME_SCENE_MODEL } from '../beegame/game-content-package'
import { createRunStore } from '../beegame/delivery-workflow/run-store'
import { computeDocumentRevision } from '../beegame/delivery-workflow/revision'
import { createTestDeliveryRun } from './delivery-workflow-test-helpers'
import { readProjectProductionRun } from '../beegame/project-production-coordinator'

async function startExistingProjectConversation(input: {
  app: ReturnType<typeof createAgentWorkflowApp>
  root: string
  ownerId: string
  projectId: string
  name: string
  idea: string
}) {
  const workspace = join(input.root, 'projects/users', input.ownerId, input.projectId)
  await mkdir(workspace, { recursive: true })
  const created = await input.app.request('/api/projects', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: input.projectId, name: input.name, root_path: workspace, created_at: Date.now() }) })
  expect(created.status).toBe(200)
  const ensured = await input.app.request(`/api/projects/${input.projectId}/session/ensure`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: '{}' })
  expect(ensured.status).toBe(200)
  const { session } = await ensured.json() as { session: { id: string } }
  const confirmed = await input.app.request(`/api/beegame-sessions/${session.id}/confirmed-brief`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ brief: { idea: input.idea, creationMode: 'blueprint',
      resourceLibraryUsage: 'optional', document_language: 'en', game_user_visible_language: 'en',
      agent_response_language: 'en' } }),
  })
  expect(confirmed.status).toBe(200)
  return { project: { root_path: await realpath(workspace) }, session }
}

test('new project bootstrap persists document drafting before any main Agent turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-production-bootstrap-route-'))
  const cleanups: Array<() => void | Promise<void>> = []
  const starts: BeeGameSessionRunnerStartInput[] = []
  const app = createAgentWorkflowApp({ currentUser: { id: 'bootstrap-owner', role: 'owner' },
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: join(root, 'projects'),
    modelConfigStore: false, skillsConfig: false,
    sessionRunner: { async start(input) { starts.push(input); return { stop() {}, async submit() {} } } },
    registerCleanup: cleanup => cleanups.push(cleanup) })
  try {
    const model = await app.request('/api/model-configs', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Offline', provider: 'openai-compatible', apiKey: 'fake',
        models: { balanced: 'fake' }, isDefault: true }) })
    expect(model.status).toBe(200)
    const response = await app.request('/api/projects/bootstrap', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: { id: 'bootstrap-project', name: 'New game', created_at: Date.now() },
        brief: { idea: 'Make a small game', creationMode: 'blueprint', resourceLibraryUsage: 'optional',
          document_language: 'en', game_user_visible_language: 'en', agent_response_language: 'en' } }) })
    expect(response.status).toBe(202)
    const { project } = await response.json() as { project: { root_path: string } }
    const run = await readProjectProductionRun(project.root_path, 'bootstrap-owner')
    expect(run).toMatchObject({ phase: 'DOCUMENT_DRAFTING', documentStep: 'FOUNDATION_DRAFTING' })
    expect(starts).toHaveLength(0)
    const readiness = await app.request('/api/projects/bootstrap-project/deployment-readiness')
    expect(await readiness.json()).toMatchObject({ allowed: false })
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})

test('a conversational PASS without a delivery report does not authorize publishing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-conversational-pass-route-'))
  const cleanups: Array<() => void | Promise<void>> = []
  let turns = 0
  const app = createAgentWorkflowApp({
    currentUser: { id: 'pass-owner', role: 'owner' },
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: join(root, 'projects'),
    modelConfigStore: false, skillsConfig: false,
    sessionRunner: { async start() { return { stop() {}, async submit(turn) {
      turns++
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'PASS — all checks complete.' })
    } } } },
    registerCleanup: cleanup => cleanups.push(cleanup),
  })
  try {
    const model = await app.request('/api/model-configs', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Offline', provider: 'openai-compatible', apiKey: 'fake',
        models: { balanced: 'fake' }, isDefault: true }) })
    expect(model.status).toBe(200)
    await startExistingProjectConversation({ app, root, ownerId: 'pass-owner',
      projectId: 'pass-project', name: 'Pass game', idea: 'Make a small game' })
    for (let i = 0; i < 100 && turns === 0; i++) await Bun.sleep(5)
    expect(turns).toBe(1)
    const readiness = await app.request('/api/projects/pass-project/deployment-readiness')
    expect(await readiness.json()).toMatchObject({ allowed: false })
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})

test('editing the latest user message restores the prior project before the replacement turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-project-message-edit-'))
  const cleanups: Array<() => void | Promise<void>> = []
  let turns = 0
  const observedBeforeReplacement: string[] = []
  const nativeBeforeReplacement: string[] = []
  const nativeSessionId = 'f358849f-a13b-4576-8050-13024f58ab57'
  const nativeStarts: Array<string | undefined> = []
  const app = createAgentWorkflowApp({ currentUser: { id: 'edit-owner', role: 'owner' },
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: join(root, 'projects'),
    modelConfigStore: false, skillsConfig: false,
    sessionRunner: { async start(input) {
      nativeStarts.push(input.resumeSessionId)
      if (!input.env.BEEGAME_CONFIG_DIR) throw new Error('Fixture requires an isolated native config directory')
      const nativePath = join(input.env.BEEGAME_CONFIG_DIR,
        'projects', sanitizePath(input.cwd), `${nativeSessionId}.jsonl`)
      await mkdir(join(input.env.BEEGAME_CONFIG_DIR,
        'projects', sanitizePath(input.cwd)), { recursive: true })
      if (!input.resumeSessionId) {
        input.onNativeSessionId?.(nativeSessionId)
        await writeFile(nativePath, 'native before user change')
      } else nativeBeforeReplacement.push(await readFile(nativePath, 'utf8'))
      return { stop() {}, async submit(turn) {
      turns++
      if (turns === 2) {
        await writeFile(join(input.cwd, 'game.ts'), 'old change')
        await writeFile(nativePath, 'native after old change')
      }
      if (turns === 3) {
        observedBeforeReplacement.push(await readFile(join(input.cwd, 'game.ts'), 'utf8'))
        await writeFile(join(input.cwd, 'game.ts'), 'replacement change')
      }
      await turn.onMessage({ type: 'result', subtype: 'success', result: `Turn ${turns}` })
    } } } }, registerCleanup: cleanup => cleanups.push(cleanup) })
  try {
    await app.request('/api/model-configs', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Offline', provider: 'openai-compatible', apiKey: 'fake',
        models: { balanced: 'fake' }, isDefault: true }) })
    const projectId = 'edit-project'
    const workspace = join(root, 'projects/users/edit-owner', projectId)
    await mkdir(workspace, { recursive: true })
    const created = await app.request('/api/projects', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: projectId, name: 'Edit', root_path: workspace, created_at: Date.now() }) })
    expect(created.status).toBe(200)
    const ensured = await app.request(`/api/projects/${projectId}/session/ensure`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(ensured.status).toBe(200)
    const { session } = await ensured.json() as { session: { id: string } }
    const send = (text: string, clientMessageId: string, supersedesMessageId?: string) =>
      app.request(`/api/beegame-sessions/${session.id}/input`, { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, clientMessageId, ...(supersedesMessageId ? { supersedesMessageId } : {}) }) })
    const waitForCompletedTurns = async (count: number) => {
      for (let i = 0; i < 100; i++) {
        const events = await (await app.request(`/api/beegame-sessions/${session.id}/events`)).json() as Array<{ type: string }>
        if (events.filter(event => event.type === 'turn.completed').length >= count) return
        await Bun.sleep(5)
      }
      throw new Error(`Expected ${count} completed turns`)
    }
    expect((await send('Start', 'start')).status).toBe(202)
    await waitForCompletedTurns(1)
    await writeFile(join(workspace, 'game.ts'), 'baseline')
    expect((await send('Original request', 'original')).status).toBe(202)
    await waitForCompletedTurns(2)
    const older = await send('Must reject older message', 'invalid', 'not-latest')
    expect(older.status).toBe(400)
    const replacement = await send('Replacement request', 'replacement', 'original')
    const replacementBody = await replacement.json()
    expect({ status: replacement.status, body: replacementBody }).toMatchObject({ status: 202 })
    for (let i = 0; i < 100 && observedBeforeReplacement.length === 0; i++) await Bun.sleep(5)
    expect(observedBeforeReplacement).toEqual(['baseline'])
    expect(nativeStarts).toEqual([undefined, nativeSessionId])
    expect(nativeBeforeReplacement).toEqual(['native before user change'])
    expect(await readFile(join(workspace, 'game.ts'), 'utf8')).toBe('replacement change')
    const history = await app.request(`/api/projects/${projectId}/transcript`)
    const body = await history.json() as { events: Array<{ type: string; text: string }> }
    expect(body.events.filter(event => event.type === 'user.message').map(event => event.text))
      .toEqual(expect.arrayContaining(['Replacement request']))
    expect(body.events.some(event => event.text === 'Original request')).toBe(false)
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})

test('an existing project conversation records current verified output for publishing', async () => {
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
    const { project, session } = await startExistingProjectConversation({ app, root,
      ownerId: 'native-owner', projectId, name: 'Native game', idea: 'Make a small game' })
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
    const projectIdentity = createHash('sha256').update(await realpath(project.root_path)).digest('hex')
    await rm(join(root, 'dashboard/project-delivery', projectIdentity, 'state.json'))
    await rm(join(project.root_path, PROJECT_DELIVERY_REPORT_PATH))
    const legacySessionDeploy = await app.request(`/api/beegame-sessions/${session.id}/deployments`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    expect(legacySessionDeploy.status).toBe(409)
    expect(await legacySessionDeploy.json()).toMatchObject({
      issues: ['Current project has no verified delivery acceptance.'],
    })
    await writeFile(join(project.root_path, PROJECT_DELIVERY_REPORT_PATH), JSON.stringify({
      scope: 'delivery', status: 'passed', summary: 'Played and verified the build',
      environment: 'Browser preview', evidencePaths: ['.beegame/delivery/browser.txt'],
      artifactPaths: ['dist/game.js'],
      verification: { target: 'deployment', knownIssues: [], unverified: [] },
    }))
    await rm(join(root, 'dashboard/project-delivery', projectIdentity, 'state.json'))
    const restoredReadiness = await app.request(`/api/projects/${projectId}/deployment-readiness`)
    expect(await restoredReadiness.json()).toMatchObject({ allowed: true })
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

test('publish readiness restores only a verified report after runtime restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-native-delivery-restart-'))
  const projectId = 'restart-project'
  const cleanups: Array<() => void | Promise<void>> = []
  const currentUser = { id: 'restart-owner', role: 'owner' as const }
  const createApp = (sessionRunner: BeeGameSessionRunner) => createAgentWorkflowApp({
    currentUser,
    dashboardDataRoot: join(root, 'dashboard'),
    defaultWorkspacePath: join(root, 'projects'),
    modelConfigStore: false,
    skillsConfig: false,
    sessionRunner,
    registerCleanup: cleanup => cleanups.push(cleanup),
  })

  try {
    const firstRuntime = createApp({ async start(input) {
      return { stop() {}, async submit(turn) {
        await mkdir(join(input.cwd, '.beegame/delivery'), { recursive: true })
        await mkdir(join(input.cwd, 'dist'), { recursive: true })
        await writeFile(join(input.cwd, 'game.ts'), 'export const game = 1')
        await writeFile(join(input.cwd, 'dist/game.js'), 'built game')
        await writeFile(join(input.cwd, '.beegame/delivery/browser.txt'), 'Observed the current build')
        await writeFile(join(input.cwd, PROJECT_DELIVERY_REPORT_PATH), JSON.stringify({
          scope: 'delivery', status: 'passed', summary: 'Verified the current build',
          environment: 'Browser preview', evidencePaths: ['.beegame/delivery/browser.txt'],
          artifactPaths: ['dist/game.js'],
          verification: { target: 'deployment', knownIssues: [], unverified: [] },
        }))
        await turn.onMessage({ type: 'result', subtype: 'success',
          result: '# 再次验收结论不变：**通过**（独立核验 VERDICT: PASS）\n\n已完成类型检查、构建和浏览器验证。' })
      } }
    } })
    await firstRuntime.request('/api/model-configs', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Offline', provider: 'openai-compatible', apiKey: 'fake',
        models: { balanced: 'fake' }, isDefault: true }) })
    const { project } = await startExistingProjectConversation({ app: firstRuntime, root,
      ownerId: 'restart-owner', projectId, name: 'Restart test', idea: 'Make a small game' })
    let initialReadiness: unknown
    for (let index = 0; index < 100; index++) {
      const response = await firstRuntime.request(`/api/projects/${projectId}/deployment-readiness`)
      initialReadiness = await response.json()
      if ((initialReadiness as { allowed: boolean }).allowed) break
      await Bun.sleep(5)
    }
    expect(initialReadiness).toMatchObject({ allowed: true })

    const projectIdentity = createHash('sha256').update(await realpath(project.root_path)).digest('hex')
    await rm(join(root, 'dashboard/project-delivery', projectIdentity, 'state.json'))
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()

    const restartedRuntime = createApp({ async start() {
      throw new Error('Readiness must not start an Agent after restart')
    } })
    const readiness = await restartedRuntime.request(`/api/projects/${projectId}/deployment-readiness`)
    expect(readiness.status).toBe(200)
    expect(await readiness.json()).toMatchObject({ allowed: true, destination: 'local' })
    await writeFile(join(project.root_path, 'game.ts'), 'export const game = 2')
    const stale = await restartedRuntime.request(`/api/projects/${projectId}/deployment-readiness`)
    expect(await stale.json()).toMatchObject({
      allowed: false,
      issues: ['Workspace changed after acceptance; revalidation is required.'],
    })
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})

test('explicit stop pauses an existing project conversation and Continue resumes it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-native-delivery-resume-'))
  const cleanups: Array<() => void | Promise<void>> = []
  let turns = 0
  let finishTurn: (() => void) | undefined
  const runner: BeeGameSessionRunner = { async start() {
    return { stop() { finishTurn?.() }, async submit(turn) {
      turns++
      if (turns === 1) await new Promise<void>(resolve => { finishTurn = resolve })
      await turn.onMessage({ type: 'result', subtype: 'success', result: `Turn ${turns}` })
      finishTurn = undefined
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
    const { project, session } = await startExistingProjectConversation({ app, root,
      ownerId: 'resume-owner', projectId, name: 'Resume', idea: 'Create a game' })
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

test('a paused production lets the same Agent interpret user input, then resumes its saved stage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-project-checkpoint-followup-'))
  const cleanups: Array<() => void | Promise<void>> = []
  const prompts: string[] = []
  const starts: BeeGameSessionRunnerStartInput[] = []
  let releaseFollowup: (() => void) | undefined
  const app = createAgentWorkflowApp({ currentUser: { id: 'checkpoint-owner', role: 'owner' },
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: join(root, 'projects'),
    modelConfigStore: false, skillsConfig: false,
    sessionRunner: { async start(input) {
      starts.push(input)
      if (!input.resumeSessionId)
        input.onNativeSessionId?.('94429147-7294-4364-b363-d4097d11ae86')
      return { stop() {}, async submit(turn) {
        prompts.push(String(turn.prompt))
        if (prompts.length === 2) await new Promise<void>(resolve => { releaseFollowup = resolve })
        await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
      } }
    } }, registerCleanup: cleanup => cleanups.push(cleanup) })
  try {
    await app.request('/api/model-configs', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Offline', provider: 'openai-compatible', apiKey: 'fake',
        models: { balanced: 'fake' }, isDefault: true }) })
    const projectId = 'checkpoint-project'
    const { project, session } = await startExistingProjectConversation({ app, root,
      ownerId: 'checkpoint-owner', projectId, name: 'Checkpoint', idea: 'Create a game' })
    for (let i = 0; i < 100 && prompts.length < 1; i++) await Bun.sleep(5)
    const store = createRunStore(project.root_path, 'checkpoint-owner',
      { stateDirectory: '.beegame/delivery/production' })
    const initial = createTestDeliveryRun({ ownerId: 'checkpoint-owner', projectId })
    const run = { ...initial, phase: 'RESOURCE_PREPARATION' as const, status: 'stopped' as const,
      revision: { ...initial.revision,
        document: await computeDocumentRevision(project.root_path, initial.confirmedBriefDigest) } }
    await store.commit(run, { runId: run.runId, type: 'run.stopped', phase: run.phase,
      status: run.status, revision: run.revision })
    const stopped = await app.request(`/api/projects/${projectId}/stop`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(stopped.status).toBe(200)
    const ensured = await app.request(`/api/projects/${projectId}/session/ensure`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{}' })
    const resumedSession = (await ensured.json() as { session: { id: string } }).session
    expect(resumedSession.id).toBe(session.id)
    const response = await app.request(`/api/beegame-sessions/${session.id}/input`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Change player speed' }) })
    expect(response.status).toBe(202)
    expect(await response.json()).not.toMatchObject({ queued: true })
    for (let i = 0; i < 100 && prompts.length < 2; i++) await Bun.sleep(5)
    expect(prompts[1]).toContain('Change player speed')
    expect((await readProjectProductionRun(project.root_path, 'checkpoint-owner'))?.status).toBe('stopped')
    const queued = await app.request(`/api/beegame-sessions/${session.id}/input`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'A later request' }) })
    expect(queued.status).toBe(202)
    expect(await queued.json()).toMatchObject({ queued: true })
    releaseFollowup?.()
    for (let i = 0; i < 100 && prompts.length < 3; i++) await Bun.sleep(5)
    expect(prompts[2]).toContain('resource-planner')
    expect(prompts).not.toContain('A later request')
    expect(starts.every(start => !start.resumeSessionId ||
      start.resumeSessionId === '94429147-7294-4364-b363-d4097d11ae86')).toBe(true)
    expect((await readProjectProductionRun(project.root_path, 'checkpoint-owner'))?.phase)
      .toBe('RESOURCE_PREPARATION')
  } finally {
    releaseFollowup?.()
    for (const cleanup of cleanups.reverse()) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})

test('a project follow-up stays in one turn; only explicit Continue starts another turn', async () => {
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
    const { session, project } = await startExistingProjectConversation({ app, root,
      ownerId: 'followup-owner', projectId, name: 'Followup', idea: 'Create a game' })
    for (let i = 0; i < 100 && prompts.length < 1; i++) await Bun.sleep(5)
    await Bun.sleep(10)
    const followup = await app.request(`/api/beegame-sessions/${session.id}/input`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'What is left?', clientMessageId: 'question-one' }) })
    expect(followup.status).toBe(202)
    for (let i = 0; i < 100 && prompts.length < 2; i++) await Bun.sleep(5)
    await Bun.sleep(20)
    expect(prompts).toHaveLength(2)
    expect((await readProjectDelivery(project.root_path, join(root, 'dashboard')))?.accepted).toBeUndefined()
    const readiness = await app.request(`/api/projects/${projectId}/deployment-readiness`)
    expect(await readiness.json()).toMatchObject({ allowed: false })
    const continued = await app.request(`/api/beegame-sessions/${session.id}/continue`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(continued.status).toBe(202)
    for (let i = 0; i < 100; i++) {
      if (prompts.length === 3 && (await readProjectDelivery(project.root_path, join(root, 'dashboard')))?.accepted) break
      await Bun.sleep(5)
    }
    expect(prompts).toHaveLength(3)
    expect(await (await app.request(`/api/projects/${projectId}/deployment-readiness`)).json()).toMatchObject({ allowed: true })
    const history = await app.request(`/api/beegame-sessions/${session.id}/events`)
    const events = await history.json() as Array<{ type: string; payload?: { displayKind?: string } }>
    expect(events.filter(event => event.type === 'user.message').map(event => event.payload?.displayKind))
      .toEqual(['confirmed_brief', 'project_request', 'project_request'])
    expect(await Bun.file(join(project.root_path, '.beegame/workflow/run.json')).exists()).toBe(false)
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})

test('Continue restores the native objective from chat, not from the retired workflow snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-native-delivery-migrate-'))
  const cleanups: Array<() => void | Promise<void>> = []
  let nativeTurns = 0
  const app = createAgentWorkflowApp({ currentUser: { id: 'migration-owner', role: 'owner' },
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: join(root, 'projects'),
    modelConfigStore: false, skillsConfig: false,
    sessionRunner: { async start(input) {
      expect(input.workflowWorker).toBeUndefined()
      return { stop() {}, async submit(turn) {
        nativeTurns++
        if (nativeTurns === 2) await pauseProjectDelivery(input.cwd, join(root, 'dashboard'))
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

    const briefResponse = await app.request(`/api/beegame-sessions/${session.id}/confirmed-brief`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brief: { idea: 'Build a migration game', resourceLibraryUsage: 'optional',
        document_language: 'en', game_user_visible_language: 'en', agent_response_language: 'en' } }),
    })
    expect(briefResponse.status).toBe(200)
    for (let i = 0; i < 100 && nativeTurns < 1; i++) await Bun.sleep(5)
    const events = await (await app.request(`/api/beegame-sessions/${session.id}/events`)).json() as Array<{
      type: string; payload?: { displayKind?: string; confirmedBriefContext?: string }
    }>
    const originalObjective = events.find(event => event.type === 'user.message' &&
      event.payload?.displayKind === 'confirmed_brief')?.payload?.confirmedBriefContext
    expect(originalObjective).toBeTruthy()

    // Simulate an old project whose native delivery receipt hasn't been migrated yet.
    const projectIdentity = createHash('sha256').update(await realpath(workspace)).digest('hex')
    await rm(join(root, 'dashboard/project-delivery', projectIdentity, 'state.json'))
    const store = createRunStore(workspace, ownerId)
    const run = { ...createTestDeliveryRun({ ownerId, projectId, confirmedBriefContext: 'WRONG LEGACY OBJECTIVE' }),
      status: 'stopped' as const, phase: 'IMPLEMENTATION' as const }
    await store.commit(run, { runId: run.runId, type: 'run.stopped', phase: run.phase,
      status: run.status, revision: run.revision })
    const snapshot = await readFile(store.paths.snapshot, 'utf8')
    const continued = await app.request(`/api/beegame-sessions/${session.id}/continue`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(continued.status).toBe(202)
    for (let i = 0; i < 100 && nativeTurns < 2; i++) await Bun.sleep(5)
    expect(nativeTurns).toBe(2)
    expect((await readProjectDelivery(workspace, join(root, 'dashboard')))?.objective).toBe(originalObjective)
    expect((await readProjectDelivery(workspace, join(root, 'dashboard')))?.accepted).toBeUndefined()
    expect(await readFile(store.paths.snapshot, 'utf8')).toBe(snapshot)
    const legacyResume = await app.request(`/api/projects/${projectId}/workflow/resume`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(legacyResume.status).toBe(404)
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})
