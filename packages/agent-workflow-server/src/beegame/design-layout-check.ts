import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { inspectUiLayout, isUiControl, rectanglesIntersect } from '../../../scene-editor/src/ui-layout-inspection'
import { parseBeeGameContentDocument } from './game-content-schema'
import { auditUiInteractiveBounds, isViewportPair, readUiLayoutCameras, requiredTouchViewport, type LayoutConstraints, type UiDocument, type LayoutDiagnostic, type LayoutMeasurement } from './ui-layout-audit'
import { designSupportingFiles } from './design-handoff'
import { sceneCameraInput2d } from '../../../scene-editor/src/scene-layout-inspection'
import { sceneLayoutDraftIssues, contentDraftStructureIssues } from './game-content-package'

/** One shared calculator for the same UI files during design and Content.
 * Neither boundary trusts an Agent-supplied geometry PASS. */
export function checkDesignLayouts(workspacePath: string, confirmed?: LayoutConstraints, deferTileSets = false, details = false, paths?: readonly string[]) {
  const directory = 'content/ui'
  const issues: string[] = []
  const deferred: string[] = []
  const files: string[] = []
  const documents = new Map<string, UiDocument>()
  const compositions: { file: string; underlay: string; clearance: string }[] = []
  const targetsChecked: Array<{ source: string; viewports: unknown[] }> = []
  const unverified = ['Actual font fit, rendered appearance, runtime composition and prose coverage are not certified.']
  const diagnostics: Array<LayoutDiagnostic & { source: string; owner: 'UI_UX_SPEC.md' }> = []
  const measurements: Array<LayoutMeasurement & { source: string; scene?: string }> = []
  const workspace = realpathSync(workspacePath)
  const xr = confirmed?.dimension === 'VR' || confirmed?.dimension === 'AR'
  const collect = (directory: string) => {
    const canonical = realpathSync(directory)
    const rel = relative(workspace, canonical)
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('UI layout directory is outside the project workspace')
    for (const entry of readdirSync(canonical, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('UI layout inputs must not be symbolic links')
      const path = join(canonical, entry.name)
      if (entry.isDirectory()) collect(path)
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push(path)
    }
  }
  try {
    if (paths) for (const file of [...new Set(paths)]) {
      if (!file.startsWith('content/ui/') || !file.endsWith('.json') || file.includes('\\') || file.split('/').some(p => p === '..' || p === '.'))
        throw new Error('Expected explicit content/ui JSON paths')
      const target = resolve(workspace, file), canonical = realpathSync(target)
      if (canonical !== target) throw new Error('UI layout inputs must not be symbolic links')
      files.push(target)
    } else collect(join(workspace, directory))
  }
  catch (error) {
    if (xr && (error as NodeJS.ErrnoException).code === 'ENOENT') return { valid: !issues.length, issues, files: [], deferred, diagnostics, compositions,
      ...(details ? { measurements } : {}),
      coverage: { targets: targetsChecked, unverified: ['XR world-space UI requires Scene/runtime verification; screen checks did not run.'] } }
    issues.push(`UI layout inputs in ${directory} are unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!files.length && !xr) issues.push(`Save the UI layout inputs in ${directory} before geometry handoff.`)
  for (const path of files.sort()) {
    const name = relative(workspace, path).split(sep).join('/')
    try {
      const document = parseBeeGameContentDocument(JSON.parse(readFileSync(path, 'utf8')))
      if (document.kind !== 'ui-screen' && document.kind !== 'ui-hud' && document.kind !== 'ui-flow')
        throw new Error(`${directory} must contain UI documents`)
      if (document.kind === 'ui-flow') { unverified.push(`${name}: navigation-only input; no screen geometry checked.`); continue }
      documents.set(name, document)
      const root = document.data.nodes.find(node => node.id === document.data.rootId)
      if (!root) throw new Error('UI root is missing')
      if (document.data.nodes.some(node => node.id !== root.id && node.data?.layoutUnderlay !== undefined))
        throw new Error('layoutUnderlay belongs on the composition root')
      if (root.data?.space === 'world') {
        if (!xr) throw new Error('World-space UI needs Scene/runtime verification; it cannot substitute for the screen layout check')
        unverified.push(`${name}: world-space UI geometry requires Scene/XR runtime verification; no screen geometry checked.`)
        continue
      }
      const orientation = root.data?.orientation
      if (orientation !== 'Landscape' && orientation !== 'Portrait') throw new Error('root.data.orientation must declare Landscape or Portrait')
      if (confirmed?.orientation && orientation !== confirmed.orientation) throw new Error('Layout orientation differs from the confirmed brief')
      const targets = root.data?.targetViewports
      if (!Array.isArray(targets) || !targets.length || !targets.every(isViewportPair))
        throw new Error('root.data.targetViewports must be a non-empty array of positive [width, height] pairs, for example [[960, 540]], not {width, height} objects. Choose the smallest supported size and relevant transition sizes for this composition.')
      // Extend only the parsed inspection copy, never saved project data. This
      // also feeds the existing camera/underlay inspectors at the same size.
      const phone = requiredTouchViewport(confirmed)
      if (phone && !targets.some(size => size[0] === phone[0] && size[1] === phone[1])) targets.push(phone)
      const reference = root.data?.referenceResolution ?? root.layout?.size
      targetsChecked.push({ source: name, viewports: [reference, ...targets] })
      for (const size of [reference, ...targets]) {
        if (!isViewportPair(size)) throw new Error('Layout reference and targets must be positive [width, height] pairs')
        if (orientation === 'Landscape' ? size[0] < size[1] : size[1] <= size[0])
          throw new Error('Layout targets include an unsupported orientation; remove that adaptation requirement')
      }
      if (document.data.nodes.some(isUiControl) && !isViewportPair(root.data?.minimumControlSize))
        throw new Error('Declare the agreed host-pixel minimumControlSize in root.data for control checks')
      for (const options of readUiLayoutCameras(workspace, document)) {
        const pending: string[] = []
        const problems: LayoutDiagnostic[] = [], measured: LayoutMeasurement[] | undefined = details ? [] : undefined
        const source = options.scenePath ? ` Scene ${options.scenePath}` : ''
        const bounds = auditUiInteractiveBounds(document, options, { deferTileSets, deferred: pending, diagnostics: problems, measurements: measured })
        diagnostics.push(...problems.map(item => ({ ...item, source: name, ...(options.scenePath ? { scene: options.scenePath } : {}), owner: 'UI_UX_SPEC.md' as const })))
        measurements.push(...(measured ?? []).map(item => ({ ...item, source: name, scene: options.scenePath })))
        issues.push(...bounds.map(issue => `${name}:${source} ${issue}`))
        deferred.push(...pending.map(issue => `${name}:${source} ${issue}`))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      issues.push(`${name}: ${message}`)
      diagnostics.push({ source: name, owner: 'UI_UX_SPEC.md', kind: 'input-invalid', message })
    }
  }
  // A file alone cannot establish clearance against a retained layer in another
  // file. Use an explicit source link, not filename heuristics or copied bounds.
  // Geometry and rectangle intersection remain the Editor's implementations.
  const geometry = new Map<string, ReturnType<typeof inspectUiLayout>>()
  const rootOf = (doc: UiDocument) => doc.data.nodes.find(node => node.id === doc.data.rootId)!
  const layer = (file: string) => {
    const doc = documents.get(file)
    if (!doc || rootOf(doc)?.data?.space === 'world') throw new Error('Underlay must link a saved screen-space UI composition: ' + file)
    return doc
  }
  const underlayOf = (file: string) => {
    const link = rootOf(layer(file)).data?.layoutUnderlay as { path: string; clearance: 'preserve' | 'allow-cover' } | undefined
    if (!link) return
    if (isAbsolute(link.path) || link.path.replaceAll('\\', '/').split('/').includes('..')) throw new Error('Underlay path must be workspace-relative without traversal')
    const target = relative(workspace, resolve(workspace, link.path)).split(sep).join('/')
    layer(target) // Only collected, schema-valid UI files; no symlink/outside reads.
    if (rootOf(layer(file)).data?.orientation !== rootOf(layer(target)).data?.orientation)
      throw new Error('Overlay and underlay orientations differ')
    return { file: target, clearance: link.clearance }
  }
  const cameraOptions = (file: string) => readUiLayoutCameras(workspace, layer(file))
  const sceneOf = (option: ReturnType<typeof cameraOptions>[number]) => option.scenePath
    ? realpathSync(resolve(workspace, option.scenePath)) : undefined
  const scenesFor = (file: string, chain: string[] = []): (string | undefined)[] => {
    if (chain.includes(file)) throw new Error('UI underlay cycle: ' + [...chain, file].join(' → '))
    const scenes = cameraOptions(file).map(sceneOf).filter((scene): scene is string => scene !== undefined)
    if (scenes.length) return [...new Set(scenes)]
    const below = underlayOf(file)
    return below ? scenesFor(below.file, [...chain, file]) : [undefined]
  }
  const nodesAt = (file: string, size: [number, number], scene: string | undefined) => {
    const key = JSON.stringify([file, size, scene])
    if (!geometry.has(key)) {
      const doc = layer(file)
      // Unlinked screen-only layers apply to every Scene. Camera-linked layers
      // must use that same Scene, never coordinates from a different variant.
      const options = cameraOptions(file).filter(option => sceneOf(option) === scene || sceneOf(option) === undefined)
      if (!options.length) throw new Error(`Linked composition ${file} has no camera for Scene ${scene}`)
      geometry.set(key, options.flatMap(options => inspectUiLayout(doc.data.nodes, doc.data.rootId,
        { width: size[0], height: size[1] }, options)))
    }
    return geometry.get(key)!
  }
  const retained = (file: string, size: [number, number], chain: string[], scene: string | undefined): { file: string; node: ReturnType<typeof inspectUiLayout>[number] }[] => {
    if (chain.includes(file)) throw new Error('UI underlay cycle: ' + [...chain, file].join(' → '))
    const link = underlayOf(file)
    const own = nodesAt(file, size, scene).filter(node => node.active && node.layoutOcclusion === 'protected').map(node => ({ file, node }))
    // Validate the whole link chain even when this state permits covering it.
    const below = link ? retained(link.file, size, [...chain, file], scene) : []
    return link?.clearance === 'preserve' ? [...below, ...own] : own
  }
  for (const [file, doc] of documents) try {
    const link = underlayOf(file)
    if (!link) continue
    compositions.push({ file, underlay: link.file, clearance: link.clearance })
    const root = rootOf(doc)
    const targets = [root.data?.referenceResolution ?? root.layout?.size, ...(root.data?.targetViewports as unknown[] ?? [])]
    for (const scene of scenesFor(file)) for (const size of [...new Map(targets.filter(isViewportPair).map(size => [size.join('x'), size])).values()]) {
      const below = retained(link.file, size, [file], scene)
      const sceneLabel = scene ? ` Scene ${relative(workspace, scene)}` : ''
      if (link.clearance === 'allow-cover') continue
      if (!below.length) throw new Error('Preserved underlay has no active declared protected region')
      for (const region of below) if (region.node.outsideViewport || region.node.outsideCameraView) {
        const message = `${size.join('x')} preserved ${region.file}#${region.node.id} exceeds its viewport/Camera.`
        issues.push(`${file}:${sceneLabel} ${message}`)
        diagnostics.push({ source: file, owner: 'UI_UX_SPEC.md', scene, node: region.node.id, viewport: size,
          kind: 'underlay-bounds', message, closeWhen: 'Keep the protected underlay visible in this composition.',
          geometry: { space: 'host logical pixels', underlay: region.file, bounds: region.node.bounds, corners: region.node.corners } })
      }
      const occluders = nodesAt(file, size, scene).filter(node => node.active && node.layoutOcclusion === 'occluder')
      if (!occluders.length) throw new Error('Preserved underlay clearance needs declared active occluders in this overlay; an unmarked layer is not clearance evidence')
      for (const protectedRegion of below) for (const occluder of occluders)
        if (rectanglesIntersect(protectedRegion.node.corners, occluder.corners)) {
          const message = `${size.join('x')} occluder ${occluder.id} intersects preserved ${protectedRegion.file}#${protectedRegion.node.id}.`
          issues.push(`${file}:${sceneLabel} ${message}`)
          diagnostics.push({ source: file, owner: 'UI_UX_SPEC.md', scene, node: occluder.id, viewport: size,
            kind: 'underlay-occlusion', message, closeWhen: 'Remove the intersection without changing the agreed preserve policy.',
            geometry: { space: 'host logical pixels', bounds: occluder.bounds, corners: occluder.corners,
              protectedRegion: { source: protectedRegion.file, node: protectedRegion.node.id,
                bounds: protectedRegion.node.bounds, corners: protectedRegion.node.corners } } })
        }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    issues.push(`${file}: ${message}`)
    diagnostics.push({ source: file, owner: 'UI_UX_SPEC.md', kind: 'composition-invalid', message,
      closeWhen: 'Correct the composition input and rerun; clearance was not verified.' })
  }
  return { valid: !issues.length, issues: [...new Set(issues)], diagnostics, deferred: [...new Set(deferred)], files: files.map(path => relative(workspace, path).split(sep).join('/')), compositions,
    ...(details ? { measurements } : {}),
    coverage: { targets: targetsChecked, unverified: [...unverified, ...deferred] },
    note: 'Checks each saved file and explicitly linked layoutUnderlay compositions with declared clearance/occluders. Unlinked layers, omitted markers and agreement with prose are not established; Review must inspect their actual coverage. Not runtime or visual verification.' }
}

/** The prose owns coverage/meaning; one linked UI source owns computed geometry.
 * Links also put these files in the existing revision and version/hash scope. */
export function checkReviewUiLayouts(workspace: string, confirmed?: LayoutConstraints, deferTileSets = true, details = false) {
  const check = checkDesignLayouts(workspace, confirmed, deferTileSets, details)
  const issues = [...check.issues]
  const savedFiles = new Set<string>(check.files)
  let expected: string[] = []
  try {
    expected = designSupportingFiles(workspace, ['UI_UX_SPEC.md']).filter(file => file.startsWith('content/ui/'))
    const linked = new Set(expected)
    for (const file of expected) if (!savedFiles.has(file))
      issues.push(`${file}: required owner-linked UI source is missing from the saved batch.`)
    const ids = new Set<string>()
    let compositions = 0
    for (const file of check.files) {
      try {
        const doc = parseBeeGameContentDocument(JSON.parse(readFileSync(join(workspace, file), 'utf8')))
        issues.push(...contentDraftStructureIssues(file, doc))
        if (doc.kind === 'ui-flow') continue
        compositions++
        if (!linked.has(file)) issues.push(`${file}: link this layout from its owning docs/UI_UX_SPEC.md section before Review, e.g. [layout](../${file}). Markdown links resolve relative to docs/, so content/... alone points to docs/content/... rather than the saved source.`)
        if (ids.has(doc.id)) issues.push(`${file}: duplicate reviewed UI composition id ${doc.id}; use distinct ids for different compositions.`)
        ids.add(doc.id)
      } catch { /* Invalid inputs are already reported by the geometry check. */ }
    }
    if (!compositions && confirmed?.dimension !== 'VR' && confirmed?.dimension !== 'AR')
      issues.push('UI Review needs ui-screen/ui-hud compositions; navigation-only ui-flow cannot establish layout geometry.')
  } catch (error) { issues.push(String(error instanceof Error ? error.message : error)) }
  return { ...check, valid: !issues.length, issues: issues.map(issue => `UI_UX_SPEC.md: ${issue}`),
    coverage: { ...check.coverage, expected, missing: expected.filter(file => !savedFiles.has(file)),
      undeclared: check.files.filter(file => !expected.includes(file)) } }
}

/** Scene drafts use the existing schema and Camera selector, without requiring
 * produced assets or an index. Actual framing is checked in the linked UI's
 * allocated game-view, not against a guessed full-window viewport. */
export function checkReviewSceneLayouts(workspace: string) {
  const issues: string[] = [], files: string[] = []
  try {
    files.push(...designSupportingFiles(workspace, ['LEVEL_SCENE_DESIGN.md'])
      .filter(path => path.startsWith('content/scenes/')))
    if (!files.length) issues.push('Link the planned Scene JSON from its owning docs/LEVEL_SCENE_DESIGN.md section before Review, e.g. [scene](../content/scenes/<file>.json). Markdown links resolve relative to docs/, not the workspace root.')
    const ids = new Set<string>()
    for (const file of files) try {
      const doc = parseBeeGameContentDocument(JSON.parse(readFileSync(join(workspace, file), 'utf8')))
      if (doc.kind !== 'scene-2d' && doc.kind !== 'scene-3d') throw new Error('Expected a Scene document')
      if (ids.has(doc.id)) throw new Error('Duplicate reviewed Scene id ' + doc.id)
      ids.add(doc.id)
      issues.push(...sceneLayoutDraftIssues(file, doc))
      if (doc.kind === 'scene-2d') sceneCameraInput2d(doc.data)
    } catch (error) { issues.push(`${file}: ${error instanceof Error ? error.message : String(error)}`) }
  } catch (error) { issues.push(error instanceof Error ? error.message : String(error)) }
  return { valid: !issues.length, files, issues: issues.map(issue => `LEVEL_SCENE_DESIGN.md: ${issue}`),
    note: 'Scene schema, identity, hierarchy and authored Camera selection only. 2D required visibility uses linked UI game-view targets; dynamic traversal, 3D/XR framing and resource-dependent bounds need later checks.' }
}

export function checkReviewDesignLayouts(workspace: string, confirmed?: LayoutConstraints, deferTileSets = true, details = false) {
  const ui = checkReviewUiLayouts(workspace, confirmed, deferTileSets, details), scene = checkReviewSceneLayouts(workspace)
  const issues = [...ui.issues, ...scene.issues]
  const connected = new Set<string>()
  for (const file of ui.files) try {
    const doc = parseBeeGameContentDocument(JSON.parse(readFileSync(join(workspace, file), 'utf8')))
    if (doc.kind !== 'ui-screen' && doc.kind !== 'ui-hud') continue
    const root = doc.data.nodes.find(node => node.id === doc.data.rootId)
    if (root?.data?.space === 'world') continue
    const links = Array.isArray(root?.data?.layoutCamera) ? root.data.layoutCamera : [root?.data?.layoutCamera]
    for (const link of links as Array<{ path?: unknown } | undefined>)
      if (typeof link?.path === 'string') connected.add(relative(workspace, resolve(workspace, link.path)).split(sep).join('/'))
  } catch { /* Already diagnosed above. */ }
  for (const file of scene.files) try {
    const doc = parseBeeGameContentDocument(JSON.parse(readFileSync(join(workspace, file), 'utf8')))
    if (doc.kind === 'scene-2d' && doc.data.settings?.requiredVisibleNodeIds !== undefined && !connected.has(file))
      issues.push(`UI_UX_SPEC.md: ${file}: required Scene visibility needs a layoutCamera link to this same Scene in an active UI game-view; standalone camera data is not visibility evidence.`)
  } catch { /* Already diagnosed above. */ }
  return { ...ui, valid: !issues.length, issues, files: [...scene.files, ...ui.files], sceneNote: scene.note,
    inputs: { confirmed: confirmed ?? {}, deferTileSets },
    reuse: 'Computed from current saved sources. Design revision alone does not cover resource bindings; recompute after relevant source/resource/option changes.' }
}
