import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm, rename, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkDesignHandoff, checkDesignHandoffDraft, designCalculationFiles, designSupportingFiles, designDocumentVersion, designHandoffPath, isHigherDocumentVersion,
  readDesignAcceptanceRequirements, snapshotDesignDocuments, finalizeDesignDocuments, changedDesignSections, designReviewReadScope, designReviewIndexes,
  DESIGN_HANDOFF_INSTRUCTION, type DesignDocument } from './design-handoff'
import { designDocumentFixture, designHandoffFixture, writeDesignDocumentFixture, writeDesignDocumentsFixture, sceneLayoutFixture } from './fixtures/layout-fixture'
import { checkDesignDocumentReferences } from './design-document-references'

const digest = (body: string) => createHash('sha256').update(body).digest('hex')

test('document handoff does not constrain HTML/SVG game implementation', () => fixture(async workspace => {
  await mkdir(join(workspace,'src'),{recursive:true})
  await writeFile(join(workspace,'src/index.html'),'<main onclick="play()">Game</main>')
  await writeFile(join(workspace,'src/icon.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>')
  const doc=join(workspace,'docs/TECHNICAL_DESIGN.md')
  await writeFile(doc,await readFile(doc,'utf8')+'\n[Game](../src/index.html)\n[Icon](../src/icon.svg)\n')
  expect(designSupportingFiles(workspace,['TECHNICAL_DESIGN.md'])).toEqual([])
  expect(checkDesignHandoff(workspace,['TECHNICAL_DESIGN.md']).valid).toBe(true)
}))

test.each(['GDD.md', 'AUDIO_DESIGN.md', 'TECHNICAL_DESIGN.md'] as const)(
  '%s: numbering-only pointers are read-checkable and persisted only by authorized finalization', name => fixture(async workspace => {
    const snapshot = snapshotDesignDocuments(workspace, [name])
    const prose = '# Design\n## 2.1 Core rule\nDecision.\n## 3) Acceptance\nExpected outcome.\n'
    await writeFile(join(workspace, 'docs', name), prose)
    const index = { outputs: [{ id: 'core', section: 'Core rule',
      acceptance: { section: '9. Acceptance', method: 'test' } }], evidence: [] }
    const path = join(workspace, designHandoffPath(name)), saved = JSON.stringify(index)
    await writeFile(path, saved)
    const untouched = await readFile(join(workspace, 'docs/ART_DIRECTION.md'), 'utf8')
    expect(checkDesignHandoffDraft(workspace, name).issues).toEqual([])
    expect(await readFile(path, 'utf8')).toBe(saved)
    expect(await readFile(join(workspace, 'docs', name), 'utf8')).toBe(prose)
    expect(finalizeDesignDocuments(workspace, [name], snapshot).issues).toEqual([])
    const finalized = JSON.parse(await readFile(path, 'utf8'))
    expect(finalized.outputs[0]).toEqual({ id: 'core', section: '2.1 Core rule',
      acceptance: { section: '3) Acceptance', method: 'test' } })
    expect(checkDesignHandoff(workspace, [name], { technicalBaseline: true }).valid).toBe(true)
    expect(await readFile(join(workspace, 'docs/ART_DIRECTION.md'), 'utf8')).toBe(untouched)
    const finalBytes = await readFile(path, 'utf8')
    expect(finalizeDesignDocuments(workspace, [name], snapshotDesignDocuments(workspace, [name])).issues).toEqual([])
    expect(await readFile(path, 'utf8')).toBe(finalBytes)
  }),
)

test.each([
  ['## 1. Rules\nA\n## 2. Rules\nB\n', 'Rules'],
  ['## 1. Rules\nA\n## 1. Rules\nB\n', 'Rules'],
  ['## 1. Rules\nA\n', 'Different rules'],
  ['## 20 enemies\nA\n', '10 enemies'],
  ['## 3D models\nA\n', 'models'],
])('no heading guesses or writes: %s / %s', (headings, pointer) => fixture(async workspace => {
  const snapshot = snapshotDesignDocuments(workspace, ['GDD.md'])
  await writeFile(join(workspace, 'docs/GDD.md'), '# Design\n' + headings)
  const index = { outputs: [{ id: 'core', section: pointer,
    acceptance: { section: pointer, method: 'test' } }], evidence: [] }
  const path = join(workspace, designHandoffPath('GDD.md')), saved = JSON.stringify(index)
  await writeFile(path, saved)
  expect(checkDesignHandoffDraft(workspace, 'GDD.md').valid).toBe(false)
  expect(finalizeDesignDocuments(workspace, ['GDD.md'], snapshot).issues.length).toBeGreaterThan(0)
  expect(await readFile(path, 'utf8')).toBe(saved)
}))

test('numbering normalization includes task and retained-evidence pointers without changing their facts', () => fixture(async workspace => {
  const name = 'TECHNICAL_DESIGN.md', snapshot = snapshotDesignDocuments(workspace, [name])
  await writeFile(join(workspace, 'docs', name),
    '# Design\n## 1. Rules\nOwned rule.\n## 2. Task\nTask description.\n## 3. Proof\nRetained contract.\n')
  await writeFile(join(workspace, 'proof.json'), '{"value":3}')
  const path = join(workspace, designHandoffPath(name))
  await writeFile(path, JSON.stringify({
    outputs: [{ id: 'rule', section: 'Rules', acceptance: { section: 'Rules', method: 'test' } }],
    implementationItems: [{ id: 'task', section: 'Task', dependsOn: [],
      requirementRefs: [{ document: name, id: 'rule' }] }],
    evidence: [{ id: 'proof', section: 'Proof', kind: 'contract', path: 'proof.json',
      source: 'Synthetic retained fact', pointer: '/value', expected: 3 }],
  }))
  expect(checkDesignHandoffDraft(workspace, name).valid).toBe(true)
  expect(finalizeDesignDocuments(workspace, [name], snapshot).issues).toEqual([])
  const result = JSON.parse(await readFile(path, 'utf8'))
  expect(result.implementationItems[0]).toEqual({ id: 'task', section: '2. Task', dependsOn: [],
    requirementRefs: [{ document: name, id: 'rule' }] })
  expect(result.evidence[0]).toMatchObject({ section: '3. Proof', path: 'proof.json',
    source: 'Synthetic retained fact', expected: 3 })
  await writeFile(join(workspace, 'proof.json'), '{"value":4}')
  expect(checkDesignHandoffDraft(workspace, name).valid).toBe(false)
}))

test('targeted verification uses actual edits, includes registered consumer clauses and falls back on moved headings', () => fixture(async workspace => {
  const path = join(workspace, 'docs/GDD.md')
  const original = (await readFile(path, 'utf8')).replace('# Design', '# GDD\n## Design') + '\n## Other clause\nOriginal\n'
  await writeFile(path, original)
  const before = snapshotDesignDocuments(workspace, ['GDD.md'])
  await writeFile(path, original.replace('Original', 'Changed'))
  expect(changedDesignSections(workspace, before)).toEqual({ 'GDD.md': ['Other clause'] })
  const scope = designReviewReadScope(workspace, ['GDD.md'], [], changedDesignSections(workspace, before))
  expect(scope['GDD.md']).toContain('Other clause')
  expect(scope['GDD.md']).not.toContain('Design')
  await writeFile(path, original.replace('## Other clause', '## Moved heading'))
  expect(changedDesignSections(workspace, before)).toEqual({ 'GDD.md': null })
}))

test('a located note correction does not select all owner outcomes or technical tasks', () => fixture(async workspace => {
  const body = (await readFile(join(workspace, 'docs/GDD.md'), 'utf8')).replace('# Design', '# GDD\n## Design')
  await writeFile(join(workspace, 'docs/GDD.md'), body + '\n## Publication note\nA non-rule note.\n')
  const finding: any = { id: 'note', documents: ['GDD.md'], sources: [{ document: 'GDD.md', section: 'Publication note' }] }
  const scope = designReviewReadScope(workspace, ['GDD.md', 'TECHNICAL_DESIGN.md'], [finding])
  expect(scope['GDD.md']).toEqual(['Publication note'])
  expect(scope['TECHNICAL_DESIGN.md']).toEqual([])
  const indexes = designReviewIndexes(workspace, ['GDD.md', 'TECHNICAL_DESIGN.md'], scope)
  expect(indexes[0]).toMatchObject({ outputs: [] })
  expect(indexes[1]).toMatchObject({ implementationItems: [] })
  expect(designReviewIndexes(workspace, ['TECHNICAL_DESIGN.md'])[0]).toMatchObject({
    implementationItems: designHandoffFixture('TECHNICAL_DESIGN.md').implementationItems,
  })
}))

test('affected input retains exact task/source pointers but excludes unrelated tasks; moved headings fall back', () => fixture(async workspace => {
  const tech = designHandoffFixture('TECHNICAL_DESIGN.md')
  tech.outputs[0]!.section = 'Interface'
  tech.outputs[0]!.acceptance!.section = 'Interface'
  tech.implementationItems!.forEach(item => { item.section = 'Other tasks' })
  tech.implementationItems![0]!.section = 'Changed task'
  await writeDesignDocumentFixture(workspace, 'TECHNICAL_DESIGN.md', tech,
    '# Technical\n- Version: v1.0\n## Interface\nContract\n## Changed task\nConsume rule\n## Other tasks\nUnchanged\n')
  const selected = designReviewIndexes(workspace, ['TECHNICAL_DESIGN.md'], { 'TECHNICAL_DESIGN.md': ['Changed task'] })[0]!
  expect(selected).toMatchObject({ implementationItems: [tech.implementationItems![0]!], outputs: [] })
  expect(selected).toMatchObject({ sourceReads: [{ file_path: 'docs/TECHNICAL_DESIGN.md', offset: 5, limit: 2 }] })
  expect(designReviewIndexes(workspace, ['TECHNICAL_DESIGN.md'], { 'TECHNICAL_DESIGN.md': [] })[0]).toMatchObject({ sourceReads: [] })
  for (const scope of [null, ['Missing heading']]) {
    const fallback = designReviewIndexes(workspace, ['TECHNICAL_DESIGN.md'], { 'TECHNICAL_DESIGN.md': scope })[0]!
    expect(fallback).toMatchObject({ implementationItems: tech.implementationItems, outputs: tech.outputs })
    expect(fallback).toMatchObject({ sourceReads: [{ file_path: 'docs/TECHNICAL_DESIGN.md', offset: 1, limit: 9 }] })
  }
}))

test('source Read locations merge nested/adjacent ranges and refresh from the resulting original file', () => fixture(async workspace => {
  const path = join(workspace, 'docs/GDD.md')
  const body = '# Design\r\n- Version: v1.0\r\nIntro\r\n## Rules\r\nMove.\r\n### Input\r\nPress.\r\n## Feedback\r\nFlash.\r\n## Unrelated\r\nNotes.'
  await writeFile(path, body)
  const scope = { 'GDD.md': ['Rules', 'Input', 'Feedback'] }
  expect(designReviewIndexes(workspace, ['GDD.md'], scope)[0])
    .toMatchObject({ sourceReads: [{ file_path: 'docs/GDD.md', offset: 4, limit: 6 }] })
  await writeFile(path, body.replace('Intro', 'Intro\r\nNew intro.'))
  expect(designReviewIndexes(workspace, ['GDD.md'], scope)[0])
    .toMatchObject({ sourceReads: [{ file_path: 'docs/GDD.md', offset: 5, limit: 6 }] })
}))

test('a changed outcome selects its acceptance and exact task consumers, not other task requirements', () => fixture(async workspace => {
  const gdd = designHandoffFixture('GDD.md')
  gdd.outputs[0]!.section = 'Rule'
  gdd.outputs[0]!.acceptance!.section = 'Check rule'
  await writeDesignDocumentFixture(workspace, 'GDD.md', gdd,
    '# GDD\n- Version: v1.0\n## Rule\nActual rule.\n## Check rule\nExpected result.\n## Other\nUnrelated.\n')
  const tech = designHandoffFixture('TECHNICAL_DESIGN.md')
  tech.implementationItems![0]!.section = 'Rule task'
  tech.implementationItems![1]!.section = 'Other task'
  await writeDesignDocumentFixture(workspace, 'TECHNICAL_DESIGN.md', tech,
    designDocumentFixture('TECHNICAL_DESIGN.md') + '\n## Rule task\nConsume Rule.\n## Other task\nOther work.\n')
  const scope = designReviewReadScope(workspace, ['GDD.md', 'TECHNICAL_DESIGN.md'], [], { 'GDD.md': ['Rule'] })
  expect(scope['GDD.md']).toEqual(['Rule', 'Check rule'])
  expect(scope['TECHNICAL_DESIGN.md']).toEqual(['Rule task'])
  expect(designReviewReadScope(workspace, ['GDD.md'], [], { 'GDD.md': null })['GDD.md']).toBeNull()
}))

test('owned draft checking rejects empty outcomes and missing acceptance without requiring siblings', () => fixture(async (workspace, put) => {
  for (const name of ['ART_DIRECTION.md', 'TECHNICAL_DESIGN.md'] as const) {
    await put(name, h => h.outputs = [])
    expect(checkDesignHandoffDraft(workspace, name).issues.join(' ')).toContain('owned delivery outcomes are missing')
  }
  await put('ART_DIRECTION.md', h => delete h.outputs[0].acceptance)
  expect(checkDesignHandoffDraft(workspace, 'ART_DIRECTION.md').issues.join(' ')).toContain('needs an acceptance section')
  await rm(join(workspace, 'docs/GDD.md'))
  await put('ART_DIRECTION.md', () => {})
  await writeFile(join(workspace, 'docs/ART_DIRECTION.md'), '# Design\n[Pending audio](AUDIO_DESIGN.md)\n')
  await rm(join(workspace, 'docs/AUDIO_DESIGN.md'))
  expect(checkDesignHandoffDraft(workspace, 'ART_DIRECTION.md')).toEqual({ valid: true, issues: [] })
}))

test.each(['missing', 'contract', 'capability', 'documentation', 'section', 'duplicate'] as const)(
  'owned draft checks declared evidence %s before joint revision, without demanding host hashes', kind => fixture(async (workspace, put) => {
    const proof = { id: 'proof', kind: 'contract', path: 'proof.json', source: 'Synthetic fixture',
      pointer: '/supported', expected: true } as any
    if (kind !== 'missing') await writeFile(join(workspace, 'proof.json'), JSON.stringify({ supported: kind !== 'contract' }))
    if (kind === 'capability') proof.kind = 'capability'
    if (kind === 'documentation') { proof.kind = 'documentation'; proof.source = 'http://example.org' }
    if (kind === 'section') proof.section = 'Absent'
    await put('GDD.md', h => { h.evidence = kind === 'duplicate' ? [proof, proof] : [proof] })
    expect(checkDesignHandoffDraft(workspace, 'GDD.md').valid).toBe(false)
    const index = join(workspace, designHandoffPath('GDD.md')), before = await readFile(index, 'utf8')
    checkDesignHandoffDraft(workspace, 'GDD.md')
    expect(await readFile(index, 'utf8')).toBe(before)
    await writeFile(join(workspace, 'proof.json'), JSON.stringify({ supported: true }))
    await put('GDD.md', h => h.evidence = [{ ...proof, kind: 'contract', source: 'Synthetic fixture', section: 'Design' }])
    expect(checkDesignHandoffDraft(workspace, 'GDD.md').valid).toBe(true)
    expect(JSON.parse(await readFile(index, 'utf8')).evidence[0].sha256).toBeUndefined()
  }),
)

test('the supplied new-index envelope validates and rejects version 1', () => fixture(async workspace => {
  const sample = DESIGN_HANDOFF_INSTRUCTION.split('Minimal new index envelope: ')[1]!.split('. Replace example')[0]!
  const envelope = JSON.parse(sample)
  envelope.outputs[0].section = 'Design'
  envelope.outputs[0].acceptance.section = 'Design'
  await writeFile(join(workspace, designHandoffPath('GDD.md')), JSON.stringify(envelope))
  expect(checkDesignHandoffDraft(workspace, 'GDD.md').valid).toBe(true)
  envelope.document = 'docs/GDD.md'
  await writeFile(join(workspace, designHandoffPath('GDD.md')), JSON.stringify(envelope))
  expect(checkDesignHandoffDraft(workspace, 'GDD.md').issues.join(' ')).toContain('document')
  envelope.version = 1
  await writeFile(join(workspace, designHandoffPath('GDD.md')), JSON.stringify(envelope))
  expect(checkDesignHandoffDraft(workspace, 'GDD.md').valid).toBe(false)
}))

test('save-time index checking catches field errors without demanding host versions or sibling delivery', () => fixture(async (workspace, put) => {
  const path = join(workspace, 'docs/BALANCE_DESIGN.md')
  await writeFile(path, (await readFile(path, 'utf8')).replace(/^.*Version:.*\n/m, ''))
  expect(checkDesignHandoffDraft(workspace, 'BALANCE_DESIGN.md').valid).toBe(true)
  await put('BALANCE_DESIGN.md', h => h.document = 'docs/BALANCE_DESIGN.md')
  expect(checkDesignHandoffDraft(workspace, 'BALANCE_DESIGN.md').issues.join(' ')).toContain('document')
  expect(checkDesignHandoffDraft(workspace, '../outside.md').valid).toBe(false)
}))

test('a malformed sibling index does not prevent host versioning of an independent valid owner', () => fixture(async (workspace, put) => {
  const names = ['LEVEL_SCENE_DESIGN.md', 'BALANCE_DESIGN.md'] as const
  for (const name of names) {
    const path = join(workspace, 'docs', name)
    await writeFile(path, (await readFile(path, 'utf8')).replace(/^.*Version:.*\n/m, ''))
  }
  const snapshot = snapshotDesignDocuments(workspace, names)
  await put('BALANCE_DESIGN.md', h => h.document = 'docs/BALANCE_DESIGN.md')
  const invalidBefore = await readFile(join(workspace, designHandoffPath('BALANCE_DESIGN.md')), 'utf8')
  const result = finalizeDesignDocuments(workspace, names, snapshot)
  expect(result.issues.join(' ')).toContain('BALANCE_DESIGN.md')
  expect(result.issues.join(' ')).not.toContain('LEVEL_SCENE_DESIGN.md')
  expect(designDocumentVersion(await readFile(join(workspace, 'docs/LEVEL_SCENE_DESIGN.md'), 'utf8'))).toBe('1.0')
  expect(await readFile(join(workspace, designHandoffPath('BALANCE_DESIGN.md')), 'utf8')).toBe(invalidBefore)
  expect(checkDesignHandoff(workspace, names).valid).toBe(false)
}))

test('Scene is owned by its linked scene document; binding completion preserves version, placement changes advance it', () => fixture(async workspace => {
  const path = 'content/scenes/level.json', scene = sceneLayoutFixture() as any
  scene.data.nodes[1].components = [{ id: 'visual', type: 'sprite-renderer', data: { size: [400, 200] } }]
  await writeFile(join(workspace, path), JSON.stringify(scene))
  const snapshot = snapshotDesignDocuments(workspace, ['LEVEL_SCENE_DESIGN.md'])
  const original = checkDesignHandoff(workspace, ['LEVEL_SCENE_DESIGN.md'])
  expect(designSupportingFiles(workspace, ['LEVEL_SCENE_DESIGN.md'])).toEqual([path])
  await writeFile(join(workspace, 'docs/TECHNICAL_DESIGN.md'), designDocumentFixture('TECHNICAL_DESIGN.md') + '\n[Scene](../content/scenes/level.json)\n')
  expect(designSupportingFiles(workspace, ['TECHNICAL_DESIGN.md'])).toEqual([])
  scene.assetRefs = ['atlas']
  scene.data.nodes[1].components[0].assetRef = 'atlas'
  Object.assign(scene.data.nodes[1].components[0].data, { member: 'sprites.png', frame: 'board' })
  await writeFile(join(workspace, path), JSON.stringify(scene))
  expect(checkDesignHandoff(workspace, ['LEVEL_SCENE_DESIGN.md']).revision).toBe(original.revision)
  expect(finalizeDesignDocuments(workspace, ['LEVEL_SCENE_DESIGN.md'], snapshot).issues).toEqual([])
  expect(designDocumentVersion(await readFile(join(workspace, 'docs/LEVEL_SCENE_DESIGN.md'), 'utf8'))).toBe('1.0')
  scene.data.nodes[1].transform.position[0] = 10
  await writeFile(join(workspace, path), JSON.stringify(scene))
  expect(checkDesignHandoff(workspace, ['LEVEL_SCENE_DESIGN.md']).revision).not.toBe(original.revision)
  expect(finalizeDesignDocuments(workspace, ['LEVEL_SCENE_DESIGN.md'], snapshot).issues).toEqual([])
  expect(designDocumentVersion(await readFile(join(workspace, 'docs/LEVEL_SCENE_DESIGN.md'), 'utf8'))).toBe('1.1')
}))

test('missing linked Scene authorizes only that exact repair; a live source cannot become immutable evidence', () => fixture(async (workspace, put) => {
  await rm(join(workspace, 'content/scenes/level.json'))
  expect(designSupportingFiles(workspace, ['LEVEL_SCENE_DESIGN.md'])).toEqual(['content/scenes/level.json'])
  expect(checkDesignHandoff(workspace, ['LEVEL_SCENE_DESIGN.md']).valid).toBe(false)
  await writeFile(join(workspace, 'content/scenes/level.json'), JSON.stringify(sceneLayoutFixture()))
  await put('LEVEL_SCENE_DESIGN.md', h => h.evidence.push({ id: 'scene', kind: 'contract',
    path: 'content/scenes/level.json', source: 'Synthetic Scene', section: 'Design', pointer: '/kind', expected: 'scene-2d' }))
  expect(checkDesignHandoff(workspace, ['LEVEL_SCENE_DESIGN.md']).issues.join(' ')).toContain('Live Scene source')
}))
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
  expect(readDesignAcceptanceRequirements(workspace).filter(source => source.document === 'GDD.md'))
    .toMatchObject([{ document: 'GDD.md', id: 'play', section: 'Design', method: 'test' }])
  expect(await readFile(join(workspace, designHandoffPath('GDD.md')), 'utf8')).toBe(before)
  expect(DESIGN_HANDOFF_INSTRUCTION).toContain('Authors do not calculate or synchronize versions/hashes')
}))
test('version 1 sidecars are rejected without rewriting files', () => fixture(async workspace => {
  const legacy = { ...designHandoffFixture('GDD.md'), version: 1, readiness: false, states: [{ transitions: false }],
    events: false, parameters: false, resources: false, inputs: false, consumes: [{ document: 'UI_UX_SPEC.md', id: 'invented' }],
    pending: [{ owner: 'user', neededBefore: 'resources' }], limits: false, platformFacts: false }
  Object.assign(legacy.outputs[0]!, { resourceRequired: true, soundRequired: true })
  await writeDesignDocumentFixture(workspace, 'GDD.md', legacy)
  const body = await readFile(join(workspace, 'docs/GDD.md'), 'utf8')
  const sidecar = await readFile(join(workspace, designHandoffPath('GDD.md')), 'utf8')
  const check = checkDesignHandoff(workspace, ['GDD.md'], { nextConsumers: ['resources'] })
  expect(check.valid).toBe(false)
  expect(check.issues.join(' ')).toContain('version')
  expect(() => readDesignAcceptanceRequirements(workspace)).toThrow()
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
  expect(checkDesignDocumentReferences(workspace, 'GDD.md').valid).toBe(false)
}))
test('numeric document version comparison stays available for released-baseline guards', () => {
  expect(designDocumentVersion('# Design\n- 版本：v1.9.2\n')).toBe('1.9.2')
  expect(isHigherDocumentVersion('1.10', '1.9.2')).toBe(true)
  expect(isHigherDocumentVersion('1.0.1', '1.0')).toBe(true)
  expect(isHigherDocumentVersion('1.0.0', '1.0')).toBe(false)
  expect(isHigherDocumentVersion('0.9', '1.0')).toBe(false)
  expect(() => designDocumentVersion('- Version: v1.0\n- Version: v1.1')).toThrow('handoff.mjs --design finalize DOCUMENT.md')
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
  expect(checkDesignDocumentReferences(workspace, 'BALANCE_DESIGN.md').valid).toBe(false)
}))

test('reference links do not authenticate images, grant writes or bind image bytes to document versions', () => fixture(async workspace => {
  await mkdir(join(workspace, 'docs/visual/ART_DIRECTION'), { recursive: true })
  const art = 'docs/visual/ART_DIRECTION/reference.PNG'
  await writeFile(join(workspace, art), 'Fixture reference bytes; not claiming an image read')
  const doc = join(workspace,'docs/ART_DIRECTION.md')
  await writeFile(doc,designDocumentFixture('ART_DIRECTION.md') + '\n[Reference](visual/ART_DIRECTION/reference.PNG)\n')
  expect(designSupportingFiles(workspace,['ART_DIRECTION.md'])).toEqual([])
  const snapshot = snapshotDesignDocuments(workspace,['ART_DIRECTION.md'])
  const before = checkDesignHandoff(workspace,['ART_DIRECTION.md'])
  expect(before.valid).toBe(true)
  expect(before.evidenceHashes).not.toHaveProperty(art)
  await writeFile(join(workspace,art),'Changed reference bytes')
  expect(checkDesignHandoff(workspace,['ART_DIRECTION.md']).revision).toBe(before.revision)
  expect(finalizeDesignDocuments(workspace,['ART_DIRECTION.md'],snapshot).issues).toEqual([])
  expect(designDocumentVersion(await readFile(doc,'utf8'))).toBe('1.0')
  expect(DESIGN_HANDOFF_INSTRUCTION).toContain('native Read tool')
  expect(DESIGN_HANDOFF_INSTRUCTION).toContain('report the exact path and read error')
  expect(DESIGN_HANDOFF_INSTRUCTION).not.toContain('host matches')
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
  ui.data.nodes[1].style = { texture: { assetRef: 'planned-texture' } }
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


test.each(['missing-document', 'missing-index', 'malformed-index'] as const)(
  'technical draft preserves independently valid planning inputs: %s', mode => fixture(async workspace => {
    const tech = join(workspace, mode === 'missing-document' ? 'docs/TECHNICAL_DESIGN.md' : designHandoffPath('TECHNICAL_DESIGN.md'))
    if (mode === 'malformed-index') await writeFile(tech, '{')
    else await rm(tech)
    const ui = designHandoffFixture('UI_UX_SPEC.md')
    ui.outputs[0]!.section = 'Absent heading'
    await writeFile(join(workspace, designHandoffPath('UI_UX_SPEC.md')), JSON.stringify(ui))
    const result = checkDesignHandoffDraft(workspace, 'TECHNICAL_DESIGN.md', {finalTechnical:true})
    expect(result.valid).toBe(false)
    expect(result.availableRequirements?.some(item=>item.document==='GDD.md')).toBe(true)
    expect(result.availableRequirements?.some(item=>item.document==='UI_UX_SPEC.md')).toBe(false)
    expect(result.availableRequirements?.some(item=>item.document==='TECHNICAL_DESIGN.md')).toBe(false)
  }),
)
