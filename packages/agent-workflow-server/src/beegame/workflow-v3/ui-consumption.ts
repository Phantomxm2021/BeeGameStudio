import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { inspectUiLayout, isUiControl } from '../../../../scene-editor/src/ui-layout-inspection'
import { initializeUiLayout } from '../../../../scene-editor/src/ui-container-layout'
import { resolveUiNodesForViewport, uiCompactMaxWidth } from '../../../../scene-editor/src/ui-responsive'
import { contentIndexSchema, contentDocumentSchema, type BeeGameContentDocument } from '../game-content-schema'
import { readVersion } from './checks'
import { digest, type CheckResult, type TaskSpec } from './state'

export type PreparedUiProbe = { document: string; nodeId: string; selector: string; viewport: [number, number]; deviceScaleFactor?: number; steps?: { click: string }[];
  coordinateRoot?: string; layoutViewport?: [number, number];
  checkTextFit: boolean;
  minimumControlSize?: [number, number];
  composition: { nodes: { id: string; selector?: string; bounds: PreparedUiProbe['before']; fontSize?: number; minimumControlSize?: [number, number] }[];
    unverified: { id: string; reason: string }[] };
  hasTouch?: boolean;
  unobservedProperties: { property: 'position' | 'size' | 'sizeDelta'; reason: string }[];
  originalSha256: string; before: { left: number; top: number; right: number; bottom: number };
  disabledSource: string;
  variants: { property: 'position' | 'size' | 'sizeDelta'; replacement: string; expected: { left: number; top: number; right: number; bottom: number } }[] }

/** Derive expected geometry from saved source, never an Agent's expected/PASS.
 * UI/DOM geometry, enabled visibility and text fit only. Scene, pixels, resources and audio require
 * other observations; rendering the host preview is not a substitute. */
export async function prepareUiProbes(root: string, task: Pick<TaskSpec, 'uiProbes'|'runtimeArtifact'>, result: CheckResult,
  scope: 'registered'|'selected' = 'registered', requiredViewport?: [number, number]): Promise<PreparedUiProbe[]> {
  // Artifact inventory is not observed UI coverage, especially on preparation failure.
  result.coverage = { files: [], limitations: ['No runtime UI observations yet; source preparation is not consumption proof.'] }
  if (!task.uiProbes?.length) throw new Error('Declare actual target UI selectors, viewports and optional click paths in uiProbes')
  // Reuse the actual selected target/click path at the host-required phone size.
  // Author-authored targetViewports cannot remove this observation.
  if (requiredViewport) task = {...task, uiProbes: [...task.uiProbes, ...task.uiProbes
    .filter(probe => !task.uiProbes!.some(other => other.document === probe.document && other.nodeId === probe.nodeId &&
      other.selector === probe.selector && JSON.stringify(other.steps) === JSON.stringify(probe.steps) &&
      other.viewport[0] === requiredViewport[0] && other.viewport[1] === requiredViewport[1]))
    .filter((probe, index, all) => all.findIndex(other => other.document === probe.document && other.nodeId === probe.nodeId &&
      other.selector === probe.selector && JSON.stringify(other.steps) === JSON.stringify(probe.steps)) === index)
    .map(probe => ({...probe, viewport: requiredViewport}))]}
  await initializeUiLayout()
  result.inputs.push(await readVersion(root, 'content/index.json'))
  const index = contentIndexSchema.parse(JSON.parse(await readFile(resolve(root, 'content/index.json'), 'utf8')))
  const registered = index.documents?.filter(doc => doc.kind.startsWith('ui-')) ?? []
  if (!registered.length) throw new Error('No registered UI source; this driver cannot establish UI data consumption')
  // Autonomous probes may inspect one state. Retain missing screens as actual
  // coverage facts rather than manufacturing a whole-game PASS.
  const unobserved = new Set(registered.filter(doc => !task.uiProbes!.some(probe => probe.document === 'content/'+doc.path))
    .map(doc => 'content/'+doc.path))
  // Preserve the existing full-registry Task contract; autonomous measurement
  // explicitly asks for selected probes and reports its missing coverage.
  if(scope==='registered' && unobserved.size)throw new Error('uiProbes omit registered UI documents; missing screens are unverified: '+[...unobserved].join(', '))
  const probes: PreparedUiProbe[] = []
  for (const probe of task.uiProbes!) {
    let property = 'source'
    try {
      const entry = registered.find(doc => probe.document === 'content/'+doc.path)
      if (!entry) throw new Error('Probe is not a registered UI source: '+probe.document)
      property = 'packedSource'
      const source = await readVersion(root, probe.document), packed = await readVersion(root, task.runtimeArtifact+'/'+probe.document)
      result.inputs.push(source, packed)
      if (source.sha256 !== packed.sha256) throw new Error('Packed UI differs from current source: '+probe.document)
      property = 'sourceSchema'
      const body = await readFile(resolve(root, probe.document), 'utf8'), doc = contentDocumentSchema.parse(JSON.parse(body))
      if (!doc.kind.startsWith('ui-') || doc.id !== entry.id) throw new Error('UI source identity differs from registry')
      // Schema discrimination via the existing UI family, not a second schema.
      if (!('rootId' in doc.data)) throw new Error('Unsupported UI document')
      const data = doc.data as Extract<BeeGameContentDocument, { kind: 'ui-screen' | 'ui-hud' | 'ui-flow' }>['data']
      const requiredViewports = data.nodes.find(node=>node.id===data.rootId)?.data?.targetViewports
      property = 'targetViewports'
      if (Array.isArray(requiredViewports)) for (const view of requiredViewports) {
        if(!Array.isArray(view) || view.length!==2)throw new Error('Invalid authored UI target viewport: '+probe.document)
        if (Array.isArray(view) && view.length===2 && !task.uiProbes!.some(candidate=>candidate.document===probe.document &&
            candidate.viewport[0]===view[0] && candidate.viewport[1]===view[1])) {
          if(scope==='registered')throw new Error('uiProbes omit authored target viewports: '+view.join('x'))
          unobserved.add(probe.document+' @ '+view.join('x'))
        }
      }
      property = 'node'
      const node = data.nodes.find(node => node.id === probe.nodeId)
      if (!node) throw new Error('Unknown authored UI node')
      if (node.id === data.rootId) throw new Error('Root fills the viewport; choose a non-root node for saved-layout causality')
      let minimumControlSize: [number, number] | undefined
      if (isUiControl(node)) {
        property = 'minimumControlSize'
        const minimum = data.nodes.find(node => node.id === data.rootId)?.data?.minimumControlSize
        if (!Array.isArray(minimum) || minimum.length !== 2 || !minimum.every(v => typeof v === 'number' && Number.isFinite(v) && v > 0))
          throw new Error('Control needs declared minimumControlSize in final CSS pixels; missing size is unverified')
        minimumControlSize = minimum as [number, number]
      }
      // A fixed logical surface may be scaled/letterboxed in a different
      // window. Expected geometry always comes from saved source, never from
      // the observed target node or an Agent-supplied expected box.
      let layoutViewport: [number, number] | undefined
      if (probe.coordinateRoot) {
        property = 'coordinateRoot'
        const rootNode = data.nodes.find(node=>node.id===data.rootId)!
        const size = rootNode.data?.referenceResolution ?? rootNode.layout?.size
        if (!Array.isArray(size) || size.length!==2 || !size.every(v=>typeof v==='number' && Number.isFinite(v) && v>0 && v<=8192))
          throw new Error('coordinateRoot requires a saved positive referenceResolution or root layout.size')
        if (rootNode.layout?.size && rootNode.layout.size.some((v,i)=>v!==size[i]))
          throw new Error('Saved root layout.size differs from referenceResolution; coordinateRoot is unverified')
        layoutViewport = [size[0] as number,size[1] as number]
        const rootRect = inspectUiLayout(data.nodes,data.rootId,{width:layoutViewport[0],height:layoutViewport[1]}).find(rect=>rect.id===data.rootId)
        if (!rootRect?.active || Math.abs(rootRect.bounds.left)>0.01 || Math.abs(rootRect.bounds.top)>0.01 ||
            Math.abs(rootRect.bounds.right-layoutViewport[0])>0.01 || Math.abs(rootRect.bounds.bottom-layoutViewport[1])>0.01)
          throw new Error('Saved logical root must have origin 0,0 and the declared reference dimensions')
      }
      const viewport = { width: layoutViewport?.[0] ?? probe.viewport[0], height: layoutViewport?.[1] ?? probe.viewport[1] }
      const measure = (value: typeof data) => inspectUiLayout(value.nodes, value.rootId, viewport).find(rect => rect.id === probe.nodeId)
      property = 'layout'
      const before = measure(data)
      if (!before?.active || before.bounds.right <= before.bounds.left || before.bounds.bottom <= before.bounds.top)
        throw new Error('Saved UI node is inactive or collapsed at this viewport. Click steps change the runtime DOM, not saved-layout eligibility; choose a saved-active node for this geometry probe and verify dynamic-only states with an interaction test. Consumption is unverified')
      // The shared inspector above validates the hierarchy before this walk.
      // State bindings override authored defaults; this static probe cannot
      // mutate a lower-priority default and infer the game's dynamic state.
      let ancestor: typeof node | undefined = node
      while (ancestor) {
        if (ancestor.bindings?.enabled)
          throw new Error('State-bound enabled visibility needs an interaction observation; changing the authored default cannot verify it')
        const parentId: string | undefined = ancestor.parentId
        ancestor = parentId ? data.nodes.find(value => value.id === parentId) : undefined
      }
      const variants: PreparedUiProbe['variants'] = []
      const unobservedProperties: PreparedUiProbe['unobservedProperties'] = []
      // Stretch anchors own dimensions through sizeDelta, not layout.size. Flow
      // may own position. Let the existing resolver establish which perturbations
      // can be observed; never change source structure to make a probe pass.
      const dimension = node.layout?.anchorMin ? 'sizeDelta' : 'size'
      for (const candidate of ['position', dimension] as const) {
        property = 'layout.'+candidate
        if (candidate === 'size' && !node.layout?.size) {
          unobservedProperties.push({property:candidate,reason:'No authored layout.size; intrinsic sizing is outside this geometry probe'})
          continue
        }
        const changed = structuredClone(doc), changedData = changed.data as typeof data
        const target = changedData.nodes.find(node=>node.id===probe.nodeId)!
        target.layout ??= {}
        const value = target.layout[candidate] ?? [0,0]
        target.layout[candidate] = [value[0]+(candidate==='position'?13:16),value[1]+(candidate==='position'?7:8)]
        const after = measure(changedData)
        const a = before.bounds, b = after?.bounds
        if (!after?.active || !b || Math.max(Math.abs(a.left-b.left),Math.abs(a.right-b.right),Math.abs(a.top-b.top),Math.abs(a.bottom-b.bottom)) <= 2) {
          unobservedProperties.push({property:candidate,reason:'Resolved layout overrides this perturbation or change is below observation tolerance'})
          continue
        }
        variants.push({ property:candidate, replacement: JSON.stringify(changed), expected: b })
      }
      const disabled = structuredClone(doc), disabledData = disabled.data as typeof data
      const disabledNode = disabledData.nodes.find(node => node.id === probe.nodeId)!
      const rootNode = data.nodes.find(node => node.id === data.rootId)
      const effectiveOverride = viewport.height > viewport.width && disabledNode.responsive?.portrait?.enabled !== undefined
        ? disabledNode.responsive.portrait
        : viewport.width <= uiCompactMaxWidth(rootNode) && disabledNode.responsive?.compact?.enabled !== undefined
          ? disabledNode.responsive.compact : undefined
      if (effectiveOverride) effectiveOverride.enabled = false
      else disabledNode.enabled = false
      // Derive the composition from this saved document, not another list of
      // Agent-selected nodes. Dynamic visibility/layout needs actual state;
      // do not infer that state from a visible DOM box and call it verified.
      const composition: PreparedUiProbe['composition'] = { nodes: [], unverified: [] }
      const byId = new Map(data.nodes.map(node => [node.id, node]))
      const projected = new Map(resolveUiNodesForViewport(data.nodes, data.rootId, viewport).map(node => [node.id, node]))
      const minimum = byId.get(data.rootId)?.data?.minimumControlSize
      const dynamicRoots = new Set<string>()
      for (const node of data.nodes) if (node.bindings && Object.keys(node.bindings).some(key => key !== 'text' && key !== 'styleColor')) {
        dynamicRoots.add(node.id)
        // Visibility/width of a flex child also changes its siblings' allocation.
        let parent = node.parentId ? byId.get(node.parentId) : undefined
        while (parent) {
          if (projected.get(parent.id)?.layout?.container) dynamicRoots.add(parent.id)
          parent = parent.parentId ? byId.get(parent.parentId) : undefined
        }
      }
      for (const rect of inspectUiLayout(data.nodes, data.rootId, viewport)) {
        if (rect.id === data.rootId) continue
        const candidate = byId.get(rect.id)!
        let current: typeof candidate | undefined = candidate, dynamic = false
        while (current) {
          if (dynamicRoots.has(current.id)) dynamic = true
          current = current.parentId ? byId.get(current.parentId) : undefined
        }
        if (dynamic) { composition.unverified.push({ id: rect.id, reason: 'State-dependent visibility or geometry needs an interaction observation' }); continue }
        if (!rect.active) continue
        if (rect.bounds.right <= rect.bounds.left || rect.bounds.bottom <= rect.bounds.top) {
          composition.unverified.push({ id: rect.id, reason: 'No positive saved geometry for this state' }); continue
        }
        const mapped = task.uiProbes!.find(other => other.document === probe.document && other.nodeId === rect.id &&
          other.viewport[0] === probe.viewport[0] && other.viewport[1] === probe.viewport[1] && JSON.stringify(other.steps) === JSON.stringify(probe.steps))
        composition.nodes.push({ id: rect.id, ...(mapped ? { selector: mapped.selector } : {}), bounds: rect.bounds,
          ...(typeof projected.get(rect.id)?.style?.fontSize === 'number' ? { fontSize: projected.get(rect.id)!.style!.fontSize as number } : {}),
          ...(isUiControl(candidate) && Array.isArray(minimum) && minimum.length === 2 ? { minimumControlSize: minimum as [number, number] } : {}) })
      }
      probes.push({ ...probe, ...(layoutViewport?{layoutViewport}:{}), minimumControlSize, disabledSource: JSON.stringify(disabled),
        hasTouch: Boolean(requiredViewport && probe.viewport[0] === requiredViewport[0] && probe.viewport[1] === requiredViewport[1]),
        checkTextFit: node.role==='text' || node.role==='button', composition, unobservedProperties, originalSha256: digest(body), before: before.bounds, variants })
    } catch (error) {
      throw new Error('UI probe '+probe.document+'#'+probe.nodeId+' @ '+probe.viewport.join('x')+' ['+property+']: '+
        (error instanceof Error ? error.message : 'Preparation failed'))
    }
  }
  result.coverage = {files:[...new Set(probes.map(probe=>probe.document))],limitations:[
    'Selected registered DOM node geometry, enabled visibility and visible text fit at supplied viewports/click paths only; not all fields, nodes, states, sibling occlusion, aesthetics or Canvas/Scene/resource/audio consumption. Custom gameplay parameters remain unverified.',
    'Text clipping/pseudo-content cannot establish complete text fit; source geometry and runtime observations do not prove gameplay or design semantics.',
    'Declared control minima are checked against transformed CSS bounds, never inverse-scaled logical dimensions. Unselected controls remain unverified.',
    'Baseline/restoration also compare all saved-active state-independent nodes carrying unique data-node-id markers in this composition. Missing markers and dynamic branches remain explicitly unverified; this is not visual-style or all-state acceptance.',
    ...(requiredViewport ? ['Host-required Web Touch phone viewport: '+requiredViewport.join('x')+'; representative coverage, not every mobile device.'] : []),
    ...(probes.some(probe=>probe.coordinateRoot)?['coordinateRoot maps fixed saved logical dimensions through an independently observed stable axis-aligned DOM root. Root scale/translation is observed, not acceptance of the intended whole-frame adaptation; rotation, perspective, border/padding and changing roots remain unverified.']:[]),
    ...probes.map(probe=>'Selected '+probe.document+'#'+probe.nodeId+' @ '+probe.viewport.join('x')+
      '; requested DPR: '+(probe.deviceScaleFactor??1)+' (other pixel densities untested)'+
      '; coordinate space: '+(probe.coordinateRoot?'saved logical '+probe.layoutViewport!.join('x')+' via independent DOM root '+probe.coordinateRoot:'window CSS pixels')+
      '; observable properties: '+[...probe.variants.map(v=>v.property), 'enabled'].join(', ')+
      '; visible text fit: '+(probe.checkTextFit?'targeted; actual result in observation':'not checked for this node role')+
      (probe.unobservedProperties.length?'; unobserved: '+probe.unobservedProperties.map(v=>v.property+' ('+v.reason+')').join(', '):'')),
    ...(unobserved.size?['Unobserved registered screens/viewports (not a PASS): '+[...unobserved].join(', ')]:[]),
  ]}
  return probes
}
