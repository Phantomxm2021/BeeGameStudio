import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { prepareNativeMcpConfig } from '../native-mcp-config'
import { CONTENT_CHECKER_ENTRY } from '../game-content-validation-cli'
import { contentConsumerDistribution, contentConsumerCommand, registeredRuntimeFilesSource } from '../game-content-consumer-cli'
import { test, expect } from 'bun:test'
import { access, mkdir, mkdtemp, realpath, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { projectWorkDirectory, projectWorkRoot } from '../project-storage-paths'
import { tmpdir } from 'node:os'
import { openAgentTools } from './agent-tools'
import { createImageGenerationAccess } from '../../image-generation/access'
import { ImageAttemptStore } from '../../image-generation/attempt'
import { ImageGenerationService } from '../../image-generation/service'
import { imageConfigSchema } from '../../image-generation/config'
import { sharedContentChecker } from '../content-checker-runtime'
import { CONTENT_DRAFT_EXAMPLES } from '../game-content-validation-cli'
import { projectPreviewCapabilityPath } from '../project-preview-capability'
import { createPreviewTestBrowser } from '../preview-test-browser'
import { sharedPlaywright } from '../shared-playwright'
import { commandCheck, projectFiles } from './checks'
import { sceneLayoutFixture, uiLayoutFixture } from '../fixtures/layout-fixture'
import { createHash } from 'node:crypto'
import { runContentCheck } from './content-checks'
import { runArtifactCheck } from './runtime-checks'
import { readContentView } from './content-view'
import { BALANCE_CALCULATOR_PATH } from '../balance-calculation'
import { writeBalanceCalculatorFixture } from './balance-calculation-fixture'

async function command(root: string, directory: string, name: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, resolve(root, directory, name), ...args], {
    cwd: root, env: { ...process.env, BEEGAME_ASSET_CAPABILITY_FILE: projectPreviewCapabilityPath(root, 'fixture'), BEEGAME_CONTENT_CHECKER_MODULE: name === 'check-content.mjs' ? new URL('../game-content-validation-cli.ts', import.meta.url).href : (await sharedContentChecker()).moduleUrl,
      BEEGAME_PLAYWRIGHT_MODULE: sharedPlaywright().moduleUrl },
    stdout: 'pipe', stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { stdout, stderr, code }
}
// Explicit historical-library fixture, never default Agent tool preparation.
async function legacyCommand(root:string,directory:string,name:string,...args:string[]) {
  const target=resolve(root,directory)
  if(name==='check-content.mjs')await writeFile(join(target,name),CONTENT_CHECKER_ENTRY)
  else if(name==='consumer.mjs') {
    for(const [file,body] of Object.entries(await contentConsumerDistribution()))await writeFile(join(target,file),body)
    await writeFile(join(target,'registered-runtime-files.mjs'),await registeredRuntimeFilesSource())
    await writeFile(join(target,name),contentConsumerCommand(await realpath(root),join(target,'content-consumer.mjs')))
  }
  return command(root,directory,name,...args)
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
  await writeBalanceCalculatorFixture(root)
  const retainedCalculator = (await readFile(join(root,BALANCE_CALCULATOR_PATH),'utf8')) + '\n// Retained project version.\n'
  await writeFile(join(root,BALANCE_CALCULATOR_PATH),retainedCalculator)
  const tools = await openAgentTools({ sessionId: 'fixture', workspacePath: root, getAuthToken: () => undefined,
    openImage: () => { throw Error('An unused image bridge must not be opened') } })
  try {
    expect(tools.turnContext).toContain('Image generation is configured')
    expect(tools.systemContext).not.toContain(BALANCE_CALCULATOR_PATH)
    expect(await readFile(join(root,BALANCE_CALCULATOR_PATH),'utf8')).toBe(retainedCalculator)
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
  } finally { await tools.close(); await rm(projectWorkRoot(root), { recursive: true, force: true }); await rm(root, { recursive: true, force: true }) }
}, 30000)
test('explicit historical checker library retains executable UI examples without enabling default authoring', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-pure-ui-author-')))
  const tools = await openAgentTools({ sessionId: 'fixture', workspacePath: root, getAuthToken: () => undefined })
  try {
    const format = await legacyCommand(root, tools.directory, 'check-content.mjs', '--format', 'examples')
    expect(format.code, format.stdout+format.stderr).toBe(0)
    const examples = JSON.parse(format.stdout).values.examples
    expect(examples.index).not.toHaveProperty('documentRevision')
    expect(examples.index).not.toHaveProperty('assetManifestRevision')
    expect(examples.index).not.toHaveProperty('sceneModel')
    await mkdir(join(root, 'content/ui'), { recursive: true })
    const sources = { 'content/index.json': JSON.stringify(examples.index), 'content/ui/menu.json': JSON.stringify(examples.ui) }
    for (const [path, bytes] of Object.entries(sources)) await writeFile(join(root, path), bytes)
    const current = await legacyCommand(root, tools.directory, 'check-content.mjs', '--current')
    expect(current.code, current.stdout+current.stderr).toBe(0)
    expect(JSON.parse(current.stdout)).toMatchObject({ valid: true, contentCount: 1, runtimeVerified: false })
    const checked = await Promise.all((['content-structure', 'content-layout', 'content-resources'] as const)
      .map(id => runContentCheck(root, id, { expectedOutputs: ['content/ui/menu.json'] }, [], {})))
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
      expect((await legacyCommand(root, tools.directory, 'check-content.mjs', '--current')).code).toBe(1)
    }
  } finally { await tools.close(); await rm(projectWorkRoot(root), { recursive: true, force: true }); await rm(root, { recursive: true, force: true }) }
}, 30000)
test('explicit historical layout checker preserves confirmed orientation without adding phone targets', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-layout-target-tools-')))
  const tools = await openAgentTools({ sessionId: 'fixture', workspacePath: root, getAuthToken: () => undefined,
    constraints: { platform: 'Web', inputs: ['Touch'], orientation: 'Landscape', dimension: '2D' } })
  try {
    const ui = uiLayoutFixture() as any
    Object.assign(ui.data.nodes[0].data, { referenceResolution: [1280, 720], targetViewports: [[1280, 720]] })
    ui.data.nodes[0].layout.size = [1280, 720]
    Object.assign(ui.data.nodes[1].layout, { anchor: 'top-left', position: [1100, 30], size: [100, 60] })
    await mkdir(join(root, 'content/ui'), { recursive: true })
    const path = join(root, 'content/ui/menu.json'), bytes = JSON.stringify(ui)
    await writeFile(path, bytes)
    const check = await legacyCommand(root, tools.directory, 'check-content.mjs', '--design-layouts', '--details')
    expect(check.code).toBe(0)
    const result = JSON.parse(check.stdout)
    expect(result.coverage.targets[0].viewports).not.toContainEqual([844, 390])
    expect(await readFile(path, 'utf8')).toBe(bytes)
    await writeFile(resolve(root,tools.directory,'check-content.mjs'),CONTENT_CHECKER_ENTRY.replace("{ profile: 'current' }",JSON.stringify({profile:'current',confirmed:{platform:'Web',inputs:['Touch'],orientation:'Landscape',dimension:'2D'}})))
    const conflict = await command(root, tools.directory, 'check-content.mjs', '--design-layouts', '--orientation', 'Portrait')
    expect(conflict.code).toBe(1)
    expect(conflict.stdout).toContain('differs from the confirmed project target')
  } finally { await tools.close(); await rm(projectWorkRoot(root), { recursive: true, force: true }); await rm(root, { recursive: true, force: true }) }
})

test('autonomous tools use actual auth and drafts without stages, documents or invented authority', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-agent-tools-')))
  const calls: string[] = []; let token = 'synthetic-user-a'
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    calls.push(request.headers.get('authorization') ?? '')
    return Response.json({ items: [{ packId: 'actual-fixture', license: 'CC0' }] })
  } })
  const tools = await openAgentTools({ sessionId: 'fixture', workspacePath: root, libraryBaseUrl: upstream.url.origin, getAuthToken: () => token })
  try {
    const source = await readFile(resolve(root, tools.directory, 'assets.mjs'), 'utf8')
    expect(source).not.toContain(token); expect(tools.turnContext).not.toContain(token)
    expect(tools.turnContext.length).toBeLessThan(2200)
    expect(tools.turnContext).not.toContain('React/Canvas does not waive promised editable data') // responsibility remains in the production system slot
    expect(tools.turnContext).not.toContain('quality evidence')
    expect(tools.systemContext).not.toContain('consumer.mjs')
    expect(tools.systemContext).not.toContain('check-content.mjs')
    expect(tools.systemContext).toContain('Acquisition: bun assets.mjs --help')
    expect(tools.systemContext).toContain('Register delivered files: bun resources.mjs --help')
    expect(tools.systemContext).not.toContain('--contract registration')
    expect(tools.turnContext).not.toContain('consumer.mjs')
    expect(tools.turnContext).not.toContain('Native bgs-ui-layout reads:')
    expect(tools.turnContext).not.toContain('detailsFor:')
    // Even with all compactable turn text discarded, the system locator is
    // sufficient to invoke current adapters; it contains no bridge secret.
    const located = JSON.parse(tools.systemContext.match(/absolute path\): ("[^"]+")/)![1]!)
    expect(located).toBe(tools.directory)
    expect(tools.systemContext).not.toContain(token)
    expect(tools.systemContext).not.toContain('node preview.mjs') // unavailable here
    expect(tools.systemContext.length).toBeLessThan(600)
    const contracts = await legacyCommand(root, located, 'check-content.mjs', '--format', 'index', 'preview')
    expect(contracts.code, contracts.stderr).toBe(0)
    expect(JSON.parse(contracts.stdout)).toMatchObject({
      ok: true, values: { preview: { environment: { origin: 'opaque' }, runtimeVerified: false, quality: 'unverified' } },
    })
    const layoutContract = await legacyCommand(root, located, 'check-content.mjs', '--format', 'uiLayoutContract')
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
    for (const name of ['resources']) {
      const runtime = tools.systemContext.match(new RegExp('(bun|node) ' + name + '\\.mjs'))?.[1]
      expect(runtime).toBeDefined()
      const child = Bun.spawn([runtime === 'bun' ? process.execPath : 'node', resolve(root, located, name+'.mjs'), '--help'],
        { cwd: root, env: { ...process.env, BEEGAME_ASSET_CAPABILITY_FILE: projectPreviewCapabilityPath(root, 'fixture'), BEEGAME_CONTENT_CHECKER_MODULE: (await sharedContentChecker()).moduleUrl },
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
    const consumerHelp=await legacyCommand(root,tools.directory,'consumer.mjs','--help')
    expect(consumerHelp.code).toBe(0)
    expect(consumerHelp.stdout).toContain(tools.directory+'/content-consumer.mjs')
    expect(consumerHelp.stdout).toContain('host tool files are excluded')
    expect(consumerHelp.stdout).toContain('Camera center AND orthographicSize')
    expect(consumerHelp.stdout).toContain('beforeNavigate')
    const consumer=await import(resolve(root,tools.directory,'content-consumer.mjs'))
    expect(typeof consumer.createProductionUiSurface).toBe('function')
    expect(typeof consumer.sceneNodeClientPoint2d).toBe('function')
    expect((await command(root, tools.directory, 'assets.mjs', '--help')).stdout).toContain(tools.directory + '/media.mjs')
    expect(JSON.parse((await command(root, tools.directory, 'assets.mjs', 'catalog')).stdout).items[0].packId).toBe('actual-fixture')
    token = 'synthetic-user-b'
    expect((await command(root, tools.directory, 'assets.mjs', 'pack', 'actual-fixture')).code).toBe(0)
    expect(calls).toEqual(['Bearer synthetic-user-a', 'Bearer synthetic-user-b'])
    const format = await legacyCommand(root, tools.directory, 'check-content.mjs', '--format', 'coordinates', 'uiVocabulary')
    expect(format.code, format.stdout).toBe(0)
    expect(JSON.parse(format.stdout).values).toHaveProperty('coordinates')
    expect(JSON.stringify(JSON.parse(format.stdout))).not.toContain('documentRevision')
    const ui = structuredClone(CONTENT_DRAFT_EXAMPLES.ui)
    await writeFile(join(root, 'menu.json'), JSON.stringify(ui))
    expect((await legacyCommand(root, tools.directory, 'check-content.mjs', '--check-drafts', 'menu.json')).code).toBe(0)
    const layout = await legacyCommand(root, tools.directory, 'check-content.mjs', '--layout-draft', 'menu.json', '960', '540')
    expect(layout.code, layout.stdout).toBe(0); expect(JSON.parse(layout.stdout).scope).toContain('draft')
    const resourceContract = await command(root, tools.directory, 'resources.mjs', '--contract')
    expect(resourceContract.code, resourceContract.stderr).toBe(0)
    expect(resourceContract.stdout).toContain('Asset Manifest authoring contract')
    expect(resourceContract.stdout).toContain('current BGS\ntools directory')
    expect(resourceContract.stdout).toContain('resources.mjs --check')
    expect(resourceContract.stdout).toContain('no platform requires')
    expect(resourceContract.stdout).not.toContain('This command requires a content index.')
    expect(resourceContract.stdout).not.toContain('assets/manifest/check.mjs')
    expect(resourceContract.stdout).not.toContain('CONTRACT.md')
    await expect(access(join(root, 'assets'))).rejects.toThrow()
    const mediaHelp = await command(root, tools.directory, 'media.mjs', '--help')
    expect(mediaHelp.code, mediaHelp.stderr).toBe(0)
    expect(mediaHelp.stdout).toContain('current BGS tools directory supplied in the project context')
    expect(mediaHelp.stdout).toContain('bun <current-tools-directory>/media.mjs request.json')
    expect(mediaHelp.stdout).not.toContain('.beegame/delivery/')
    for (const name of ['media.mjs', 'resources.mjs']) {
      const wrongRuntime = Bun.spawn([Bun.which('node')!, resolve(root,tools.directory,name), '--help'], {
        cwd: root, env: { PATH: process.env.PATH, BEEGAME_CONTENT_CHECKER_MODULE: 'file:///absent-fixture.mjs' },
        stdout: 'pipe', stderr: 'pipe',
      })
      const output = await new Response(wrongRuntime.stdout).text()
      expect(await wrongRuntime.exited).toBe(1)
      expect(JSON.parse(output).issues[0]).toContain('BGS_BUN_REQUIRED')
      expect(output).not.toContain('UH is not a function')
    }
    const batch = await legacyCommand(root, tools.directory, 'check-content.mjs', '--review-sources', 'menu.json', '--details')
    expect(batch.code, batch.stdout).toBe(0)
    expect(JSON.parse(batch.stdout).sources[0].text).toBe(await readFile(join(root,'menu.json'),'utf8'))
    const full = await legacyCommand(root, tools.directory, 'check-content.mjs', '--authority')
    expect(full.code).toBe(1); expect(JSON.parse(full.stdout).valid).toBe(false)
    for (const path of ['docs', 'content/index.json', 'assets/asset-manifest.json', '.beegame/delivery/content-format.json'])
      await expect(access(join(root, path))).rejects.toThrow()
    // Use the actual V3-published tool, not a replacement wrapper, to create
    // only first-index metadata. The author still saves the registry.
    await mkdir(join(root, 'content/scenes'), { recursive: true })
    await mkdir(join(root, 'content/ui'), { recursive: true })
    await writeFile(join(root, 'content/scenes/level.json'), JSON.stringify(sceneLayoutFixture()))
    await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(ui))
    const first = await legacyCommand(root, tools.directory, 'check-content.mjs', '--package-metadata',
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
    const current = await legacyCommand(root, tools.directory, 'check-content.mjs')
    expect(current.code, current.stdout + current.stderr).toBe(0)
    expect(JSON.parse(current.stdout)).toMatchObject({ valid: true, designVerified: false, runtimeVerified: false })
    await expect(access(join(root, 'docs'))).rejects.toThrow()
    await expect(access(join(root, 'assets/asset-manifest.json'))).rejects.toThrow()
    await mkdir(join(root,'.beegame/delivery'),{recursive:true})
    await writeFile(join(root,'.beegame/delivery/content-format.json'),'{invalid-existing-format')
    const corrupt = await legacyCommand(root,tools.directory,'check-content.mjs','--format','coordinates')
    expect(corrupt.code).toBe(1) // only absent format falls back; corruption stays visible
    await writeFile(join(root,'.beegame/delivery/content-format.json'),JSON.stringify({fixtureSection:{kept:true}}))
    const retained = await legacyCommand(root,tools.directory,'check-content.mjs','--format','fixtureSection')
    expect(JSON.parse(retained.stdout).values.fixtureSection).toEqual({kept:true})
    expect(await readFile(join(root,'.beegame/delivery/content-format.json'),'utf8')).toBe('{"fixtureSection":{"kept":true}}')
    await tools.close()
    const closed = await command(root, tools.directory, 'assets.mjs', 'catalog')
    expect(closed.code).toBe(1); expect(calls).toHaveLength(2)
  } finally { await tools.close(); upstream.stop(true); await rm(projectWorkRoot(root), { recursive: true, force: true }); await rm(root, { recursive: true, force: true }) }
}, 30000)

for (const research of [false,true]) test('tool preparation leaves catalog reads to the Agent through the existing authenticated entry, research='+research,async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-catalog-on-demand-')))
  const calls:{path:string;auth:string|null}[]=[]
  const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
    calls.push({path:new URL(request.url).pathname,auth:request.headers.get('authorization')})
    return Response.json({items:[{packId:'audio-pack',license:'CC0'}],total:1})
  }})
  const tools=await openAgentTools({ sessionId: 'fixture',workspacePath:root,referenceOnly:research,creativeTask:research?'discovery':undefined,libraryBaseUrl:upstream.url.origin,getAuthToken:()=> 'synthetic-catalog-token'})
  try {
    expect(calls).toHaveLength(0)
    expect(tools.turnContext).not.toContain('audio-pack')
    expect(tools.turnContext).not.toContain('Initial built-in resource catalog')
    const result=await command(root,tools.directory,'assets.mjs','catalog')
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('audio-pack')
    expect(calls).toEqual([{path:'/api/resource-catalog/packs',auth:'Bearer synthetic-catalog-token'}])
    await expect(access(join(root,'assets'))).rejects.toThrow()
  }finally{await tools.close();upstream.stop(true);await rm(projectWorkRoot(root),{recursive:true,force:true});await rm(root,{recursive:true,force:true})}
},30000)

test('missing credentials and invalid configuration do not become empty catalogs or block pure tools', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-agent-tools-unavailable-')))
  const upstream = Bun.serve({ hostname:'127.0.0.1', port:0, fetch:()=>{ throw Error('No unauthenticated upstream call allowed') } })
  const tools = await openAgentTools({ sessionId: 'fixture', workspacePath:root, libraryBaseUrl:upstream.url.origin, getAuthToken:()=>undefined })
  try {
    expect(tools.turnContext).toContain('Resource library bridge is configured; catalog requests verify authentication/availability')
    const failed = await command(root,tools.directory,'assets.mjs','catalog')
    expect(failed.code).toBe(1); expect(failed.stderr).toContain('not an empty search result')
    const invalid = await openAgentTools({ sessionId: 'fixture',workspacePath:root,libraryBaseUrl:'file:///not-a-service',getAuthToken:()=>undefined})
    try {
      expect(invalid.turnContext).toContain('configured; catalog requests verify authentication/availability')
      expect(invalid.turnContext).not.toContain('Initial built-in resource catalog')
      expect((await legacyCommand(root,invalid.directory,'check-content.mjs','--format','coordinates')).code).toBe(0)
      const rejected=await command(root,invalid.directory,'assets.mjs','catalog')
      expect(rejected.code).toBe(1);expect(rejected.stderr).toContain('HTTP(S) endpoint')
    } finally { await invalid.close() }
  } finally { await tools.close(); upstream.stop(true); await rm(projectWorkRoot(root),{recursive:true,force:true});await rm(root,{recursive:true,force:true}) }
},30000)

test('image quote is read-only and a generated visual proposal is saved for later inspection', async () => {
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-agent-image-proposal-')))
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64')
  let quotes=0,generated=0
  const bridge=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    if(request.method==='GET'){
      quotes++
      return Response.json({available:true,provider:'fixture',billingSource:'platform',fixedPrice:false,quotedCredits:null})
    }
    generated++
    return new Response(png,{headers:{'content-type':'image/png'}})
  }})
  const tools=await openAgentTools({ sessionId: 'fixture',workspacePath:root,getAuthToken:()=>undefined,
    openImage:()=>({fetch: (request:Request) => fetch(new Request(bridge.url.origin+'/generate', request)),instruction:'fixture image bridge',close:async()=>{}})})
  try {
    expect(tools.turnContext).toContain('Image generation is configured. Task-authorized requests use the existing generation service for availability, pricing and applicable Credit checks.')
    expect(quotes).toBe(0)
    expect(generated).toBe(0)
    const quote=await command(root,tools.directory,'assets.mjs','cost')
    expect(quote.code,quote.stderr).toBe(0)
    expect(JSON.parse(quote.stdout)).toMatchObject({available:true,fixedPrice:false,quotedCredits:null})
    expect(tools.turnContext).not.toMatch(/already authorized|already approved|consent granted/i)
    expect(tools.turnContext).toContain('Task-authorized requests')
    expect(tools.turnContext).toContain('Generate or edit with generate_image from the configured beegame-images MCP')
    expect(tools.turnContext).toContain('independent image requests can use parallel tool calls')
    expect(tools.turnContext).toContain('CLI alternative for sessions without that tool or explicit command-line use')
    expect(tools.turnContext).not.toContain('assets.mjs generate --help provides request examples')
    expect(quotes).toBe(1)
    await writeFile(join(root,'visual-request.json'),JSON.stringify({requestId:'visual-proposal-1',prompt:'Fixture play and UI view'}))
    const saved=await command(root,tools.directory,'assets.mjs','generate','visual-request.json','assets/concepts/visual-target.png')
    expect(saved.code,saved.stderr).toBe(0)
    expect(JSON.parse(saved.stdout)).toMatchObject({path:'assets/concepts/visual-target.png',
      sha256:createHash('sha256').update(png).digest('hex')})
    expect(await readFile(join(root,'assets/concepts/visual-target.png'))).toEqual(png)
    expect(generated).toBe(1)
  }finally{await tools.close();bridge.stop(true);await rm(projectWorkRoot(root),{recursive:true,force:true});await rm(root,{recursive:true,force:true})}
},30000)

test('an open image bridge does not falsely claim its default quote is usable',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-agent-image-unavailable-')))
  let generated=0
  const bridge=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
    if(request.method==='GET')return Response.json({available:false})
    generated++
    return new Response('not available',{status:503})
  }})
  const tools=await openAgentTools({ sessionId: 'fixture',workspacePath:root,getAuthToken:()=>undefined,
    openImage:()=>({fetch: (request:Request) => fetch(new Request(bridge.url.origin+'/generate', request)),instruction:'fixture image bridge',close:async()=>{}})})
  try {
    expect(tools.turnContext).toContain('Image generation is configured. Task-authorized requests use the existing generation service for availability, pricing and applicable Credit checks.')
    expect(generated).toBe(0)
    expect(JSON.parse((await command(root,tools.directory,'assets.mjs','cost')).stdout).available).toBe(false)
  }finally{await tools.close();bridge.stop(true);await rm(projectWorkRoot(root),{recursive:true,force:true});await rm(root,{recursive:true,force:true})}
},30000)

test('explicit historical consumer copies remain buildable without temporary host tools',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-consumer-build-')))
  const tools=await openAgentTools({ sessionId: 'fixture',workspacePath:root,getAuthToken:()=>undefined})
  try {
    await mkdir(join(root,'src'))
    const installed=await legacyCommand(root,tools.directory,'consumer.mjs','--install','src/bgs-content-consumer.mjs')
    expect(installed.code,installed.stderr).toBe(0)
    expect(JSON.parse(installed.stdout)).toMatchObject({alreadyPresent:false,runtimeVerified:false})
    expect(JSON.parse((await legacyCommand(root,tools.directory,'consumer.mjs','--install','src/bgs-content-consumer.mjs')).stdout).alreadyPresent).toBe(true)
    const publicationHelp = await legacyCommand(root,tools.directory,'consumer.mjs','--help')
    expect(publicationHelp.code,publicationHelp.stderr).toBe(0)
    expect(publicationHelp.stdout).toContain('every registered resource file_paths entry and dependency local_path')
    expect(publicationHelp.stdout).toContain('required licenses')
    expect(publicationHelp.stdout).toContain('another packaging manifest')
    const assetHelp = await command(root,tools.directory,'assets.mjs','generate','--help')
    expect(assetHelp.code,assetHelp.stderr).toBe(0)
    expect(assetHelp.stdout).toContain('purpose: reference|experiment|production')
    expect(assetHelp.stdout).toContain('When requirements already exist, include their requirementIds')
    expect(assetHelp.stdout).not.toContain('Production requires existing Manifest requirementIds')
    const publication=await legacyCommand(root,tools.directory,'consumer.mjs','--install-runtime-files','src/bgs-runtime-files.mjs')
    expect(publication.code,publication.stderr).toBe(0)
    expect(await readFile(join(root,'src/bgs-runtime-files.mjs'),'utf8')).toContain('copyRegisteredRuntimeFiles')
    await writeFile(join(root,'src/main.js'),"import{readUiData}from'./bgs-content-consumer.mjs';window.readUiData=readUiData;")
    await writeFile(join(root,'package.json'),JSON.stringify({scripts:{build:'bun build.mjs'}}))
    await writeFile(join(root,'build.mjs'),"import{writeFile}from'node:fs/promises';const r=await Bun.build({entrypoints:['src/main.js'],outdir:'dist',target:'browser'});if(!r.success)throw Error('Synthetic build failed');await writeFile('dist/index.html','<!doctype html><script src=main.js></script>');")
    const built=await commandCheck(root,'build')
    expect(built.code,built.log).toBe(0)
    const sources=await projectFiles(root,'dist',[])
    expect(sources.some(f=>f.path==='src/bgs-content-consumer.mjs')).toBe(true)
    expect(sources.some(f=>f.path.startsWith('.beegame/'))).toBe(false)
    expect(await readFile(join(root,'dist/main.js'),'utf8')).toContain('readUiData')
    expect(await readFile(join(root,'src/bgs-content-consumer.mjs'),'utf8')).toBe(await readFile(resolve(root,tools.directory,'content-consumer.mjs'),'utf8'))
  } finally {await tools.close();await rm(projectWorkRoot(root),{recursive:true,force:true});await rm(root,{recursive:true,force:true})}
},30000)

// Uses the module supplied by the V3 entry, not a hand-built replacement or a
// real game. No personal Chrome profile, model or resource download is involved.
test('explicit historical consumer compatibility is read-only and installation never overwrites or follows links',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-consumer-access-')))
  const tools=await openAgentTools({ sessionId: 'fixture',workspacePath:root,getAuthToken:()=>undefined})
  try {
    const api=await legacyCommand(root,tools.directory,'consumer.mjs','--api')
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
    const consumer = await import(resolve(root, tools.directory, 'content-consumer.mjs'))
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
    const inspection=await legacyCommand(root,tools.directory,'consumer.mjs','--inspect','menu.json')
    expect(inspection.code,inspection.stderr).toBe(0)
    expect(JSON.parse(inspection.stdout).results[0].support).toMatchObject({supported:false,issues:[],
      projectSemantics:[{nodeId:'button',property:'data.action'}],runtimeVerified:false})
    expect(await readFile(join(root,'menu.json'),'utf8')).toBe(source)
    await mkdir(join(root,'src'));await writeFile(join(root,'src/custom.mjs'),'keep existing implementation')
    expect((await legacyCommand(root,tools.directory,'consumer.mjs','--install','src/custom.mjs')).code).toBe(1)
    expect(await readFile(join(root,'src/custom.mjs'),'utf8')).toBe('keep existing implementation')
    await symlink(join(root,'src/custom.mjs'),join(root,'src/link.mjs'))
    expect((await legacyCommand(root,tools.directory,'consumer.mjs','--install','src/link.mjs')).code).toBe(1)
    await symlink(join(root,'src'),join(root,'alias'))
    expect((await legacyCommand(root,tools.directory,'consumer.mjs','--install','alias/new.mjs')).code).toBe(1)
    await expect(access(join(root,'src/new.mjs'))).rejects.toThrow()
    for(const path of ['../outside.mjs','.beegame/consumer.mjs','src/node_modules/module.mjs'])
      expect((await legacyCommand(root,tools.directory,'consumer.mjs','--install',path)).code).toBe(1)
  }finally{await tools.close();await rm(projectWorkRoot(root),{recursive:true,force:true});await rm(root,{recursive:true,force:true})}
},30000)

test.skipIf(process.env.BGS_LAYOUT_BROWSER!=='1')('V3 consumer paints saved geometry/font mutations and applies the authored Camera',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-consumer-browser-')))
  const tools=await openAgentTools({ sessionId: 'fixture',workspacePath:root,getAuthToken:()=>undefined})
  const browserAccess=createPreviewTestBrowser()
  await legacyCommand(root,tools.directory,'consumer.mjs','--api')
  const source=await readFile(resolve(root,tools.directory,'content-consumer.mjs'),'utf8')
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
  } finally {driver?.kill();await browserAccess.close();server.stop(true);await tools.close();await rm(projectWorkRoot(root),{recursive:true,force:true});await rm(root,{recursive:true,force:true})}
},30000)

test('explicit historical layout CLI computes expectations from saved bytes',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-exact-source-')))
  const tools=await openAgentTools({ sessionId: 'fixture',workspacePath:root,getAuthToken:()=>undefined})
  try {
    const scene:any=sceneLayoutFixture()
    scene.data.nodes[0].transform={position:[480,270,0]}
    scene.data.nodes[1].transform.position=[337,210,0]
    scene.data.nodes[1].components=[{id:'board-visual',type:'sprite-renderer',data:{size:[20,20],color:'#ff0000'}}]
    const inspect=async()=>{
      const source=JSON.stringify(scene)
      await writeFile(join(root,'scene.json'),source)
      const output=await legacyCommand(root,tools.directory,'check-content.mjs','--layout-draft','scene.json','960','540','--details')
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
    expect((await legacyCommand(root,tools.directory,'consumer.mjs','--help')).stdout).toContain('wide colored region')
  }finally{await tools.close();await rm(projectWorkRoot(root),{recursive:true,force:true});await rm(root,{recursive:true,force:true})}
},30000)

test('tool preparation refuses linked parent before writing outside the project', async () => {
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-agent-tools-link-'))), outside=await realpath(await mkdtemp(join(tmpdir(),'bgs-agent-tools-outside-')))
  try {
    await mkdir(dirname(projectWorkDirectory(root,'fixture')), { recursive:true })
    await symlink(outside,projectWorkDirectory(root,'fixture'))
    await expect(openAgentTools({ sessionId: 'fixture',workspacePath:root,getAuthToken:()=>undefined})).rejects.toThrow('link')
    await expect(access(join(outside,'goal-tools'))).rejects.toThrow()
    await rm(projectWorkDirectory(root,'fixture'))
    await symlink(outside,projectWorkDirectory(root,'fixture'))
    await expect(openAgentTools({ sessionId: 'fixture',workspacePath:root,getAuthToken:()=>undefined})).rejects.toThrow('link')
  } finally { await rm(projectWorkRoot(root),{recursive:true,force:true});await rm(root,{recursive:true,force:true}); await rm(outside,{recursive:true,force:true}) }
})


test('new projects do not prepare or advertise a calculation appendix helper', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-no-calculator-')))
  const tools = await openAgentTools({ sessionId: 'fixture', workspacePath: root, getAuthToken: () => undefined,
    openImage: () => { throw Error('An unused image bridge must not be opened') } })
  try {
    expect(tools.turnContext).toContain('Image generation is configured')
    expect(tools.systemContext).not.toContain(BALANCE_CALCULATOR_PATH)
    await expect(access(join(root, BALANCE_CALCULATOR_PATH))).rejects.toThrow()
    await expect(access(join(root, '.beegame/delivery/calculators'))).rejects.toThrow()
  } finally { await tools.close(); await rm(projectWorkRoot(root), { recursive: true, force: true }); await rm(root, { recursive: true, force: true }) }
})

test('renewed asset entries use current image and library bridges across three turns', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-assets-turns-')))
  let catalogs = 0, quotes = 0, generated = 0, opened = 0, closed = 0
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    catalogs++
    return Response.json({ items: [{ packId: 'fixture' }] })
  } })
  const env = { ...process.env, BEEGAME_ASSET_CAPABILITY_FILE: projectPreviewCapabilityPath(root, 'fixture') }
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
        libraryBaseUrl: upstream.url.origin, openImage: async () => {
          opened++; await Bun.sleep(10)
          const bridge = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
            if (request.method === 'GET') { quotes++; return Response.json({ available: true, turn }) }
            generated++; return new Response('fixture bytes', { headers: { 'content-type': 'image/png' } })
          } })
          return { fetch: (request:Request) => fetch(new Request(bridge.url.origin + '/image', request)), instruction: 'Local fixture', close: async () => { closed++; bridge.stop(true) } }
        } })
      const entry=resolve(active.directory,'assets.mjs')
      entries.push(entry)
      const source = await readFile(entries.at(-1)!, 'utf8')
      expect(source.split('\n')[0]).not.toContain('127.0.0.1')
      expect(opened).toBe(turn)
      expect((await run(entry, '--help')).code).toBe(0)
      expect(opened).toBe(turn)
      // The renewed entry resolves only the current turn; concurrent calls share one backend.
      const quote = turn===0 ? (await Promise.all([run(entry, 'cost'),run(entry, 'cost')]))[0]!
        : await run(entry, 'cost')
      expect(opened).toBe(turn+1)
      expect(quote.code, quote.stderr).toBe(0)
      expect(JSON.parse(quote.stdout).turn).toBe(turn)
      const catalog = await run(entry, 'catalog')
      expect(catalog.code, catalog.stderr).toBe(0)
      expect(JSON.parse(catalog.stdout).items[0].packId).toBe('fixture')
      if (turn === 2) {
        await writeFile(join(root, 'request.json'), JSON.stringify({ requestId: 'fixture-attempt', purpose: 'reference', prompt: 'Fixture' }))
        const result = await run(entry, 'generate', 'request.json', 'assets/result.png')
        expect(result.code, result.stderr).toBe(0)
      }
      await rm(env.BEEGAME_ASSET_CAPABILITY_FILE)
      const expired = await run(entry, 'cost')
      expect(expired.code).toBe(1)
      expect(expired.stderr).toContain('ASSET_CAPABILITY_EXPIRED')
      expect((await run(entry, '--help')).code).toBe(0)
      await active.close()
      expect(closed).toBe(turn+1)
      await expect(access(active.directory)).rejects.toThrow()
    }
    expect(new Set(entries).size).toBe(3)
    expect(catalogs).toBe(3)
    expect(quotes).toBe(5)
    expect(generated).toBe(1)
    expect(opened).toBe(3);expect(closed).toBe(3)
  } finally { await active?.close(); upstream.stop(true); await rm(projectWorkRoot(root), { recursive: true, force: true }); await rm(root, { recursive: true, force: true }) }
}, 30000)

test('workflow helper uses the renewed turn entry and rejects wrong or revoked identities', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-workflow-capability-')))
  const other = await realpath(await mkdtemp(join(tmpdir(), 'bgs-workflow-capability-other-')))
  const calls: unknown[] = []
  const measurement = { close: async () => {} } as any
  let oldTools: Awaited<ReturnType<typeof openAgentTools>> | undefined
  let currentTools: Awaited<ReturnType<typeof openAgentTools>> | undefined
  let wrongTools: Awaited<ReturnType<typeof openAgentTools>> | undefined
  const run = async (entry: string, cwd: string, capabilityFile: string, ...args: string[]) => {
    const child = Bun.spawn([process.execPath, entry, ...args], {
      cwd,
      env: { ...process.env, BEEGAME_ASSET_CAPABILITY_FILE: capabilityFile },
      stdout: 'pipe', stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    return { stdout, stderr, code }
  }
  try {
    oldTools = await openAgentTools({ workspacePath: root, sessionId: 'chat', getAuthToken: () => undefined,
      workflow: async value => { calls.push({ turn: 'old', value }); return { turn: 'old' } } })
    await oldTools.close()
    await expect(access(oldTools.directory)).rejects.toThrow()

    currentTools = await openAgentTools({ workspacePath: root, sessionId: 'chat', getAuthToken: () => undefined,
      workflow: async value => { calls.push({ turn: 'current', value }); return { turn: 'current' } } })
    const currentEntry = resolve(currentTools.directory, 'workflow.mjs')
    const capability = projectPreviewCapabilityPath(root, 'chat')
    const defaultIndex=currentTools.systemContext.split('. Prefix each filename')[0]!
    for(const name of ['measure','handoff','workflow'])
      expect(defaultIndex).not.toContain('node '+name+'.mjs')
    expect(currentTools.systemContext).toContain('Saved sessions without this tool use workflow.mjs')
    expect(currentTools.systemContext).not.toContain('BgsMeasurement')
    for(const name of ['preview','measure','handoff'])
      expect(await Bun.file(resolve(root,currentTools.directory,name+'.mjs')).exists()).toBe(false)
    const status = await run(currentEntry, root, capability, '--status')
    expect(status.code, status.stderr).toBe(0)
    expect(JSON.parse(status.stdout)).toEqual({ turn: 'current' })
    expect(calls).toEqual([{ turn: 'current', value: { action: 'status' } }])
    const help = await run(currentEntry, root, capability, '--help')
    expect(help.code, help.stderr).toBe(0)
    expect(help.stdout).toContain('--advance <JSON>')
    expect(help.stdout).not.toContain('Preparatory production handoff: --advance')
    expect(help.stdout).toContain('GDD and visual results use final JSON')
    expect(help.stdout).toContain('implementation follows the current native completion contract')
    expect(help.stdout).not.toContain('separate verification')
    expect(help.stdout).toContain('Selection records references, not runtime assets')
    expect(calls).toEqual([{ turn: 'current', value: { action: 'status' } }])

    const choice={summary:'Existing design reference',sections:[],files:['assets/reference.png']}
    const selection=await run(currentEntry,root,capability,'--select-visual',JSON.stringify(choice))
    expect(selection.code,selection.stderr).toBe(0)
    expect(calls.at(-1)).toEqual({turn:'current',value:{...choice,action:'select-visual'}})

    const wrongWorkspace = await run(currentEntry, other, capability, '--status')
    expect(wrongWorkspace.code).toBe(1)
    expect(wrongWorkspace.stderr).toContain('Workflow belongs to another workspace')
    expect(calls).toHaveLength(2)

    wrongTools = await openAgentTools({ workspacePath: root, sessionId: 'wrong-session', getAuthToken: () => undefined,
      workflow: async value => { calls.push({ turn: 'wrong', value }); return { turn: 'wrong' } } })
    const wrongSessionEntry = resolve(root, wrongTools.directory, 'workflow.mjs')
    const wrongSession = await run(wrongSessionEntry, root, capability, '--status')
    expect(wrongSession.code).toBe(1)
    expect(wrongSession.stderr).toContain('Expired or mismatched turn capability')
    expect(calls).toHaveLength(2)
    await wrongTools.close()

    await rm(capability)
    const revoked = await run(currentEntry, root, capability, '--status')
    expect(revoked.code).toBe(1)
    expect(calls).toHaveLength(2)
    await currentTools.close()
    await expect(access(currentTools.directory)).rejects.toThrow()
  } finally {
    await wrongTools?.close()
    await currentTools?.close()
    await oldTools?.close()
    await rm(projectWorkRoot(root), { recursive: true, force: true }); await rm(root, { recursive: true, force: true })
    await rm(other, { recursive: true, force: true })
  }
})

test('native workflow binding shares the helper closure and fails closed on cancellation or close', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-native-workflow-binding-')))
  const calls: unknown[] = []
  const measurement = { close: async () => {} } as any
  let aborting: AbortController | undefined
  const tools = await openAgentTools({ workspacePath: root, sessionId: 'chat', getAuthToken: () => undefined,
    workflow: async value => {
      calls.push(value)
      if (value && typeof value === 'object' && (value as any).action === 'abort-after-callback') aborting?.abort()
      return { accepted: true, value }
    } })
  try {
    await expect(tools.workflow!({ action: 'status' })).resolves.toEqual({ accepted: true, value: { action: 'status' } })
    expect(calls).toEqual([{ action: 'status' }])

    const before = new AbortController()
    before.abort()
    await expect(tools.workflow!({ action: 'status' }, before.signal)).rejects.toThrow('Workflow capability unavailable')
    expect(calls).toHaveLength(1)

    aborting = new AbortController()
    await expect(tools.workflow!({ action: 'abort-after-callback' }, aborting.signal)).rejects.toThrow('Workflow request cancelled')
    // The callback ran once; cancellation does not attempt a compensating write.
    expect(calls).toHaveLength(2)

    await tools.close()
    await expect(tools.workflow!({ action: 'status' })).rejects.toThrow('Workflow capability unavailable')
  } finally {
    await tools.close()
    await rm(projectWorkRoot(root), { recursive: true, force: true }); await rm(root, { recursive: true, force: true })
  }
})

test.each([
  {platform:'Web',engine:'React'},{platform:'Web',engine:'Phaser'},{platform:'Web',engine:'Three.js'},
  {platform:'PC',engine:'Unity'},{platform:'PC',engine:'Godot'},{platform:'PC',engine:'Unreal'},
  {platform:'Mobile',engine:'Unity'},{platform:'XR',engine:'Unity'},{}
].flatMap(target=>[false,true].map(legacy=>({target,legacy}))))('all targets omit retired default editor adapters, even with old files: %j', async ({target,legacy}) => {
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-web-native-tools-')))
  if(legacy){await mkdir(join(root,'content'));await writeFile(join(root,'content/index.json'),'{}')}
  const tools=await openAgentTools({ sessionId: 'fixture',workspacePath:root,constraints:target,getAuthToken:()=>undefined})
  try {
    for(const name of ['check-content.mjs','bind-content.mjs','consumer.mjs','content-consumer.mjs','registered-runtime-files.mjs']) {
      expect(await Bun.file(resolve(root,tools.directory,name)).exists()).toBe(false)
      expect(tools.systemContext).not.toContain(name)
    }
    expect(tools.systemContext).not.toContain('uiLayoutContract')
    for(const name of ['resources.mjs','media.mjs','assets.mjs'])expect(await Bun.file(resolve(root,tools.directory,name)).exists()).toBe(true)
    if(legacy)expect(await readFile(join(root,'content/index.json'),'utf8')).toBe('{}')
  }finally{await tools.close();await rm(projectWorkRoot(root),{recursive:true,force:true});await rm(root,{recursive:true,force:true})}
})


test('configured image MCP generates through the existing command and keeps turn endpoints isolated',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-image-mcp-')))
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64')
  let quotes=0,opened=0,available=true,fail=false,generating=0,maxGenerating=0
  let pauseQuote=false,quoteAborted=false,releaseQuote=()=>{}
  const generated:any[]=[]
  const bridge=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    if(request.method==='GET'){
      quotes++
      if(pauseQuote)await new Promise<void>(resolve=>{releaseQuote=resolve;request.signal.addEventListener('abort',()=>{quoteAborted=true;resolve()},{once:true})})
      return Response.json({available,fixedPrice:true,quotedCreditsMicro:1_000_000,referenceImageSupported:true})
    }
    generated.push(await request.json())
    generating++;maxGenerating=Math.max(maxGenerating,generating)
    await Bun.sleep(20);generating--
    return fail ? new Response('Fixture generation outcome unknown',{status:503})
      : new Response(png,{headers:{'content-type':'image/png','x-image-credits-micro':'1000000','x-image-billing-state':'settled'}})
  }})
  const openImage=()=>{opened++;return {fetch: (request:Request) => fetch(new Request(bridge.url.origin+'/generate', request)),instruction:'fixture',close:async()=>{}}}
  const tools=await openAgentTools({sessionId:'fixture',workspacePath:root,getAuthToken:()=>undefined,openImage})
  const client=new Client({name:'image-fixture',version:'1'})
  let next:Awaited<ReturnType<typeof openAgentTools>>|undefined
  try {
    const noImages=await prepareNativeMcpConfig({},root,'fixture')
    expect(noImages.config).toEqual({});await noImages.close()
    const config=await prepareNativeMcpConfig({},root,'fixture',{},tools.imageGenerationEntry)
    const server=(config.config.mcp_servers as Record<string,any>)['beegame-images']
    expect(server.args).toEqual([tools.imageGenerationEntry,'--mcp'])
    await client.connect(new StdioClientTransport({...server,cwd:root}))
    expect((await client.listTools()).tools.map(t=>t.name)).toEqual(['generate_image'])
    expect(opened).toBe(0);expect(quotes).toBe(0);expect(generated).toHaveLength(0)
    await mkdir(join(root,'assets'));await writeFile(join(root,'assets/reference.png'),png)
    const input={purpose:'production',prompt:'Fixture actor',quality:'high',background:'transparent',referenceImagePath:'assets/reference.png'}
    const result:any=await client.callTool({name:'generate_image',arguments:{request:input,outputPath:'assets/actor.png'}})
    expect(result.isError).not.toBe(true)
    const saved=JSON.parse(result.content[0].text)
    expect(saved).toMatchObject({path:'assets/actor.png',width:1,height:1,chargedCredits:1,billingState:'settled'})
    expect(await readFile(join(root,saved.path))).toEqual(png)
    expect(JSON.parse(await readFile(saved.requestFile,'utf8'))).toMatchObject({...input,requestId:saved.requestId})
    expect(generated).toEqual([expect.objectContaining({...input,requestId:saved.requestId})])
    expect(opened).toBe(1);expect(quotes).toBe(1)
    available=false
    const unavailable:any=await client.callTool({name:'generate_image',arguments:{request:input,outputPath:'assets/unavailable.png'}})
    expect(unavailable.isError).toBe(true);expect(generated).toHaveLength(1)
    available=true
    const invalid:any=await client.callTool({name:'generate_image',arguments:{request:{...input,referenceImagePath:'../private.png'},outputPath:'assets/invalid.png'}})
    expect(invalid.isError).toBe(true);expect(quotes).toBe(2);expect(generated).toHaveLength(1)
    await mkdir(join(root,'outside'));await symlink(join(root,'outside'),join(root,'assets/alias'))
    const alias:any=await client.callTool({name:'generate_image',arguments:{request:input,outputPath:'assets/alias/new/output.png'}})
    expect(alias.isError).toBe(true);expect(generated).toHaveLength(1)
    await expect(access(join(root,'outside/new'))).rejects.toMatchObject({code:'ENOENT'})
    fail=true
    const failed:any=await client.callTool({name:'generate_image',arguments:{request:{...input,requestId:'unchanged-recovery'},outputPath:'assets/recovery.png'}})
    expect(failed.isError).toBe(true);expect(failed.content[0].text).toContain('requestId=unchanged-recovery')
    expect(generated).toHaveLength(2);await expect(access(join(root,'assets/recovery.png'))).rejects.toMatchObject({code:'ENOENT'})
    fail=false
    const recovered:any=await client.callTool({name:'generate_image',arguments:{request:{...input,requestId:'unchanged-recovery'},outputPath:'assets/recovery.png'}})
    expect(recovered.isError).not.toBe(true);expect(generated.at(-1).requestId).toBe('unchanged-recovery')
    const beforeParallel=generated.length
    const parallel=await Promise.all(['game-atlas','ui-atlas'].map(name=>client.callTool({name:'generate_image',arguments:{request:input,outputPath:`assets/${name}.png`}})))
    expect(parallel.every(result=>!result.isError)).toBe(true)
    expect(generated).toHaveLength(beforeParallel+2)
    expect(maxGenerating).toBe(2)
    const savedParallel=parallel.map(result=>JSON.parse((result.content as any[])[0].text))
    expect(new Set(savedParallel.map(result=>result.requestId)).size).toBe(2)
    for(const saved of savedParallel)expect(await readFile(join(root,saved.path))).toEqual(png)
    pauseQuote=true
    const abort=new AbortController(),beforeCancel={quotes,generated:generated.length}
    const pending=client.callTool({name:'generate_image',arguments:{request:input,outputPath:'assets/cancelled.png'}},undefined,{signal:abort.signal})
    const entered=Date.now()+2000
    while(quotes===beforeCancel.quotes&&Date.now()<entered)await Bun.sleep(10)
    expect(quotes).toBe(beforeCancel.quotes+1)
    abort.abort();await expect(pending).rejects.toThrow()
    const cancelled=Date.now()+2000
    while(!quoteAborted&&Date.now()<cancelled)await Bun.sleep(10)
    expect(quoteAborted).toBe(true);expect(generated).toHaveLength(beforeCancel.generated)
    releaseQuote();pauseQuote=false
    await tools.close()
    next=await openAgentTools({sessionId:'fixture',workspacePath:root,getAuthToken:()=>undefined,openImage})
    const before={quotes,generated:generated.length,opened}
    const stale:any=await client.callTool({name:'generate_image',arguments:{request:input,outputPath:'assets/stale.png'}})
    expect(stale.isError).toBe(true)
    expect({quotes,generated:generated.length,opened}).toEqual(before)
    await config.close()
  } finally {
    releaseQuote();await client.close();await tools.close();await next?.close();bridge.stop(true)
    await rm(projectWorkRoot(root),{recursive:true,force:true});await rm(root,{recursive:true,force:true})
  }
},30000)


test('saved native schemas can use the existing workflow command for development preview', async () => {
  const root=await realpath(await mkdtemp(join(tmpdir(),'workflow-preview-command-')))
  const observed:unknown[]=[]
  const tools=await openAgentTools({workspacePath:root,sessionId:'saved-schema',getAuthToken:()=>undefined,
    workflow:async(value,signal)=>{expect(signal?.aborted).toBe(false);observed.push(value);return {status:'idle'}}})
  try {
    const child=Bun.spawn([process.execPath,join(tools.directory,'workflow.mjs'),'--preview','status'],{
      cwd:root,env:{...process.env,BEEGAME_ASSET_CAPABILITY_FILE:projectPreviewCapabilityPath(root,'saved-schema')},stdout:'pipe',stderr:'pipe'})
    const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()])
    expect(code,err).toBe(0);expect(JSON.parse(out)).toEqual({status:'idle'})
    expect(observed).toEqual([{action:'preview',operation:'status'}])
    expect(tools.systemContext).toContain('saved native schema does not list preview')
  }finally{await tools.close();await rm(root,{recursive:true,force:true})}
})




test('closing the existing resource bridge cancels its active catalog operation',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-catalog-on-demand-')))
  let entered!:()=>void,aborted!:()=>void,calls=0
  const ready=new Promise<void>(resolve=>entered=resolve),cancelled=new Promise<void>(resolve=>aborted=resolve)
  const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
    calls++;entered();return new Promise<Response>(resolve=>request.signal.addEventListener('abort',()=>{aborted();resolve(new Response(null,{status:503}))},{once:true}))
  }})
  const tools=await openAgentTools({sessionId:'fixture',workspacePath:root,libraryBaseUrl:upstream.url.origin,getAuthToken:()=> 'synthetic'})
  try{
    const result=command(root,tools.directory,'assets.mjs','catalog')
    await ready
    await tools.close()
    await Promise.race([cancelled,Bun.sleep(1000).then(()=>{throw Error('Catalog request outlived the closed capability')})])
    expect((await result).code).toBe(1);expect(calls).toBe(1)
  }finally{await tools.close();upstream.stop(true);await rm(projectWorkRoot(root),{recursive:true,force:true});await rm(root,{recursive:true,force:true})}
},5000)

test('actual resource entry displays the confirmed source preference and host registration cannot downgrade it',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-required-resource-entry-')))
  const tools=await openAgentTools({workspacePath:root,sessionId:'fixture',resourceLibraryUsage:'required',getAuthToken:()=>undefined})
  try {
    const result=await command(root,tools.directory,'resources.mjs','--contract','registration')
    expect(result.code,result.stderr||result.stdout).toBe(0)
    const request=JSON.parse(result.stdout.split('```json\n')[1]!.split('\n```')[0]!)
    expect(request.projectTarget.resource_library_usage).toBe('required')
    expect(await readFile(join(root,'assets/asset-manifest.json'),'utf8').catch(()=>undefined)).toBeUndefined()
    await mkdir(join(root,'assets/runtime/example'),{recursive:true})
    await writeFile(join(root,request.resources[0].root_path),'{}')
    request.projectTarget.resource_library_usage='optional'
    await writeFile(join(root,'registration.json'),JSON.stringify(request))
    const rejected=await command(root,tools.directory,'resources.mjs','registration.json')
    expect(rejected.code).toBe(1)
    expect(rejected.stdout).toContain('conflicts with confirmed resource_library_usage: required')
    delete request.projectTarget.resource_library_usage
    await writeFile(join(root,'registration.json'),JSON.stringify(request))
    const registered=await command(root,tools.directory,'resources.mjs','registration.json')
    expect(registered.code,registered.stdout||registered.stderr).toBe(0)
    const saved=JSON.parse(await readFile(join(root,'assets/asset-manifest.json'),'utf8'))
    expect(saved.project_target.resource_library_usage).toBe('required')
    const configured=await command(root,tools.directory,'resources.mjs','--contract','registration')
    expect(configured.stdout).not.toContain('"projectTarget"')
  }finally{await tools.close();await rm(root,{recursive:true,force:true})}
})


test('document image access stays lazy and reference-only without resource or workflow capabilities', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-reference-tools-')))
  let opened = 0, requests = 0
  const image = Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request) {
    requests++
    if (request.method === 'GET') return Response.json({available:true})
    expect((await request.json()).purpose).toBe('reference')
    return new Response('mock reference', {headers:{'content-type':'image/png'}})
  }})
  const tools = await openAgentTools({workspacePath:root,sessionId:'fixture',referenceOnly:true,
    getAuthToken:()=>{throw Error('Reference generation must not open resource-library authentication')},
    openImage:()=>{opened++;return {fetch: (request:Request) => fetch(new Request(image.url.origin, request)),instruction:'Mock image access',close:async()=>{}}}})
  try {
    const capability = JSON.parse(await readFile(projectPreviewCapabilityPath(root,'fixture'),'utf8'))
    expect(opened).toBe(0)
    expect(capability.assets).not.toHaveProperty('registrationEndpoint')
    expect(capability.assets).not.toHaveProperty('libraryBaseUrl')
    expect(tools.workflow).toBeUndefined()
    expect(tools).not.toHaveProperty('uiLayoutConstraints')
    expect(tools.systemContext).not.toContain('Register delivered files')
    for (const name of ['resources.mjs','media.mjs','workflow.mjs']) await expect(access(join(tools.directory,name))).rejects.toThrow()
    const rejected = await fetch(capability.assets.imageEndpoint,{method:'POST',body:JSON.stringify({purpose:'production',prompt:'Forbidden production'})})
    expect(rejected.status).toBe(403)
    expect(opened).toBe(0);expect(requests).toBe(0)
    const quote = await fetch(capability.assets.imageEndpoint)
    expect((await quote.json()).available).toBe(true)
    const reference = await fetch(capability.assets.imageEndpoint,{method:'POST',body:JSON.stringify({purpose:'reference',prompt:'A design question'})})
    expect(await reference.text()).toBe('mock reference')
    expect(opened).toBe(1);expect(requests).toBe(2)
    const endpoint = capability.assets.imageEndpoint.replace(/\/image$/, '')
    expect((await fetch(endpoint,{method:'POST',body:JSON.stringify({registration:{operation:'register'}})})).status).toBe(404)
  } finally {await tools.close();image.stop(true);await rm(root,{recursive:true,force:true})}
})


test('one task router keeps image identity, validation and recovery across closed turns',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-single-image-router-')))
  const png=await (await import('sharp')).default({create:{width:4,height:3,channels:3,background:'#123456'}}).png().toBuffer()
  const config=imageConfigSchema.parse({model:'fixture-image',apiKey:'fixture-secret',quality:'medium'})
  let generated=0,opened=0,billing=0
  const attempts=new ImageAttemptStore(join(root,'host'),{generate:async(_config,request)=>{
    generated++;expect(request.prompt).toBe('Saved fixture')
    return {bytes:png,model:config.model,mimeType:'image/png',usage:null}
  }})
  const service=new ImageGenerationService(attempts,{apply:async()=>{billing++;throw Error('External image cannot use platform billing')}})
  const open=()=>openAgentTools({sessionId:'fixture',workspacePath:root,getAuthToken:()=>undefined,
    openImage:()=>{opened++;return createImageGenerationAccess({userId:'owner',projectId:'project',workspacePath:root,source:'byok',loadConfig:async()=>config,service})}})
  let tools=await open()
  const capability=async()=>JSON.parse(await readFile(projectPreviewCapabilityPath(root,'fixture'),'utf8')).assets.imageEndpoint as string
  const request={requestId:'preserved-id',purpose:'reference',prompt:'Saved fixture'}
  const post=(url:string,value:unknown)=>fetch(url,{method:'POST',body:JSON.stringify(value)})
  try{
    let endpoint=await capability()
    expect(opened).toBe(0)
    expect((await fetch(endpoint.replace(/\/image$/,'/wrong'))).status).toBe(404)
    expect((await fetch(endpoint,{headers:{origin:'https://untrusted.test'}})).status).toBe(404)
    expect(opened).toBe(0)
    expect((await post(endpoint,{...request,purpose:undefined})).status).toBe(422)
    expect(generated).toBe(0);expect(billing).toBe(0)
    const first=await post(endpoint,request)
    expect(first.status).toBe(200);expect(first.headers.get('x-image-billing-state')).toBe('external')
    expect(Buffer.from(await first.arrayBuffer()).equals(png)).toBe(true)
    expect(generated).toBe(1)
    const record=await readFile(join(root,'assets/ai-generation-prompts.md'),'utf8')
    expect(record).toContain('preserved-id');expect(record).not.toContain(new URL(endpoint).pathname)
    const previousDirectory=tools.directory
    await tools.close()
    await expect(access(previousDirectory)).rejects.toThrow()
    await expect(fetch(endpoint)).rejects.toThrow()
    tools=await open();endpoint=await capability()
    expect(tools.directory).not.toBe(previousDirectory)
    await access(tools.directory)
    const recovered=await post(endpoint,request)
    expect(recovered.status).toBe(200);expect(Buffer.from(await recovered.arrayBuffer()).equals(png)).toBe(true)
    expect((await post(endpoint,{...request,prompt:'Changed paid parameters'})).status).toBe(409)
    expect(generated).toBe(1);expect(opened).toBe(2);expect(billing).toBe(0)
  }finally{await tools.close();await rm(projectWorkRoot(root),{recursive:true,force:true});await rm(root,{recursive:true,force:true})}
},10000)

test.each(['image','library'] as const)('the merged task route retains the %s body limit, including unknown lengths',async kind=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-router-body-limit-')))
  let opened=0,authenticated=0
  const tools=await openAgentTools({sessionId:'fixture',workspacePath:root,libraryBaseUrl:'http://127.0.0.1:1',
    getAuthToken:()=>{authenticated++;return undefined},openImage:()=>{
      opened++;throw Error('Oversize image request must not open generation access')
    }})
  try{
    const assets=JSON.parse(await readFile(projectPreviewCapabilityPath(root,'fixture'),'utf8')).assets
    const endpoint=kind==='image'?assets.imageEndpoint:assets.libraryBaseUrl+'/api/resource-catalog/packs'
    const limit=kind==='image'?256*1024:1024*1024
    const bytes=new Uint8Array(limit+1)
    const declared=await fetch(endpoint,{method:'POST',body:bytes})
    expect(declared.status).toBe(413)
    const chunked=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(bytes);controller.close()}})
    const streamed=await fetch(endpoint,{method:'POST',body:chunked})
    expect(streamed.status).toBe(413)
    expect(opened).toBe(0);expect(authenticated).toBe(0)
  }finally{await tools.close();await rm(projectWorkRoot(root),{recursive:true,force:true});await rm(root,{recursive:true,force:true})}
})

test.each(['client','task'] as const)('direct image dispatch propagates %s cancellation and drains before closing access',async cancel=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-direct-image-cancel-')))
  let entered!:()=>void,aborted=false,closed=false,calls=0
  const ready=new Promise<void>(resolve=>entered=resolve)
  const tools=await openAgentTools({sessionId:'fixture',workspacePath:root,getAuthToken:()=>undefined,openImage:()=>({
    instruction:'Fixture direct access',fetch:async(request:Request)=>{
      calls++;entered()
      return new Promise<Response>(resolve=>request.signal.addEventListener('abort',()=>{
        aborted=true;resolve(new Response('cancelled',{status:503}))
      },{once:true}))
    },close(){expect(aborted).toBe(true);closed=true}
  })})
  try{
    const endpoint=JSON.parse(await readFile(projectPreviewCapabilityPath(root,'fixture'),'utf8')).assets.imageEndpoint
    const controller=new AbortController()
    const result=fetch(endpoint,{signal:controller.signal}).catch(error=>error)
    await ready
    if(cancel==='client'){controller.abort();await result}
    await tools.close();await result
    expect(aborted).toBe(true);expect(closed).toBe(true);expect(calls).toBe(1)
    await expect(fetch(endpoint)).rejects.toThrow()
  }finally{await tools.close();await rm(projectWorkRoot(root),{recursive:true,force:true});await rm(root,{recursive:true,force:true})}
},5000)


test('closing during lazy image initialization cannot dispatch generation after cancellation',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-lazy-image-close-')))
  let entered!:()=>void,release!:()=>void,calls=0,closed=0
  const ready=new Promise<void>(resolve=>entered=resolve),opening=new Promise<void>(resolve=>release=resolve)
  const tools=await openAgentTools({sessionId:'fixture',workspacePath:root,getAuthToken:()=>undefined,openImage:async()=>{
    entered();await opening
    return {instruction:'Fixture',fetch:async()=>{calls++;return new Response('unexpected')},close(){closed++}}
  }})
  try{
    const endpoint=JSON.parse(await readFile(projectPreviewCapabilityPath(root,'fixture'),'utf8')).assets.imageEndpoint
    const result=fetch(endpoint).catch(error=>error)
    await ready
    const closing=tools.close();release()
    await closing;await result
    expect(calls).toBe(0);expect(closed).toBe(1)
  }finally{release();await tools.close();await rm(projectWorkRoot(root),{recursive:true,force:true});await rm(root,{recursive:true,force:true})}
},5000)


test('tool cleanup drains current work and never removes a renewed turn directory or capability',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-tools-drain-cleanup-')))
  let entered!:()=>void,release!:()=>void
  const started=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve)
  const old=await openAgentTools({sessionId:'same',workspacePath:root,getAuthToken:()=>undefined,
    workflow:async()=>{entered();await gate;return 'old'}})
  let current:Awaited<ReturnType<typeof openAgentTools>>|undefined
  const running=old.workflow!({action:'status'}).catch(error=>error)
  try{
    await started
    const closing=old.close()
    await access(old.directory)
    current=await openAgentTools({sessionId:'same',workspacePath:root,getAuthToken:()=>undefined,
      workflow:async()=>({turn:'renewed'})})
    const capability=projectPreviewCapabilityPath(root,'same')
    const currentCapability=await readFile(capability,'utf8')
    release();await closing
    expect(await running).toBeInstanceOf(Error)
    await expect(access(old.directory)).rejects.toThrow()
    await access(current.directory)
    expect(await readFile(capability,'utf8')).toBe(currentCapability)
    expect(await current.workflow!({action:'status'})).toEqual({turn:'renewed'})
    await old.close()
    await access(current.directory)
  }finally{
    release();await running;await old.close();await current?.close()
    await rm(projectWorkRoot(root),{recursive:true,force:true});await rm(root,{recursive:true,force:true})
  }
})


test('design reference selection uses the existing workflow CLI without exposing production capabilities', async () => {
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-reference-selection-')))
  const calls:unknown[]=[]
  const tools=await openAgentTools({workspacePath:root,sessionId:'fixture',referenceOnly:true,getAuthToken:()=>undefined,
    workflow:async value=>{calls.push(value);return {retained:true}}})
  try {
    const request={summary:'Chosen existing picture',sections:[],files:['docs/treatment.svg']}
    const result=await command(root,tools.directory,'workflow.mjs','--select-visual',JSON.stringify(request))
    expect(result.code,result.stdout||result.stderr).toBe(0)
    expect(calls).toEqual([{...request,action:'select-visual'}])
    const help=await command(root,tools.directory,'workflow.mjs','--help')
    expect(help.stdout+help.stderr).toContain('--select-visual')
    expect(help.stdout+help.stderr).not.toContain('--advance')
    for(const file of ['media.mjs','resources.mjs'])await expect(access(join(tools.directory,file))).rejects.toThrow()
    const cli=await readFile(join(tools.directory,'workflow.mjs'),'utf8')
    const endpoint=JSON.parse(cli.match(/const api=new URL\(("[^"\n]+")\);/)![1]!)
    const denied=await fetch(endpoint,{method:'POST',body:JSON.stringify({registration:{operation:'register'}})})
    expect(denied.status).toBe(404)
    expect(calls).toHaveLength(1)
  }finally{await tools.close();await rm(root,{recursive:true,force:true})}
})
