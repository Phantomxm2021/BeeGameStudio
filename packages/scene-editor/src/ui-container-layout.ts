import type { Yoga, Node as YogaNode } from 'yoga-layout/load'
import { uiAnchor } from './content-coordinates'
import type { UiResponsiveNode } from './ui-responsive'

export type UiContainerLayout = {
  direction: 'row' | 'column' | 'grid'
  gap?: number
  padding?: [number, number, number, number] // top, right, bottom, left
  wrap?: boolean
  columns?: number // equal-width grid columns
  justify?: 'start' | 'center' | 'end' | 'space-between'
  align?: 'start' | 'center' | 'end' | 'stretch'
}
export type UiLayoutItem = {
  grow?: number
  shrink?: number
  basis?: number
  absolute?: boolean // opt out of parent flow; retain authored anchors
}
export type UiLayoutOptions = {
  /** The renderer supplies measurements after loading its actual font. No character-count estimates. */
  measureText?: (node: UiResponsiveNode) => { width: number; height: number }
}

let yoga: Yoga | undefined
let initialization: Promise<void> | undefined
/** Explicit, once-only async loading keeps WASM/top-level await out of synchronous render paths. */
export function initializeUiLayout(): Promise<void> {
  return initialization ??= import('yoga-layout/load').then(module => module.loadYoga()).then(value => { yoga = value }).catch(error => {
    initialization = undefined
    throw error
  })
}

/** Adapter only: Yoga owns allocation/wrapping. This writes projected rectangles, never source data. */
export function resolveUiContainer(
  root: UiResponsiveNode, children: ReadonlyMap<string, UiResponsiveNode[]>,
  arranged: Set<string>, options: UiLayoutOptions,
): void {
  const engine = yoga
  if (!engine) throw new Error('Container layout requires await initializeUiLayout() before resolving UI')
  const config = engine.Config.create()
  config.setUseWebDefaults(true)
  config.setPointScaleFactor(0) // retain logical/subpixel coordinates; the renderer owns pixel snapping
  const allocated: YogaNode[] = []
  const pairs = new Map<UiResponsiveNode, YogaNode>()
  const validateLengths = (values: readonly number[], id: string) => {
    if (values.some(value => !Number.isFinite(value) || value < 0)) throw new Error(`Invalid container lengths: ${id}`)
  }
  const build = (node: UiResponsiveNode, fixedRoot = false): YogaNode => {
    if (pairs.has(node)) throw new Error(`UI container hierarchy cycle: ${node.id}`)
    const yn = engine.Node.create(config)
    allocated.push(yn)
    pairs.set(node, yn)
    const layout = node.layout ?? {}
    const item = layout.item ?? {}
    const size = layout.size
    const limits = [...(layout.minSize ?? []), ...(layout.maxSize ?? []),
      ...(size ?? []), ...(item.basis === undefined ? [] : [item.basis])]
    validateLengths(limits, node.id)
    if (layout.minSize && layout.maxSize && layout.minSize.some((value, axis) => value > layout.maxSize![axis]))
      throw new Error(`UI minSize exceeds maxSize: ${node.id}`)
    if (fixedRoot || !layout.container || size) {
      yn.setWidth(size?.[0])
      yn.setHeight(size?.[1])
    }
    if (!fixedRoot || !size) {
      yn.setMinWidth(layout.minSize?.[0]); yn.setMinHeight(layout.minSize?.[1])
      yn.setMaxWidth(layout.maxSize?.[0]); yn.setMaxHeight(layout.maxSize?.[1])
    }
    validateLengths([item.grow ?? 0, item.shrink ?? 0], node.id)
    yn.setFlexGrow(item.grow ?? 0)
    // Shrinking essential controls is a design choice, not an automatic way to conceal overflow.
    yn.setFlexShrink(item.shrink ?? 0)
    if (item.basis !== undefined) yn.setFlexBasis(item.basis)
    const container = layout.container
    if (container) {
      const padding = container.padding ?? [0, 0, 0, 0]
      const gap = container.gap ?? 0
      validateLengths([...padding, gap], node.id)
      yn.setFlexDirection(container.direction === 'column' ? engine.FLEX_DIRECTION_COLUMN : engine.FLEX_DIRECTION_ROW)
      yn.setGap(engine.GUTTER_ALL, gap)
      yn.setFlexWrap(container.wrap || container.direction === 'grid' ? engine.WRAP_WRAP : engine.WRAP_NO_WRAP)
      yn.setJustifyContent({ start: engine.JUSTIFY_FLEX_START, center: engine.JUSTIFY_CENTER,
        end: engine.JUSTIFY_FLEX_END, 'space-between': engine.JUSTIFY_SPACE_BETWEEN }[container.justify ?? 'start'])
      yn.setAlignItems({ start: engine.ALIGN_FLEX_START, center: engine.ALIGN_CENTER,
        end: engine.ALIGN_FLEX_END, stretch: engine.ALIGN_STRETCH }[container.align ?? 'stretch'])
      yn.setAlignContent(engine.ALIGN_FLEX_START)
      ;[engine.EDGE_TOP, engine.EDGE_RIGHT, engine.EDGE_BOTTOM, engine.EDGE_LEFT]
        .forEach((edge, i) => yn.setPadding(edge, padding[i]))
      for (const child of children.get(node.id) ?? []) {
        if (child.enabled === false || child.layout?.item?.absolute) continue
        if (child.layout?.anchorMin || child.layout?.anchorMax)
          throw new Error(`Flow child cannot also use stretch anchors: ${child.id}; use item.absolute for an overlay`)
        const childYoga = build(child)
        if (container.direction === 'grid') {
          const columns = container.columns
          if (!Number.isInteger(columns) || columns! < 1) throw new Error(`Grid requires positive integer columns: ${node.id}`)
          if (child.layout?.item?.grow || child.layout?.item?.basis !== undefined)
            throw new Error(`Grid cell cannot override equal column allocation with grow/basis: ${child.id}`)
          // Seed proportions; resolve gap-aware widths once the parent allocation is known below.
          childYoga.setWidthPercent(100 / columns!)
          childYoga.setFlexBasisPercent(100 / columns!)
        }
        yn.insertChild(childYoga, yn.getChildCount())
      }
    } else if (node.text !== undefined && !size) {
      if (!options.measureText) throw new Error(`Text measurement required for automatic size: ${node.id}`)
      const measured = options.measureText(node)
      validateLengths([measured.width, measured.height], node.id)
      yn.setMeasureFunc(() => measured)
    }
    return yn
  }
  try {
    const yr = build(root, true)
    yr.calculateLayout(root.layout?.size?.[0], root.layout?.size?.[1], engine.DIRECTION_LTR)
    // Preorder means nested grids receive their final parent allocation before resolving cells.
    for (const [node, yn] of pairs) if (node.layout?.container?.direction === 'grid') {
      const { columns = 1, gap = 0, padding = [0, 0, 0, 0] } = node.layout.container
      const width = Math.max(0, (yn.getComputedWidth() - padding[1] - padding[3] - gap * (columns - 1)) / columns)
      for (const child of children.get(node.id) ?? []) if (pairs.has(child) &&
        (width < (child.layout?.minSize?.[0] ?? 0) || width > (child.layout?.maxSize?.[0] ?? Infinity)))
        throw new Error(`Grid cell width conflicts with size limits: ${child.id}; adjust columns or constrain content inside the cell`)
      for (let i = 0; i < yn.getChildCount(); i++) {
        yn.getChild(i).setWidth(width); yn.getChild(i).setFlexBasis(width)
      }
      yr.calculateLayout(root.layout?.size?.[0], root.layout?.size?.[1], engine.DIRECTION_LTR)
    }
    const byId = new Map([...pairs.keys()].map(node => [node.id, node]))
    if (!root.layout?.size) root.layout = { ...root.layout, size: [yr.getComputedWidth(), yr.getComputedHeight()] }
    for (const [node, yn] of pairs) {
      if (node === root) continue
      const rect = yn.getComputedLayout()
      const parent = node.parentId ? byId.get(node.parentId) : undefined
      const parentRect = parent ? pairs.get(parent)!.getComputedLayout() : undefined
      const anchor = uiAnchor(node.layout?.anchor)
      const custom = node.data?.anchor as { x?: number; y?: number } | undefined
      const pivot = [custom?.x ?? anchor[0], custom?.y ?? anchor[1]]
      node.layout = { ...node.layout, size: [rect.width, rect.height], position: [
        rect.left - (parentRect?.width ?? 0) * anchor[0] + rect.width * pivot[0],
        rect.top - (parentRect?.height ?? 0) * anchor[1] + rect.height * pivot[1],
      ] }
    }
    for (const node of pairs.keys()) if (node.layout?.container) arranged.add(node.id)
  } finally {
    // Explicit ownership also covers partially constructed trees and validation exceptions.
    for (const node of allocated.reverse()) node.free()
    config.free()
  }
}
