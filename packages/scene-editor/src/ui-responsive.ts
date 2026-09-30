/** UI layout projection shared by the editor and browser consumers.
 * This resolves authored data only; rendering and input remain the game's job. */
import { rectLayout, uiAnchor } from './content-coordinates'
import { resolveUiContainer, type UiContainerLayout, type UiLayoutItem, type UiLayoutOptions } from './ui-container-layout'

export type UiLayoutOverride = {
  anchor?: string
  anchorMin?: [number, number]
  anchorMax?: [number, number]
  sizeDelta?: [number, number]
  position?: [number, number]
  size?: [number, number]
  rotation?: number
  scale?: [number, number]
  minSize?: [number, number]
  maxSize?: [number, number]
  container?: UiContainerLayout
  item?: UiLayoutItem
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
  text?: string
  layout?: UiLayoutOverride
  style?: Record<string, unknown>
  data?: Record<string, unknown>
  responsive?: { compact?: UiResponsiveOverride; portrait?: UiResponsiveOverride }
}

export type UiViewport = { width: number; height: number }

export function uiCompactMaxWidth(root: UiResponsiveNode | undefined): number {
  const authored = root?.data?.compactMaxWidth
  return typeof authored === 'number' && Number.isFinite(authored) && authored > 0 ? authored : 600
}

/** Compact is a width breakpoint, independent of a short desktop iframe's height.
 * Portrait is applied after compact, so it can refine a portrait layout. */
export function resolveUiNodesForViewport<T extends UiResponsiveNode>(
  nodes: readonly T[], rootId: string, viewport: UiViewport, options: UiLayoutOptions = {},
): T[] {
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0)
    throw new Error('UI viewport dimensions must be positive finite numbers')
  const root = nodes.find(node => node.id === rootId)
  const compactMaxWidth = uiCompactMaxWidth(root)
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
      if (override.layout) layout = { ...layout, ...override.layout,
        ...(override.layout.container ? { container: { ...layout?.container, ...override.layout.container } } : {}),
        ...(override.layout.item ? { item: { ...layout?.item, ...override.layout.item } } : {}),
      }
      if (override.style) style = { ...style, ...override.style }
    }
    // A screen-space root fills the actual viewport; world-space UI keeps its authored size.
    if (node.id === rootId && node.data?.space !== 'world') layout = { ...layout, size: [viewport.width, viewport.height] }
    return { ...node, enabled, layout, style }
  })
  const byId = new Map(projected.map(node => [node.id, node]))
  if (byId.size !== nodes.length) throw new Error('Duplicate UI node IDs')
  if (!byId.has(rootId)) throw new Error(`Unknown UI root: ${rootId}`)
  const children = new Map<string, T[]>()
  for (const node of projected) if (node.parentId) {
    const list = children.get(node.parentId) ?? []
    list.push(node); children.set(node.parentId, list)
  }
  const arranged = new Set<string>()
  const resolving = new Set<string>()
  const resolved = new Set<string>()
  const resolve = (node: T): void => {
    if (resolved.has(node.id)) return
    if (resolving.has(node.id)) throw new Error(`UI layout hierarchy cycle: ${node.id}`)
    resolving.add(node.id)
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    if (parent) resolve(parent)
    const layout = node.layout
    // Root dimensions are established above (viewport or authored world size).
    // It has no parent rectangle against which stretch anchors can be resolved.
    if (node.id !== rootId && layout && (layout.anchorMin || layout.anchorMax)) {
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
    if (node.id !== rootId && node.layout?.size && (node.layout.minSize || node.layout.maxSize)) {
      const current = node.layout
      if (current.minSize && current.maxSize && current.minSize.some((value, axis) => value > current.maxSize![axis]))
        throw new Error(`UI minSize exceeds maxSize: ${node.id}`)
      const size = current.size!.map((value, axis) => Math.min(current.maxSize?.[axis] ?? Infinity,
        Math.max(current.minSize?.[axis] ?? 0, value))) as [number, number]
      node.layout = { ...current, size }
    }
    if (node.layout?.container && !arranged.has(node.id)) resolveUiContainer(node, children, arranged, options)
    resolving.delete(node.id)
    resolved.add(node.id)
  }
  for (const node of projected) resolve(node)
  return projected
}
