/** Content coordinates, independent of DOM, Three.js and the Agent runtime. */
export const UI_ANCHORS = {
  'top-left': [0, 0], 'top-center': [.5, 0], 'top-right': [1, 0],
  'middle-left': [0, .5], 'middle-center': [.5, .5], 'middle-right': [1, .5],
  'bottom-left': [0, 1], 'bottom-center': [.5, 1], 'bottom-right': [1, 1],
  // Existing editor documents used these spellings. They have identical semantics.
  'center-left': [0, .5], center: [.5, .5], 'center-right': [1, .5],
} as const

export function uiAnchor(name = 'top-left'): readonly [number, number] {
  const value = UI_ANCHORS[name as keyof typeof UI_ANCHORS]
  if (!Object.hasOwn(UI_ANCHORS, name)) throw new Error(`Unknown UI anchor: ${name}`)
  return value
}

export const CONTENT_COORDINATE_CONTRACT = {
  uiAnchors: UI_ANCHORS,
  scene2d: 'Top-left origin; +X right, +Y down. Distances are logical pixels. pixelsPerUnit converts pixels to editor/engine units only, never multiply authored positions twice. Z is depth/order, not a screen offset.',
  scene3d: 'Right-handed world; +X right, +Y up, +Z toward the viewer at the default front view; world units are meters. Do not apply the 2D canvas origin or pixelsPerUnit to 3D transforms.',
  hierarchy: 'Transform positions are parent-local. Compose parent * translation * rotation * scale exactly once. Sprite pivots offset the rendered geometry, never the GameObject or its children/colliders.',
  rotation: 'All persisted Transform.rotation and UI layout.rotation angles are radians. 3D uses XYZ Euler order. Positive 2D/UI rotation is clockwise in the y-down plane. A y-up editor reverses the 2D Z angle at import and export, not in saved Content.',
  ui: 'Screen UI uses top-left logical pixels regardless of scene dimension. Root referenceResolution is a design reference, not a fixed host-window size: the screen root uses the actual viewport. layout.anchor is a named string from uiAnchors (for example center), not an [x,y] array; the listed pairs describe its normalized meaning. data.anchor optionally overrides the pivot as {x,y}, with {x:0,y:0} top-left and {x:1,y:1} bottom-right. layout.position is a parent-local offset from layout.anchor. The child pivot defaults to the same anchor, never implicitly [0,0]; a centered panel uses position [0,0], not a second half-size subtraction. For stretch, provide layout.anchorMin and anchorMax together (normalized parent coordinates), and layout.sizeDelta; resolved size = parentSize * (anchorMax-anchorMin) + sizeDelta. The same pivot and position offset apply after stretching. Local top-left = parentSize * anchor + resolved position - resolved size * pivot; rotate/scale around the pivot. Nested DOM uses local coordinates, never already accumulated world coordinates.',
  uiPaint: 'For each enabled node paint its background/border first, then its own content (text, image or control graphics), then child nodes in document order. Later siblings paint over earlier siblings. A background is never a later overlay above the node content. Disabled nodes suppress their whole subtree.',
  rectTransform: 'Scene RectTransform uses the same top-left anchor/pivot convention as UI. size = parentRectSize * (anchorMax-anchorMin) + sizeDelta. Its pivot position = parentRectSize * (anchorMin+(anchorMax-anchorMin)*pivot-parentPivot) + anchoredPosition; add Transform.position once. A root rect has no parent rectangle. This is a Content convention, not implicit target-engine RectTransform semantics.',
  vfx: 'Emitter positions, zones, collider offsets and local effect geometry use their owning scene/UI coordinate space and inherit its transform once. Screen effects use logical pixels; 3D effects use world units. Texture/atlas rectangles always use top-left image pixels.',
} as const

export const UI_PAINT_PHASES = ['background', 'content'] as const
export type UiPaintPhase = typeof UI_PAINT_PHASES[number]
export type UiPaintNode = Readonly<{ id: string; parentId?: string; enabled?: boolean }>
export type UiPaintStep = Readonly<{ nodeId: string; phase: UiPaintPhase }>

/** A renderer-independent reference order for UI consumers and editor tests. */
export function uiPaintOrder(nodes: readonly UiPaintNode[], rootId: string): UiPaintStep[] {
  const byId = new Map<string, UiPaintNode>()
  const children = new Map<string, UiPaintNode[]>()
  for (const node of nodes) {
    if (byId.has(node.id)) throw new Error(`Duplicate UI node: ${node.id}`)
    byId.set(node.id, node)
    if (node.id !== rootId) {
      if (!node.parentId) throw new Error(`UI node has no parent: ${node.id}`)
      const list = children.get(node.parentId) ?? []
      list.push(node)
      children.set(node.parentId, list)
    }
  }
  if (!byId.has(rootId)) throw new Error(`Unknown UI root: ${rootId}`)
  for (const node of nodes)
    if (node.id !== rootId && !byId.has(node.parentId!))
      throw new Error(`Unknown UI parent ${node.parentId}: ${node.id}`)
  const output: UiPaintStep[] = [], visiting = new Set<string>(), visited = new Set<string>()
  const visit = (node: UiPaintNode) => {
    if (visiting.has(node.id)) throw new Error(`UI hierarchy cycle: ${node.id}`)
    if (visited.has(node.id)) return
    visiting.add(node.id); visited.add(node.id)
    if (node.enabled !== false) {
      output.push({ nodeId: node.id, phase: 'background' }, { nodeId: node.id, phase: 'content' })
      for (const child of children.get(node.id) ?? []) visit(child)
    } else {
      const mark = (child: UiPaintNode) => { visited.add(child.id); for (const nested of children.get(child.id) ?? []) mark(nested) }
      for (const child of children.get(node.id) ?? []) mark(child)
    }
    visiting.delete(node.id)
  }
  visit(byId.get(rootId)!)
  if (visited.size !== nodes.length) throw new Error('UI hierarchy is disconnected from its root')
  return output
}

export const UI_PAINT_CONFORMANCE_FIXTURE = {
  rootId: 'root',
  nodes: [
    { id: 'root' },
    { id: 'button', parentId: 'root' },
    { id: 'label', parentId: 'button' },
    { id: 'later-sibling', parentId: 'root' },
  ],
  expected: [
    { nodeId: 'root', phase: 'background' }, { nodeId: 'root', phase: 'content' },
    { nodeId: 'button', phase: 'background' }, { nodeId: 'button', phase: 'content' },
    { nodeId: 'label', phase: 'background' }, { nodeId: 'label', phase: 'content' },
    { nodeId: 'later-sibling', phase: 'background' }, { nodeId: 'later-sibling', phase: 'content' },
  ],
} as const

// Canvas/SVG affine order: x'=a*x+c*y+e, y'=b*x+d*y+f.
export type Affine2D = readonly [number, number, number, number, number, number]
export function affine2d(x: number, y: number, radians = 0, sx = 1, sy = 1): Affine2D {
  const c = Math.cos(radians), s = Math.sin(radians)
  return [c * sx, s * sx, -s * sy, c * sy, x, y]
}
export function compose2d(p: Affine2D, n: Affine2D): Affine2D {
  return [p[0]*n[0]+p[2]*n[1], p[1]*n[0]+p[3]*n[1], p[0]*n[2]+p[2]*n[3], p[1]*n[2]+p[3]*n[3], p[0]*n[4]+p[2]*n[5]+p[4], p[1]*n[4]+p[3]*n[5]+p[5]]
}
export function point2d(m: Affine2D, x: number, y: number): [number, number] {
  return [m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5]]
}
export function uiLocalMatrix(parentSize: readonly number[], size: readonly number[], anchor: readonly number[], position: readonly number[], pivot = anchor, rotation = 0, scale: readonly number[] = [1, 1]): Affine2D {
  return compose2d(affine2d(parentSize[0]*anchor[0]+position[0], parentSize[1]*anchor[1]+position[1], rotation, scale[0], scale[1]), affine2d(-size[0]*pivot[0], -size[1]*pivot[1]))
}

export function rectLayout(parentSize: readonly number[], parentPivot: readonly number[], min: readonly number[], max: readonly number[], pivot: readonly number[], offset: readonly number[], delta: readonly number[]) {
  return {
    size: [0, 1].map(i => parentSize[i]*(max[i]-min[i])+delta[i]) as [number, number],
    position: [0, 1].map(i => parentSize[i]*(min[i]+(max[i]-min[i])*pivot[i]-parentPivot[i])+offset[i]) as [number, number],
  }
}
