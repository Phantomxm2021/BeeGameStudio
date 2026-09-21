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
  ui: 'Screen UI uses top-left logical pixels regardless of scene dimension. Anchor and pivot coordinates are [x,y], with [0,0] top-left and [1,1] bottom-right. layout.position is a parent-local offset from layout.anchor. data.anchor optionally overrides the child pivot only. Local top-left = parentSize * anchor + position - childSize * pivot; rotate/scale around the pivot. Nested DOM uses local coordinates, never already accumulated world coordinates.',
  rectTransform: 'Scene RectTransform uses the same top-left anchor/pivot convention as UI. size = parentRectSize * (anchorMax-anchorMin) + sizeDelta. Its pivot position = parentRectSize * (anchorMin+(anchorMax-anchorMin)*pivot-parentPivot) + anchoredPosition; add Transform.position once. A root rect has no parent rectangle. This is a Content convention, not implicit target-engine RectTransform semantics.',
  vfx: 'Emitter positions, zones, collider offsets and local effect geometry use their owning scene/UI coordinate space and inherit its transform once. Screen effects use logical pixels; 3D effects use world units. Texture/atlas rectangles always use top-left image pixels.',
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
