import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { createAgentWorkflowApp } from '../app'
import type { FoundationAuthoringHost } from '../beegame/foundation-authoring-host'
import type { BeeGameSessionRunner } from '../beegame/session-manager'
import { createRunStore } from '../beegame/delivery-workflow/run-store'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../beegame/delivery-workflow/types'

const roots: string[] = []

type AuthorCalls = {
  start: unknown[]
  resume: unknown[]
  stop: unknown[]
  getResult: unknown[]
}

function fakeAuthor(calls: AuthorCalls): FoundationAuthoringHost {
  let handle: { protocolVersion: 1; producer: 'foundation-authoring'; id: string } | undefined
  let status: 'running' | 'stopped' = 'running'
  return {
    start: async input => {
      calls.start.push(input)
      handle = { protocolVersion: 1, producer: 'foundation-authoring', id: randomUUID() }
      status = 'running'
      return handle
    },
    resume: async input => {
      calls.resume.push(input)
      status = 'running'
      if (!handle) throw new Error('missing fake author handle')
      return handle
    },
    stop: async input => {
      calls.stop.push(input)
      status = 'stopped'
      if (!handle) throw new Error('missing fake author handle')
      return { status: 'stopped', handle }
    },
    getResult: async input => {
      calls.getResult.push(input)
      if (!handle) throw new Error('missing fake author handle')
      return { status, handle }
    },
  }
}

async function fixture(stageOptions: Partial<Pick<NonNullable<Parameters<typeof createAgentWorkflowApp>[0]>, 'foundationReviewerHostFactory' | 'foundationRevisionHostFactory'>> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'beegame-public-author-routes-'))
  roots.push(root)
  const ownerId = 'public-author-owner'
  const calls: AuthorCalls = { start: [], resume: [], stop: [], getResult: [] }
  const author = fakeAuthor(calls)
  let runnerStarts = 0
  const runner: BeeGameSessionRunner = {
    start: async () => {
      runnerStarts += 1
      return {
      submit: async ({ signal }) => await new Promise<void>(resolve => {
        if (signal.aborted) return resolve()
        signal.addEventListener('abort', () => resolve(), { once: true })
      }),
      stop: () => undefined,
      }
    },
  }
  const cleanups: Array<() => void | Promise<void>> = []
  const app = createAgentWorkflowApp({
    currentUser: { id: ownerId, role: 'owner' },
    dashboardDataRoot: join(root, 'dashboard'),
    defaultWorkspacePath: join(root, 'projects'),
    modelConfigStore: false,
    skillsConfig: false,
    sessionRunner: runner,
    foundationAuthoringHostFactory: () => author,
    ...stageOptions,
    registerCleanup: cleanup => cleanups.push(cleanup),
  })
  const modelConfig = await app.request('/api/model-configs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Public author offline model',
      provider: 'openai-compatible',
      apiKey: 'offline-fixture-key',
      models: { balanced: 'offline-fixture-model' },
      isDefault: true,
    }),
  })
  if (modelConfig.status !== 200) throw new Error(`model fixture failed: ${modelConfig.status}`)
  return { app, root, author, calls, cleanups, get runnerStarts() { return runnerStarts } }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('public foundation authoring app routes', () => {
  test('completed author hands off to public review; display, stop, resume and shutdown follow the active module', async () => {
    const handle = { protocolVersion: 1 as const, producer: 'foundation-reviewer' as const, id: randomUUID() }
    let state: 'running' | 'stopped' = 'running'
    let starts = 0; let stops = 0; let resumes = 0
    const outcome = () => ({ status: state, handle, billingStatus: 'settled' as const })
    const f = await fixture({
      foundationReviewerHostFactory: () => ({ async start() { starts++; return handle }, async getResult() { return outcome() },
        async stop() { stops++; state = 'stopped'; return outcome() }, async resume() { resumes++; state = 'running'; return outcome() } }),
      foundationRevisionHostFactory: () => ({ async start() { throw new Error('unexpected revision') }, async getResult() { throw new Error('unexpected revision') },
        async stop() { throw new Error('unexpected revision') }, async resume() { throw new Error('unexpected revision') } }),
    })
    try {
      const projectId = 'public-review-route'
      const response = await f.app.request('/api/projects/bootstrap', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project: { id: projectId, name: projectId, created_at: Date.now() }, projectName: projectId,
          brief: { idea: 'Offline public handoff', document_language: 'en', game_user_visible_language: 'en', agent_response_language: 'en', resource_library_usage: 'optional' } }) })
      expect(response.status).toBe(202)
      const { project } = await response.json() as { project: { root_path: string } }
      const store = createRunStore(project.root_path, 'public-author-owner')
      const current = (await store.load())!
      const content = '# Offline artifact\n'
      const hash = createHash('sha256').update(content).digest('hex')
      await mkdir(join(project.root_path, 'exports'), { recursive: true })
      const documents = await Promise.all(CANONICAL_FOUNDATION_DOCUMENTS.map(async (path, index) => {
        const artifactPath = `exports/document-${index}.md`
        await writeFile(join(project.root_path, artifactPath), content)
        return { path, artifactPath, digest: hash, byteLength: Buffer.byteLength(content) }
      }))
      const result = { protocolVersion: 1 as const, producer: 'foundation-authoring' as const, kind: 'foundation_documents' as const,
        ownerId: current.ownerId, projectId, resultId: hash, inputDigest: current.authorStage!.inputDigest,
        confirmedBriefDigest: current.confirmedBriefDigest, receiptSetDigest: hash, documentRevision: hash, workspaceRevision: hash, documents }
      f.author.getResult = async () => ({ status: 'completed', handle: current.authorStage!.handle!, result })
      // Existing author observer must deliver its public completion without a new launch endpoint.
      const deadline = Date.now() + 5000
      while (starts === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
      expect(starts).toBe(1)
      const viewResponse = await f.app.request(`/api/projects/${projectId}/workflow`)
      const view = (await viewResponse.json() as { workflow: Record<string, any> }).workflow
      expect(view.stageId).toBe('DOCUMENT_REVIEW')
      expect(view.tasks).toHaveLength(1)
      expect(view.tasks[0].operation).toBe('review')
      expect(view.foundationDocuments).toEqual(CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, status: 'ready' })))
      expect(view.block?.code).not.toBe('public_author_handoff')
      expect(view.foundationReviewStage).toBeUndefined()
      const stop = await f.app.request(`/api/projects/${projectId}/workflow/stop`, { method: 'POST' })
      expect(stop.status).toBe(200); expect(stops).toBe(1)
      expect((await store.load())!.status).toBe('stopped')
      const resumed = await f.app.request(`/api/projects/${projectId}/workflow/resume`, { method: 'POST' })
      expect(resumed.status).toBe(200); expect(resumes).toBe(1)
      expect(f.calls.stop).toHaveLength(0)
      expect(f.runnerStarts).toBe(0)
    } finally { await Promise.all(f.cleanups.map(cleanup => cleanup())) }
    expect(stops).toBe(2)
  })

  test('starts, resumes and stops only through the public port, and rejects retry task ids', async () => {
    const f = await fixture()
    const projectId = 'public-author-route-project'
    const bootstrap = await f.app.request('/api/projects/bootstrap', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        project: { id: projectId, name: 'Public author route', created_at: Date.now() },
        projectName: projectId,
        brief: { idea: 'Offline route fixture', document_language: 'en', game_user_visible_language: 'en', agent_response_language: 'en', resource_library_usage: 'optional' },
      }),
    })
    expect(bootstrap.status).toBe(202)
    expect(f.calls.start).toHaveLength(1)
    const body = await bootstrap.json() as { project: { root_path: string } }
    const resumed = await f.app.request(`/api/projects/${projectId}/workflow/resume`, { method: 'POST' })
    expect(resumed.status).toBe(200)
    expect(f.calls.resume).toHaveLength(0)
    const rejectedRetry = await f.app.request(`/api/projects/${projectId}/workflow/retry`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskId: 'legacy-task' }),
    })
    expect(rejectedRetry.status).toBe(409)
    expect(f.calls.resume).toHaveLength(0)
    const workflowStop = await f.app.request(`/api/projects/${projectId}/workflow/stop`, { method: 'POST' })
    expect(workflowStop.status).toBe(200)
    expect(f.calls.stop).toHaveLength(1)
    const resumedAgain = await f.app.request(`/api/projects/${projectId}/workflow/resume`, { method: 'POST' })
    expect(resumedAgain.status).toBe(200)
    expect(f.calls.resume).toHaveLength(1)
    const projectStop = await f.app.request(`/api/projects/${projectId}/stop`, { method: 'POST' })
    expect(projectStop.status).toBe(200)
    expect(f.calls.stop).toHaveLength(2)
    expect(f.calls.start).toHaveLength(1)
    expect(body.project.root_path).toContain(projectId)
    await Promise.all(f.cleanups.map(cleanup => cleanup()))
  })

  test('rejects a legacy drafting checkpoint without mutating its snapshot or starting a worker', async () => {
    const f = await fixture()
    const projectId = 'legacy-author-route-project'
    const bootstrap = await f.app.request('/api/projects/bootstrap', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: { id: projectId, name: 'Legacy route', created_at: Date.now() }, projectName: projectId, brief: { idea: 'Legacy route fixture', document_language: 'en', game_user_visible_language: 'en', agent_response_language: 'en', resource_library_usage: 'optional' } }),
    })
    expect(bootstrap.status).toBe(202)
    const result = await bootstrap.json() as { project: { root_path: string }; session: { id: string } }
    const store = createRunStore(result.project.root_path, 'public-author-owner')
    const before = await store.load()
    if (!before) throw new Error('missing run')
    const legacy = { ...before, authorStage: undefined, phase: 'DOCUMENT_DRAFTING' as const, documentStep: 'FOUNDATION_DRAFTING' as const, foundationDraftState: { completedPaths: ['docs/GDD.md' as const] } }
    await store.save(legacy)
    const snapshotBefore = await readFile(join(result.project.root_path, '.beegame/workflow/run.json'), 'utf8')
    const response = await f.app.request(`/api/projects/${projectId}/workflow/resume`, { method: 'POST' })
    expect(response.status).toBe(409)
    expect(f.calls.start).toHaveLength(1)
    expect(f.runnerStarts).toBe(0)
    expect(await readFile(join(result.project.root_path, '.beegame/workflow/run.json'), 'utf8')).toBe(snapshotBefore)
    const restarted = await f.app.request('/api/projects/bootstrap', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: { id: projectId, name: 'Legacy route', created_at: Date.now() }, projectName: projectId, brief: { idea: 'Legacy route fixture', document_language: 'en', game_user_visible_language: 'en', agent_response_language: 'en', resource_library_usage: 'optional' } }),
    })
    expect(restarted.status).toBeGreaterThanOrEqual(400)
    expect(f.calls.start).toHaveLength(1)
    expect(f.runnerStarts).toBe(0)
    expect(await readFile(join(result.project.root_path, '.beegame/workflow/run.json'), 'utf8')).toBe(snapshotBefore)
    await Promise.all(f.cleanups.map(cleanup => cleanup()))
  })

  test('cleanup sends an active public author stop before disposing sessions', async () => {
    const f = await fixture()
    const response = await f.app.request('/api/projects/bootstrap', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        project: { id: 'cleanup-public-author-project', name: 'Cleanup route', created_at: Date.now() },
        projectName: 'cleanup-public-author-project',
        brief: { idea: 'Cleanup fixture', document_language: 'en', game_user_visible_language: 'en', agent_response_language: 'en', resource_library_usage: 'optional' },
      }),
    })
    expect(response.status).toBe(202)
    expect(f.calls.stop).toHaveLength(0)
    await Promise.all(f.cleanups.map(cleanup => cleanup()))
    expect(f.calls.stop).toHaveLength(1)
  })

  test('a lost public start handle remains a pending stop and is never reported as stopped', async () => {
    const f = await fixture()
    const projectId = 'pending-public-author-project'
    const response = await f.app.request('/api/projects/bootstrap', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: { id: projectId, name: 'Pending author route', created_at: Date.now() }, projectName: projectId, brief: { idea: 'Pending fixture', document_language: 'en', game_user_visible_language: 'en', agent_response_language: 'en', resource_library_usage: 'optional' } }),
    })
    expect(response.status).toBe(202)
    const result = await response.json() as { project: { root_path: string } }
    const store = createRunStore(result.project.root_path, 'public-author-owner')
    const current = await store.load()
    if (!current?.authorStage) throw new Error('missing public author stage')
    await store.save({ ...current, authorStage: { ...current.authorStage, status: 'starting', handle: undefined } })
    const stopped = await f.app.request(`/api/projects/${projectId}/workflow/stop`, { method: 'POST' })
    expect(stopped.status).toBe(200)
    expect((await stopped.json() as { status: string }).status).toBe('needs_action')
    expect(f.calls.stop).toHaveLength(0)
    await Promise.all(f.cleanups.map(cleanup => cleanup()))
  })

  test('projects completed public authoring as an eight-document handoff, not reviewer work', async () => {
    const f = await fixture()
    const projectId = 'completed-public-author-project'
    const response = await f.app.request('/api/projects/bootstrap', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        project: { id: projectId, name: 'Completed author route', created_at: Date.now() },
        projectName: projectId,
        brief: { idea: 'Completed fixture', document_language: 'en', game_user_visible_language: 'en', agent_response_language: 'en', resource_library_usage: 'optional' },
      }),
    })
    expect(response.status).toBe(202)
    const result = await response.json() as { project: { root_path: string } }
    const store = createRunStore(result.project.root_path, 'public-author-owner')
    const current = await store.load()
    if (!current?.authorStage?.handle) throw new Error('missing public author stage')
    const digest = 'a'.repeat(64)
    await store.save({
      ...current,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      status: 'needs_action',
      currentMessage: 'Foundation documents are complete. Reviewer handoff is awaiting stage acceptance.',
      authorStage: {
        ...current.authorStage,
        status: 'completed',
        result: {
          protocolVersion: 1,
          producer: 'foundation-authoring',
          kind: 'foundation_documents',
          resultId: digest,
          inputDigest: current.authorStage.inputDigest,
          ownerId: 'public-author-owner',
          projectId,
          confirmedBriefDigest: current.confirmedBriefDigest,
          documents: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, digest, byteLength: 1, artifactPath: `.beegame/workflow/foundation-authoring/artifacts/${digest}/${path}` })),
          documentRevision: digest,
          workspaceRevision: digest,
          receiptSetDigest: digest,
        },
      },
    })
    const workflow = await f.app.request(`/api/projects/${projectId}/workflow`)
    expect(workflow.status).toBe(200)
    const view = await workflow.json() as { workflow: { tasks: unknown[]; totalTaskCount: number; messageKey: string; block?: { code?: string; nextAction?: string } } }
    expect(view.workflow.tasks).toHaveLength(8)
    expect(view.workflow.totalTaskCount).toBe(8)
    expect(view.workflow.messageKey).toBe('workflow.documentReview')
    expect(view.workflow.block?.code).toBe('public_author_handoff')
    expect(view.workflow.block?.nextAction).toBeUndefined()
    const completed = await store.load()
    if (!completed?.authorStage) throw new Error('missing completed author checkpoint')
    await store.save({ ...completed, status: 'stopped', phase: 'DOCUMENT_DRAFTING', documentStep: 'FOUNDATION_DRAFTING',
      authorStage: { ...completed.authorStage, control: { ...completed.authorStage.control, action: 'stop' } } })
    const pausedResponse = await f.app.request(`/api/projects/${projectId}/workflow`)
    const paused = await pausedResponse.json() as { workflow: { nextAction?: string } }
    expect(paused.workflow.nextAction).toBe('resume')
    await Promise.all(f.cleanups.map(cleanup => cleanup()))
  })
})
