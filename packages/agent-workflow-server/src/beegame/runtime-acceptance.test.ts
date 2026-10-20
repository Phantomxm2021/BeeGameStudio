import { expect, test } from 'bun:test'
import sharp from 'sharp'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readRuntimeAcceptanceReport, runtimeEvidenceIsCurrent, inspectDesignAcceptance } from './runtime-acceptance'
import { bundleAcceptanceChecker } from './acceptance-check-bundle'
import { designDocumentFixture, designHandoffFixture, designRequirementChecksFixture, writeDesignDocumentFixture, writeDesignDocumentsFixture } from './fixtures/layout-fixture'
import { checkDesignHandoff, DESIGN_ACCEPTANCE_PATH, designHandoffPath, finalizeDesignDocuments, snapshotDesignDocuments } from './design-handoff'
import { PROJECT_DOCUMENTS } from './project-content-authority'

async function registerDesignFixture(root: string) {
  const index={schema:'beegame-content-package.v2',id:'fixture',dimension:'2d',sceneModel:'game-object-v2',
    documentRevision:'a'.repeat(64),assetManifestRevision:'b'.repeat(64),entryScene:'level',
    files:['ui/menu.json','scenes/level.json'],documents:[
      {id:'menu',kind:'ui-screen',path:'ui/menu.json',loadPhase:'startup'},
      {id:'level',kind:'scene-2d',path:'scenes/level.json',loadPhase:'startup'}]}
  await writeFile(join(root,'content/index.json'),JSON.stringify(index))
  return index
}
const designContentChecks = () => [
  {kind:'ui-layout',document:'content/ui/menu.json',nodeId:'play',property:'layout'},
  {kind:'scene-layout',document:'content/scenes/level.json',nodeId:'board',property:'transform'},
].map(check=>({...check,change:'Synthetic fixture change',expected:'Synthetic expected',observed:'Synthetic expected',
  status:'passed',evidencePaths:['observed.txt']}))

test.each([
  ['content/ui/menu.json', false], ['content/ui/menu.json', true],
  ['content/scenes/level.json', false], ['content/scenes/level.json', true],
  ['content/index.json', false], ['content/index.json', true],
] as const)('content input cannot substitute for a runtime observation: %s (alias=%s)', async (source, alias) => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-content-evidence-source-'))
  try {
    await writeDesignDocumentsFixture(root)
    await registerDesignFixture(root)
    await mkdir(join(root, '.beegame/delivery'), { recursive: true })
    await writeFile(join(root, 'observed.txt'), 'Synthetic before/after observation; not a real game verdict')
    await writeFile(join(root, 'game.js'), 'Synthetic build')
    const support = alias ? 'input-alias.json' : source
    if (alias) await symlink(join(root, source), join(root, support))
    const report = { scope: 'delivery', status: 'passed', summary: 'Synthetic author verdict', environment: 'Offline fixture',
      evidencePaths: ['observed.txt', support], artifactPaths: ['game.js'],
      verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [], unverified: [],
        contentChecks: designContentChecks(), requirementChecks: designRequirementChecksFixture(root, ['observed.txt']) } }
    const save = () => writeFile(join(root, DESIGN_ACCEPTANCE_PATH), JSON.stringify(report))
    await save()
    // Source files can remain supporting attachments; the actual checks cite observations.
    const accepted = (await readRuntimeAcceptanceReport(root, DESIGN_ACCEPTANCE_PATH))!
    expect(accepted.status).toBe('passed')
    expect(await runtimeEvidenceIsCurrent(root, [accepted])).toBe(true)
    report.verification.contentChecks[0]!.evidencePaths = [support]
    await save()
    const invalid = (await readRuntimeAcceptanceReport(root, DESIGN_ACCEPTANCE_PATH))!
    expect(invalid).toMatchObject({ status: 'blocked', diagnostic: { category: 'report-invalid' } })
    expect(invalid.summary).toContain('runtime observation, not authored content')
    // A retained PASS must obey the same rule, even without rereading its report.
    expect(await runtimeEvidenceIsCurrent(root, [{ ...accepted, verification: {
      ...accepted.verification!, contentChecks: report.verification.contentChecks as any,
    } }])).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('design-led acceptance still checks document coverage and revision without an image gate',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-design-led-acceptance-'))
  try {
    await writeDesignDocumentsFixture(root)
    await registerDesignFixture(root)
    await mkdir(join(root,'.beegame/delivery'),{recursive:true})
    await writeFile(join(root,'observed.txt'),'Synthetic observation, not actual gameplay evidence')
    await writeFile(join(root,'game.js'),'Synthetic build')
    const report={scope:'delivery',status:'passed',summary:'Synthetic report',environment:'Synthetic runtime',
      evidencePaths:['observed.txt'],artifactPaths:['game.js'],verification:{target:'deployment',observation:'target-runtime',
        knownIssues:[],unverified:[],designRevision:checkDesignHandoff(root,PROJECT_DOCUMENTS).revision,
        contentChecks:designContentChecks(),requirementChecks:designRequirementChecksFixture(root,['observed.txt'])}}
    const save=async(value:unknown)=>writeFile(join(root,DESIGN_ACCEPTANCE_PATH),JSON.stringify(value))
    expect(await inspectDesignAcceptance(root,true)).toMatchObject({valid:false,status:'unverified'})
    await save(report)
    const accepted=await readRuntimeAcceptanceReport(root,DESIGN_ACCEPTANCE_PATH,{requireDesignRevision:true})
    expect(accepted?.status).toBe('passed')
    expect(await inspectDesignAcceptance(root,true)).toMatchObject({valid:true,quality:'unverified'})
    await save({...report,verification:{...report.verification,designRevision:undefined}})
    expect((await inspectDesignAcceptance(root,true)).summary).toContain('revision is missing')
    await save({...report,verification:{...report.verification,requirementChecks:report.verification.requirementChecks.slice(1)}})
    expect((await inspectDesignAcceptance(root,true)).summary).toContain('unverified')
    await save({...report,verification:{...report.verification,requirementChecks:[...report.verification.requirementChecks,report.verification.requirementChecks[0]]}})
    expect((await inspectDesignAcceptance(root,true)).summary).toContain('Duplicate')
    await save(report)
    const doc=join(root,'docs/UI_UX_SPEC.md')
    await writeFile(doc,await readFile(doc,'utf8')+'\nChanged decision.\n')
    expect((await inspectDesignAcceptance(root,true)).summary).toContain('revision is missing or changed')
    expect(await runtimeEvidenceIsCurrent(root,[accepted!])).toBe(false)
    await rm(join(root,'docs/AUDIO_DESIGN.md'))
    expect((await inspectDesignAcceptance(root,true)).summary).toContain('incomplete')
  } finally { await rm(root,{recursive:true,force:true}) }
})

test('design acceptance binds the actual runtime registry to owner sources and respects the host editable-content requirement',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-design-runtime-sources-'))
  try {
    await writeDesignDocumentsFixture(root)
    await mkdir(join(root,'assets/visual'),{recursive:true});await mkdir(join(root,'.beegame/delivery'),{recursive:true})
    const visual=await sharp({create:{width:8,height:8,channels:4,background:'red'}}).png().toBuffer()
    await writeFile(join(root,'assets/visual/design.png'),visual)

    for(const name of ['UI_UX_SPEC.md','LEVEL_SCENE_DESIGN.md'])
      await writeFile(join(root,'docs',name),await readFile(join(root,'docs',name),'utf8')+'\n[Selected](../assets/visual/design.png)\n')
    await writeFile(join(root,'observed.txt'),'Synthetic fixture observation')
    await writeFile(join(root,'game.js'),'Synthetic artifact')
    const save=async(contentChecks=designContentChecks())=>writeFile(join(root,DESIGN_ACCEPTANCE_PATH),JSON.stringify({
      scope:'delivery',status:'passed',summary:'Synthetic',environment:'Synthetic',evidencePaths:['observed.txt'],artifactPaths:['game.js'],
      verification:{target:'deployment',observation:'target-runtime',knownIssues:[],unverified:[],contentChecks,
        designRevision:checkDesignHandoff(root,PROJECT_DOCUMENTS).revision,requirementChecks:designRequirementChecksFixture(root,['observed.txt'])}}))
    await save()
    expect((await inspectDesignAcceptance(root,true,true)).summary).toContain('content/index.json')
    const index=await registerDesignFixture(root)
    await save([])
    expect((await inspectDesignAcceptance(root,true,true)).summary).toContain('consumption is unverified')
    await save()
    const accepted=await readRuntimeAcceptanceReport(root,DESIGN_ACCEPTANCE_PATH,{requireDesignRevision:true,requireEditableContent:true})
    expect(accepted?.status).toBe('passed')
    await rm(join(root,'content/index.json'))
    expect(await runtimeEvidenceIsCurrent(root,[accepted!])).toBe(false)
    await registerDesignFixture(root)
    // Both files are valid, but only one is the actual runtime source.
    await writeFile(join(root,'content/ui/actual.json'),await readFile(join(root,'content/ui/menu.json')))
    index.files[0]='ui/actual.json';index.documents[0]!.path='ui/actual.json'
    await writeFile(join(root,'content/index.json'),JSON.stringify(index))
    const actualChecks=designContentChecks().map(check=>({...check,
      document:check.document.replace('ui/menu.json','ui/actual.json')}))
    await save(actualChecks)
    const mismatch=await inspectDesignAcceptance(root,true,true)
    expect(mismatch.valid).toBe(false)
    expect(mismatch.summary).toContain('same sources')
    expect(mismatch.summary).toContain('ui/actual.json')
    expect(mismatch.summary).toContain('ui/menu.json')
    const uiPath=join(root,'docs/UI_UX_SPEC.md')
    await writeFile(uiPath,(await readFile(uiPath,'utf8')).replace('ui/menu.json','ui/actual.json'))
    await save(actualChecks)
    expect((await inspectDesignAcceptance(root,true,true)).valid).toBe(true)
    index.documents[0]!.id='wrong-id'
    await writeFile(join(root,'content/index.json'),JSON.stringify(index))
    expect((await inspectDesignAcceptance(root,true,true)).summary).toContain('actual saved document')
    // Native/source-only work is not forced to create or use shared UI/Scene.
    await rm(join(root,'content/index.json'))
    for(const name of ['UI_UX_SPEC.md','LEVEL_SCENE_DESIGN.md']) {
      const path=join(root,'docs',name)
      await writeFile(path,(await readFile(path,'utf8')).replace(/^.*\]\(\.\.\/content\/.*$/gm,''))
    }
    await save([])
    expect((await inspectDesignAcceptance(root,true,false)).valid).toBe(true)
    expect((await inspectDesignAcceptance(root,true,true)).valid).toBe(false)
  }finally{await rm(root,{recursive:true,force:true})}
})

test('editable UI-only delivery uses the same entry kinds and still requires declared Scene sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-ui-only-acceptance-'))
  try {
    await writeDesignDocumentsFixture(root)
    const index = await registerDesignFixture(root)
    index.entryScene = 'menu'
    index.files = ['ui/menu.json']
    index.documents = index.documents.filter(entry => entry.id === 'menu')
    await writeFile(join(root, 'content/index.json'), JSON.stringify(index))
    const sceneDesign = join(root, 'docs/LEVEL_SCENE_DESIGN.md')
    await writeFile(sceneDesign, (await readFile(sceneDesign, 'utf8')).replace(/^.*\]\(\.\.\/content\/.*$/gm, ''))
    await mkdir(join(root, '.beegame/delivery'), { recursive: true })
    await writeFile(join(root, 'observed.txt'), 'Synthetic UI observation, not real game evidence')
    await writeFile(join(root, 'game.js'), 'Synthetic artifact')
    const save = () => writeFile(join(root, DESIGN_ACCEPTANCE_PATH), JSON.stringify({ scope: 'delivery', status: 'passed',
      summary: 'Synthetic UI-only report', environment: 'Fixture', evidencePaths: ['observed.txt'], artifactPaths: ['game.js'],
      verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [], unverified: [],
        designRevision: checkDesignHandoff(root, PROJECT_DOCUMENTS).revision,
        requirementChecks: designRequirementChecksFixture(root, ['observed.txt']), contentChecks: designContentChecks().slice(0, 1) } }))
    await save()
    expect((await inspectDesignAcceptance(root, true, true)).valid).toBe(true)
    index.documents[0]!.loadPhase = 'on-demand'
    await writeFile(join(root, 'content/index.json'), JSON.stringify(index))
    expect((await inspectDesignAcceptance(root, true, true)).summary).toContain('startup entryScene')
    index.documents[0]!.loadPhase = 'startup'
    await writeFile(join(root, 'content/index.json'), JSON.stringify(index))
    await writeFile(sceneDesign, (await readFile(sceneDesign, 'utf8')) + '\n[Required Scene](../content/scenes/level.json)\n')
    await save()
    expect((await inspectDesignAcceptance(root, true, true)).valid).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test.each(['missing', 'failed', 'false-contract'] as const)('runtime acceptance cannot turn %s retained evidence into PASS through source hashes', async kind => {
  const workspace = await mkdtemp(join(tmpdir(), 'synthetic-runtime-evidence-'))
  try {
    await writeDesignDocumentsFixture(workspace, ['GDD.md', 'TECHNICAL_DESIGN.md'])
    await writeFile(join(workspace, 'game.js'), 'Synthetic build')
    await writeFile(join(workspace, 'observation.txt'), 'Synthetic test fixture result')
    const checks = designRequirementChecksFixture(workspace, ['observation.txt'])
    const source = designHandoffFixture('TECHNICAL_DESIGN.md')
    const bytes = JSON.stringify(kind === 'false-contract' ? { available: false }
      : { observation: 'target-runtime', check: 'Synthetic capability failure', passed: false, expected: true, observed: false })
    if (kind !== 'missing') await writeFile(join(workspace, 'proof.json'), bytes)
    source.evidence.push({ id: 'proof', kind: kind === 'false-contract' ? 'contract' : 'capability', path: 'proof.json',
      source: 'Synthetic fixture', sha256: createHash('sha256').update(bytes).digest('hex'),
      ...(kind === 'false-contract' ? { pointer: '/available', expected: true } : {}) })
    await writeDesignDocumentFixture(workspace, 'TECHNICAL_DESIGN.md', source)
    const indexPath = join(workspace, designHandoffPath('TECHNICAL_DESIGN.md'))
    const before = await readFile(indexPath, 'utf8')
    const result = finalizeDesignDocuments(workspace, ['TECHNICAL_DESIGN.md'], snapshotDesignDocuments(workspace, ['TECHNICAL_DESIGN.md']))
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.unsafeIssues).toEqual([])
    await writeFile(join(workspace, 'acceptance.json'), JSON.stringify({ scope: 'delivery', status: 'passed', summary: 'Synthetic fixture',
      environment: 'Synthetic target runtime', evidencePaths: ['observation.txt'], artifactPaths: ['game.js'],
      verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [], unverified: [], requirementChecks: checks } }))
    expect((await readRuntimeAcceptanceReport(workspace, 'acceptance.json'))?.status).toBe('blocked')
    expect(await readFile(indexPath, 'utf8')).toBe(before)
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

test('delivery binds every declared expectation to actual result evidence and its current owned source', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'bgs-owned-acceptance-'))
  try {
    await writeDesignDocumentsFixture(workspace, ['GDD.md', 'AUDIO_DESIGN.md'])
    const audio = designHandoffFixture('AUDIO_DESIGN.md')
    audio.outputs[0]!.acceptance = { section: 'Design', method: 'target-runtime' }
    await writeDesignDocumentFixture(workspace, 'AUDIO_DESIGN.md', audio)
    await writeFile(join(workspace, 'game.js'), 'Synthetic build')
    await writeFile(join(workspace, 'observations.txt'), 'Synthetic unit-test evidence, not a real gameplay result')
    const checks = designRequirementChecksFixture(workspace, ['observations.txt'])
    const report = { scope: 'delivery', status: 'passed', summary: 'Fixture results', environment: 'Synthetic test runtime',
      artifactPaths: ['game.js'], evidencePaths: ['observations.txt'], verification: {
        target: 'deployment', observation: 'target-runtime', knownIssues: [], unverified: [], requirementChecks: checks,
      } }
    const read = async (requirementChecks: unknown[] = checks, extra: object = {}) => {
      await writeFile(join(workspace, 'acceptance.json'), JSON.stringify({ ...report, ...extra,
        verification: { ...report.verification, requirementChecks } }))
      return (await readRuntimeAcceptanceReport(workspace, 'acceptance.json'))!
    }
    const originalGdd = await readFile(join(workspace, 'docs/GDD.md'), 'utf8')
    expect((await read([])).summary).toContain('Design requirements are unverified')
    expect((await read([checks[0]!])).summary).toContain('AUDIO_DESIGN.md#ready')
    expect((await read([{ ...checks[0]!, id: 'invented' }, checks[1]!])).diagnostic?.category).toBe('report-invalid')
    expect((await read([{ ...checks[0]!, documentSha256: 'a'.repeat(64) }, checks[1]!])).summary).toContain('Requirement source changed')
    expect((await read([{ ...checks[0]!, handoffSha256: 'a'.repeat(64) }, checks[1]!])).summary).toContain('Requirement source changed')
    expect((await read([checks[0]!, { ...checks[1]!, method: 'test' }])).summary).toContain('requires target-runtime, not test')
    expect((await read([{ ...checks[0]!, status: 'failed', observed: 'Unexpected outcome' }, checks[1]!])).diagnostic?.category).toBe('product-failed')
    expect((await read([{ ...checks[0]!, status: 'unverified' }, checks[1]!])).diagnostic?.category).toBe('verification-incomplete')
    expect((await read([{ ...checks[0]!, scenario: '' }, checks[1]!])).diagnostic?.category).toBe('report-invalid')
    expect((await read([{ ...checks[0]!, evidencePaths: [] }, checks[1]!])).diagnostic?.category).toBe('report-invalid')
    expect((await read([{ ...checks[0]!, evidencePaths: ['unrecorded.txt'] }, checks[1]!])).summary).toContain('recorded result evidence')
    expect((await read([{ ...checks[0]!, evidencePaths: ['docs/GDD.md'] }, checks[1]!], {
      evidencePaths: ['observations.txt', 'docs/GDD.md'],
    })).summary).toContain('not its design source')
    expect((await read(checks, { requirementChecks: checks })).summary).toContain('inside verification.requirementChecks')
    expect((await read([{ ...checks[0]!, evidencePaths: ['.beegame/design-handoffs/GDD.json'] }, checks[1]!], {
      evidencePaths: ['observations.txt', '.beegame/design-handoffs/GDD.json'],
    })).summary).toContain('not its design source')
    const accepted = await read()
    expect(accepted.status).toBe('passed')
    expect(await runtimeEvidenceIsCurrent(workspace, [accepted])).toBe(true)
    const checker = join(workspace, 'check-acceptance.mjs')
    await writeFile(checker, await bundleAcceptanceChecker())
    const checkReport = () => Bun.spawnSync([process.execPath, checker, 'acceptance.json'], { cwd: workspace })
    expect(checkReport().exitCode).toBe(0)
    expect(await runtimeEvidenceIsCurrent(workspace, [{ ...accepted, verification: {
      ...accepted.verification!, requirementChecks: [],
    } }])).toBe(false)
    await writeFile(join(workspace, 'docs/GDD.md'), originalGdd.replace('Fixture decision.', 'Changed decision.'))
    const staleReport = checkReport()
    expect(staleReport.exitCode).toBe(1)
    expect(JSON.parse(staleReport.stdout.toString()).diagnostic.category).toBe('verification-incomplete')
    expect((await read()).summary).toContain('Requirement source changed')
    expect(await runtimeEvidenceIsCurrent(workspace, [accepted])).toBe(false)
    const updated = designHandoffFixture('GDD.md')
    updated.outputs.push({ ...updated.outputs[0]!, id: 'outcome' })
    await writeDesignDocumentFixture(workspace, 'GDD.md', updated)
    const fresh = designRequirementChecksFixture(workspace, ['observations.txt'])
    expect((await read(fresh.filter(check => check.id !== 'outcome'))).summary).toContain('GDD.md#outcome')
    expect((await read(fresh)).status).toBe('passed')
    const missingCriteria = designHandoffFixture('GDD.md')
    delete missingCriteria.outputs[0]!.acceptance
    await writeDesignDocumentFixture(workspace, 'GDD.md', missingCriteria)
    expect((await read()).summary).toContain('core gameplay delivery expectations must be declared')
    // Structural validation itself never repairs the source or authenticates observations.
    expect(await readFile(join(workspace, 'docs/GDD.md'), 'utf8')).toBe(designDocumentFixture('GDD.md', missingCriteria))
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

test('a delivery PASS requires actual target-runtime verification and no unresolved requirements', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'bgs-delivery-coverage-'))
  const reportPath = '.beegame/delivery/acceptance.json'
  try {
    await mkdir(join(workspace, '.beegame/delivery'), { recursive: true })
    await writeFile(join(workspace, 'game.js'), 'current build')
    await writeFile(join(workspace, '.beegame/delivery/browser.txt'), 'Observed in the target runtime')
    const base = {
      scope: 'delivery', status: 'passed', summary: 'Current version verified',
      environment: 'Web browser', evidencePaths: ['.beegame/delivery/browser.txt'],
      artifactPaths: ['game.js'],
      verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [] as string[], unverified: [] as string[] },
    }
    const read = async (report: unknown) => {
      await writeFile(join(workspace, reportPath), JSON.stringify(report))
      return readRuntimeAcceptanceReport(workspace, reportPath)
    }

    expect((await read(base))?.status).toBe('passed')
    const unspecified = await read({ ...base, verification: { target: 'deployment', knownIssues: [], unverified: [] } })
    expect(unspecified?.status).toBe('blocked')
    const simulated = await read({ ...base, verification: { ...base.verification, observation: 'simulation' } })
    expect(simulated?.status).toBe('blocked')
    expect(simulated?.summary).toContain('target runtime')

    const knownIssue = await read({ ...base, verification: { ...base.verification, knownIssues: ['Menu cannot be clicked'] } })
    expect(knownIssue?.status).toBe('blocked')
    expect(knownIssue?.summary).toContain('Menu cannot be clicked')

    const unverified = await read({ ...base, verification: { ...base.verification, unverified: ['Level two was not played'] } })
    expect(unverified?.status).toBe('blocked')
    expect(unverified?.summary).toContain('Level two was not played')
    expect(unverified?.summary).not.toContain('Agent report:')

    const misplacedChecks = await read({ ...base, contentChecks: [{ kind: 'ui-layout' }] })
    expect(misplacedChecks?.status).toBe('blocked')
    expect(misplacedChecks?.summary).toContain('contentChecks must be inside verification.contentChecks')

    const physicalOutsideScope = await read({ ...base, verification: { ...base.verification,
      outsideScope: ['Physical controller feel was not part of the agreed browser release'] } })
    expect(physicalOutsideScope?.status).toBe('passed')
    expect(physicalOutsideScope?.verification?.outsideScope).toHaveLength(1)
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

test('a readable UI JSON and browser screenshot do not certify that its layout is consumed', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'bgs-content-binding-'))
  try {
    await mkdir(join(workspace, 'content/ui'), { recursive: true })
    await writeFile(join(workspace, 'content/index.json'), JSON.stringify({
      schema: 'beegame-content-package.v2', id: 'test', dimension: '2d',
      documentRevision: 'a'.repeat(64), assetManifestRevision: 'b'.repeat(64),
      entryScene: 'scene', sceneModel: 'game-object-v2', files: ['ui/menu.json'],
    }))
    await writeFile(join(workspace, 'content/ui/menu.json'), JSON.stringify({
      schema: 'beegame-content.v1', id: 'menu', kind: 'ui-screen', assetRefs: [],
      data: { rootId: 'root', nodes: [
        { id: 'root', role: 'screen-root', layout: { size: [960, 540] } },
        { id: 'play', parentId: 'root', role: 'button', layout: { position: [10, 20], size: [100, 50] }, text: 'Play' },
      ] },
    }))
    await writeFile(join(workspace, 'game.js'), 'built renderer')
    await writeFile(join(workspace, 'browser.txt'), 'Saved before/after geometry from the actual test runtime')
    const base = {
      scope: 'delivery', status: 'passed', summary: 'Build and browser pass', environment: 'Browser',
      evidencePaths: ['browser.txt'], artifactPaths: ['game.js'],
      verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [], unverified: [] },
    }
    const check = {
      kind: 'ui-layout', document: 'content/ui/menu.json', nodeId: 'play', property: 'layout',
      change: 'Move +100,+100 and change size from 240x52 to 120x80 in an intercepted response',
      expected: 'Button follows the changed position and size', observed: 'Position moves +100,+100; bounds become 120x80',
      status: 'passed', evidencePaths: ['browser.txt'],
    }
    const read = async (checks?: unknown[]) => {
      await writeFile(join(workspace, 'acceptance.json'), JSON.stringify({ ...base,
        verification: { ...base.verification, ...(checks ? { contentChecks: checks } : {}) } }))
      return readRuntimeAcceptanceReport(workspace, 'acceptance.json')
    }
    expect((await read())?.summary).toContain('Content data consumption is unverified: ui-layout')
    expect((await read([{ ...check, property: 'text' }]))?.status).toBe('blocked')
    const wrongProperty = await read([{ ...check, property: 'transform' }])
    expect(wrongProperty?.summary).toContain('verification.contentChecks.0.property: ui-layout cannot be established by changing transform')
    expect((await read([{ ...check, status: 'failed', observed: 'Text changed, but geometry stayed 240x52 at the same position' }]))?.summary)
      .toContain('geometry stayed 240x52')
    expect((await read([{ ...check, status: 'unverified' }]))?.status).toBe('blocked')
    expect((await read([{ ...check, nodeId: 'invented' }]))?.summary).toContain('unknown node')
    expect((await read([{ ...check, evidencePaths: ['unrecorded.txt'] }]))?.summary).toContain('evidencePaths')
    const accepted = (await read([check]))!
    expect(accepted.status).toBe('passed')
    expect(await runtimeEvidenceIsCurrent(workspace, [accepted])).toBe(true)
    const menuPath = join(workspace, 'content/ui/menu.json')
    const originalMenu = await readFile(menuPath, 'utf8')
    const invalidMenu = JSON.parse(originalMenu)
    invalidMenu.data.nodes[1].layout = { anchor: 'top-center', position: [-120, -1000], size: [240, 52] }
    await writeFile(menuPath, JSON.stringify(invalidMenu))
    expect((await read([check]))?.summary).toContain('Authored UI control geometry violates declared bounds or minima')
    await writeFile(menuPath, originalMenu)
    // Historical PASS objects cannot bypass the new consumption coverage check.
    expect(await runtimeEvidenceIsCurrent(workspace, [{ ...accepted, verification: {
      ...accepted.verification!, contentChecks: undefined,
    } }])).toBe(false)
    await writeFile(join(workspace, 'browser.txt'), 'changed evidence')
    expect(await runtimeEvidenceIsCurrent(workspace, [accepted])).toBe(false)
    // Ordinary analysis/fix responses are not made into full delivery acceptance.
    await writeFile(join(workspace, 'acceptance.json'), JSON.stringify({ ...base, scope: 'request' }))
    expect((await readRuntimeAcceptanceReport(workspace, 'acceptance.json'))?.status).toBe('passed')
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

test('consumption evidence covers every registered UI/Scene/resource file and each Tilemap, not just each kind', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'bgs-per-file-consumption-'))
  try {
    await mkdir(join(workspace, 'content/ui'), { recursive: true })
    const files = ['ui/a.json', 'ui/b.json', 'a.json', 'b.json']
    await writeFile(join(workspace, 'content/index.json'), JSON.stringify({ schema: 'beegame-content-package.v2',
      id: 'test', dimension: '2d', documentRevision: 'a'.repeat(64), assetManifestRevision: 'b'.repeat(64),
      entryScene: 'a', sceneModel: 'game-object-v2', files }))
    for (const id of ['a', 'b']) {
      await writeFile(join(workspace, `content/ui/${id}.json`), JSON.stringify({ schema: 'beegame-content.v1', id: 'ui-' + id, kind: 'ui-screen', assetRefs: [],
        data: { rootId: 'root', nodes: [{ id: 'root', role: 'screen-root', layout: { size: [960, 540] } },
          { id: 'play', parentId: 'root', role: 'button', layout: { position: [10, 20], size: [100, 50] } }] } }))
      await writeFile(join(workspace, `content/${id}.json`), JSON.stringify({ schema: 'beegame-content.v1', id, kind: 'scene-2d', assetRefs: ['visual'],
        data: { nodes: ['first', 'second'].map(nodeId => ({ id: nodeId, transform: { position: [0, 0, 0] }, components: [
          { id: 'map-' + nodeId, type: 'tilemap', data: { schema: 'tilemap.v1', gridNodeId: nodeId, cells: [{ x: 0, y: 0, tileId: 'ground' }] } },
        ] })) } }))
    }
    await writeFile(join(workspace, 'game.js'), 'Synthetic build')
    await writeFile(join(workspace, 'evidence.txt'), 'Synthetic observation, not actual acceptance')
    const common = { change: 'Synthetic change', expected: 'Synthetic expectation', observed: 'Synthetic outcome', status: 'passed', evidencePaths: ['evidence.txt'] }
    const checks = ['a', 'b'].flatMap(id => [
      { ...common, kind: 'ui-layout', document: `content/ui/${id}.json`, nodeId: 'play', property: 'layout' },
      { ...common, kind: 'scene-layout', document: `content/${id}.json`, nodeId: 'first', property: 'transform' },
      ...['first', 'second'].map(nodeId => ({ ...common, kind: 'scene-layout', document: `content/${id}.json`, nodeId, property: 'tilemap' })),
      { ...common, kind: 'resource-binding', document: `content/${id}.json`, nodeId: 'first', property: 'assetRef' },
    ])
    const read = async (contentChecks: typeof checks) => {
      await writeFile(join(workspace, 'acceptance.json'), JSON.stringify({ scope: 'delivery', status: 'passed', summary: 'Synthetic coverage', environment: 'Synthetic',
        evidencePaths: ['evidence.txt'], artifactPaths: ['game.js'], verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [], unverified: [], contentChecks } }))
      return (await readRuntimeAcceptanceReport(workspace, 'acceptance.json'))!
    }
    const accepted = await read(checks)
    expect(accepted.status).toBe('passed')
    expect(await runtimeEvidenceIsCurrent(workspace, [accepted])).toBe(true)
    for (const omitted of checks.filter(c => c.document.includes('b.json'))) {
      const partial = checks.filter(c => c !== omitted)
      const report = await read(partial)
      expect(report.status).toBe('blocked')
      expect(report.diagnostic?.category).toBe('verification-incomplete')
      expect(report.summary).toContain(omitted.document)
      expect(await runtimeEvidenceIsCurrent(workspace, [{ ...accepted, verification: { ...accepted.verification!, contentChecks: partial as any } }])).toBe(false)
    }
    const report = await read(checks.filter(c => !c.document.includes('b.json')))
    expect(report.summary).toContain('ui-layout (content/ui/b.json)')
    expect(report.summary).toContain('scene-layout (content/b.json)')
    expect(report.summary).toContain('resource-binding (content/b.json)')
    const script = join(workspace, 'check.mjs')
    await writeFile(script, await bundleAcceptanceChecker())
    const run = Bun.spawnSync([process.execPath, script, 'acceptance.json'], { cwd: workspace })
    expect(run.exitCode).toBe(1)
    expect(JSON.parse(run.stdout.toString())).toMatchObject({ diagnostic: report.diagnostic, publishReadiness: 'not-checked' })
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

test.each(['scene-2d', 'scene-3d'] as const)('%s resource and geometry verification cannot be replaced by UI text checks', async kind => {
  const workspace = await mkdtemp(join(tmpdir(), 'bgs-scene-binding-'))
  try {
    await mkdir(join(workspace, 'content'), { recursive: true })
    await writeFile(join(workspace, 'content/index.json'), JSON.stringify({
      schema: 'beegame-content-package.v2', id: 'test', dimension: kind === 'scene-2d' ? '2d' : '3d',
      documentRevision: 'a'.repeat(64), assetManifestRevision: 'b'.repeat(64),
      entryScene: 'world', sceneModel: 'game-object-v2', files: ['world.json'],
    }))
    await writeFile(join(workspace, 'content/world.json'), JSON.stringify({
      schema: 'beegame-content.v1', id: 'world', kind, assetRefs: ['visual'],
      data: { nodes: [{ id: 'object', transform: { position: [0, 0, 0] }, components: kind === 'scene-2d' ? [
        { id: 'map', type: 'tilemap', data: { schema: 'tilemap.v1', gridNodeId: 'object', cells: [{ x: 0, y: 0, tileId: 'ground' }] } },
      ] : [] }] },
    }))
    await writeFile(join(workspace, 'game.js'), 'build')
    await writeFile(join(workspace, 'evidence.txt'), 'Target-runtime before/after observation')
    const scene = { kind: 'scene-layout', document: 'content/world.json', nodeId: 'object', property: 'transform',
      change: 'Translate object', expected: 'Object moves', observed: 'Object moved to authored coordinates',
      status: 'passed', evidencePaths: ['evidence.txt'] }
    const read = async (contentChecks: unknown[]) => {
      await writeFile(join(workspace, 'acceptance.json'), JSON.stringify({ scope: 'delivery', status: 'passed',
        summary: 'Verified', environment: 'Target engine', evidencePaths: ['evidence.txt'], artifactPaths: ['game.js'],
        verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [], unverified: [], contentChecks } }))
      return readRuntimeAcceptanceReport(workspace, 'acceptance.json')
    }
    expect((await read([scene]))?.summary).toContain('resource-binding')
    const resource = { ...scene, kind: 'resource-binding', property: 'assetRef', change: 'Replace authored assetRef',
      expected: 'New asset renders', observed: 'New asset decoded and rendered' }
    const map = { ...scene, property: 'tilemap', change: 'Move an authored cell', expected: 'Tile moves', observed: 'Tile moved' }
    if (kind === 'scene-2d') {
      expect((await read([map, resource]))?.summary).toContain('unverified: scene-layout')
      expect((await read([scene, resource]))?.summary).toContain('scene-layout/tilemap')
      expect((await read([scene, map, resource]))?.status).toBe('passed')
    } else {
      expect((await read([scene, resource]))?.status).toBe('passed')
      const report = await read([scene, map, resource])
      expect(report?.summary).toContain('without a Tilemap')
      expect(report?.diagnostic?.category).toBe('report-invalid')
      const script = join(workspace, 'check.mjs')
      await writeFile(script, await bundleAcceptanceChecker())
      const source = await readFile(join(workspace, 'content/world.json'), 'utf8')
      const run = Bun.spawnSync([process.execPath, script, 'acceptance.json'], { cwd: workspace })
      expect(run.exitCode).toBe(1)
      expect(JSON.parse(run.stdout.toString())).toMatchObject({ diagnostic: report?.diagnostic,
        check: 'report-content-evidence', publishReadiness: 'not-checked' })
      expect(await readFile(join(workspace, 'content/world.json'), 'utf8')).toBe(source)
    }
  } finally { await rm(workspace, { recursive: true, force: true }) }
})
