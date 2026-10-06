import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { inspectUiLayout, isUiControl, rectanglesIntersect } from '../../../scene-editor/src/ui-layout-inspection'
import { parseBeeGameContentDocument } from './game-content-schema'
import { auditUiInteractiveBounds, isViewportPair, readUiLayoutCamera, type UiDocument } from './ui-layout-audit'
import { designSupportingFiles } from './design-handoff'

/** One shared calculator for the same UI files during design and Content.
 * Neither boundary trusts an Agent-supplied geometry PASS. */
export function checkDesignLayouts(workspacePath: string, confirmed?: { orientation?: unknown; dimension?: unknown }) {
  const directory = 'content/ui'
  const issues: string[] = []
  const files: string[] = []
  const documents = new Map<string, UiDocument>()
  const compositions: { file: string; underlay: string; clearance: string }[] = []
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
  try { collect(join(workspace, directory)) }
  catch (error) {
    if (xr && (error as NodeJS.ErrnoException).code === 'ENOENT') return { valid: !issues.length, issues, files: [] }
    issues.push(`UI layout inputs in ${directory} are unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!files.length && !xr) issues.push(`Save the UI layout inputs in ${directory} before geometry handoff.`)
  for (const path of files.sort()) {
    const name = relative(workspace, path).split(sep).join('/')
    try {
      const document = parseBeeGameContentDocument(JSON.parse(readFileSync(path, 'utf8')))
      if (document.kind !== 'ui-screen' && document.kind !== 'ui-hud' && document.kind !== 'ui-flow')
        throw new Error(`${directory} must contain UI documents`)
      if (document.kind === 'ui-flow') continue
      documents.set(name, document)
      const root = document.data.nodes.find(node => node.id === document.data.rootId)
      if (!root) throw new Error('UI root is missing')
      if (document.data.nodes.some(node => node.id !== root.id && node.data?.layoutUnderlay !== undefined))
        throw new Error('layoutUnderlay belongs on the composition root')
      if (root.data?.space === 'world') {
        if (!xr) throw new Error('World-space UI needs Scene/runtime verification; it cannot substitute for the screen layout check')
        continue
      }
      const orientation = root.data?.orientation
      if (orientation !== 'Landscape' && orientation !== 'Portrait') throw new Error('root.data.orientation must declare Landscape or Portrait')
      if (confirmed?.orientation && orientation !== confirmed.orientation) throw new Error('Layout orientation differs from the confirmed brief')
      const targets = root.data?.targetViewports
      if (!Array.isArray(targets) || !targets.length || !targets.every(isViewportPair))
        throw new Error('root.data.targetViewports must include the smallest supported size and relevant transition sizes for this composition')
      const reference = root.data?.referenceResolution ?? root.layout?.size
      for (const size of [reference, ...targets]) {
        if (!isViewportPair(size)) throw new Error('Layout reference and targets must be positive [width, height] pairs')
        if (orientation === 'Landscape' ? size[0] < size[1] : size[1] <= size[0])
          throw new Error('Layout targets include an unsupported orientation; remove that adaptation requirement')
      }
      if (document.data.nodes.some(isUiControl) && !isViewportPair(root.data?.minimumControlSize))
        throw new Error('Declare the agreed host-pixel minimumControlSize in root.data for control checks')
      issues.push(...auditUiInteractiveBounds(document, readUiLayoutCamera(workspace, document)).map(issue => `${name}: ${issue}`))
    } catch (error) { issues.push(`${name}: ${error instanceof Error ? error.message : String(error)}`) }
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
  const nodesAt = (file: string, size: [number, number]) => {
    const key = JSON.stringify([file, size])
    if (!geometry.has(key)) {
      const doc = layer(file)
      geometry.set(key, inspectUiLayout(doc.data.nodes, doc.data.rootId,
        { width: size[0], height: size[1] }, readUiLayoutCamera(workspace, doc)))
    }
    return geometry.get(key)!
  }
  const retained = (file: string, size: [number, number], chain: string[]): { file: string; node: ReturnType<typeof inspectUiLayout>[number] }[] => {
    if (chain.includes(file)) throw new Error('UI underlay cycle: ' + [...chain, file].join(' → '))
    const link = underlayOf(file)
    const own = nodesAt(file, size).filter(node => node.active && node.layoutOcclusion === 'protected').map(node => ({ file, node }))
    // Validate the whole link chain even when this state permits covering it.
    const below = link ? retained(link.file, size, [...chain, file]) : []
    return link?.clearance === 'preserve' ? [...below, ...own] : own
  }
  for (const [file, doc] of documents) try {
    const link = underlayOf(file)
    if (!link) continue
    compositions.push({ file, underlay: link.file, clearance: link.clearance })
    const root = rootOf(doc)
    const targets = [root.data?.referenceResolution ?? root.layout?.size, ...(root.data?.targetViewports as unknown[] ?? [])]
    for (const size of [...new Map(targets.filter(isViewportPair).map(size => [size.join('x'), size])).values()]) {
      const below = retained(link.file, size, [file])
      if (link.clearance === 'allow-cover') continue
      if (!below.length) throw new Error('Preserved underlay has no active declared protected region')
      for (const region of below) if (region.node.outsideViewport || region.node.outsideCameraView)
        issues.push(`${file}: ${size.join('x')} preserved ${region.file}#${region.node.id} exceeds its viewport/Camera.`)
      const occluders = nodesAt(file, size).filter(node => node.active && node.layoutOcclusion === 'occluder')
      if (!occluders.length) throw new Error('Preserved underlay clearance needs declared active occluders in this overlay; an unmarked layer is not clearance evidence')
      for (const protectedRegion of below) for (const occluder of occluders)
        if (rectanglesIntersect(protectedRegion.node.corners, occluder.corners))
          issues.push(`${file}: ${size.join('x')} occluder ${occluder.id} intersects preserved ${protectedRegion.file}#${protectedRegion.node.id}.`)
    }
  } catch (error) { issues.push(`${file}: ${error instanceof Error ? error.message : String(error)}`) }
  return { valid: !issues.length, issues, files: files.map(path => relative(workspace, path).split(sep).join('/')), compositions,
    note: 'Checks each saved file and explicitly linked layoutUnderlay compositions with declared clearance/occluders. Unlinked layers, omitted markers and agreement with prose are not established; Review must inspect their actual coverage. Not runtime or visual verification.' }
}

/** The prose owns coverage/meaning; one linked UI source owns computed geometry.
 * Links also put these files in the existing revision and version/hash scope. */
export function checkReviewUiLayouts(workspace: string, confirmed?: { orientation?: unknown; dimension?: unknown }) {
  const check = checkDesignLayouts(workspace, confirmed)
  const issues = [...check.issues]
  if (check.files.length) try {
    const linked = new Set(designSupportingFiles(workspace, ['UI_UX_SPEC.md']))
    const ids = new Set<string>()
    let compositions = 0
    for (const file of check.files) {
      try {
        const doc = parseBeeGameContentDocument(JSON.parse(readFileSync(join(workspace, file), 'utf8')))
        if (doc.kind === 'ui-flow') continue
        compositions++
        if (!linked.has(file)) issues.push(`${file}: link this layout from its owning UI_UX_SPEC.md section before Review.`)
        if (ids.has(doc.id)) issues.push(`${file}: duplicate reviewed UI composition id ${doc.id}; use distinct ids for different compositions.`)
        ids.add(doc.id)
      } catch { /* Invalid inputs are already reported by the geometry check. */ }
    }
    if (!compositions && confirmed?.dimension !== 'VR' && confirmed?.dimension !== 'AR')
      issues.push('UI Review needs ui-screen/ui-hud compositions; navigation-only ui-flow cannot establish layout geometry.')
  } catch (error) { issues.push(String(error instanceof Error ? error.message : error)) }
  return { ...check, valid: !issues.length, issues: issues.map(issue => `UI_UX_SPEC.md: ${issue}`) }
}
