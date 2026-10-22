import { test, expect } from 'bun:test'
import sharp from 'sharp'
import { access, copyFile, mkdir, mkdtemp, realpath, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openAgentTools, openDesignActions } from './agent-tools'
import { sharedContentChecker } from '../content-checker-runtime'
import { CONTENT_DRAFT_EXAMPLES } from '../game-content-validation-cli'
import { openPreviewTestAccess } from '../preview-test-access'
import { projectPreviewCapabilityPath } from '../project-preview-capability'
import { createPreviewTestBrowser } from '../preview-test-browser'
import { sharedPlaywright } from '../shared-playwright'
import { buildEditableProject } from './editable-project'
import { sceneLayoutFixture, uiLayoutFixture } from '../fixtures/layout-fixture'
import { createHash } from 'node:crypto'
import { registeredContentChecks } from './agent-measurement'
import { runArtifactCheck } from './runtime-checks'
import { readContentView } from './content-view'
import { designHandoffPath, readDesignImplementationChecklist } from '../design-handoff'
import { writeDesignDocumentsFixture, designHandoffFixture } from '../fixtures/layout-fixture'
import { BALANCE_CALCULATOR_PATH, materializeBalanceCalculator } from '../balance-calculation'

test('finalize supports existing scoped documents and preserves independent work when a sibling is invalid', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-scoped-design-')))
  try {
    await writeDesignDocumentsFixture(root, ['GDD.md'])
    const design = openDesignActions(root)
    const path = join(root,'docs/GDD.md')
    await writeFile(path,(await readFile(path,'utf8')).replace('Fixture decision.','Changed decision.'))
    expect(await design('finalize')).toMatchObject({valid:true,finalized:['GDD.md']})
    await writeFile(join(root,'docs/AUDIO_DESIGN.md'),'Malformed unrelated draft')
    const original = await readFile(path,'utf8')
    expect(await design('finalize',['docs/GDD.md'])).toMatchObject({valid:true,finalized:['GDD.md']})
    expect(await readFile(path,'utf8')).toBe(original)
    await writeFile(path,original.replace('Changed decision.','Another decision.'))
    expect(await design('finalize')).toMatchObject({valid:true,finalized:['GDD.md'],skipped:['AUDIO_DESIGN.md']})
    const finalized = await readFile(path,'utf8')
    expect(finalized).not.toBe(original)
    await design('finalize')
    expect(await readFile(path,'utf8')).toBe(finalized)
    expect(await readFile(join(root,'docs/AUDIO_DESIGN.md'),'utf8')).toBe('Malformed unrelated draft')
    await expect(design('finalize',['../GDD.md'])).rejects.toThrow('document name')
  } finally { await rm(root,{recursive:true,force:true}) }
})

test('design handoff exposes early requirements and optional implementation pointers without a required task graph', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-design-actions-')))
  try {
    await writeDesignDocumentsFixture(root)
    const design = openDesignActions(root)
    const techPath = join(root, designHandoffPath('TECHNICAL_DESIGN.md'))
    const tech = designHandoffFixture('TECHNICAL_DESIGN.md')
    delete tech.implementationItems
    await writeFile(techPath, JSON.stringify(tech))
    expect(await design('finalize')).toMatchObject({valid:true})
    const baseline = await design('baseline') as any
    expect(baseline.valid).toBe(true)
    expect(baseline.requirements).toHaveLength(8)
    expect(await design('implementation')).toMatchObject({ valid: true, items: [] })
    await writeFile(techPath, JSON.stringify(designHandoffFixture('TECHNICAL_DESIGN.md')))
    expect(await design('finalize')).toMatchObject({valid:true})
    expect(await design('implementation')).toMatchObject({valid:true,globalSources:baseline.requirements.map((r:any)=>'docs/'+r.document)})
    await rm(join(root, 'docs/AUDIO_DESIGN.md'))
    const partial = await design('baseline') as any
    expect(partial.valid).toBe(false)
    expect(partial.requirements).toHaveLength(7)
    expect(partial.requirements.some((item:any)=>item.document==='AUDIO_DESIGN.md')).toBe(false)
  } finally { await rm(root, {recursive:true,force:true}) }
})

test('technical draft checks supplied references without requiring full task coverage', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-incremental-technical-')))
  try {
    const early = ['GDD.md', 'LEVEL_SCENE_DESIGN.md', 'BALANCE_DESIGN.md', 'TECHNICAL_DESIGN.md'] as const
    const pending = ['ART_DIRECTION.md', 'UI_UX_SPEC.md', 'AUDIO_DESIGN.md', 'ASSET_PLAN.md'] as const
    await writeDesignDocumentsFixture(root, early)
    const design = openDesignActions(root)
    const path = join(root, designHandoffPath('TECHNICAL_DESIGN.md'))
    const original = await readFile(path, 'utf8')
    expect(await design('draft', ['TECHNICAL_DESIGN.md'])).toMatchObject({
      valid: true, issues: [], pendingDocuments: [...pending], taskReferencesChecked: false,
      availableRequirements: expect.arrayContaining([expect.objectContaining({ document: 'GDD.md' })]),
    })
    expect(await readFile(path, 'utf8')).toBe(original)
    for (const name of pending) await expect(access(join(root, 'docs', name))).rejects.toThrow()
    expect(() => readDesignImplementationChecklist(root)).toThrow()

    await writeDesignDocumentsFixture(root, pending)
    expect(await design('draft', ['TECHNICAL_DESIGN.md'])).toMatchObject({
      valid: true, issues: [], pendingDocuments: [], taskReferencesChecked: true,
    })
    const incomplete = JSON.parse(original)
    incomplete.implementationItems = incomplete.implementationItems.filter((item: any) =>
      !item.requirementRefs.some((ref: any) => ref.document === 'GDD.md'))
    await writeFile(path, JSON.stringify(incomplete))
    const uncovered = await design('draft', ['TECHNICAL_DESIGN.md']) as any
    expect(uncovered).toMatchObject({ valid: true, issues: [], pendingDocuments: [], taskReferencesChecked: true })
    expect(await readFile(path, 'utf8')).toBe(JSON.stringify(incomplete))
    expect(readDesignImplementationChecklist(root).items.some(item => item.id === 'fixture-GDD')).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test.each(['document', 'index'] as const)('technical draft distinguishes an unwritten sibling %s from a bad saved reference', async missing => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-technical-pending-pair-')))
  try {
    await writeDesignDocumentsFixture(root)
    await rm(join(root, missing === 'document' ? 'docs/ART_DIRECTION.md' : designHandoffPath('ART_DIRECTION.md')))
    expect(await openDesignActions(root)('draft', ['TECHNICAL_DESIGN.md'])).toMatchObject({
      valid: missing === 'document', pendingDocuments: missing === 'document' ? ['ART_DIRECTION.md'] : [], taskReferencesChecked: missing === 'index',
    })
    expect(() => readDesignImplementationChecklist(root)).toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test.each(['missing-reference', 'bad-source-heading', 'malformed-index', 'invalid-index-fields', 'pending-malformed-index', 'cycle', 'dangling-source'] as const)(
  'pending technical inputs do not hide an actual %s error', async fault => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-technical-draft-errors-')))
    try {
      await writeDesignDocumentsFixture(root, ['GDD.md', 'TECHNICAL_DESIGN.md'])
      const technicalPath = join(root, designHandoffPath('TECHNICAL_DESIGN.md'))
      const technical = JSON.parse(await readFile(technicalPath, 'utf8'))
      let expected = ''
      if (fault === 'missing-reference') {
        technical.implementationItems[0].requirementRefs[0].id = 'invented'
        await writeFile(technicalPath, JSON.stringify(technical))
        expected = 'references missing requirement GDD.md#invented'
      } else if (fault === 'bad-source-heading') {
        const source = designHandoffFixture('GDD.md')
        source.outputs[0]!.section = 'Absent heading'
        await writeFile(join(root, designHandoffPath('GDD.md')), JSON.stringify(source))
        expected = 'output play references an absent section'
      } else if (fault === 'malformed-index' || fault === 'pending-malformed-index') {
        await writeFile(join(root, designHandoffPath(fault === 'malformed-index' ? 'GDD.md' : 'ART_DIRECTION.md')), '{')
        expected = 'Cannot check existing task references against ' + (fault === 'malformed-index' ? 'GDD.md' : 'ART_DIRECTION.md')
      } else if (fault === 'invalid-index-fields') {
        await writeFile(join(root, designHandoffPath('GDD.md')), JSON.stringify({ outputs: 'not-an-array' }))
        expected = 'checks requiring handoff.outputs were not run because the field is invalid'
      } else if (fault === 'cycle') {
        technical.implementationItems[0].dependsOn = [technical.implementationItems[1].id]
        technical.implementationItems[1].dependsOn = [technical.implementationItems[0].id]
        await writeFile(technicalPath, JSON.stringify(technical))
        expected = 'implementation dependency cycle'
      } else {
        await symlink(join(root, 'not-produced.md'), join(root, 'docs/ART_DIRECTION.md'))
        expect(() => openDesignActions(root)).toThrow('symlink')
        return
      }
      const before = await readFile(technicalPath, 'utf8')
      const draft = await openDesignActions(root)('draft', ['TECHNICAL_DESIGN.md']) as any
      expect(draft.valid).toBe(false)
      expect(draft.issues.join(' ')).toContain(expected)
      expect(await readFile(technicalPath, 'utf8')).toBe(before)
    } finally { await rm(root, { recursive: true, force: true }) }
  },
)

test('handoff sends reference reading to native Read without a visual certification command', async () => {
  const root = await mkdtemp(join(tmpdir(),'bgs-reference-help-'))
  try {
    const design = openDesignActions(root)
    const help = await design('help', [], undefined, true) as any
    expect(help.instruction).toContain('Read selected reference pictures')
    expect(help.instruction).toContain('Keep later inputs planned')
    expect(help.instruction).toContain('reconcile the interfaces and inputs needed for the current part before locking')
    expect(help.instruction).toContain('including the technical approach and necessary implementation guidance in TECHNICAL_DESIGN.md')
    expect(help.instruction).toContain('BGS does not require output indexes, task graphs or coverage mappings')
    expect(help.instruction).not.toContain('Technical notes before these inputs are drafts')
    expect(help.instruction).not.toContain('begin their geometry during planning')
    expect(help.help).toContain('Baseline checks saved sources and any existing index integrity, not visual design or layout geometry')
    expect(help.help).toContain('--design baseline --details')
    expect(help.help).not.toContain('baseline|visual')
    expect(help.help).not.toContain('generation record')
    await expect(design('visual')).rejects.toThrow('Unknown design action')
  } finally { await rm(root,{recursive:true,force:true}) }
})

async function command(root: string, directory: string, name: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, join(root, directory, name), ...args], {
    cwd: root, env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: (await sharedContentChecker()).moduleUrl,
      BEEGAME_PLAYWRIGHT_MODULE: sharedPlaywright().moduleUrl },
    stdout: 'pipe', stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { stdout, stderr, code }
}
test('existing balance helpers remain usable without default appendix guidance or automatic calculation', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs optional balance-')))
  await writeFile(join(root, 'parameters.json'), JSON.stringify({ count: 12, rate: 3 }))
  await writeFile(join(root, 'model.mjs'), `import {appendFile} from 'node:fs/promises';
export async function calculate({readJson}) {
  await appendFile('runs.txt', 'run\\n');
  const p = await readJson('parameters.json');
  return {tables:[{title:'Duration',columns:['seconds'],rows:[[p.count / p.rate]]}],
    checks:[{name:'Nonnegative count',passed:p.count >= 0,details:String(p.count)}],
    limitations:['Synthetic calculation, not a game simulator']};
}`)
  await materializeBalanceCalculator(root)
  const tools = await openAgentTools({ workspacePath: root, getAuthToken: () => undefined })
  try {
    expect(tools.systemContext).not.toContain(BALANCE_CALCULATOR_PATH)
    const help = await command(root, '', BALANCE_CALCULATOR_PATH, '--help')
    expect(help.code, help.stderr).toBe(0)
    expect(help.stdout).toContain('calculate({readJson, readText})')
    expect(help.stdout).toContain('--check-result')
    await expect(access(join(root, 'runs.txt'))).rejects.toThrow()
    const run = await command(root, '', BALANCE_CALCULATOR_PATH, 'model.mjs', 'result.md')
    expect(run.code, run.stderr).toBe(0)
    const result = await readFile(join(root, 'result.md'), 'utf8')
    expect(result).toContain('| 4 |')
    expect(await readFile(join(root, 'runs.txt'), 'utf8')).toBe('run\n')
    const retained = await command(root, '', BALANCE_CALCULATOR_PATH, '--check-result', 'result.md')
    expect(retained.code, retained.stderr).toBe(0)
    expect(JSON.parse(retained.stdout)).toMatchObject({ valid: true, scope: 'calculation-input-freshness' })
    expect(await readFile(join(root, 'runs.txt'), 'utf8')).toBe('run\n')
    expect(await readFile(join(root, 'result.md'), 'utf8')).toBe(result)
    await writeFile(join(root, 'parameters.json'), JSON.stringify({ count: -1, rate: 3 }))
    const failed = await command(root, '', BALANCE_CALCULATOR_PATH, 'model.mjs', 'result.md')
    expect(failed.code).toBe(1)
    expect(failed.stderr).toContain('Scenario check failed: Nonnegative count')
    expect(await readFile(join(root, 'result.md'), 'utf8')).toBe(result)
    expect(await readFile(join(root, 'runs.txt'), 'utf8')).toBe('run\nrun\n')
  } finally { await tools.close(); await rm(root, { recursive: true, force: true }) }
}, 30000)
test('actual author entry supplies executable pure UI examples with no manual hashes or dummy Scene', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-pure-ui-author-')))
  const tools = await openAgentTools({ workspacePath: root, getAuthToken: () => undefined })
  try {
    const format = await command(root, tools.directory, 'check-content.mjs', '--format', 'examples')
    expect(format.code, format.stdout+format.stderr).toBe(0)
    const examples = JSON.parse(format.stdout).values.examples
    expect(examples.index).not.toHaveProperty('documentRevision')
    expect(examples.index).not.toHaveProperty('assetManifestRevision')
    expect(examples.index).not.toHaveProperty('sceneModel')
    await mkdir(join(root, 'content/ui'), { recursive: true })
    const sources = { 'content/index.json': JSON.stringify(examples.index), 'content/ui/menu.json': JSON.stringify(examples.ui) }
    for (const [path, bytes] of Object.entries(sources)) await writeFile(join(root, path), bytes)
    const current = await command(root, tools.directory, 'check-content.mjs', '--current')
    expect(current.code, current.stdout+current.stderr).toBe(0)
    expect(JSON.parse(current.stdout)).toMatchObject({ valid: true, contentCount: 1, runtimeVerified: false })
    const checked = await registeredContentChecks(root, {}, true)
    expect(checked.map(c => [c.id, c.status, c.status === 'passed' ? '' : c.observation])).toEqual([
      ['content-structure', 'passed', ''], ['content-layout', 'passed', ''], ['content-resources', 'passed', ''],
    ])
    const view = await readContentView(root)
    expect(view).toMatchObject({ state: 'draft', indexIssues: [], index: { entryScene: 'menu' } })
    if (view.state === 'draft') expect(view.documents).toHaveLength(1)
    await mkdir(join(root, 'dist/content/ui'), { recursive: true })
    await writeFile(join(root, 'dist/index.html'), '<!doctype html><title>Synthetic package</title>')
    for (const [path, bytes] of Object.entries(sources)) await writeFile(join(root, 'dist', path), bytes)
    const delivery = await runArtifactCheck(root, 'delivery-package', { runtimeArtifact: 'dist', expectedOutputs: [] }, [], {})
    expect(delivery.status, delivery.observation).toBe('passed')
    for (const [path, bytes] of Object.entries(sources)) expect(await readFile(join(root, path), 'utf8')).toBe(bytes)
    await expect(access(join(root, 'content/scenes'))).rejects.toThrow()
    for (const invalid of [
      { ...examples.index, documentRevision: 'pending' },
      { ...examples.index, sceneModel: 'unsupported' },
      { ...examples.index, documents: [{ ...examples.index.documents[0], kind: 'ui-flow' }] },
      { ...examples.index, documents: [{ ...examples.index.documents[0], loadPhase: 'on-demand' }] },
    ]) {
      await writeFile(join(root, 'content/index.json'), JSON.stringify(invalid))
      expect((await command(root, tools.directory, 'check-content.mjs', '--current')).code).toBe(1)
      expect((await registeredContentChecks(root, {}, true))[0]?.status).toBe('failed')
    }
  } finally { await tools.close(); await rm(root, { recursive: true, force: true }) }
}, 30000)
test('materialized layout command preserves confirmed orientation without adding phone targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-layout-target-tools-'))
  const tools = await openAgentTools({ workspacePath: root, getAuthToken: () => undefined,
    constraints: { platform: 'Web', inputs: ['Touch'], orientation: 'Landscape', dimension: '2D' } })
  try {
    const ui = uiLayoutFixture() as any
    Object.assign(ui.data.nodes[0].data, { referenceResolution: [1280, 720], targetViewports: [[1280, 720]] })
    ui.data.nodes[0].layout.size = [1280, 720]
    Object.assign(ui.data.nodes[1].layout, { anchor: 'top-left', position: [1100, 30], size: [100, 60] })
    await mkdir(join(root, 'content/ui'), { recursive: true })
    const path = join(root, 'content/ui/menu.json'), bytes = JSON.stringify(ui)
    await writeFile(path, bytes)
    const check = await command(root, tools.directory, 'check-content.mjs', '--design-layouts', '--details')
    expect(check.code).toBe(0)
    const result = JSON.parse(check.stdout)
    expect(result.coverage.targets[0].viewports).not.toContainEqual([844, 390])
    expect(await readFile(path, 'utf8')).toBe(bytes)
    const conflict = await command(root, tools.directory, 'check-content.mjs', '--design-layouts', '--orientation', 'Portrait')
    expect(conflict.code).toBe(1)
    expect(conflict.stdout).toContain('differs from the confirmed project target')
  } finally { await tools.close(); await rm(root, { recursive: true, force: true }) }
})

test('autonomous tools use actual auth and drafts without stages, documents or invented authority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-agent-tools-'))
  const calls: string[] = []; let token = 'synthetic-user-a'
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    calls.push(request.headers.get('authorization') ?? '')
    return Response.json({ items: [{ packId: 'actual-fixture', license: 'CC0' }] })
  } })
  const tools = await openAgentTools({ workspacePath: root, libraryBaseUrl: upstream.url.origin, getAuthToken: () => token })
  try {
    const source = await readFile(join(root, tools.directory, 'assets.mjs'), 'utf8')
    expect(source).not.toContain(token); expect(tools.turnContext).not.toContain(token)
    expect(tools.turnContext.length).toBeLessThan(2200)
    expect(tools.turnContext).not.toContain('React/Canvas does not waive promised editable data') // responsibility remains in the production system slot
    expect(tools.turnContext).toContain('Tool availability is not runtime consumption or quality evidence')
    expect(tools.systemContext).toContain('consumer.mjs')
    expect(tools.systemContext).toContain('bun check-content.mjs --format uiLayoutContract')
    expect(tools.systemContext).toContain('bun resources.mjs --contract registration')
    expect(tools.turnContext).not.toContain('consumer.mjs')
    expect(tools.turnContext).not.toContain('Native bgs-ui-layout reads:')
    expect(tools.turnContext).not.toContain('detailsFor:')
    // Even with all compactable turn text discarded, the system locator is
    // sufficient to invoke current adapters; it contains no bridge secret.
    const located = JSON.parse(tools.systemContext.match(/root\): ("[^"]+")/)![1]!)
    expect(located).toBe(tools.directory)
    expect(tools.systemContext).not.toContain(token)
    expect(tools.systemContext).not.toContain('node preview.mjs') // unavailable here
    expect(tools.systemContext.length).toBeLessThan(600)
    const contracts = await command(root, located, 'check-content.mjs', '--format', 'index', 'preview')
    expect(contracts.code, contracts.stderr).toBe(0)
    expect(JSON.parse(contracts.stdout)).toMatchObject({
      ok: true, values: { preview: { environment: { origin: 'opaque' }, runtimeVerified: false, quality: 'unverified' } },
    })
    const layoutContract = await command(root, located, 'check-content.mjs', '--format', 'uiLayoutContract')
    expect(layoutContract.code, layoutContract.stderr).toBe(0)
    const layoutReference = JSON.parse(layoutContract.stdout).values.uiLayoutContract
    expect(layoutReference.model).toContain('before measurement/rendering')
    expect(layoutReference.responsive).toContain('width <= root data.compactMaxWidth')
    const registration = await command(root, located, 'resources.mjs', '--contract', 'registration')
    expect(registration.code, registration.stderr).toBe(0)
    expect(registration.stdout).toContain('root_path')
    expect(registration.stdout).toContain('file_paths')
    expect(registration.stdout).toContain('status, timestamps and registry modules are computed')
    for (const path of ['assets', 'content', 'docs']) await expect(access(join(root, path))).rejects.toThrow()
    // Execute the runtime advertised by navigation, not the test helper's Bun
    // default: a missing/wrong runtime used to send these entries through Node.
    for (const name of ['resources', 'bind-content']) {
      const runtime = tools.systemContext.match(new RegExp('(bun|node) ' + name + '\\.mjs'))?.[1]
      expect(runtime).toBeDefined()
      const child = Bun.spawn([runtime === 'bun' ? process.execPath : 'node', join(root, located, name+'.mjs'), '--help'],
        { cwd: root, env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: (await sharedContentChecker()).moduleUrl },
          stdout: 'pipe', stderr: 'pipe' })
      const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      expect(code, out + err).toBe(0)
      if (name === 'bind-content') {
        expect(out).toContain('current BGS tools directory supplied in the project context')
        expect(out).toContain('bun <current-tools-directory>/bind-content.mjs --inspect')
        expect(out).toContain('bun <current-tools-directory>/bind-content.mjs --current')
        expect(out).not.toContain('.beegame/delivery/')
      }
    }
    const consumerHelp=await command(root,tools.directory,'consumer.mjs','--help')
    expect(consumerHelp.code).toBe(0)
    expect(consumerHelp.stdout).toContain(tools.directory+'/content-consumer.mjs')
    expect(consumerHelp.stdout).toContain('host tool files are excluded')
    expect(consumerHelp.stdout).toContain('Camera center AND orthographicSize')
    expect(consumerHelp.stdout).toContain('beforeNavigate')
    const consumer=await import(join(root,tools.directory,'content-consumer.mjs'))
    expect(typeof consumer.createProductionUiSurface).toBe('function')
    expect(typeof consumer.sceneNodeClientPoint2d).toBe('function')
    expect((await command(root, tools.directory, 'assets.mjs', '--help')).stdout).toContain(tools.directory + '/media.mjs')
    expect(JSON.parse((await command(root, tools.directory, 'assets.mjs', 'catalog')).stdout).items[0].packId).toBe('actual-fixture')
    token = 'synthetic-user-b'
    expect((await command(root, tools.directory, 'assets.mjs', 'pack', 'actual-fixture')).code).toBe(0)
    expect(calls).toEqual(['Bearer synthetic-user-a', 'Bearer synthetic-user-b'])
    const format = await command(root, tools.directory, 'check-content.mjs', '--format', 'coordinates', 'uiVocabulary')
    expect(format.code, format.stdout).toBe(0)
    expect(JSON.parse(format.stdout).values).toHaveProperty('coordinates')
    expect(JSON.stringify(JSON.parse(format.stdout))).not.toContain('documentRevision')
    const ui = structuredClone(CONTENT_DRAFT_EXAMPLES.ui)
    await writeFile(join(root, 'menu.json'), JSON.stringify(ui))
    expect((await command(root, tools.directory, 'check-content.mjs', '--check-drafts', 'menu.json')).code).toBe(0)
    const layout = await command(root, tools.directory, 'check-content.mjs', '--layout-draft', 'menu.json', '960', '540')
    expect(layout.code, layout.stdout).toBe(0); expect(JSON.parse(layout.stdout).scope).toContain('draft')
    const resourceContract = await command(root, tools.directory, 'resources.mjs', '--contract')
    expect(resourceContract.code, resourceContract.stderr).toBe(0)
    expect(resourceContract.stdout).toContain('Asset Manifest authoring contract')
    expect(resourceContract.stdout).toContain('current BGS\ntools directory')
    expect(resourceContract.stdout).toContain('check-content.mjs --current')
    expect(resourceContract.stdout).toContain('This command requires a content index.')
    expect(resourceContract.stdout).not.toContain('assets/manifest/check.mjs')
    expect(resourceContract.stdout).not.toContain('CONTRACT.md')
    await expect(access(join(root, 'assets'))).rejects.toThrow()
    const mediaHelp = await command(root, tools.directory, 'media.mjs', '--help')
    expect(mediaHelp.code, mediaHelp.stderr).toBe(0)
    expect(mediaHelp.stdout).toContain('current BGS tools directory supplied in the project context')
    expect(mediaHelp.stdout).toContain('bun <current-tools-directory>/media.mjs request.json')
    expect(mediaHelp.stdout).not.toContain('.beegame/delivery/')
    for (const name of ['check-content.mjs', 'media.mjs', 'resources.mjs', 'bind-content.mjs']) {
      const wrongRuntime = Bun.spawn([Bun.which('node')!, join(root,tools.directory,name), '--help'], {
        cwd: root, env: { PATH: process.env.PATH, BEEGAME_CONTENT_CHECKER_MODULE: 'file:///absent-fixture.mjs' },
        stdout: 'pipe', stderr: 'pipe',
      })
      const output = await new Response(wrongRuntime.stdout).text()
      expect(await wrongRuntime.exited).toBe(1)
      expect(JSON.parse(output).issues[0]).toContain('BGS_BUN_REQUIRED')
      expect(output).not.toContain('UH is not a function')
    }
    const batch = await command(root, tools.directory, 'check-content.mjs', '--review-sources', 'menu.json', '--details')
    expect(batch.code, batch.stdout).toBe(0)
    expect(JSON.parse(batch.stdout).sources[0].text).toBe(await readFile(join(root,'menu.json'),'utf8'))
    const full = await command(root, tools.directory, 'check-content.mjs', '--authority')
    expect(full.code).toBe(1); expect(JSON.parse(full.stdout).valid).toBe(false)
    for (const path of ['docs', 'content/index.json', 'assets/asset-manifest.json', '.beegame/delivery/content-format.json'])
      await expect(access(join(root, path))).rejects.toThrow()
    // Use the actual V3-published tool, not a replacement wrapper, to create
    // only first-index metadata. The author still saves the registry.
    await mkdir(join(root, 'content/scenes'), { recursive: true })
    await mkdir(join(root, 'content/ui'), { recursive: true })
    await writeFile(join(root, 'content/scenes/level.json'), JSON.stringify(sceneLayoutFixture()))
    await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(ui))
    const first = await command(root, tools.directory, 'check-content.mjs', '--package-metadata',
      'content/scenes/level.json', 'content/ui/menu.json')
    expect(first.code, first.stdout + first.stderr).toBe(0)
    const metadata = JSON.parse(first.stdout)
    expect(metadata).toMatchObject({ valid: true, designVerified: false, runtimeVerified: false })
    await expect(access(join(root, 'content/index.json'))).rejects.toThrow()
    await writeFile(join(root, 'content/index.json'), JSON.stringify({ schema: 'beegame-content-package.v2',
      id: 'synthetic-first', dimension: '2d', sceneModel: 'game-object-v2', entryScene: 'level',
      files: ['scenes/level.json', 'ui/menu.json'], ...metadata.indexMetadata,
      documents: [{ id: 'level', kind: 'scene-2d', path: 'scenes/level.json', loadPhase: 'startup' },
        { id: 'menu', kind: 'ui-screen', path: 'ui/menu.json', loadPhase: 'on-demand' }] }))
    const current = await command(root, tools.directory, 'check-content.mjs')
    expect(current.code, current.stdout + current.stderr).toBe(0)
    expect(JSON.parse(current.stdout)).toMatchObject({ valid: true, designVerified: false, runtimeVerified: false })
    await expect(access(join(root, 'docs'))).rejects.toThrow()
    await expect(access(join(root, 'assets/asset-manifest.json'))).rejects.toThrow()
    await mkdir(join(root,'.beegame/delivery'),{recursive:true})
    await writeFile(join(root,'.beegame/delivery/content-format.json'),'{invalid-existing-format')
    const corrupt = await command(root,tools.directory,'check-content.mjs','--format','coordinates')
    expect(corrupt.code).toBe(1) // only absent format falls back; corruption stays visible
    await writeFile(join(root,'.beegame/delivery/content-format.json'),JSON.stringify({fixtureSection:{kept:true}}))
    const retained = await command(root,tools.directory,'check-content.mjs','--format','fixtureSection')
    expect(JSON.parse(retained.stdout).values.fixtureSection).toEqual({kept:true})
    expect(await readFile(join(root,'.beegame/delivery/content-format.json'),'utf8')).toBe('{"fixtureSection":{"kept":true}}')
    await tools.close()
    const closed = await command(root, tools.directory, 'assets.mjs', 'catalog')
    expect(closed.code).toBe(1); expect(calls).toHaveLength(2)
  } finally { await tools.close(); upstream.stop(true); await rm(root, { recursive: true, force: true }) }
}, 30000)

test('tool preparation leaves catalog reads to the Agent through the existing authenticated entry',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-catalog-on-demand-'))
  const calls:{path:string;auth:string|null}[]=[]
  const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
    calls.push({path:new URL(request.url).pathname,auth:request.headers.get('authorization')})
    return Response.json({items:[{packId:'audio-pack',license:'CC0'}],total:1})
  }})
  const tools=await openAgentTools({workspacePath:root,libraryBaseUrl:upstream.url.origin,getAuthToken:()=> 'synthetic-catalog-token'})
  try {
    expect(calls).toHaveLength(0)
    expect(tools.turnContext).not.toContain('audio-pack')
    expect(tools.turnContext).not.toContain('Initial built-in resource catalog')
    const result=await command(root,tools.directory,'assets.mjs','catalog')
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('audio-pack')
    expect(calls).toEqual([{path:'/api/resource-catalog/packs',auth:'Bearer synthetic-catalog-token'}])
    await expect(access(join(root,'assets'))).rejects.toThrow()
  }finally{await tools.close();upstream.stop(true);await rm(root,{recursive:true,force:true})}
},30000)

test('missing credentials and invalid configuration do not become empty catalogs or block pure tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-agent-tools-unavailable-'))
  const upstream = Bun.serve({ hostname:'127.0.0.1', port:0, fetch:()=>{ throw Error('No unauthenticated upstream call allowed') } })
  const tools = await openAgentTools({ workspacePath:root, libraryBaseUrl:upstream.url.origin, getAuthToken:()=>undefined })
  try {
    expect(tools.turnContext).toContain('Resource library bridge is configured; catalog requests verify authentication/availability')
    const failed = await command(root,tools.directory,'assets.mjs','catalog')
    expect(failed.code).toBe(1); expect(failed.stderr).toContain('not an empty search result')
    const invalid = await openAgentTools({workspacePath:root,libraryBaseUrl:'file:///not-a-service',getAuthToken:()=>undefined})
    try {
      expect(invalid.turnContext).toContain('could not start')
      expect(invalid.turnContext).not.toContain('Initial built-in resource catalog')
      expect((await command(root,invalid.directory,'check-content.mjs','--format','coordinates')).code).toBe(0)
      expect((await command(root,invalid.directory,'assets.mjs','catalog')).code).toBe(1)
    } finally { await invalid.close() }
  } finally { await tools.close(); upstream.stop(true); await rm(root,{recursive:true,force:true}) }
},30000)

test('image quote is read-only and a generated visual proposal is saved for later inspection', async () => {
  const root=await mkdtemp(join(tmpdir(),'bgs-agent-image-proposal-'))
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64')
  let quotes=0,generated=0
  const bridge=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    if(request.method==='GET'){
      quotes++
      return Response.json({available:true,provider:'fixture',billingSource:'external'})
    }
    generated++
    return new Response(png,{headers:{'content-type':'image/png'}})
  }})
  const tools=await openAgentTools({workspacePath:root,getAuthToken:()=>undefined,
    openImage:()=>({endpoint:bridge.url.origin+'/generate',instruction:'fixture image bridge',close:async()=>{}})})
  try {
    expect(tools.turnContext).toContain('not yet verified available')
    expect(quotes).toBe(0)
    expect(generated).toBe(0)
    const quote=await command(root,tools.directory,'assets.mjs','cost')
    expect(quote.code,quote.stderr).toBe(0)
    expect(JSON.parse(quote.stdout).available).toBe(true)
    expect(quotes).toBe(1)
    await writeFile(join(root,'visual-request.json'),JSON.stringify({requestId:'visual-proposal-1',prompt:'Fixture play and UI view'}))
    const saved=await command(root,tools.directory,'assets.mjs','generate','visual-request.json','assets/concepts/visual-target.png')
    expect(saved.code,saved.stderr).toBe(0)
    expect(JSON.parse(saved.stdout)).toMatchObject({path:'assets/concepts/visual-target.png',
      sha256:createHash('sha256').update(png).digest('hex')})
    expect(await readFile(join(root,'assets/concepts/visual-target.png'))).toEqual(png)
    expect(generated).toBe(1)
  }finally{await tools.close();bridge.stop(true);await rm(root,{recursive:true,force:true})}
},30000)

test('an open image bridge does not falsely claim its default quote is usable',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-agent-image-unavailable-'))
  let generated=0
  const bridge=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
    if(request.method==='GET')return Response.json({available:false})
    generated++
    return new Response('not available',{status:503})
  }})
  const tools=await openAgentTools({workspacePath:root,getAuthToken:()=>undefined,
    openImage:()=>({endpoint:bridge.url.origin+'/generate',instruction:'fixture image bridge',close:async()=>{}})})
  try {
    expect(tools.turnContext).toContain('not yet verified available')
    expect(generated).toBe(0)
    expect(JSON.parse((await command(root,tools.directory,'assets.mjs','cost')).stdout).available).toBe(false)
  }finally{await tools.close();bridge.stop(true);await rm(root,{recursive:true,force:true})}
},30000)

test('a chosen consumer copy remains buildable without the temporary host tools',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-v3-consumer-build-'))
  const tools=await openAgentTools({workspacePath:root,getAuthToken:()=>undefined})
  try {
    await mkdir(join(root,'src'))
    const installed=await command(root,tools.directory,'consumer.mjs','--install','src/bgs-content-consumer.mjs')
    expect(installed.code,installed.stderr).toBe(0)
    expect(JSON.parse(installed.stdout)).toMatchObject({alreadyPresent:false,runtimeVerified:false})
    expect(JSON.parse((await command(root,tools.directory,'consumer.mjs','--install','src/bgs-content-consumer.mjs')).stdout).alreadyPresent).toBe(true)
    const publicationHelp = await command(root,tools.directory,'consumer.mjs','--help')
    expect(publicationHelp.code,publicationHelp.stderr).toBe(0)
    expect(publicationHelp.stdout).toContain('every registered resource file_paths entry and dependency local_path')
    expect(publicationHelp.stdout).toContain('required licenses')
    expect(publicationHelp.stdout).toContain('another packaging manifest')
    const assetHelp = await command(root,tools.directory,'assets.mjs','generate','--help')
    expect(assetHelp.code,assetHelp.stderr).toBe(0)
    expect(assetHelp.stdout).toContain('purpose: reference|experiment|production')
    expect(assetHelp.stdout).toContain('existing Manifest requirementIds')
    const publication=await command(root,tools.directory,'consumer.mjs','--install-runtime-files','src/bgs-runtime-files.mjs')
    expect(publication.code,publication.stderr).toBe(0)
    expect(await readFile(join(root,'src/bgs-runtime-files.mjs'),'utf8')).toContain('copyRegisteredRuntimeFiles')
    await writeFile(join(root,'src/main.js'),"import{readUiData}from'./bgs-content-consumer.mjs';window.readUiData=readUiData;")
    await writeFile(join(root,'package.json'),JSON.stringify({scripts:{build:'bun build.mjs'}}))
    await writeFile(join(root,'build.mjs'),"import{writeFile}from'node:fs/promises';const r=await Bun.build({entrypoints:['src/main.js'],outdir:'dist',target:'browser'});if(!r.success)throw Error('Synthetic build failed');await writeFile('dist/index.html','<!doctype html><script src=main.js></script>');")
    const built=await buildEditableProject(root,{editableProject:true,runtimeArtifact:'dist',writablePaths:['dist/**']},[],[])
    expect(built.status,built.observation).toBe('passed')
    expect(built.projectBuild!.files.some(f=>f.path==='src/bgs-content-consumer.mjs')).toBe(true)
    expect(built.projectBuild!.files.some(f=>f.path.startsWith('.beegame/'))).toBe(false)
    expect(await readFile(join(root,'src/bgs-content-consumer.mjs'),'utf8')).toBe(await readFile(join(root,tools.directory,'content-consumer.mjs'),'utf8'))
  } finally {await tools.close();await rm(root,{recursive:true,force:true})}
},30000)

// Uses the module supplied by the V3 entry, not a hand-built replacement or a
// real game. No personal Chrome profile, model or resource download is involved.
test('consumer compatibility is batched/read-only and installation never overwrites or follows a link',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-consumer-access-')))
  const tools=await openAgentTools({workspacePath:root,getAuthToken:()=>undefined})
  try {
    const api=await command(root,tools.directory,'consumer.mjs','--api')
    expect(api.code,api.stderr).toBe(0)
    const reference=JSON.parse(api.stdout)
    expect(reference.createProductionUiSurface.lifecycle).toContain('No update/setState')
    expect(reference.createProductionUiSurface.assets).toContain('text/actions stay live')
    expect(reference.createProductionUiSurface).not.toHaveProperty('skinButtonExample')
    expect(api.stdout).not.toContain('#38e8ff')
    expect(reference.documents.fetchStartupContentDocuments).toContain('document[] (not a Map)')
    expect(reference.scene.sceneWorldTransforms2d).toContain('{poses: Map')
    expect(reference.scene.sceneWorldTransforms2d).toContain('[a,b,c,d,tx,ty]')
    expect(reference.scene.sceneWorldTransforms2d).toContain('{size:[width,height],position:[x,y]}')
    expect(reference.scene.inspectSceneLayout2d).toContain('{left,top,right,bottom}')
    expect(reference.scene.inspectSceneLayout2d).toContain('nonvisual nodes can lack bounds')
    expect(reference.resources.SurfaceImage).toContain('[sx,sy,sw,sh]')
    expect(reference.resources.resolveSurfaceImage).toContain('member?,frame?,initialFacing?')
    expect(reference.scene.resolveSceneCameraView).toContain('orthographicSize')
    const consumer = await import(join(root, tools.directory, 'content-consumer.mjs'))
    const geometry = consumer.sceneWorldTransforms2d([
      {id:'parent',transform:{position:[10,20,0],scale:[2,3,1]}},
      {id:'panel',parentId:'parent',transform:{position:[1,2,0]},components:[{type:'rect-transform',data:{
        anchorMin:[0,0],anchorMax:[0,0],pivot:[.5,.5],anchoredPosition:[4,5],sizeDelta:[20,10],
      }}]},
      {id:'anchor',parentId:'panel',transform:{position:[3,4,0]}},
    ])
    expect(geometry.poses).toBeInstanceOf(Map)
    expect(geometry.rects).toBeInstanceOf(Map)
    expect(geometry.rects.get('panel')).toEqual({size:[20,10],position:[4,5]})
    expect(geometry.poses.get('panel')).toHaveLength(6)
    expect(consumer.point2d(geometry.poses.get('panel'),1,1)).toEqual([22,44])
    expect(geometry.poses.get('anchor').slice(4)).toEqual([26,53])
    expect(geometry.rects.has('anchor')).toBe(false)
    for (const name of Object.keys(reference.layout).filter(name => name !== 'notes'))
      expect(typeof consumer[name], `Discoverable layout export: ${name}`).toBe('function')
    const image = { source: { width: 64, height: 32 }, url: 'https://fixture.test/sheet.png', frame: [16, 0, 16, 16] }
    const assets = new Map([['atlas:sheet#coin', image]])
    expect(consumer.resolveSurfaceImage(assets, 'atlas', { member: 'sheet', frame: 'coin.png' })).toBe(image)
    expect(() => consumer.resolveSurfaceImage(assets, 'atlas', { member: 'sheet', frame: 'missing' })).toThrow('Missing decoded')
    expect(consumer.resolveSceneCameraView({ orthographic: true, viewport: { width: 960, height: 540 },
      orthographicSize: 5 }, { width: 480, height: 480 })).toMatchObject({
      projection: 'orthographic', framing: 'keep-height', halfWidth: 5, halfHeight: 5,
      rect: { x: 0, y: 0, width: 480, height: 480 },
    })
    // Keep the capability table compact even with a larger native output budget.
    expect(api.stdout.length).toBeLessThan(10_000)
    const doc={schema:'beegame-content.v1',id:'menu',kind:'ui-screen',assetRefs:[],data:{rootId:'root',nodes:[
      {id:'root',role:'screen-root'}, {id:'text',parentId:'root',role:'text',text:'Go',style:{align:'left',fontSize:18},layout:{size:[80,30]}},
      {id:'button',parentId:'root',role:'button',data:{action:'legacy-action'},layout:{size:[80,30]}},
    ]}}
    const source=JSON.stringify(doc);await writeFile(join(root,'menu.json'),source)
    const inspection=await command(root,tools.directory,'consumer.mjs','--inspect','menu.json')
    expect(inspection.code,inspection.stderr).toBe(0)
    expect(JSON.parse(inspection.stdout).results[0].support).toMatchObject({supported:false,issues:[],
      projectSemantics:[{nodeId:'button',property:'data.action'}],runtimeVerified:false})
    expect(await readFile(join(root,'menu.json'),'utf8')).toBe(source)
    await mkdir(join(root,'src'));await writeFile(join(root,'src/custom.mjs'),'keep existing implementation')
    expect((await command(root,tools.directory,'consumer.mjs','--install','src/custom.mjs')).code).toBe(1)
    expect(await readFile(join(root,'src/custom.mjs'),'utf8')).toBe('keep existing implementation')
    await symlink(join(root,'src/custom.mjs'),join(root,'src/link.mjs'))
    expect((await command(root,tools.directory,'consumer.mjs','--install','src/link.mjs')).code).toBe(1)
    await symlink(join(root,'src'),join(root,'alias'))
    expect((await command(root,tools.directory,'consumer.mjs','--install','alias/new.mjs')).code).toBe(1)
    await expect(access(join(root,'src/new.mjs'))).rejects.toThrow()
    for(const path of ['../outside.mjs','.beegame/consumer.mjs','src/node_modules/module.mjs'])
      expect((await command(root,tools.directory,'consumer.mjs','--install',path)).code).toBe(1)
  }finally{await tools.close();await rm(root,{recursive:true,force:true})}
},30000)

test.skipIf(process.env.BGS_LAYOUT_BROWSER!=='1')('V3 consumer paints saved geometry/font mutations and applies the authored Camera',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-v3-consumer-browser-'))
  const tools=await openAgentTools({workspacePath:root,getAuthToken:()=>undefined})
  const browserAccess=createPreviewTestBrowser()
  const source=await readFile(join(root,tools.directory,'content-consumer.mjs'),'utf8')
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
    return new URL(request.url).pathname==='/consumer.mjs' ? new Response(source,{headers:{'Content-Type':'application/javascript'}})
      : new Response('<!doctype html><style>body{margin:0}</style><body></body>',{headers:{'Content-Type':'text/html'}})
  }})
  let driver:ReturnType<typeof Bun.spawn>|undefined
  try {
    const {endpoint}=await browserAccess.start()
    const probe=async()=>{
      const url='/consumer.mjs',lib=await import(url)
      const host=document.createElement('div');document.body.append(host)
      const data:any={rootId:'root',nodes:[
        {id:'root',role:'screen-root'},
        {id:'bar',parentId:'root',role:'container',layout:{anchorMin:[0,0],anchorMax:[1,0],sizeDelta:[0,48]}},
        {id:'label',parentId:'bar',role:'text',text:'Score',style:{fontSize:20,align:'left',verticalAlign:'top',lineHeight:22},layout:{anchor:'top-left',position:[8,4],size:[120,40]}},
        {id:'action',parentId:'root',role:'button',text:'Go',actions:{click:'go'},layout:{anchor:'top-right',position:[-5,8],size:[40,30]}},
      ]}
      const surface=await lib.createProductionUiSurface(host),viewport={width:600,height:300}
      let clicks=0
      const options={onAction:()=>clicks++}
      const before=JSON.stringify(data);surface.render(data,viewport,options)
      const bar=()=>host.querySelector('[data-node-id="bar"]')!.getBoundingClientRect()
      const font=()=>getComputedStyle(host.querySelector('[data-node-id="label"]')!).fontSize
      const labelStyle=getComputedStyle(host.querySelector('[data-node-id="label"]')!)
      const alias={align:labelStyle.textAlign,vertical:labelStyle.alignItems,lineHeight:labelStyle.lineHeight}
      const first={height:bar().height,font:font(),x:host.querySelector('[data-node-id="action"]')!.getBoundingClientRect().x}
      ;(host.querySelector('[data-node-id="action"]') as HTMLElement).click()
      const preserved=JSON.stringify(data)===before
      data.nodes[1].layout.sizeDelta[1]=72;data.nodes[2].style.fontSize=40
      surface.render(data,viewport,options);const changed={height:bar().height,font:font()}
      data.nodes[1].enabled=false;surface.render(data,viewport,options)
      const hidden=!host.querySelector('[data-node-id="bar"]')&&!host.querySelector('[data-node-id="label"]')
      const scene:any={cameraNodeId:'cam',settings:{coordinateSystem:{origin:'top-left',units:'logical-pixels',width:600,height:300,pixelsPerUnit:100}},nodes:[
        {id:'cam',transform:{position:[300,150,0]},components:[{id:'cam-c',type:'camera',data:{orthographic:true,orthographicSize:1.5,pixelsPerUnit:100,coordinateSpace:'logical-pixels',viewport,framing:'expand'}}]},
        {id:'group',transform:{position:[25,0,0]}},
        {id:'dot',parentId:'group',transform:{position:[100,100,0]},components:[{id:'dot-c',type:'sprite-renderer',data:{size:[20,20],color:'#ff0000'}}]},
      ]}
      const canvas=document.createElement('canvas');document.body.append(canvas)
      const sample=()=>{
        lib.renderProductionScene2d(canvas,scene,viewport)
        const point=lib.sceneNodeClientPoint2d(scene,'dot',viewport,{x:0,y:0,width:600,height:300})
        return {point,red:canvas.getContext('2d')!.getImageData(Math.round(point.x),Math.round(point.y),1,1).data[0]}
      }
      const initial=sample();scene.nodes[0].transform.position[0]+=20;const moved=sample()
      scene.nodes[0].components[0].data.orthographicSize=3;const zoomed=sample()
      surface.dispose()
      return {first,changed,preserved,hidden,clicks,initial,moved,zoomed,alias}
    }
    // Node is also used by the existing production browser inspector. Bun's
    // WebSocket client cannot reliably complete Playwright's CDP handshake.
    const node=Bun.which('node');if(!node)throw Error('Installed Node required')
    const launched=Bun.spawn([node,'--input-type=module','-e',
      `const {chromium}=await import(process.env.BGS_PLAYWRIGHT_MODULE);const browser=await chromium.connectOverCDP(${JSON.stringify(endpoint)});try{const page=await browser.newPage();await page.goto(${JSON.stringify(server.url.origin)});console.log(JSON.stringify(await page.evaluate(${probe.toString()})))}finally{await browser.close()}`],
      {env:{PATH:process.env.PATH,BGS_PLAYWRIGHT_MODULE:sharedPlaywright().moduleUrl},stdout:'pipe',stderr:'pipe'})
    driver=launched
    const [output,errors,code]=await Promise.all([new Response(launched.stdout).text(),new Response(launched.stderr).text(),launched.exited])
    expect(code,errors).toBe(0);const result=JSON.parse(output)
    expect(result.first).toEqual({height:48,font:'20px',x:555})
    expect(result.alias).toEqual({align:'left',vertical:'flex-start',lineHeight:'22px'})
    expect(result.changed).toEqual({height:72,font:'40px'})
    expect(result.preserved).toBe(true);expect(result.hidden).toBe(true);expect(result.clicks).toBe(1)
    expect(result.initial.red).toBe(255);expect(result.moved.red).toBe(255)
    expect(result.initial.point.x-result.moved.point.x).toBeCloseTo(20,4)
    // Independent expected projection: center (320,150), world point (125,100),
    // half-height 3*100=300 in a 600x300 viewport => scale 0.5.
    expect(result.zoomed.point.x).toBeCloseTo(202.5,4)
    expect(result.zoomed.point.y).toBeCloseTo(125,4)
    expect(result.zoomed.red).toBe(255)
  } finally {driver?.kill();await browserAccess.close();server.stop(true);await tools.close();await rm(root,{recursive:true,force:true})}
},30000)

test('existing layout CLI computes precise expectations from current saved bytes, not prose coordinates or a wide sample',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-exact-source-'))
  const tools=await openAgentTools({workspacePath:root,getAuthToken:()=>undefined})
  try {
    const scene:any=sceneLayoutFixture()
    scene.data.nodes[0].transform={position:[480,270,0]}
    scene.data.nodes[1].transform.position=[337,210,0]
    scene.data.nodes[1].components=[{id:'board-visual',type:'sprite-renderer',data:{size:[20,20],color:'#ff0000'}}]
    const inspect=async()=>{
      const source=JSON.stringify(scene)
      await writeFile(join(root,'scene.json'),source)
      const output=await command(root,tools.directory,'check-content.mjs','--layout-draft','scene.json','960','540','--details')
      expect(output.code,output.stdout+output.stderr).toBe(0)
      const result=JSON.parse(output.stdout)
      expect(result.runtimeVerified).toBe(false)
      expect(JSON.stringify(result.inputLocation)).toContain(createHash('sha256').update(source).digest('hex'))
      expect(await readFile(join(root,'scene.json'),'utf8')).toBe(source)
      return result.nodes.find((node:any)=>node.id==='board').screenBounds
    }
    expect(await inspect()).toEqual({left:327,top:200,right:347,bottom:220})
    // Changed source center/zoom: scale .5, source point (337,210), camera
    // (510,270) => projected center (393.5,240), NOT a manually copied 373.5.
    scene.data.nodes[0].transform.position[0]=510
    scene.data.nodes[0].components[0].data.orthographicSize=5.4
    const bounds=await inspect()
    expect(bounds).toEqual({left:388.5,top:235,right:398.5,bottom:245})
    const actualCenter=(bounds.left+bounds.right)/2,wrongExpected=373.5
    expect(Math.abs(actualCenter-wrongExpected)).toBeLessThan(35) // broad 70px sample would conceal the defect
    expect(actualCenter).not.toBe(wrongExpected) // precise input-derived expectation does not
    expect((await command(root,tools.directory,'consumer.mjs','--help')).stdout).toContain('wide colored region')
  }finally{await tools.close();await rm(root,{recursive:true,force:true})}
},30000)

test('Preview test entry uses Node, retains complete output, and cannot reuse a revoked capability', async () => {
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-test-entry-')))
  const preview=openPreviewTestAccess({start:async()=>({status:'running'}),status:()=>({status:'idle'}),stop(){},
    browser:{start:async()=>{throw Error('No browser requested')},status:()=>({status:'idle'}),close:async()=>{}} as any})
  const tools=await openAgentTools({workspacePath:root,sessionId:'test-entry',getAuthToken:()=>undefined,openPreview:()=>preview})
  expect(tools.turnContext).toContain('preview.mjs --help')
  expect(tools.turnContext).not.toContain('Root-absolute /assets or /content URLs escape')
  const help = await command(root, tools.directory, 'preview.mjs', '--help')
  expect(help.code, help.stderr).toBe(0)
  expect(help.stdout).toContain('localStorage/sessionStorage can throw')
  expect(help.stdout).toContain('async createGameStorage()')
  expect(help.stdout).toContain('Root-absolute /assets or /content URLs escape')
  const run=async(...args:string[])=>{
    const child=Bun.spawn([Bun.which('node')!,join(root,tools.directory,'preview.mjs'),...args],{cwd:root,
      env:{PATH:process.env.PATH,BEEGAME_CONTENT_CHECKER_MODULE:(await sharedContentChecker()).moduleUrl,
        BEEGAME_PREVIEW_CAPABILITY_FILE:projectPreviewCapabilityPath(root,'test-entry')},stdout:'pipe',stderr:'pipe'})
    const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited])
    return {code,stderr,result:JSON.parse(stdout)}
  }
  try {
    for (const invalid of [
      {readySelector:'#ready',key:'ArrowRight',holdMs:100,observeMs:100,callback:'window.fastForward()'},
      {readySelector:'#ready',key:'Control+R',holdMs:100,observeMs:100},
      {readySelector:'#ready',key:'ArrowRight',holdMs:0,observeMs:100},
      {readySelector:'#ready',key:'ArrowRight',holdMs:5000,observeMs:120000},
      {readySelector:'#ready',key:'ArrowRight',holdMs:100,observeMs:100,viewport:{width:640,height:360,isMobile:true}},
    ]) {
      const rejected=await run('--keyboard-sample',JSON.stringify(invalid))
      expect(rejected.code).toBe(1)
      expect(rejected.result).toMatchObject({status:'error',quality:'unverified'})
      expect(rejected.result.error).not.toContain('No browser requested')
    }
    const countdownOptions = { startSelector:'#start', countdownSelector:'#countdown', playingSelector:'#playing', countdownMs:1500 }
    for (const invalid of [
      {...countdownOptions,callback:'pauseGame()'}, {...countdownOptions,countdownMs:0},
      {...countdownOptions,countdownMs:30001}, {...countdownOptions,observeMs:0},
      {...countdownOptions,countdownSelector:''}, {...countdownOptions,viewport:{width:640,height:0}},
    ]) {
      const rejected=await run('--countdown-blur-sample',JSON.stringify(invalid))
      expect(rejected.code).toBe(1)
      expect(rejected.result).toMatchObject({status:'error',quality:'unverified'})
      expect(rejected.result.error).not.toContain('No browser requested')
    }
    await writeFile(join(root,'test.mjs'),`import {appendFile} from 'node:fs/promises';
      await appendFile('calls.txt','once\\n');
      console.log(JSON.stringify({node:!process.versions.bun,arg:process.argv[2],checks:[false]}));
      console.log('x'.repeat(80000));console.error('actual failure details');process.exitCode=Number(process.argv[3]||0);`)
    const first=await run('--run','test.mjs','literal;not-a-shell-command','7')
    expect(first.code).toBe(1)
    expect(first.result).toMatchObject({status:'exited',exitCode:7,runtime:'node',quality:'unverified'})
    const stdout=await readFile(join(root,first.result.stdoutPath),'utf8')
    expect(JSON.parse(stdout.split('\n')[0]!)).toEqual({node:true,arg:'literal;not-a-shell-command',checks:[false]})
    expect(stdout.length).toBeGreaterThan(80000)
    expect(await readFile(join(root,first.result.stderrPath),'utf8')).toContain('actual failure details')
    expect(JSON.stringify(first.result).length).toBeLessThan(1500)
    expect(first.result).not.toHaveProperty('passed')
    for(let i=0;i<3;i++) {
      const saved=JSON.parse(await readFile(join(root,first.result.reportPath),'utf8'))
      expect(saved).toMatchObject({inputIdentity:'unverified',before:{status:'unverified'},after:{status:'unverified'}})
      expect(saved.before.scriptSha256).toBe(saved.after.scriptSha256)
      expect(saved.stdoutPath).toBe(first.result.stdoutPath)
    }
    expect(await readFile(join(root,'calls.txt'),'utf8')).toBe('once\n')
    const second=await run('--run','test.mjs','same-test','0')
    expect(second.code).toBe(0);expect(second.result.quality).toBe('unverified')
    expect(second.result.reportPath).not.toBe(first.result.reportPath)
    expect(await readFile(join(root,first.result.stdoutPath),'utf8')).toBe(stdout)
    expect((await run('--snapshot','development','0','540')).result.error).toContain('Expected --snapshot')
    const moduleUrl=new URL('../preview-test-command.mjs',import.meta.url).href
    const snapshotChild=Bun.spawn([Bun.which('node')!,'--input-type=module','-e',
      `const {capturePreviewSnapshot}=await import(${JSON.stringify(moduleUrl)});
       const result=await capturePreviewSnapshot('development',960,540,async(options,inspect)=>inspect({
         page:{screenshot:async()=>Buffer.from('synthetic-image')},
         gameFrame:{waitForLoadState:async()=>{}},
         observedEnvironment:{viewport:{width:960,height:540}},
         runtimeErrors:{pageErrors:1,consoleErrors:0,failedRequests:0,httpErrors:0}}));
       console.log(JSON.stringify(result));`],{cwd:root,
      env:{PATH:process.env.PATH,BEEGAME_PREVIEW_CAPABILITY_FILE:projectPreviewCapabilityPath(root,'test-entry')},
      stdout:'pipe',stderr:'pipe'})
    const [snapshotOut,snapshotErr,snapshotExit]=await Promise.all([
      new Response(snapshotChild.stdout).text(),new Response(snapshotChild.stderr).text(),snapshotChild.exited])
    expect(snapshotExit,snapshotErr).toBe(0)
    const snapshot=JSON.parse(snapshotOut)
    expect(snapshot).toMatchObject({status:'observed',quality:'unverified',viewport:[960,540],
      runtimeErrors:{pageErrors:1},observedEnvironment:{viewport:{width:960,height:540}}})
    expect(await readFile(join(root,snapshot.imagePath),'utf8')).toBe('synthetic-image')
    expect(JSON.parse(await readFile(join(root,snapshot.reportPath),'utf8')).imageSha256).toBe(snapshot.imageSha256)
    expect(snapshot.reportPath).toMatch(/^\.beegame\/tmp\/preview-snapshot-[^/]+\/observation\.json$/)
    expect((await run('--inspect',first.result.reportPath)).result).toMatchObject({quality:'unverified',
      freshness:{status:'unverified'},exitCode:7})
    expect((await run('--inspect','../outside.json')).code).toBe(1)
    await tools.close()
    expect((await run('--inspect',first.result.reportPath)).result.exitCode).toBe(7)
    const expired=await run('--run','test.mjs')
    expect(expired.code).toBe(1);expect(expired.result.error).toContain('PREVIEW_CAPABILITY_EXPIRED')
    expect(await readFile(join(root,'calls.txt'),'utf8')).toBe('once\nonce\n')
  } finally {await tools.close();await rm(root,{recursive:true,force:true})}
})

test.skipIf(process.env.BGS_LAYOUT_BROWSER!=='1')('one Preview snapshot observes the real isolated game frame without a project test script', async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-visual-snapshot-')))
  const game=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response(
    '<!doctype html><style>body{margin:0;background:#153148;color:white}</style><h1>Visible game</h1><script>throw Error("synthetic boot failure")</script>',
    {headers:{'content-type':'text/html'}})})
  let state={status:'idle',url:''}
  const preview=openPreviewTestAccess({start:async()=>state={status:'running',url:game.url.origin},
    status:()=>state,stop(){},browser:createPreviewTestBrowser()})
  const tools=await openAgentTools({workspacePath:root,sessionId:'visual-snapshot',getAuthToken:()=>undefined,openPreview:()=>preview})
  try {
    const child=Bun.spawn([Bun.which('node')!,join(root,tools.directory,'preview.mjs'),'--snapshot','development','640','360'],
      {cwd:root,env:{PATH:process.env.PATH,BEEGAME_CONTENT_CHECKER_MODULE:(await sharedContentChecker()).moduleUrl,
        BEEGAME_PREVIEW_CAPABILITY_FILE:projectPreviewCapabilityPath(root,'visual-snapshot'),
        BEEGAME_PLAYWRIGHT_MODULE:sharedPlaywright().moduleUrl},stdout:'pipe',stderr:'pipe'})
    const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited])
    expect(code,stderr+'\n'+stdout).toBe(0)
    const report=JSON.parse(stdout)
    expect(report).toMatchObject({status:'observed',quality:'unverified',viewport:[640,360]})
    expect(report.runtimeErrors.pageErrors).toBeGreaterThan(0)
    expect(report.runtimeErrorDetails.pageErrors).toContainEqual({name:'Error',message:'synthetic boot failure'})
    const png=await readFile(join(root,report.imagePath))
    expect(png.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(png.readUInt32BE(16)).toBe(640)
    expect(png.readUInt32BE(20)).toBe(360)
    expect(JSON.parse(await readFile(join(root,report.reportPath),'utf8')).imageSha256).toBe(report.imageSha256)
    expect(JSON.parse(await readFile(join(root,report.reportPath),'utf8')).runtimeErrorDetails).toEqual(report.runtimeErrorDetails)
  }finally{await tools.close();game.stop(true);await rm(root,{recursive:true,force:true})}
},30000)

test('tool preparation refuses linked parent before writing outside the project', async () => {
  const root=await mkdtemp(join(tmpdir(),'bgs-agent-tools-link-')), outside=await mkdtemp(join(tmpdir(),'bgs-agent-tools-outside-'))
  try {
    await symlink(outside,join(root,'.beegame'))
    await expect(openAgentTools({workspacePath:root,getAuthToken:()=>undefined})).rejects.toThrow('link')
    await expect(access(join(outside,'tmp'))).rejects.toThrow()
    await rm(join(root,'.beegame')); await mkdir(join(root,'.beegame'))
    await symlink(outside,join(root,'.beegame/tmp'))
    await expect(openAgentTools({workspacePath:root,getAuthToken:()=>undefined})).rejects.toThrow('link')
  } finally { await rm(root,{recursive:true,force:true}); await rm(outside,{recursive:true,force:true}) }
})

test('optional Preview is published to the bound native session, lazy help works and close drains once', async () => {
  const root = await mkdtemp(join(tmpdir(),'bgs-agent-preview-'))
  let stops=0, closes=0, release!:()=>void
  const drained=new Promise<void>(resolve=>{release=resolve})
  const preview=openPreviewTestAccess({start:async()=>({status:'unsupported'}),status:()=>({status:'idle'}),
    stop(){stops++},browser:{start:async()=>{throw Error('Not started by preparation')},status:()=>({status:'not-running'}),
      close:async()=>{closes++;await drained}}})
  const tools=await openAgentTools({workspacePath:root,sessionId:'synthetic-preview',getAuthToken:()=>undefined,openPreview:()=>preview})
  try {
    const path=projectPreviewCapabilityPath(root,'synthetic-preview')
    expect(JSON.parse(await readFile(path,'utf8')).apiUrl).toBe(preview.baseUrl)
    expect(tools.turnContext).not.toContain(preview.baseUrl)
    expect(tools.turnContext).toContain('check-content.mjs --format preview')
    expect(tools.turnContext.length).toBeLessThan(2600)
    expect((await command(root,tools.directory,'preview.mjs','--help')).stdout).toContain('POST /preview')
    expect((await command(root,tools.directory,'preview.mjs','--help')).stdout).toContain('--snapshot development|production')
    const help=(await command(root,tools.directory,'preview.mjs','--help')).stdout
    expect(help).toContain('--keyboard-sample <JSON>')
    expect(help).toContain('--countdown-blur-sample <JSON>')
    expect(help).toContain('--sprite-sample <sheet.png>')
    for(const script of ['```js','data-node-id="title"','captureFrame("playing")',
      'Click start, observe countdown','key down/hold/up','asserts frame coverage, pause and resume'])
      expect(help).not.toContain(script)
    expect(help).toContain('Exit code is not test quality')

    const diagnostic=await command(root,tools.directory,'preview.mjs','--client')
    expect(diagnostic.code).toBe(0)
    const client=JSON.parse(diagnostic.stdout)
    expect(client).toMatchObject({runtime:'node',playwrightModule:sharedPlaywright().moduleUrl,
      environment:{helper:'BEEGAME_PREVIEW_TEST_MODULE',playwright:'BEEGAME_PLAYWRIGHT_MODULE',capability:'BEEGAME_PREVIEW_CAPABILITY_FILE'}})
    expect(client.helperModule).toBe(new URL('./preview-test-client.mjs',(await sharedContentChecker()).moduleUrl).href)
    expect(client.playCapture).toContain('withPlayCapture')
    expect(diagnostic.stdout).not.toContain(preview.baseUrl)
    expect(diagnostic.stdout).not.toContain(path)
    expect(Buffer.byteLength(diagnostic.stdout)).toBeLessThan(1500)
    // A child script can resolve exports directly; no source read/copy, env
    // dump, package installation, browser start or review verdict is required.
    const node=Bun.spawn([Bun.which('node')!,'--input-type=module','-e',
      'const {withPreviewPage,withPlayCapture,checkTextSeparation}=await import('+JSON.stringify(client.helperModule)+');'+
      'const {chromium}=await import('+JSON.stringify(client.playwrightModule)+');'+
      'console.log([typeof withPreviewPage,typeof withPlayCapture,typeof checkTextSeparation,typeof chromium.connectOverCDP].join(","))'],
      {cwd:root,env:{PATH:process.env.PATH},stdout:'pipe',stderr:'pipe'})
    const [stdout,stderr,exit]=await Promise.all([new Response(node.stdout).text(),new Response(node.stderr).text(),node.exited])
    expect(exit,stderr).toBe(0);expect(stdout.trim()).toBe('function,function,function,function')
    expect((await command(root,tools.directory,'preview.mjs','--client','--help')).code).toBe(1)
    expect((await fetch(preview.baseUrl+'/status')).status).toBe(200)
    const first=tools.close();expect(tools.close()).toBe(first)
    let finished=false;void first.then(()=>{finished=true})
    for(let i=0;i<100 && !closes;i++)await Bun.sleep(2)
    expect(closes).toBe(1);expect(finished).toBe(false)
    await expect(access(path)).rejects.toThrow()
    await expect(fetch(preview.baseUrl+'/status')).rejects.toThrow()
    release();await first;expect(stops).toBe(1)
  } finally {release();await tools.close();await rm(root,{recursive:true,force:true})}
},10000)

test('failed adapter preparation revokes an already opened Preview rather than leaking it', async () => {
  const root=await mkdtemp(join(tmpdir(),'bgs-agent-preview-failure-'));let closed=0
  const preview=openPreviewTestAccess({start:async()=>({status:'idle'}),status:()=>({status:'idle'}),stop(){closed++},
    browser:{start:async()=>{throw Error('Unused')},status:()=>({status:'not-running'}),close:async()=>{}}})
  try {
    await expect(openAgentTools({workspacePath:root,sessionId:'synthetic-preview',getAuthToken:()=>undefined,
      openPreview:async()=>{
        // Cause a real adapter write failure after capability publication.
        const {readdir}=await import('node:fs/promises')
        const directory=(await readdir(join(root,'.beegame/tmp')))[0]!
        await mkdir(join(root,'.beegame/tmp',directory,'preview.mjs'))
        return preview
      }})).rejects.toThrow()
    expect(closed).toBe(1)
    await expect(access(projectPreviewCapabilityPath(root,'synthetic-preview'))).rejects.toThrow()
    await expect(fetch(preview.baseUrl+'/status')).rejects.toThrow()
  }finally{await preview.close();await rm(root,{recursive:true,force:true})}
})


test('technical planning remains readable before its document/index exists and metadata repair stays explicit', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-planning-inputs-')))
  try {
    await writeDesignDocumentsFixture(root)
    await rm(join(root, 'docs/TECHNICAL_DESIGN.md'))
    await rm(join(root, designHandoffPath('TECHNICAL_DESIGN.md')))
    const gdd = join(root, 'docs/GDD.md')
    await writeFile(gdd, (await readFile(gdd, 'utf8')).replace('- Version: v1.0\n', ''))
    const original = await readFile(gdd, 'utf8')
    const design = openDesignActions(root)
    const draft = await design('draft', ['TECHNICAL_DESIGN.md']) as any
    expect(draft.valid).toBe(false)
    expect(draft.availableRequirements).toHaveLength(7)
    const baseline = await design('baseline') as any
    expect(baseline.valid).toBe(false)
    expect(baseline.requirements).toHaveLength(7)
    expect(baseline.issues.join(' ')).toContain('handoff.mjs --design finalize GDD.md')
    expect(baseline.issues.join(' ')).toContain('do not add or synchronize version headers manually')
    expect(await readFile(gdd, 'utf8')).toBe(original)
    expect(await design('finalize', ['GDD.md'])).toMatchObject({valid:true,finalized:['GDD.md']})
    expect((await design('baseline') as any).issues.join(' ')).not.toContain('finalize GDD.md')
    await expect(access(join(root, 'docs/TECHNICAL_DESIGN.md'))).rejects.toThrow()
  } finally { await rm(root, {recursive:true,force:true}) }
})


test.skipIf(process.env.BGS_LAYOUT_BROWSER!=='1')('Preview capture helper retains two actual UI states in one offline playtest',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-visual-example-')))
  let starts=0
  const game=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response(
    '<!doctype html><body style="background:#123;color:white"><h1 data-node-id="title">Fixture menu</h1><button data-node-id="play">Play</button><h1 data-node-id="hud" hidden>Fixture playing</h1><script>document.querySelector("button").onclick=()=>{document.querySelector("[data-node-id=title]").hidden=true;document.querySelector("button").hidden=true;document.querySelector("[data-node-id=hud]").hidden=false;document.body.style.background="#345"}</script>',
    {headers:{'content-type':'text/html'}})})
  let state={status:'idle',url:''}
  const preview=openPreviewTestAccess({start:async()=>{starts++;return state={status:'running',url:game.url.origin}},
    status:()=>state,stop(){},browser:createPreviewTestBrowser()})
  const tools=await openAgentTools({workspacePath:root,sessionId:'visual-example',getAuthToken:()=>undefined,openPreview:()=>preview})
  try {
    // Synthetic input belongs to the test, not the general Preview help.
    const script=join(root,'visual.mjs');await writeFile(script,`
      const {withPlayCapture}=await import(process.env.BEEGAME_PREVIEW_TEST_MODULE);
      const capture=await withPlayCapture({mode:'production',viewport:{width:1280,height:720}},async({gameFrame,captureFrame,runtimeErrors})=>{
        await gameFrame.locator('[data-node-id="title"]').waitFor({state:'visible'});
        await captureFrame('start');
        await gameFrame.locator('[data-node-id="play"]').click();
        await gameFrame.locator('[data-node-id="hud"]').waitFor({state:'visible'});
        await captureFrame('playing');
        return {runtimeErrors};
      });
      console.log(JSON.stringify(capture));`)
    const child=Bun.spawn([Bun.which('node')!,join(root,tools.directory,'preview.mjs'),'--run',script],{
      cwd:root,env:{PATH:process.env.PATH,BEEGAME_CONTENT_CHECKER_MODULE:(await sharedContentChecker()).moduleUrl,
        BEEGAME_PREVIEW_CAPABILITY_FILE:projectPreviewCapabilityPath(root,'visual-example'),
        BEEGAME_PREVIEW_TEST_MODULE:new URL('./preview-test-client.mjs',(await sharedContentChecker()).moduleUrl).href,BEEGAME_PLAYWRIGHT_MODULE:sharedPlaywright().moduleUrl},stdout:'pipe',stderr:'pipe'})
    const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited])
    const receipt=JSON.parse(stdout)
    const driverError=receipt.stderrPath?await readFile(join(root,receipt.stderrPath),'utf8'):''
    expect(code,stderr+'\n'+stdout+'\n'+driverError).toBe(0)
    const capture=JSON.parse(await readFile(join(root,receipt.stdoutPath),'utf8'))
    expect(starts).toBe(1)
    expect(capture.quality).toBe('unverified')
    expect(capture.runtimeErrors).toMatchObject({pageErrors:0,consoleErrors:0,failedRequests:0,httpErrors:0})
    expect(capture.frames.map((frame:any)=>frame.label)).toEqual(['start','playing'])
    const images=await Promise.all(capture.frames.map((frame:any)=>readFile(join(root,frame.path))))
    for(const image of images){expect(image.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');expect(image.readUInt32BE(16)).toBe(1280);expect(image.readUInt32BE(20)).toBe(720)}
    expect(createHash('sha256').update(images[0]).digest('hex')).not.toBe(createHash('sha256').update(images[1]).digest('hex'))
    expect(JSON.parse(await readFile(join(root,capture.directory,'observation.json'),'utf8')).frames).toEqual(capture.frames)
  } finally {await tools.close();game.stop(true);await rm(root,{recursive:true,force:true})}
},30000)


test('new projects do not prepare or advertise a calculation appendix helper', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-no-calculator-')))
  const tools = await openAgentTools({ workspacePath: root, getAuthToken: () => undefined })
  try {
    expect(tools.systemContext).not.toContain(BALANCE_CALCULATOR_PATH)
    await expect(access(join(root, BALANCE_CALCULATOR_PATH))).rejects.toThrow()
    await expect(access(join(root, '.beegame/delivery/calculators'))).rejects.toThrow()
  } finally { await tools.close(); await rm(root, { recursive: true, force: true }) }
})

test('a retained asset entry uses current image and library bridges across three turns', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-assets-turns-')))
  let catalogs = 0, quotes = 0, generated = 0
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    catalogs++
    return Response.json({ items: [{ packId: 'fixture' }] })
  } })
  const env = { ...process.env, BEEGAME_ASSET_CAPABILITY_FILE: projectPreviewCapabilityPath(root, 'fixture', 'assets') }
  const entries: string[] = []
  let active: Awaited<ReturnType<typeof openAgentTools>> | undefined
  const run = async (entry: string, ...args: string[]) => {
    const child = Bun.spawn([process.execPath, entry, ...args], { cwd: root, env, stdout: 'pipe', stderr: 'pipe' })
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    return { code, stdout, stderr }
  }
  try {
    for (let turn = 0; turn < 3; turn++) {
      active = await openAgentTools({ workspacePath: root, sessionId: 'fixture', getAuthToken: () => 'fixture-token',
        libraryBaseUrl: upstream.url.origin, openImage: () => {
          const bridge = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
            if (request.method === 'GET') { quotes++; return Response.json({ available: true, turn }) }
            generated++; return new Response('fixture bytes', { headers: { 'content-type': 'image/png' } })
          } })
          return { endpoint: bridge.url.origin + '/image', instruction: 'Local fixture', close: async () => { bridge.stop(true) } }
        } })
      entries.push(join(root, active.directory, 'assets.mjs'))
      const source = await readFile(entries.at(-1)!, 'utf8')
      expect(source.split('\n')[0]).not.toContain('127.0.0.1')
      // Simulate a compact handoff retaining only the first tool path and current native environment.
      const quote = await run(entries[0]!, 'cost')
      expect(quote.code, quote.stderr).toBe(0)
      expect(JSON.parse(quote.stdout).turn).toBe(turn)
      const catalog = await run(entries[0]!, 'catalog')
      expect(catalog.code, catalog.stderr).toBe(0)
      expect(JSON.parse(catalog.stdout).items[0].packId).toBe('fixture')
      if (turn === 2) {
        await writeFile(join(root, 'request.json'), JSON.stringify({ requestId: 'fixture-attempt', purpose: 'reference', prompt: 'Fixture' }))
        const result = await run(entries[0]!, 'generate', 'request.json', 'assets/result.png')
        expect(result.code, result.stderr).toBe(0)
      }
      await active.close()
      const expired = await run(entries[0]!, 'cost')
      expect(expired.code).toBe(1)
      expect(expired.stderr).toContain('ASSET_CAPABILITY_EXPIRED')
      expect((await run(entries[0]!, '--help')).code).toBe(0)
    }
    expect(new Set(entries).size).toBe(3)
    expect(catalogs).toBe(3)
    expect(quotes).toBe(4)
    expect(generated).toBe(1)
  } finally { await active?.close(); upstream.stop(true); await rm(root, { recursive: true, force: true }) }
}, 30000)
