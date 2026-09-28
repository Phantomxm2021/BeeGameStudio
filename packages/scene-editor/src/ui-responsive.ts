/** UI layout projection shared by the editor and browser consumers.
 * This resolves authored data only; rendering and input remain the game's job. */
import { rectLayout, uiAnchor } from './content-coordinates'

export type UiLayoutOverride = {
  anchor?: string
  anchorMin?: [number, number]
  anchorMax?: [number, number]
  sizeDelta?: [number, number]
  position?: [number, number]
  size?: [number, number]
  rotation?: number
  scale?: [number, number]
}

export type UiResponsiveOverride = {
  enabled?: boolean
  layout?: UiLayoutOverride
  style?: Record<string, unknown>
}

export type UiResponsiveNode = {
  id: string
  parentId?: string
  enabled?: boolean
  layout?: UiLayoutOverride
  style?: Record<string, unknown>
  data?: Record<string, unknown>
  responsive?: { compact?: UiResponsiveOverride; portrait?: UiResponsiveOverride }
}

export type UiViewport = { width: number; height: number }

/** Compact is a width breakpoint, independent of a short desktop iframe's height.
 * Portrait is applied after compact, so it can refine a portrait layout. */
export function resolveUiNodesForViewport<T extends UiResponsiveNode>(
  nodes: readonly T[], rootId: string, viewport: UiViewport,
): T[] {
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0)
    throw new Error('UI viewport dimensions must be positive finite numbers')
  const root = nodes.find(node => node.id === rootId)
  const authoredBreakpoint = root?.data?.compactMaxWidth
  const compactMaxWidth = typeof authoredBreakpoint === 'number' && Number.isFinite(authoredBreakpoint) && authoredBreakpoint > 0
    ? authoredBreakpoint : 600
  const compact = viewport.width <= compactMaxWidth
  const portrait = viewport.height > viewport.width
  const projected = nodes.map(node => {
    let enabled = node.enabled
    let layout = node.layout
    let style = node.style
    const overrides = [compact ? node.responsive?.compact : undefined, portrait ? node.responsive?.portrait : undefined]
    for (const override of overrides) {
      if (!override) continue
      if (override.enabled !== undefined) enabled = override.enabled
      if (override.layout) layout = { ...layout, ...override.layout }
      if (override.style) style = { ...style, ...override.style }
    }
    // A screen-space root fills the actual viewport; world-space UI keeps its authored size.
    if (node.id === rootId && node.data?.space !== 'world') layout = { ...layout, size: [viewport.width, viewport.height] }
    return { ...node, enabled, layout, style }
  })
  const byId = new Map(projected.map(node => [node.id, node]))
  const resolving = new Set<string>()
  const resolved = new Set<string>()
  const resolve = (node: T): void => {
    if (resolved.has(node.id)) return
    if (resolving.has(node.id)) throw new Error(`UI layout hierarchy cycle: ${node.id}`)
    resolving.add(node.id)
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    if (parent) resolve(parent)
    const layout = node.layout
    if (layout && (layout.anchorMin || layout.anchorMax)) {
      if (!layout.anchorMin || !layout.anchorMax) throw new Error(`UI stretch anchors must be paired: ${node.id}`)
      const parentSize = parent?.layout?.size ?? [0, 0]
      const min = layout.anchorMin
      const max = layout.anchorMax
      const anchor = uiAnchor(layout.anchor)
      const customPivot = node.data?.anchor as { x?: unknown; y?: unknown } | undefined
      const pivot: [number, number] = [
        typeof customPivot?.x === 'number' ? customPivot.x : anchor[0],
        typeof customPivot?.y === 'number' ? customPivot.y : anchor[1],
      ]
      const delta = layout.sizeDelta ?? [0, 0]
      const offset = layout.position ?? [0, 0]
      const rect = rectLayout(parentSize, [0, 0], min, max, pivot, offset, delta)
      const size = rect.size
      const position: [number, number] = [
        rect.position[0] - parentSize[0] * anchor[0],
        rect.position[1] - parentSize[1] * anchor[1],
      ]
      node.layout = { ...layout, size, position }
    }
    resolving.delete(node.id)
    resolved.add(node.id)
  }
  for (const node of projected) resolve(node)
  return projected
}
