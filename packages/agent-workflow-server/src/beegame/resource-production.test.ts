import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { produceResources, mergeRegistrationRequests, listRegisteredResources, RESOURCE_HELP, inspectRegistrationLock, checkRegisteredResources } from './resource-production'
import { assetManifestAuthoringExamples, renderAssetManifestAuthoringContract } from './asset-manifest-authoring-contract'
import { readBeeGameAssetManifest, writeBeeGameAssetManifest } from './asset-contracts'
import { produceMedia } from './media-production'
import { sharedContentChecker, MEDIA_PRODUCTION_ENTRY, RESOURCE_PRODUCTION_ENTRY } from './content-checker-runtime'
import { sharedSharp } from './shared-sharp'
import sharp from 'sharp'

test('media acquisition supplies exact atlas files and merges through the real registry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-atlas-registration-'))
  const previous = process.env.BEEGAME_SHARP_MODULE
  try {
    process.env.BEEGAME_SHARP_MODULE = (await sharedSharp()).moduleUrl
    await mkdir(join(root, 'assets/runtime/example'), { recursive: true })
    await writeFile(join(root, 'assets/runtime/example/source.png'), await sharp({ create: { width: 4, height: 4, channels: 4, background: '#ffffff' } }).png().toBuffer())
    const fixture = assetManifestAuthoringExamples().canonical
    fixture.project_target!.asset_format_capabilities.push('png')
    const item = fixture.resources[0]!
    const request = { operation: 'atlas', group: 'synthetic', frames: [{ id: 'sample', input: 'assets/runtime/example/source.png' }],
      output: 'assets/runtime/example/sheet.png', metadata: 'assets/runtime/example/sheet.json',
      maxWidth: 32, maxHeight: 32, padding: 1, filtering: 'nearest' }
    await writeFile(join(root,'media.mjs'),MEDIA_PRODUCTION_ENTRY)
    await writeFile(join(root,'media-request.json'),JSON.stringify(request))
    const mediaProcess=Bun.spawn([process.execPath,'media.mjs','media-request.json'],{cwd:root,
      env:{...process.env,BEEGAME_CONTENT_CHECKER_MODULE:(await sharedContentChecker()).moduleUrl},stdout:'pipe',stderr:'pipe'})
    const mediaOutput=await new Response(mediaProcess.stdout).text(),mediaError=await new Response(mediaProcess.stderr).text()
    expect(await mediaProcess.exited,mediaError||mediaOutput).toBe(0)
    const result=JSON.parse(mediaOutput)
    expect(await produceMedia(root,request,sharp)).toEqual(result)
    const acquisition='assets/runtime/example/acquisition.json'
    await writeFile(join(root,acquisition),JSON.stringify(result))
    expect(result).not.toHaveProperty('source')
    const registrationOutput='assets/runtime/example/registration.json'
    const prepared={operation:'register',resources:[{id:item.id,fulfills:item.fulfills,acquisition,
      provisional:false,reason:'Generated test atlas',selection_reason:['Synthetic fixture']}]}
    await writeFile(join(root,registrationOutput),JSON.stringify(prepared))
    expect(result.file_paths).toEqual([request.output,request.metadata])
    expect(prepared.resources[0]).not.toHaveProperty('local_file_hashes')
    const merged = mergeRegistrationRequests([prepared, { operation: 'register', resources: [{ ...prepared.resources[0], id: 'another' }],
      projectTarget: fixture.project_target, requirements: fixture.requirements }])
    expect((await produceResources(root, merged)).valid).toBe(true)
    const configured = mergeRegistrationRequests([prepared, {
      operation: 'register', resources: [], projectTarget: fixture.project_target, requirements: fixture.requirements,
    }])
    expect(configured.resources).toHaveLength(1)
    expect((await produceResources(root, configured)).valid).toBe(true)
    expect(() => mergeRegistrationRequests([{ operation: 'register', resources: [] }])).toThrow('Empty registration')
    const manifest = await readBeeGameAssetManifest(root)
    const registered=manifest.resources.find(resource=>resource.id===item.id)!
    expect(registered.technical_facts).toMatchObject({width:6,height:6})
    for(const path of result.file_paths)
      expect(registered.local_file_hashes![path]).toBe(createHash('sha256').update(await readFile(join(root,path))).digest('hex'))
    await mkdir(join(root, '.beegame/delivery'), { recursive: true })
    await writeFile(join(root, '.beegame/delivery/resources.mjs'), RESOURCE_PRODUCTION_ENTRY)
    const ownerRequest = 'owner-registration.json'
    await writeFile(join(root, ownerRequest), JSON.stringify({ operation: 'register', resources: [{ ...prepared.resources[0], id: 'another' }],
      projectTarget: fixture.project_target, requirements: fixture.requirements }))
    const child = Bun.spawn([process.execPath, '.beegame/delivery/resources.mjs', '--register-from', registrationOutput, ownerRequest], {
      cwd: root, env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: (await sharedContentChecker()).moduleUrl }, stdout: 'pipe', stderr: 'pipe' })
    const stdout = await new Response(child.stdout).text(), stderr = await new Response(child.stderr).text()
    expect(await child.exited, stderr || stdout).toBe(0)
    expect(JSON.parse(stdout).resources).toHaveLength(2)
    expect(JSON.parse(stdout).resources[0]).toHaveProperty('fileCount')
    expect(JSON.parse(stdout).resources[0]).not.toHaveProperty('local_file_hashes')
    const detailed = Bun.spawn([process.execPath, '.beegame/delivery/resources.mjs', '--register-from', registrationOutput, ownerRequest, '--details'], {
      cwd: root, env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: (await sharedContentChecker()).moduleUrl }, stdout: 'pipe', stderr: 'pipe' })
    expect(JSON.parse(await new Response(detailed.stdout).text()).resources[0]).toHaveProperty('local_file_hashes')
    expect(await detailed.exited).toBe(0)
    const listed = Bun.spawn([process.execPath, '.beegame/delivery/resources.mjs', '--list', item.id], {
      cwd: root, env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: (await sharedContentChecker()).moduleUrl }, stdout: 'pipe', stderr: 'pipe' })
    const listing = JSON.parse(await new Response(listed.stdout).text())
    expect(await listed.exited).toBe(0)
    expect(listing.resources).toHaveLength(1)
    expect(listing.resources[0].file_paths).toEqual(result.file_paths)
    expect(listing.resources[0]).not.toHaveProperty('local_file_hashes')
    expect(() => mergeRegistrationRequests([prepared, { ...prepared, operation: 'fonts' }])).toThrow()
    expect(() => mergeRegistrationRequests([{ ...prepared, requirements: [{ id: 'r', required: true }] }, { ...prepared, requirements: [{ id: 'r', required: false }] }])).toThrow('disagree')
  } finally {
    if (previous === undefined) delete process.env.BEEGAME_SHARP_MODULE; else process.env.BEEGAME_SHARP_MODULE = previous
    await rm(root, { recursive: true, force: true })
  }
})

const recipe = { format: 'beegame-programmatic-audio-v1', cues: [
  { id: 'cue', duration_ms: 100, voices: [{ source: { type: 'oscillator', waveform: 'sine', frequency_hz: 440 },
    start_ms: 0, duration_ms: 100, gain: .5, attack_ms: 5, release_ms: 10 }] },
] }

test('library registration preserves source and dependency bindings, rejecting absent dependency files before registry writes', async () => {
  const root = await mkdtemp(join(tmpdir(),'bgs-library-registration-'))
  try {
    const fixture = assetManifestAuthoringExamples().canonical, item = fixture.resources[0]!
    const dependencyPath = 'assets/runtime/example/metadata.json'
    await mkdir(join(root,'assets/runtime/example'),{recursive:true})
    await writeFile(join(root,item.root_path),'{}')
    const source = {type:'resource-library',pack_id:'pack',pack_version:'1.2',element_id:'main',element_path:'main.json'}
    const dependencies = [{key:'meta',parent_key:'main',element_id:'meta',element_path:'metadata.json',
      reference_path:'metadata.json',local_path:dependencyPath,kind:'metadata'}]
    const resource = {id:item.id,fulfills:item.fulfills,root_path:item.root_path,file_paths:[...item.file_paths,dependencyPath],
      provisional:false,reason:'Synthetic library import',selection_reason:['Matches selected design'],source,dependencies}
    const request = {operation:'register',resources:[resource],projectTarget:fixture.project_target,requirements:fixture.requirements}
    await expect(produceResources(root,request)).rejects.toThrow('does not exist')
    expect((await readBeeGameAssetManifest(root)).resources).toEqual([])
    await writeFile(join(root,dependencyPath),'{"dependency":true}')
    await produceResources(root,request)
    const saved = await readBeeGameAssetManifest(root)
    expect(saved.resources[0]).toMatchObject({source,dependencies,file_paths:resource.file_paths})
    expect(saved.resources[0]!.local_file_hashes![dependencyPath]).toBe(createHash('sha256').update('{"dependency":true}').digest('hex'))
    await expect(produceResources(root,{...request,resources:[{...resource,file_paths:item.file_paths}]})).rejects.toThrow('must be listed')
    expect(await readBeeGameAssetManifest(root)).toEqual(saved)
  } finally { await rm(root,{recursive:true,force:true}) }
})
test('saved acquisition results reuse paths and source facts without weakening registration', async () => {
  const root = await mkdtemp(join(tmpdir(),'bgs-library-registration-'))
  try {
    const fixture = assetManifestAuthoringExamples().canonical, target = fixture.project_target!
    target.asset_format_capabilities.push('png')
    await mkdir(join(root,'assets/runtime/example'),{recursive:true})
    const image = 'assets/runtime/example/art.png', resultPath = 'assets/acquired.json', metadata = 'assets/runtime/example/meta.json'
    const bytes = await sharp({create:{width:7,height:5,channels:4,background:'#fff0'}}).png().toBuffer()
    await writeFile(join(root,image),bytes)
    await writeFile(join(root,metadata),'{}')
    const dependencies = [{key:'meta',parent_key:'art',element_id:'meta',element_path:'meta.json',reference_path:'meta.json',local_path:metadata}]
    const source = {type:'resource-library',pack_id:'pack',pack_version:'1',element_id:'art',element_path:'art.png'}
    const receipt = {path:image,root_path:image,file_paths:[image,metadata],source:'resource-library',
      sha256:createHash('sha256').update(bytes).digest('hex'),registrationSource:source,dependencies,local_file_hashes:{[image]:createHash('sha256').update(bytes).digest('hex'),[metadata]:createHash('sha256').update('{}').digest('hex')}}
    await writeFile(join(root,resultPath),JSON.stringify(receipt))
    const declaration = {id:'art',fulfills:[fixture.requirements[0]!.id],acquisition:resultPath,
      provisional:false,reason:'Selected synthetic artwork',selection_reason:['Synthetic fixture']}
    const request = {operation:'register',projectTarget:target,requirements:fixture.requirements,resources:[declaration]}
    await expect(produceResources(root,{...request,projectTarget:{...target,asset_format_capabilities:['json']}})).rejects.toThrow()
    expect((await readBeeGameAssetManifest(root)).resources).toEqual([])
    await produceResources(root,request)
    const saved = await readBeeGameAssetManifest(root)
    expect(saved.resources[0]).toMatchObject({root_path:image,file_paths:[image,metadata],source,dependencies,
      technical_facts:{width:7,height:5},local_file_hashes:{[image]:receipt.sha256}})
    expect(saved.resources[0]).not.toHaveProperty('acquisition_hashes')
    // Existing project target/requirements stay owned by the registry, not copied by the caller.
    await produceResources(root,{operation:'register',resources:[{...declaration,id:'second'}]})
    const stable = await readBeeGameAssetManifest(root)
    for (const update of [{root_path:'assets/runtime/other.png'}, {file_paths:[]}, {file_paths:[image]}, {dependencies:[]},
      {source:{type:'web',source_url:'https://example.com/file',page_url:'https://example.com',license:'CC0',retrieved_at:'2026-11-07'}},
      {dependencies:[{key:'extra',parent_key:'art',element_id:'extra',element_path:'extra.json',reference_path:'extra.json',local_path:'assets/runtime/extra.json'}]}]) {
      await expect(produceResources(root,{operation:'register',resources:[{...declaration,...update}]})).rejects.toThrow()
      expect(await readBeeGameAssetManifest(root)).toEqual(stable)
    }
    await expect(produceResources(root,{operation:'register',resources:[{...declaration,reason:''}]})).rejects.toThrow()
    await expect(produceResources(root,{operation:'register',resources:[{...declaration,fulfills:['missing']}]})).rejects.toThrow('unknown requirement')
    await expect(produceResources(root,{operation:'register',resources:[{...declaration,acquisition:'../acquired.json'}]})).rejects.toThrow()
    await symlink(join(root,resultPath),join(root,'assets/link.json'))
    await expect(produceResources(root,{operation:'register',resources:[{...declaration,acquisition:'assets/link.json'}]})).rejects.toThrow('Symlink')
    await writeFile(join(root,metadata),'{} ')
    await expect(produceResources(root,{operation:'register',resources:[declaration]})).rejects.toThrow('Acquisition file changed: '+metadata)
    expect(await readBeeGameAssetManifest(root)).toEqual(stable)
    await writeFile(join(root,metadata),'{}')
    await writeFile(join(root,image),await sharp({create:{width:8,height:5,channels:4,background:'#fff0'}}).png().toBuffer())
    await expect(produceResources(root,{operation:'register',resources:[declaration]})).rejects.toThrow('Acquisition file changed')
    expect(await readBeeGameAssetManifest(root)).toEqual(stable)
  } finally {await rm(root,{recursive:true,force:true})}
})

const fontJob = { url: 'https://fonts.gstatic.com/example.woff2', output: 'assets/runtime/font.woff2',
  licenseUrl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/example/OFL.txt', license: 'OFL-1.1',
  pageUrl: 'https://fonts.google.com/specimen/Example' }

test('WAV rendering is deterministic, measurable and does not overwrite changed files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-resource-audio-'))
  try {
    const request = { operation: 'audio', recipe, outputs: { cue: 'assets/runtime/cue.wav' } }
    const first = await produceResources(root, request) as any
    expect(first.valid).toBe(true)
    expect(first.outputs[0]).toMatchObject({ reused: false, sampleRate: 44100, channels: 2, durationMs: 100 })
    const bytes = await readFile(join(root, request.outputs.cue))
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF')
    expect(bytes.readUInt32LE(40)).toBe(4410 * 4)
    expect(bytes.length).toBe(44 + 4410 * 4)
    expect(bytes.subarray(44).some(value => value !== 0)).toBe(true)
    expect((await produceResources(root, request) as any).outputs[0].reused).toBe(true)
    const changed = structuredClone(request); changed.recipe.cues[0]!.voices[0]!.gain = .2
    expect((await produceResources(root, changed)).valid).toBe(false)
    expect(await readFile(join(root, request.outputs.cue))).toEqual(bytes)
    expect((await produceResources(root, { ...request, outputs: { cue: '../outside.wav' } })).valid).toBe(false)
    expect((await produceResources(root, { ...request, recipe: { ...recipe, cues: [
      recipe.cues[0], { ...recipe.cues[0], id: 'bad' },
    ] }, outputs: { cue: request.outputs.cue, bad: 'assets/runtime/bad.mp3' } }) as any).outputs).toHaveLength(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('font acquisition preserves source/license and reuses validated bytes without network', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-resource-font-'))
  const bytes = Buffer.alloc(48); bytes.write('wOF2'); bytes.writeUInt32BE(48, 8)
  let calls = 0
  const fetcher = (async (url: string) => {
    calls++
    return new Response(url.endsWith('OFL.txt') ? 'Synthetic license fixture, not an actual licensed font' : bytes)
  }) as unknown as typeof fetch
  try {
    const request = { operation: 'fonts', jobs: [fontJob] }
    const first = await produceResources(root, request, fetcher) as any
    expect(first.valid).toBe(true)
    expect(first.outputs[0].source.type).toBe('web')
    expect(first.unverified.join(' ')).toContain('glyph coverage')
    expect(calls).toBe(2)
    const again = await produceResources(root, request, fetcher) as any
    expect(again.outputs[0].reused).toBe(true)
    expect(calls).toBe(2)
    await writeFile(join(root, fontJob.output), 'corrupt')
    expect((await produceResources(root, request, fetcher)).valid).toBe(false)
    expect(calls).toBe(2)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('font acquisition rejects redirects, arbitrary origins, bad headers and path escape', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-resource-font-errors-'))
  let calls = 0
  const fetcher = (async (_url: string, init: RequestInit) => {
    calls++; expect(init.redirect).toBe('error'); return new Response('<html>not a font</html>')
  }) as unknown as typeof fetch
  try {
    for (const job of [{ ...fontJob, url: 'http://127.0.0.1/font' }, { ...fontJob, output: '../font.woff2' }])
      expect((await produceResources(root, { operation: 'fonts', jobs: [job] }, fetcher)).valid).toBe(false)
    const invalidLicense = await produceResources(root, { operation: 'fonts', jobs: [{ ...fontJob,
      licenseUrl: 'https://github.com/google/fonts/blob/main/OFL.txt' }] }, fetcher) as any
    expect(invalidLicense.failures[0].error).toContain('fonts.jobs.licenseUrl')
    expect(calls).toBe(0)
    expect((await produceResources(root, { operation: 'fonts', jobs: [fontJob] }, fetcher)).valid).toBe(false)
    expect(calls).toBe(1)
    await mkdir(join(root, 'outside'))
    await symlink(join(root, 'outside'), join(root, 'assets'))
    expect((await produceResources(root, { operation: 'fonts', jobs: [fontJob] }, fetcher)).valid).toBe(false)
    await expect(listRegisteredResources(root)).rejects.toThrow('Symlink')
    expect(calls).toBe(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('batch registration computes hashes, preserves web provenance and leaves registry intact on failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-resource-register-'))
  const fixture = assetManifestAuthoringExamples().canonical
  const item = fixture.resources[0]!
  try {
    await mkdir(join(root, 'assets/runtime/example'), { recursive: true })
    await writeFile(join(root, item.root_path), '{}')
    const source = { type: 'web' as const, source_url: 'https://example.com/data.json', page_url: 'https://example.com/',
      license: 'Synthetic test licence', retrieved_at: '2026-10-09T00:00:00.000Z' }
    const input = { id: item.id, fulfills: item.fulfills, root_path: item.root_path, file_paths: item.file_paths,
      provisional: false, reason: 'Synthetic registration', selection_reason: ['Synthetic test'], source }
    const request = { operation: 'register', resources: [input], projectTarget: fixture.project_target, requirements: fixture.requirements }
    expect((await produceResources(root, request)).valid).toBe(true)
    const manifest = await readBeeGameAssetManifest(root)
    const bytesBeforeList = await readFile(join(root, 'assets/asset-manifest.json'))
    const inventory: any = await listRegisteredResources(root)
    expect(inventory.resources[0]).toMatchObject({ id: item.id, fulfills: item.fulfills, root_path: item.root_path, sourceType: 'web', fileCount: 1 })
    expect(inventory.resources[0]).not.toHaveProperty('file_paths')
    expect(inventory.resources[0]).not.toHaveProperty('local_file_hashes')
    expect((await listRegisteredResources(root, [item.id]) as any).resources[0].file_paths).toEqual(item.file_paths)
    expect((await listRegisteredResources(root, [item.id], true)).resources[0]).toEqual(manifest.resources[0])
    await expect(listRegisteredResources(root, ['absent'])).rejects.toThrow('Unknown registered resource IDs')
    expect(await readFile(join(root, 'assets/asset-manifest.json'))).toEqual(bytesBeforeList)
    expect(manifest.resources[0]!.source).toEqual(source)
    expect(manifest.resources[0]!.local_file_hashes![item.root_path]).toBe(createHash('sha256').update('{}').digest('hex'))
    const before = await readFile(join(root, 'assets/asset-manifest.json'), 'utf8')
    await produceResources(root, request)
    expect(await readFile(join(root, 'assets/asset-manifest.json'), 'utf8')).toBe(before)
    const invalid = { ...request, resources: [
      { ...input, id: 'bad-image', fulfills: ['wrong-name'], root_path: 'assets/runtime/picture.png', file_paths: ['assets/runtime/picture.png'] },
      { ...input, id: 'bad-font', fulfills: ['wrong-font-id'], root_path: 'assets/runtime/font.woff2', file_paths: ['assets/runtime/font.woff2'] },
    ] }
    let diagnostic = ''
    try { await produceResources(root, invalid) } catch (error) { diagnostic = String(error) }
    for (const term of ['bad-image', 'bad-font', 'wrong-name', 'wrong-font-id', 'png', 'woff2', 'allowed=json', 'no registry changes'])
      expect(diagnostic).toContain(term)
    expect(diagnostic).toContain('Use files in the listed formats')
    expect(diagnostic).toContain('explicitly expand asset_format_capabilities')
    expect(diagnostic).not.toContain('before correcting projectTarget')
    expect(await readFile(join(root, 'assets/asset-manifest.json'), 'utf8')).toBe(before)
    expect(RESOURCE_HELP).toContain('Keep projectTarget platform/runtime/roots/source preferences fixed')
    expect(RESOURCE_HELP).toContain('retain existing formats')
    // Format additions are explicit consumer declarations; unchanged replay remains idempotent.
    const expanded={...fixture.project_target!,asset_format_capabilities:[...fixture.project_target!.asset_format_capabilities,'png']}
    for (const target of [
      {...expanded,runtime:'another-runtime'}, {...expanded,platform:'another-platform'},
      {...expanded,resource_library_usage:'required'}, {...expanded,asset_format_capabilities:['png']},
      {...expanded,runtime_asset_root:'other-root'}, {...expanded,asset_format_capabilities:[...expanded.asset_format_capabilities,'image/png']},
    ]) await expect(produceResources(root,{...request,projectTarget:target})).rejects.toThrow()
    expect(await readBeeGameAssetManifest(root)).toEqual(manifest)
    const { projectTarget: _target, ...withoutTarget } = request
    expect((await produceResources(root, withoutTarget)).valid).toBe(true)
    expect(await readBeeGameAssetManifest(root)).toEqual(manifest)
    invalid.resources[1]!.file_paths = ['assets/runtime/font.woff2', ...Array.from({ length: 300 }, (_, i) => 'assets/runtime/font-' + i + '.woff2')]
    try { await produceResources(root, invalid) } catch (error) { diagnostic = String(error) }
    expect(diagnostic).toContain('301 files with this unsupported extension')
    expect(diagnostic.length).toBeLessThan(1500)
    expect(await readBeeGameAssetManifest(root)).toEqual(manifest)
    await expect(produceResources(root, { ...request, resources: [input, { ...input, id: 'missing',
      root_path: 'assets/runtime/missing.json', file_paths: ['assets/runtime/missing.json'] }] })).rejects.toThrow('does not exist')
    expect(await readFile(join(root, 'assets/asset-manifest.json'), 'utf8')).toBe(before)
    await expect(produceResources(root, { ...request, requirements: fixture.requirements.map(r => ({ ...r, required: false })) })).rejects.toThrow('redefine')
    await expect(produceResources(root, { ...request, resources: [input, input] })).rejects.toThrow('Duplicate')
    await expect(produceResources(root, { ...request, resources: [{ ...input, local_file_hashes: {} }] })).rejects.toThrow()
    // Failure released the lock; a valid retry can proceed.
    expect((await produceResources(root, request)).valid).toBe(true)
    expect((await produceResources(root,{operation:'register',resources:[],projectTarget:expanded})).valid).toBe(true)
    expect((await readBeeGameAssetManifest(root)).project_target).toEqual(expanded)
    expect((await readBeeGameAssetManifest(root)).resources).toEqual(manifest.resources)
    expect((await produceResources(root,{operation:'register',resources:[],projectTarget:expanded})).valid).toBe(true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('registration lock inspection is bounded, read-only and treats owner metadata as diagnostics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-registration-lock-'))
  const lockPath = join(root, 'assets/manifest/registration.lock')
  try {
    await mkdir(join(root, 'assets/manifest'), { recursive: true })
    expect((await inspectRegistrationLock(root)).state).toBe('absent')
    await writeFile(lockPath, '')
    expect((await inspectRegistrationLock(root)).state).toBe('legacy')
    expect(await readFile(lockPath)).toHaveLength(0)

    await writeFile(lockPath, JSON.stringify({ version: 1, operation: 'register', owner: {
      pid: process.pid, host: 'synthetic-host', startedAt: '2026-10-25T00:00:00.000Z',
    } }))
    expect(await inspectRegistrationLock(root)).toMatchObject({ state: 'present', owner: { pid: process.pid, host: 'synthetic-host' } })

    await writeFile(lockPath, 'x'.repeat(16 * 1024 + 1))
    await expect(inspectRegistrationLock(root)).rejects.toThrow('safe inspection size')

    await rm(lockPath)
    await symlink(join(root, 'assets/manifest/other-lock'), lockPath)
    await expect(inspectRegistrationLock(root)).rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('materialized resource CLI exposes real capabilities and renders without installing dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-resource-entry-'))
  try {
    await mkdir(join(root, '.beegame/delivery'), { recursive: true })
    await writeFile(join(root, '.beegame/delivery/resources.mjs'), RESOURCE_PRODUCTION_ENTRY)
    const env = { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: (await sharedContentChecker()).moduleUrl }
    const capabilities = Bun.spawn([process.execPath, '.beegame/delivery/resources.mjs', '--capabilities'], { cwd: root, env, stdout: 'pipe', stderr: 'pipe' })
    const value = JSON.parse(await new Response(capabilities.stdout).text())
    expect(await capabilities.exited).toBe(0)
    expect(value).toMatchObject({ registration: true, audioSynthesisWav: true, aiMusicGeneration: false })
    const help = Bun.spawn([process.execPath, '.beegame/delivery/resources.mjs', '--help'], { cwd: root, env, stdout: 'pipe', stderr: 'pipe' })
    expect(await new Response(help.stdout).text()).not.toContain('.beegame/delivery/resources.mjs')
    expect(await help.exited).toBe(0)
    expect(renderAssetManifestAuthoringContract()).not.toContain('.beegame/delivery/resources.mjs')
    await writeFile(join(root, 'request.json'), JSON.stringify({ operation: 'audio', recipe, outputs: { cue: 'assets/runtime/cue.wav' } }))
    const child = Bun.spawn([process.execPath, '.beegame/delivery/resources.mjs', 'request.json'], { cwd: root, env, stdout: 'pipe', stderr: 'pipe' })
    expect(JSON.parse(await new Response(child.stdout).text()).valid).toBe(true)
    expect(await child.exited).toBe(0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('resource CLI preserves native manifest issues instead of request: undefined', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-resource-diagnostic-'))
  try {
    await mkdir(join(root, '.beegame/delivery'), { recursive: true })
    await writeFile(join(root, '.beegame/delivery/resources.mjs'), RESOURCE_PRODUCTION_ENTRY)
    const fixture = assetManifestAuthoringExamples().canonical
    const item = fixture.resources[0]!
    await mkdir(join(root, 'assets/runtime/example'), { recursive: true })
    await writeFile(join(root, item.root_path), '{}')
    await writeFile(join(root, 'request.json'), JSON.stringify({ operation: 'register',
      resources: [{ id: item.id, fulfills: item.fulfills, root_path: item.root_path, file_paths: item.file_paths,
        provisional: false, reason: 'Synthetic registration', selection_reason: ['Synthetic test'], dimension: '2d' }],
      projectTarget: fixture.project_target, requirements: fixture.requirements }))
    const env = { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: (await sharedContentChecker()).moduleUrl }
    const child = Bun.spawn([process.execPath, '.beegame/delivery/resources.mjs', 'request.json'], { cwd: root, env, stdout: 'pipe', stderr: 'pipe' })
    const result = JSON.parse(await new Response(child.stdout).text())
    expect(await child.exited).toBe(1)
    expect(result.valid).toBe(false)
    expect(result.issues.join(' ')).toContain('dimension')
    expect(result.issues.join(' ')).not.toContain('undefined')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('missing project target points to the supplied contract, not an absent saved path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-resource-target-diagnostic-'))
  try {
    const fixture = assetManifestAuthoringExamples().canonical
    const item = fixture.resources[0]!
    await mkdir(join(root, 'assets/runtime/example'), { recursive: true })
    await writeFile(join(root, item.root_path), '{}')
    await expect(produceResources(root, { operation: 'register', resources: [{
      id:item.id, fulfills:item.fulfills, root_path:item.root_path, file_paths:item.file_paths,
      provisional:false, reason:'Synthetic', selection_reason:['Synthetic fixture'],
    }] })).rejects.toThrow('--contract')
  } finally { await rm(root, { recursive:true, force:true }) }
})

test('compact registration reference is executable and CLI topics remain available without writing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-registration-help-'))
  try {
    await mkdir(join(root, '.beegame/delivery'), { recursive: true })
    await writeFile(join(root, '.beegame/delivery/resources.mjs'), RESOURCE_PRODUCTION_ENTRY)
    const env = { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: (await sharedContentChecker()).moduleUrl }
    const run = async (...args: string[]) => {
      const child = Bun.spawn([process.execPath, '.beegame/delivery/resources.mjs', ...args], { cwd: root, env, stdout: 'pipe', stderr: 'pipe' })
      const text = await new Response(child.stdout).text()
      return { text, exit: await child.exited }
    }
    const help = await run('--help')
    expect(help.exit).toBe(0)
    expect(help.text.length).toBeLessThan(2000)
    const registration = await run('--contract', 'registration')
    expect(registration.exit).toBe(0)
    expect(registration.text.length).toBeLessThan(4000)
    expect(registration.text).not.toContain('Optional rectangular TileSet data')
    expect((await run('--contract', 'atlas')).text).toContain('frames:')
    expect((await run('--contract', 'tilemap')).text).toContain('TileSet')
    expect((await run('--contract')).text).toBe((await run('--contract', 'full')).text)
    expect((await run('--help', 'full')).text).toContain('frequency_hz')
    expect((await run('--contract', 'unknown')).exit).toBe(1)
    expect((await readBeeGameAssetManifest(root)).resources).toEqual([])
    const request = JSON.parse(registration.text.split('```json\n')[1]!.split('\n```')[0]!)
    await mkdir(join(root, 'assets/runtime/example'), { recursive: true })
    await writeFile(join(root, request.resources[0].root_path), '{}')
    expect((await produceResources(root, request)).valid).toBe(true)
    const saved = await readBeeGameAssetManifest(root)
    expect(saved.requirements[0]!.id).toBe(request.requirements[0].id)
    expect(saved.resources[0]!.fulfills).toEqual([request.requirements[0].id])
    const configured = JSON.parse((await run('--contract','registration')).text.split('```json\n')[1]!.split('\n```')[0]!)
    expect(configured).not.toHaveProperty('projectTarget')
    expect(configured).not.toHaveProperty('requirements')
    expect(await readBeeGameAssetManifest(root)).toEqual(saved)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('registration input distinguishes generated provenance and reports exact web source fields through the CLI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-resource-source-contract-'))
  try {
    const contract = renderAssetManifestAuthoringContract()
    for (const guidance of [contract, RESOURCE_HELP]) {
      expect(guidance).toContain('omit source')
      expect(guidance).toContain('resource.reason')
      expect(guidance).toContain('upload/import path')
    }
    const requestExample = contract.split('```json\n')[1]!.split('\n```')[0]!
    const example = JSON.parse(requestExample)
    expect(example.resources[0]).not.toHaveProperty('source')
    expect(mergeRegistrationRequests([example]).resources[0]).toEqual(example.resources[0])

    await mkdir(join(root, '.beegame/delivery'), { recursive: true })
    await writeFile(join(root, '.beegame/delivery/resources.mjs'), RESOURCE_PRODUCTION_ENTRY)
    const fixture = assetManifestAuthoringExamples().canonical, item = fixture.resources[0]!
    await mkdir(join(root, 'assets/runtime/example'), { recursive: true })
    await writeFile(join(root, item.root_path), '{}')
    const input = { id: item.id, fulfills: item.fulfills, root_path: item.root_path, file_paths: item.file_paths,
      provisional: false, reason: 'Locally authored synthetic fixture', selection_reason: ['Synthetic test'] }
    const request = { operation: 'register', resources: [input], projectTarget: fixture.project_target, requirements: fixture.requirements }
    const env = { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: (await sharedContentChecker()).moduleUrl }
    const run = async (value: unknown) => {
      await writeFile(join(root, 'request.json'), JSON.stringify(value))
      const child = Bun.spawn([process.execPath, '.beegame/delivery/resources.mjs', 'request.json'], {
        cwd: root, env, stdout: 'pipe', stderr: 'pipe',
      })
      const result = JSON.parse(await new Response(child.stdout).text())
      return { result, exit: await child.exited }
    }
    for (const type of ['agent-authored', 'user-provided', 'unknown']) {
      const { result, exit } = await run({ ...request, resources: [{ ...input, source: { type } }] })
      expect(exit).toBe(1)
      expect(result.valid).toBe(false)
      expect(result.issues.join(' ')).toContain('resources.0.source.type')
      expect(result.issues.join(' ')).toContain('omit source and supply resource.reason')
      expect(result.issues.join(' ')).toContain('upload/import path')
      expect((await readBeeGameAssetManifest(root)).resources).toEqual([])
    }
    const { result: invalidWeb, exit: webExit } = await run({ ...request, resources: [{ ...input, source: {
      type: 'web', source_url: 'https://example.com/data.json', page_url: 'https://example.com/', retrieved_at: '2026-01-01T00:00:00.000Z',
    } }] })
    expect(webExit).toBe(1)
    expect(invalidWeb.issues.join(' ')).toContain('resources.0.source.license')
    expect(invalidWeb.issues.join(' ')).not.toContain('resources.0.source: Invalid input')
    expect(invalidWeb.issues.join(' ')).toContain('expected string')
    expect((await readBeeGameAssetManifest(root)).resources).toEqual([])
    const { result, exit } = await run(request)
    expect(exit).toBe(0)
    expect(result.valid).toBe(true)
    const saved = await readBeeGameAssetManifest(root)
    expect(saved.resources[0]!.source).toMatchObject({ type: 'agent-authored', reason: input.reason })
    expect(saved.resources[0]!.source).toHaveProperty('created_at')
  } finally { await rm(root, { recursive: true, force: true }) }
})


test('published registration request keeps fixed roots and the real registrar still rejects alternate roots and paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-visible-registration-'))
  try {
    const contract = renderAssetManifestAuthoringContract('registration')
    const request = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(contract)![1]!)
    expect(contract).toContain('BGS-owned roots are fixed')
    expect(RESOURCE_HELP).toContain('runtime_asset_root="' + request.projectTarget.runtime_asset_root + '"')
    await mkdir(join(root, 'assets/runtime/example'), { recursive: true })
    await writeFile(join(root, request.resources[0].root_path), '{"fixture":true}')
    for (const [field, value] of [['runtime_asset_root', 'public/art'], ['generated_asset_root', 'assets/art']]) {
      await expect(produceResources(root, { ...request, projectTarget: { ...request.projectTarget, [field!]: value } }))
        .rejects.toThrow(field! + ' must be')
    }
    expect((await produceResources(root, request)).valid).toBe(true)
    await mkdir(join(root, 'assets/art'), { recursive: true })
    await writeFile(join(root, 'assets/art/resource.json'), '{"fixture":true}')
    await expect(produceResources(root, { operation: 'register', resources: [{ ...request.resources[0], id: 'outside-root',
      root_path: 'assets/art/resource.json', file_paths: ['assets/art/resource.json'] }] }))
      .rejects.toThrow('Resource path is outside canonical asset root')
    expect((await readBeeGameAssetManifest(root)).resources).toHaveLength(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('host confirmed source preference fills omissions and rejects conflicting registration before writing', async () => {
  const root=await mkdtemp(join(tmpdir(),'bgs-confirmed-resource-policy-'))
  try {
    const example=assetManifestAuthoringExamples().canonical
    await mkdir(join(root,'assets/runtime/example'),{recursive:true})
    await writeFile(join(root,example.resources[0]!.root_path),'{}')
    const resource=example.resources[0]!
    const request={operation:'register',projectTarget:example.project_target,requirements:example.requirements,resources:[{
      id:resource.id,fulfills:resource.fulfills,root_path:resource.root_path,file_paths:resource.file_paths,
      provisional:false,reason:'Synthetic local data',selection_reason:['Synthetic requirement']}]}
    await expect(produceResources(root,request,undefined,'required')).rejects.toThrow('conflicts with confirmed')
    expect((await readBeeGameAssetManifest(root)).project_target).toBeUndefined()
    const {resource_library_usage:_examplePolicy,...target}=example.project_target!
    expect((await produceResources(root,{...request,projectTarget:target},undefined,'required')).valid).toBe(true)
    const saved=await readBeeGameAssetManifest(root)
    expect(saved.project_target!.resource_library_usage).toBe('required')
    await expect(produceResources(root,request,undefined,'required')).rejects.toThrow('conflicts with confirmed')
    expect(await readBeeGameAssetManifest(root)).toEqual(saved)
    await expect(produceResources(root,{...request,projectTarget:undefined},undefined,'optional')).rejects.toThrow('conflicts with confirmed')
    const unknown=renderAssetManifestAuthoringContract('registration')
    expect(unknown).not.toContain('"resource_library_usage": "optional"')
    for(const policy of ['optional','preferred','required'] as const)
      expect(renderAssetManifestAuthoringContract('registration',false,policy)).toContain('"resource_library_usage": "'+policy+'"')
  } finally {await rm(root,{recursive:true,force:true})}
})

const resourceCheckRoots: string[] = []
afterEach(() => { for (const root of resourceCheckRoots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function resourceCheckFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bgs-read-tools-'))); resourceCheckRoots.push(root)
  return root
}
function saveResourceCheck(root: string, file: string, value: unknown) {
  const path = join(root, file); mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value))
}
function snapshotResourceCheck(root: string) {
  return Object.fromEntries((readdirSync(root, { recursive: true, withFileTypes: true }) as any[])
    .filter(entry => entry.isFile()).map(entry => {
      const path = join(entry.parentPath, entry.name)
      return [path.slice(root.length + 1), createHash('sha256').update(readFileSync(path)).digest('hex')]
    }))
}


test('resource check needs a Manifest, never a proprietary UI or Scene document', async () => {
  const root = resourceCheckFixture()
  expect((await checkRegisteredResources(root)).issues.join(' ')).toContain('manifest.json is missing')
  const manifest = assetManifestAuthoringExamples().canonical
  manifest.resources = []; manifest.requirements = []
  await writeBeeGameAssetManifest(root, manifest)
  const before = snapshotResourceCheck(root), result = await checkRegisteredResources(root)
  expect(result).toMatchObject({valid:true,scope:'registered-resources',resources:[],requirementBindings:[]})
  expect(result.note).toContain('registered files, hashes and supported structure')
  expect(result.note).not.toMatch(/runtime|visual quality|native scene/i)
  expect(snapshotResourceCheck(root)).toEqual(before)
  // An unrelated directory/filename does not declare a BGS data contract.
  saveResourceCheck(root, 'content/ui/menu.json', 'not a BGS document')
  saveResourceCheck(root, 'content/index.json', '{}')
  expect((await checkRegisteredResources(root)).valid).toBe(true)
})


test('resource check preserves actual file, hash and requirement checks without UI inputs', async () => {
  const root = resourceCheckFixture(), manifest = assetManifestAuthoringExamples().canonical
  const resource = manifest.resources[0]!, path = 'assets/runtime/image.png'
  const png = await sharp({create:{width:16,height:16,channels:4,background:'#ffffff'}}).png().toBuffer()
  manifest.requirements = []; resource.fulfills = []
  resource.root_path = path; resource.file_paths = [path]; resource.asset_kind = 'image'; resource.dimension = '2D'
  resource.local_file_hashes = {[path]:createHash('sha256').update(png).digest('hex')}
  await writeBeeGameAssetManifest(root, manifest)
  expect((await checkRegisteredResources(root)).valid).toBe(false)
  mkdirSync(join(root,'assets/runtime'),{recursive:true}); writeFileSync(join(root,path),png)
  const before = snapshotResourceCheck(root), checked = await checkRegisteredResources(root)
  expect(checked.valid).toBe(true)
  expect(checked.resources[0]!.files[0]).toMatchObject({path,sha256:resource.local_file_hashes[path],facts:{width:16,height:16}})
  expect(snapshotResourceCheck(root)).toEqual(before)
  writeFileSync(join(root,path),'changed bytes')
  expect((await checkRegisteredResources(root)).issues.join(' ')).toContain('hash does not match')
})


test('resource check validates atlas structure and representation requirements without Scene/UI bindings', async () => {
  const root = resourceCheckFixture(), manifest = assetManifestAuthoringExamples().canonical, resource = manifest.resources[0]!
  const image = 'assets/runtime/atlas.png', atlas = 'assets/runtime/atlas.json'
  resource.root_path = image; resource.file_paths = [image,atlas]; resource.asset_kind = 'sprite-atlas'
  const png = await sharp({create:{width:16,height:16,channels:4,background:'#ffffff'}}).png().toBuffer()
  mkdirSync(join(root,'assets/runtime'),{recursive:true}); writeFileSync(join(root,image),png)
  saveResourceCheck(root,atlas,{frames:{idle:{frame:{x:0,y:0,w:16,h:16}}}})
  manifest.requirements[0]!.acquisition_profile.asset_kinds = ['sprite']
  manifest.requirements[0]!.acquisition_profile.capabilities = []
  resource.local_file_hashes = Object.fromEntries(resource.file_paths.map(path =>
    [path,createHash('sha256').update(readFileSync(join(root,path))).digest('hex')]))
  await writeBeeGameAssetManifest(root,manifest)
  const result = await checkRegisteredResources(root)
  expect(result.requirements[0]!.structure!.status).toBe('passed')
  expect(result.requirements[0]!.structure!.observations[0]).toContain(resource.id+' (sprite-atlas)')
  saveResourceCheck(root,atlas,{frames:{idle:{frame:{x:0,y:0,w:32,h:16}}}})
  resource.local_file_hashes[atlas]=createHash('sha256').update(readFileSync(join(root,atlas))).digest('hex')
  await writeBeeGameAssetManifest(root,manifest)
  expect((await checkRegisteredResources(root)).valid).toBe(false)
})



test('media acquisition preserves declared Web provenance and rejects changed files before registration',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-media-acquisition-'))
  try {
    await mkdir(join(root,'assets/runtime'),{recursive:true})
    await writeFile(join(root,'assets/input.png'),await sharp({create:{width:3,height:2,channels:4,background:'#ff0000'}}).png().toBuffer())
    const result=await produceMedia(root,{operation:'images',jobs:[{input:'assets/input.png',output:'assets/runtime/processed.png'}]},sharp)
    expect(result).not.toHaveProperty('source')
    expect(result).toMatchObject({outputs:[{operation:'images',path:'assets/runtime/processed.png'}]})
    const acquisition='assets/acquisition.json';await writeFile(join(root,acquisition),JSON.stringify(result))
    const fixture=assetManifestAuthoringExamples().canonical
    fixture.project_target!.asset_format_capabilities.push('png')
    const source={type:'web' as const,source_url:'https://assets.example/art.png',page_url:'https://assets.example/art',license:'CC0',retrieved_at:'2026-11-07T00:00:00Z'}
    const declaration={id:'processed',fulfills:[],acquisition,source,provisional:false,reason:'Transform licensed source',selection_reason:['Actual source retained']}
    const request={operation:'register',projectTarget:fixture.project_target,requirements:[],resources:[declaration]}
    expect(await produceResources(root,request)).toMatchObject({valid:true})
    expect((await readBeeGameAssetManifest(root)).resources[0]!.source).toEqual(source)
    await writeFile(join(root,'assets/runtime/processed.png'),'changed')
    await expect(produceResources(root,{operation:'register',resources:[{...declaration,id:'changed'}]})).rejects.toThrow()
    expect((await readBeeGameAssetManifest(root)).resources.map(r=>r.id)).toEqual(['processed'])
  }finally{await rm(root,{recursive:true,force:true})}
})

test('resource entry retains real read-only audit and rejects retired atlas production',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-resource-check-cli-'))
  try {
    const runtime=await sharedContentChecker(),script=join(root,'resources.mjs')
    await writeFile(script,RESOURCE_PRODUCTION_ENTRY)
    const run=async(...args:string[])=>{
      const child=Bun.spawn([process.execPath,script,...args],{cwd:root,stdout:'pipe',stderr:'pipe',
        env:{...process.env,BEEGAME_CONTENT_CHECKER_MODULE:runtime.moduleUrl}})
      const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()])
      return {code,stdout,stderr}
    }
    const missing=await run('--check')
    expect(missing.code).toBe(1);expect(JSON.parse(missing.stdout)).toMatchObject({valid:false,scope:'registered-resources'})
    const fixture=assetManifestAuthoringExamples().canonical;fixture.resources=[];fixture.requirements=[]
    await writeBeeGameAssetManifest(root,fixture)
    const checked=await run('--check')
    expect(checked.code,checked.stderr).toBe(0)
    expect(JSON.parse(checked.stdout)).toMatchObject({valid:true,resources:[],requirements:[]})
    expect((await run('--check','--details')).code).not.toBe(0)
    await expect(produceResources(root,{operation:'atlas'})).rejects.toThrow()
  }finally{await rm(root,{recursive:true,force:true})}
},30000)
