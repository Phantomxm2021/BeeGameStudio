/** Optional UI layout projection shared by the editor and browser consumers.
 * This resolves authored data only; rendering and input remain the game's job. */
export type UiLayoutOverride = {
  anchor?: string
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
  enabled?: boolean
  layout?: UiLayoutOverride
  style?: Record<string, unknown>
  data?: Record<string, unknown>
  responsive?: { compact?: UiResponsiveOverride; portrait?: UiResponsiveOverride }
}

export type UiViewport = { width: number; height: number }

/** Compact means the shorter viewport side is at most 600 logical pixels.
 * Portrait is applied after compact, so it can refine a phone portrait layout. */
export function resolveUiNodesForViewport<T extends UiResponsiveNode>(
  nodes: readonly T[], rootId: string, viewport: UiViewport,
): T[] {
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0)
    throw new Error('UI viewport dimensions must be positive finite numbers')
  const compact = Math.min(viewport.width, viewport.height) <= 600
  const portrait = viewport.height > viewport.width
  return nodes.map(node => {
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
}
