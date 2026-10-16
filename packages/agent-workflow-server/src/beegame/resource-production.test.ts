import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { produceResources, mergeRegistrationRequests, listRegisteredResources, RESOURCE_HELP } from './resource-production'
import { assetManifestAuthoringExamples, renderAssetManifestAuthoringContract } from './asset-manifest-authoring-contract'
import { readBeeGameAssetManifest } from './asset-contracts'
import { materializeContentCheckerEntry } from './scene-ui-content-authoring'
import { sharedContentChecker } from './content-checker-runtime'
import { sharedSharp } from './shared-sharp'
import sharp from 'sharp'

test('atlas output supplies exact registration paths and merges through the real registry', async () => {
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
      maxWidth: 32, maxHeight: 32, padding: 1, filtering: 'nearest',
      resource: { id: item.id, fulfills: item.fulfills, provisional: false, reason: 'Generated test atlas', selection_reason: ['Synthetic fixture'] },
      registrationOutput: 'assets/runtime/example/registration.json' }
    const result: any = await produceResources(root, request)
    expect((await produceResources(root, request) as any).registrationRequest).toBe(request.registrationOutput)
    expect(result.registrationRequest).toBe(request.registrationOutput)
    expect(result.next).toContain('supplied resources.mjs entry with --register-from')
    const prepared = JSON.parse(await readFile(join(root, request.registrationOutput), 'utf8'))
    expect(prepared.resources[0].file_paths).toEqual([request.output, request.metadata])
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
    expect(manifest.resources.find(resource => resource.id === item.id)!.local_file_hashes![request.output]).toBeTruthy()
    await materializeContentCheckerEntry(root)
    const ownerRequest = 'owner-registration.json'
    await writeFile(join(root, ownerRequest), JSON.stringify({ operation: 'register', resources: [{ ...prepared.resources[0], id: 'another' }],
      projectTarget: fixture.project_target, requirements: fixture.requirements }))
    const child = Bun.spawn([process.execPath, '.beegame/delivery/resources.mjs', '--register-from', request.registrationOutput, ownerRequest], {
      cwd: root, env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: (await sharedContentChecker()).moduleUrl }, stdout: 'pipe', stderr: 'pipe' })
    const stdout = await new Response(child.stdout).text(), stderr = await new Response(child.stderr).text()
    expect(await child.exited, stderr || stdout).toBe(0)
    expect(JSON.parse(stdout).resources).toHaveLength(2)
    expect(JSON.parse(stdout).resources[0]).toHaveProperty('fileCount')
    expect(JSON.parse(stdout).resources[0]).not.toHaveProperty('local_file_hashes')
    const detailed = Bun.spawn([process.execPath, '.beegame/delivery/resources.mjs', '--register-from', request.registrationOutput, ownerRequest, '--details'], {
      cwd: root, env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: (await sharedContentChecker()).moduleUrl }, stdout: 'pipe', stderr: 'pipe' })
    expect(JSON.parse(await new Response(detailed.stdout).text()).resources[0]).toHaveProperty('local_file_hashes')
    expect(await detailed.exited).toBe(0)
    const listed = Bun.spawn([process.execPath, '.beegame/delivery/resources.mjs', '--list', item.id], {
      cwd: root, env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: (await sharedContentChecker()).moduleUrl }, stdout: 'pipe', stderr: 'pipe' })
    const listing = JSON.parse(await new Response(listed.stdout).text())
    expect(await listed.exited).toBe(0)
    expect(listing.resources).toHaveLength(1)
    expect(listing.resources[0].file_paths).toEqual(prepared.resources[0].file_paths)
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
    expect(await readFile(join(root, 'assets/asset-manifest.json'), 'utf8')).toBe(before)
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
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('materialized resource CLI exposes real capabilities and renders without installing dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-resource-entry-'))
  try {
    await materializeContentCheckerEntry(root)
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
    await materializeContentCheckerEntry(root)
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

test('registration input distinguishes generated provenance and reports exact web source fields through the CLI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-resource-source-contract-'))
  try {
    const contract = renderAssetManifestAuthoringContract()
    for (const guidance of [contract, RESOURCE_HELP]) {
      expect(guidance).toContain('omit source')
      expect(guidance).toContain('resource.reason')
      expect(guidance).toContain('upload/import path')
    }
    const requestExample = contract.split('Minimal local-authoring request')[1]!.split('```json\n')[1]!.split('\n```')[0]!
    const example = JSON.parse(requestExample)
    expect(example.resources[0]).not.toHaveProperty('source')
    expect(mergeRegistrationRequests([example]).resources[0]).toEqual(example.resources[0])

    await materializeContentCheckerEntry(root)
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
