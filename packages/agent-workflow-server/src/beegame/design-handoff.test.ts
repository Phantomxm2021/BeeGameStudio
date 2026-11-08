import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm, rename, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkDesignHandoff, checkDesignHandoffDraft, designSupportingFiles, designDocumentVersion, designHandoffPath,
  readDesignAcceptanceRequirements,
  type DesignDocument } from './design-handoff'
import { designDocumentFixture, designHandoffFixture, writeDesignDocumentFixture, writeDesignDocumentsFixture, sceneLayoutFixture } from './fixtures/layout-fixture'
import { checkDesignDocumentReferences } from './design-document-references'

const digest = (body: string) => createHash('sha256').update(body).digest('hex')

test('readable GDD task pointers do not require retired Scene/UI registration', () => fixture(async workspace => {
  // No documents metadata: kinds must come from the saved documents.
  await writeFile(join(workspace, 'content/index.json'), JSON.stringify({ schema: 'beegame-content-package.v2',
    id: 'fixture', dimension: '2d', entryScene: 'level', files: ['ui/menu.json', 'scenes/level.json'] }))
  const originals = new Map<string, string>()
  for (const owner of ['GDD.md']) {
    const path = join(workspace, 'docs', owner), body = await readFile(path, 'utf8')
    originals.set(path, body)
    await writeFile(path, body.replace(/\[[^\]]*\]\((\.\.\/content\/[^)]+)\)/g, '`$1`'))
  }
  expect(checkDesignHandoff(workspace, [...originals.keys()].map(path => path.split('/').at(-1) as DesignDocument)).valid).toBe(true)
  for (const [path, body] of originals) await writeFile(path, body)
  for (const source of ['ui/menu.json', 'scenes/level.json'])
    await writeFile(join(workspace, 'content', source.replace('.json', '-actual.json')), await readFile(join(workspace, 'content', source)))
  await writeFile(join(workspace, 'content/index.json'), JSON.stringify({ schema: 'beegame-content-package.v2',
    id: 'fixture', dimension: '2d', entryScene: 'level', files: ['ui/menu-actual.json', 'scenes/level-actual.json'] }))
  expect(checkDesignHandoffDraft(workspace,'GDD.md').valid).toBe(true)
  expect(checkDesignHandoff(workspace,['GDD.md']).valid).toBe(true)
}))

test.each(['absent','matching','mismatch','missing-header','duplicate-header','malformed-header'] as const)(
  'optional historical version metadata preserves source identity and validates explicit claims: %s',kind=>fixture(async workspace=>{
    const source=join(workspace,'docs/GDD.md'),index=join(workspace,designHandoffPath('GDD.md'))
    const body='# Design\n'+(kind==='absent'||kind==='missing-header'?'':kind==='malformed-header'?'- Version: invalid\n':
      kind==='duplicate-header'?'- Version: v1.0\n- Version: v1.0\n':'- Version: v1.0\n')+'## Rule\nSaved decision.\n'
    const metadata={version:2,...(kind==='absent'?{}:{documentVersion:kind==='mismatch'?'2.0':'1.0'}),
      outputs:[{id:'rule',section:'Rule',acceptance:{section:'Rule',method:'inspection'}}],evidence:[]}
    await writeFile(source,body);await writeFile(index,JSON.stringify(metadata))
    const saved=await readFile(index,'utf8'),result=checkDesignHandoff(workspace,['GDD.md'])
    expect(result.valid).toBe(kind==='absent'||kind==='matching')
    if(result.valid) {
      expect(readDesignAcceptanceRequirements(workspace)[0]?.id).toBe('rule')
    } else {
      expect(()=>readDesignAcceptanceRequirements(workspace)).toThrow()
    }
    expect(result.snapshots['GDD.md']).toMatch(/^[a-f0-9]{64}$/)
    if(kind==='matching')expect(result.documentVersions).toEqual({'GDD.md':'1.0'})
    if(kind==='absent')expect(result.documentVersions).toEqual({})
    expect(await readFile(source,'utf8')).toBe(body)
    expect(await readFile(index,'utf8')).toBe(saved)
  }))

test('document handoff does not constrain HTML/SVG game implementation', () => fixture(async workspace => {
  await mkdir(join(workspace,'src'),{recursive:true})
  await writeFile(join(workspace,'src/index.html'),'<main onclick="play()">Game</main>')
  await writeFile(join(workspace,'src/icon.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>')
  const doc=join(workspace,'docs/GDD.md')
  await writeFile(doc,await readFile(doc,'utf8')+'\n[Game](../src/index.html)\n[Icon](../src/icon.svg)\n')
  expect(designSupportingFiles(workspace,['GDD.md'])).toEqual(['content/scenes/level.json', 'content/ui/menu.json'])
  expect(checkDesignHandoff(workspace,['GDD.md']).valid).toBe(true)
}))

test.each(['GDD.md'] as const)(
  '%s: numbering-only pointers normalize for reads without changing saved sources', name => fixture(async workspace => {

    const prose = '# Design\n## 2.1 Core rule\nDecision.\n## 3) Acceptance\nExpected outcome.\n'
    await writeFile(join(workspace, 'docs', name), prose)
    const index = { outputs: [{ id: 'core', section: 'Core rule',
      acceptance: { section: '9. Acceptance', method: 'test' } }], evidence: [] }
    const path = join(workspace, designHandoffPath(name)), saved = JSON.stringify(index)
    await writeFile(path, saved)
    const untouched = await readFile(join(workspace, 'docs/GDD.md'), 'utf8')
    expect(checkDesignHandoffDraft(workspace, name).issues).toEqual([])
    expect(await readFile(path, 'utf8')).toBe(saved)
    expect(await readFile(join(workspace, 'docs', name), 'utf8')).toBe(prose)
    expect(checkDesignHandoff(workspace, [name]).issues).toEqual([])
    expect(readDesignAcceptanceRequirements(workspace)[0]).toMatchObject({id:'core',outputSection:'2.1 Core rule',section:'3) Acceptance',method:'test'})
    expect(checkDesignHandoff(workspace, [name], { includeRequirements: true }).valid).toBe(true)
    expect(await readFile(join(workspace, 'docs/GDD.md'), 'utf8')).toBe(untouched)
    const finalBytes = await readFile(path, 'utf8')
    expect(checkDesignHandoff(workspace, [name]).issues).toEqual([])
    expect(await readFile(path, 'utf8')).toBe(saved)
    expect(finalBytes).toBe(saved)
  }),
)

test.each([
  ['## 2.1 `Core rule`', '### 3) **Acceptance** for `ready`'],
  ['**Core rule**', 'Acceptance for `ready`'],
])('Markdown heading pointers normalize without rewriting prose: %s / %s', (section, acceptance) => fixture(async workspace => {
  const name = 'GDD.md'
  const prose = '# Design\n## 2.1 `Core rule`\nDecision.\n## 3) **Acceptance** for `ready`\nExpected outcome.\n'
  const path = join(workspace, designHandoffPath(name))
  const saved = JSON.stringify({ outputs: [{ id: 'core', section,
    acceptance: { section: acceptance, method: 'test' } }], evidence: [] })
  await writeFile(join(workspace, 'docs', name), prose)
  await writeFile(path, saved)
  expect(checkDesignHandoffDraft(workspace, name).issues).toEqual([])
  expect(await readFile(path, 'utf8')).toBe(saved)
  expect(await readFile(join(workspace, 'docs', name), 'utf8')).toBe(prose)
  expect(checkDesignHandoff(workspace, [name]).issues).toEqual([])
  expect(readDesignAcceptanceRequirements(workspace)[0]).toMatchObject({id:'core',outputSection:'2.1 Core rule',section:'3) Acceptance for ready',method:'test'})
  expect(await readFile(path,'utf8')).toBe(saved)
  expect(checkDesignHandoff(workspace, [name], { includeRequirements: true }).valid).toBe(true)
}))

test.each([
  ['## \\# ready\nLiteral marker.\n## ready\nOther.\n', '# ready'],
  ['## Use \\`ready\\` literally\nLiteral markers.\n## Use ready literally\nOther.\n', 'Use `ready` literally'],
])('exact literal heading wins over Markdown interpretation: %s / %s', (headings, section) => fixture(async workspace => {
  const name = 'GDD.md'
  const path = join(workspace, designHandoffPath(name))
  await writeFile(join(workspace, 'docs', name), '# Design\n' + headings)
  await writeFile(path, JSON.stringify({ outputs: [{ id: 'core', section,
    acceptance: { section, method: 'test' } }], evidence: [] }))
  expect(checkDesignHandoffDraft(workspace, name).valid).toBe(true)
  expect(checkDesignHandoff(workspace, [name]).issues).toEqual([])
  expect(JSON.parse(await readFile(path, 'utf8')).outputs[0].section).toBe(section)
}))

test.each([
  ['## 1. Rules\nA\n## 2. Rules\nB\n', 'Rules'],
  ['## 1. Rules\nA\n## 1. Rules\nB\n', 'Rules'],
  ['## 1. Rules\nA\n', 'Different rules'],
  ['## 20 enemies\nA\n', '10 enemies'],
  ['## 3D models\nA\n', 'models'],
  ['## 1. `Rules`\nA\n## 2. **Rules**\nB\n', '### `Rules`'],
  ['## `Rules`\nA\n## **Rules**\nB\n', 'Rules'],
  ['## 1. `Rules`\nA\n', '## `Different rules`'],
  ['## Rules\nA\n', '## Missing\n## Rules'],
])('no heading guesses or writes: %s / %s', (headings, pointer) => fixture(async workspace => {

  await writeFile(join(workspace, 'docs/GDD.md'), '# Design\n' + headings)
  const index = { outputs: [{ id: 'core', section: pointer,
    acceptance: { section: pointer, method: 'test' } }], evidence: [] }
  const path = join(workspace, designHandoffPath('GDD.md')), saved = JSON.stringify(index)
  await writeFile(path, saved)
  expect(checkDesignHandoffDraft(workspace, 'GDD.md').valid).toBe(false)
  expect(checkDesignHandoff(workspace, ['GDD.md']).issues.length).toBeGreaterThan(0)
  expect(await readFile(path, 'utf8')).toBe(saved)
}))

test.each([
  ['## 4.1 Resource atlas\nDecision.\n', '4.1 Resource atlas', true],
  ['## 4.1 Resource `atlas`\nDecision.\n', '4.1 Resource `atlas`', true],
  ['## 4.1 Resource atlas\nDecision.\n', 'Resource atlas', true],
  ['## Use \\`atlas\\` literally\nDecision.\n## Use atlas literally\nOther.\n', 'Use `atlas` literally', true],
  ['## 1. Resource\nA.\n## 2. Resource\nB.\n', 'Resource', false],
  ['## Resource\nA.\n## Resource\nB.\n', 'Resource', false],
  ['## Resource\nDecision.\n', 'Missing section', false],
])('draft and baseline agree on saved heading pointers: %s / %s', (headings, section, valid) => fixture(async workspace => {
  const name = 'GDD.md', prose = '# Plan\n- Version: v1.0\n' + headings
  const index = JSON.stringify({ version: 2, documentVersion: '1.0',
    outputs: [{ id: 'resource', section, acceptance: { section, method: 'inspection' } }], evidence: [] })
  const path = join(workspace, designHandoffPath(name))
  await writeFile(join(workspace, 'docs', name), prose)
  await writeFile(path, index)
  expect(checkDesignHandoffDraft(workspace, name).valid).toBe(valid)
  const baseline = checkDesignHandoff(workspace, [name], { includeRequirements: true })
  expect(baseline.valid).toBe(valid)
  expect(baseline.availableRequirements).toHaveLength(valid ? 1 : 0)
  expect(await readFile(path, 'utf8')).toBe(index)
  expect(await readFile(join(workspace, 'docs', name), 'utf8')).toBe(prose)
}))

test('heading normalization includes task and retained-evidence pointers without changing their facts', () => fixture(async workspace => {
  const name = 'GDD.md'
  await writeFile(join(workspace, 'docs', name),
    '# Design\n## 1. `Rules`\nOwned rule.\n## 2. **Task**\nTask description.\n## 3. `Proof`\nRetained contract.\n')
  await writeFile(join(workspace, 'proof.json'), '{"value":3}')
  const path = join(workspace, designHandoffPath(name))
  await writeFile(path, JSON.stringify({
    outputs: [{ id: 'rule', section: '## `Rules`', acceptance: { section: '**Rules**', method: 'test' } }],
    implementationItems: [{ id: 'task', section: '## **Task**', dependsOn: [],
      requirementRefs: [{ document: name, id: 'rule' }] }],
    evidence: [{ id: 'proof', section: '### `Proof`', kind: 'contract', path: 'proof.json',
      source: 'Synthetic retained fact', pointer: '/value', expected: 3 }],
  }))
  expect(checkDesignHandoffDraft(workspace, name).valid).toBe(true)
  expect(checkDesignHandoff(workspace, [name]).issues).toEqual([])
  await writeFile(join(workspace, 'proof.json'), '{"value":4}')
  expect(checkDesignHandoffDraft(workspace, name).valid).toBe(false)
}))

test('owned draft checking validates GDD task references without later delivery', () => fixture(async (workspace, put) => {
  await put('GDD.md', h => { h.outputs = []; delete h.implementationItems })
  expect(checkDesignHandoffDraft(workspace, 'GDD.md').issues).toEqual([])
  await put('GDD.md', h => delete h.outputs[0].acceptance)
  expect(checkDesignHandoffDraft(workspace, 'GDD.md').issues.join(' ')).toContain('has no acceptance section')
  await rm(join(workspace, 'docs/GDD.md'))
  await put('GDD.md', () => {})
  await writeFile(join(workspace, 'docs/GDD.md'), '# Design\n[Pending input](GDD.md)\n')
  await rm(join(workspace, 'docs/GDD.md'))
  expect(checkDesignHandoffDraft(workspace, 'GDD.md')).toMatchObject({ valid: false })
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

test('existing index envelopes remain readable and reject malformed or unsupported fields', () => fixture(async workspace => {
  const envelope: any = { outputs: [{ id: 'owned-outcome', section: 'Design', acceptance: { section: 'Design', method: 'test' } }], evidence: [] }
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

test('save-time index checking catches field errors without demanding host versions or later delivery', () => fixture(async (workspace, put) => {
  const path = join(workspace, 'docs/GDD.md')
  await writeFile(path, (await readFile(path, 'utf8')).replace(/^.*Version:.*\n/m, ''))
  expect(checkDesignHandoffDraft(workspace, 'GDD.md').valid).toBe(true)
  await put('GDD.md', h => h.document = 'docs/GDD.md')
  expect(checkDesignHandoffDraft(workspace, 'GDD.md').issues.join(' ')).toContain('document')
  expect(checkDesignHandoffDraft(workspace, '../outside.md').valid).toBe(false)
}))

test('missing linked Scene authorizes only that exact repair; a live source cannot become immutable evidence', () => fixture(async (workspace, put) => {
  await rm(join(workspace, 'content/scenes/level.json'))
  expect(designSupportingFiles(workspace, ['GDD.md'])).toEqual(['content/scenes/level.json', 'content/ui/menu.json'])
  expect(checkDesignHandoff(workspace, ['GDD.md']).valid).toBe(false)
  await writeFile(join(workspace, 'content/scenes/level.json'), JSON.stringify(sceneLayoutFixture()))
  await put('GDD.md', h => h.evidence.push({ id: 'scene', kind: 'contract',
    path: 'content/scenes/level.json', source: 'Synthetic Scene', section: 'Design', pointer: '/kind', expected: 'scene-2d' }))
  expect(checkDesignHandoff(workspace, ['GDD.md']).issues.join(' ')).toContain('Live Scene source')
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
  const check = checkDesignHandoff(workspace, ['GDD.md'], { includeRequirements: true })
  expect(check.valid).toBe(true)
  expect(check.note).toContain('do not establish design completeness')
  expect(check.documentVersions).toEqual({ 'GDD.md': '1.0' })
  expect(readDesignAcceptanceRequirements(workspace).filter(source => source.document === 'GDD.md'))
    .toMatchObject([{ document: 'GDD.md', id: 'play', section: 'Design', method: 'test' }])
  expect(await readFile(join(workspace, designHandoffPath('GDD.md')), 'utf8')).toBe(before)
}))
test('version 1 sidecars are rejected without rewriting files', () => fixture(async workspace => {
  const legacy = { ...designHandoffFixture('GDD.md'), version: 1, readiness: false, states: [{ transitions: false }],
    events: false, parameters: false, resources: false, inputs: false, consumes: [{ document: 'GDD.md', id: 'invented' }],
    pending: [{ owner: 'user', neededBefore: 'resources' }], limits: false, platformFacts: false }
  Object.assign(legacy.outputs[0]!, { resourceRequired: true, soundRequired: true })
  await writeDesignDocumentFixture(workspace, 'GDD.md', legacy)
  const body = await readFile(join(workspace, 'docs/GDD.md'), 'utf8')
  const sidecar = await readFile(join(workspace, designHandoffPath('GDD.md')), 'utf8')
  const check = checkDesignHandoff(workspace, ['GDD.md'], { includeRequirements: true })
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
test('missing indexes stay optional and malformed supplied indexes never rewrite sources', () => fixture(async workspace => {
  const source=join(workspace,'docs/GDD.md'),file=join(workspace,designHandoffPath('GDD.md'))
  const body=await readFile(source,'utf8')
  await rm(file)
  expect(checkDesignHandoff(workspace,['GDD.md']).valid).toBe(true)
  for(const index of ['{broken}','']) {
    await writeFile(file,index)
    expect(checkDesignHandoffDraft(workspace,'GDD.md').valid).toBe(false)
    expect(await readFile(file,'utf8')).toBe(index)
    expect(await readFile(source,'utf8')).toBe(body)
  }
  await writeFile(file,JSON.stringify(designHandoffFixture('GDD.md')))
  expect(checkDesignHandoff(workspace,['GDD.md']).valid).toBe(true)
  expect(await readFile(source,'utf8')).toBe(body)
}))
test.each(['section', 'acceptance-section', 'duplicate', 'method'] as const)(
  'actual consumer index rejects %s failure', kind => fixture(async (workspace, put) => {
    await put('GDD.md', h => {
      if (kind === 'section') h.outputs[0].section = 'Absent'
      if (kind === 'acceptance-section') h.outputs[0].acceptance.section = 'Absent'
      if (kind === 'duplicate') h.outputs.push(h.outputs[0])
      if (kind === 'method') h.outputs[0].acceptance.method = 'review'
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
test('document version parsing accepts numeric metadata and rejects duplicate headers', () => {
  expect(designDocumentVersion('# Design\n- 版本：v1.9.2\n')).toBe('1.9.2')
  expect(() => designDocumentVersion('- Version: v1.0\n- Version: v1.1')).toThrow('Refresh the document and its existing source/version metadata')
})
test('only existing explicitly cited calculation files enter scoped writes and revision identity', () => fixture(async workspace => {
  await mkdir(join(workspace, 'docs/calc'), { recursive: true })
  await writeFile(join(workspace, 'docs/calc/model.mjs'), 'export default {}')
  await writeFile(join(workspace, 'docs/calc/appendix.md'), 'Numerical result')
  await writeFile(join(workspace, 'docs/calc/unrelated.json'), '{}')
  await writeFile(join(workspace, 'docs/GDD.md'), designDocumentFixture('GDD.md') +
    '[Model](calc/model.mjs)\n[Results][result]\n\n[result]: calc/appendix.md\n')
  expect(designSupportingFiles(workspace, ['GDD.md'])).toEqual(['content/scenes/level.json', 'content/ui/menu.json', 'docs/calc/appendix.md', 'docs/calc/model.mjs'])
  const original = checkDesignHandoff(workspace, ['GDD.md'])
  expect(Object.keys(original.evidenceHashes).filter(path => path.startsWith('docs/calc/')).sort()).toEqual(['docs/calc/appendix.md', 'docs/calc/model.mjs'])
  await writeFile(join(workspace, 'docs/calc/model.mjs'), 'export default { changed: true }')
  expect(checkDesignHandoff(workspace, ['GDD.md']).revision).not.toBe(original.revision)
  await rm(join(workspace, 'docs/calc/model.mjs'))
  await symlink(join(workspace, 'docs/calc/unrelated.json'), join(workspace, 'docs/calc/model.mjs'))
  expect(() => designSupportingFiles(workspace, ['GDD.md'])).toThrow('must not be a symlink')
  await writeFile(join(workspace, 'docs/GDD.md'), designDocumentFixture('GDD.md') + '\n[Missing](calc/missing.json)\n')
  expect(designSupportingFiles(workspace, ['GDD.md'])).toEqual(['content/scenes/level.json', 'content/ui/menu.json'])
  expect(checkDesignDocumentReferences(workspace, 'GDD.md').valid).toBe(false)
}))


test('GDD draft exposes its own available requirements without a cross-document planning gate', () => fixture(async workspace => {
  const result = checkDesignHandoffDraft(workspace, 'GDD.md', { includeRequirements: true })
  expect(result.valid).toBe(true)
  expect(result.availableRequirements).toEqual([{ document: 'GDD.md', id: 'play', section: 'Design' }])
  await rm(join(workspace, designHandoffPath('GDD.md')))
  const withoutIndex = checkDesignHandoffDraft(workspace, 'GDD.md', { includeRequirements: true })
  expect(withoutIndex.valid).toBe(true)
  expect(withoutIndex.availableRequirements ?? []).toEqual([])
  await rm(join(workspace, 'docs/GDD.md'))
  expect(checkDesignHandoffDraft(workspace, 'GDD.md')).toMatchObject({ valid: false })
}))
