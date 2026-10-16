import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { lstat, mkdir, open, readFile, realpath, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { array, boolean, discriminatedUnion, literal, object, record, string, union, unknown, url } from 'zod/v4'
import { registerBeeGameLocalResources, readBeeGameAssetManifest, type BeeGameAuthoredResourceInput, type BeeGameAssetManifest } from './asset-contracts'
import { parseBeeGameProgrammaticAudioResource } from './programmatic-audio-resource'
import { atlasRequestSchema, produceMedia } from './media-production'
import { renderAssetManifestAuthoringContract } from './asset-manifest-authoring-contract'

const text = string().trim().min(1)
const webSource = object({ type: literal('web'), source_url: url(), page_url: url(),
  license: text, license_url: url().optional(), author: text.optional(), retrieved_at: text }).strict()
const librarySource = object({ type: literal('resource-library'), pack_id: text, pack_version: text,
  element_id: text, element_path: text }).strict()
const dependency = object({ key: text, parent_key: text, element_id: text, element_path: text,
  reference_path: text, local_path: text, kind: text.optional() }).strict()
const resource = object({ id: text, fulfills: array(text), root_path: text, file_paths: array(text).min(1),
  provisional: boolean(), reason: text, selection_reason: array(text).min(1),
  dimension: text.optional(), asset_kind: text.optional(), styles: array(text).optional(),
  capabilities: array(text).optional(), usage_tags: array(text).optional(),
  source: discriminatedUnion('type', [webSource, librarySource], {
    error: 'Registration source accepts only web or resource-library. For locally agent-authored files, omit source and supply resource.reason; the registrar writes source.type=agent-authored and created_at. Canonical manifest source objects are not registration inputs. User-provided files use the upload/import path; do not relabel them.',
  }).optional(),
  dependencies: array(dependency).optional(),
}).strict()
const requestSchema = discriminatedUnion('operation', [
  atlasRequestSchema.extend({ resource: resource.omit({ root_path: true, file_paths: true }), registrationOutput: text }),
  object({ operation: literal('register'), resources: array(resource),
    projectTarget: record(string(), unknown()).optional(),
    requirements: array(record(string(), unknown())).optional() }).strict(),
  object({ operation: literal('audio'), recipe: unknown(),
    outputs: record(string(), text), sampleRate: union([literal(22050), literal(44100), literal(48000)]).default(44100) }).strict(),
  object({ operation: literal('fonts'), jobs: array(object({
    url: url(), output: text, licenseUrl: url(), license: text, pageUrl: url(),
  }).strict()).min(1) }).strict(),
])
function parseResourceRequest(value: unknown) {
  const request = requestSchema.parse(value)
  if (request.operation === 'register' && !request.resources.length &&
      request.projectTarget === undefined && !request.requirements?.length)
    throw Error('Empty registration needs projectTarget or requirements; supply actual owner configuration, not a dummy resource')
  return request
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** No shell, package installation or writes outside the current assets tree. */
async function assetPath(root: string, path: string) {
  if (isAbsolute(path) || !path.startsWith('assets/') || path.split('/').some(p => !p || p === '..' || p === '.') || path.includes('\\'))
    throw Error('Expected an assets/ relative path: ' + path)
  const target = resolve(root, path)
  let current = root
  for (const part of relative(root, target).split('/')) {
    current = resolve(current, part)
    try { if ((await lstat(current)).isSymbolicLink()) throw Error('Symlink is not a resource target: ' + path) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return target
}
async function guardRegistryPaths(root: string) {
  for (const path of ['assets/asset-manifest.json', 'assets/manifest/requirements', 'assets/manifest/resources'])
    await assetPath(root, path)
  try {
    const index = JSON.parse(await readFile(resolve(root, 'assets/asset-manifest.json'), 'utf8'))
    for (const path of [index.modules?.requirements, ...index.modules?.resources ?? []]) if (path) await assetPath(root, path)
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}

/** Current registry operands, not a cached inventory or a quality judgment. */
export async function listRegisteredResources(workspace: string, ids: string[] = [], details = false) {
  const root = await realpath(workspace)
  await guardRegistryPaths(root)
  const manifest = await readBeeGameAssetManifest(root)
  const missing = ids.filter(id => !manifest.resources.some(item => item.id === id))
  if (missing.length) throw Error('Unknown registered resource IDs: ' + missing.join(', ') + '; run --list for current IDs')
  const resources = manifest.resources.filter(item => !ids.length || ids.includes(item.id))
  return { valid: true, scope: 'saved-resource-registration', projectTarget: manifest.project_target,
    resources: resources.map(item => details ? item : {
      id: item.id, fulfills: item.fulfills, root_path: item.root_path,
      status: item.status, provisional: item.provisional, sourceType: item.source.type,
      asset_kind: item.asset_kind, fileCount: item.file_paths.length,
      ...(ids.length ? { file_paths: item.file_paths } : {}),
    }), next: 'Use --list ID ... for exact member paths; --details also includes hashes/provenance. This does not verify decoding, glyph coverage or quality.' }
}
async function saveNew(root: string, path: string, bytes: Buffer) {
  const target = await assetPath(root, path)
  try {
    const existing = await readFile(target)
    if (existing.equals(bytes)) return { path, sha256: hash(bytes), reused: true }
    throw Error('Output already exists with different bytes; choose a new version path: ' + path)
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  await mkdir(dirname(target), { recursive: true })
  const file = await open(await assetPath(root, path), 'wx', 0o600)
  try { await file.writeFile(bytes) } catch (error) {
    await file.close(); await unlink(target); throw error
  }
  await file.close()
  return { path, sha256: hash(bytes), reused: false }
}

// Limit automated font acquisition to established public distribution origins.
// No redirects to private hosts or arbitrary provider scripts are executed.
function fontUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !(url.hostname === 'fonts.gstatic.com' ||
        url.hostname === 'raw.githubusercontent.com' && url.pathname.startsWith('/google/fonts/')))
    throw Error('Font download requires HTTPS fonts.gstatic.com or raw.githubusercontent.com/google/fonts/')
  return url.href
}
async function download(url: string, fetcher: typeof fetch, limit: number) {
  const response = await fetcher(fontUrl(url), { redirect: 'error', signal: AbortSignal.timeout(30_000) })
  if (!response.ok || !response.body) throw Error('Font download failed: HTTP ' + response.status)
  const chunks: Uint8Array[] = []; let length = 0
  const reader = response.body.getReader()
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break
      length += next.value.byteLength
      if (length > limit) throw Error('Font download exceeds safe byte limit')
      chunks.push(next.value)
    }
  } finally { await reader.cancel() }
  return Buffer.concat(chunks)
}
function checkFont(bytes: Buffer, path: string) {
  const signature = bytes.toString('ascii', 0, 4)
  const format = signature === 'wOF2' ? 'woff2' : signature === 'wOFF' ? 'woff' :
    signature === 'OTTO' ? 'otf' : bytes.length >= 12 && bytes.readUInt32BE(0) === 0x00010000 ? 'ttf' : undefined
  if (!format || !path.endsWith('.' + format) || bytes.length < 48)
    throw Error('Downloaded font has invalid or mismatched font format')
  if (format.startsWith('woff') && bytes.readUInt32BE(8) !== bytes.length)
    throw Error('Downloaded font length does not match its header')
  return format
}

/** Render the existing engine-neutral cue format, not an AI music composer. */
export function renderAudioCue(cue: ReturnType<typeof parseBeeGameProgrammaticAudioResource>['cues'][number], rate: number) {
  if (![22050, 44100, 48000].includes(rate)) throw Error('Unsupported audio sample rate')
  const frames = Math.ceil(cue.duration_ms * rate / 1000)
  const samples = new Float32Array(frames * 2)
  let seed = 1
  for (const voice of cue.voices) {
    if (voice.source.type === 'oscillator' &&
        Math.max(voice.source.frequency_hz, voice.source.end_frequency_hz ?? 0) >= rate / 2)
      throw Error('Audio frequency must be below the selected sample rate Nyquist limit')
    const begin = Math.round(voice.start_ms * rate / 1000), count = Math.round(voice.duration_ms * rate / 1000)
    let phase = 0, coloured = 0
    const pan = voice.pan ?? 0, left = Math.sqrt((1 - pan) / 2), right = Math.sqrt((1 + pan) / 2)
    for (let i = 0; i < count && begin + i < frames; i++) {
      let value: number
      if (voice.source.type === 'oscillator') {
        const hz = voice.source.frequency_hz + ((voice.source.end_frequency_hz ?? voice.source.frequency_hz) - voice.source.frequency_hz) * i / Math.max(1, count - 1)
        const cycle = phase % 1
        value = voice.source.waveform === 'sine' ? Math.sin(phase * 2 * Math.PI) :
          voice.source.waveform === 'square' ? (cycle < .5 ? 1 : -1) :
          voice.source.waveform === 'triangle' ? 1 - 4 * Math.abs(cycle - .5) : cycle * 2 - 1
        phase += hz / rate
      } else {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        const white = seed / 0x100000000 * 2 - 1
        coloured = voice.source.color === 'brown' ? .98 * coloured + .02 * white :
          .85 * coloured + .15 * white
        value = voice.source.color === 'white' ? white : coloured
      }
      const attack = (voice.attack_ms ?? 0) * rate / 1000, release = (voice.release_ms ?? 0) * rate / 1000
      const gain = voice.gain * Math.min(1, attack ? i / attack : 1, release ? (count - 1 - i) / release : 1)
      samples[(begin + i) * 2]! += value * gain * left
      samples[(begin + i) * 2 + 1]! += value * gain * right
    }
  }
  let peak = 0
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
  const scale = peak > 1 ? 1 / peak : 1
  const wav = Buffer.alloc(44 + samples.length * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22)
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) wav.writeInt16LE(Math.round(samples[i]! * scale * 32767), 44 + i * 2)
  return { wav, peakBeforeNormalization: peak, normalizationGain: scale, sampleRate: rate, channels: 2, durationMs: frames * 1000 / rate }
}

export async function produceResources(workspace: string, value: unknown, fetcher: typeof fetch = fetch) {
  const root = await realpath(workspace), request = parseResourceRequest(value)
  if (request.operation === 'atlas') {
    const { resource: item, registrationOutput, ...atlas } = request
    await assetPath(root, registrationOutput)
    if (!registrationOutput.endsWith('.json') || [atlas.output, atlas.metadata, ...atlas.frames.map(frame => frame.input)].includes(registrationOutput))
      throw Error('registrationOutput must be a distinct new assets/*.json file')
    const registration = { operation: 'register', resources: [{ ...item, root_path: atlas.output, file_paths: [atlas.output, atlas.metadata] }] }
    // Plan the registration before writing pixels; a conflicting request file
    // must not strand a newly generated atlas.
    const bytes = Buffer.from(JSON.stringify(registration, null, 2) + '\n')
    try {
      if (!(await readFile(await assetPath(root, registrationOutput))).equals(bytes)) throw Error('Registration output already has different content: ' + registrationOutput)
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const media = await produceMedia(root, atlas, undefined, true)
    await saveNew(root, registrationOutput, bytes)
    return { ...media, registrationRequest: registrationOutput,
      next: 'Shared resources owner: use the supplied resources.mjs entry with --register-from ' + registrationOutput }
  }
  if (request.operation === 'register') {
    // The existing registry owns serialization/validation. Guard its exact
    // inputs and output directories before exposing it to the project CLI.
    await guardRegistryPaths(root)
    for (const item of request.resources) for (const path of item.file_paths) await assetPath(root, path)
    const ids = request.resources.map(item => item.id)
    if (new Set(ids).size !== ids.length) throw Error('Duplicate resource IDs in one registration batch')
    const lockPath = await assetPath(root, 'assets/manifest/registration.lock')
    await mkdir(dirname(lockPath), { recursive: true })
    const lock = await open(lockPath, 'wx', 0o600).catch(error => {
      if (error.code === 'EEXIST') throw Error('Resource registration is already active or was interrupted; inspect the existing lock before retrying')
      throw error
    })
    try {
      const manifest = await registerBeeGameLocalResources(root, request.resources as BeeGameAuthoredResourceInput[], {
        projectTarget: request.projectTarget as BeeGameAssetManifest['project_target'],
        requirements: request.requirements as BeeGameAssetManifest['requirements'],
      })
      return { valid: true, operation: 'register', resources: manifest.resources.filter(r => ids.includes(r.id)).map(r =>
        ({ id: r.id, file_paths: r.file_paths, local_file_hashes: r.local_file_hashes, source: r.source })),
        unverified: ['Appearance, sound quality, licence interpretation and target-runtime consumption.'] }
    } finally { await lock.close(); await unlink(lockPath) }
  }
  const outputs: unknown[] = [], failures: { item: string; error: string }[] = []
  if (request.operation === 'audio') {
    const recipe = parseBeeGameProgrammaticAudioResource(request.recipe)
    if (Object.keys(request.outputs).length !== recipe.cues.length || recipe.cues.some(c => !request.outputs[c.id]) ||
        new Set(Object.values(request.outputs)).size !== recipe.cues.length)
      throw Error('Each cue needs exactly one distinct output path')
    for (const cue of recipe.cues) try {
      const path = request.outputs[cue.id]!
      if (!path.endsWith('.wav')) throw Error('Audio output must be .wav')
      const { wav, ...facts } = renderAudioCue(cue, request.sampleRate)
      outputs.push({ id: cue.id, ...await saveNew(root, path, wav), ...facts, loop: cue.loop })
    } catch (error) { failures.push({ item: cue.id, error: String(error) }) }
  } else for (const job of request.jobs) try {
    await assetPath(root, job.output)
    try { fontUrl(job.url) } catch (error) { throw Error('fonts.jobs.url: ' + String(error)) }
    try { fontUrl(job.licenseUrl) } catch (error) { throw Error('fonts.jobs.licenseUrl: ' + String(error)) }
    const provenancePath = job.output + '.source.json'
    let cached: any
    try { cached = JSON.parse(await readFile(await assetPath(root, provenancePath), 'utf8')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (cached?.source?.source_url === job.url && cached.source.license_url === job.licenseUrl &&
        cached.source.license === job.license && cached.source.page_url === job.pageUrl) {
      const bytes = await readFile(await assetPath(root, job.output))
      const licence = await readFile(await assetPath(root, job.output + '.license.txt'))
      if (cached.sha256 !== hash(bytes) || cached.licenseSha256 !== hash(licence)) throw Error('Cached font or license changed')
      checkFont(bytes, job.output)
      outputs.push({ ...cached, reused: true }); continue
    }
    if (cached) throw Error('Font source metadata differs; choose a new version path')
    const bytes = await download(job.url, fetcher, 32 * 1024 * 1024)
    const format = checkFont(bytes, job.output)
    const licence = await download(job.licenseUrl, fetcher, 1024 * 1024)
    if (!licence.toString('utf8').trim() || licence.includes(0)) throw Error('License must be nonempty text')
    const source = { type: 'web', source_url: job.url, page_url: job.pageUrl, license: job.license,
      license_url: job.licenseUrl, retrieved_at: new Date().toISOString() }
    const result = { ...await saveNew(root, job.output, bytes), format, source, licenseSha256: hash(licence) }
    await saveNew(root, job.output + '.license.txt', licence)
    await saveNew(root, provenancePath, Buffer.from(JSON.stringify(result)))
    outputs.push(result)
  } catch (error) { failures.push({ item: job.output, error: String(error) }) }
  return { valid: !failures.length, operation: request.operation, outputs, failures,
    unverified: request.operation === 'fonts' ? ['Actual font decoding, required glyph coverage and text fit: run the supplied browser inspector. No font subset is created.'] :
      ['Composition, anti-aliasing, seamless loop sound and listening quality. This renders explicit synthesis recipes, not arbitrary high-quality music.'] }
}

export const RESOURCE_HELP = `Usage: bun <resources-entry> --capabilities
  bun <resources-entry> request.json
  bun <resources-entry> --register-from registration-1.json registration-2.json
  bun <resources-entry> --list [RESOURCE-ID ...] [--details]
--list reads the current registry without writing: all IDs/fulfills/default roots/statuses/file counts. Specified IDs also return exact member paths. --details returns full selected records including hashes/provenance. Do not cat every resource module or reread large persisted output merely to find binding operands.
No package installation is needed. Existing image processing/atlas packing stays at media.mjs.
atlas: media.mjs atlas fields plus resource:{id,fulfills,provisional,reason,selection_reason,asset_kind?,dimension?,styles?,source?}, registrationOutput:"assets/atlas-registration.json". Produces the actual atlas/frame table and a ready-to-register request with exact output paths. No manual rectangles, hashes or registry edits. Workers only produce these request files; the shared owner combines them with --register-from. Existing images/media.mjs remain supported.
register: {operation:"register",resources:[{id,fulfills,root_path,file_paths,provisional,reason,selection_reason,asset_kind?,dimension?,styles?,source?}],projectTarget?,requirements?}.
Registration input is NOT a canonical manifest resource. For locally agent-authored files, omit source and supply resource.reason; the registrar writes source.type=agent-authored and created_at. Explicit source accepts only web or resource-library with the fields below. Do not copy canonical agent-authored/user-provided source objects, status, selected_at or local_file_hashes into a request. User-provided files use the upload/import path; do not relabel them as agent-authored.
selection_reason is a non-empty string array, not a string. Encoded audio (including recipe-rendered WAV) uses asset_kind:"audio-clip" (or music/ambience/voice), never "audio". Structured synthesis JSON uses audio-cue/audio-bank and is not encoded playback evidence.
Workers return only their resources; projectTarget and requirements belong to the shared owner, not one audio/visual group. The owner may supply a separate configuration request with resources:[] and combine it with all workers using --register-from owner-config.json visual-registration.json audio-registration.json. This is one registration batch, not repeated initialization.
projectTarget uses the Manifest project's project_target fields: {platform,runtime,asset_format_capabilities,resource_library_usage,runtime_asset_root,generated_asset_root}. For a Web consumer proven to load PNG/WAV/WOFF2/JSON, an example is {platform:"web",runtime:"react",asset_format_capabilities:["png","wav","woff2","json"],resource_library_usage:"optional",runtime_asset_root:"assets/runtime",generated_asset_root:"assets/generated"}. This example is NOT platform evidence or permission to broaden an existing target. Use the actual approved runtime and all required supported formats, including fonts and metadata; never infer global capabilities from one worker's file extensions.
Use --contract for exact requirement objects/enums without creating a Manifest. Use the actual resources/media entries supplied in the project context. Every fulfills ID must be an actual requirement id, not its display name or a resource id. Existing targets/requirements cannot be silently redefined. Hashes and registry modules are computed, never supplied. Web resources use source:{type:"web",source_url,page_url,license,license_url?,retrieved_at}; fonts are not agent-authored. Library downloads return registrationSource:{type:"resource-library",pack_id,pack_version,element_id,element_path}; preserve it as source. Include required downloaded dependencies in file_paths and dependencies:[{key,parent_key,element_id,element_path,reference_path,local_path,kind?}]. Missing files or unregistered dependency paths fail registration; no manual manifest edits or source relabeling.
Registration stdout lists resource IDs, file counts and the canonical manifest location; source facts, full paths and computed hashes remain in its modules. Append --details only when those full values are needed. Do not grep bundled implementations to discover these input fields.
audio: {operation:"audio",recipe:{format:"beegame-programmatic-audio-v1",cues:[{id,duration_ms,loop?:{start_ms,end_ms},voices:[{source:{type:"oscillator",waveform:"sine"|"square"|"triangle"|"sawtooth",frequency_hz,end_frequency_hz?},start_ms,duration_ms,gain,attack_ms?,release_ms?,pan?}]}]},outputs:{"cue-id":"assets/runtime/cue.wav"},sampleRate?:44100}.
Noise source is {type:"noise",color:"white"|"pink"|"brown"}. Sample rates 22050/44100/48000; stereo PCM16. Peak normalization is reported. Loop metadata is returned for runtime binding, not an assertion of seamless audio. Repeated identical bytes reuse files; different bytes require a new path.
fonts: {operation:"fonts",jobs:[{url,output:"assets/runtime/font.woff2",licenseUrl,license,pageUrl}]}.
Font and license URLs must be direct HTTPS fonts.gstatic.com or raw.githubusercontent.com/google/fonts/ downloads (no redirects). Saves font, licence and source sidecar, reuses intact same-source files. No subset, pip or compiler needed. Browser font decode/glyph checks remain mandatory. Other sources use existing authorized acquisition paths, not mislabelled provenance.
Batch failures retain valid files and identify failed items. Retry only failed items. Production never declares appearance/listening quality passed.`

export async function runResourceProductionCli(args = process.argv.slice(2)) {
  try {
    if (args[0] === '--help') { console.log(RESOURCE_HELP); return }
    if (args.length === 1 && args[0] === '--contract') { console.log(renderAssetManifestAuthoringContract()); return }
    if (args[0] === '--capabilities') {
      console.log(JSON.stringify({ registration: true, audioSynthesisWav: true, fontDownload: true,
        atlasWithRegistrationRequest: true, batchRegistrationFromFiles: true,
        aiMusicGeneration: false, fontSubsetting: false, atlasCommand: 'Use the supplied media entry with --help',
        imageRuntimeConfigured: Boolean(process.env.BEEGAME_SHARP_MODULE) })); return
    }
    const details = args.includes('--details')
    args = args.filter(arg => arg !== '--details')
    const root = await realpath(process.cwd())
    if (args[0] === '--list') {
      console.log(JSON.stringify(await listRegisteredResources(root, args.slice(1), details))); return
    }
    const readRequest = async (name: string) => {
      const path = await realpath(resolve(root, name)), part = relative(root, path)
      if (part.startsWith('../') || isAbsolute(part)) throw Error('Resource request must be inside the project')
      return JSON.parse(await readFile(path, 'utf8'))
    }
    let request
    if (args[0] === '--register-from' && args.length > 1) {
      const entries = await Promise.all(args.slice(1).map(readRequest))
      request = mergeRegistrationRequests(entries)
    } else {
      if (args.length !== 1) throw Error(RESOURCE_HELP)
      request = await readRequest(args[0]!)
    }
    const result = await produceResources(root, request)
    console.log(JSON.stringify(!details && result.operation === 'register' && result.valid
      ? { ...result, resources: result.resources.map(item => ({
          id: item.id, fileCount: item.file_paths.length,
        })), manifest: 'assets/asset-manifest.json',
        next: 'Read manifest.modules.resources for exact registered paths, hashes and provenance; --details returns them in stdout.' }
      : result)); if (!result.valid) process.exitCode = 1
  } catch (error) {
    const issues = error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues)
      ? error.issues.map((issue: unknown) => typeof issue === 'string' ? issue :
          issue && typeof issue === 'object' && 'message' in issue && typeof issue.message === 'string'
            ? `${'path' in issue && Array.isArray(issue.path) ? issue.path.join('.') || 'request' : 'request'}: ${issue.message}`
            : String(issue)) : [String(error)]
    console.log(JSON.stringify({ valid: false, issues })); process.exitCode = 1
  }
}

export function mergeRegistrationRequests(values: unknown[]) {
  const entries = values.map(value => {
    const entry = parseResourceRequest(value)
    if (entry.operation !== 'register') throw Error('--register-from accepts only register requests')
    return entry
  })
  // Let the existing registry validate requirements/target semantics. Never
  // silently pick one worker's contradictory definition.
  const targets = entries.flatMap(entry => entry.projectTarget ? [entry.projectTarget] : [])
  if (targets.some(target => !isDeepStrictEqual(target, targets[0]))) throw Error('Registration requests disagree on projectTarget')
  const requirements = new Map<string, Record<string, unknown>>()
  for (const entry of entries) for (const requirement of entry.requirements ?? []) {
    const id = String(requirement.id)
    if (requirements.has(id) && !isDeepStrictEqual(requirements.get(id), requirement)) throw Error('Registration requests disagree on requirement: ' + id)
    requirements.set(id, requirement)
  }
  return { operation: 'register', resources: entries.flatMap(entry => entry.resources),
    ...(targets.length ? { projectTarget: targets[0] } : {}), ...(requirements.size ? { requirements: [...requirements.values()] } : {}) }
}
