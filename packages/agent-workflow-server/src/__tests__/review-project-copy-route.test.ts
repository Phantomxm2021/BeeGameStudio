import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { createAgentWorkflowApp } from '../app'
import type { FoundationAuthoringHost } from '../beegame/foundation-authoring-host'
import type { FoundationReviewerHost } from '../beegame/foundation-reviewer-host'
import type { BeeGameSessionRunner } from '../beegame/session-manager'
import { publishProjectArtifacts } from '../beegame/project-artifact-store'
import { createRunStore } from '../beegame/delivery-workflow/run-store'
import type { DeliveryRun } from '../beegame/delivery-workflow/types'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../beegame/delivery-workflow/types'
import type { AuthorDocumentsResult } from '../beegame/stage-modules/foundation-authoring/public'
import type { ReviewerHandle, ReviewerResult } from '../beegame/stage-modules/foundation-reviewer/public'
import { createTestDeliveryRun } from './delivery-workflow-test-helpers'

const roots: string[] = []
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

function artifactDocument(path: string, content: string) {
  return {
    path,
    content,
    digest: digest(content),
    byteLength: Buffer.byteLength(content),
  }
}

function readStoredZipEntries(data: Uint8Array): Map<string, string> {
  const entries = new Map<string, string>()
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const decoder = new TextDecoder()
  let offset = 0
  while (offset + 30 <= data.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const byteLength = view.getUint32(offset + 18, true)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const name = decoder.decode(data.subarray(nameStart, nameStart + nameLength))
    entries.set(name, decoder.decode(data.subarray(dataStart, dataStart + byteLength)))
    offset = dataStart + byteLength
  }
  return entries
}

type Fixture = {
  app: ReturnType<typeof createAgentWorkflowApp>
  ownerId: string
  projectId: string
  sourceWorkspace: string
  sourceResult: AuthorDocumentsResult
  authorStarts: () => number
  reviewerStarts: unknown[]
  reviewerStops: unknown[]
  reviewerResumes: unknown[]
  cleanups: Array<() => void | Promise<void>>
}

function fakeAuthor(onStart: () => void): FoundationAuthoringHost {
  const forbidden = async (): Promise<never> => {
    onStart()
    throw new Error('legacy Author must not run for a review copy')
  }
  return { start: forbidden, resume: forbidden, stop: forbidden, getResult: forbidden }
}

function fakeReviewer(calls: { starts: unknown[]; stops: unknown[]; resumes: unknown[] }, failStart = false): FoundationReviewerHost {
  let handle: ReviewerHandle | undefined
  const running = (): ReviewerResult => ({ status: 'running', handle: handle!, billingStatus: 'settled' })
  return {
    start: async input => {
      calls.starts.push(input)
      if (failStart) throw new Error('ambiguous public Reviewer start')
      handle = { protocolVersion: 1, producer: 'foundation-reviewer', id: randomUUID() }
      return handle
    },
    getResult: async () => running(),
    stop: async input => {
      calls.stops.push(input)
      return { status: 'stopped', handle: handle!, billingStatus: 'settled' }
    },
    resume: async input => {
      calls.resumes.push(input)
      return running()
    },
  }
}

async function fixture(options: { failReviewerStart?: boolean; projectId?: string } = {}): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'beegame-review-copy-route-'))
  roots.push(root)
  const projectsRoot = join(root, 'projects')
  const ownerId = 'review-copy-owner'
  const projectId = options.projectId ?? 'source-project'
  const sourceWorkspace = join(projectsRoot, 'users', ownerId, projectId)
  const confirmedBriefContext = 'The durable confirmed source brief.'
  const confirmedBriefDigest = digest(confirmedBriefContext)
  const resultId = 'a'.repeat(64)
  const inputDigest = 'b'.repeat(64)
  const artifactRoot = `.beegame/workflow/foundation-authoring/artifacts/${resultId}`
  const documents: AuthorDocumentsResult['documents'] = []
  for (const [index, path] of CANONICAL_FOUNDATION_DOCUMENTS.entries()) {
    const content = `# Frozen exported document ${index}\\n\\nsource-${index}\\n`
    const artifactPath = `${artifactRoot}/${path}`
    const absolute = join(sourceWorkspace, artifactPath)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, content, 'utf8')
    documents.push({ path, artifactPath, digest: digest(content), byteLength: Buffer.byteLength(content) })
  }
  const sourceResult: AuthorDocumentsResult = {
    protocolVersion: 1, producer: 'foundation-authoring', kind: 'foundation_documents', resultId,
    inputDigest, ownerId, projectId, confirmedBriefDigest, documents,
    documentRevision: 'c'.repeat(64), workspaceRevision: 'd'.repeat(64), receiptSetDigest: 'e'.repeat(64),
  }
  const base = createTestDeliveryRun({ ownerId, projectId, confirmedBriefContext, foundationDraftComplete: false })
  const sourceRun: DeliveryRun = {
    ...base,
    phase: 'DOCUMENT_REVIEW', documentStep: 'FOUNDATION_REVIEW', status: 'needs_action',
    foundationDraftState: { completedPaths: [] },
    authorStage: {
      protocolVersion: 1, requestId: 'author-request-source', inputDigest,
      handle: { protocolVersion: 1, producer: 'foundation-authoring', id: randomUUID() },
      status: 'completed', result: sourceResult,
      control: { sequence: 0, action: 'run', requestId: 'author-request-source' },
    },
  }
  await mkdir(sourceWorkspace, { recursive: true })
  await createRunStore(sourceWorkspace, ownerId).save(sourceRun)
  const sourceSnapshotPath = join(sourceWorkspace, '.beegame/workflow/run.json')
  const archivedSourceSnapshot = JSON.parse(await readFile(sourceSnapshotPath, 'utf8')) as Record<string, unknown>
  archivedSourceSnapshot.schemaVersion = 50
  await writeFile(sourceSnapshotPath, JSON.stringify(archivedSourceSnapshot), 'utf8')

  const reviewerStarts: unknown[] = []
  const reviewerStops: unknown[] = []
  const reviewerResumes: unknown[] = []
  const reviewer = fakeReviewer({ starts: reviewerStarts, stops: reviewerStops, resumes: reviewerResumes }, options.failReviewerStart)
  let authorStartCount = 0
  const cleanups: Array<() => void | Promise<void>> = []
  const runner: BeeGameSessionRunner = { start: async () => { throw new Error('legacy worker must not run for a review copy') } }
  const app = createAgentWorkflowApp({
    currentUser: { id: ownerId, role: 'owner' }, dashboardDataRoot: join(root, 'dashboard'),
    defaultWorkspacePath: projectsRoot, modelConfigStore: false, skillsConfig: false, sessionRunner: runner,
    registerCleanup: cleanup => cleanups.push(cleanup),
  })
  const created = await app.request('/api/projects', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: projectId, name: 'Source project', root_path: sourceWorkspace, created_at: Date.now() }),
  })
  expect(created.status).toBe(200)
  const modelConfig = await app.request('/api/model-configs', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Review copy model', provider: 'openai-compatible', apiKey: 'test-api-key',
      models: { fast: 'test-fast-model', balanced: 'test-model' }, isDefault: true,
    }),
  })
  expect(modelConfig.status).toBe(200)
  return { app, ownerId, projectId, sourceWorkspace, sourceResult, authorStarts: () => authorStartCount,
    reviewerStarts, reviewerStops, reviewerResumes, cleanups }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('removed delivery-workflow routes', () => {
  test('does not create a workflow review copy and preserves the source archive', async () => {
    const f = await fixture()
    const sourceBefore = await readFile(join(f.sourceWorkspace, '.beegame/workflow/run.json'), 'utf8')
    const response = await f.app.request(`/api/projects/${f.projectId}/review-copy`, { method: 'POST' })
    expect(response.status).toBe(404)
    const projects = await (await f.app.request('/api/projects')).json() as Array<{ id: string }>
    expect(projects.map(project => project.id)).toEqual([f.projectId])
    expect(f.reviewerStarts).toHaveLength(0)
    expect(f.authorStarts()).toBe(0)
    expect(await readFile(join(f.sourceWorkspace, '.beegame/workflow/run.json'), 'utf8')).toBe(sourceBefore)
    await Promise.all(f.cleanups.map(cleanup => cleanup()))
  })

  test('resume and retry URLs are absent and cannot launch old workers', async () => {
    const f = await fixture()
    for (const action of ['resume', 'retry']) {
      const response = await f.app.request(`/api/projects/${f.projectId}/workflow/${action}`, { method: 'POST' })
      expect(response.status).toBe(404)
    }
    expect(f.reviewerStarts).toHaveLength(0)
    expect(f.reviewerResumes).toHaveLength(0)
    expect(f.authorStarts()).toBe(0)
    await Promise.all(f.cleanups.map(cleanup => cleanup()))
  })

  test('workflow projections are retired without mutating archived snapshots', async () => {
    const f = await fixture()
    const legacySnapshot = JSON.stringify({ schemaVersion: 1, confirmedBriefContext: 'legacy only' })
    await writeFile(join(f.sourceWorkspace, '.beegame/workflow/run.json'), legacySnapshot, 'utf8')
    const response = await f.app.request(`/api/projects/${f.projectId}/review-copy`, { method: 'POST' })
    expect(response.status).toBe(404)
    const projection = await f.app.request(`/api/projects/${f.projectId}/workflow`)
    expect(projection.status).toBe(404)
    const projects = await (await f.app.request('/api/projects')).json() as Array<{ id: string }>
    expect(projects.map(project => project.id)).toEqual([f.projectId])
    expect(f.reviewerStarts).toHaveLength(0)
    expect(f.authorStarts()).toBe(0)
    expect(await readFile(join(f.sourceWorkspace, '.beegame/workflow/run.json'), 'utf8')).toBe(legacySnapshot)
    await Promise.all(f.cleanups.map(cleanup => cleanup()))
  })

  test('runtime acceptance ignores a legacy completed run and leaves it archived', async () => {
    const f = await fixture()
    const snapshotPath = join(f.sourceWorkspace, '.beegame/workflow/run.json')
    const before = JSON.stringify({ phase: 'DELIVERY', status: 'completed', acceptance: { status: 'passed' } })
    await mkdir(dirname(snapshotPath), { recursive: true })
    await writeFile(snapshotPath, before)

    const response = await f.app.request(`/api/projects/${f.projectId}/runtime-state`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      acceptance: { status: 'not_run' },
    })
    expect(await readFile(snapshotPath, 'utf8')).toBe(before)
    await Promise.all(f.cleanups.map(cleanup => cleanup()))
  })

  test('legacy game-content endpoints require the native project delivery record', async () => {
    const f = await fixture()
    const snapshotPath = join(f.sourceWorkspace, '.beegame/workflow/run.json')
    const snapshotBefore = JSON.stringify({ phase: 'CONTENT', status: 'running', revision: {} })
    await mkdir(dirname(snapshotPath), { recursive: true })
    await writeFile(snapshotPath, snapshotBefore)

    const read = await f.app.request(`/api/projects/${f.projectId}/game-content?metadata=1`)
    expect(read.status).toBe(409)
    expect(await read.json()).toMatchObject({ code: 'project_delivery_required' })

    const edit = await f.app.request(`/api/projects/${f.projectId}/game-content/document`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'content/index.json', expectedRevision: 'a'.repeat(64), document: {} }),
    })
    expect(edit.status).toBe(409)

    const publish = await f.app.request(`/api/projects/${f.projectId}/game-content/publish`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentRevision: 'a'.repeat(64) }),
    })
    expect(publish.status).toBe(409)
    expect(await readFile(snapshotPath, 'utf8')).toBe(snapshotBefore)
    await Promise.all(f.cleanups.map(cleanup => cleanup()))
  })

  test('does not invoke workflow authoring or reviewer when old data is present', async () => {
    const f = await fixture({ failReviewerStart: true })
    const sourceBefore = await readFile(join(f.sourceWorkspace, '.beegame/workflow/run.json'), 'utf8')
    const response = await f.app.request(`/api/projects/${f.projectId}/review-copy`, { method: 'POST' })
    expect(response.status).toBe(404)
    expect(f.reviewerStarts).toHaveLength(0)
    expect(f.authorStarts()).toBe(0)
    const projects = await (await f.app.request('/api/projects')).json() as Array<{ id: string; root_path: string }>
    expect(projects).toHaveLength(1)
    expect(await readFile(join(f.sourceWorkspace, '.beegame/workflow/run.json'), 'utf8')).toBe(sourceBefore)
    await Promise.all(f.cleanups.map(cleanup => cleanup()))
  })
})

describe('GET /api/projects/:projectId/artifacts', () => {
  async function expectArtifactRoutesRejected(f: Fixture): Promise<void> {
    const singular = await f.app.request(
      `/api/projects/${f.projectId}/artifacts?path=${encodeURIComponent('docs/GDD.md')}`,
    )
    expect(singular.status).toBe(404)
    const index = await f.app.request(`/api/projects/${f.projectId}/artifact-index`)
    expect(index.status).toBe(404)
    const packaged = await f.app.request(`/api/projects/${f.projectId}/package`)
    expect(packaged.status).toBe(404)
  }

  test('rejects a project root outside the authenticated owner root on every artifact route', async () => {
    const f = await fixture({ projectId: randomUUID() })
    const projectsRoot = dirname(dirname(dirname(f.sourceWorkspace)))
    const foreignRoot = join(projectsRoot, 'users', 'foreign-owner', 'foreign-project')
    await mkdir(join(foreignRoot, 'docs'), { recursive: true })
    await writeFile(join(foreignRoot, 'docs/GDD.md'), '# foreign secret\n', 'utf8')
    const updated = await f.app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: f.projectId,
        name: 'Foreign root project',
        root_path: foreignRoot,
        created_at: Date.now(),
      }),
    })
    expect(updated.status).toBe(200)
    await expectArtifactRoutesRejected(f)
  })

  test('rejects a symlinked project root that escapes the authenticated owner root', async () => {
    const f = await fixture({ projectId: randomUUID() })
    const projectsRoot = dirname(dirname(dirname(f.sourceWorkspace)))
    const foreignRoot = join(projectsRoot, 'users', 'foreign-owner', 'foreign-project')
    const symlinkRoot = join(dirname(f.sourceWorkspace), 'linked-project')
    await mkdir(foreignRoot, { recursive: true })
    await symlink(foreignRoot, symlinkRoot)
    const updated = await f.app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: f.projectId,
        name: 'Symlink root project',
        root_path: symlinkRoot,
        created_at: Date.now(),
      }),
    })
    expect(updated.status).toBe(200)
    await expectArtifactRoutesRejected(f)
  })

  test('rejects an owner root itself instead of treating it as a project workspace', async () => {
    const f = await fixture({ projectId: randomUUID() })
    const ownerRoot = dirname(f.sourceWorkspace)
    const updated = await f.app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: f.projectId,
        name: 'Owner root project',
        root_path: ownerRoot,
        created_at: Date.now(),
      }),
    })
    expect(updated.status).toBe(200)
    await expectArtifactRoutesRejected(f)
  })

  test('reads canonical files even when an application snapshot has a foreign identity', async () => {
    const f = await fixture({ projectId: randomUUID() })
    await mkdir(join(f.sourceWorkspace, 'docs'), { recursive: true })
    const canonical = '# canonical\n'
    await writeFile(join(f.sourceWorkspace, 'docs/GDD.md'), canonical, 'utf8')
    await publishProjectArtifacts({
      workspacePath: f.sourceWorkspace,
      ownerId: 'foreign-owner',
      projectId: f.projectId,
      publicationId: 'foreign-publication',
      documents: [artifactDocument('docs/GDD.md', '# foreign snapshot\n')],
    })
    await writeFile(join(f.sourceWorkspace, 'docs/GDD.md'), canonical, 'utf8')
    const response = await f.app.request(
      `/api/projects/${f.projectId}/artifacts?path=${encodeURIComponent('docs/GDD.md')}`,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ path: 'docs/GDD.md', content: canonical })
  })

  test('serves the canonical file when it differs from the current application snapshot', async () => {
    const f = await fixture({ projectId: randomUUID() })
    const path = 'docs/GDD.md'
    const canonical = '# canonical initial\n'
    const current = '# current application snapshot\n'
    await mkdir(join(f.sourceWorkspace, 'docs'), { recursive: true })
    await writeFile(join(f.sourceWorkspace, path), canonical, 'utf8')

    const initialResponse = await f.app.request(
      `/api/projects/${f.projectId}/artifacts?path=${encodeURIComponent(path)}`,
    )
    expect(initialResponse.status).toBe(200)
    expect(await initialResponse.json()).toEqual({ path, content: canonical })

    await publishProjectArtifacts({
      workspacePath: f.sourceWorkspace,
      ownerId: f.ownerId,
      projectId: f.projectId,
      publicationId: 'publication-current',
      documents: [
        artifactDocument(path, current),
        artifactDocument('docs/snapshot-only.md', '# snapshot only\n'),
      ],
    })

    // Publishing materializes the snapshot once, but later canonical edits are
    // authoritative for reads, indexing, and packaging.
    await writeFile(join(f.sourceWorkspace, path), canonical, 'utf8')
    await rm(join(f.sourceWorkspace, 'docs/snapshot-only.md'), { force: true })
    const response = await f.app.request(
      `/api/projects/${f.projectId}/artifacts?path=${encodeURIComponent(path)}`,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ path, content: canonical })

    const indexResponse = await f.app.request(
      `/api/projects/${f.projectId}/artifact-index`,
    )
    expect(indexResponse.status).toBe(200)
    const index = await indexResponse.json() as {
      sessionId?: string
      workspacePath: string
      artifacts: Array<{ path: string }>
    }
    expect(index.sessionId).toBeUndefined()
    expect(index.workspacePath).toBe(await realpath(f.sourceWorkspace))
    expect(index.artifacts.some(artifact => artifact.path === path)).toBe(true)
    expect(index.artifacts.some(artifact => artifact.path === 'docs/snapshot-only.md')).toBe(false)

    const packageResponse = await f.app.request(
      `/api/projects/${f.projectId}/package`,
    )
    expect(packageResponse.status).toBe(200)
    const packageEntries = readStoredZipEntries(
      new Uint8Array(await packageResponse.arrayBuffer()),
    )
    expect(packageEntries.get(path)).toBe(canonical)
    expect(packageEntries.has('docs/snapshot-only.md')).toBe(false)
    expect([...packageEntries.keys()].some(entry => entry.startsWith('.beegame/artifacts/'))).toBe(false)
  })

  test('reads a canonical file even when a current snapshot omits the path', async () => {
    const f = await fixture({ projectId: randomUUID() })
    const path = 'docs/GDD.md'
    const canonical = '# canonical initial\n'
    await mkdir(join(f.sourceWorkspace, 'docs'), { recursive: true })
    await writeFile(join(f.sourceWorkspace, path), canonical, 'utf8')
    await publishProjectArtifacts({
      workspacePath: f.sourceWorkspace,
      ownerId: f.ownerId,
      projectId: f.projectId,
      publicationId: 'publication-without-gdd',
      documents: [artifactDocument('docs/OTHER.md', '# other\n')],
    })

    const response = await f.app.request(
      `/api/projects/${f.projectId}/artifacts?path=${encodeURIComponent(path)}`,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ path, content: canonical })
  })

  test('continues reading canonical files when the current snapshot is corrupt', async () => {
    const f = await fixture({ projectId: randomUUID() })
    const path = 'docs/GDD.md'
    const canonical = '# canonical initial\n'
    await mkdir(join(f.sourceWorkspace, 'docs'), { recursive: true })
    await writeFile(join(f.sourceWorkspace, path), canonical, 'utf8')
    await publishProjectArtifacts({
      workspacePath: f.sourceWorkspace,
      ownerId: f.ownerId,
      projectId: f.projectId,
      publicationId: 'publication-corrupt',
      documents: [artifactDocument(path, '# current\n')],
    })
    await writeFile(join(f.sourceWorkspace, path), canonical, 'utf8')
    const currentPath = join(f.sourceWorkspace, '.beegame', 'artifacts', 'current.json')
    const pointer = JSON.parse(await readFile(currentPath, 'utf8')) as Record<string, unknown>
    await writeFile(currentPath, JSON.stringify({ ...pointer, snapshotDigest: '0'.repeat(64) }), 'utf8')

    const response = await f.app.request(
      `/api/projects/${f.projectId}/artifacts?path=${encodeURIComponent(path)}`,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ path, content: canonical })
  })

  test('fails closed while a publication transaction is pending', async () => {
    const f = await fixture({ projectId: randomUUID() })
    const path = 'docs/GDD.md'
    await mkdir(join(f.sourceWorkspace, 'docs'), { recursive: true })
    await writeFile(join(f.sourceWorkspace, path), '# canonical\n', 'utf8')
    const pendingDirectory = join(f.sourceWorkspace, '.beegame', 'artifacts', 'pending')
    await mkdir(pendingDirectory, { recursive: true })
    await writeFile(join(pendingDirectory, 'race.json'), '{}', 'utf8')

    const singular = await f.app.request(
      `/api/projects/${f.projectId}/artifacts?path=${encodeURIComponent(path)}`,
    )
    expect(singular.status).toBe(404)
    const index = await f.app.request(`/api/projects/${f.projectId}/artifact-index`)
    expect(index.status).toBe(404)
    const packaged = await f.app.request(`/api/projects/${f.projectId}/package`)
    expect(packaged.status).toBe(404)
  })
})
