import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { inspectUiLayout } from '../../../../scene-editor/src/ui-layout-inspection'
import { contentIndexSchema, contentDocumentSchema, type BeeGameContentDocument } from '../game-content-schema'
import { readVersion } from './checks'
import { digest, type CheckResult, type TaskSpec } from './state'

export type PreparedUiProbe = { document: string; nodeId: string; selector: string; viewport: [number, number]; steps?: { click: string }[];
  originalSha256: string; before: { left: number; top: number; right: number; bottom: number };
  variants: { property: 'position' | 'size'; replacement: string; expected: { left: number; top: number; right: number; bottom: number } }[] }

/** Derive expected geometry from saved source, never an Agent's expected/PASS.
 * Only UI/DOM geometry is supported. Scene, pixels, resources and audio require
 * other observations; rendering the host preview is not a substitute. */
export async function prepareUiProbes(root: string, task: Pick<TaskSpec, 'uiProbes'|'runtimeArtifact'>, result: CheckResult): Promise<PreparedUiProbe[]> {
  if (!task.uiProbes?.length) throw new Error('Declare actual target UI selectors, viewports and optional click paths in uiProbes')
  result.inputs.push(await readVersion(root, 'content/index.json'))
  const index = contentIndexSchema.parse(JSON.parse(await readFile(resolve(root, 'content/index.json'), 'utf8')))
  const registered = index.documents?.filter(doc => doc.kind.startsWith('ui-')) ?? []
  if (!registered.length) throw new Error('No registered UI source; this driver cannot establish UI data consumption')
  if (registered.some(doc => !task.uiProbes!.some(probe => probe.document === 'content/'+doc.path)))
    throw new Error('uiProbes omit registered UI documents; missing screens are unverified')
  const probes: PreparedUiProbe[] = []
  for (const probe of task.uiProbes) {
    const entry = registered.find(doc => probe.document === 'content/'+doc.path)
    if (!entry) throw new Error('Probe is not a registered UI source: '+probe.document)
    const source = await readVersion(root, probe.document), packed = await readVersion(root, task.runtimeArtifact+'/'+probe.document)
    result.inputs.push(source, packed)
    if (source.sha256 !== packed.sha256) throw new Error('Packed UI differs from current source: '+probe.document)
    const body = await readFile(resolve(root, probe.document), 'utf8'), doc = contentDocumentSchema.parse(JSON.parse(body))
    if (!doc.kind.startsWith('ui-') || doc.id !== entry.id) throw new Error('UI source identity differs from registry')
    // Schema discrimination via the existing UI family, not a second schema.
    if (!('rootId' in doc.data)) throw new Error('Unsupported UI document')
    const data = doc.data as Extract<BeeGameContentDocument, { kind: 'ui-screen' | 'ui-hud' | 'ui-flow' }>['data']
    const requiredViewports = data.nodes.find(node=>node.id===data.rootId)?.data?.targetViewports
    if (Array.isArray(requiredViewports) && requiredViewports.some(view => !Array.isArray(view) || view.length!==2 ||
        !task.uiProbes!.some(candidate=>candidate.document===probe.document && candidate.viewport[0]===view[0] && candidate.viewport[1]===view[1])))
      throw new Error('uiProbes omit authored target viewports: '+probe.document)
    const node = data.nodes.find(node => node.id === probe.nodeId)
    if (!node || node.id === data.rootId || !node.layout?.size) throw new Error('Choose a non-root authored UI node with actual layout size')
    const viewport = { width: probe.viewport[0], height: probe.viewport[1] }
    const measure = (value: typeof data) => inspectUiLayout(value.nodes, value.rootId, viewport).find(rect => rect.id === probe.nodeId)
    const before = measure(data)
    if (!before?.active || before.bounds.right <= before.bounds.left || before.bounds.bottom <= before.bounds.top)
      throw new Error('UI node inactive or collapsed at this viewport; consumption is unverified')
    const variants: PreparedUiProbe['variants'] = []
    for (const property of ['position','size'] as const) {
      const changed = structuredClone(doc), changedData = changed.data as typeof data
      const target = changedData.nodes.find(node=>node.id===probe.nodeId)!
      if (property === 'position') {
        const position = target.layout!.position ?? [0,0]
        target.layout!.position = [position[0]+13,position[1]+7]
      } else target.layout!.size = [target.layout!.size![0]+16,target.layout!.size![1]+8]
      const after = measure(changedData)
      const a = before.bounds, b = after?.bounds
      if (!after?.active || !b || Math.max(Math.abs(a.left-b.left),Math.abs(a.right-b.right),Math.abs(a.top-b.top),Math.abs(a.bottom-b.bottom)) <= 2)
        throw new Error('UI '+property+' overridden or change below observation tolerance; choose another representative node/viewport')
      variants.push({ property, replacement: JSON.stringify(changed), expected: b })
    }
    probes.push({ ...probe, originalSha256: digest(body), before: before.bounds, variants })
  }
  return probes
}
