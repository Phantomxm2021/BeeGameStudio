import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { createPreviewCapabilityManager } from '../../auth/preview-capability'
import { BeeGameAuthUnavailableError } from '../../auth/user-context'
import { createMeasuredPreview } from './measured-preview'
import { createRun, publishPlan, claimTask, finishTask, V3_PROTOCOL, type TaskSpec, type CheckResult, type AgentTurn, type AgentMeasurement } from './state'
import { readVersion, runChecks } from './checks'
import { artifactDigest } from '../runtime-acceptance'
import { projectFiles } from './editable-project'
import { EDITABLE_BUILD_CHECK_VERSION } from './check-versions'
import { exportAgentMeasuredBuild, selectAgentMeasuredBuild } from './measured-build'
import { staticArtifactFiles, STATIC_ARTIFACT_CHECK_VERSION } from './runtime-checks'
import { registerV3Routes } from './routes'
import { BeeGameSessionManager } from '../session-manager'
import { createAgentWorkflowApp } from '../../app'
import { createPreviewTestBrowser } from '../preview-test-browser'
import { sharedPlaywright } from '../shared-playwright'
import { spawn } from 'node:child_process'
import { PREVIEW_IFRAME_SANDBOX } from '@bee-game-studio/agent-workflow/preview-environment'

const task: TaskSpec = { id: 'build', kind: 'game.develop', goal: 'Synthetic measured static game', dependsOn: [], requirementIds: ['req.loop'],
  inputs: ['rules.json'], writablePaths: ['dist/**'], expectedOutputs: ['dist/index.html'], checks: ['runtime-smoke'], runtimeArtifact: 'dist' }

// Fast tests use synthetic host evidence. The browser test below performs the
// real runtime check before Preview; these records are not product acceptance.
export async function previewFixture(origin = 'http://localhost:4567', actualCheck = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-v3-measured-preview-')))
  await mkdir(join(root, 'dist/content'), { recursive: true })
  await writeFile(join(root, 'rules.json'), '{"expected":7}')
  await writeFile(join(root, 'dist/content/value.json'), '{"value":7}')
  await writeFile(join(root, 'dist/main.js'), 'const data=await(await fetch("/content/value.json")).json();document.querySelector("#result").textContent="value="+data.value;')
  await writeFile(join(root, 'dist/icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>')
  await writeFile(join(root, 'dist/index.html'), '<!doctype html><body><p id="result">loading</p><img src="/icon.svg"><script type="module" src="/main.js"></script></body>')
  const initial = createRun({ projectId: 'preview-game', ownerId: 'owner', workspacePath: root, chatSessionId: 'user-chat', requestKey: 'run',
    text: 'Synthetic measured Preview', constraints: {}, ids: ['req.loop'] })
  const plan = publishPlan(initial, { protocol: V3_PROTOCOL, baseRevision: 0, requirementsRevision: initial.requirements.revision, tasks: [task] })
  const claimed = claimTask(plan, { taskId: task.id, requestKey: 'build', workerId: 'worker', sessionId: 'synthetic-native',
    inputVersions: [await readVersion(root, 'rules.json')] })
  const paths = await staticArtifactFiles(root, 'dist'), versions = await Promise.all(paths.map(p => readVersion(root, p)))
  const check: CheckResult = actualCheck ? (await runChecks(root, task, claimed.attempts[0]!.inputVersions)).checks[0]! :
    { id: 'runtime-smoke', version: STATIC_ARTIFACT_CHECK_VERSION, status: 'passed', inputs: [...claimed.attempts[0]!.inputVersions, ...versions],
      artifacts: [{ path: 'dist', sha256: await artifactDigest(root, 'dist', true) }], createdAt: new Date().toISOString(),
      observation: 'Synthetic host smoke fixture only', coverage: { files: paths, limitations: ['Gameplay unverified'] } }
  expect(check.status, check.observation).toBe('passed')
  let run = finishTask(claimed, claimed.writer!.attemptId, claimed.fence, { checks: [check], outputs: [await readVersion(root, 'dist/index.html')] }, true)
  let busy = false
  const capabilities = createPreviewCapabilityManager()
  const manager = createMeasuredPreview({ origin, capabilities, readRun: async (p, o) => p === run.projectId && o === run.ownerId ? run : undefined, isBusy: () => busy })
  return { root, manager, capabilities, get run() { return run }, set run(value) { run = value },
    set busy(value: boolean) { busy = value },
    open: () => manager.open(run, task.id, run.tasks.build!.attemptId!, run.planRevision),
    dispose: async () => { manager.dispose(); await rm(root, { recursive: true, force: true }) } }
}

test.each(['failed', 'interrupted'] as const)('settled %s native turn permits measured-byte inspection and explicit publication, never export', async status => {
  const f = await previewFixture()
  let manager: ReturnType<typeof createMeasuredPreview> | undefined
  let sessions: BeeGameSessionManager | undefined
  try {
    await writeFile(join(f.root, 'package.json'), '{"scripts":{"build":"fixture"}}')
    const run = createRun({ projectId: 'native-preview', ownerId: 'owner', workspacePath: f.root,
      chatSessionId: 'chat', requestKey: 'goal', text: 'Inspect measured build', constraints: {}, ids: ['goal'] })
    run.status = 'blocked'
    const artifact = { path: 'dist', sha256: await artifactDigest(f.root, 'dist', true) }
    const files = await projectFiles(f.root, 'dist', [])
    const runtimeFiles = await staticArtifactFiles(f.root, 'dist')
    const now = new Date().toISOString()
    const build: CheckResult = { id: 'build', version: EDITABLE_BUILD_CHECK_VERSION, status: 'passed',
      inputs: files, createdAt: now, observation: 'Synthetic source-copy evidence', artifacts: [artifact],
      projectBuild: { version: EDITABLE_BUILD_CHECK_VERSION, files, excludedReports: [], artifact, runtime: 'fixture' } }
    const smoke: CheckResult = { id: 'runtime-smoke', version: STATIC_ARTIFACT_CHECK_VERSION, status: 'passed',
      inputs: await Promise.all(runtimeFiles.map(path => readVersion(f.root, path))), createdAt: now,
      observation: 'Synthetic static smoke evidence', artifacts: [artifact], coverage: { files: runtimeFiles, limitations: [] } }
    const measurement: AgentMeasurement = { id: crypto.randomUUID(), requestKey: 'build-1', runtimeArtifact: 'dist',
      reportPaths: [], requirementsRevision: run.requirements.revision, startedAt: now, finishedAt: now,
      reports: [], checks: [build, smoke] }
    const turn: AgentTurn = { attemptId: crypto.randomUUID(), requestKey: 'goal', sessionId: 'chat', workerId: 'worker',
      fence: 1, status, startedAt: now, finishedAt: now, quiescedAt: now,
      error: 'Native settlement failed after measurement', measurements: [measurement] }
    run.agentTurns = [turn]
    let current = run
    manager = createMeasuredPreview({ origin: 'http://localhost:4567', capabilities: createPreviewCapabilityManager(),
      readRun: async () => current, isBusy: () => false })
    await expect(selectAgentMeasuredBuild(run, measurement.id)).rejects.toThrow('completed native turn')
    expect((await selectAgentMeasuredBuild(run, measurement.id, false, 'publication')).artifact).toEqual(artifact)
    await expect(exportAgentMeasuredBuild(run, measurement.id, { read: async () => current, busy: () => false })).rejects.toThrow('completed native turn')
    sessions = new BeeGameSessionManager({ async start() { throw Error('Preview must not start an Agent') } }, join(f.root, 'sessions'))
    const app = new Hono()
    let publications = 0
    registerV3Routes(app, { store: { read: async () => current, async commit() { throw Error('Preview must not change the Run') } },
      preview: manager, sessions, getUser: () => ({ id: 'owner', role: 'owner' }),
      getProject: async () => ({ id: run.projectId, root_path: f.root } as any),
      getAuthToken: () => undefined, getValidAuthToken: () => undefined, assertNoLegacyRun: async () => {},
      persistMode: async () => {}, readBody: request => request.json(),
      deployment: () => ({ destination: 'remote', isPublishing: () => false, list: async () => [],
        start: async (input: any) => { await input.measured.validate(); publications++; return { id: 'synthetic', status: 'queued' } },
      } as any) })
    const readiness = await app.request('/api/projects/'+run.projectId+'/deployment-readiness')
    expect(await readiness.json()).toMatchObject({ allowed: true, measurementId: measurement.id, quality: 'unverified' })
    const publish = await app.request('/api/projects/'+run.projectId+'/deployments', { method: 'POST', body: '{}' })
    expect(publish.status).toBe(202)
    expect(publications).toBe(1)
    const response = await app.request('/api/projects/'+run.projectId+'/preview', { method: 'POST', body: '{}' })
    expect(response.status).toBe(200)
    const previewState = await response.json()
    expect(previewState.mode).toBe('production')
    const preview = (await manager.status(run.projectId, run.ownerId)).preview!
    expect(preview.limitations.join(' ')).toContain('native turn did not succeed')
    expect((await manager.handle(new Request(preview.url)))?.status).toBe(200)
    current = { ...run, writer: { attemptId: 'other', fence: 2, workerId: 'worker' } }
    expect((await (await app.request('/api/projects/'+run.projectId+'/deployment-readiness')).json()).allowed).toBe(false)
    expect((await manager.handle(new Request(preview.url)))?.status).toBe(409)
    expect((await manager.status(run.projectId, run.ownerId)).preview).toBeNull()
    current = run
    const reopened = await manager.openAgent(run, measurement.id)
    await writeFile(join(f.root, 'rules.json'), '{"expected":8}')
    expect((await manager.handle(new Request(reopened.url)))?.status).toBe(409)
    expect((await (await app.request('/api/projects/'+run.projectId+'/deployment-readiness')).json()).allowed).toBe(false)
    expect((await app.request('/api/projects/'+run.projectId+'/deployments', { method: 'POST', body: '{}' })).status).toBe(409)
    expect(publications).toBe(1)
  } finally { await sessions?.dispose(); manager?.dispose(); await f.dispose() }
})

test('measured bytes, root paths, MIME and explicit stop; no workspace/API/script fallback', async () => {
  const f = await previewFixture()
  try {
    const original = JSON.stringify(f.run), p = await f.open()
    expect(await f.open()).toEqual(p)
    for (const path of ['', 'main.js', 'content/value.json', 'icon.svg']) {
      const response = (await f.manager.handle(new Request(p.url + path)))!
      expect(response.status).toBe(200)
      expect(await response.text()).toBe(await Bun.file(join(f.root, 'dist', path || 'index.html')).text())
      expect(response.headers.get('cache-control')).toContain('no-store')
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
      expect(response.headers.get('x-beegame-preview-mode')).toBe('measured-static')
    }
    expect((await f.manager.handle(new Request(p.url+'main.js')))!.headers.get('content-type')).toContain('javascript')
    const head = (await f.manager.handle(new Request(p.url, { method: 'HEAD' })))!
    expect(head.headers.get('content-length')).toBeTruthy()
    expect(head.headers.get('x-beegame-preview-mode')).toBe('measured-static')
    expect(head.headers.get('access-control-expose-headers')).toContain('X-BeeGame-Preview-Mode')
    expect((await f.manager.handle(new Request(p.url, { method: 'HEAD' })))!.body).toBeNull()
    expect((await f.manager.handle(new Request(p.url, { method: 'OPTIONS' })))!.status).toBe(204)
    expect((await f.manager.handle(new Request(p.url, { method: 'POST' })))!.status).toBe(405)
    for (const path of ['api/projects', 'rules.json', '.env', '%2eenv', '%2e%2e%2foutside', 'content%5cvalue.json', '%ZZ', 'content//value.json'])
      expect((await f.manager.handle(new Request(p.url+path)))!.status).not.toBe(200)
    expect(await f.manager.handle(new Request('http://localhost:4567/api/projects'))).toBeUndefined()
    expect((await f.manager.handle(new Request('http://unknown.localhost:4567/api/projects')))!.status).toBe(404)
    expect((await f.manager.handle(new Request(p.url.replace(':4567', ':4568'))))!.status).toBe(200) // internal proxy port
    await expect(Promise.resolve().then(() => f.manager.close(f.run.projectId, f.run.ownerId, 'wrong'))).rejects.toThrow('current Preview')
    f.manager.close(f.run.projectId, f.run.ownerId, p.id)
    expect((await f.manager.handle(new Request(p.url)))!.status).toBe(404)
    expect(JSON.stringify(f.run)).toBe(original); expect(f.run.deliveryEligible).toBe(false)
    const reopened = await f.open(); expect(reopened.id).not.toBe(p.id)
    f.manager.dispose(); expect((await f.manager.handle(new Request(reopened.url)))!.status).toBe(404)
    await expect(f.open()).rejects.toThrow('stopped')
  } finally { await f.dispose() }
})

for (const change of ['source', 'build', 'added', 'writer', 'native-writer', 'alias', 'attempt', 'check-version', 'upstream-check-version'] as const) {
  test('Preview revokes when '+change+' invalidates current evidence; no automatic work', async () => {
    const f = await previewFixture()
    try {
      const p = await f.open()
      if (change === 'source') await writeFile(join(f.root, 'rules.json'), '{}')
      if (change === 'build') await writeFile(join(f.root, 'dist/main.js'), '// changed')
      if (change === 'added') await writeFile(join(f.root, 'dist/new.js'), '// new')
      if (change === 'writer') f.run = { ...f.run, writer: { attemptId: 'other', fence: 2, workerId: 'worker' } }
      if (change === 'native-writer') f.busy = true
      if (change === 'alias') {
        await writeFile(join(f.root, 'copy.js'), await Bun.file(join(f.root, 'dist/main.js')).text())
        await rm(join(f.root, 'dist/main.js')); await symlink(join(f.root, 'copy.js'), join(f.root, 'dist/main.js'))
      }
      if (change === 'attempt') f.run.tasks.build!.attemptId = 'new-attempt'
      if (change === 'check-version') f.run.attempts[0]!.checks![0]!.version = 'unknown-driver'
      if (change === 'upstream-check-version') {
        // Smoke remains valid; a different check on the measured task is stale.
        f.run.attempts[0]!.checks!.push({ id: 'artifact-json', version: 'obsolete.0', status: 'passed', inputs: [],
          observation: 'Synthetic obsolete evidence', createdAt: new Date().toISOString() })
      }
      const response = (await f.manager.handle(new Request(p.url+'main.js')))!
      expect(response.status).toBe(409)
      expect((await f.manager.status(f.run.projectId, f.run.ownerId)).preview).toBeNull()
      expect((await f.manager.handle(new Request(p.url)))!.status).toBe(404)
    } finally { await f.dispose() }
  })
}

test('unrelated edits retain Preview; missing measurement/configuration, private files and artifact aliases do not open', async () => {
  const f = await previewFixture()
  try {
    const p = await f.open()
    await writeFile(join(f.root, 'unrelated.txt'), 'unrelated branch')
    f.run = { ...f.run, version: f.run.version + 1, planRevision: f.run.planRevision + 1 }
    expect((await f.manager.status(f.run.projectId, f.run.ownerId)).preview?.id).toBe(p.id)
    await expect(f.manager.open(f.run, 'build', f.run.tasks.build!.attemptId!, 1)).rejects.toThrow('current plan')
    f.run.attempts[0]!.checks![0]!.status = 'unverified'
    await expect(f.open()).rejects.toThrow('measured runtime-smoke')
  } finally { await f.dispose() }
  const unconfigured = createMeasuredPreview({ capabilities: createPreviewCapabilityManager(), readRun: async () => undefined, isBusy: () => false })
  await expect(unconfigured.open({} as any, 'x', 'x', 1)).rejects.toThrow('Configure')
  for (const origin of ['http://example.com', 'http://127.0.0.1:4567', 'https://user:pass@example.com', 'https://example.com/path'])
    expect(() => createMeasuredPreview({ origin, capabilities: createPreviewCapabilityManager(), readRun: async () => undefined, isBusy: () => false })).toThrow()
  const privateFiles = await previewFixture()
  try {
    await writeFile(join(privateFiles.root, 'dist/.env'), 'SECRET=not-to-be-served')
    const check = privateFiles.run.attempts[0]!.checks![0]!
    check.artifacts![0]!.sha256 = await artifactDigest(privateFiles.root, 'dist', true)
    const version = await readVersion(privateFiles.root, 'dist/.env'); check.inputs.push(version); check.coverage!.files.push(version.path)
    await expect(privateFiles.open()).rejects.toThrow('private dot path')
  } finally { await privateFiles.dispose() }
  const alias = await previewFixture()
  try {
    await symlink(join(alias.root, 'dist'), join(alias.root, 'dist-alias'))
    alias.run.tasks.build!.spec.runtimeArtifact = 'dist-alias'
    alias.run.attempts[0]!.checks![0]!.artifacts![0]!.path = 'dist-alias'
    await expect(alias.open()).rejects.toThrow('directory aliases')
  } finally { await alias.dispose() }
})

test('Run changing during open or file read never serves a candidate as measured bytes', async () => {
  const f = await previewFixture(); let change = false, reads = 0
  const manager = createMeasuredPreview({ origin: 'http://localhost:4567', capabilities: createPreviewCapabilityManager(),
    readRun: async () => change && ++reads > 1 ? { ...f.run, version: f.run.version+1 } : f.run, isBusy: () => false })
  try {
    const p = await manager.open(f.run, 'build', f.run.tasks.build!.attemptId!, f.run.planRevision)
    change = true
    const response = (await manager.handle(new Request(p.url+'main.js')))!
    expect(response.status).toBe(409); expect(await response.text()).not.toContain('const data=')
    const rejected = createMeasuredPreview({ origin: 'http://localhost:4567', capabilities: createPreviewCapabilityManager(),
      readRun: async () => ({ ...f.run, version: f.run.version+1 }), isBusy: () => false })
    await expect(rejected.open(f.run, 'build', f.run.tasks.build!.attemptId!, f.run.planRevision)).rejects.toThrow('while opening')
    expect((await rejected.status(f.run.projectId, f.run.ownerId)).preview).toBeNull(); rejected.dispose()
  } finally { manager.dispose(); await f.dispose() }
})

test('a delayed open cannot replace or leave an orphan capability beside a newer Preview', async () => {
  const f = await previewFixture(); let reads = 0, release!: () => void, started!: () => void
  const waiting = new Promise<void>(resolve => { started = resolve })
  const manager = createMeasuredPreview({ origin: 'http://localhost:4567', capabilities: createPreviewCapabilityManager(),
    readRun: async () => {
      if (++reads === 3) { started(); await new Promise<void>(resolve => { release = resolve }) }
      return f.run
    }, isBusy: () => false })
  try {
    const first = await manager.open(f.run, 'build', f.run.tasks.build!.attemptId!, f.run.planRevision)
    const delayed = manager.open(f.run, 'build', f.run.tasks.build!.attemptId!, f.run.planRevision)
    await waiting; manager.close(f.run.projectId, f.run.ownerId, first.id)
    const newer = await manager.open(f.run, 'build', f.run.tasks.build!.attemptId!, f.run.planRevision)
    release(); await expect(delayed).rejects.toThrow('newer capability')
    expect((await manager.status(f.run.projectId, f.run.ownerId)).preview?.id).toBe(newer.id)
    expect((await manager.handle(new Request(first.url)))!.status).toBe(404)
    expect((await manager.handle(new Request(newer.url)))!.status).toBe(200)
  } finally { release?.(); manager.dispose(); await f.dispose() }
})

test('Preview routes require owned project and preview.manage, not agent.send; no store/native mutations', async () => {
  const f = await previewFixture(), app = new Hono(); let role: 'owner' | 'viewer' = 'owner', owned = true, starts = 0, commits = 0
  const sessions = new BeeGameSessionManager({ async start() { starts++; throw Error('No native run permitted') } }, f.root, async () => ({}), {}, true)
  registerV3Routes(app, { preview: f.manager, sessions,
    store: { read: async () => f.run, commit: async () => { commits++; throw Error('No mutation permitted') } },
    getUser: () => ({ id: 'owner', role }), getProject: async () => owned ? { id: f.run.projectId, root_path: f.root } as any : undefined,
    getAuthToken: () => undefined, getValidAuthToken: () => undefined, assertNoLegacyRun: async () => {}, persistMode: async () => {}, readBody: r => r.json() })
  const path = '/api/projects/'+f.run.projectId+'/workflow-v3/preview'
  const body = { taskId: 'build', attemptId: f.run.tasks.build!.attemptId, planRevision: f.run.planRevision }
  try {
    expect((await app.request(path, { method: 'POST', body: JSON.stringify({ ...body, url: 'http://arbitrary/' }) })).status).toBe(400)
    role = 'viewer'; expect((await app.request(path, { method: 'POST', body: JSON.stringify(body) })).status).toBe(403)
    role = 'owner'; const response = await app.request(path, { method: 'POST', body: JSON.stringify(body) })
    expect(response.status).toBe(200); const p = (await response.json()).preview
    owned = false; expect((await app.request(path)).status).toBe(404)
    owned = true; role = 'viewer'; expect((await app.request(path)).status).toBe(200)
    expect((await app.request(path, { method: 'DELETE', body: JSON.stringify({ id: p.id }) })).status).toBe(403)
    role = 'owner'; expect((await app.request(path, { method: 'DELETE', body: JSON.stringify({ id: p.id }) })).status).toBe(200)
    expect(starts).toBe(0); expect(commits).toBe(0)
  } finally { await sessions.dispose(); await f.dispose() }
})

test('app preview-host boundary precedes auth/APIs; service restart loses capabilities but preserves measured Run', async () => {
  const f = await previewFixture('https://preview.example.com'), cleanups: Array<() => void | Promise<void>> = []
  let identityCalls = 0
  const app = createAgentWorkflowApp({
    workflowV3PreviewOrigin: 'https://preview.example.com', workflowV3Store: { read: async () => f.run, commit: async () => { throw Error('No mutation') } },
    currentUserResolver: async () => { identityCalls++; throw Error('Auth must not run on preview hosts') },
    dashboardDataRoot: join(f.root, 'host-dashboard'), defaultWorkspacePath: f.root, skillsConfig: false, modelConfigStore: false,
    sessionRunner: { async start() { throw Error('No native runtime') } }, registerCleanup: fn => cleanups.push(fn),
  })
  try {
    for (const host of ['unknown.preview.example.com', 'preview.example.com'])
      for (const path of ['/api/auth/session', '/api/projects', '/previews/old/', '/']) {
        expect((await app.request('https://'+host+path)).status).toBe(404)
      }
    expect(identityCalls).toBe(0)
    const p = await f.open(), snapshot = JSON.stringify(f.run)
    expect((await f.manager.handle(new Request(p.url)))!.status).toBe(200)
    expect((await f.manager.handle(new Request(p.url.replace('https:', 'http:'))))!.status).toBe(200) // TLS terminates upstream
    // A fresh app/manager does not revive any old bearer URL or replay work.
    expect((await app.request(p.url)).status).toBe(404)
    const fresh = createMeasuredPreview({ origin: 'https://preview.example.com', capabilities: createPreviewCapabilityManager(),
      readRun: async () => f.run, isBusy: () => false })
    expect((await fresh.status(f.run.projectId, f.run.ownerId)).preview).toBeNull()
    expect((await fresh.open(f.run, 'build', f.run.tasks.build!.attemptId!, f.run.planRevision)).id).not.toBe(p.id)
    expect(JSON.stringify(f.run)).toBe(snapshot); fresh.dispose()
  } finally { for (const fn of cleanups) await fn(); await f.dispose() }
})

test('full BGS app opens the selected measured attempt, serves unchanged bytes and revokes without legacy scripts', async () => {
  const f = await previewFixture(), cleanups: Array<() => void | Promise<void>> = []
  let native = 0, legacy = 0, commits = 0, auth: 'yes' | 'no' | 'unavailable' = 'yes'
  const app = createAgentWorkflowApp({
    currentUserResolver: async () => {
      if (auth === 'unavailable') throw new BeeGameAuthUnavailableError()
      return auth === 'yes' ? { id: 'owner', role: 'owner' } : undefined
    }, workflowV3PreviewOrigin: 'http://localhost:4567',
    workflowV3Store: { read: async () => f.run, commit: async () => { commits++; throw Error('No mutation') } },
    dashboardDataRoot: join(f.root, 'host-dashboard'), defaultWorkspacePath: f.root, modelConfigStore: false, skillsConfig: false,
    sessionRunner: { async start() { native++; throw Error('No native runtime') } },
    previewRunner: () => { legacy++; throw Error('No project script') }, registerCleanup: fn => cleanups.push(fn),
  })
  try {
    const saved = await app.request('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: f.run.projectId, name: 'Synthetic measured game', root_path: f.root, created_at: Date.now() }) })
    expect(saved.status, await saved.clone().text()).toBe(200)
    const path = '/api/projects/'+f.run.projectId+'/workflow-v3/preview'
    auth = 'no'; expect((await app.request(path)).status).toBe(401)
    auth = 'unavailable'; expect((await app.request(path)).status).toBe(503)
    auth = 'yes'
    const response = await app.request(path, { method: 'POST', body: JSON.stringify({ taskId: 'build',
      attemptId: f.run.tasks.build!.attemptId, planRevision: f.run.planRevision }) })
    expect(response.status, await response.clone().text()).toBe(200)
    const p = (await response.json()).preview
    const runtime = await app.request('/api/projects/'+f.run.projectId+'/runtime-state')
    expect(runtime.status).toBe(200)
    expect((await runtime.json()).build_report).toMatchObject({ status: 'passed', build_url: p.url })
    auth = 'unavailable'
    const html = await app.request(p.url)
    expect(html.status).toBe(200)
    expect(await html.text()).toBe(await Bun.file(join(f.root, 'dist/index.html')).text())
    expect((await app.request(p.url+'api/projects')).status).toBe(404)
    auth = 'yes'
    expect((await app.request(path, { method: 'DELETE', body: JSON.stringify({ id: p.id }) })).status).toBe(200)
    expect((await (await app.request('/api/projects/'+f.run.projectId+'/runtime-state')).json()).build_report).toBeNull()
    expect((await app.request(p.url)).status).toBe(404)
    expect((await app.request('/api/projects/'+f.run.projectId+'/preview', { method: 'POST', body:'{}' })).status).toBe(409)
    expect((await app.request('/api/projects/'+f.run.projectId+'/preview', { method: 'POST', body:'bad-json' })).status).toBe(400)
    expect(commits).toBe(0); expect(native).toBe(0); expect(legacy).toBe(0)
  } finally { for (const fn of cleanups) await fn(); await f.dispose() }
})

test('real measured build in opaque sandbox loads root-absolute module/JSON/image; reload, revoke and isolation', async () => {
  let f: Awaited<ReturnType<typeof previewFixture>> | undefined
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const result = await f?.manager.handle(request)
    if (result) return result
    if (new URL(request.url).pathname === '/parent' && f) {
      const p = await f.open()
      return new Response('<!doctype html><iframe title="fixture" sandbox="'+PREVIEW_IFRAME_SANDBOX+'" src="'+p.url+'"></iframe>', { headers: { 'content-type': 'text/html' } })
    }
    return new Response('No BGS API on preview host', { status: 404 })
  } })
  const owned = createPreviewTestBrowser()
  let child: ReturnType<typeof spawn> | undefined
  try {
    f = await previewFixture('http://localhost:'+server.port, true)
    const p = await f.open(), endpoint = (await owned.start()).endpoint
    const node = Bun.which('node'); if (!node) throw Error('Installed Node needed for the pinned Playwright browser client')
    const result = await new Promise<string>((resolveResult, reject) => {
      child = spawn(node, ['--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        const {chromium}=await import(process.env.BGS_PLAYWRIGHT_MODULE);
        const browser=await chromium.connectOverCDP(process.env.BGS_ENDPOINT);
        const context=await browser.newContext(), page=await context.newPage();
        const failures=[]; page.on('pageerror',e=>failures.push(e.message));
        try {
          await page.goto(process.env.BGS_PARENT);
          const frame=page.frameLocator('iframe');
          await frame.locator('#result').waitFor();
          await frame.getByText('value=7',{exact:true}).waitFor();
          assert.equal(await frame.locator('img').evaluate(i=>i.complete && i.naturalWidth===8),true);
          assert.equal(await frame.locator('body').evaluate(()=>{try{void localStorage.length;return false}catch{return true}}),true);
          assert.equal(await frame.locator('body').evaluate(()=>{try{void parent.document.body;return false}catch{return true}}),true);
          assert.equal(await frame.locator('body').evaluate(async()=> (await fetch('/api/projects')).status),404);
          await page.reload(); await page.frameLocator('iframe').getByText('value=7',{exact:true}).waitFor();
          assert.deepEqual(failures,[]);
          console.log(JSON.stringify({opaque:true,rootModule:true,json:true,image:true,reload:true,apiIsolated:true,errors:failures}));
        } finally {await context.close(); await browser.close();}
      `], { env: { PATH: process.env.PATH, BGS_PLAYWRIGHT_MODULE: sharedPlaywright().moduleUrl, BGS_ENDPOINT: endpoint,
        BGS_PARENT: 'http://localhost:'+server.port+'/parent' }, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = '', stderr = ''
      const timer = setTimeout(() => { child?.kill('SIGKILL'); reject(Error('Synthetic Preview browser deadline')) }, 25000)
      child.stdout!.on('data', b => { stdout += String(b) }); child.stderr!.on('data', b => { stderr += String(b) })
      child.once('error', e => { clearTimeout(timer); reject(e) })
      child.once('close', code => { clearTimeout(timer); code === 0 ? resolveResult(stdout) : reject(Error(stderr || 'Browser failed '+code)) })
    })
    expect(JSON.parse(result)).toEqual({ opaque: true, rootModule: true, json: true, image: true, reload: true, apiIsolated: true, errors: [] })
    f.manager.close(f.run.projectId, f.run.ownerId, p.id)
    const revoked = await fetch(p.url); expect(revoked.status).toBe(404)
  } finally { child?.kill('SIGKILL'); await owned.close(); server.stop(true); await f?.dispose() }
}, 60000)
