import { affine2d, compose2d, point2d, uiAnchor, uiLocalMatrix, type Affine2D } from './content-coordinates'
import { resolveUiNodesForViewport, uiCompactMaxWidth, type UiResponsiveNode, type UiViewport } from './ui-responsive'
import type { UiLayoutOptions } from './ui-container-layout'

const overlapRoles = new Set(['text', 'button', 'slider', 'toggle', 'dropdown', 'tab'])
const participatesInOverlap = (node: UiResponsiveNode) => {
  const role = (node as UiResponsiveNode & { role?: string }).role
  return role === undefined ? node.text !== undefined : overlapRoles.has(role)
}

/** Read-only geometry diagnostics, not a design/visibility verdict or renderer. */
export function inspectUiLayout(nodes: readonly UiResponsiveNode[], rootId: string, viewport: UiViewport, options: UiLayoutOptions = {}) {
  const projected = resolveUiNodesForViewport(nodes, rootId, viewport, options)
  const byId = new Map(projected.map(node => [node.id, node]))
  if (byId.size !== nodes.length) throw new Error('Duplicate UI node IDs')
  if (!byId.has(rootId)) throw new Error(`Unknown UI root: ${rootId}`)
  if (byId.get(rootId)?.data?.space === 'world') throw new Error('Screen layout inspection requires screen-space UI; world UI needs its camera projection')
  const matrices = new Map<string, Affine2D>()
  const active = new Map<string, boolean>()
  const visiting = new Set<string>()
  const resolve = (node: UiResponsiveNode): Affine2D => {
    const cached = matrices.get(node.id)
    if (cached) return cached
    if (visiting.has(node.id)) throw new Error(`UI hierarchy cycle: ${node.id}`)
    visiting.add(node.id)
    const parent = node.id === rootId ? undefined : byId.get(node.parentId ?? '')
    if (node.id !== rootId && !parent) throw new Error(`Unknown UI parent: ${node.id}`)
    const parentMatrix = parent ? resolve(parent) : affine2d(0, 0)
    const layout = node.layout ?? {}
    const size = layout.size ?? [0, 0]
    const anchor = uiAnchor(layout.anchor)
    const custom = node.data?.anchor as { x?: number; y?: number } | undefined
    const pivot = [custom?.x ?? anchor[0], custom?.y ?? anchor[1]]
    const values = [...size, ...(layout.position ?? [0, 0]), ...pivot, ...(layout.scale ?? [1, 1]), layout.rotation ?? 0]
    if (!values.every(Number.isFinite) || size.some(value => value < 0)) throw new Error(`Invalid UI geometry: ${node.id}`)
    const matrix = parent ? compose2d(parentMatrix, uiLocalMatrix(
      parent.layout?.size ?? [0, 0], size, anchor, layout.position ?? [0, 0], pivot,
      layout.rotation ?? 0, layout.scale ?? [1, 1],
    )) : affine2d(0, 0)
    matrices.set(node.id, matrix)
    active.set(node.id, node.enabled !== false && (!parent || active.get(parent.id) === true))
    visiting.delete(node.id)
    return matrix
  }
  const rectangles = projected.map(node => {
    const matrix = resolve(node)
    const size = node.layout?.size ?? [0, 0]
    const corners = [[0, 0], [size[0], 0], [size[0], size[1]], [0, size[1]]].map(([x, y]) => point2d(matrix, x, y))
    const xs = corners.map(p => p[0]), ys = corners.map(p => p[1])
    const bounds = { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) }
    const measured = node.text !== undefined ? options.measureText?.(node) : undefined
    return { id: node.id, parentId: node.parentId, active: active.get(node.id), layout: node.layout,
      pivot: node.data?.anchor ?? { x: uiAnchor(node.layout?.anchor)[0], y: uiAnchor(node.layout?.anchor)[1] },
      corners, bounds,
      textFit: node.text === undefined ? 'not-applicable' : !measured ? 'unmeasured'
        : measured.width > size[0] + .01 || measured.height > size[1] + .01 ? 'exceeds-intrinsic-bounds' : 'fits-intrinsic-bounds',
      outsideViewport: active.get(node.id) === true && (bounds.left < -0.01 || bounds.top < -0.01 || bounds.right > viewport.width + 0.01 || bounds.bottom > viewport.height + 0.01),
    }
  })
  const rectanglesById = new Map(rectangles.map(rect => [rect.id, rect]))
  return rectangles.map(rect => {
    const parent = rect.parentId ? rectanglesById.get(rect.parentId) : undefined
    const bounds = rect.bounds
    // Local-space containment avoids false positives from rotated ancestors' world AABBs.
    const node = byId.get(rect.id)!
    const parentNode = node.parentId ? byId.get(node.parentId) : undefined
    const parentSize = parentNode?.layout?.size ?? [0, 0]
    const anchor = uiAnchor(node.layout?.anchor)
    const custom = node.data?.anchor as { x?: number; y?: number } | undefined
    const local = uiLocalMatrix(parentSize, node.layout?.size ?? [0, 0], anchor, node.layout?.position ?? [0, 0],
      [custom?.x ?? anchor[0], custom?.y ?? anchor[1]], node.layout?.rotation ?? 0, node.layout?.scale ?? [1, 1])
    const size = node.layout?.size ?? [0, 0]
    const localCorners = [[0, 0], [size[0], 0], [size[0], size[1]], [0, size[1]]].map(([x, y]) => point2d(local, x, y))
    const outsideParent = Boolean(rect.active && parent && localCorners.some(([x, y]) =>
      x < -.01 || y < -.01 || x > parentSize[0] + .01 || y > parentSize[1] + .01))
    // Flow must fit the padded content area, not merely the outer border. An
    // anchored absolute overlay deliberately opts out of this allocation.
    const padding = parentNode?.layout?.container?.padding ?? [0, 0, 0, 0]
    const outsideContentArea = Boolean(rect.active && parentNode?.layout?.container &&
      !node.layout?.item?.absolute && localCorners.some(([x, y]) =>
        x < padding[3] - .01 || y < padding[0] - .01 ||
        x > parentSize[0] - padding[1] + .01 || y > parentSize[1] - padding[2] + .01))
    // Foreground sibling boxes, not just clickable controls. Text can obstruct
    // a button or another label while every containment check still succeeds.
    // Backgrounds/containers and parent-child labels are deliberately excluded.
    const hasArea = bounds.right > bounds.left + .01 && bounds.bottom > bounds.top + .01
    const overlapCandidates = participatesInOverlap(node) && rect.active && hasArea ? rectangles.filter(other => {
      return other.id !== rect.id && other.active && other.parentId === rect.parentId &&
        participatesInOverlap(byId.get(other.id)!) &&
        other.bounds.right > other.bounds.left + .01 && other.bounds.bottom > other.bounds.top + .01 &&
        bounds.left < other.bounds.right - .01 && bounds.right > other.bounds.left + .01 &&
        bounds.top < other.bounds.bottom - .01 && bounds.bottom > other.bounds.top + .01
    }).map(other => other.id) : []
    return { ...rect, outsideParent, outsideContentArea, overlapCandidates }
  })
}

/** Compact findings for CLI consumers; overlap remains a candidate, never a verdict. */
export function summarizeUiLayoutInspection(nodes: ReturnType<typeof inspectUiLayout>) {
  const order = new Map(nodes.map((node, index) => [node.id, index]))
  return {
    outsideViewport: nodes.filter(node => node.outsideViewport).map(node => node.id),
    outsideParent: nodes.filter(node => node.outsideParent).map(node => node.id),
    outsideContentArea: nodes.filter(node => node.outsideContentArea).map(node => node.id),
    overlapCandidates: nodes.flatMap((node, index) => node.overlapCandidates
      .filter(id => order.get(id)! > index).map(id => [node.id, id])),
  }
}

/** Probe both sides of declared variant boundaries, preserving the other axis.
 * These are diagnostic probes, not a declaration that all sizes are supported. */
export function inspectUiLayoutBoundaries(nodes: readonly UiResponsiveNode[], rootId: string, viewport: UiViewport, options: UiLayoutOptions = {}) {
  const root = nodes.find(node => node.id === rootId)
  const probes: { trigger: 'compact' | 'portrait'; viewport: UiViewport }[] = []
  if (nodes.some(node => node.responsive?.compact)) {
    const width = uiCompactMaxWidth(root)
    probes.push({ trigger: 'compact', viewport: { width, height: viewport.height } },
      { trigger: 'compact', viewport: { width: width + 1, height: viewport.height } })
  }
  if (nodes.some(node => node.responsive?.portrait)) {
    probes.push({ trigger: 'portrait', viewport: { width: viewport.width, height: viewport.width } },
      { trigger: 'portrait', viewport: { width: viewport.width, height: viewport.width + 1 } })
  }
  return probes.map(probe => ({ ...probe,
    diagnostics: summarizeUiLayoutInspection(inspectUiLayout(nodes, rootId, probe.viewport, options)),
  }))
}
