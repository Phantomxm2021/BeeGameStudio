import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ZodError } from 'zod/v4'
import { artifactDigest } from '../runtime-acceptance'
import { contentIndexSchema, contentDocumentSchema } from '../game-content-schema'
import { createPreviewTestBrowser } from '../preview-test-browser'
import { sharedPlaywright } from '../shared-playwright'
import { requiredTouchViewport } from '../ui-layout-audit'
import { readVersion, versionsMatch } from './checks'
import { runContentCheck } from './content-checks'
import type { TaskSpec, FileVersion, CheckResult } from './state'
import { prepareUiProbes, type PreparedUiProbe } from './ui-consumption'
import { preparePixelProbes, type PreparedPixelProbe } from './pixel-consumption'
import { prepareSceneProbes, type PreparedSceneProbe } from './scene-consumption'
import { prepareFontProbes, type PreparedFontProbe } from './font-consumption'
import { prepareAudioProbes, type PreparedAudioProbe } from './audio-consumption'
import { sharedSharp } from '../shared-sharp'
import { CHECK_VERSIONS } from './check-versions'

/** Enumerate actual files, refusing aliases/escapes rather than serving workspace
 * source, host metadata or secrets through an agent-provided URL. */
export async function staticArtifactFiles(root: string, folder: string): Promise<string[]> {
  const base = await realpath(root), start = resolve(base, folder)
  const actual = await realpath(start), rel = relative(base, actual)
  if (actual !== start) throw new Error('Artifact directory aliases are not supported')
  if (!rel || rel === '..' || rel.startsWith('../')) throw new Error('Artifact must be a directory inside the workspace')
  if (!(await stat(start)).isDirectory()) throw new Error('Artifact must be a directory')
  const files: string[] = []
  async function visit(current: string) {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new Error('Artifact/content symlinks are not supported')
      const target = resolve(current, entry.name)
      if (entry.isDirectory()) await visit(target)
      else if (entry.isFile()) files.push(relative(base, target).split('\\').join('/'))
      else throw new Error('Artifact contains a non-regular file')
    }
  }
  await visit(start)
  return files
}

export const STATIC_ARTIFACT_CHECK_VERSION = CHECK_VERSIONS['runtime-smoke']
export async function runArtifactCheck(root: string, id: 'runtime-smoke' | 'delivery-package' | 'ui-data-consumption' | 'scene-data-consumption' | 'pixel-data-consumption' | 'font-data-consumption' | 'audio-data-consumption', task: Pick<TaskSpec, 'runtimeArtifact'|'expectedOutputs'|'uiProbes'|'sceneProbes'|'pixelProbes'|'audioProbes'>,
  inputs: FileVersion[], constraints: Record<string, unknown>, signal?: AbortSignal, uiScope: 'registered'|'selected' = 'registered'): Promise<CheckResult> {
  const result: CheckResult = { id, version: CHECK_VERSIONS[id], inputs: [...inputs], status: 'unverified',
    observation: 'Declare runtimeArtifact for a static web build with index.html. Server/native/XR runtimes are not supported by this driver.',
    createdAt: new Date().toISOString() }
  if (!task.runtimeArtifact) return result
  try {
    if (signal?.aborted) throw new Error('Check cancelled')
    const artifact = task.runtimeArtifact, paths = await staticArtifactFiles(root, artifact)
    if (!paths.includes(artifact+'/index.html')) { result.observation = 'Static build has no index.html'; return result }
    result.artifacts = [{ path: artifact, sha256: await artifactDigest(root, artifact, true) }]
    const versions = await Promise.all(paths.map(file => readVersion(root, file)))
    result.inputs = [...new Map([...inputs, ...versions].map(file => [file.path, file])).values()]
    result.coverage = { files: paths, limitations: [
      'Measured static build only; not published deployment, server/native/XR behavior or installation/export completeness.',
      'No proof of gameplay, original requirement coverage, aesthetics/audio quality or formal content consumption. Explicit user publication is separate.',
    ] }
    if (id === 'delivery-package') {
      // Same bytes is a packaging check, NOT data-use proof or design authority.
      result.inputs.push(await readVersion(root, 'content/index.json'))
      const index = contentIndexSchema.parse(JSON.parse(await readFile(resolve(root, 'content/index.json'), 'utf8')))
      if (!index.documents?.length) { result.observation = 'Actual content load registry is missing'; return result }
      const registry = index.documents
      if (registry.some(d => d.kind === 'vfx')) { result.observation = 'VFX resource closure is not connected to this package driver'; return result }
      if (new Set(index.files).size !== registry.length || new Set(registry.map(d => d.path)).size !== registry.length ||
          new Set(registry.map(d => d.id)).size !== registry.length || index.files.some(file => !registry.some(d => d.path === file))) {
        result.status = 'failed'; result.observation = 'Content registry IDs/paths/files disagree'; return result
      }
      const files = ['content/index.json', ...registry.map(d => 'content/'+d.path)]
      const actual = (await staticArtifactFiles(root, 'content')).filter(file => file.endsWith('.json'))
      result.artifacts.push({ path: 'content', sha256: await artifactDigest(root, 'content', true) })
      if (actual.some(file => !files.includes(file))) { result.status = 'failed'; result.observation = 'Unregistered source content JSON'; return result }
      for (const entry of registry) {
        const file = 'content/'+entry.path
        if (!actual.includes(file)) { result.observation = 'Missing or unsafe registered content: '+file; return result }
        const document = contentDocumentSchema.parse(JSON.parse(await readFile(resolve(root, file), 'utf8')))
        if (document.id !== entry.id || document.kind !== entry.kind) {
          result.status = 'failed'; result.observation = 'Registry identity differs from actual document: '+file; return result
        }
      }
      const entry = registry.find(d => d.id === index.entryScene)
      if (entry?.kind !== 'scene-'+index.dimension || entry.loadPhase !== 'startup') {
        result.status = 'failed'; result.observation = 'Entry Scene kind/load phase is invalid'; return result
      }
      const scoped = { ...task, expectedOutputs: registry.map(d => 'content/'+d.path) }
      const resourceFiles = new Set<string>()
      for (const check of ['content-structure', 'content-resources'] as const) {
        const checked = await runContentCheck(root, check, scoped, [], constraints)
        result.inputs = [...new Map([...result.inputs, ...checked.inputs].map(file => [file.path, file])).values()]
        checked.inputs.filter(v => v.path.startsWith('assets/')).forEach(v => resourceFiles.add(v.path))
        if (checked.status !== 'passed') { result.status = checked.status; result.observation = checked.observation; return result }
      }
      // Include manifest modules and actual linked resources discovered by the
      // existing scoped checker, not just a copy of index.json.
      const sources = [...new Set([...files, ...resourceFiles])]
      for (const file of sources) {
        const source = await readVersion(root, file)
        result.inputs.push(source)
        if (!paths.includes(artifact+'/'+file)) { result.observation = 'Packaged source/resource missing: '+file; return result }
        const packed = versions.find(v => v.path === artifact+'/'+file)!
        if (source.sha256 !== packed.sha256) { result.status = 'failed'; result.observation = 'Packaged bytes differ from current source: '+file; return result }
      }
      result.status = 'passed'; result.observation = 'Host checked actual static package registry, structure, resource closure and identical packaged source bytes. Not runtime data consumption or game delivery acceptance.'
    } else if (id === 'ui-data-consumption') {
      let probes: PreparedUiProbe[]
      try { probes = await prepareUiProbes(root, task, result, uiScope, requiredTouchViewport(constraints)) }
      catch (error) { result.observation = error instanceof Error ? error.message : 'Unsupported UI consumption input'; return result }
      // prepareUiProbes records the selected scope and unobserved screens;
      // do not replace it with an implicit whole-registry coverage claim.
      await observeStaticBuild(root, artifact, paths, result, signal, probes)
    } else if (id === 'scene-data-consumption') {
      let probes: PreparedSceneProbe[]
      try { probes = await prepareSceneProbes(root, task, result) }
      catch (error) { result.observation = error instanceof Error ? error.message : 'Unsupported Scene consumption input'; return result }
      result.coverage = { files: [...new Set(probes.map(probe => probe.document))], limitations: [
        'Selected visible 2D Scene node only: disabling that node in a served JSON response must change a stable actual Canvas screenshot.',
        'No proof of correct position, shape, resources, other nodes/states, gameplay or visual quality. An unchanged or unstable image remains unverified.',
      ] }
      await observeStaticBuild(root, artifact, paths, result, signal, probes)
    } else if (id === 'pixel-data-consumption') {
      let probes: PreparedPixelProbe[]
      try { probes = await preparePixelProbes(root, task, result) }
      catch (error) { result.observation = error instanceof Error ? error.message : 'Unsupported pixel consumption input'; return result }
      result.coverage = { files: [...new Set(probes.flatMap(probe => [probe.document, probe.resource.path, ...probe.variants.flatMap(v=>v.path ? [v.path] : [])]))], limitations: [
        'Actual static Canvas screenshots: isolated 2D image/frame or axis-aligned nonoverlapping Tilemap cells, source/Grid/TileSet geometry, resource replacement and restoration at declared paths/viewports.',
        'Not Tilemap collision/sorting, rotation/occlusion/shared frames across bindings, 3D, animation, text/fonts, audio, full gameplay or release acceptance.',
      ] }
      await observeStaticBuild(root, artifact, paths, result, signal, probes)
    } else if (id === 'font-data-consumption') {
      let probes: PreparedFontProbe[]
      try { probes = await prepareFontProbes(root, task, result) }
      catch (error) { result.observation = error instanceof Error ? error.message : 'Unsupported font consumption input'; return result }
      result.coverage = { files: [...new Set(probes.flatMap(probe => [probe.document, probe.resource.path]))], limitations: [
        'Explicitly bound static single-line DOM text: saved text/fontSize mutations, actual glyph fonts, selected resource suppression and restoration.',
        'Not Canvas/Scene text, inherited font bindings, rich/dynamic text, full responsive fit, shaping, font weight/style/variation or aesthetics. Unbound/system fonts are outside coverage.',
      ] }
      await observeStaticBuild(root, artifact, paths, result, signal, probes)
    } else if (id === 'audio-data-consumption') {
      let probes: PreparedAudioProbe[]
      try { probes = await prepareAudioProbes(root, task, result) }
      catch (error) { result.observation = error instanceof Error ? error.message : 'Unsupported audio consumption input'; return result }
      result.coverage = { files: [...new Set(probes.flatMap(probe => [probe.document, probe.resource.path]))], limitations: [
        'Explicit encoded Scene audio-source bindings played/stopped by declared real game clicks: native media clock/state, volume/loop properties and isolated decoded signal, silence replacement/restoration.',
        'No physical audibility/final mix gain, listening quality, actual loop boundary/restart semantics, short one-shots, detached Audio/Web Audio/synthesis/spatial audio, full event coverage or game delivery acceptance.',
      ] }
      await observeStaticBuild(root, artifact, paths, result, signal, probes)
    } else {
      await observeStaticBuild(root, artifact, paths, result, signal, undefined, undefined, requiredTouchViewport(constraints))
    }
    if (result.status === 'passed' && (!await versionsMatch(root, result.inputs) ||
        await artifactDigest(root, artifact, true) !== result.artifacts[0]!.sha256)) {
      result.status = 'unverified'; result.observation = 'Artifact or source changed during observation'
    }
  } catch (error) {
    result.status = error instanceof SyntaxError || error instanceof ZodError ? 'failed'
      : (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'unverified' : 'execution-error'
    result.observation = error instanceof Error ? error.message : 'Artifact check failed'
  }
  return result
}

/** Check URL relocation using copied bytes, not a rebuild or another Agent turn.
 * Requests are intercepted locally; this does not verify remote HTTP or gameplay. */
export async function observeStaticPublication(root: string, artifact: string, entryUrl: string): Promise<void> {
  const paths = await staticArtifactFiles(root, artifact)
  const result: CheckResult = {id:'runtime-smoke',version:STATIC_ARTIFACT_CHECK_VERSION,
    inputs:await Promise.all(paths.map(path=>readVersion(root,path))),status:'unverified',
    observation:'Publication path loading not yet observed',createdAt:new Date().toISOString()}
  await observeStaticBuild(root,artifact,paths,result,undefined,undefined,entryUrl)
  if(result.status !== 'passed') throw new Error('Publication URL loading '+result.status+': '+result.observation)
  if(!await versionsMatch(root,result.inputs)) throw new Error('Publication copy changed during observation')
}

async function observeStaticBuild(root: string, artifact: string, paths: string[], result: CheckResult, signal?: AbortSignal, uiProbes?: (PreparedUiProbe | PreparedSceneProbe | PreparedPixelProbe | PreparedFontProbe | PreparedAudioProbe)[], entryUrl?: string, requiredViewport?: [number, number]) {
  const owned = createPreviewTestBrowser()
  let child: ReturnType<typeof spawn> | undefined
  const abort = () => { void owned.close().catch(() => undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const { endpoint } = await owned.start()
    if (signal?.aborted) throw new Error('Check cancelled')
    // Like the existing design-browser-inspection.mjs, use Node for the pinned
    // Playwright client. Bun's in-process CDP connection times out on this host.
    const node = Bun.which('node')
    if (!node) throw new Error('Browser driver needs an installed Node executable; no runtime was downloaded')
    const files = paths.map(path => ({ path: path.slice(artifact.length+1), sha256: result.inputs.find(v => v.path === path)!.sha256,
      mime: Bun.file(resolve(root, path)).type || 'application/octet-stream' }))
    const sharpModule = uiProbes?.some(probe => 'mode' in probe && probe.mode === 'pixels') ? (await sharedSharp()).moduleUrl : undefined
    const observation = await new Promise<string>((resolvePromise, reject) => {
      child = spawn(node, [fileURLToPath(new URL('./runtime-browser.mjs', import.meta.url))], { cwd: root,
        env: { PATH: process.env.PATH, BGS_PLAYWRIGHT_MODULE: sharedPlaywright().moduleUrl, BGS_SHARP_MODULE: sharpModule }, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
      let output = '', errors = ''
      const stop = () => {
        try { if (process.platform !== 'win32' && child?.pid) process.kill(-child.pid, 'SIGKILL'); else child?.kill('SIGKILL') }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') reject(error) }
      }
      signal?.addEventListener('abort', stop, { once: true })
      child.stdout!.on('data', data => { output += data.toString(); if (output.length > 65536) stop() })
      child.stderr!.on('data', data => { errors = (errors+data.toString()).slice(-2000) })
      child.stdin!.on('error', () => { /* Spawn/close reports the actual driver failure. */ })
      child.once('error', error => { signal?.removeEventListener('abort', stop); reject(error) })
      child.once('close', code => {
        signal?.removeEventListener('abort', stop)
        if (signal?.aborted) reject(new Error('Check cancelled'))
        else if (code !== 0 || output.length > 65536) reject(new Error('Browser observation driver failed: '+errors))
        else resolvePromise(output)
      })
      if (signal?.aborted) stop()
      else child.stdin!.end(JSON.stringify({ endpoint, artifact: resolve(root, artifact), files, uiProbes, entryUrl, requiredViewport }))
    })
    const actual = JSON.parse(observation) as { surfacePresent: boolean; errors: string[]; missingFiles: string[]; unsupported: string[]; probes?: { status: string }[] }
    result.status = actual.unsupported.length ? 'unverified' : actual.errors.length || actual.missingFiles.length ? 'failed'
      : uiProbes ? !actual.probes?.length || actual.probes.length !== uiProbes.length ? 'unverified'
        : actual.probes.some(probe => probe.status === 'failed') ? 'failed' : actual.probes.every(probe => probe.status === 'passed') ? 'passed' : 'unverified'
      : actual.surfacePresent ? 'passed' : 'unverified'
    result.observation = observation.trim()
  } finally {
    signal?.removeEventListener('abort', abort)
    await owned.close()
  }
}
