import { rectLayout } from './content-coordinates'
import { componentOf } from './model'
import type { SceneNode, Transform } from './model'

/** Editor rects use y-up units after the Content import boundary. */
export function editorRect(node: SceneNode, nodes: Record<string, SceneNode>, path = new Set<string>()): { size: [number, number]; position: [number, number] } | undefined {
  const rect = componentOf(node, 'rect-transform')
  if (!rect) return undefined
  if (path.has(node.id)) throw new Error('Invalid rect hierarchy')
  const parent = node.parentId ? nodes[node.parentId] : undefined
  const parentRect = parent && componentOf(parent, 'rect-transform')
  const canvas = componentOf(node, 'canvas')
  const reference = canvas?.enabled && canvas.renderMode !== 'world-space' ? canvas.referenceSize : undefined
  const parentSize = parent && parentRect ? editorRect(parent, nodes, new Set(path).add(node.id))?.size ?? [0, 0] : reference ?? [0, 0]
  // The virtual screen frame starts at top-left, hence [0,1] in editor y-up units.
  return rectLayout(parentSize, parentRect?.pivot ?? (reference ? [0, 1] : [0, 0]), rect.anchorMin, rect.anchorMax, rect.pivot, rect.anchoredPosition, rect.sizeDelta)
}

/** Apply/remove the rect offset once, both for rendering and transform tools. */
export function rectTransform(node: SceneNode, nodes: Record<string, SceneNode>, transform = node.transform, inverse = false): Transform {
  const rect = editorRect(node, nodes)
  if (!rect) return transform
  const sign = inverse ? -1 : 1
  return { ...transform, position: [transform.position[0]+sign*rect.position[0], transform.position[1]+sign*rect.position[1], transform.position[2]] }
}
