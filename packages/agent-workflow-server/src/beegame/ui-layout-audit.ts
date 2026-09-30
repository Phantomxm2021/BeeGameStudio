import {
  compose2d, point2d, uiAnchor, uiLocalMatrix, type Affine2D,
} from '../../../scene-editor/src/content-coordinates'
import { resolveUiNodesForViewport } from '../../../scene-editor/src/ui-responsive'
import { initializeUiLayout } from '../../../scene-editor/src/ui-container-layout'
import type { BeeGameContentDocument } from './game-content-schema'

type UiDocument = Extract<BeeGameContentDocument, { kind: 'ui-screen' | 'ui-hud' | 'ui-flow' }>
await initializeUiLayout()
type UiNode = UiDocument['data']['nodes'][number]
type Viewport = { width: number; height: number }

const identity: Affine2D = [1, 0, 0, 1, 0, 0]
const interactiveRoles = new Set(['button', 'slider', 'toggle', 'dropdown', 'tab'])
const desktopContainerViewports: Viewport[] = [
  { width: 960, height: 540 },
  { width: 960, height: 720 },
]

function pivot(node: UiNode, fallback: readonly [number, number]): readonly [number, number] {
  const value = node.data?.anchor
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const anchor = value as Record<string, unknown>
    if (typeof anchor.x === 'number' && typeof anchor.y === 'number') return [anchor.x, anchor.y]
  }
  return fallback
}

/** Cheap content handoff check using the same coordinate math as the editors.
 * It checks authored screen-space controls and their containing panels, not aesthetics. */
export function auditUiInteractiveBounds(document: UiDocument): string[] {
  if (document.kind === 'ui-flow') return []
  const root = document.data.nodes.find(node => node.id === document.data.rootId)
  if (!root || root.data?.space === 'world') return []
  const compactMaxWidth = root.data?.compactMaxWidth
  if (compactMaxWidth !== undefined && (typeof compactMaxWidth !== 'number' || !Number.isFinite(compactMaxWidth) || compactMaxWidth <= 0))
    return ['root: compactMaxWidth must be a positive number.']
  const reference = root.data?.referenceResolution ?? root.layout?.size
  const targets = root.data?.targetViewports
  if (targets !== undefined && (!Array.isArray(targets) || targets.length === 0 || targets.some(size =>
    !Array.isArray(size) || size.length !== 2 || size.some(value =>
      typeof value !== 'number' || !Number.isFinite(value) || value <= 0))))
    return ['root: targetViewports must contain positive [width, height] pairs.']
  const viewports = targets === undefined ? [...desktopContainerViewports]
    : (targets as number[][]).map(([width, height]) => ({ width, height }))
  if (Array.isArray(reference) && reference.length === 2 &&
    reference.every(value => typeof value === 'number' && Number.isFinite(value) && value > 0))
    viewports.unshift({ width: reference[0] as number, height: reference[1] as number })
  const unique = [...new Map(viewports.map(viewport => [`${viewport.width}x${viewport.height}`, viewport])).values()]
  const failures = new Map<string, string[]>()

  for (const viewport of unique) {
    const nodes = resolveUiNodesForViewport(document.data.nodes, document.data.rootId, viewport)
    const children = new Map<string, UiNode[]>()
    for (const node of nodes) if (node.parentId) {
      const list = children.get(node.parentId) ?? []
      list.push(node)
      children.set(node.parentId, list)
    }
    const hasInteractiveDescendant = (id: string, seen = new Set<string>()): boolean => {
      if (seen.has(id)) return false
      seen.add(id)
      return (children.get(id) ?? []).some(child => child.enabled !== false && (
        interactiveRoles.has(child.role) || Object.keys(child.actions ?? {}).length > 0 ||
        hasInteractiveDescendant(child.id, seen)
      ))
    }
    const visit = (node: UiNode, parent: Affine2D, parentSize: readonly [number, number], seen: Set<string>) => {
      if (node.enabled === false || seen.has(node.id)) return
      const nextSeen = new Set([...seen, node.id])
      const size = node.id === root.id
        ? [viewport.width, viewport.height] as const
        : node.layout?.size ?? [0, 0]
      const anchor = uiAnchor(node.layout?.anchor)
      const matrix = node.id === root.id ? identity : compose2d(parent, uiLocalMatrix(
        parentSize, size, anchor, node.layout?.position ?? [0, 0], pivot(node, anchor),
        node.layout?.rotation ?? 0, node.layout?.scale ?? [1, 1],
      ))
      const interactive = interactiveRoles.has(node.role) || Object.keys(node.actions ?? {}).length > 0
      const containingPanel = node.role === 'container' && hasInteractiveDescendant(node.id)
      if ((interactive || containingPanel) && (size[0] <= 0 || size[1] <= 0)) {
        const list = failures.get(node.id) ?? []
        list.push(`${viewport.width}x${viewport.height} has non-positive bounds [${Math.round(size[0])},${Math.round(size[1])}]`)
        failures.set(node.id, list)
      }
      if ((interactive || containingPanel) && size[0] > 0 && size[1] > 0) {
        const corners = [point2d(matrix, 0, 0), point2d(matrix, size[0], 0),
          point2d(matrix, 0, size[1]), point2d(matrix, size[0], size[1])]
        const left = Math.min(...corners.map(point => point[0]))
        const top = Math.min(...corners.map(point => point[1]))
        const right = Math.max(...corners.map(point => point[0]))
        const bottom = Math.max(...corners.map(point => point[1]))
        if (left < -1 || top < -1 || right > viewport.width + 1 || bottom > viewport.height + 1) {
          const list = failures.get(node.id) ?? []
          list.push(`${viewport.width}x${viewport.height} bounds [${Math.round(left)},${Math.round(top)},${Math.round(right)},${Math.round(bottom)}]`)
          failures.set(node.id, list)
        }
      }
      for (const child of children.get(node.id) ?? []) visit(child, matrix, size, nextSeen)
    }
    visit(nodes.find(node => node.id === root.id)!, identity, [viewport.width, viewport.height], new Set())
  }
  return [...failures].map(([nodeId, bounds]) =>
    `${nodeId}: enabled control or its containing panel is outside the viewport under authored anchor/pivot layout (${bounds.join('; ')}).`)
}
