import { compose2d, point2d, uiPaintOrder } from './content-coordinates'
import { inspectUiLayout, type UiLayoutInspectionOptions } from './ui-layout-inspection'
import { initializeUiLayout } from './ui-container-layout'
import { resolveUiNodesForViewport, type UiResponsiveNode, type UiViewport } from './ui-responsive'
import { inspectSceneLayout2d, sceneWorldTransforms2d, type SceneSpatialData } from './scene-layout-inspection'
import { uiImageKey, uiNodeImageSource } from './ui-preview/uiAtlas'
import { uiFontKey } from './ui-font-reference'
import { spriteSheetSelection, type parseSpriteSheet } from './sprite-sheet'

type UiNode = UiResponsiveNode & {
  role: string
  assetRef?: string
  actions?: Record<string, string>
  bindings?: Record<string, string>
}
type UiData = { rootId: string; nodes: readonly UiNode[] }
export type SurfaceImage = { source: CanvasImageSource; url: string; frame?: [number, number, number, number];
  sheet?: ReturnType<typeof parseSpriteSheet> }
export type SurfaceAssets = ReadonlyMap<string, SurfaceImage>

export function resolveSurfaceImage(assets: SurfaceAssets | undefined, assetRef: string, data: Record<string, unknown> = {}): SurfaceImage {
  const selected = assets?.get(uiImageKey(assetRef, data))
  if (selected) return selected
  const base = assets?.get(uiImageKey(assetRef, { member:data.member }))
  if (base?.sheet && (typeof data.frame === 'string' || typeof data.initialFacing === 'string')) {
    const rect = spriteSheetSelection(base.sheet, data).frame
    if (rect) return { ...base, frame:[rect.x,rect.y,rect.width,rect.height] }
  }
  throw Error('Missing decoded resource/member/frame: ' + uiImageKey(assetRef, data))
}

export const PRODUCTION_SURFACE_CAPABILITIES = {
  uiRoles: ['screen-root', 'hud-root', 'container', 'text', 'shape', 'image', 'sprite', 'button', 'tab', 'keycap', 'toast'],
  uiStyles: ['background', 'backgroundColor', 'color', 'border', 'borderColor', 'borderWidth', 'borderStyle',
    'borderRadius', 'boxShadow', 'textShadow', 'fontVariantNumeric', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'opacity', 'align', 'verticalAlign'],
  uiBindings: ['text', 'enabled', 'widthRatio', 'styleColor'],
  sceneComponents: ['camera', 'sprite-renderer', 'image', 'text', 'rect-transform',
    'box-collider-2d', 'circle-collider-2d', 'capsule-collider-2d', 'polygon-collider-2d'],
} as const
const uiRoles = new Set<string>(PRODUCTION_SURFACE_CAPABILITIES.uiRoles)
const cssFields = new Set<string>(PRODUCTION_SURFACE_CAPABILITIES.uiStyles)
const pxFields = new Set(['borderWidth', 'borderRadius', 'fontSize', 'lineHeight', 'letterSpacing'])

function drawSurfaceImage(ctx: CanvasRenderingContext2D, asset: SurfaceImage, x:number, y:number, width:number, height:number, contain=false) {
  const source = asset.source as {width?:number;height?:number;naturalWidth?:number;naturalHeight?:number}
  const [sx,sy,sw,sh] = asset.frame ?? [0,0,source.naturalWidth ?? source.width!,source.naturalHeight ?? source.height!]
  if (contain) {
    if (!(sw > 0 && sh > 0)) throw Error('Image containment needs decoded dimensions')
    const scale = Math.min(width/sw,height/sh), w=sw*scale,h=sh*scale
    ctx.drawImage(asset.source,sx,sy,sw,sh,x+(width-w)/2,y+(height-h)/2,w,h)
  } else if (asset.frame) ctx.drawImage(asset.source,...asset.frame,x,y,width,height)
  else ctx.drawImage(asset.source,x,y,width,height)
}

/** Document vocabulary, not a second layout algorithm. CSS aliases are retained
 * for existing consumers; conflicting aliases cannot silently choose a side. */
export function productionUiStyle(style: Record<string, unknown> = {}, nodeId: string) {
  const result = { ...style }
  const alias = (from: string, to: string, value = result[from]) => {
    if (result[to] !== undefined && result[to] !== value)
      throw Error(`Conflicting production UI style: ${nodeId}/${from} and ${to}`)
    result[to] = value; delete result[from]
  }
  if (result.cornerRadius !== undefined) alias('cornerRadius', 'borderRadius')
  if (result.shadow !== undefined) alias('shadow', 'boxShadow')
  if (result.background && typeof result.background === 'object') {
    const background = result.background as Record<string, unknown>
    if (Object.keys(background).some(key => key !== 'color') || typeof background.color !== 'string')
      throw Error('Unsupported production UI background: ' + nodeId)
    result.background = background.color
  }
  if (result.border && typeof result.border === 'object') {
    const border = result.border as Record<string, unknown>
    if (Object.keys(border).some(key => !['width', 'color', 'radius'].includes(key)) ||
        typeof border.width !== 'number' || !Number.isFinite(border.width) || border.width < 0 || typeof border.color !== 'string')
      throw Error('Unsupported production UI border: ' + nodeId)
    if (border.radius !== undefined) alias('border.radius', 'borderRadius', border.radius)
    result.border = `${border.width}px solid ${border.color}`
  }
  if (result.shape !== undefined) {
    if (result.shape === 'circle' || result.shape === 'ellipse') alias('shape', 'borderRadius', '50%')
    else if (['rect', 'rectangle', 'rounded-rect'].includes(String(result.shape))) delete result.shape
    else throw Error('Unsupported production UI shape: ' + nodeId)
  }
  if (result.align !== undefined) {
    if (!['left', 'center', 'right'].includes(String(result.align))) throw Error('Unsupported production UI style: ' + nodeId + '/align')
    if (result.textAlign !== undefined && result.textAlign !== result.align) throw Error('Conflicting production UI style: ' + nodeId + '/align and textAlign')
    result.textAlign = result.align
    delete result.align
  }
  if (result.verticalAlign !== undefined && !['top', 'middle', 'center', 'bottom'].includes(String(result.verticalAlign)))
    throw Error('Unsupported production UI style: ' + nodeId + '/verticalAlign')
  for (const [key, value] of Object.entries(result))
    if (!cssFields.has(key) || (typeof value !== 'string' && typeof value !== 'number'))
      throw Error('Unsupported production UI style: ' + nodeId + '/' + key)
  return result
}

/** Bind only supported properties, before shared responsive/container layout.
 * Fixed progress widths stay in the same coordinate system as the renderer. */
export function bindProductionUiNode(node: UiNode, state?: Readonly<Record<string, unknown>>): UiNode {
  const bound = { ...node, style: productionUiStyle(node.style, node.id),
    ...(node.responsive ? { responsive: Object.fromEntries(Object.entries(node.responsive).map(([key, value]) =>
      [key, { ...value, style: productionUiStyle(value.style, node.id) }])) } : {}) }
  if (node.role === 'shape') {
    for (const style of [bound.style, ...Object.values(bound.responsive ?? {}).map(variant => variant.style!)])
      if (typeof style.color === 'string' && style.background === undefined && style.backgroundColor === undefined) style.backgroundColor = style.color
  }
  for (const [property, stateKey] of Object.entries(node.bindings ?? {})) {
    if (!state || !Object.hasOwn(state, stateKey)) throw Error(`Missing UI state binding: ${node.id}/${stateKey}`)
    const value = state[stateKey]
    if (property === 'text' && (typeof value === 'string' || typeof value === 'number')) bound.text = String(value)
    else if (property === 'enabled' && typeof value === 'boolean') {
      bound.enabled = value
      for (const variant of Object.values(bound.responsive ?? {})) variant.enabled = value
    } else if (property === 'styleColor' && typeof value === 'string') {
      const key = node.role === 'text' ? 'color' : 'backgroundColor'
      bound.style[key] = value
      for (const variant of Object.values(bound.responsive ?? {})) variant.style![key] = value
    } else if (property === 'widthRatio' && typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) {
      if (!node.layout?.size || node.layout.anchorMin || node.layout.anchorMax)
        throw Error('widthRatio needs a fixed layout.size without stretch anchors: ' + node.id)
      bound.layout = { ...node.layout, size: [node.layout.size[0] * value, node.layout.size[1]] }
      for (const variant of Object.values(bound.responsive ?? {})) if (variant.layout?.size)
        variant.layout = { ...variant.layout, size: [variant.layout.size[0] * value, variant.layout.size[1]] }
    } else throw Error(`Unsupported or invalid UI binding: ${node.id}/${property}`)
  }
  return bound
}

/** Read-only static compatibility, not rendering or gameplay acceptance. */
export function inspectProductionUiSupport(data: UiData) {
  const issues: Array<{nodeId: string; property: string; reason: string}> = []
  const projectSemantics: Array<{nodeId: string; property: string}> = []
  for (const node of data.nodes) {
    const fail = (property: string, reason: string) => issues.push({nodeId: node.id, property, reason})
    if (!uiRoles.has(node.role)) fail('role', 'Unsupported shared surface role: ' + node.role)
    try { productionUiStyle(node.style, node.id) } catch (error) { fail('style', String(error)) }
    for (const field of ['visibleWhen']) if (node.data?.[field] !== undefined)
      fail('data.' + field, 'Not interpreted by the shared surface')
    const image = node.data?.image as Record<string,unknown> | undefined
    if (image?.type !== undefined && image.type !== 'simple') fail('data.image.type', 'Shared surface supports simple images only')
    if (node.data?.clipChildren === true) fail('data.clipChildren', 'Not implemented by the shared surface')
    for (const key of Object.keys(node.actions ?? {})) if (key !== 'click') fail('actions.' + key, 'Only click is supported')
    for (const key of Object.keys(node.bindings ?? {})) if (!(PRODUCTION_SURFACE_CAPABILITIES.uiBindings as readonly string[]).includes(key))
      fail('bindings.' + key, 'Unsupported shared binding; adapt only this project behavior, retaining shared layout')
    for (const variant of Object.values(node.responsive ?? {}))
      try { productionUiStyle(variant.style, node.id) } catch (error) { fail('responsive.style', String(error)) }
    for (const key of ['action', 'variant']) if (node.data?.[key] !== undefined) projectSemantics.push({nodeId: node.id, property: 'data.' + key})
  }
  const visualSources = data.nodes.filter(node => ['button', 'tab', 'shape', 'image', 'sprite', 'container'].includes(node.role)).map(node => {
    const image = uiNodeImageSource(node)
    return { nodeId: node.id, role: node.role, representation: image.assetRef ? 'bitmap' : 'procedural-or-unpainted',
      ...(image.assetRef ? { assetRef: image.assetRef, member: image.data?.member, frame: image.data?.frame } : {}) }
  })
  return {supported: issues.length === 0 && projectSemantics.length === 0, issues, projectSemantics, visualSources,
    visualDesign: 'unverified' as const,
    runtimeVerified: false, note: 'Static shared-surface compatibility only; fonts/assets, actual actions/state, geometry and appearance require execution. Project metadata is not silently translated.'}
}

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
        if (node.data?.clipChildren === true) throw new Error('Unsupported production UI clipping: ' + node.id)
        const image = node.data?.image as Record<string,unknown> | undefined
        if (image?.type !== undefined && image.type !== 'simple') throw Error('Unsupported production UI image type: ' + node.id)
        if (node.data?.font !== undefined) {
          const reference = uiFontKey(node.data.font)
          const face = reference ? options.fonts?.get(reference) : undefined
          if (!face || face.status !== 'loaded' || !document.fonts.has(face))
            throw new Error('Missing loaded production FontFace: ' + node.id)
        }
        if (node.data?.visibleWhen !== undefined) throw new Error(`Connect visibility through enabled/bindings, not an unevaluated expression: ${node.id}`)
        for (const key of Object.keys(node.actions ?? {}))
          if (key !== 'click') throw new Error(`Unsupported production UI action: ${node.id}/${key}`)
        if (node.actions?.click && !options.onAction) throw new Error(`No action handler: ${node.id}`)
        return bindProductionUiNode(node, options.state)
      })
      const nodes = resolveUiNodesForViewport(source, data.rootId, viewport, options)
      const byId = new Map(nodes.map(node => [node.id, node]))
      const geometry = inspectUiLayout(source, data.rootId, viewport, options)
      const rectangles = new Map(geometry.map(node => [node.id, node]))
      const inherited = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'textAlign', 'verticalAlign']
      const styleOf = (node: UiNode): Record<string, unknown> => {
        const chain: UiNode[] = []; let current: UiNode | undefined = node
        while (current) { chain.unshift(current); current = current.parentId ? byId.get(current.parentId) : undefined }
        const style: Record<string, unknown> = {}; let opacity = 1
        for (const ancestor of chain) {
          const fontRef = uiFontKey(ancestor.data?.font)
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
        if (width === 0 && height > 0 && node.bindings?.widthRatio) continue
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
          if (key === 'verticalAlign') continue // applied to the text's own flex alignment below
          if (!cssFields.has(key) || (typeof value !== 'string' && typeof value !== 'number'))
            throw new Error(`Unsupported production UI style: ${node.id}/${key}`)
          element.style.setProperty(key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()),
            typeof value === 'number' && pxFields.has(key) ? `${value}px` : String(value))
        }
        if (node.text !== undefined) {
          element.textContent = node.text
          element.style.display = 'flex'
          element.style.alignItems = style.verticalAlign === 'top' ? 'flex-start' : style.verticalAlign === 'bottom' ? 'flex-end' : 'center'
          element.style.justifyContent = style.textAlign === 'left' ? 'flex-start' : style.textAlign === 'right' ? 'flex-end' : 'center'
        }
        const reference = uiNodeImageSource(node)
        if (reference.assetRef) {
          const asset = resolveSurfaceImage(options.assets, reference.assetRef, reference.data)
          if (node.text !== undefined) {
            const label = document.createElement('span')
            label.textContent = node.text
            label.style.cssText = 'position:relative;z-index:1;pointer-events:none'
            element.replaceChildren(label)
          }
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(width)
          canvas.height = Math.ceil(height)
          canvas.style.cssText = 'width:100%;height:100%;position:absolute;inset:0;pointer-events:none'
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('Canvas 2D unavailable')
          drawSurfaceImage(ctx,asset,0,0,canvas.width,canvas.height,
            reference.data?.preserveAspect === true || reference.data?.preserveAspect === undefined && reference.data?.fit === 'contain')
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
    for (const field of ['sortingOrder', 'sortingLayer', 'opacity', 'flipX', 'flipY'])
      if (component.data?.[field] !== undefined) throw new Error('Unsupported production Scene field: ' + node.id + '/' + field)
    if (component.data?.visibleWhen !== undefined) throw new Error(`Unevaluated Scene visibility: ${node.id}`)
    if (component.assetRef) resolveSurfaceImage(assets, component.assetRef, component.data)
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
        const asset = resolveSurfaceImage(assets, component.assetRef, component.data)
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
