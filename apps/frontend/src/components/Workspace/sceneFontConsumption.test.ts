import { afterEach, expect, test, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { editorDocumentToSceneContent, sceneContentToEditorDocument } from './sceneContentAdapter'
import { contentDraftStructureIssues, contentBindingIssues, validateContentDocument } from '../../../../../packages/agent-workflow-server/src/beegame/game-content-package'
import { parseBeeGameContentDocument } from '../../../../../packages/agent-workflow-server/src/beegame/game-content-schema'
import { createProductionUiSurface, loadProductionResources, readSceneData, readUiData, renderProductionScene2d } from '../../../../../packages/agent-workflow-server/src/beegame/game-content-consumer'
import { uiNodeStyle } from '../../../../../packages/scene-editor/src/ui-preview/UiContentRenderer'
import type { BeeGameAssetManifest } from '../../../../../packages/agent-workflow-server/src/beegame/asset-contracts'
import type { BeeGameSceneContentDocument } from '../../services/beeGameAdapter'

import { createRun, digest } from '../../../../../packages/agent-workflow-server/src/beegame/workflow-v3/state'
import { readContentView } from '../../../../../packages/agent-workflow-server/src/beegame/workflow-v3/content-view'
import { prepareSourceEdit, writeSourceEdit } from '../../../../../packages/agent-workflow-server/src/beegame/workflow-v3/source-edit'
import { reserveSourceEdit } from '../../../../../packages/agent-workflow-server/src/beegame/workflow-v3/changes'

const HASH = 'a'.repeat(64), regular = 'assets/runtime/fonts/regular.ttf', bold = 'assets/runtime/fonts/bold.ttf'
const fontKey = JSON.stringify(['FONT', bold]), path = 'scenes/font.json'
const roots: string[] = []
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
const originalFontFace = Object.getOwnPropertyDescriptor(globalThis, 'FontFace')
const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
afterEach(() => {
  vi.restoreAllMocks()
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts)
  else Reflect.deleteProperty(document, 'fonts')
  document.body.replaceChildren()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  for (const [name, descriptor] of [['document', originalDocument], ['FontFace', originalFontFace]] as const)
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
})

// Exercise the same source preparation, reservation and file write used by the current editor.
async function saveSource(root: string, path: string, document: unknown) {
  const view = await readContentView(root)
  if (view.state !== 'draft') throw Error('Expected editable fixture')
  const current = view.documents.find(entry => entry.path === path)!
  const run = createRun({ projectId: 'fixture', ownerId: 'test', workspacePath: root, chatSessionId: 'test',
    requestKey: 'fixture', text: 'Offline editor fixture', constraints: {}, ids: ['req.edit'] })
  const edit = await prepareSourceEdit(run, { path, expectedRevision: current.revision, document,
    workflow: { version: run.version, planRevision: run.planRevision, requirementsRevision: run.requirements.revision } })
  const reserved = reserveSourceEdit(run, { path: edit.path, before: edit.beforeHash, after: edit.afterHash,
    workerId: 'fixture', requestKey: 'save', requestHash: edit.afterHash })
  await writeSourceEdit(reserved, reserved.writer!.attemptId, edit, new AbortController().signal)
  return edit.document
}

function fixture() {
  const rect = (id: string) => ({ id, type: 'rect-transform' as const, data: {
    anchorMin: [0, 0], anchorMax: [0, 0], pivot: [0, 0], anchoredPosition: [0, 0], sizeDelta: [160, 30],
  } })
  const source: BeeGameSceneContentDocument = { schema: 'beegame-content.v1', id: 'font-scene', kind: 'scene-2d', assetRefs: ['FONT'], data: {
    cameraNodeId: 'camera', settings: { coordinateSystem: { origin: 'top-left', units: 'logical-pixels', width: 200, height: 100, pixelsPerUnit: 100 } }, nodes: [
      { id: 'camera', transform: { position: [100, 50, 0] }, components: [{ id: 'camera-c', type: 'camera', data: {
        orthographic: true, orthographicSize: .5, coordinateSpace: 'logical-pixels', viewport: { width: 200, height: 100 },
      } }] },
      { id: 'canvas', components: [{ id: 'canvas-c', type: 'canvas', data: { renderMode: 'world-space' } }, rect('canvas-r')] },
      ...['label', 'second'].map(id => ({ id, parentId: 'canvas', components: [rect(id + '-r'),
        { id: id + '-cr', type: 'canvas-renderer' as const, data: {} },
        { id: id + '-t', type: 'text' as const, data: { text: 'Hello', fontSize: 16, font: { assetRef: 'FONT', member: bold } } },
      ] })),
    ],
  } }
  const manifest: BeeGameAssetManifest = { version: 9, requirements: [], resources: [{
    id: 'FONT', fulfills: [], root_path: regular, file_paths: [regular, bold], status: 'verified', provisional: false,
    source: { type: 'agent-authored', created_at: '2026-10-18T00:00:00Z', reason: 'offline fixture' },
    selected_at: '2026-10-18T00:00:00Z', selection_reason: ['offline fixture'],
  }] }
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bgs-scene-font-'))); roots.push(root)
  mkdirSync(join(root, 'content/scenes'), { recursive: true })
  writeFileSync(join(root, 'content/index.json'), JSON.stringify({ schema: 'beegame-content-package.v2', id: 'font-package',
    dimension: '2d', documentRevision: HASH, assetManifestRevision: HASH, entryScene: source.id, files: [path], sceneModel: 'game-object-v2',
    documents: [{ path, id: source.id, kind: source.kind, loadPhase: 'startup' }] }))
  writeFileSync(join(root, 'content', path), JSON.stringify(source))
  const editor = sceneContentToEditorDocument({ document: source, documentRevision: digest(readFileSync(join(root, 'content', path))) })
  const text = editor.nodes.label.components.find(component => component.type === 'text')!
  if (text.type === 'text') text.text = 'Saved'
  const exported = editorDocumentToSceneContent(editor, source)
  const authority = { documentRevision: HASH, assetManifestRevision: HASH, manifest }
  const save = (document: unknown = exported) => saveSource(root, path, document)
  const validate = (document: unknown = exported, documentPath = path) => {
    const issues: string[] = []
    validateContentDocument({ workspacePath: root, path: 'content/' + documentPath,
      document: parseBeeGameContentDocument(document), authority, issues })
    return issues
  }
  return { root, source, exported, manifest, save, validate }
}

/** FontFace decoding and Canvas are mocked here; no network or project runs. */
function browserFixture() {
  const registered = new Set<FontFace>(), requests: string[] = [], painted: Array<{font: string; text: string}> = []
  class TestFontFace {
    status = 'unloaded'
    constructor(public family: string, private bytes: ArrayBuffer) {}
    async load() {
      if (!this.bytes.byteLength) { this.status = 'error'; throw Error('Fixture font decode failed') }
      this.status = 'loaded'; return this
    }
  }
  const context = { font: '', fillStyle: '', textBaseline: '',
    clearRect() {}, beginPath() {}, rect() {}, clip() {}, save() {}, restore() {}, setTransform() {},
    fillText(text: string) { painted.push({ font: context.font, text }) },
  }
  Object.defineProperty(document, 'fonts', { configurable: true, value: registered })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as any)
  Object.defineProperty(globalThis, 'FontFace', { configurable: true, value: TestFontFace })
  const canvas = { getContext: () => ({ save() {}, restore() {}, setTransform() {}, clearRect() {}, drawImage() {} }) } as unknown as HTMLCanvasElement
  const fetcher = (mode = 'ok') => async (input: RequestInfo | URL) => {
    const url = String(input); requests.push(url)
    if (url.endsWith('/asset-manifest.json')) return Response.json({ version: 9, modules: { resources: ['assets/manifest/resources/font.json'] } })
    if (url.endsWith('/font.json')) return Response.json({ id: 'FONT', root_path: regular, file_paths: [regular, bold] })
    if (url.endsWith('/' + bold)) return mode === 'http' ? new Response('', { status: 404 }) : new Response(new Uint8Array(mode === 'decode' ? [] : [1, 2, 3]))
    throw Error('Unexpected offline request: ' + url)
  }
  return { registered, requests, painted, canvas, fetcher }
}

test('shared Scene/UI fonts render in either load order, including inherited UI font references', async () => {
  const f = fixture(), browser = browserFixture()
  const ui = parseBeeGameContentDocument({ schema: 'beegame-content.v1', id: 'menu', kind: 'ui-screen', assetRefs: ['FONT'], data: { rootId: 'root', nodes: [
    { id: 'root', role: 'screen-root', data: { font: { assetRef: 'FONT', member: bold } }, style: { fontFamily: 'Display alias', fontSize: 32 } },
    { id: 'label', parentId: 'root', role: 'text', text: 'Hello', layout: { size: [180,50] } },
  ] } })
  const scene = parseBeeGameContentDocument(f.exported), before = JSON.stringify(ui)
  for (const docs of [[scene, ui], [ui, scene]]) {
    const start = browser.requests.length
    const resources = await loadProductionResources('https://offline.invalid/assets/asset-manifest.json', docs, browser.fetcher())
    const host = document.createElement('div'); document.body.append(host)
    const surface = await createProductionUiSurface(host)
    try {
      const face = resources.fonts.get(fontKey)!
      surface.render(readUiData(ui), { width: 200, height: 100 }, { fonts: resources.fonts })
      const element = host.querySelector<HTMLElement>('[data-node-id="label"]')!
      expect(element.style.fontFamily).toBe(face.family)
      expect(element.style.fontSize).toBe('32px')
      expect(uiNodeStyle(readUiData(ui).nodes[1], false, { [fontKey]: face.family }, readUiData(ui).nodes)).toMatchObject({ fontFamily: face.family, fontSize: 32 })
      renderProductionScene2d(browser.canvas, readSceneData(scene), { width: 200, height: 100 }, resources.assets, resources.fonts)
      expect(browser.painted.at(-1)!.font).toBe(`16px ${face.family}`)
      expect(browser.requests.slice(start).filter(url => url.endsWith('/' + bold))).toHaveLength(1)
    } finally { surface.dispose(); resources.dispose(); host.remove() }
  }
  expect(JSON.stringify(ui)).toBe(before)
  expect(browser.registered.size).toBe(0)
})

test('rerender preserves a surviving button focus without stealing external focus or reviving a hidden target', async () => {
  const host = document.createElement('div'), outside = document.createElement('button')
  document.body.append(host, outside)
  const surface = await createProductionUiSurface(host), onAction = vi.fn()
  const ui = { rootId: 'root', nodes: [
    { id: 'root', role: 'screen-root' },
    { id: 'counter', role: 'text', parentId: 'root', bindings: { text: 'counter' }, layout: { size: [100,30] as [number,number] } },
    { id: 'action', role: 'button', parentId: 'root', actions: { click: 'go' }, bindings: { enabled: 'visible' }, layout: { size: [100,30] as [number,number] } },
  ] }
  const render = (counter: number, visible = true) => surface.render(ui, { width: 200, height: 100 }, { state: { counter, visible }, onAction })
  try {
    render(1)
    const old = host.querySelector<HTMLButtonElement>('button')!; old.focus()
    render(2)
    const current = host.querySelector<HTMLButtonElement>('button')!
    expect(current).not.toBe(old); expect(document.activeElement).toBe(current)
    current.click(); expect(onAction).toHaveBeenCalledExactlyOnceWith('go', 'action')
    outside.focus(); render(3); expect(document.activeElement).toBe(outside)
    current.blur(); host.querySelector<HTMLButtonElement>('button')!.focus()
    render(4, false); expect(host.querySelector('button')).toBeNull()
    expect(document.activeElement).not.toBe(old)
    render(5); expect(document.activeElement).not.toBe(host.querySelector('button'))
  } finally { surface.dispose() }
})

test('one Scene font survives editor export, current source save, resource loading and Canvas painting', async () => {
  const f = fixture(), browser = browserFixture()
  expect(f.exported.assetRefs).toEqual(['FONT'])
  expect(contentDraftStructureIssues(path, parseBeeGameContentDocument(f.exported))).toEqual([])
  expect(f.validate()).toEqual([])
  const saved = await f.save()
  expect(saved).toEqual(JSON.parse(readFileSync(join(f.root, 'content', path), 'utf8')))
  const resources = await loadProductionResources('https://offline.invalid/assets/asset-manifest.json', [saved], browser.fetcher())
  try {
    expect(resources.fonts.size).toBe(1)
    expect(browser.requests.filter(url => url.endsWith('/' + bold))).toHaveLength(1)
    expect(browser.requests.some(url => url.endsWith('/' + regular))).toBe(false)
    const face = resources.fonts.get(fontKey)!
    expect(browser.registered.has(face)).toBe(true)
    renderProductionScene2d(browser.canvas, readSceneData(saved), { width: 200, height: 100 }, resources.assets, resources.fonts)
    expect(browser.painted).toEqual([{ font: `16px ${face.family}`, text: 'Saved' }, { font: `16px ${face.family}`, text: 'Hello' }])
    expect(() => renderProductionScene2d(browser.canvas, readSceneData(saved), { width: 200, height: 100 }, resources.assets))
      .toThrow('Missing loaded production Scene FontFace')
    const wrongMember = new Map([['FONT', face]])
    expect(() => renderProductionScene2d(browser.canvas, readSceneData(saved), { width: 200, height: 100 }, resources.assets, wrongMember))
      .toThrow('Missing loaded production Scene FontFace')
    resources.dispose()
    expect(browser.registered.size).toBe(0)
    expect(() => renderProductionScene2d(browser.canvas, readSceneData(saved), { width: 200, height: 100 }, resources.assets, resources.fonts))
      .toThrow('Missing loaded production Scene FontFace')
    expect(browser.painted).toHaveLength(2)
  } finally { resources.dispose() }
})

test('edited Scene image color/opacity survive actual save and reopening', async () => {
  const f = fixture(), source = structuredClone(f.exported)
  source.data.nodes.find(node => node.id === 'label')!.components!.push({
    id: 'label-image', type: 'image', data: { color: '#ffffff', opacity: 1 },
  })
  const editor = sceneContentToEditorDocument({ document: source, documentRevision: HASH })
  const image = editor.nodes.label.components.find(component => component.type === 'image')!
  if (image.type !== 'image') throw Error('Expected image')
  image.material = { ...image.material, color: '#ff0000', opacity: .25 }
  const saved = await f.save(editorDocumentToSceneContent(editor, source))
  expect(saved).toEqual(JSON.parse(readFileSync(join(f.root, 'content', path), 'utf8')))
  const reopened = sceneContentToEditorDocument({ document: saved as BeeGameSceneContentDocument, documentRevision: HASH })
  expect(reopened.nodes.label.components.find(component => component.type === 'image')).toMatchObject({ material: { color: '#ff0000', opacity: .25 } })
})

test('shared UI validation rejects malformed fonts read-only; current editing saves valid and default fonts', async () => {
  const f = fixture(), uiPath = 'ui/menu.json', absolutePath = join(f.root, 'content', uiPath)
  const indexPath = join(f.root, 'content/index.json'), index = JSON.parse(readFileSync(indexPath, 'utf8'))
  index.files.push(uiPath); index.documents.push({ path: uiPath, id: 'menu', kind: 'ui-screen', loadPhase: 'startup' }); writeFileSync(indexPath, JSON.stringify(index))
  mkdirSync(join(f.root, 'content/ui'))
  const ui = { schema: 'beegame-content.v1' as const, id: 'menu', kind: 'ui-screen' as const, assetRefs: ['FONT'], data: { rootId: 'root', nodes: [
    { id: 'root', role: 'screen-root' },
    { id: 'label', role: 'text', text: 'Hello', parentId: 'root', layout: { size: [120,40] as [number,number] }, data: { font: { assetRef: 'FONT', member: bold } } },
  ] } }
  writeFileSync(absolutePath, JSON.stringify(ui))
  expect(f.validate(ui, uiPath)).toEqual([])
  expect(await saveSource(f.root, uiPath, ui)).toEqual(ui)
  const savedBytes = readFileSync(absolutePath, 'utf8')
  for (const font of [{}, null, [], { assetRef: '' }, { assetRef: ' ' }, { assetRef: 'FONT', member: '' }, { assetRef: 'FONT', member: 1 }]) {
    const invalid: any = structuredClone(ui); invalid.data.nodes[1].data.font = font
    expect(f.validate(invalid, uiPath).join('; ')).toContain('requires data.font')
    expect(readFileSync(absolutePath, 'utf8')).toBe(savedBytes)
  }
  const cleared = structuredClone(ui); delete (cleared.data.nodes[1].data as Record<string,unknown>).font
  expect(f.validate(cleared, uiPath)).toEqual([])
  expect(await saveSource(f.root, uiPath, cleared)).toEqual(cleared)
  expect(JSON.parse(readFileSync(absolutePath, 'utf8')).data.nodes[1].data).not.toHaveProperty('font')
})

test('Scene font validation accepts only Text font references and retains declaration/member checks', () => {
  const f = fixture()
  const font = () => f.exported.data.nodes.find(node => node.id === 'label')!.components!.find(component => component.type === 'text')!
  for (const value of [null, {}, { assetRef: '' }, { assetRef: 'FONT', member: 1 }, { assetRef: 'FONT', member: '' },
    { assetRef: 'FONT', nested: { assetRef: 'hidden' } }]) {
    font().data!.font = value
    expect(contentDraftStructureIssues(path, parseBeeGameContentDocument(f.exported)).join(' ')).toContain('requires data.font')
  }
  font().data!.font = { assetRef: 'FONT', member: bold }
  f.exported.assetRefs = []
  expect(contentBindingIssues(path, parseBeeGameContentDocument(f.exported)).join(' ')).toContain('undeclared assetRef FONT')
  f.exported.assetRefs = ['FONT']
  font().data!.font = { assetRef: 'FONT', member: 'missing.ttf' }
  expect(f.validate().join('; ')).toContain('does not resolve member missing.ttf')
  font().data!.font = { assetRef: 'FONT', member: bold }
  font().data!.other = { assetRef: 'FONT' }
  expect(f.validate().join('; ')).toContain('stores legacy other.assetRef')
  delete font().data!.other
  f.exported.data.nodes.find(node => node.id === 'canvas')!.components![0].data!.font = { assetRef: 'FONT' }
  expect(f.validate().join('; ')).toContain('stores legacy font.assetRef')
})

test('Scene font load rejects missing registrations, invalid members, HTTP/decode failures without retry or painting', async () => {
  const f = fixture(), browser = browserFixture()
  for (const mode of ['http', 'decode']) {
    const start = browser.requests.length
    await expect(loadProductionResources('https://offline.invalid/assets/asset-manifest.json',
      [parseBeeGameContentDocument(f.exported)], browser.fetcher(mode))).rejects.toThrow(mode === 'http' ? 'Font HTTP 404' : 'Fixture font decode failed')
    expect(browser.requests.slice(start).filter(url => url.endsWith('/' + bold))).toHaveLength(1)
    expect(browser.registered.size).toBe(0)
  }
  const text = f.exported.data.nodes.find(node => node.id === 'label')!.components!.find(component => component.type === 'text')!
  for (const [font, message] of [
    [{ assetRef: 'MISSING' }, 'Missing registered resource'],
    [{ assetRef: 'FONT', member: 'missing.ttf' }, 'Missing or ambiguous registered member'],
    [{ assetRef: 'FONT', member: 1 }, 'Invalid production font reference'],
  ] as const) {
    text.data!.font = font
    await expect(loadProductionResources('https://offline.invalid/assets/asset-manifest.json',
      [parseBeeGameContentDocument(f.exported)], browser.fetcher())).rejects.toThrow(message)
  }
  expect(browser.painted).toEqual([])
})
