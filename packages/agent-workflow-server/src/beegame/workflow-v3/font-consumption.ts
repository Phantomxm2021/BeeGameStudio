import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { contentIndexSchema, contentDocumentSchema } from '../game-content-schema'
import { readBeeGameAssetManifestSync } from '../asset-contracts'
import { readRegisteredResourceFile } from '../tilemap-contract'
import { fontCodePoints } from '../font-inspection'
import { sharedFont } from '../shared-sharp'
import { resolveUiNodesForViewport, uiCompactMaxWidth } from '../../../../scene-editor/src/ui-responsive'
import { runContentCheck } from './content-checks'
import { readVersion } from './checks'
import type { CheckResult, TaskSpec, FileVersion } from './state'

export type PreparedFontProbe = NonNullable<TaskSpec['uiProbes']>[number] & {
  mode: 'font'; originalSha256: string; resource: FileVersion;
  before: { text: string; fontSize: number };
  variants: { property: 'text' | 'font-size'; replacement: string; expected: { text: string; fontSize: number } }[];
}

type FontProbeSources = {
  documents: Map<string, ReturnType<typeof contentDocumentSchema.parse>>
}

/**
 * Read and validate the source-side part of a font probe.  This is deliberately
 * shared by the pre-build input check and the post-build preparation below:
 * the former must reject an impossible selected probe before invoking a build,
 * while the latter must re-read the same source after the build to retain the
 * existing freshness/packed-byte checks.  No runtime geometry or browser fact
 * is inferred here.
 */
async function readFontProbeSources(root: string, task: Pick<TaskSpec, 'uiProbes'>, result?: CheckResult, scope: 'registered'|'selected' = 'selected'): Promise<FontProbeSources> {
  if (!task.uiProbes?.length) throw Error('Declare actual static DOM font selectors in uiProbes')
  if (task.uiProbes.some(probe=>probe.coordinateRoot)) throw Error('coordinateRoot is supported by ui-data-consumption only; font probes observe authored CSS font sizes, not logical geometry')
  const indexPath = 'content/index.json'
  const indexVersion = await readVersion(root, indexPath)
  result?.inputs.push(indexVersion)
  const index = contentIndexSchema.parse(JSON.parse(await readFile(resolve(root, indexPath), 'utf8')))
  const entries = new Map((index.documents?.filter(entry => entry.kind.startsWith('ui-')) ?? [])
    .map(entry => ['content/'+entry.path, entry] as const))
  if (!entries.size) throw Error('Registered UI sources required for font consumption')
  const documents = new Map<string, ReturnType<typeof contentDocumentSchema.parse>>()
  // Reuse the existing consumption scope: autonomous measurements may be
  // partial; registered Task checks retain their required coverage.
  const paths=scope==='selected' ? new Set(task.uiProbes.map(probe=>probe.document)) : entries.keys()
  for (const path of paths) {
    const entry = entries.get(path)
    if (!entry) throw Error('Font probe must select a registered UI source: '+path)
    const version = await readVersion(root, path)
    result?.inputs.push(version)
    const doc = contentDocumentSchema.parse(JSON.parse(await readFile(resolve(root, path), 'utf8')))
    if (doc.id !== entry.id || doc.kind !== entry.kind || !('rootId' in doc.data)) throw Error('Registered UI identity differs: '+path)
    documents.set(path, doc)
    const data = doc.data
    const bound = data.nodes.filter(node => node.data?.font !== undefined)
    for (const node of bound) {
      const candidates = task.uiProbes.filter(probe => probe.document === path && probe.nodeId === node.id)
      if (scope==='selected' && !candidates.length) continue
      if (typeof node.text !== 'string' || !node.text.trim() || /[\r\n\t]/.test(node.text) || Object.keys(node.bindings ?? {}).length)
        throw Error('Font driver requires explicitly bound static single-line node.text: '+path+'#'+node.id)
      if (!candidates.length) throw Error('uiProbes omit a registered font binding: '+path+'#'+node.id)
      const viewports=data.nodes.find(n=>n.id===data.rootId)?.data?.targetViewports
      if (scope==='registered' && Array.isArray(viewports) && viewports.some(v=>!Array.isArray(v) || v.length!==2 || !candidates.some(p=>p.viewport[0]===v[0] && p.viewport[1]===v[1])))
        throw Error('Font probes omit authored target viewports: '+path+'#'+node.id)
    }
  }
  // Keep the selected-probe contract explicit. Non-font UI probes may be used
  // by another selected driver in the same request, but a font request must
  // still contain at least one actual bound font node.
  for (const probe of task.uiProbes) {
    const doc = documents.get(probe.document)
    if (!doc || !('rootId' in doc.data)) throw Error('Font probe must select a registered UI source')
    const node = doc.data.nodes.find(node => node.id === probe.nodeId)
    if (!node) throw Error('Font probe selects an unknown UI node: '+probe.document+'#'+probe.nodeId)
    if (node.data?.font !== undefined && !(node.data.font && typeof node.data.font === 'object' &&
      typeof (node.data.font as { assetRef?: unknown }).assetRef === 'string' && (node.data.font as { assetRef: string }).assetRef.trim()))
      throw Error('Select an explicitly font-bound static text node: '+probe.document+'#'+probe.nodeId)
  }
  if (!task.uiProbes.some(probe => documents.get(probe.document)?.data.nodes.some(node => node.id === probe.nodeId && node.data?.font !== undefined)))
    throw Error('No font-bound static DOM text to observe in selected uiProbes: '+task.uiProbes.map(probe=>probe.document+'#'+probe.nodeId).join(', '))
  return { documents }
}

/**
 * Validate only source-side font inputs.  The function intentionally does not
 * read the runtime artifact, run a resource check, or start a browser, so a
 * selected probe that cannot possibly be observed fails before the editable
 * project build.  The full preparation below remains authoritative for
 * resource/glyph and packed-byte evidence after a successful build.
 */
export async function validateFontProbeInputs(root: string, task: Pick<TaskSpec, 'uiProbes'>): Promise<void> {
  await readFontProbeSources(root, task)
}

/** Bound static DOM text only. Actual glyph fonts and resource causality are
 * observed in the game's build, not inferred from CSS names or font downloads. */
export async function prepareFontProbes(root: string, task: Pick<TaskSpec, 'uiProbes'|'runtimeArtifact'>, result: CheckResult, scope: 'registered'|'selected' = 'registered'): Promise<PreparedFontProbe[]> {
  const { documents } = await readFontProbeSources(root, task, result, scope)
  const resources = await runContentCheck(root, 'content-resources', { ...task, expectedOutputs: [...documents.keys()] }, [], {})
  result.inputs.push(...resources.inputs)
  // Incomplete structural inspection must not prevent independent runtime evidence.
  // Keep its verdict separate; invalid contracts still block these probes.
  if (resources.status !== 'passed' && resources.status !== 'unverified') throw Error('Saved font resources invalid: '+resources.observation)
  const manifest = readBeeGameAssetManifestSync(root), prepared: PreparedFontProbe[] = []
  for (const probe of task.uiProbes!) {
    const doc = documents.get(probe.document)
    if (!doc || !('rootId' in doc.data)) throw Error('Font probe must select a registered UI source')
    const data = doc.data, node = data.nodes.find(n => n.id === probe.nodeId)
    if (!node) throw Error('Font probe selects an unknown UI node: '+probe.document+'#'+probe.nodeId)
    const selection = node.data?.font as { assetRef?: string; member?: string } | undefined
    // uiProbes also serve independent geometry checks. Non-font selections
    // are outside this driver; selected font inputs were validated above.
    if (node.data?.font === undefined) continue
    if (typeof node.text !== 'string' || !selection?.assetRef) throw Error('Select an explicitly font-bound static text node')
    const font = readRegisteredResourceFile(root, manifest, selection.assetRef, selection.member)
    if (!/\.(ttf|otf|woff2?)$/i.test(font.path)) throw Error('Selected member is not a supported font file')
    const codes = await fontCodePoints(font.bytes, (await sharedFont()).moduleUrl)
    if ([...node.text].some(char => !codes.has(char.codePointAt(0)!))) throw Error('Selected registered font lacks saved text glyphs; fallback cannot certify font consumption')
    const source = await readVersion(root, probe.document), packed = await readVersion(root, task.runtimeArtifact+'/'+probe.document)
    const resource = await readVersion(root, font.path), packedFont = await readVersion(root, task.runtimeArtifact+'/'+font.path)
    result.inputs.push(source, packed, resource, packedFont)
    if (source.sha256 !== packed.sha256 || resource.sha256 !== packedFont.sha256) throw Error('Packed UI/font differs from current source')
    const measure = (value: typeof data) => {
      const nodes = resolveUiNodesForViewport(value.nodes, value.rootId, { width: probe.viewport[0], height: probe.viewport[1] })
      const byId = new Map(nodes.map(n => [n.id, n])), target = byId.get(probe.nodeId)!
      let current: typeof target | undefined = target, fontSize: unknown
      const seen = new Set<string>()
      while (current) {
        if (seen.has(current.id)) throw Error('UI hierarchy cycle')
        seen.add(current.id)
        if (current.enabled === false) throw Error('Font text is inactive at this viewport')
        fontSize ??= current.style?.fontSize
        current = current.parentId ? byId.get(current.parentId) : undefined
      }
      if (typeof fontSize !== 'number' || !Number.isFinite(fontSize) || fontSize <= 0) throw Error('Explicit inherited fontSize required for font consumption')
      return { text: target.text!, fontSize }
    }
    const before = measure(data), variants: PreparedFontProbe['variants'] = []
    for (const property of ['text', 'font-size'] as const) {
      const changed = structuredClone(doc)
      if (!('rootId' in changed.data)) throw Error('UI source required')
      const changedData = changed.data
      const target = changedData.nodes.find(n => n.id === probe.nodeId)!
      if (property === 'text') target.text = node.text+node.text
      else {
        // Set the effective authored override at this viewport, not a base
        // property that the saved responsive rules would immediately override.
        const rootNode = changedData.nodes.find(n => n.id === changedData.rootId)!
        const compact = probe.viewport[0] <= uiCompactMaxWidth(rootNode)
        const override = probe.viewport[1] > probe.viewport[0] && target.responsive?.portrait?.style?.fontSize !== undefined ? target.responsive.portrait
          : compact && target.responsive?.compact?.style?.fontSize !== undefined ? target.responsive.compact : target
        override.style = { ...override.style, fontSize: before.fontSize+7 }
      }
      variants.push({ property, replacement: JSON.stringify(changed), expected: measure(changed.data) })
    }
    prepared.push({ ...probe, mode: 'font', originalSha256: source.sha256, resource, before, variants })
  }
  if (!prepared.length) throw Error('No font-bound static DOM text to observe')
  return prepared
}
