import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { readContentView } from './content-view'
import { registerV3Routes } from './routes'
import { createRun, type Run } from './state'
import { BeeGameSessionManager } from '../session-manager'
import { uiLayoutFixture, sceneLayoutFixture } from '../fixtures/layout-fixture'
import { contentDocumentSchema } from '../game-content-schema'

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'v3-source-view-')))
  await mkdir(join(root, 'content/ui'), { recursive: true })
  await mkdir(join(root, 'content/scenes'), { recursive: true })
  const ui = contentDocumentSchema.parse(uiLayoutFixture()), scene = contentDocumentSchema.parse(sceneLayoutFixture())
  const index = { schema: 'beegame-content-package.v2', id: 'fixture', dimension: '2d',
    documentRevision: 'a'.repeat(64), assetManifestRevision: 'b'.repeat(64), entryScene: scene.id, sceneModel: 'game-object-v2',
    files: ['scenes/level.json', 'ui/menu.json'], documents: [
      { path: 'scenes/level.json', id: scene.id, kind: scene.kind, loadPhase: 'startup' },
      { path: 'ui/menu.json', id: ui.id, kind: ui.kind, loadPhase: 'on-demand' },
    ] }
  await writeFile(join(root, 'content/index.json'), JSON.stringify(index))
  await writeFile(join(root, 'content/scenes/level.json'), JSON.stringify(scene))
  await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(ui))
  return { root, index, ui, scene }
}

test('actual registered JSON can be viewed without eight docs/assets or accepting the game; metadata and views use same bytes', async () => {
  const { root, ui, scene } = await fixture()
  try {
    const before = await readFile(join(root, 'content/index.json'))
    const full = await readContentView(root), metadata = await readContentView(root, true)
    if (full.state !== 'draft' || metadata.state !== 'draft') throw Error('Synthetic saved source must be available')
    expect(full.state).toBe('draft'); expect(full.readOnly).toBe(true)
    expect(full.note).toContain('not game acceptance')
    expect(full).not.toHaveProperty('acceptedContentRevision')
    expect(full.documents?.map(d => 'document' in d ? d.document : undefined)).toEqual([scene, ui])
    expect(metadata.documents?.[0]).toMatchObject({ path: 'scenes/level.json', id: scene.id, kind: scene.kind })
    expect(metadata.documents?.[0]).not.toHaveProperty('document')
    expect(metadata.sourceVersions).toEqual(full.sourceVersions)
    expect(await readFile(join(root, 'content/index.json'))).toEqual(before)
    await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify({ ...ui, id: 'new-id' }))
    await expect(readContentView(root)).rejects.toThrow('Registry identity')
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('missing or invalid indexes do not hide safe source files, while strict reads stay strict', async () => {
  const { root, index } = await fixture()
  try {
    for (const raw of ['{', JSON.stringify({ ...index, documents: [] }), JSON.stringify({ ...index, files: ['scenes/level.json'] }),
      JSON.stringify({ ...index, documentRevision: 'pending', assetManifestRevision: 'pending', entryScene: undefined, sceneModel: undefined })]) {
      await writeFile(join(root, 'content/index.json'), raw)
      await expect(readContentView(root)).rejects.toThrow()
      const list = await readContentView(root, true)
      expect(list).toMatchObject({ state: 'draft', index: undefined, readOnly: true })
      if (list.state !== 'draft') throw Error('Source list must remain available')
      expect(list.documents).toHaveLength(2)
      expect(list.indexIssues.join(' ')).toContain('content/index.json')
      expect(await readFile(join(root, 'content/index.json'), 'utf8')).toBe(raw)
    }
    await rm(join(root, 'content/index.json'))
    expect(await readContentView(root)).toMatchObject({ state: 'awaiting_content', readOnly: true })
    const missing = await readContentView(root, true)
    expect(missing).toMatchObject({ state: 'draft', index: undefined })
    if (missing.state === 'draft') expect(missing.documents).toHaveLength(2)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('file metadata retains healthy Scene/UI entries and identifies an invalid responsive layout without rewriting it', async () => {
  const { root, index, ui, scene } = await fixture()
  try {
    const healthyUi = { ...ui, id: 'healthy-ui' }
    index.files.push('ui/healthy.json')
    index.documents.push({ path: 'ui/healthy.json', id: healthyUi.id, kind: healthyUi.kind, loadPhase: 'on-demand' })
    await writeFile(join(root, 'content/index.json'), JSON.stringify(index))
    await writeFile(join(root, 'content/ui/healthy.json'), JSON.stringify(healthyUi))
    const invalid = structuredClone(ui) as any
    invalid.data.nodes[1].responsive = { compact: { layout: { gap: 4 } } }
    const bytes = JSON.stringify(invalid)
    await writeFile(join(root, 'content/ui/menu.json'), bytes)
    const list = await readContentView(root, true)
    if (list.state !== 'draft') throw Error('Registry must remain visible')
    expect(list.documents).toHaveLength(3)
    expect(list.documents[0]).toMatchObject({ path: 'scenes/level.json', id: scene.id, kind: scene.kind })
    expect(list.documents[0]).not.toHaveProperty('error')
    expect(list.documents[1]).toMatchObject({ path: 'ui/menu.json', id: ui.id, kind: ui.kind,
      error: 'data.nodes.1.responsive.compact.layout: Unrecognized key: "gap"' })
    expect(list.documents[1]!.revision).toMatch(/^[a-f0-9]{64}$/)
    expect(list.documents[2]).toMatchObject({ path: 'ui/healthy.json', id: healthyUi.id, kind: healthyUi.kind })
    expect(list.documents[2]).not.toHaveProperty('error')
    expect(list.documents.every(d => !('document' in d))).toBe(true)
    await expect(readContentView(root)).rejects.toThrow('gap')
    expect(await readFile(join(root, 'content/ui/menu.json'), 'utf8')).toBe(bytes)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test.each(['json', 'missing', 'identity'] as const)('a single %s failure remains on its registered file instead of hiding its siblings', async fault => {
  const { root, scene } = await fixture()
  try {
    const path = join(root, 'content/scenes/level.json')
    if (fault === 'missing') await rm(path)
    else await writeFile(path, fault === 'json' ? '{invalid' : JSON.stringify({ ...scene, id: 'wrong-id' }))
    const list = await readContentView(root, true)
    if (list.state !== 'draft') throw Error('Registry must remain visible')
    expect(list.documents).toHaveLength(2)
    expect(list.documents[0]).toMatchObject({ path: 'scenes/level.json', id: scene.id, kind: scene.kind,
      error: expect.stringContaining(fault === 'missing' ? 'ENOENT' : fault === 'identity' ? 'Registry identity' : 'JSON') })
    expect(list.documents[0]!.revision).toEqual(fault === 'missing' ? undefined : expect.stringMatching(/^[a-f0-9]{64}$/))
    expect(list.documents[1]).not.toHaveProperty('error')
    await expect(readContentView(root)).rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('content path traversal, index aliases and symlinks never expose project/host files', async () => {
  const { root, index } = await fixture()
  const outside = await mkdtemp(join(tmpdir(), 'v3-view-outside-'))
  try {
    for (const path of ['../secret.json', '/secret.json', 'ui/../menu.json', 'index.json', 'ui\\menu.json', 'ui//menu.json']) {
      const changed = structuredClone(index)
      changed.files[1] = path; changed.documents[1]!.path = path
      await writeFile(join(root, 'content/index.json'), JSON.stringify(changed))
      await expect(readContentView(root)).rejects.toThrow()
      if (path === 'index.json') {
        const list = await readContentView(root, true)
        expect(list).toMatchObject({ state: 'draft', index: undefined })
        if (list.state === 'draft') expect(list.documents.map(d => d.path)).toEqual(['scenes/level.json', 'ui/menu.json'])
      }
      else {
        const list = await readContentView(root, true)
        if (list.state !== 'draft') throw Error('Safe registry entries must remain visible')
        expect(list.documents[0]).not.toHaveProperty('error')
        expect(list.documents[1]).toMatchObject({ path, error: expect.stringContaining('Registered JSON must be inside content/') })
        expect(list.documents[1]!.revision).toBeUndefined()
        expect(list.documents[1]).not.toHaveProperty('document')
      }
    }
    await writeFile(join(root, 'content/index.json'), JSON.stringify(index))
    await writeFile(join(outside, 'secret.json'), JSON.stringify(uiLayoutFixture()))
    await rm(join(root, 'content/ui/menu.json'))
    await symlink(join(outside, 'secret.json'), join(root, 'content/ui/menu.json'))
    await expect(readContentView(root)).rejects.toThrow('symlinks')
    const list = await readContentView(root, true)
    if (list.state !== 'draft') throw Error('Safe registry entries must remain visible')
    expect(list.documents[0]).not.toHaveProperty('error')
    expect(list.documents[1]).toMatchObject({ path: 'ui/menu.json', error: expect.stringContaining('symlinks') })
    expect(list.documents[1]!.revision).toBeUndefined()
    expect(JSON.stringify(list)).not.toContain(outside)
    await rm(join(root, 'content/ui'), { recursive: true, force: true })
    await symlink(outside, join(root, 'content/ui'))
    await expect(readContentView(root)).rejects.toThrow('symlinks')
    await writeFile(join(root, 'content/index.json'), '{invalid')
    const discovered = await readContentView(root, true)
    if (discovered.state !== 'draft') throw Error('Source list must remain available')
    expect(discovered.documents.map(d => d.path)).toEqual(['scenes/level.json'])
    expect(discovered.indexIssues.join(' ')).toContain('symlinks')
    expect(JSON.stringify(discovered)).not.toContain(outside)
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }) }
})
test('V3 source route reads stable saved files during a writer but keeps editing locked', async () => {
  const { root } = await fixture()
  let starts = 0, writes = 0, reads = 0, mode = 'v3', actor = 'owner', changeOnRead = false, changeFileOnRead = false
  let run: Run | undefined = createRun({ projectId: 'p', ownerId: 'owner', workspacePath: root, chatSessionId: 'chat', requestKey: 'r', text: 'Source view', constraints: {}, ids: ['req.view'] })
  const sessions = new BeeGameSessionManager({ async start() { starts++; throw Error('No native run allowed') } }, root, async () => ({}), {}, true)
  const app = new Hono()
  const routes = registerV3Routes(app, { store: { async read() { reads++;
    if (changeFileOnRead && reads % 3 === 0) await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify({ ...uiLayoutFixture(), id: 'changed' }))
    if (changeOnRead && reads % 3 === 0 && run) return { ...run, version: run.version + 1 }
    return run }, async commit() { writes++ } },
    sessions, getUser: () => ({ id: actor, role: 'owner' }), getProject: async (_req, user) => user.id === 'owner' ? ({ id: 'p', name: 'Synthetic', root_path: root, created_at: 0,
      runtime_snapshot: mode === 'v3' ? { workflow_protocol: 'bgs.workflow.v3' } : undefined } as any) : undefined,
    getAuthToken: () => undefined, getValidAuthToken: () => undefined, assertNoLegacyRun: async () => {}, persistMode: async () => {}, readBody: r => r.json() })
  app.get('/view', async c => { try { return c.json(await routes.contentView(c.req.raw, 'p', false) ?? { legacy: true }) }
    catch (e: any) { return c.json({ code: e.code }, e.status ?? 500) } })
  app.get('/metadata', async c => { try { return c.json(await routes.contentView(c.req.raw, 'p', true) ?? { legacy: true }) }
    catch (e: any) { return c.json({ code: e.code }, e.status ?? 500) } })
  try {
    expect((await app.request('/view')).status).toBe(200)
    // Autonomous saves use direct project authorization, not fabricated Tasks.
    run!.agentTurns = []
    const nativeView = await (await app.request('/view')).json()
    expect(nativeView.state).toBe('draft')
    expect(nativeView.readOnly).toBe(false)
    expect(nativeView.documents.map((d: {path:string}) => d.path)).toEqual(['scenes/level.json','ui/menu.json'])
    expect(nativeView.editing).toMatchObject({version:run!.version,planRevision:0,paths:['scenes/level.json','ui/menu.json']})
    run!.paused={at:new Date().toISOString()}
    expect((await (await app.request('/view')).json()).readOnly).toBe(true)
    delete run!.paused
    run = { ...run!, writer: { taskId: 't', attemptId: 'a', sessionId: 's', workerId: 'w', fence: 1, planRevision: 1 } } as Run
    const writerView = await (await app.request('/view')).json()
    expect(writerView.state).toBe('draft')
    expect(writerView.readOnly).toBe(true)
    expect(writerView.documents).toHaveLength(2)
    expect(writerView).not.toHaveProperty('editing')
    const fileList = await (await app.request('/metadata')).json()
    expect(fileList.readOnly).toBe(true)
    expect(fileList.documents.map((d: { path: string }) => d.path)).toEqual(['scenes/level.json', 'ui/menu.json'])
    expect(fileList.documents[0]).not.toHaveProperty('document')
    const invalid = uiLayoutFixture() as any
    invalid.data.nodes[1].responsive = { compact: { layout: { gap: 4 } } }
    await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(invalid))
    const partialResponse = await app.request('/metadata')
    expect(partialResponse.status).toBe(200)
    const partial = await partialResponse.json()
    expect(partial.readOnly).toBe(true)
    expect(partial).not.toHaveProperty('editing')
    expect(partial.documents[0]).not.toHaveProperty('error')
    expect(partial.documents[1]).toMatchObject({ path: 'ui/menu.json', error: expect.stringContaining('gap') })
    delete run.writer
    expect((await (await app.request('/metadata')).json()).editing.paths).toEqual(['scenes/level.json'])
    const indexBytes = await readFile(join(root, 'content/index.json'))
    await writeFile(join(root, 'content/index.json'), '{invalid')
    const discovered = await (await app.request('/metadata')).json()
    expect(discovered.readOnly).toBe(true)
    expect(discovered).not.toHaveProperty('editing')
    expect(discovered.indexIssues.join(' ')).toContain('content/index.json')
    expect(discovered.documents).toHaveLength(2)
    expect((await app.request('/view')).status).not.toBe(200)
    await writeFile(join(root, 'content/index.json'), indexBytes)
    await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(uiLayoutFixture()))
    changeOnRead = true; reads = 0
    const advancedRunView = await (await app.request('/view')).json()
    expect(advancedRunView.state).toBe('draft')
    expect(advancedRunView.readOnly).toBe(true)
    expect(advancedRunView).not.toHaveProperty('editing')
    changeOnRead = false; changeFileOnRead = true; reads = 0
    expect((await app.request('/view')).status).toBe(409)
    changeFileOnRead = false
    changeOnRead = false; actor = 'other'
    expect((await app.request('/view')).status).toBe(404)
    actor = 'owner'; run = undefined
    expect((await app.request('/view')).status).toBe(404)
    mode = 'legacy'
    expect(await (await app.request('/view')).json()).toEqual({ legacy: true })
    expect(starts).toBe(0); expect(writes).toBe(0)
  } finally { await sessions.dispose(); await rm(root, { recursive: true, force: true }) }
})
