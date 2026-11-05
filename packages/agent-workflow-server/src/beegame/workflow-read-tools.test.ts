import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { readDesignHandoff, readImplementationTask, checkResourcesAndBindings } from './workflow-read-tools'
import { prepareNativeMcpConfig, NATIVE_READ_TOOLS } from './native-mcp-config'
import { designDocumentFixture, designHandoffFixture, writeDesignDocumentFixture, writeDesignDocumentsFixture, uiLayoutFixture } from './fixtures/layout-fixture'
import { checkDesignHandoffDraft, designHandoffPath, designReviewIndexes } from './design-handoff'
import { assetManifestAuthoringExamples } from './asset-manifest-authoring-contract'
import { writeBeeGameAssetManifest } from './asset-contracts'
import sharp from 'sharp'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bgs-read-tools-'))); roots.push(root)
  return root
}
function save(root: string, file: string, value: unknown) {
  const path = join(root, file); mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value))
}
function snapshot(root: string) {
  return Object.fromEntries((readdirSync(root, { recursive: true, withFileTypes: true }) as any[])
    .filter(entry => entry.isFile()).map(entry => {
      const path = join(entry.parentPath, entry.name)
      return [path.slice(root.length + 1), createHash('sha256').update(readFileSync(path)).digest('hex')]
    }))
}

function minimalGlb() {
  const text = JSON.stringify({ asset: { version: '2.0' }, meshes: [{ primitives: [] }] })
  const json = Buffer.from(text.padEnd(Math.ceil(text.length / 4) * 4, ' '))
  const header = Buffer.alloc(20)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(20 + json.length, 8)
  header.writeUInt32LE(json.length, 12)
  header.writeUInt32LE(0x4e4f534a, 16)
  return Buffer.concat([header, json])
}

function scene3dMesh(assetRef: string, member?: string) {
  return { schema: 'beegame-content.v1', id: 'scene', kind: 'scene-3d', assetRefs: [assetRef], data: { cameraNodeId: 'camera', nodes: [
    { id: 'camera', transform: { position: [0, 2, -8], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [
      { id: 'camera-main', type: 'camera', data: { orthographic: false, fieldOfView: 60, coordinateSpace: 'world-units' } },
    ] },
    { id: 'actor', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [
      { id: 'actor-mesh', type: 'mesh-filter', assetRef, data: member ? { member } : {} },
      { id: 'actor-renderer', type: 'mesh-renderer', data: { material: { mode: 'standard' } } },
    ] },
  ] } }
}

test('design read retains available source text with a missing selected section; no finalize/lock/files', async () => {
  const root = fixture()
  await writeDesignDocumentFixture(root, 'GDD.md')
  const before = snapshot(root)
  const result = readDesignHandoff(root, { read: [
    { document: 'GDD.md', sections: ['Design'] }, { document: 'GDD.md', sections: ['Absent'] },
  ] })
  expect(result.valid).toBe(false)
  expect(result.documents).toHaveLength(1)
  expect(result.sources[0]!.reads[0]!.text).toContain('Fixture decision.')
  expect(result.documents.find(item => item.document === 'GDD.md')).not.toHaveProperty('requirementCount')
  expect(snapshot(root)).toEqual(before)
  expect(() => readDesignHandoff(root, { read: [{ document: '../secret.md', sections: ['Design'] }] })).toThrow()
})

test('design reads distinguish availability from delivery completeness without requiring indexes', () => {
  const root = fixture()
  const empty = readDesignHandoff(root, {})
  expect(empty.valid).toBe(true)
  expect(empty.issues).toEqual([])
  expect(empty.documents).toHaveLength(1)
  expect(empty.documents.every(document => !document.available)).toBe(true)
  expect(empty).not.toHaveProperty('contracts')
  expect(JSON.stringify(empty)).not.toContain('check-content.mjs')
  expect(empty.note).toContain('the document title reads the full file')
  save(root, 'docs/GDD.md', '# GDD\n\n' + Array.from({ length: 250 }, (_, i) => `## Decision ${i}\nOriginal prose ${i}.\n`).join('\n'))
  const before = snapshot(root), overview = readDesignHandoff(root, {})
  expect(overview.valid).toBe(true)
  expect(overview.documents[0]).toMatchObject({ document: 'GDD.md', available: true })
  expect(overview.documents[0]).not.toHaveProperty('sections')
  expect(overview.documents[0]).not.toHaveProperty('requirementCount')
  expect(JSON.stringify(overview).length).toBeLessThan(3000)
  const directory = readDesignHandoff(root, { read: [{ document: 'GDD.md' }] })
  expect(directory.valid).toBe(true)
  expect(directory.documents[0]!.sections).toHaveLength(251)
  const whole = readDesignHandoff(root, {read:[{document:'GDD.md',sections:['GDD','Decision 3']}]})
  expect(whole.valid).toBe(true)
  expect(whole.sources[0]!.reads).toHaveLength(1)
  expect(whole.sources[0]!.reads[0]!.text).toBe(readFileSync(join(root,'docs/GDD.md'),'utf8'))
  const selected = readDesignHandoff(root, { read: [{ document: 'GDD.md', sections: ['Decision 3'] }] })
  expect(selected.valid).toBe(true)
  expect(selected.issues).toEqual([])
  expect(selected.sources[0]!.reads[0]!.text).toContain('Original prose 3.')
  expect(selected.documents[0]!.sections).toHaveLength(1)
  const absent = { read: [{ document: 'GDD.md', sections: ['Absent'] }] }
  const firstAbsent = readDesignHandoff(root, absent), secondAbsent = readDesignHandoff(root, absent)
  const secondValid = secondAbsent.valid
  expect(!secondValid).toBe(true)
  expect(readDesignHandoff(root, { read: [{ document: 'GDD.md' }] }).valid).toBe(true)
  const originalBody = readFileSync(join(root, 'docs/GDD.md'), 'utf8')
  writeFileSync(join(root, 'docs/actual.md'), originalBody)
  rmSync(join(root, 'docs/GDD.md'))
  symlinkSync(join(root, 'docs/actual.md'), join(root, 'docs/GDD.md'))
  expect(readDesignHandoff(root, { read: [{ document: 'GDD.md' }] }).valid).toBe(false)
  rmSync(join(root, 'docs/GDD.md'))
  rmSync(join(root, 'docs/actual.md'))
  writeFileSync(join(root, 'docs/GDD.md'), originalBody)
  expect(snapshot(root)).toEqual(before)
})

test('design source reads share Markdown heading resolution while retaining literal symbols and source bytes', () => {
  const root = fixture()
  const body = '# Design\n## 9.2 状态一：开始画面 `Ready`\nREADY_SOURCE\n' +
    '## **Playing**\nPLAY_SOURCE\n## [Result](#outcome)\nRESULT_SOURCE\n' +
    '## Literal `*keep*`\nLITERAL_SYMBOL_SOURCE\n## Literal keep\nOTHER_LITERAL_SOURCE\n'
  save(root, 'docs/GDD.md', body)
  const before = snapshot(root)
  for (const heading of ['9.2 状态一：开始画面 `Ready`', '9.2 状态一：开始画面 Ready', '### 9.2 状态一：开始画面 `Ready`']) {
    const result = readDesignHandoff(root, { read: [{ document: 'GDD.md', sections: [heading] }] })
    expect(result.valid).toBe(true)
    expect(result.issues).toEqual([])
    expect(result.documents[0]!.sections?.map(section => section.heading)).toEqual(['9.2 状态一：开始画面 Ready'])
    expect(result.sources[0]!.reads).toEqual([{ file_path: 'docs/GDD.md', offset: 2, limit: 2,
      text: '## 9.2 状态一：开始画面 `Ready`\nREADY_SOURCE' }])
  }
  const formatted = readDesignHandoff(root, { read: [{ document: 'GDD.md', sections: ['**Playing**', '[Result](#outcome)'] }] })
  expect(formatted.valid).toBe(true)
  expect(formatted.documents[0]!.sections?.map(section => section.heading)).toEqual(['Playing', 'Result'])
  expect(formatted.sources[0]!.reads[0]!.text).toContain('PLAY_SOURCE')
  expect(formatted.sources[0]!.reads[0]!.text).toContain('RESULT_SOURCE')
  const literal = readDesignHandoff(root, { read: [{ document: 'GDD.md', sections: ['Literal *keep*'] }] })
  expect(literal.valid).toBe(true)
  expect(literal.documents[0]!.sections?.map(section => section.heading)).toEqual(['Literal *keep*'])
  expect(literal.sources[0]!.reads[0]!.text).toContain('LITERAL_SYMBOL_SOURCE')
  expect(literal.sources[0]!.reads[0]!.text).not.toContain('OTHER_LITERAL_SOURCE')
  for (const heading of ['状态一：开始画面 Ready', '9.2 状态一：开始画面 Readyy', 'Missing\n## Playing']) {
    const missing = readDesignHandoff(root, { read: [{ document: 'GDD.md', sections: [heading] }] })
    expect(missing.valid).toBe(false)
    expect(missing.issues.join(' ')).toContain('missing/ambiguous heading')
    expect(missing.sources).toEqual([])
  }
  expect(snapshot(root)).toEqual(before)
})

test('formatted duplicate source headings remain ambiguous for literal and Markdown references', () => {
  const root = fixture()
  save(root, 'docs/GDD.md', '# Design\n## **Repeated**\nFIRST_SOURCE\n## Repeated\nSECOND_SOURCE\n')
  const before = snapshot(root)
  for (const heading of ['Repeated', '**Repeated**', '## **Repeated**']) {
    const result = readDesignHandoff(root, { read: [{ document: 'GDD.md', sections: [heading] }] })
    expect(result.valid).toBe(false)
    expect(result.issues.join(' ')).toContain('missing/ambiguous heading')
    expect(result.sources).toEqual([])
  }
  expect(snapshot(root)).toEqual(before)
})

test('delivered GDD remains source availability, not quality approval', () => {
  const root = fixture()
  for (const document of readDesignHandoff(root, {}).documents)
    save(root, document.path, '# Design\nUnverified author decisions.\n')
  const before = snapshot(root), result = readDesignHandoff(root, {})
  expect(result.valid).toBe(true)
  expect(result.documents.every(document => document.available)).toBe(true)
  expect(result.note).toContain('not design completeness or approval')
  expect(result).not.toHaveProperty('deliveryEligible')
  expect(snapshot(root)).toEqual(before)
})

test.each(['none','self','unknown','duplicate-dependency','cycle','duplicate-task','missing-section','unknown-output','missing-acceptance'] as const)(
  'current task reader preserves optional planning and rejects invalid supplied mappings: %s',async kind=>{
    const root=fixture()
    await writeDesignDocumentFixture(root,'GDD.md')
    const file=join(root,designHandoffPath('GDD.md'))
    const index=JSON.parse(readFileSync(file,'utf8')),task=index.implementationItems[0]
    if(kind==='none')delete index.implementationItems
    else if(kind==='self')task.dependsOn=[task.id]
    else if(kind==='unknown')task.dependsOn=['absent']
    else if(kind==='duplicate-dependency') {
      task.dependsOn=['other','other'];index.implementationItems.push({...task,id:'other',dependsOn:[]})
    } else if(kind==='cycle') {
      task.dependsOn=['other'];index.implementationItems.push({...task,id:'other',dependsOn:[task.id]})
    } else if(kind==='duplicate-task')index.implementationItems.push({...task})
    else if(kind==='missing-section')task.section='Absent task source'
    else if(kind==='unknown-output')task.requirementRefs[0].id='absent'
    else if(kind==='missing-acceptance')delete index.outputs[0].acceptance
    writeFileSync(file,JSON.stringify(index))
    const before=snapshot(root)
    const result=readImplementationTask(root,kind==='none'?{}:{id:task.id})
    expect(result.valid).toBe(kind==='none')
    if(kind==='none')expect(result.directory).toEqual([])
    else expect(result.issues.length).toBeGreaterThan(0)
    expect(snapshot(root)).toEqual(before)
  })

test('task ID supplies original requirement and acceptance prose while the directory stays brief', async () => {
  const root = fixture(), handoff = designHandoffFixture('GDD.md')
  handoff.implementationItems = [{ id: 'restart', section: 'Restart task', dependsOn: ['initialize'],
    requirementRefs: [{ document: 'GDD.md', id: 'play' }] }]
  handoff.outputs[0]!.acceptance!.section = 'Restart acceptance'
  await writeDesignDocumentFixture(root, 'GDD.md', handoff,
    '# Design\n- Version: v1.0\nRestart uses initial state.\n## Restart task\nCall shared initialization; clear old timers.\n## Restart acceptance\nRetry twice; old timers must not fire.\n')
  const before = snapshot(root), directory = readImplementationTask(root, {}), result = readImplementationTask(root, { id: 'restart' })
  expect(directory.directory.map(task => task.id)).toEqual(['restart'])
  expect(directory).not.toHaveProperty('sources')
  expect(directory).not.toHaveProperty('requirements')
  expect(result.valid).toBe(false) // the unknown dependency remains visible
  expect('task' in result && result.task.id).toBe('restart')
  expect(JSON.stringify(result)).toContain('clear old timers')
  expect(JSON.stringify(result)).toContain('Retry twice; old timers must not fire.')
  expect(JSON.stringify(result)).toContain('Restart acceptance')
  expect(JSON.stringify(result)).toContain('Restart uses initial state.')
  expect(readImplementationTask(root, { id: 'unknown' }).issues.join(' ')).toContain('Unknown task ID')
  handoff.implementationItems.push(handoff.implementationItems[0]!)
  save(root, designHandoffPath('GDD.md'), handoff)
  expect(readImplementationTask(root, { id: 'restart' }).issues.join(' ')).toContain('Ambiguous task ID')
  save(root, designHandoffPath('GDD.md'), { ...handoff, implementationItems: handoff.implementationItems.slice(0, 1) })
  expect(snapshot(root)).toEqual(before)
})

test('task source reads merge repeated and nested sections, including task self-references, without unrelated prose', async () => {
  const root = fixture(), gdd = designHandoffFixture('GDD.md')
  gdd.implementationItems = [{ id: 'control', section: 'Task', dependsOn: [], requirementRefs: [
    { document: 'GDD.md', id: 'play' }, { document: 'GDD.md', id: 'recovery' },
    { document: 'GDD.md', id: 'play' },
  ] }]
  gdd.outputs = [
    { id: 'play', section: 'Rules', acceptance: { section: 'Checks', method: 'test' } },
    { id: 'recovery', section: 'Recovery', acceptance: { section: 'Checks', method: 'test' } },
    { id: 'other', section: 'Unrelated', acceptance: { section: 'Unrelated', method: 'inspection' } },
  ]
  await writeDesignDocumentFixture(root, 'GDD.md', gdd,
    '# Design\n- Version: v1.0\n## Task\nTASK_SOURCE_ONCE\n## Rules\nORIGINAL_RULE_ONCE\n### Recovery\nRECOVERY_RULE_ONCE\n## Checks\nORIGINAL_CHECK_ONCE\n## Unrelated\nUNREFERENCED_OUTCOME\n## Another task\nUNRELATED_TECHNICAL_TEXT\n')
  const before = snapshot(root), result = readImplementationTask(root, { id: 'control' })
  const sources = 'sources' in result ? result.sources : []
  expect(sources.map(source => source.document)).toEqual(['GDD.md'])
  expect(sources[0]!.requestedSections).toEqual(['Task', 'Rules', 'Checks', 'Recovery'])
  expect(sources[0]!.reads).toHaveLength(1)
  const text = sources.flatMap(source => source.reads.map(read => read.text)).join('\n')
  for (const marker of ['TASK_SOURCE_ONCE', 'ORIGINAL_RULE_ONCE', 'RECOVERY_RULE_ONCE', 'ORIGINAL_CHECK_ONCE'])
    expect(text.split(marker)).toHaveLength(2)
  expect(text).not.toContain('UNREFERENCED_OUTCOME')
  expect(text).not.toContain('UNRELATED_TECHNICAL_TEXT')
  expect(snapshot(root)).toEqual(before)
})

test('bad referenced headings retain readable task and requirement text with explicit issues', async () => {
  const root = fixture(), gdd = designHandoffFixture('GDD.md')
  gdd.implementationItems = [{ id: 'control', section: 'Task', requirementRefs: [
    { document: 'GDD.md', id: 'ready' }, { document: 'GDD.md', id: 'play' },
    { document: 'GDD.md', id: 'good' }, { document: 'GDD.md', id: 'absent-id' },
  ] }]
  gdd.outputs = [
    { id: 'play', section: 'Repeated', acceptance: { section: 'Good', method: 'test' } },
    { id: 'good', section: 'Good', acceptance: { section: 'Good', method: 'test' } },
  ]
  await writeDesignDocumentFixture(root, 'GDD.md', gdd,
    '# Design\n- Version: v1.0\n## Task\nREADABLE_TASK\n## Repeated\nAMBIGUOUS_ONE\n## Repeated\nAMBIGUOUS_TWO\n## Good\nREADABLE_REQUIREMENT_AND_CHECK\n')
  const before = snapshot(root), result = readImplementationTask(root, { id: 'control' })
  expect(result.valid).toBe(false)
  expect(result.issues.join('\n')).toContain('missing/ambiguous heading')
  expect(result.issues.join('\n')).toContain('missing/ambiguous heading "Repeated"')
  expect(result.issues.join('\n')).toContain('Missing or ambiguous requirement GDD.md#absent-id')
  const sources = JSON.stringify('sources' in result ? result.sources : [])
  expect(sources).toContain('READABLE_TASK')
  expect(sources).toContain('READABLE_REQUIREMENT_AND_CHECK')
  expect(sources).not.toContain('AMBIGUOUS_ONE')
  expect(sources).not.toContain('AMBIGUOUS_TWO')
  expect(snapshot(root)).toEqual(before)
})

test('resource check needs a Manifest, never a proprietary UI or Scene document', async () => {
  const root = fixture()
  expect((await checkResourcesAndBindings(root, {})).issues.join(' ')).toContain('manifest.json is missing')
  const manifest = assetManifestAuthoringExamples().canonical
  manifest.resources = []; manifest.requirements = []
  await writeBeeGameAssetManifest(root, manifest)
  const before = snapshot(root), result = await checkResourcesAndBindings(root, {})
  expect(result).toMatchObject({valid:true,scope:'registered-resources',resources:[],requirementBindings:[]})
  expect(result.note).toContain('registered files, hashes and supported structure')
  expect(result.note).not.toMatch(/runtime|visual quality|native scene/i)
  expect(snapshot(root)).toEqual(before)
  // An unrelated directory/filename does not declare a BGS data contract.
  save(root, 'content/ui/menu.json', 'not a BGS document')
  save(root, 'content/index.json', '{}')
  expect((await checkResourcesAndBindings(root, {})).valid).toBe(true)
  await expect(checkResourcesAndBindings(root, {detailsFor:'content/ui/menu.json'})).rejects.toThrow()
})

test('resource check preserves actual file, hash and requirement checks without UI inputs', async () => {
  const root = fixture(), manifest = assetManifestAuthoringExamples().canonical
  const resource = manifest.resources[0]!, path = 'assets/runtime/image.png'
  const png = await sharp({create:{width:16,height:16,channels:4,background:'#ffffff'}}).png().toBuffer()
  manifest.requirements = []; resource.fulfills = []
  resource.root_path = path; resource.file_paths = [path]; resource.asset_kind = 'image'; resource.dimension = '2D'
  resource.local_file_hashes = {[path]:createHash('sha256').update(png).digest('hex')}
  await writeBeeGameAssetManifest(root, manifest)
  expect((await checkResourcesAndBindings(root, {})).valid).toBe(false)
  mkdirSync(join(root,'assets/runtime'),{recursive:true}); writeFileSync(join(root,path),png)
  const before = snapshot(root), checked = await checkResourcesAndBindings(root, {})
  expect(checked.valid).toBe(true)
  expect(checked.resources[0]!.files[0]).toMatchObject({path,sha256:resource.local_file_hashes[path],facts:{width:16,height:16}})
  expect(snapshot(root)).toEqual(before)
  writeFileSync(join(root,path),'changed bytes')
  expect((await checkResourcesAndBindings(root, {})).issues.join(' ')).toContain('hash does not match')
})

test('resource check validates atlas structure and representation requirements without Scene/UI bindings', async () => {
  const root = fixture(), manifest = assetManifestAuthoringExamples().canonical, resource = manifest.resources[0]!
  const image = 'assets/runtime/atlas.png', atlas = 'assets/runtime/atlas.json'
  resource.root_path = image; resource.file_paths = [image,atlas]; resource.asset_kind = 'sprite-atlas'
  const png = await sharp({create:{width:16,height:16,channels:4,background:'#ffffff'}}).png().toBuffer()
  mkdirSync(join(root,'assets/runtime'),{recursive:true}); writeFileSync(join(root,image),png)
  save(root,atlas,{frames:{idle:{frame:{x:0,y:0,w:16,h:16}}}})
  manifest.requirements[0]!.acquisition_profile.asset_kinds = ['sprite']
  manifest.requirements[0]!.acquisition_profile.capabilities = []
  resource.local_file_hashes = Object.fromEntries(resource.file_paths.map(path =>
    [path,createHash('sha256').update(readFileSync(join(root,path))).digest('hex')]))
  await writeBeeGameAssetManifest(root,manifest)
  const result = await checkResourcesAndBindings(root,{})
  expect(result.requirements[0]!.structure!.status).toBe('passed')
  expect(result.requirements[0]!.structure!.observations[0]).toContain(resource.id+' (sprite-atlas)')
  save(root,atlas,{frames:{idle:{frame:{x:0,y:0,w:32,h:16}}}})
  resource.local_file_hashes[atlas]=createHash('sha256').update(readFileSync(join(root,atlas))).digest('hex')
  await writeBeeGameAssetManifest(root,manifest)
  expect((await checkResourcesAndBindings(root,{})).valid).toBe(false)
})

test('selected design reads omit unrelated directories and all requirement hashes; table task reads identify the ID without dropping shared prose', async () => {
  const root = fixture()
  await writeDesignDocumentsFixture(root)
  const selected = readDesignHandoff(root, {read:[{document:'GDD.md',sections:['Design']}]})
  expect(selected.documents.map(doc=>doc.document)).toEqual(['GDD.md'])
  expect(JSON.stringify(selected.documents)).not.toContain('"requirements":')
  expect(readDesignHandoff(root, {}).documents).toHaveLength(1)
  const handoff = designHandoffFixture('GDD.md')
  handoff.implementationItems = ['T-01','T-02'].map(id=>({id,section:'Tasks',dependsOn:[],requirementRefs:[{document:'GDD.md',id:'play'}]}))
  await writeDesignDocumentFixture(root,'GDD.md',handoff,
    '# Design\n- Version: v1.0\n## Tasks\nShared initialization contract.\n| ID | Result |\n| --- | --- |\n| T-01 | Initialize unique task |\n| `T-02` | Restart unique task |\nShared acceptance applies.\n\n| ID | Requirement |\n| --- | --- |\n| T-01 | ORIGINAL_OWNER_ROW_RETAINED |\n')
  const before=snapshot(root), task=readImplementationTask(root,{id:'T-02'})
  expect(JSON.stringify(task)).toContain('Restart unique task')
  expect(JSON.stringify(task)).toContain('Shared initialization contract')
  expect(JSON.stringify(task)).toContain('Initialize unique task')
  expect('task' in task && task.task.id).toBe('T-02')
  expect(JSON.stringify(task)).toContain('ORIGINAL_OWNER_ROW_RETAINED')
  expect(JSON.stringify(task)).toContain('shared-section')
  expect(snapshot(root)).toEqual(before)
})


test('task readers resolve the same formatted heading pointers as draft validation without rewriting sources', async () => {
  const root=fixture()
  await writeDesignDocumentsFixture(root)
  for(const name of ['GDD.md'] as const) {
    const body=readFileSync(join(root,'docs',name),'utf8').replace('# Design','# 1. Design')
    const index=designHandoffFixture(name)
    for(const output of index.outputs) {output.section='# **Design**';output.acceptance!.section='`Design`'}
    for(const task of index.implementationItems??[])task.section='## Design'
    save(root,'docs/'+name,body);save(root,designHandoffPath(name),index)
  }
  const before=snapshot(root)
  expect(checkDesignHandoffDraft(root,'GDD.md',{includeRequirements:true}).valid).toBe(true)
  const result=readImplementationTask(root,{id:'fixture-GDD'})
  expect(result.valid).toBe(true)
  expect('sources' in result && result.sources.some(source=>source.document==='GDD.md' && source.reads.some(read=>read.text.includes('Fixture decision.')))).toBe(true)
  expect('task' in result && result.task.section).toBe('1. Design')
  expect(snapshot(root)).toEqual(before)
  save(root,'docs/GDD.md','# GDD\n- Version: v1.0\n## 1. Design\nFirst\n## 2. Design\nSecond\n')
  expect(readImplementationTask(root,{id:'fixture-GDD'}).valid).toBe(false)
  save(root,'docs/GDD.md','# Other\n- Version: v1.0\n')
  expect(readImplementationTask(root,{id:'fixture-GDD'}).valid).toBe(false)
})


test('one malformed task does not hide independently readable implementation tasks', async () => {
  const root = fixture(), technical = designHandoffFixture('GDD.md')
  await writeDesignDocumentsFixture(root)
  technical.implementationItems = [{ id: 'valid-task', section: 'Design', dependsOn: [],
    requirementRefs: [{ document: 'GDD.md', id: 'play' }] }]
  await writeDesignDocumentFixture(root, 'GDD.md', technical)
  save(root, designHandoffPath('GDD.md'), { ...technical, implementationItems: [
    ...technical.implementationItems, { id: 'broken-task', section: 'Design', requirementRefs: [] },
  ] })
  const before = snapshot(root), result = readImplementationTask(root, { id: 'valid-task' })
  expect(result.valid).toBe(false)
  expect(result.issues.join(' ')).toContain('requirementRefs')
  expect(result.issues.join(' ')).not.toContain('Unknown task ID: valid-task')
  expect('task' in result && result.task.id).toBe('valid-task')
  expect(JSON.stringify('sources' in result ? result.sources : [])).toContain('Fixture decision.')
  expect(readImplementationTask(root, {}).directory.map(task => task.id)).toEqual(['valid-task'])
  expect(readImplementationTask(root, { id: 'broken-task' }).valid).toBe(false)
  expect(designReviewIndexes(root, ['GDD.md'])[0]).toHaveProperty('issues')
  expect(snapshot(root)).toEqual(before)
})


test.each(['> ## Quoted only\n> Quoted requirement.\n', '- Item\n  ## Quoted only\n  Nested requirement.\n'])(
  'draft and readers agree on document sections instead of nested example headings: %s', async nested => {
  const root = fixture(), handoff = designHandoffFixture('GDD.md')
  await writeDesignDocumentFixture(root, 'GDD.md', handoff,
    '# Design\n- Version: v1.0\nReal decision.\n\n' + nested)
  handoff.outputs[0]!.section = 'Quoted only'
  save(root, designHandoffPath('GDD.md'), handoff)
  expect(checkDesignHandoffDraft(root, 'GDD.md').valid).toBe(false)
  handoff.outputs[0]!.section = 'Design'
  save(root, designHandoffPath('GDD.md'), handoff)
  save(root, 'docs/GDD.md', '# Design\n- Version: v1.0\nReal decision.\n\n' + nested.replace('Quoted only', 'Design'))
  expect(checkDesignHandoffDraft(root, 'GDD.md').valid).toBe(true)
  expect(readDesignHandoff(root, { read: [{ document: 'GDD.md', sections: ['Design'] }] }).sources[0]!.reads[0]!.text).toContain('Real decision.')
})

test('task reads must not delete technical requirements merely sharing another task ID in a table', async () => {
  const root = fixture(), technical = designHandoffFixture('GDD.md')
  await writeDesignDocumentsFixture(root)
  technical.outputs[0]!.id = 'ready'
  technical.outputs[0]!.section = 'Shared interfaces'
  technical.outputs[0]!.acceptance!.section = 'Shared interfaces'
  technical.implementationItems = ['T1', 'T2'].map(id => ({ id, section: 'Tasks', dependsOn: [],
    requirementRefs: [{ document: 'GDD.md', id: 'ready' }] }))
  await writeDesignDocumentFixture(root, 'GDD.md', technical,
    '# Design\n- Version: v1.0\n## Tasks\n| ID | Task |\n| --- | --- |\n| T1 | Initialize |\n| T2 | Restart |\n\n## Shared interfaces\n| Producer | Required contract |\n| --- | --- |\n| T2 | REQUIRED_SHARED_INTERFACE_AND_ACCEPTANCE |\n')
  const before = snapshot(root), result = readImplementationTask(root, { id: 'T1' })
  expect(JSON.stringify('sources' in result ? result.sources : [])).toContain('REQUIRED_SHARED_INTERFACE_AND_ACCEPTANCE')
  expect('task' in result && result.task.id).toBe('T1')
  expect(snapshot(root)).toEqual(before)
})
