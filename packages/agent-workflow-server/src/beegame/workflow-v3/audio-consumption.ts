import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { contentIndexSchema, contentDocumentSchema } from '../game-content-schema'
import { readBeeGameAssetManifestSync, isReadableAudioResource, AUDIO_FILE_EXTENSIONS } from '../asset-contracts'
import { readRegisteredResourceFile } from '../tilemap-contract'
import { runContentCheck } from './content-checks'
import { readVersion } from './checks'
import type { CheckResult, TaskSpec, FileVersion } from './state'

export type PreparedAudioProbe = NonNullable<TaskSpec['audioProbes']>[number] & {
  mode: 'audio'; originalSha256: string; resource: FileVersion;
  before: { volume: number; loop: boolean };
  variants: { property: 'volume' | 'loop'; replacement: string; expected: { volume: number; loop: boolean } }[];
  silence: string;
}

/** A finite PCM fixture, never a replacement saved into the game project. */
export function audioProbeWav(silent = true): Buffer {
  const rate = 22050, samples = rate * 2, bytes = samples * 2
  const wav = Buffer.alloc(44 + bytes)
  wav.write('RIFF'); wav.writeUInt32LE(36 + bytes, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28)
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(bytes, 40)
  if (!silent) for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / rate) * 8000), 44 + i * 2)
  return wav
}

/** Source coverage comes from registered Scene bindings, not author-selected
 * expectation values. Web Audio/programmatic/spatial audio remain unverified. */
export async function prepareAudioProbes(root: string, task: Pick<TaskSpec, 'audioProbes'|'runtimeArtifact'>, result: CheckResult): Promise<PreparedAudioProbe[]> {
  if (!task.audioProbes?.length) throw Error('Declare actual HTML audio selectors and play/stop click paths in audioProbes')
  result.inputs.push(await readVersion(root, 'content/index.json'))
  const index = contentIndexSchema.parse(JSON.parse(await readFile(resolve(root, 'content/index.json'), 'utf8')))
  const entries = index.documents?.filter(entry => entry.kind.startsWith('scene-')) ?? []
  if (!entries.length) throw Error('Registered Scene sources required for audio consumption')
  const documents = new Map<string, ReturnType<typeof contentDocumentSchema.parse>>()
  for (const entry of entries) {
    const path = 'content/' + entry.path
    result.inputs.push(await readVersion(root, path))
    const doc = contentDocumentSchema.parse(JSON.parse(await readFile(resolve(root, path), 'utf8')))
    if (doc.id !== entry.id || doc.kind !== entry.kind || !doc.kind.startsWith('scene-')) throw Error('Registered Scene identity differs: ' + path)
    documents.set(path, doc)
    if (!('cameraNodeId' in doc.data)) throw Error('Scene source required')
    for (const node of doc.data.nodes) for (const component of node.components ?? []) {
      if (component.type !== 'audio-source') continue
      if (!task.audioProbes.some(probe => probe.document === path && probe.nodeId === node.id && probe.componentId === component.id))
        throw Error('audioProbes omit a registered audio-source: ' + path + '#' + node.id + '/' + component.id)
    }
  }
  const resources = await runContentCheck(root, 'content-resources', { ...task, expectedOutputs: [...documents.keys()] }, [], {})
  result.inputs.push(...resources.inputs)
  if (resources.status !== 'passed') throw Error('Saved audio resources unverified: ' + resources.observation)
  const manifest = readBeeGameAssetManifestSync(root), prepared: PreparedAudioProbe[] = []
  for (const probe of task.audioProbes) {
    const doc = documents.get(probe.document)
    if (!doc || !('cameraNodeId' in doc.data)) throw Error('Audio probe must select a registered Scene source')
    const node = doc.data.nodes.find(value => value.id === probe.nodeId)
    const component = node?.components?.find(value => value.id === probe.componentId && value.type === 'audio-source')
    const data = component?.data
    if (!component?.assetRef || typeof data?.volume !== 'number' || !Number.isFinite(data.volume) || data.volume < 0 || data.volume > 1 || typeof data.loop !== 'boolean')
      throw Error('HTML audio probe requires assetRef and explicit data.volume (0..1) / data.loop: ' + probe.document + '#' + probe.componentId)
    if (data.member !== undefined && typeof data.member !== 'string') throw Error('Audio member must be an exact registered path')
    const file = readRegisteredResourceFile(root, manifest, component.assetRef, data.member as string | undefined)
    const registered = manifest.resources.find(value => value.id === component.assetRef)
    if (!registered || !isReadableAudioResource(registered.asset_kind, registered.root_path))
      throw Error('Unsupported audio asset_kind '+(registered?.asset_kind ?? '(missing)')+'; register encoded audio as audio-clip or another canonical audio type')
    if (!AUDIO_FILE_EXTENSIONS.has(extname(file.path).toLowerCase()))
      throw Error('Unsupported audio member format '+extname(file.path)+'; this driver needs an encoded audio file. Structured synthesis without an encoded member is unverified')
    const source = await readVersion(root, probe.document), packed = await readVersion(root, task.runtimeArtifact + '/' + probe.document)
    const resource = await readVersion(root, file.path), packedAudio = await readVersion(root, task.runtimeArtifact + '/' + file.path)
    result.inputs.push(source, packed, resource, packedAudio)
    if (source.sha256 !== packed.sha256 || resource.sha256 !== packedAudio.sha256) throw Error('Packed Scene/audio differs from current source')
    const before = { volume: data.volume, loop: data.loop }, variants: PreparedAudioProbe['variants'] = []
    for (const property of ['volume', 'loop'] as const) {
      const changed = structuredClone(doc)
      if (!('cameraNodeId' in changed.data)) throw Error('Scene source required')
      const selected = changed.data.nodes.find(value => value.id === probe.nodeId)!.components!.find(value => value.id === probe.componentId)!
      selected.data = { ...selected.data, [property]: property === 'volume' ? (before.volume < .5 ? .73 : .27) : !before.loop }
      variants.push({ property, replacement: JSON.stringify(changed), expected: {
        volume: selected.data.volume as number, loop: selected.data.loop as boolean,
      } })
    }
    prepared.push({ ...probe, mode: 'audio', originalSha256: source.sha256, resource, before, variants, silence: audioProbeWav().toString('base64') })
  }
  return prepared
}
