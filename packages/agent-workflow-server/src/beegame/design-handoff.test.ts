import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm, rename, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkDesignHandoff, designCalculationFiles, designSupportingFiles, designDocumentVersion, designHandoffPath, isHigherDocumentVersion,
  readDesignAcceptanceRequirements, snapshotDesignDocuments, finalizeDesignDocuments, DESIGN_HANDOFF_INSTRUCTION, type DesignDocument } from './design-handoff'
import { designDocumentFixture, designHandoffFixture, writeDesignDocumentFixture, writeDesignDocumentsFixture } from './fixtures/layout-fixture'
import { checkDesignDocumentReferences } from './design-document-references'

const digest = (body: string) => createHash('sha256').update(body).digest('hex')
async function fixture(run: (workspace: string, put: (name: DesignDocument, change: (h: any) => void) => Promise<void>) => Promise<void>) {
  const workspace = await mkdtemp(join(tmpdir(), 'synthetic-design-handoff-'))
  try {
    await writeDesignDocumentsFixture(workspace)
    await run(workspace, async (name, change) => {
      const h = designHandoffFixture(name); change(h)
      await writeDesignDocumentFixture(workspace, name, h)
    })
  } finally { await rm(workspace, { recursive: true, force: true }) }
}
test('minimal output index is consumed by runtime acceptance without business mirrors or author metadata', () => fixture(async workspace => {
  await writeDesignDocumentFixture(workspace, 'GDD.md', { outputs: designHandoffFixture('GDD.md').outputs })
  const before = await readFile(join(workspace, designHandoffPath('GDD.md')), 'utf8')
  const check = checkDesignHandoff(workspace, ['GDD.md'], { nextConsumers: ['resources'], inputs: ['Touch'] })
  expect(check.valid).toBe(true)
  expect(check.note).toContain('semantic adequacy')
  expect(check.documentVersions).toEqual({ 'GDD.md': '1.0' })
  expect(readDesignAcceptanceRequirements(workspace)).toMatchObject([{ document: 'GDD.md', id: 'play', section: 'Design', method: 'test' }])
  expect(await readFile(join(workspace, designHandoffPath('GDD.md')), 'utf8')).toBe(before)
  expect(DESIGN_HANDOFF_INSTRUCTION).toContain('Authors do not calculate or synchronize versions/hashes')
}))
test('legacy v1 reads only actual consumer fields, explicitly abandons mirror certification and never rewrites files', () => fixture(async workspace => {
  const legacy = { ...designHandoffFixture('GDD.md'), version: 1, readiness: false, states: [{ transitions: false }],
    events: false, parameters: false, resources: false, inputs: false, consumes: [{ document: 'UI_UX_SPEC.md', id: 'invented' }],
    pending: [{ owner: 'user', neededBefore: 'resources' }], limits: false, platformFacts: false }
  Object.assign(legacy.outputs[0]!, { resourceRequired: true, soundRequired: true })
  await writeDesignDocumentFixture(workspace, 'GDD.md', legacy)
  const body = await readFile(join(workspace, 'docs/GDD.md'), 'utf8')
  const sidecar = await readFile(join(workspace, designHandoffPath('GDD.md')), 'utf8')
  const check = checkDesignHandoff(workspace, ['GDD.md'], { nextConsumers: ['resources'] })
  expect(check.valid).toBe(true)
  expect(check.note).toContain('ignored and not certified')
  expect(readDesignAcceptanceRequirements(workspace)).toHaveLength(1)
  expect(await readFile(join(workspace, 'docs/GDD.md'), 'utf8')).toBe(body)
  expect(await readFile(join(workspace, designHandoffPath('GDD.md')), 'utf8')).toBe(sidecar)
}))
test('v2 rejects retired mirrors instead of starting another business validation system', () => fixture(async (workspace, put) => {
  await put('GDD.md', h => h.states = [])
  const before = await readFile(join(workspace, designHandoffPath('GDD.md')), 'utf8')
  expect(checkDesignHandoff(workspace, ['GDD.md']).valid).toBe(false)
  expect(() => readDesignAcceptanceRequirements(workspace)).toThrow()
  expect(await readFile(join(workspace, designHandoffPath('GDD.md')), 'utf8')).toBe(before)
}))
test('inline, missing and malformed indexes remain release failures without silent migration', () => fixture(async workspace => {
  const source = join(workspace, 'docs/GDD.md'), path = join(workspace, designHandoffPath('GDD.md'))
  const fence = String.fromCharCode(96).repeat(3)
  const body = (await readFile(source, 'utf8')) + '\n' + fence + 'bgs-handoff\n{}\n' + fence + '\n'
  await writeFile(source, body)
  expect(checkDesignHandoff(workspace, ['GDD.md']).issues.join('; ')).toContain('Move inline bgs-handoff')
  expect(await readFile(source, 'utf8')).toBe(body)
  await writeFile(source, designDocumentFixture('GDD.md'))
  await rm(path)
  expect(checkDesignHandoff(workspace, ['GDD.md']).valid).toBe(false)
  expect(finalizeDesignDocuments(workspace, ['GDD.md'], snapshotDesignDocuments(workspace, ['GDD.md'])).unsafeIssues).toEqual([])
  await writeFile(path, '{broken}')
  const snapshot = snapshotDesignDocuments(workspace, ['GDD.md'])
  const invalid = finalizeDesignDocuments(workspace, ['GDD.md'], snapshot)
  expect(invalid.issues.length).toBeGreaterThan(0)
  expect(invalid.unsafeIssues).toEqual([])
  expect(await readFile(path, 'utf8')).toBe('{broken}')
  await writeFile(path, '')
  const emptySnapshot = snapshotDesignDocuments(workspace, ['GDD.md'])
  expect(finalizeDesignDocuments(workspace, ['GDD.md'], emptySnapshot).unsafeIssues).toEqual([])
  await writeFile(path, JSON.stringify(designHandoffFixture('GDD.md')))
  expect(finalizeDesignDocuments(workspace, ['GDD.md'], emptySnapshot).issues).toEqual([])
  expect(designDocumentVersion(await readFile(source, 'utf8'))).toBe('1.1')
}))
test.each(['section', 'acceptance-section', 'duplicate', 'method', 'missing-core'] as const)(
  'actual consumer index rejects %s failure', kind => fixture(async (workspace, put) => {
    await put('GDD.md', h => {
      if (kind === 'section') h.outputs[0].section = 'Absent'
      if (kind === 'acceptance-section') h.outputs[0].acceptance.section = 'Absent'
      if (kind === 'duplicate') h.outputs.push(h.outputs[0])
      if (kind === 'method') h.outputs[0].acceptance.method = 'review'
      if (kind === 'missing-core') delete h.outputs[0].acceptance
    })
    expect(checkDesignHandoff(workspace, ['GDD.md']).valid).toBe(false)
    expect(() => readDesignAcceptanceRequirements(workspace)).toThrow()
  }))
test('malformed evidence does not hide independently invalid acceptance pointers', () => fixture(async (workspace, put) => {
  await put('GDD.md', h => { h.evidence = false; h.outputs[0].acceptance.section = 'Absent' })
  const check = checkDesignHandoff(workspace, ['GDD.md'])
  expect(check.valid).toBe(false)
  expect(check.issues.join('; ')).toContain('checks requiring handoff.evidence were not run')
  expect(check.issues.join('; ')).toContain('acceptance play references an absent section')
}))
test('explicit prose references remain independently checked after consumes is removed', () => fixture(async workspace => {
  await writeFile(join(workspace, 'docs/GDD.md'), designDocumentFixture('GDD.md') + '\n[Missing source](UNASSIGNED_DESIGN.md)\n')
  expect(checkDesignDocumentReferences(workspace, 4).valid).toBe(false)
}))
test('numeric document version comparison stays available for released-baseline guards', () => {
  expect(designDocumentVersion('# Design\n- 版本：v1.9.2\n')).toBe('1.9.2')
  expect(isHigherDocumentVersion('1.10', '1.9.2')).toBe(true)
  expect(isHigherDocumentVersion('1.0.1', '1.0')).toBe(true)
  expect(isHigherDocumentVersion('1.0.0', '1.0')).toBe(false)
  expect(isHigherDocumentVersion('0.9', '1.0')).toBe(false)
  expect(() => designDocumentVersion('- Version: v1.0\n- Version: v1.1')).toThrow('one document header')
})
test('first completed author write gets host metadata without needing version or hash double-entry', () => fixture(async workspace => {
  await rm(join(workspace, 'docs/GDD.md'))
  await rm(join(workspace, designHandoffPath('GDD.md')))
  const snapshot = snapshotDesignDocuments(workspace, ['GDD.md'])
  await writeDesignDocumentFixture(workspace, 'GDD.md', { outputs: designHandoffFixture('GDD.md').outputs }, '# Design\nFixture decision.\n')
  expect(finalizeDesignDocuments(workspace, ['GDD.md'], snapshot).issues).toEqual([])
  expect(designDocumentVersion(await readFile(join(workspace, 'docs/GDD.md'), 'utf8'))).toBe('1.0')
  expect(JSON.parse(await readFile(join(workspace, designHandoffPath('GDD.md')), 'utf8'))).toEqual({
    version: 2, documentVersion: '1.0', outputs: designHandoffFixture('GDD.md').outputs, evidence: [],
  })
  const unchanged = snapshotDesignDocuments(workspace, ['GDD.md'])
  expect(unchanged.documents['GDD.md']!.contentHash).not.toBe(snapshot.documents['GDD.md']!.contentHash)
  expect(finalizeDesignDocuments(workspace, ['GDD.md'], unchanged).issues).toEqual([])
  expect(designDocumentVersion(await readFile(join(workspace, 'docs/GDD.md'), 'utf8'))).toBe('1.0')
}))
test.each(['prose', 'index', 'calculation'] as const)('host advances only a materially revised %s and repeated finalization is idempotent', kind => fixture(async workspace => {
  if (kind === 'calculation') {
    await mkdir(join(workspace, 'docs/calc'), { recursive: true })
    await writeFile(join(workspace, 'docs/calc/model.json'), '{"value":1}')
    await writeFile(join(workspace, 'docs/GDD.md'), designDocumentFixture('GDD.md') + '\n[Model](calc/model.json)\n')
  }
  const snapshot = snapshotDesignDocuments(workspace, ['GDD.md'])
  const protectedDocument = await readFile(join(workspace, 'docs/ART_DIRECTION.md'), 'utf8')
  if (kind === 'prose') await writeFile(join(workspace, 'docs/GDD.md'), designDocumentFixture('GDD.md').replace('Fixture decision.', 'Changed authoritative decision.'))
  if (kind === 'index') {
    const index = designHandoffFixture('GDD.md')
    index.outputs.push({ id: 'outcome', section: 'Design', acceptance: { section: 'Design', method: 'target-runtime' } })
    await writeFile(join(workspace, designHandoffPath('GDD.md')), JSON.stringify(index))
  }
  if (kind === 'calculation') await writeFile(join(workspace, 'docs/calc/model.json'), '{"value":2}')
  expect(finalizeDesignDocuments(workspace, ['GDD.md'], snapshot).issues).toEqual([])
  const body = await readFile(join(workspace, 'docs/GDD.md'), 'utf8'), sidecar = await readFile(join(workspace, designHandoffPath('GDD.md')), 'utf8')
  expect(designDocumentVersion(body)).toBe('1.1')
  expect(JSON.parse(sidecar).documentVersion).toBe('1.1')
  expect(finalizeDesignDocuments(workspace, ['GDD.md'], snapshot).issues).toEqual([])
  expect(await readFile(join(workspace, 'docs/GDD.md'), 'utf8')).toBe(body)
  expect(await readFile(join(workspace, designHandoffPath('GDD.md')), 'utf8')).toBe(sidecar)
  expect(finalizeDesignDocuments(workspace, ['GDD.md'], snapshotDesignDocuments(workspace, ['GDD.md'])).issues).toEqual([])
  expect(await readFile(join(workspace, 'docs/GDD.md'), 'utf8')).toBe(body)
  expect(await readFile(join(workspace, 'docs/ART_DIRECTION.md'), 'utf8')).toBe(protectedDocument)
}))
test('host ignores author edits to metadata and preserves an unchanged localized version line', () => fixture(async workspace => {
  const path = join(workspace, 'docs/GDD.md')
  await writeFile(path, designDocumentFixture('GDD.md').replace('- Version: v1.0', '- 版本：v1.0'))
  const before = await readFile(path, 'utf8'), snapshot = snapshotDesignDocuments(workspace, ['GDD.md'])
  expect(finalizeDesignDocuments(workspace, ['GDD.md'], snapshot).issues).toEqual([])
  expect(await readFile(path, 'utf8')).toBe(before)
  await writeFile(path, before.replace('v1.0', 'v99.0'))
  const index = designHandoffFixture('GDD.md'); index.documentVersion = '99.0'
  await writeFile(join(workspace, designHandoffPath('GDD.md')), JSON.stringify(index))
  expect(finalizeDesignDocuments(workspace, ['GDD.md'], snapshot).issues).toEqual([])
  expect(designDocumentVersion(await readFile(path, 'utf8'))).toBe('1.0')
}))
test('retained evidence changes advance the owner version; hashes bind bytes and never manufacture observations', () => fixture(async (workspace, put) => {
  const evidencePath = join(workspace, 'capability.json')
  const observation = { observation: 'target-runtime', check: 'Synthetic capability check', passed: true, expected: 2, observed: 2 }
  await writeFile(evidencePath, JSON.stringify(observation))
  await put('TECHNICAL_DESIGN.md', h => h.evidence.push({ id: 'test', kind: 'capability', path: 'capability.json', source: 'Synthetic fixture', section: 'Design' }))
  const original = snapshotDesignDocuments(workspace, ['TECHNICAL_DESIGN.md'])
  expect(finalizeDesignDocuments(workspace, ['TECHNICAL_DESIGN.md'], original).issues).toEqual([])
  const initial = JSON.parse(await readFile(join(workspace, designHandoffPath('TECHNICAL_DESIGN.md')), 'utf8'))
  expect(initial.evidence[0].sha256).toBe(digest(JSON.stringify(observation)))
  expect(initial.evidence[0]).not.toHaveProperty('passed')
  const snapshot = snapshotDesignDocuments(workspace, ['TECHNICAL_DESIGN.md'])
  const revised = JSON.stringify({ ...observation, check: 'Changed retained observation' })
  await writeFile(evidencePath, revised)
  expect(checkDesignHandoff(workspace, ['TECHNICAL_DESIGN.md']).issues.join('; ')).toContain('Evidence bytes changed')
  expect(finalizeDesignDocuments(workspace, ['TECHNICAL_DESIGN.md'], snapshot).issues).toEqual([])
  const current = JSON.parse(await readFile(join(workspace, designHandoffPath('TECHNICAL_DESIGN.md')), 'utf8'))
  expect(current.documentVersion).toBe('1.1')
  expect(current.evidence[0].sha256).toBe(digest(revised))
  expect(finalizeDesignDocuments(workspace, ['TECHNICAL_DESIGN.md'], snapshot).issues).toEqual([])
  expect(checkDesignHandoff(workspace, ['TECHNICAL_DESIGN.md']).valid).toBe(true)
}))
test.each(['contract', 'capability', 'documentation', 'missing'] as const)(
  'automatic metadata cannot bless invalid %s evidence', kind => fixture(async (workspace, put) => {
    const evidence: any = { id: 'proof', kind: kind === 'missing' ? 'contract' : kind, path: 'proof.json', source: kind === 'documentation' ? 'http://example.org' : 'Synthetic fixture' }
    if (kind === 'contract' || kind === 'missing') Object.assign(evidence, { pointer: '/supported', expected: true })
    if (kind !== 'missing') await writeFile(join(workspace, 'proof.json'), JSON.stringify(kind === 'contract' ? { supported: false } : { observation: 'target-runtime', check: 'Synthetic failure', passed: false, expected: 2, observed: 1 }))
    await put('TECHNICAL_DESIGN.md', h => h.evidence.push(evidence))
    const path = join(workspace, designHandoffPath('TECHNICAL_DESIGN.md'))
    const body = await readFile(join(workspace, 'docs/TECHNICAL_DESIGN.md'), 'utf8'), index = await readFile(path, 'utf8')
    const snapshot = snapshotDesignDocuments(workspace, ['TECHNICAL_DESIGN.md'])
    expect(finalizeDesignDocuments(workspace, ['TECHNICAL_DESIGN.md'], snapshot).issues.length).toBeGreaterThan(0)
    expect(checkDesignHandoff(workspace, ['TECHNICAL_DESIGN.md']).valid).toBe(false)
    expect(() => readDesignAcceptanceRequirements(workspace)).toThrow()
    expect(await readFile(path, 'utf8')).toBe(index)
    expect(await readFile(join(workspace, 'docs/TECHNICAL_DESIGN.md'), 'utf8')).toBe(body)
  }))
test.each(['document', 'index', 'document-directory', 'index-directory'] as const)(
  'host finalization rejects %s symlink targets, including redirects inside the workspace', kind => fixture(async workspace => {
    const snapshot = snapshotDesignDocuments(workspace, ['GDD.md'])
    let protectedPath: string
    if (kind === 'document' || kind === 'index') {
      const path = join(workspace, kind === 'document' ? 'docs/GDD.md' : designHandoffPath('GDD.md'))
      protectedPath = join(workspace, kind === 'document' ? 'docs/ART_DIRECTION.md' : designHandoffPath('ART_DIRECTION.md'))
      await rm(path); await symlink(protectedPath, path)
    } else {
      const directory = join(workspace, kind === 'document-directory' ? 'docs' : '.beegame/design-handoffs')
      const retained = directory + '-protected'
      await rename(directory, retained); await symlink(retained, directory)
      protectedPath = join(retained, kind === 'document-directory' ? 'GDD.md' : 'GDD.json')
    }
    const before = await readFile(protectedPath, 'utf8')
    const result = finalizeDesignDocuments(workspace, ['GDD.md'], snapshot)
    expect(result.unsafeIssues.join('; ')).toContain('must not be a symlink')
    expect(checkDesignHandoff(workspace, ['GDD.md']).valid).toBe(false)
    expect(() => readDesignAcceptanceRequirements(workspace)).toThrow('must not be a symlink')
    expect(await readFile(protectedPath, 'utf8')).toBe(before)
  }))
test('uncaptured documents cannot be finalized and evidence paths cannot escape', () => fixture(async (workspace, put) => {
  const snapshot = snapshotDesignDocuments(workspace, ['GDD.md'])
  expect(finalizeDesignDocuments(workspace, ['ART_DIRECTION.md'], snapshot).issues.join('; ')).toContain('authorized write scope')
  await symlink('/etc/hosts', join(workspace, 'outside'))
  await put('TECHNICAL_DESIGN.md', h => h.evidence.push({ id: 'bad', kind: 'documentation', path: 'outside', source: 'https://example.org' }))
  expect(checkDesignHandoff(workspace, ['TECHNICAL_DESIGN.md']).issues.join('; ')).toContain('inside the workspace')
}))
test('only existing explicitly cited calculation files enter scoped writes and revision identity', () => fixture(async workspace => {
  await mkdir(join(workspace, 'docs/calc'), { recursive: true })
  await writeFile(join(workspace, 'docs/calc/model.mjs'), 'export default {}')
  await writeFile(join(workspace, 'docs/calc/appendix.md'), 'Numerical result')
  await writeFile(join(workspace, 'docs/calc/unrelated.json'), '{}')
  await writeFile(join(workspace, 'docs/BALANCE_DESIGN.md'), designDocumentFixture('BALANCE_DESIGN.md') +
    '[Model](calc/model.mjs)\n[Results][result]\n\n[result]: calc/appendix.md\n')
  expect(designCalculationFiles(workspace, ['BALANCE_DESIGN.md'])).toEqual(['docs/calc/appendix.md', 'docs/calc/model.mjs'])
  const original = checkDesignHandoff(workspace, ['BALANCE_DESIGN.md'])
  expect(Object.keys(original.evidenceHashes).sort()).toEqual(['docs/calc/appendix.md', 'docs/calc/model.mjs'])
  await writeFile(join(workspace, 'docs/calc/model.mjs'), 'export default { changed: true }')
  expect(checkDesignHandoff(workspace, ['BALANCE_DESIGN.md']).revision).not.toBe(original.revision)
  await rm(join(workspace, 'docs/calc/model.mjs'))
  await symlink(join(workspace, 'docs/calc/unrelated.json'), join(workspace, 'docs/calc/model.mjs'))
  expect(() => designCalculationFiles(workspace, ['BALANCE_DESIGN.md'])).toThrow('must not be a symlink')
  await writeFile(join(workspace, 'docs/BALANCE_DESIGN.md'), designDocumentFixture('BALANCE_DESIGN.md') + '\n[Missing](calc/missing.json)\n')
  expect(designCalculationFiles(workspace, ['BALANCE_DESIGN.md'])).toEqual([])
  expect(checkDesignDocumentReferences(workspace, 2).valid).toBe(false)
}))

test('visual references bind the owner version and revision without granting a consumer writes to its art source', () => fixture(async workspace => {
  await mkdir(join(workspace, 'docs/visual/ART_DIRECTION'), { recursive: true })
  await mkdir(join(workspace, 'docs/visual/UI_UX_SPEC'), { recursive: true })
  const art = 'docs/visual/ART_DIRECTION/sample.svg', ui = 'docs/visual/UI_UX_SPEC/sample.html'
  await writeFile(join(workspace, art), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>')
  await writeFile(join(workspace, ui), '<!doctype html><main>Composition</main>')
  await writeFile(join(workspace, 'docs/ART_DIRECTION.md'), designDocumentFixture('ART_DIRECTION.md') +
    '\n![Visual][sample]\n\n[sample]: visual/ART_DIRECTION/sample.svg\n')
  await writeFile(join(workspace, 'docs/UI_UX_SPEC.md'), designDocumentFixture('UI_UX_SPEC.md') +
    '\n[Art sample](visual/ART_DIRECTION/sample.svg)\n[Composition](visual/UI_UX_SPEC/sample.html)\n')
  expect(designSupportingFiles(workspace, ['ART_DIRECTION.md'])).toEqual([art])
  expect(designSupportingFiles(workspace, ['UI_UX_SPEC.md'])).toEqual(['content/ui/menu.json', ui])
  expect(designCalculationFiles(workspace, ['ART_DIRECTION.md'])).toEqual([])
  const snapshot = snapshotDesignDocuments(workspace, ['ART_DIRECTION.md', 'UI_UX_SPEC.md'])
  const original = checkDesignHandoff(workspace, ['ART_DIRECTION.md', 'UI_UX_SPEC.md'])
  await writeFile(join(workspace, art), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="green"/></svg>')
  expect(checkDesignHandoff(workspace, ['ART_DIRECTION.md', 'UI_UX_SPEC.md']).revision).not.toBe(original.revision)
  expect(finalizeDesignDocuments(workspace, ['ART_DIRECTION.md', 'UI_UX_SPEC.md'], snapshot).issues).toEqual([])
  expect(designDocumentVersion(await readFile(join(workspace, 'docs/ART_DIRECTION.md'), 'utf8'))).toBe('1.1')
  expect(designDocumentVersion(await readFile(join(workspace, 'docs/UI_UX_SPEC.md'), 'utf8'))).toBe('1.0')
  await rm(join(workspace, art))
  await symlink(join(workspace, ui), join(workspace, art))
  expect(() => designSupportingFiles(workspace, ['ART_DIRECTION.md'])).toThrow('must not be a symlink')
}))

test('single UI source is owned by UI; later bindings do not bump design version but geometry edits do', () => fixture(async workspace => {
  const path = join(workspace, 'content/ui/menu.json')
  const ui = JSON.parse(await readFile(path, 'utf8'))
  const snapshot = snapshotDesignDocuments(workspace, ['UI_UX_SPEC.md'])
  const original = checkDesignHandoff(workspace, ['UI_UX_SPEC.md'])
  await writeFile(join(workspace, 'docs/TECHNICAL_DESIGN.md'), designDocumentFixture('TECHNICAL_DESIGN.md') + '\n[UI source](../content/ui/menu.json)\n')
  expect(designSupportingFiles(workspace, ['UI_UX_SPEC.md'])).toEqual(['content/ui/menu.json'])
  expect(designSupportingFiles(workspace, ['TECHNICAL_DESIGN.md'])).toEqual([])
  ui.assetRefs = ['planned-texture']
  ui.data.nodes[1].actions = { click: 'start-game' }
  ui.data.nodes[1].bindings = { enabled: 'canStart' }
  ui.data.nodes[1].style = { texture: { assetRef: 'planned-texture' }, fontFamily: 'delivered-font' }
  await writeFile(path, JSON.stringify(ui))
  expect(checkDesignHandoff(workspace, ['UI_UX_SPEC.md']).revision).toBe(original.revision)
  expect(finalizeDesignDocuments(workspace, ['UI_UX_SPEC.md'], snapshot).issues).toEqual([])
  expect(designDocumentVersion(await readFile(join(workspace, 'docs/UI_UX_SPEC.md'), 'utf8'))).toBe('1.0')
  ui.data.nodes[1].layout.size[1] = 60
  await writeFile(path, JSON.stringify(ui))
  expect(checkDesignHandoff(workspace, ['UI_UX_SPEC.md']).revision).not.toBe(original.revision)
  expect(finalizeDesignDocuments(workspace, ['UI_UX_SPEC.md'], snapshot).issues).toEqual([])
  expect(designDocumentVersion(await readFile(join(workspace, 'docs/UI_UX_SPEC.md'), 'utf8'))).toBe('1.1')
  await rm(path)
  await symlink(join(workspace, 'docs/GDD.md'), path)
  expect(() => designSupportingFiles(workspace, ['UI_UX_SPEC.md'])).toThrow('must not be a symlink')
}))

test.each(['content/ui/menu.json', './content/ui/menu.json', 'ui-alias.json'])(
  'live UI cannot be frozen as immutable evidence through %s', path => fixture(async (workspace, put) => {
    if (path === 'ui-alias.json') await symlink(join(workspace, 'content/ui/menu.json'), join(workspace, path))
    const uiDigest = checkDesignHandoff(workspace, ['UI_UX_SPEC.md']).evidenceHashes['content/ui/menu.json']
    // A consumer can make the same mistake; report the actual index owner.
    for (const name of ['UI_UX_SPEC.md', 'TECHNICAL_DESIGN.md'] as const) {
      await put(name, h => h.evidence.push({ id: 'ui-kind', kind: 'contract', path,
        source: 'Synthetic layout', section: 'Design', pointer: '/kind', expected: 'ui-screen' }))
      const source = await readFile(join(workspace, 'docs/' + name), 'utf8')
      const index = await readFile(join(workspace, designHandoffPath(name)), 'utf8')
      const check = checkDesignHandoff(workspace, ['UI_UX_SPEC.md', 'TECHNICAL_DESIGN.md'])
      expect(check.issues.join('; ')).toContain(name + ': evidence ui-kind: Live UI source')
      expect(check.evidenceHashes['content/ui/menu.json']).toBe(uiDigest)
      expect(() => readDesignAcceptanceRequirements(workspace)).toThrow('Live UI source')
      const finalization = finalizeDesignDocuments(workspace, [name], snapshotDesignDocuments(workspace, [name]))
      expect(finalization.issues.join('; ')).toContain('Live UI source')
      expect(finalization.unsafeIssues).toEqual([])
      expect(await readFile(join(workspace, 'docs/' + name), 'utf8')).toBe(source)
      expect(await readFile(join(workspace, designHandoffPath(name)), 'utf8')).toBe(index)
      await put(name, h => h.evidence = [])
    }
  }))
