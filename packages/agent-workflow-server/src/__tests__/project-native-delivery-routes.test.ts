import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sanitizePath } from '../../../../src/utils/sessionStoragePortable'
import { createAgentWorkflowApp } from '../app'
import type { BeeGameSessionRunner, BeeGameSessionRunnerStartInput } from '../beegame/session-manager'
import { pauseProjectDelivery, projectContentAuthority, readProjectDelivery, PROJECT_DELIVERY_REPORT_PATH, PROJECT_DOCUMENTS } from '../beegame/project-delivery'
import { writeBeeGameAssetManifest } from '../beegame/asset-contracts'
import { assetManifestAuthoringExamples } from '../beegame/asset-manifest-authoring-contract'
import { BEEGAME_SCENE_MODEL } from '../beegame/game-content-package'
import { AUTHOR_BATCHES } from '../beegame/project-author'
import { designDocumentFixture, designRequirementChecksFixture, writeDesignDocumentFixture, writeDesignDocumentsFixture, writeUiLayoutFixture } from '../beegame/fixtures/layout-fixture'

async function completeFixtureMilestone(input: BeeGameSessionRunnerStartInput, implementationEvidence = false): Promise<string> {
  const context = await readFile(join(input.cwd, '.beegame/tmp', input.sessionId, 'context.md'), 'utf8')
  const conclusionPath = context.match(/\.beegame\/tmp\/[^\s]+\/milestone-[\w-]+\.txt/)?.[0]
  if (conclusionPath) await writeFile(join(input.cwd, conclusionPath.replace(/:$/, '')), 'complete\n' + (context.includes('milestone: review.')
    ? JSON.stringify({ step: 'inspect', findings: [], resolved: [] }) : ''))
  const contentContractExists = await Bun.file(join(input.cwd, '.beegame/delivery/content-contract.json')).exists()
  if (/milestone: (author|review|revision|resources)\./.test(context)) expect(contentContractExists).toBe(false)
  if (context.includes('milestone: content.')) expect(contentContractExists).toBe(true)
  if (context.includes('milestone: author.')) {
    await mkdir(join(input.cwd, 'docs'), { recursive: true })
    const assignment = /Author batch (\d+)\/(\d+)/.exec(context)
    const batch = Number(assignment?.[1]) - 1
    expect(Number(assignment?.[2])).toBe(AUTHOR_BATCHES.length)
    expect(batch).toBeGreaterThanOrEqual(0)
    for (const document of AUTHOR_BATCHES.slice(0, batch).flat())
      expect(await Bun.file(join(input.cwd, 'docs', document)).exists()).toBe(true)
    for (const document of AUTHOR_BATCHES[batch]!) await writeDesignDocumentFixture(input.cwd, document)
  } else if (context.includes('milestone: review.')) {
    expect(existsSync(join(input.cwd, 'content/index.json'))).toBe(false)
    expect(existsSync(join(input.cwd, 'content/ui/menu.json'))).toBe(true)
  } else if (context.includes('milestone: resources.')) {
    await mkdir(join(input.cwd, 'assets/runtime/example'), { recursive: true })
    await writeFile(join(input.cwd, 'assets/runtime/example/resource.json'), '{"original":true}')
    const manifest = assetManifestAuthoringExamples().canonical
    await writeBeeGameAssetManifest(input.cwd, { ...manifest,
      project_target: { ...manifest.project_target!, resource_library_usage: 'optional' } })
  } else if (context.includes('milestone: content.')) {
    expect(existsSync(join(input.cwd, 'content/index.json'))).toBe(false)
    expect(existsSync(join(input.cwd, 'content/ui/menu.json'))).toBe(true)
    await writeUiLayoutFixture(input.cwd)
    const authority = projectContentAuthority(input.cwd)
    await mkdir(join(input.cwd, 'content/scenes'), { recursive: true })
    await writeFile(join(input.cwd, 'content/index.json'), JSON.stringify({
      schema: 'beegame-content-package.v2', id: 'game', dimension: '2d',
      documentRevision: authority.documentRevision, assetManifestRevision: authority.assetManifestRevision,
      entryScene: 'level', sceneModel: BEEGAME_SCENE_MODEL, files: ['scenes/level.json', 'ui/menu.json'],
    }))
  } else if (context.includes('milestone: implementation.')) {
    await mkdir(join(input.cwd, 'dist'), { recursive: true })
    await writeFile(join(input.cwd, 'game.ts'), 'export const game = 1')
    await writeFile(join(input.cwd, 'dist/game.js'), 'built game')
  }
  if (context.includes('milestone: acceptance.') ||
      (implementationEvidence && context.includes('milestone: implementation.'))) {
    await mkdir(join(input.cwd, '.beegame/delivery'), { recursive: true })
    await writeFile(join(input.cwd, '.beegame/delivery/browser.txt'), 'observed game')
    await writeFile(join(input.cwd, PROJECT_DELIVERY_REPORT_PATH), JSON.stringify({
      scope: 'delivery', status: 'passed', summary: 'Played and verified the build',
      environment: 'Browser preview', evidencePaths: ['.beegame/delivery/browser.txt'],
      artifactPaths: ['dist/game.js'],
      verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [], unverified: [],
        requirementChecks: designRequirementChecksFixture(input.cwd, ['.beegame/delivery/browser.txt']),
        contentChecks: [{ kind: 'scene-layout', document: 'content/scenes/level.json', nodeId: 'board',
          property: 'transform', change: 'Move board in test copy', expected: 'Scene moves',
          observed: 'Scene moved with data', status: 'passed', evidencePaths: ['.beegame/delivery/browser.txt'] },
          { kind: 'ui-layout', document: 'content/ui/menu.json', nodeId: 'play', property: 'layout',
            change: 'Move play in test copy', expected: 'Button moves', observed: 'Button moved with data',
            status: 'passed', evidencePaths: ['.beegame/delivery/browser.txt'] }] },
    }))
  }
  return context
}

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
      orientation: 'Landscape', resourceLibraryUsage: 'optional', document_language: 'en', game_user_visible_language: 'en',
      agent_response_language: 'en' } }),
  })
  expect(confirmed.status).toBe(200)
  return { project: { root_path: await realpath(workspace) }, session }
}

test('new project bootstrap starts one native project conversation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-production-bootstrap-route-'))
  const cleanups: Array<() => void | Promise<void>> = []
  const starts: BeeGameSessionRunnerStartInput[] = []
  const prompts: unknown[] = []
  const app = createAgentWorkflowApp({ currentUser: { id: 'bootstrap-owner', role: 'owner' },
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: join(root, 'projects'),
    modelConfigStore: false, skillsConfig: false,
    sessionRunner: { async start(input) { starts.push(input); return { stop() {}, async submit(turn) {
      prompts.push(JSON.stringify(turn.prompt))
    } } } },
    registerCleanup: cleanup => cleanups.push(cleanup) })
  try {
    const invalid = await app.request('/api/projects/bootstrap', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: { id: 'missing-direction', name: 'Unconfirmed game', created_at: Date.now() },
        brief: { idea: 'Make a touch game', settings: { dimension: '2D', inputs: ['Touch'] } } }) })
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ error: expect.stringContaining('explicitly select') })
    expect(starts).toHaveLength(0)
    expect(await Bun.file(join(root, 'projects/users/bootstrap-owner/missing-direction')).exists()).toBe(false)
    const model = await app.request('/api/model-configs', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Offline', provider: 'openai-compatible', apiKey: 'fake',
        models: { balanced: 'fake' }, isDefault: true }) })
    expect(model.status).toBe(200)
    const response = await app.request('/api/projects/bootstrap', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: { id: 'bootstrap-project', name: 'New game', created_at: Date.now() },
        brief: { idea: 'Make a small game', creationMode: 'blueprint', orientation: 'Landscape', resourceLibraryUsage: 'optional',
          document_language: 'en', game_user_visible_language: 'en', agent_response_language: 'en' } }) })
    expect(response.status).toBe(202)
    await response.json()
    expect(starts).toHaveLength(1)
    for (let i = 0; i < 100 && prompts.length === 0; i++) await Bun.sleep(5)
    expect(prompts).toHaveLength(1)
    expect(String(prompts[0])).toContain('Make a small game')
    expect(String(prompts[0])).toContain('The current milestone and its deliverables are supplied in the project state')
    expect(String(prompts[0])).toContain('Document responsibilities:')
    expect(String(prompts[0])).not.toContain('visual-direction approval')
    expect(String(prompts[0])).toContain('default_first_release_scope')
    expect(String(prompts[0])).toContain('small complete playable version')
    expect(String(prompts[0])).toContain('do not defer the audiovisual feedback or usability needed by the agreed core loop')
    expect(String(prompts[0])).not.toContain('unrequested extra levels, modes, and polish')
    expect(String(prompts[0])).toContain('one or two levels if levels apply')
    expect(String(prompts[0])).toContain('a model-suggested option or scope does not by itself authorize an expansive first release')
    const stored = await readProjectDelivery(starts[0]!.cwd, join(root, 'dashboard'))
    expect(stored?.objective).toContain('default_first_release_scope')
    expect(String(prompts[0])).not.toContain('audit the complete document set yourself')
    expect(String(prompts[0])).toContain('Include author and date once in the document header; the host maintains its version')
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
        const current = await (await app.request(`/api/beegame-sessions/${session.id}`)).json() as { turnStatus: string }
        if (events.filter(event => event.type === 'turn.completed').length >= count && current.turnStatus === 'idle') return
        await Bun.sleep(5)
      }
      throw new Error(`Expected ${count} completed turns`)
    }
    expect((await send('Start', 'start')).status).toBe(202)
    await waitForCompletedTurns(1)
    await writeFile(join(workspace, 'game.ts'), 'baseline')
    expect((await send('Original request', 'original')).status).toBe(202)
    await waitForCompletedTurns(2)
    // A network retry must preserve the first request's pre-turn checkpoint.
    expect((await send('Original request', 'original')).status).toBe(202)
    expect(turns).toBe(2)
    expect((await send('Different request with same ID', 'original')).status).toBe(400)
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
    // Retrying an edit must be idempotent before the superseded-message check.
    expect((await send('Replacement request', 'replacement', 'original')).status).toBe(202)
    expect(turns).toBe(3)
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

test.each([false, true])('one native project session completes delivery; implementation evidence available: %s', async implementationEvidence => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-native-delivery-route-'))
  const cleanups: Array<() => void | Promise<void>> = []
  const starts: BeeGameSessionRunnerStartInput[] = []
  const prompts: unknown[] = []
  const contexts: string[] = []
  const runner: BeeGameSessionRunner = { async start(input) {
    starts.push(input)
    input.onNativeSessionId?.('d0e9e5bc-8db2-4dbc-91df-17800ed20467')
    return { stop() {}, async submit(turn) {
      prompts.push(JSON.stringify(turn.prompt))
      const context = await completeFixtureMilestone(input, implementationEvidence)
      contexts.push(context)
      if (context.includes('milestone: author.')) {
        const batch = Number(/Author batch (\d+)\//.exec(context)![1]) - 1
        if (batch === 0) expect(turn.directionAuthors).toBeUndefined()
        else {
          expect(Number(turn.directionAuthors?.batch)).toBe(batch)
          expect(Object.keys(turn.directionAuthors!.responsibilities).sort()).toEqual([...AUTHOR_BATCHES[batch]].sort())
        }
      } else if (context.includes('milestone: review.')) {
        expect(turn.projectTurn?.reviewStep).toBe('inspect')
        expect(turn.projectTurn?.reviewDocuments).toEqual([...PROJECT_DOCUMENTS])
      } else if (turn.projectTurn?.milestoneResult) {
        const baseline = turn.projectTurn.milestoneResult.designBaseline!
        expect(Object.keys(baseline.snapshots)).toHaveLength(PROJECT_DOCUMENTS.length)
        expect(Object.keys(baseline.evidenceHashes)).toContain('content/scenes/level.json')
        if (turn.projectTurn.milestoneResult.phase === 'content') {
          expect(context).toContain('# Current UI binding format')
          expect(context).toContain('behaviorBindings')
          expect(context).toContain('--ui-all --report')
        }
      }
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
    expect((await readProjectDelivery(project.root_path, join(root, 'dashboard')))?.lastValidationFailure).toBeUndefined()
    expect(contexts.map(context => /milestone: ([a-z-]+)\./.exec(context)?.[1])).toEqual([
      ...AUTHOR_BATCHES.map(() => 'author'), 'review', 'resources', 'content', 'implementation', 'acceptance',
    ])
    expect(prompts).toHaveLength(AUTHOR_BATCHES.length + 5)
    expect(contexts[AUTHOR_BATCHES.length]).toContain('Acceptance target: production can implement the agreed release')
    expect(contexts[AUTHOR_BATCHES.length + 1]).toContain('Optional resources do not block completion')
    expect(prompts.slice(1).every(prompt => String(prompt).includes('Continue the current project delivery milestone'))).toBe(true)
    expect(starts[0]?.resumeSessionId).toBeUndefined()
    const milestoneEvents = await (await app.request(`/api/beegame-sessions/${session.id}/events`)).json() as Array<{
      type: string; payload?: { subtype?: string; phase?: string }
    }>
    expect(milestoneEvents.filter(event => event.type === 'system.status' && event.payload?.subtype === 'delivery_phase')
      .map(event => event.payload?.phase)).toEqual([
      'author', 'review', 'resources', 'content', 'implementation', 'acceptance', 'complete',
    ])
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
      verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [], unverified: [] },
    }))
    await rm(join(root, 'dashboard/project-delivery', projectIdentity, 'state.json'))
    const restoredReadiness = await app.request(`/api/projects/${projectId}/deployment-readiness`)
    expect(await restoredReadiness.json()).toMatchObject({ allowed: false })
    const transcript = await app.request(`/api/beegame-sessions/${session.id}/events`)
    expect(transcript.status).toBe(200)
    const contentAuthority = projectContentAuthority(project.root_path)
    await mkdir(join(project.root_path, 'content/scenes'), { recursive: true })
    await writeFile(join(project.root_path, 'content/index.json'), JSON.stringify({
      schema: 'beegame-content-package.v2', id: 'game', dimension: '2d',
      documentRevision: contentAuthority.documentRevision, assetManifestRevision: contentAuthority.assetManifestRevision,
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

test('publish readiness preserves verified milestone state after runtime restart', async () => {
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
      input.onNativeSessionId?.('d0e9e5bc-8db2-4dbc-91df-17800ed20467')
      return { stop() {}, async submit(turn) {
        const context = await completeFixtureMilestone(input)
        await turn.onMessage({ type: 'result', subtype: 'success',
          result: '# 再次验收结论不变：**通过**（独立核验 VERDICT: PASS）\n\n已完成类型检查、构建和浏览器验证。' })
      } }
    } })
    await firstRuntime.request('/api/model-configs', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Offline', provider: 'openai-compatible', apiKey: 'fake',
        models: { balanced: 'fake' }, isDefault: true }) })
    const { project, session } = await startExistingProjectConversation({ app: firstRuntime, root,
      ownerId: 'restart-owner', projectId, name: 'Restart test', idea: 'Make a small game' })
    let initialReadiness: unknown
    for (let index = 0; index < 100; index++) {
      const response = await firstRuntime.request(`/api/projects/${projectId}/deployment-readiness`)
      initialReadiness = await response.json()
      if ((initialReadiness as { allowed: boolean }).allowed) break
      await Bun.sleep(5)
    }
    expect((await readProjectDelivery(project.root_path, join(root, 'dashboard')))?.lastValidationFailure).toBeUndefined()
    expect(initialReadiness).toMatchObject({ allowed: true })

    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()

    const restartedRuntime = createApp({ async start() {
      throw new Error('Readiness must not start an Agent after restart')
    } })
    const readiness = await restartedRuntime.request(`/api/projects/${projectId}/deployment-readiness`)
    expect(readiness.status).toBe(200)
    expect(await readiness.json()).toMatchObject({ allowed: true, destination: 'local' })
    const restored = await restartedRuntime.request(`/api/projects/${projectId}/session/ensure`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    expect(restored.status).toBe(200)
    expect(await restored.json()).toMatchObject({ session: { id: session.id } })
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

test.each(['user_stop', 'test_monitor_stop'])('explicit %s pauses a project and Continue resumes it', async reason => {
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
    const stopped = await app.request(`/api/projects/${projectId}/stop`, { method: 'POST',
      ...(reason === 'test_monitor_stop' ? { headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }) } : {}),
    })
    expect(stopped.status).toBe(200)
    const stoppedEvents = await (await app.request(`/api/beegame-sessions/${session.id}/events`)).json() as Array<{ type: string; payload?: { reason?: string } }>
    expect(stoppedEvents.findLast(event => event.type === 'session.stopped')?.payload?.reason).toBe(reason)
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

test('stopping a project does not preempt the next native request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-project-checkpoint-followup-'))
  const cleanups: Array<() => void | Promise<void>> = []
  const prompts: string[] = []
  const starts: BeeGameSessionRunnerStartInput[] = []
  let releaseInitial: (() => void) | undefined
  let releaseFollowup: (() => void) | undefined
  let releaseDelivery: (() => void) | undefined
  const app = createAgentWorkflowApp({ currentUser: { id: 'checkpoint-owner', role: 'owner' },
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: join(root, 'projects'),
    modelConfigStore: false, skillsConfig: false,
    sessionRunner: { async start(input) {
      starts.push(input)
      if (!input.resumeSessionId)
        input.onNativeSessionId?.('94429147-7294-4364-b363-d4097d11ae86')
      return { stop() { releaseInitial?.() }, async submit(turn) {
        prompts.push(JSON.stringify(turn.prompt))
        // Keep the initial turn active so Stop interrupts the running request.
        if (prompts.length === 1) await new Promise<void>(resolve => { releaseInitial = resolve })
        if (prompts.length === 2) {
          await new Promise<void>(resolve => { releaseFollowup = resolve })
          expect(turn.projectTurn?.authorDocument).toBeUndefined()
          expect(turn.directionAuthors).toBeUndefined()
        }
        if (prompts.length === 3) await new Promise<void>(resolve => { releaseDelivery = resolve })
        await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
      } }
    } }, registerCleanup: cleanup => cleanups.push(cleanup) })
  try {
    await app.request('/api/model-configs', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Offline', provider: 'openai-compatible', apiKey: 'fake',
        models: { balanced: 'fake' }, isDefault: true }) })
    const projectId = 'checkpoint-project'
    const { session } = await startExistingProjectConversation({ app, root,
      ownerId: 'checkpoint-owner', projectId, name: 'Checkpoint', idea: 'Create a game' })
    for (let i = 0; i < 100 && prompts.length < 1; i++) await Bun.sleep(5)
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
    for (let i = 0; i < 100; i++) {
      const current = await (await app.request(`/api/beegame-sessions/${session.id}`)).json() as { turnStatus: string }
      if (prompts.length >= 1 && current.turnStatus === 'idle') break
      await Bun.sleep(5)
    }
    expect(prompts[1]).toContain('Change player speed')
    const queued = await app.request(`/api/beegame-sessions/${session.id}/input`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'A later request' }) })
    expect(queued.status).toBe(202)
    expect(await queued.json()).toMatchObject({ queued: true })
    releaseFollowup?.()
    await Bun.sleep(50)
    expect(prompts).toHaveLength(3)
    expect(prompts[1]).not.toContain('Record your author conclusion')
    expect(prompts[2]).toContain('A later request')
    expect(prompts[2]).not.toContain('Continue the current project delivery milestone')
    expect(prompts.some(prompt => prompt.includes('resource-planner'))).toBe(false)
    expect((await readProjectDelivery(join(root, 'projects/users/checkpoint-owner', projectId), join(root, 'dashboard')))?.status).toBe('paused')
    expect(starts.every(start => !start.resumeSessionId ||
      start.resumeSessionId === '94429147-7294-4364-b363-d4097d11ae86')).toBe(true)
  } finally {
    releaseFollowup?.()
    releaseDelivery?.()
    for (const cleanup of cleanups.reverse()) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})

test('an unfinished GDD is not automatically retried after a normal reply or a later user question', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-native-delivery-followup-'))
  const cleanups: Array<() => void | Promise<void>> = []
  const prompts: unknown[] = []
  const runner: BeeGameSessionRunner = { async start() {
    return { stop() {}, async submit(turn) {
      prompts.push(turn.prompt)
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
    for (let i = 0; i < 100; i++) {
      const current = await (await app.request(`/api/beegame-sessions/${session.id}`)).json() as { turnStatus: string }
      if (prompts.length >= 1 && current.turnStatus === 'idle') break
      await Bun.sleep(5)
    }
    expect(prompts).toHaveLength(1)
    const followup = await app.request(`/api/beegame-sessions/${session.id}/input`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'What is left?', clientMessageId: 'question-one' }) })
    expect(followup.status).toBe(202)
    expect(await followup.json()).not.toMatchObject({ queued: true })
    for (let i = 0; i < 100 && prompts.length < 2; i++) await Bun.sleep(5)
    await Bun.sleep(20)
    expect(prompts).toHaveLength(2)
    expect((await readProjectDelivery(project.root_path, join(root, 'dashboard')))?.phase).toBe('author')
    expect((await readProjectDelivery(project.root_path, join(root, 'dashboard')))?.accepted).toBeUndefined()
    const readiness = await app.request(`/api/projects/${projectId}/deployment-readiness`)
    expect(await readiness.json()).toMatchObject({ allowed: false })
    const history = await app.request(`/api/beegame-sessions/${session.id}/events`)
    const events = await history.json() as Array<{ type: string; payload?: { displayKind?: string } }>
    expect(events.filter(event => event.type === 'user.message').map(event => event.payload?.displayKind))
      .toEqual(['confirmed_brief', 'project_request'])
    expect(await Bun.file(join(project.root_path, '.beegame/workflow/run.json')).exists()).toBe(false)
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})

test('Continue restores the native objective from chat when delivery state is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-native-delivery-migrate-'))
  const cleanups: Array<() => void | Promise<void>> = []
  let nativeTurns = 0
  const app = createAgentWorkflowApp({ currentUser: { id: 'migration-owner', role: 'owner' },
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: join(root, 'projects'),
    modelConfigStore: false, skillsConfig: false,
    sessionRunner: { async start(input) {
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
      body: JSON.stringify({ brief: { idea: 'Build a migration game', orientation: 'Landscape', resourceLibraryUsage: 'optional',
        document_language: 'en', game_user_visible_language: 'en', agent_response_language: 'en' } }),
    })
    expect(briefResponse.status).toBe(200)
    for (let i = 0; i < 100 && nativeTurns < 1; i++) await Bun.sleep(5)
    for (let i = 0; i < 100; i++) {
      const current = await (await app.request(`/api/beegame-sessions/${session.id}`)).json() as { turnStatus: string }
      if (current.turnStatus === 'idle' && nativeTurns >= 1) break
      await Bun.sleep(5)
    }
    const events = await (await app.request(`/api/beegame-sessions/${session.id}/events`)).json() as Array<{
      type: string; payload?: { displayKind?: string; confirmedBriefContext?: string }
    }>
    const originalObjective = events.find(event => event.type === 'user.message' &&
      event.payload?.displayKind === 'confirmed_brief')?.payload?.confirmedBriefContext
    expect(originalObjective).toBeTruthy()

    // Simulate an existing project whose delivery receipt is missing.
    const projectIdentity = createHash('sha256').update(await realpath(workspace)).digest('hex')
    await rm(join(root, 'dashboard/project-delivery', projectIdentity, 'state.json'))
    const continued = await app.request(`/api/beegame-sessions/${session.id}/continue`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(continued.status).toBe(202)
    for (let i = 0; i < 100 && nativeTurns < 2; i++) await Bun.sleep(5)
    expect(nativeTurns).toBe(2)
    expect((await readProjectDelivery(workspace, join(root, 'dashboard')))?.objective).toBe(originalObjective)
    expect((await readProjectDelivery(workspace, join(root, 'dashboard')))?.accepted).toBeUndefined()
    const legacyResume = await app.request(`/api/projects/${projectId}/workflow/resume`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(legacyResume.status).toBe(404)
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})
