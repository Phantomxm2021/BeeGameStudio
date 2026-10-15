import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { contentDocumentSchema, contentIndexSchema } from '../game-content-schema'
import { readVersion } from './checks'
import type { CheckResult, TaskSpec } from './state'

export type PreparedSceneProbe = NonNullable<TaskSpec['sceneProbes']>[number] & {
  mode: 'scene'
  originalSha256: string
  variants: Array<{ property: 'enabled'; replacement: string }>
}

/** Isolate one registered Scene node in the served build, without changing
 * project files or assuming that the game uses a particular renderer. */
export async function prepareSceneProbes(root: string, task: Pick<TaskSpec, 'sceneProbes'|'runtimeArtifact'>,
  result: CheckResult): Promise<PreparedSceneProbe[]> {
  if (!task.sceneProbes?.length || !task.runtimeArtifact) throw Error('Declare actual Scene node probes and a static build')
  const registry = await readVersion(root, 'content/index.json')
  const packedRegistry = await readVersion(root, task.runtimeArtifact+'/content/index.json')
  result.inputs.push(registry, packedRegistry)
  if (registry.sha256 !== packedRegistry.sha256) throw Error('Packed content registry differs from registered source')
  const index = contentIndexSchema.parse(JSON.parse(await readFile(resolve(root, 'content/index.json'), 'utf8')))
  const prepared: PreparedSceneProbe[] = []
  for (const probe of task.sceneProbes) {
    const entry = index.documents?.find(item => 'content/'+item.path === probe.document)
    if (!entry || entry.kind !== 'scene-2d' || !index.files.includes(entry.path))
      throw Error('Scene probe must select a registered 2D Scene: '+probe.document)
    const source = await readVersion(root, probe.document)
    const packed = await readVersion(root, task.runtimeArtifact+'/'+probe.document)
    result.inputs.push(source, packed)
    if (source.sha256 !== packed.sha256) throw Error('Packed Scene differs from registered source: '+probe.document)
    const doc = contentDocumentSchema.parse(JSON.parse(await readFile(resolve(root, probe.document), 'utf8')))
    if (doc.kind !== 'scene-2d' || doc.id !== entry.id) throw Error('Registered Scene identity differs: '+probe.document)
    const node = doc.data.nodes.find(item => item.id === probe.nodeId)
    if (!node || node.enabled === false) throw Error('Scene probe must select an enabled saved node: '+probe.nodeId)
    const changed = structuredClone(doc)
    changed.data.nodes.find(item => item.id === probe.nodeId)!.enabled = false
    prepared.push({ ...probe, mode:'scene', originalSha256:packed.sha256,
      variants:[{property:'enabled',replacement:JSON.stringify(changed)}] })
  }
  return prepared
}
