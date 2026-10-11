import { compose2d, point2d, uiPaintOrder } from './content-coordinates'
import { inspectUiLayout, type UiLayoutInspectionOptions } from './ui-layout-inspection'
import { initializeUiLayout } from './ui-container-layout'
import { resolveUiNodesForViewport, type UiResponsiveNode, type UiViewport } from './ui-responsive'
import { inspectSceneLayout2d, sceneWorldTransforms2d, type SceneSpatialData } from './scene-layout-inspection'

type UiNode = UiResponsiveNode & {
  role: string
  assetRef?: string
  actions?: Record<string, string>
  bindings?: Record<string, string>
}
type UiData = { rootId: string; nodes: readonly UiNode[] }
export type SurfaceImage = { source: CanvasImageSource; url: string; frame?: [number, number, number, number] }
export type SurfaceAssets = ReadonlyMap<string, SurfaceImage>

export const PRODUCTION_SURFACE_CAPABILITIES = {
  uiRoles: ['screen-root', 'hud-root', 'container', 'text', 'shape', 'image', 'sprite', 'button', 'tab', 'keycap', 'toast'],
  uiStyles: ['background', 'backgroundColor', 'color', 'border', 'borderColor', 'borderWidth', 'borderStyle',
    'borderRadius', 'boxShadow', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'opacity'],
  sceneComponents: ['camera', 'sprite-renderer', 'image', 'text', 'rect-transform',
    'box-collider-2d', 'circle-collider-2d', 'capsule-collider-2d', 'polygon-collider-2d'],
} as const
const uiRoles = new Set<string>(PRODUCTION_SURFACE_CAPABILITIES.uiRoles)
const cssFields = new Set<string>(PRODUCTION_SURFACE_CAPABILITIES.uiStyles)
const pxFields = new Set(['borderWidth', 'borderRadius', 'fontSize', 'lineHeight', 'letterSpacing'])

/** A deliberately limited browser surface, not a gameplay engine. Unsupported
 * roles/styles/components fail explicitly; callers cannot mistake partial paint
 * for a complete renderer. Geometry comes from the Editor's shared functions. */
export async function createProductionUiSurface(host: HTMLElement) {
  if (!host || typeof host.append !== 'function' || host.nodeType !== 1)
    throw new Error('createProductionUiSurface expects an HTMLElement, not a selector or options object; await the returned Promise')
  await initializeUiLayout()
  const layer = document.createElement('div')
  layer.dataset.bgsSurface = 'ui'
  layer.style.cssText = 'position:relative;overflow:hidden;isolation:isolate'
  host.append(layer)
  let disposed = false
  return {
    render(data: UiData, viewport: UiViewport, options: UiLayoutInspectionOptions & {
      state?: Readonly<Record<string, unknown>>
      assets?: SurfaceAssets
      fonts?: ReadonlyMap<string, FontFace>
      onAction?: (action: string, nodeId: string) => void
    } = {}) {
      if (disposed) throw new Error('UI surface is disposed')
      const source = data.nodes.map(node => {
        if (!uiRoles.has(node.role)) throw new Error(`Unsupported production UI role: ${node.id}/${node.role}`)
        if (node.data?.frame !== undefined || node.data?.member !== undefined || node.data?.clipChildren === true)
          throw new Error('Unsupported production UI frame/member/clipping: ' + node.id)
        if (node.data?.font !== undefined) {
          const reference = (node.data.font as { assetRef?: string }).assetRef
          const face = reference ? options.fonts?.get(reference) : undefined
          if (!face || face.status !== 'loaded' || !document.fonts.has(face))
            throw new Error('Missing loaded production FontFace: ' + node.id)
        }
        if (node.data?.visibleWhen !== undefined) throw new Error(`Connect visibility through enabled/bindings, not an unevaluated expression: ${node.id}`)
        for (const key of Object.keys(node.actions ?? {}))
          if (key !== 'click') throw new Error(`Unsupported production UI action: ${node.id}/${key}`)
        if (node.actions?.click && !options.onAction) throw new Error(`No action handler: ${node.id}`)
        const bound = { ...node }
        for (const [property, stateKey] of Object.entries(node.bindings ?? {})) {
          if (!options.state || !Object.hasOwn(options.state, stateKey)) throw new Error(`Missing UI state binding: ${node.id}/${stateKey}`)
          const value = options.state[stateKey]
          if (property === 'text' && (typeof value === 'string' || typeof value === 'number')) bound.text = String(value)
          else if (property === 'enabled' && typeof value === 'boolean') bound.enabled = value
          else throw new Error(`Unsupported or invalid UI binding: ${node.id}/${property}`)
        }
        return bound
      })
      const nodes = resolveUiNodesForViewport(source, data.rootId, viewport, options)
      const byId = new Map(nodes.map(node => [node.id, node]))
      const geometry = inspectUiLayout(source, data.rootId, viewport, options)
      const rectangles = new Map(geometry.map(node => [node.id, node]))
      const inherited = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'textAlign']
      const styleOf = (node: UiNode): Record<string, unknown> => {
        const chain: UiNode[] = []; let current: UiNode | undefined = node
        while (current) { chain.unshift(current); current = current.parentId ? byId.get(current.parentId) : undefined }
        const style: Record<string, unknown> = {}; let opacity = 1
        for (const ancestor of chain) {
          const fontRef = (ancestor.data?.font as { assetRef?: string } | undefined)?.assetRef
          if (fontRef && ancestor.style?.fontFamily !== undefined && ancestor.style.fontFamily !== options.fonts!.get(fontRef)!.family)
            throw new Error('UI fontFamily conflicts with loaded font resource: ' + ancestor.id)
          for (const key of inherited) if (ancestor.style?.[key] !== undefined) style[key] = ancestor.style[key]
          if (fontRef) style.fontFamily = options.fonts!.get(fontRef)!.family
          if (ancestor.style?.opacity !== undefined) {
            const value = Number(ancestor.style.opacity)
            if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Invalid UI opacity: ' + ancestor.id)
            opacity *= value
          }
        }
        return { ...node.style, ...style, opacity }
      }
      const fragment = document.createDocumentFragment()
      for (const step of uiPaintOrder(nodes, data.rootId)) {
        if (step.phase !== 'content') continue
        const node = byId.get(step.nodeId)!
        const rect = rectangles.get(node.id)!
        if (!rect.active) continue
        const [width, height] = rect.layout?.size ?? [0, 0]
        if (width <= 0 || height <= 0) throw new Error(`Production UI needs positive geometry: ${node.id}`)
        const isButton = node.role === 'button' || node.role === 'tab'
        const element = document.createElement(isButton ? 'button' : 'div')
        if (isButton) (element as HTMLButtonElement).type = 'button'
        element.dataset.nodeId = node.id
        element.style.cssText = 'position:absolute;left:0;top:0;box-sizing:border-box;margin:0;padding:0;border:0;transform-origin:0 0;white-space:pre-wrap;background:transparent;pointer-events:none'
        element.style.width = `${width}px`
        element.style.height = `${height}px`
        const [origin, right, , bottom] = rect.corners
        element.style.transform = `matrix(${(right[0] - origin[0]) / width},${(right[1] - origin[1]) / width},${(bottom[0] - origin[0]) / height},${(bottom[1] - origin[1]) / height},${origin[0]},${origin[1]})`
        const style = styleOf(node)
        for (const [key, value] of Object.entries(style)) {
          if (!cssFields.has(key) || (typeof value !== 'string' && typeof value !== 'number'))
            throw new Error(`Unsupported production UI style: ${node.id}/${key}`)
          element.style.setProperty(key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()),
            typeof value === 'number' && pxFields.has(key) ? `${value}px` : String(value))
        }
        if (node.text !== undefined) {
          element.textContent = node.text
          element.style.display = 'flex'
          element.style.alignItems = 'center'
          element.style.justifyContent = style.textAlign === 'left' ? 'flex-start' : style.textAlign === 'right' ? 'flex-end' : 'center'
        }
        if (node.assetRef) {
          const asset = options.assets?.get(node.assetRef)
          if (!asset) throw new Error(`Missing decoded UI resource: ${node.id}/${node.assetRef}`)
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(width)
          canvas.height = Math.ceil(height)
          canvas.style.cssText = 'width:100%;height:100%;position:absolute;inset:0;pointer-events:none'
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('Canvas 2D unavailable')
          if (asset.frame) ctx.drawImage(asset.source, ...asset.frame, 0, 0, canvas.width, canvas.height)
          else ctx.drawImage(asset.source, 0, 0, canvas.width, canvas.height)
          element.prepend(canvas)
        }
        if (node.actions?.click) {
          element.style.pointerEvents = 'auto'
          element.addEventListener('click', () => options.onAction!(node.actions!.click, node.id))
        }
        fragment.append(element)
      }
      // Validation/building is completed before replacing the previous surface.
      layer.style.width = `${viewport.width}px`
      layer.style.height = `${viewport.height}px`
      layer.replaceChildren(fragment)
      return geometry
    },
    dispose() { disposed = true; layer.remove() },
  }
}

const sceneComponents = new Set<string>(PRODUCTION_SURFACE_CAPABILITIES.sceneComponents)

/** Project a node-local point through the exact hierarchy/camera used for
 * rendering, then into an axis-aligned canvas box. A Playwright boundingBox is
 * top-level page space; an iframe DOMRect is iframe-local. Do not mix them.
 * This establishes coordinates, not input hit testing or gameplay correctness. */
export function sceneNodeClientPoint2d(data: SceneSpatialData, nodeId: string, viewport: UiViewport,
  canvasBox: { x: number; y: number; width: number; height: number }, localPoint: readonly [number, number] = [0, 0]) {
  if (!localPoint || localPoint.length !== 2 ||
      ![viewport.width, viewport.height, canvasBox.width, canvasBox.height].every(value => Number.isFinite(value) && value > 0) ||
      ![canvasBox.x, canvasBox.y, ...localPoint].every(Number.isFinite))
    throw new Error('Scene point projection needs a positive actual viewport/canvas box and finite local point')
  const inspection = inspectSceneLayout2d(data, viewport)
  const node = inspection.nodes.find(node => node.id === nodeId)
  if (!node || !node.enabled) throw new Error('Scene point target is missing or disabled: ' + nodeId)
  const { poses } = sceneWorldTransforms2d(data.nodes)
  const [x, y] = point2d(compose2d(inspection.worldToScreen, poses.get(nodeId)!), localPoint[0], localPoint[1])
  const rect = inspection.view.rect
  if (x < rect.x || x > rect.x + rect.width || y < rect.y || y > rect.y + rect.height)
    throw new Error('Scene point target is outside the rendered Camera: ' + nodeId)
  return { x: canvasBox.x + x / viewport.width * canvasBox.width,
    y: canvasBox.y + y / viewport.height * canvasBox.height }
}

/** Static 2D presentation only. Collision, animation and gameplay are not
 * implemented by accepting their data. Unsupported capabilities are rejected. */
export function renderProductionScene2d(canvas: HTMLCanvasElement, data: SceneSpatialData, viewport: UiViewport, assets: SurfaceAssets = new Map()) {
  const inspection = inspectSceneLayout2d(data, viewport)
  const { poses, rects } = sceneWorldTransforms2d(data.nodes)
  const nodeById = new Map(inspection.nodes.map(node => [node.id, node]))
  for (const node of data.nodes) for (const component of node.components ?? []) {
    if (!sceneComponents.has(component.type)) throw new Error(`Unsupported production Scene component: ${node.id}/${component.type}`)
    for (const field of ['frame', 'member', 'sortingOrder', 'sortingLayer', 'opacity', 'flipX', 'flipY'])
      if (component.data?.[field] !== undefined) throw new Error('Unsupported production Scene field: ' + node.id + '/' + field)
    if (component.data?.visibleWhen !== undefined) throw new Error(`Unevaluated Scene visibility: ${node.id}`)
    if (component.assetRef && !assets.has(component.assetRef)) throw new Error(`Missing decoded Scene resource: ${node.id}/${component.assetRef}`)
  }
  const staging = document.createElement('canvas')
  staging.width = viewport.width
  staging.height = viewport.height
  const ctx = staging.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')
  ctx.clearRect(0, 0, staging.width, staging.height)
  const view = inspection.view.rect
  ctx.beginPath(); ctx.rect(view.x, view.y, view.width, view.height); ctx.clip()
  for (const node of data.nodes) {
    if (!nodeById.get(node.id)?.enabled) continue
    for (const component of node.components ?? []) {
      if (component.data?.enabled === false || !['sprite-renderer', 'image', 'text'].includes(component.type)) continue
      const visual = component.data ?? {}
      const size = rects.get(node.id)?.size ?? visual.size
      if (!Array.isArray(size) || size.length !== 2 || !size.every(value => typeof value === 'number' && Number.isFinite(value) && value > 0))
        throw new Error(`Production Scene visual needs explicit size: ${node.id}`)
      const rect = node.components?.find(component => component.type === 'rect-transform')?.data
      const pivot = rect?.pivot ?? visual.anchor ?? [.5, .5]
      if (!Array.isArray(pivot) || pivot.length !== 2 || !pivot.every(Number.isFinite)) throw new Error(`Unsupported Scene pivot: ${node.id}`)
      const matrix = compose2d(inspection.worldToScreen, poses.get(node.id)!)
      ctx.save()
      ctx.setTransform(...matrix)
      const x = -pivot[0] * size[0], y = -pivot[1] * size[1]
      if (component.type === 'text') {
        if (typeof visual.text !== 'string') throw new Error(`Scene text missing: ${node.id}`)
        if (typeof visual.fontSize !== 'number' || visual.fontSize <= 0 || typeof visual.fontFamily !== 'string')
          throw new Error(`Scene text needs fontSize/fontFamily: ${node.id}`)
        ctx.font = `${visual.fontSize}px ${visual.fontFamily}`
        ctx.fillStyle = typeof visual.color === 'string' ? visual.color : '#fff'
        ctx.textBaseline = 'top'
        ctx.fillText(visual.text, x, y)
      } else if (component.assetRef) {
        const asset = assets.get(component.assetRef)!
        if (asset.frame) ctx.drawImage(asset.source, ...asset.frame, x, y, size[0], size[1])
        else ctx.drawImage(asset.source, x, y, size[0], size[1])
      } else {
        if (typeof visual.color !== 'string') throw new Error(`Scene visual needs a resource or color: ${node.id}`)
        ctx.fillStyle = visual.color
        ctx.fillRect(x, y, size[0], size[1])
      }
      ctx.restore()
    }
  }
  const destination = canvas.getContext('2d')
  if (!destination) throw new Error('Canvas 2D unavailable')
  canvas.width = staging.width; canvas.height = staging.height
  destination.drawImage(staging, 0, 0)
  return inspection
}
