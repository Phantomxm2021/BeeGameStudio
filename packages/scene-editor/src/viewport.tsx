import { Canvas, createPortal, events as createPointerEvents, useFrame, useThree } from '@react-three/fiber'
import { Bounds, useBounds, Grid, GizmoHelper, GizmoViewport, OrbitControls, TransformControls } from '@react-three/drei'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js'
import type { ModelSelection } from './model-structure'
import { componentOf, DEFAULT_SCENE_SETTINGS } from './model'
import { LightGizmo, lightConePoints } from './light-gizmo'
import { isApplePlatform, resolveUnityNavigationAction, wheelPixels } from './navigation'
import type { NavigationAction } from './navigation'
import type { Collider2DComponent, Collider3DComponent, LightKind, MaterialOverride, SceneAsset, SceneComponent, SceneDocument, SceneNode, Transform } from './model'

export type SceneViewportMode = 'select' | 'translate' | 'rotate' | 'scale' | 'hand'
export type SceneViewMode = '2d' | '3d'
export type SceneViewportProps = {
  document: SceneDocument
  initialView?: { position: [number, number, number]; target: [number, number, number]; showGizmos?: boolean }
  selected: string
  selectedIds?: readonly string[]
  modelSelection?: ModelSelection | null
  showGizmos?: boolean
  hiddenIds?: readonly string[]
  unpickableIds?: readonly string[]
  onSelect: (id: string, modifiers?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void
  mode: SceneViewportMode
  space: 'local' | 'world'
  snap: boolean
  ortho: boolean
  viewMode: SceneViewMode
  focus: number
  onTransform: (transform: Transform) => void
  onTransformBatch?: (changes: Array<{ id: string; transform: Transform }>) => void
  onDiagnostic?: (message: string) => void
}

const identity = (): Transform => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] })
const sameTransform = (a: Transform, b: Transform) => JSON.stringify(a) === JSON.stringify(b)
function viewportEvents(state: Parameters<typeof createPointerEvents>[0]) {
  const manager = createPointerEvents(state)
  // Canvas initialization can finish after a preview has already been closed.
  return { ...manager, connect: (target: HTMLElement) => { if (target) manager.connect?.(target) } }
}
const reportOnce = (report: ((message: string) => void) | undefined) => {
  const seen = new Set<string>()
  return (message: string) => { if (!seen.has(message)) { seen.add(message); report?.(message) } }
}

/** Scene view is an authoring surface: runtime visibility expressions must not
 * make editable renderers disappear. Only an explicit editor override hides a
 * component here; the game runtime remains responsible for `visibleWhen`. */
export function componentVisibleInEditor(component: SceneComponent | undefined): boolean {
  if (!component?.enabled) return false
  const properties = 'properties' in component ? component.properties : undefined
  return properties?.visibleInEditor !== false
}

const LOOK_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><g fill="none" stroke="#11151b" stroke-width="4" stroke-linejoin="round"><path d="M2 14s4-7 12-7 12 7 12 7-4 7-12 7S2 14 2 14Z"/><circle cx="14" cy="14" r="3"/></g><g fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"><path d="M2 14s4-7 12-7 12 7 12 7-4 7-12 7S2 14 2 14Z"/><circle cx="14" cy="14" r="3"/></g></svg>')}") 14 14, crosshair`

type NavigationRef = { action: NavigationAction | null; pointerId: number | null; hand: boolean }

function NavigationController({ orbit, handMode, viewMode, onTemporarySnap }: { orbit: MutableRefObject<any>; handMode: boolean; viewMode: SceneViewMode; onTemporarySnap: (active: boolean) => void }) {
  const { camera, gl } = useThree()
  const keys = useRef(new Set<string>())
  const flySpeed = useRef(1.8)
  const navigation = useRef<NavigationRef>({ action: null, pointerId: null, hand: handMode })
  const viewportActive = useRef(false)
  navigation.current.hand = handMode
  useEffect(() => {
    const element = gl.domElement
    const updateCursor = () => {
      const action = navigation.current.action
      if (action) element.style.cursor = { orbit: 'all-scroll', pan: 'grabbing', dolly: 'ns-resize', look: LOOK_CURSOR }[action]
      else if (keys.current.has('alt')) element.style.cursor = 'grab'
      else element.style.removeProperty('cursor')
    }
    const target = () => orbit.current?.target ?? new THREE.Vector3()
    const syncTargetToView = () => {
      const distance = Math.max(.1, camera.position.distanceTo(target()))
      const direction = new THREE.Vector3()
      camera.getWorldDirection(direction)
      target().copy(camera.position).addScaledVector(direction, distance)
    }
    const pan = (dx: number, dy: number) => {
      const distance = Math.max(.1, camera.position.distanceTo(target()))
      const amount = (camera as THREE.OrthographicCamera).isOrthographicCamera ? 1 / Math.max(1, (camera as THREE.OrthographicCamera).zoom) : distance * .0015
      camera.updateMatrixWorld()
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0)
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1)
      const delta = right.multiplyScalar(-dx * amount).add(up.multiplyScalar(dy * amount))
      camera.position.add(delta); target().add(delta); orbit.current?.update()
    }
    const orbitCamera = (dx: number, dy: number) => {
      const pivot = target(); const offset = camera.position.clone().sub(pivot)
      const spherical = new THREE.Spherical().setFromVector3(offset)
      spherical.theta -= dx * .005; spherical.phi = THREE.MathUtils.clamp(spherical.phi - dy * .005, .01, Math.PI - .01)
      camera.position.copy(pivot).add(new THREE.Vector3().setFromSpherical(spherical)); camera.lookAt(pivot); orbit.current?.update()
    }
    const dolly = (dy: number, sensitivity = .01) => {
      const ortho = camera as THREE.OrthographicCamera
      if (ortho.isOrthographicCamera) {
        ortho.zoom = THREE.MathUtils.clamp(ortho.zoom * Math.exp(-dy * sensitivity), .01, 1e4)
        ortho.updateProjectionMatrix()
      } else {
        const pivot = target()
        const offset = camera.position.clone().sub(pivot)
        const distance = THREE.MathUtils.clamp(offset.length() * Math.exp(dy * sensitivity), .01, 1e6)
        if (!offset.lengthSq()) offset.set(0, 0, 1)
        camera.position.copy(pivot).add(offset.setLength(distance))
      }
      orbit.current?.update()
    }
    const look = (dx: number, dy: number) => {
      const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
      euler.y -= dx * .004; euler.x = THREE.MathUtils.clamp(euler.x - dy * .004, -Math.PI / 2 + .01, Math.PI / 2 - .01); camera.quaternion.setFromEuler(euler); syncTargetToView(); orbit.current?.update()
    }
    const pointerDown = (event: PointerEvent) => {
      viewportActive.current = true
      const action = resolveUnityNavigationAction(event, {
        viewMode,
        handMode: navigation.current.hand,
        apple: isApplePlatform(window.navigator),
      })
      // TransformControls disables OrbitControls while a gizmo drag is active;
      // keep every camera gesture locked for that duration as well.
      if (!action || (orbit.current && orbit.current.enabled === false && navigation.current.action === null)) return
      element.focus({ preventScroll: true })
      event.preventDefault(); event.stopImmediatePropagation(); navigation.current = { action, pointerId: event.pointerId, hand: navigation.current.hand }; element.setPointerCapture(event.pointerId); if (action === 'look') syncTargetToView(); if (orbit.current) orbit.current.enabled = false
      updateCursor()
    }
    const pointerMove = (event: PointerEvent) => {
      const state = navigation.current; if (!state.action || state.pointerId !== event.pointerId) return
      event.preventDefault(); event.stopImmediatePropagation()
      const movementRate = event.shiftKey ? 3 : 1
      if (state.action === 'orbit') orbitCamera(event.movementX, event.movementY)
      else if (state.action === 'pan') pan(event.movementX * movementRate, event.movementY * movementRate)
      else if (state.action === 'dolly') dolly(event.movementY * movementRate)
      else look(event.movementX, event.movementY)
    }
    const resetNavigation = (pointerId?: number) => {
      const current = navigation.current
      if (pointerId !== undefined && current.pointerId !== pointerId) return
      navigation.current = { action: null, pointerId: null, hand: navigation.current.hand }
      if (current.pointerId !== null && element.hasPointerCapture(current.pointerId)) element.releasePointerCapture(current.pointerId)
      keys.current.clear(); viewportActive.current = false; onTemporarySnap(false); if (orbit.current) orbit.current.enabled = true
      updateCursor()
    }
    const pointerUp = (event: PointerEvent) => { if (navigation.current.pointerId !== event.pointerId) return; event.preventDefault(); event.stopImmediatePropagation(); resetNavigation(event.pointerId) }
    const isTextInput = (target: EventTarget | null) => target instanceof HTMLElement && (target.matches('input,textarea,select,[contenteditable="true"]') || target.isContentEditable)
    const keyDown = (event: KeyboardEvent) => {
      if (isTextInput(event.target)) return
      const active = viewportActive.current || navigation.current.action !== null || document.activeElement === element
      if (!active) return
      const key = event.key.toLowerCase()
      if (key === 'escape' && navigation.current.action) { event.preventDefault(); resetNavigation(); return }
      if (navigation.current.action === 'look' && ['w', 'a', 's', 'd', 'q', 'e', 'shift', 'r'].includes(key)) { event.preventDefault(); event.stopImmediatePropagation() }
      if (viewMode === '3d' && ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) { event.preventDefault(); event.stopImmediatePropagation() }
      keys.current.add(key)
      updateCursor()
      if (event.key === 'Control' || event.key === 'Meta') onTemporarySnap(true)
    }
    const keyUp = (event: KeyboardEvent) => {
      if (isTextInput(event.target)) return
      keys.current.delete(event.key.toLowerCase()); if (event.key === 'Control' || event.key === 'Meta') onTemporarySnap(false)
      updateCursor()
    }
    const blur = () => resetNavigation()
    const outsidePointerDown = (event: PointerEvent) => { if (event.target !== element) viewportActive.current = false }
    const pointerEnter = () => { viewportActive.current = true }
    const pointerLeave = () => { if (navigation.current.action === null) viewportActive.current = false }
    const contextMenu = (event: MouseEvent) => event.preventDefault()
    const wheel = (event: WheelEvent) => {
      viewportActive.current = true
      const delta = wheelPixels(event, element.clientHeight) * (event.shiftKey ? 3 : 1)
      // Unity uses the wheel/two-finger vertical gesture for zoom. During
      // Flythrough the same gesture changes camera speed instead.
      if (navigation.current.action === 'look') flySpeed.current = THREE.MathUtils.clamp(flySpeed.current * Math.exp(-delta * .0015), .1, 50)
      else dolly(delta, .0015)
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const lostCapture = (event: PointerEvent) => resetNavigation(event.pointerId)
    element.addEventListener('lostpointercapture', lostCapture)
    element.addEventListener('contextmenu', contextMenu, true)
    element.addEventListener('pointerdown', pointerDown, true); element.addEventListener('pointermove', pointerMove, true); element.addEventListener('pointerup', pointerUp, true); element.addEventListener('pointercancel', pointerUp, true)
    element.addEventListener('pointerenter', pointerEnter, true); element.addEventListener('pointerleave', pointerLeave, true)
    element.addEventListener('wheel', wheel, { capture: true, passive: false })
    window.addEventListener('pointerdown', outsidePointerDown, true)
    window.addEventListener('keydown', keyDown, true); window.addEventListener('keyup', keyUp, true); window.addEventListener('blur', blur)
    let frame = 0
    let lastTime = performance.now()
    const fly = () => {
      const now = performance.now(); const dt = THREE.MathUtils.clamp((now - lastTime) / 1000, 0, .1); lastTime = now
      const state = navigation.current
      if (state.action === 'look' || (viewMode === '3d' && ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].some(key => keys.current.has(key)))) {
        const direction = new THREE.Vector3(); camera.getWorldDirection(direction)
        const right = new THREE.Vector3().crossVectors(direction, camera.up).normalize(); const up = camera.up.clone().normalize(); const delta = new THREE.Vector3()
        if (state.action === 'look') {
          if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
            if (keys.current.has('w')) delta.add(up); if (keys.current.has('s')) delta.sub(up); if (keys.current.has('a')) delta.sub(right); if (keys.current.has('d')) delta.add(right)
          } else {
            if (keys.current.has('w')) delta.add(direction); if (keys.current.has('s')) delta.sub(direction); if (keys.current.has('a')) delta.sub(right); if (keys.current.has('d')) delta.add(right); if (keys.current.has('q')) delta.sub(up); if (keys.current.has('e')) delta.add(up)
          }
        }
        if (keys.current.has('arrowup')) delta.add(direction); if (keys.current.has('arrowdown')) delta.sub(direction); if (keys.current.has('arrowleft')) delta.sub(right); if (keys.current.has('arrowright')) delta.add(right)
        if (delta.lengthSq()) { delta.normalize().multiplyScalar(flySpeed.current * (keys.current.has('shift') ? 4 : 1) * dt); camera.position.add(delta); target().add(delta); orbit.current?.update() }
      }
      frame = requestAnimationFrame(fly)
    }
    frame = requestAnimationFrame(fly)
    return () => { cancelAnimationFrame(frame); resetNavigation(); element.removeEventListener('lostpointercapture', lostCapture); element.removeEventListener('contextmenu', contextMenu, true); element.removeEventListener('pointerdown', pointerDown, true); element.removeEventListener('pointermove', pointerMove, true); element.removeEventListener('pointerup', pointerUp, true); element.removeEventListener('pointercancel', pointerUp, true); element.removeEventListener('pointerenter', pointerEnter, true); element.removeEventListener('pointerleave', pointerLeave, true); element.removeEventListener('wheel', wheel, true); window.removeEventListener('pointerdown', outsidePointerDown, true); window.removeEventListener('keydown', keyDown, true); window.removeEventListener('keyup', keyUp, true); window.removeEventListener('blur', blur); if (orbit.current) orbit.current.enabled = true }
  }, [camera, gl, orbit, onTemporarySnap, viewMode])
  return null
}

function worldPosition(document: SceneDocument, id: string) {
  const result = new THREE.Vector3()
  const chain: SceneNode[] = []
  let current: SceneNode | undefined = document.nodes[id]
  while (current) { chain.unshift(current); current = current.parentId ? document.nodes[current.parentId] : undefined }
  const matrix = new THREE.Matrix4()
  for (const node of chain) {
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...node.transform.rotation))
    matrix.multiply(new THREE.Matrix4().compose(new THREE.Vector3(...node.transform.position), rotation, new THREE.Vector3(...node.transform.scale)))
  }
  result.setFromMatrixPosition(matrix)
  return result
}

function CameraRig({ document, selected, modelSelection, focus, orbit }: { document: SceneDocument; selected: string; modelSelection?: ModelSelection | null; focus: number; orbit: MutableRefObject<any> }) {
  const { camera, scene, size } = useThree()
  const documentRef = useRef(document)
  const selectedRef = useRef(selected)
  const partRef = useRef(modelSelection)
  partRef.current = modelSelection
  documentRef.current = document
  selectedRef.current = selected
  const cameraNode = Object.values(document.nodes).find(node => componentOf(node, 'camera'))
  const cameraComponent = cameraNode ? componentOf(cameraNode, 'camera') : undefined
  const orthographicSize = cameraComponent?.orthographicSize ?? 3.6
  useEffect(() => {
    if (!document.dimension || !(camera as THREE.OrthographicCamera).isOrthographicCamera) return
    const orthographic = camera as THREE.OrthographicCamera
    orthographic.zoom = size.height / Math.max(.01, orthographicSize * 2)
    orthographic.updateProjectionMatrix()
  }, [camera, document.dimension, orthographicSize, size.height])
  useEffect(() => {
    const id = selectedRef.current
    if (!focus || !documentRef.current.nodes[id]) return
    scene.updateMatrixWorld(true)
    const object = selectedObject(scene, id, partRef.current)
    const bounds = object ? new THREE.Box3().setFromObject(object) : new THREE.Box3()
    const target = bounds.isEmpty() ? worldPosition(documentRef.current, id) : bounds.getCenter(new THREE.Vector3())
    const radius = bounds.isEmpty() ? 1 : Math.max(.25, bounds.getSize(new THREE.Vector3()).length() / 2)
    const direction = camera.position.clone().sub(orbit.current?.target ?? target).normalize()
    if (!direction.lengthSq()) direction.set(1, .7, 1).normalize()
    const orthographic = camera as THREE.OrthographicCamera
    const distance = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? radius / Math.sin(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov) / 2) * 1.3 : radius * 4
    camera.position.copy(target).addScaledVector(direction, distance)
    if (orthographic.isOrthographicCamera) { orthographic.zoom = Math.min(size.width, size.height) / (radius * 2.6); orthographic.updateProjectionMatrix() }
    orbit.current?.target.copy(target)
    orbit.current?.update()
  }, [camera, focus, orbit, scene])
  return null
}

function decodeAsset(asset: SceneAsset): ArrayBuffer {
  const value = asset.bytes ?? ''
  const encoded = value.startsWith('data:') ? value.slice(value.indexOf(',') + 1) : value
  const binary = atob(encoded)
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function assetForUri(uri: string, assets: Record<string, SceneAsset>) {
  if (/^[a-z][a-z\d+.-]*:/i.test(uri) || uri.startsWith('//')) return undefined
  const clean = decodeURIComponent(uri.split('?')[0].replaceAll('\\', '/'))
  const normalized: string[] = []
  for (const segment of clean.split('/')) {
    if (segment === '..') { if (!normalized.length) return undefined; normalized.pop() }
    else if (segment && segment !== '.') normalized.push(segment)
  }
  const path = normalized.join('/')
  const exact = Object.values(assets).find(asset => asset.path.replaceAll('\\', '/') === path)
  if (exact) return exact
  // A multi-file picker may provide only basenames. An ambiguous basename
  // must never silently resolve to another model's texture or buffer.
  const candidates = Object.values(assets).filter(asset => asset.path.split('/').at(-1) === normalized.at(-1))
  return candidates.length === 1 ? candidates[0] : undefined
}

function cloneOwned(object: THREE.Object3D) {
  const cloned = cloneSkeleton(object)
  cloned.traverse(child => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry = mesh.geometry.clone()
    if (mesh.material) {
      const wasArray = Array.isArray(mesh.material)
      const source = wasArray ? mesh.material as THREE.Material[] : [mesh.material as THREE.Material]
      const materials = source.map(material => {
        const copy = material.clone()
        for (const key of Object.keys(copy)) {
          const value = (copy as any)[key]
          if (value?.isTexture) (copy as any)[key] = value.clone()
        }
        return copy
      })
      mesh.material = wasArray ? materials : materials[0]
    }
  })
  return cloned
}

function disposeOwned(object: THREE.Object3D | null | undefined) {
  object?.traverse(child => {
    const mesh = child as THREE.Mesh
    mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials ?? []) {
      if (!material) continue
      for (const key of Object.keys(material)) { const value = (material as any)[key]; if (value?.isTexture) value.dispose() }
      material.dispose()
    }
  })
}

function localAssetUri(asset: SceneAsset | undefined) { return asset?.bytes?.startsWith('data:') ? asset.bytes : asset?.uri }

export function applyTextureRegion(
  texture: THREE.Texture,
  region: MaterialOverride['textureRegion'],
): boolean {
  const image = texture.image as { width?: number; height?: number }
  const imageWidth = image.width ?? 0, imageHeight = image.height ?? 0
  if (
    !region ||
    region.x + region.width > imageWidth ||
    region.y + region.height > imageHeight
  ) return false
  texture.repeat.set(region.width / imageWidth, region.height / imageHeight)
  texture.offset.set(region.x / imageWidth, 1 - (region.y + region.height) / imageHeight)
  texture.needsUpdate = true
  return true
}

function useLocalTexture(uri: string | undefined, region?: MaterialOverride['textureRegion'], onDiagnostic?: (message: string) => void) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    let alive = true
    let loaded: THREE.Texture | null = null
    setTexture(null)
    if (!uri) return () => { alive = false }
    const loader = new THREE.TextureLoader()
    loader.load(uri, next => {
      if (!alive) { next.dispose(); return }
      loaded = next
      next.colorSpace = THREE.SRGBColorSpace
      if (region && !applyTextureRegion(next, region)) {
        onDiagnostic?.('Texture region falls outside the decoded image')
      }
      setTexture(next)
    }, undefined, () => onDiagnostic?.('Local texture asset could not be decoded'))
    return () => { alive = false; loaded?.dispose() }
  }, [uri, region?.x, region?.y, region?.width, region?.height, onDiagnostic])
  return texture
}

function materialProps(material: MaterialOverride | undefined, texture: THREE.Texture | null) {
  if (!material) return { color: '#8192b5', opacity: 1, transparent: false }
  return { color: material.color, opacity: material.opacity, transparent: material.alphaMode === 'blend', depthWrite: material.alphaMode !== 'blend', alphaTest: material.alphaMode === 'mask' ? .5 : 0, map: texture ?? undefined }
}

type Preview2D = {
  sprite?: {
    frameWidth?: number; frameHeight?: number; framesPerFacing?: number
    facings?: string[]; initialFacing?: string; frameDurationMs?: number[]; loop?: boolean
  }
  motion?: { kind?: string; amplitudePx?: number; speedPxPerSec?: number; periodSecs?: number | { min?: number; max?: number } }
  patrol?: {
    mode?: 'loop' | 'pingpong'
    startDelaySecs?: number
    waypoints?: Array<{ x?: number; y?: number; pauseSecs?: number }>
    returnPath?: Array<{ x?: number; y?: number; pauseSecs?: number }>
  }
  animation?: {
    kind?: string; periodSecs?: number; scaleMin?: number; scaleMax?: number
    alphaMin?: number; alphaMax?: number; alphaFrom?: number; alphaTo?: number; durationSecs?: number; delaySecs?: number
  }
  blend?: string
  emitter?: {
    textureAssetId?: string; count?: number; maxParticles?: number; blend?: string; tint?: string
    particleSize?: { min?: number; max?: number }
    zone?: { x?: number; y?: number; width?: number; height?: number }
    alpha?: { min?: number; max?: number }
    motion?: { amplitudePx?: number; periodSecs?: { min?: number; max?: number } }
  }
}

function preview2d(node: SceneNode): Preview2D | undefined {
  const sprite = componentOf(node, 'sprite-renderer')
  const particle = componentOf(node, 'particle-system')
  const particleRenderer = componentOf(node, 'particle-system-renderer')
  return {
    ...(sprite?.animation ? { sprite: sprite.animation } : {}),
    ...(node.metadata?.motion && typeof node.metadata.motion === 'object' ? { motion: node.metadata.motion as Preview2D['motion'] } : {}),
    ...(node.metadata?.patrol && typeof node.metadata.patrol === 'object' ? { patrol: node.metadata.patrol as Preview2D['patrol'] } : {}),
    ...(node.metadata?.animation && typeof node.metadata.animation === 'object' ? { animation: node.metadata.animation as Preview2D['animation'] } : {}),
    ...(typeof node.metadata?.blend === 'string' ? { blend: node.metadata.blend } : {}),
    ...(particle ? { emitter: { ...particle.properties, ...particleRenderer?.properties, textureAssetId: particleRenderer?.textureAssetId ?? particleRenderer?.assetId } as Preview2D['emitter'] } : {}),
  }
}

export function rendererSize(node: SceneNode): [number, number] {
  const renderer = componentOf(node, 'sprite-renderer') ?? componentOf(node, 'image') ?? componentOf(node, 'tilemap')
  const properties = renderer && 'properties' in renderer ? renderer.properties : undefined
  const value = properties?.size
  const sprite = properties?.sprite
  const logical = sprite && typeof sprite === 'object' && !Array.isArray(sprite) ? (sprite as Record<string, unknown>).logicalSize : undefined
  const rect = componentOf(node, 'rect-transform')
  const rectSize = rect?.sizeDelta
  const size = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown>
    : logical && typeof logical === 'object' && !Array.isArray(logical) ? logical as Record<string, unknown>
    : rectSize ? { width: rectSize[0] * 100, height: rectSize[1] * 100 }
    : undefined
  const width = typeof size?.width === 'number' && Number.isFinite(size.width) ? size.width : 100
  const height = typeof size?.height === 'number' && Number.isFinite(size.height) ? size.height : 100
  return [Math.max(1, width) / 100, Math.max(1, height) / 100]
}

function patrolPosition(patrol: NonNullable<Preview2D['patrol']>, elapsedSecs: number): { x: number; y: number } | undefined {
  const forward = patrol.waypoints?.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)) ?? []
  if (!forward.length) return undefined
  const points = patrol.mode === 'pingpong'
    ? [...forward, ...forward.slice(1, -1).reverse()]
    : [...forward, ...(patrol.returnPath?.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)) ?? [])]
  if (points.length === 1) return { x: points[0].x! / 100, y: points[0].y! / 100 }
  const startDelay = Math.max(0, patrol.startDelaySecs ?? 0)
  if (elapsedSecs <= startDelay) return { x: points[0].x! / 100, y: points[0].y! / 100 }
  const speed = 80
  const segments = points.map((point, index) => {
    const next = points[(index + 1) % points.length]
    const distance = Math.hypot(next.x! - point.x!, next.y! - point.y!)
    return { point, next, travelSecs: distance / speed, pauseSecs: Math.max(0, point.pauseSecs ?? 0) }
  })
  const cycleSecs = segments.reduce((sum, segment) => sum + segment.travelSecs + segment.pauseSecs, 0)
  let cursor = (elapsedSecs - startDelay) % Math.max(.1, cycleSecs)
  for (const segment of segments) {
    if (cursor < segment.pauseSecs) return { x: segment.point.x! / 100, y: segment.point.y! / 100 }
    cursor -= segment.pauseSecs
    if (cursor <= segment.travelSecs) {
      const progress = segment.travelSecs > 0 ? cursor / segment.travelSecs : 1
      return {
        x: THREE.MathUtils.lerp(segment.point.x!, segment.next.x!, progress) / 100,
        y: THREE.MathUtils.lerp(segment.point.y!, segment.next.y!, progress) / 100,
      }
    }
    cursor -= segment.travelSecs
  }
  return { x: points[0].x! / 100, y: points[0].y! / 100 }
}

function spriteFrameAt(sprite: NonNullable<Preview2D['sprite']>, elapsedMs: number): number {
  const framesPerFacing = Math.max(1, Math.floor(sprite.framesPerFacing ?? 1))
  if (sprite.loop === false || framesPerFacing === 1) return 0
  const facingIndex = Math.max(0, sprite.facings?.indexOf(sprite.initialFacing ?? '') ?? 0)
  const offset = facingIndex * framesPerFacing
  const durations = Array.from({ length: framesPerFacing }, (_, index) => Math.max(16, sprite.frameDurationMs?.[offset + index] ?? 100))
  const cycle = durations.reduce((sum, value) => sum + value, 0)
  let cursor = elapsedMs % cycle
  for (let index = 0; index < durations.length; index += 1) {
    if (cursor < durations[index]) return index
    cursor -= durations[index]
  }
  return 0
}

function Primitive({ node, assets, diagnose }: { node: SceneNode; assets: Record<string, SceneAsset>; diagnose: (message: string) => void }) {
  const renderer = componentOf(node, 'sprite-renderer') ?? componentOf(node, 'image')
  const tilemap = componentOf(node, 'tilemap')
  const tilemapRenderer = componentOf(node, 'tilemap-renderer')
  const materialData = renderer?.material
    ?? (tilemapRenderer && tilemap ? { ...tilemapRenderer.material, textureAssetId: tilemap.assetId } : undefined)
  const texture = useLocalTexture(localAssetUri(materialData?.textureAssetId ? assets[materialData.textureAssetId] : undefined), materialData?.textureRegion, diagnose)
  const sprite = preview2d(node)?.sprite
  const frame = useRef(-1)
  useFrame(({ clock }) => {
    if (!texture || !sprite?.frameWidth || !sprite.frameHeight) return
    const nextFrame = spriteFrameAt(sprite, clock.elapsedTime * 1000)
    if (frame.current === nextFrame) return
    frame.current = nextFrame
    const image = texture.image as { width?: number; height?: number }
    const imageWidth = image.width ?? 0, imageHeight = image.height ?? 0
    const framesPerFacing = Math.max(1, Math.floor(sprite.framesPerFacing ?? 1))
    const facingIndex = Math.max(0, sprite.facings?.indexOf(sprite.initialFacing ?? '') ?? 0)
    const x = (facingIndex * framesPerFacing + nextFrame) * sprite.frameWidth
    if (x + sprite.frameWidth > imageWidth || sprite.frameHeight > imageHeight) return
    texture.repeat.set(sprite.frameWidth / imageWidth, sprite.frameHeight / imageHeight)
    texture.offset.set(x / imageWidth, 1 - sprite.frameHeight / imageHeight)
    texture.needsUpdate = true
  })
  const props = materialProps(materialData, texture)
  const blending = preview2d(node)?.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending
  // A material compiled without a map will not necessarily acquire the map's
  // shader defines when an asynchronous texture arrives. Recreate it once the
  // texture identity changes so image-backed 2D planes stop rendering white.
  const materialKey = texture?.uuid ?? 'no-texture'
  const material = materialData?.mode === 'standard' ? <meshStandardMaterial key={materialKey} {...props} blending={blending} metalness={materialData.metalness} roughness={materialData.roughness} /> : <meshBasicMaterial key={materialKey} {...props} blending={blending} />
  if (!(componentVisibleInEditor(renderer) || (componentVisibleInEditor(tilemap) && componentVisibleInEditor(tilemapRenderer)))) return null
  return <mesh castShadow receiveShadow scale={[...rendererSize(node), 1]}><planeGeometry args={[1, 1]} />{material}</mesh>
}

function seeded(index: number, salt: number): number {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453
  return value - Math.floor(value)
}

function ParticleEmitterPreview({ node, assets, diagnose }: { node: SceneNode; assets: Record<string, SceneAsset>; diagnose: (message: string) => void }) {
  const particle = componentOf(node, 'particle-system')
  const renderer = componentOf(node, 'particle-system-renderer')
  if (!componentVisibleInEditor(particle) || !componentVisibleInEditor(renderer)) return null
  const emitter = preview2d(node)?.emitter
  const texture = useLocalTexture(localAssetUri(emitter?.textureAssetId ? assets[emitter.textureAssetId] : undefined), undefined, diagnose)
  const root = useRef<THREE.Group>(null)
  const count = Math.max(0, Math.min(256, Math.floor(emitter?.count ?? emitter?.maxParticles ?? 0)))
  const particles = useMemo(() => Array.from({ length: count }, (_, index) => {
    const zone = emitter?.zone
    const sizeMin = emitter?.particleSize?.min ?? 3, sizeMax = emitter?.particleSize?.max ?? sizeMin
    return {
      x: ((zone?.x ?? 0) + seeded(index, 1) * (zone?.width ?? 0)) / 100,
      y: ((zone?.y ?? 0) + seeded(index, 2) * (zone?.height ?? 0)) / 100,
      size: (sizeMin + seeded(index, 3) * (sizeMax - sizeMin)) / 100,
      phase: seeded(index, 4) * Math.PI * 2,
      speed: (emitter?.motion?.periodSecs?.min ?? 3) + seeded(index, 5) * ((emitter?.motion?.periodSecs?.max ?? 6) - (emitter?.motion?.periodSecs?.min ?? 3)),
      opacity: (emitter?.alpha?.min ?? .35) + seeded(index, 6) * ((emitter?.alpha?.max ?? .9) - (emitter?.alpha?.min ?? .35)),
    }
  }), [count, emitter])
  useFrame(({ clock }) => {
    if (!root.current) return
    root.current.children.forEach((child, index) => {
      const particle = particles[index]
      if (!particle) return
      const wave = clock.elapsedTime * Math.PI * 2 / Math.max(.1, particle.speed) + particle.phase
      child.position.x = particle.x + Math.sin(wave) * (emitter?.motion?.amplitudePx ?? 0) / 100
      child.position.y = particle.y + Math.cos(wave * .7) * (emitter?.motion?.amplitudePx ?? 0) / 200
      const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial
      material.opacity = particle.opacity * (.7 + .3 * Math.sin(wave))
    })
  })
  if (!emitter || !texture) return null
  return <group ref={root}>{particles.map((particle, index) => <mesh key={index} position={[particle.x, particle.y, index * .0001]}>
    <planeGeometry args={[particle.size, particle.size]} />
    <meshBasicMaterial map={texture} color={emitter.tint ?? '#ffffff'} transparent opacity={particle.opacity} depthWrite={false} blending={emitter.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending} toneMapped={false} />
  </mesh>)}</group>
}

function ModelAsset({ asset, override, assets, diagnose, onReady }: { asset: SceneAsset | undefined; override: MaterialOverride | undefined; assets: Record<string, SceneAsset>; diagnose: (message: string) => void; onReady?: () => void }) {
  const [prototype, setPrototype] = useState<THREE.Object3D | null>(null)
  const [error, setError] = useState(false)
  const [animations, setAnimations] = useState<THREE.AnimationClip[]>([])
  const mixer = useRef<THREE.AnimationMixer | null>(null)
  const overrideTexture = useLocalTexture(localAssetUri(override?.textureAssetId ? assets[override.textureAssetId] : undefined), override?.textureRegion, diagnose)
  const assetKey = Object.values(assets).map(item => `${item.id}:${item.path}:${item.bytes ?? ''}`).sort().join('|')
  useEffect(() => {
    let alive = true
    setError(false); setPrototype(null); setAnimations([])
    if (!asset?.bytes) { diagnose('Model node has no local asset bytes'); return () => { alive = false } }
    let parsed: THREE.Object3D | null = null
    try {
      const manager = new THREE.LoadingManager()
      manager.setURLModifier(url => {
        if (url.startsWith('data:') || url.startsWith('blob:')) return url
        const dependency = assetForUri(url, assets)
        if (!dependency?.bytes) { diagnose(`Missing local model dependency: ${url}`); return 'data:application/octet-stream;base64,' }
        return dependency.bytes
      })
      const loader = new GLTFLoader(manager)
      loader.parse(decodeAsset(asset), asset.path.slice(0, asset.path.lastIndexOf('/') + 1), result => {
        if (!alive) { disposeOwned(result.scene); return }
        result.scene.traverse(object => { const index = result.parser.associations.get(object)?.nodes; if (index !== undefined) object.userData.modelNodeIndex = index; if (object instanceof THREE.Mesh) { const materials = Array.isArray(object.material) ? object.material : [object.material]; object.castShadow = materials.some(material => !material.transparent && material.type !== 'MeshBasicMaterial'); object.receiveShadow = true } }); parsed = result.scene; setAnimations(result.animations); setPrototype(result.scene)
      }, errorValue => { if (alive) { setError(true); diagnose(`Unable to load local model ${asset.path}: ${String(errorValue)}`) } })
    } catch (errorValue) { setError(true); diagnose(`Unable to decode local model ${asset.path}: ${String(errorValue)}`) }
    return () => { alive = false; if (parsed) disposeOwned(parsed) }
  }, [asset?.id, asset?.path, asset?.bytes, assetKey, diagnose])
  const display = useMemo(() => {
    if (!prototype) return null
    const result = cloneOwned(prototype)
    if (override) {
      result.traverse(child => {
        const mesh = child as THREE.Mesh
        if (!mesh.material) return
        const wasArray = Array.isArray(mesh.material)
        const materials = wasArray ? mesh.material as THREE.Material[] : [mesh.material as THREE.Material]
        const replacements = materials.map(old => {
          for (const value of Object.values(old)) if (value?.isTexture) value.dispose()
          old.dispose()
          const next = override.mode === 'unlit' ? new THREE.MeshBasicMaterial() : new THREE.MeshStandardMaterial()
          next.color.set(override.color); if (next instanceof THREE.MeshStandardMaterial) { next.metalness = override.metalness; next.roughness = override.roughness } next.opacity = override.opacity; next.transparent = override.alphaMode === 'blend'; next.alphaTest = override.alphaMode === 'mask' ? .5 : 0; if (overrideTexture) next.map = overrideTexture.clone(); return next
        })
        mesh.material = wasArray ? replacements : replacements[0]
      })
    }
    return result
  }, [prototype, override, overrideTexture])
  useEffect(() => () => disposeOwned(display), [display])
  useEffect(() => { if (display) onReady?.() }, [display, onReady])
  useEffect(() => {
    if (!display || !animations.length) return
    const playback = new THREE.AnimationMixer(display)
    mixer.current = playback
    playback.clipAction(animations[0]).play()
    return () => { playback.stopAllAction(); playback.uncacheRoot(display); mixer.current = null }
  }, [display, animations])
  useFrame((_, delta) => mixer.current?.update(Math.min(delta, .1)))
  if (error) return <mesh><boxGeometry args={[1, 1, 1]} /><meshBasicMaterial color="#ad5964" wireframe /></mesh>
  return display ? <primitive object={display} /> : <mesh><boxGeometry args={[1, 1, 1]} /><meshBasicMaterial color="#65738a" wireframe /></mesh>
}

function PreviewModel({ asset, assets, onDiagnostic }: { asset: SceneAsset; assets: Record<string, SceneAsset>; onDiagnostic: (message: string) => void }) {
  const bounds = useBounds()
  const fit = useCallback(() => { bounds.refresh().clip().fit() }, [bounds])
  return <ModelAsset asset={asset} assets={assets} override={undefined} diagnose={onDiagnostic} onReady={fit} />
}

/** Read-only asset preview: the model never enters the editing scene. */
export function AssetModelPreview({ asset, assets, onDiagnostic }: { asset: SceneAsset; assets: Record<string, SceneAsset>; onDiagnostic: (message: string) => void }) {
  return <Canvas events={viewportEvents} camera={{ position: [4, 3, 4], fov: 45 }}>
    <color attach="background" args={['#303339']} />
    <ambientLight intensity={2} /><directionalLight position={[4, 6, 5]} intensity={2} />
    <OrbitControls makeDefault enableDamping />
    <Bounds fit clip margin={1.3} observe><PreviewModel asset={asset} assets={assets} onDiagnostic={onDiagnostic} /></Bounds>
  </Canvas>
}

function Volume2D({ volume }: { volume: Collider2DComponent }) {
  const material = <meshBasicMaterial color={volume.isTrigger ? '#e27ac2' : '#4ea3db'} wireframe transparent opacity={.55} depthWrite={false} />
  if (volume.type === 'circle-collider-2d') return <mesh userData={{ editorHelper: true }} position={[volume.offset[0], volume.offset[1], .002]} scale={[volume.radius * 2, volume.radius * 2, 1]}><circleGeometry args={[.5, 32]} />{material}</mesh>
  if (volume.type === 'polygon-collider-2d') {
    const shape = new THREE.Shape(); volume.points.forEach(([x, y], index) => index ? shape.lineTo(x, y) : shape.moveTo(x, y)); shape.closePath()
    return <mesh userData={{ editorHelper: true }} position={[volume.offset[0], volume.offset[1], .002]}><shapeGeometry args={[shape]} />{material}</mesh>
  }
  return <mesh userData={{ editorHelper: true }} position={[volume.offset[0], volume.offset[1], .002]} scale={[volume.size[0], volume.size[1], 1]}><planeGeometry args={[1, 1]} />{material}</mesh>
}

function Volume3D({ volume }: { volume: Collider3DComponent }) {
  const material = <meshBasicMaterial color={volume.isTrigger ? '#e27ac2' : '#4ea3db'} wireframe transparent opacity={.55} depthWrite={false} />
  if (volume.type === 'sphere-collider') return <mesh userData={{ editorHelper: true }} position={volume.center} scale={[volume.radius, volume.radius, volume.radius]}><sphereGeometry args={[1, 16, 12]} />{material}</mesh>
  if (volume.type === 'capsule-collider') return <mesh userData={{ editorHelper: true }} position={volume.center}><capsuleGeometry args={[volume.radius, Math.max(0, volume.height - volume.radius * 2), 8, 16]} />{material}</mesh>
  if (volume.type === 'box-collider') return <mesh userData={{ editorHelper: true }} position={volume.center} scale={volume.size}><boxGeometry args={[1, 1, 1]} />{material}</mesh>
  return null
}

function selectedObject(scene: THREE.Scene, id: string, part?: ModelSelection | null) {
  const owner = scene.getObjectByName(id)
  if (!owner || !part || part.ownerId !== id) return owner
  let selected: THREE.Object3D | undefined
  owner.traverse(object => { if (object.userData.modelNodeIndex === part.nodeIndex) selected = object })
  return selected
}

function SelectionOutline({ selectedIds, modelSelection, color, width }: { selectedIds: readonly string[]; modelSelection?: ModelSelection | null; color: string; width: number }) {
  const { gl, scene, camera, size } = useThree()
  const outlineRef = useRef<OutlinePass | null>(null)
  useEffect(() => {
    const outline = new OutlinePass(new THREE.Vector2(1, 1), scene, camera)
    outline.hiddenEdgeColor.set('#000000')
    outline.visibleEdgeColor.set('#ffffff')
    outline.downSampleRatio = 1
    // Draw a colored contour rather than the pass's additive glow: this keeps
    // the requested color visible on bright models and as thickness increases.
    outline.overlayMaterial.blending = THREE.NormalBlending
    outline.overlayMaterial.uniforms.outlineColor = { value: new THREE.Color() }
    outline.overlayMaterial.fragmentShader = `
      varying vec2 vUv;
      uniform sampler2D maskTexture;
      uniform sampler2D edgeTexture1;
      uniform float edgeStrength;
      uniform vec3 outlineColor;
      void main() {
        float outside = texture2D(maskTexture, vUv).r;
        float edge = texture2D(edgeTexture1, vUv).r * edgeStrength;
        gl_FragColor = vec4(outlineColor, outside * smoothstep(0.1, 0.3, edge));
      }
    `
    outlineRef.current = outline
    return () => { outlineRef.current = null; outline.dispose() }
  }, [gl, scene, camera])
  useEffect(() => {
    const ratio = gl.getPixelRatio()
    if (outlineRef.current) {
      outlineRef.current.edgeThickness = width * ratio
      outlineRef.current.edgeStrength = width * ratio * 2
      outlineRef.current.overlayMaterial.uniforms.outlineColor.value.set(color).convertLinearToSRGB()
    }
    outlineRef.current?.setSize(size.width * ratio, size.height * ratio)
  }, [gl, scene, camera, size.width, size.height, color, width])
  useFrame((_, delta) => {
    gl.render(scene, camera)
    const outline = outlineRef.current
    if (!outline || !selectedIds.length) return
    const meshes = new Set<THREE.Object3D>()
    for (const id of selectedIds) {
      const object = selectedObject(scene, id, modelSelection)
      let visible = Boolean(object)
      for (let parent = object; parent; parent = parent.parent ?? undefined) if (!parent.visible) visible = false
      if (visible) object?.traverseVisible(child => { if ((child as THREE.Mesh).isMesh && !child.userData.editorHelper) meshes.add(child) })
    }
    if (!meshes.size) return
    outline.selectedObjects = [...meshes]
    const helpers: THREE.Object3D[] = []
    scene.traverseVisible(object => {
      if (object.userData.editorHelper || object.type.startsWith('TransformControls')) helpers.push(object)
    })
    for (const helper of helpers) helper.visible = false
    // OutlinePass draws its overlay to readBuffer. A null target draws directly
    // onto the canvas, preserving the existing material and background colors.
    const screen = null as unknown as THREE.WebGLRenderTarget
    try { outline.render(gl, screen, screen, delta, false) }
    finally { for (const helper of helpers) helper.visible = true }
  }, 1)
  return null
}

function NodeView({ id, document, selected, selectedIds, hiddenIds, unpickableIds, onSelect, mode, space, snap, onTransform, orbit, diagnose, showGizmos }: { id: string; document: SceneDocument; selected: string; selectedIds: readonly string[]; hiddenIds: readonly string[]; unpickableIds: readonly string[]; onSelect: (id: string, modifiers?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void; mode: SceneViewportMode; space: 'local' | 'world'; snap: boolean; onTransform: (transform: Transform) => void; orbit: MutableRefObject<any>; diagnose: (message: string) => void; showGizmos: boolean }) {
  const node = document.nodes[id]
  const group = useRef<THREE.Group>(null)
  const controls = useRef<any>(null)
  const scene = useThree(state => state.scene)
  const start = useRef<Transform | null>(null)
  const [dragging, setDragging] = useState(false)
  const preview = node ? preview2d(node) : undefined
  useFrame(({ clock }) => {
    const object = group.current
    if (!object || !node || dragging || selectedIds.includes(node.id)) return
    const time = clock.elapsedTime
    object.position.set(...node.transform.position)
    object.scale.set(...node.transform.scale)
    const patrol = preview?.patrol ? patrolPosition(preview.patrol, time) : undefined
    if (patrol) { object.position.x = patrol.x; object.position.y = patrol.y }
    const motion = preview?.motion
    if (motion?.kind === 'vertical-bob') object.position.y += Math.sin(time * Math.PI * 2 / Math.max(.1, typeof motion.periodSecs === 'number' ? motion.periodSecs : 2.4)) * (motion.amplitudePx ?? 0) / 100
    else if (motion?.kind === 'horizontal-drift') object.position.x += Math.sin(time * Math.PI / 8) * Math.max(.02, (motion.speedPxPerSec ?? 0) / 100)
    const animation = preview?.animation
    if (animation?.kind === 'breathe' || animation?.kind === 'pulse') {
      const wave = (Math.sin(time * Math.PI * 2 / Math.max(.1, animation.periodSecs ?? 2.4)) + 1) / 2
      const scale = (animation.scaleMin ?? 1) + ((animation.scaleMax ?? 1) - (animation.scaleMin ?? 1)) * wave
      object.scale.set(node.transform.scale[0] * scale, node.transform.scale[1] * scale, node.transform.scale[2])
      const baseOpacity = componentOf(node, 'sprite-renderer')?.material.opacity ?? 1
      const opacity = (animation.alphaMin ?? baseOpacity) + ((animation.alphaMax ?? baseOpacity) - (animation.alphaMin ?? baseOpacity)) * wave
      object.traverse(child => {
        const mesh = child as THREE.Mesh
        const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
        for (const material of materials) if ('opacity' in material) { material.opacity = opacity; material.transparent = opacity < 1 }
      })
    }
  })
  useEffect(() => {
    if (!dragging) return
    const cancel = () => { if (group.current && start.current) { group.current.position.set(...start.current.position); group.current.rotation.set(...start.current.rotation); group.current.scale.set(...start.current.scale) }; start.current = null; if (controls.current) { controls.current.dragging = false; controls.current.axis = null }; setDragging(false); orbit.current && (orbit.current.enabled = true) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }
    window.addEventListener('keydown', key); window.addEventListener('pointercancel', cancel)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('pointercancel', cancel); if (start.current) cancel() }
  }, [dragging, orbit])
  if (!node || !node.active || hiddenIds.includes(node.id)) return null
  const isSelected = selectedIds.includes(node.id)
  const finish = () => {
    const object = group.current
    if (object && start.current) {
      const next: Transform = { position: [object.position.x, object.position.y, object.position.z], rotation: [object.rotation.x, object.rotation.y, object.rotation.z], scale: [object.scale.x, object.scale.y, object.scale.z] }
      if (!sameTransform(next, start.current)) onTransform(next)
    }
    start.current = null; setDragging(false); if (orbit.current) orbit.current.enabled = true
  }
  return <><group ref={group} name={node.id} position={node.transform.position} rotation={node.transform.rotation as any} scale={node.transform.scale} onClick={event => { event.stopPropagation(); if (!unpickableIds.includes(node.id) && mode !== 'hand' && !event.altKey) onSelect(node.id, { ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey }) }}>
    {componentOf(node, 'sprite-renderer') || componentOf(node, 'image') || componentOf(node, 'tilemap') ? <Primitive node={node} assets={document.assets} diagnose={diagnose} /> : null}
    {componentOf(node, 'mesh-filter') && componentOf(node, 'mesh-renderer') ? <ModelAsset asset={document.assets[componentOf(node, 'mesh-filter')!.assetId]} override={componentOf(node, 'mesh-renderer')!.material} assets={document.assets} diagnose={diagnose} /> : null}
    {componentOf(node, 'skinned-mesh-renderer') ? <ModelAsset asset={document.assets[componentOf(node, 'skinned-mesh-renderer')!.assetId]} override={componentOf(node, 'skinned-mesh-renderer')!.material} assets={document.assets} diagnose={diagnose} /> : null}
    {componentOf(node, 'particle-system') ? <ParticleEmitterPreview node={node} assets={document.assets} diagnose={diagnose} /> : null}
    {componentVisibleInEditor(componentOf(node, 'light-2d') ?? componentOf(node, 'light')) ? <Light dimension={document.dimension} showIcon={document.dimension === '3d' && (showGizmos || isSelected)} node={node} selected={isSelected} gizmoColor={document.settings?.selectionColor ?? '#ffad46'} /> : null}
    {showGizmos && (document.dimension === '3d' || isSelected) ? node.components.filter((component): component is Collider2DComponent => ['box-collider-2d', 'circle-collider-2d', 'capsule-collider-2d', 'polygon-collider-2d'].includes(component.type) && component.enabled).map(component => <Volume2D key={component.id} volume={component} />) : null}
    {showGizmos && document.dimension === '3d' ? node.components.filter((component): component is Collider3DComponent => ['box-collider', 'sphere-collider', 'capsule-collider', 'mesh-collider'].includes(component.type) && component.enabled).map(component => <Volume3D key={component.id} volume={component} />) : null}
    {document.dimension === '3d' && !node.components.some(component => ['sprite-renderer', 'image', 'tilemap-renderer', 'mesh-renderer', 'skinned-mesh-renderer', 'particle-system', 'light-2d', 'light'].includes(component.type)) && showGizmos ? <axesHelper args={[.35]} /> : null}
    {node.children.map(child => <NodeView key={child} id={child} document={document} selected={selected} selectedIds={selectedIds} hiddenIds={hiddenIds} unpickableIds={unpickableIds} onSelect={onSelect} mode={mode} space={space} snap={snap} onTransform={onTransform} orbit={orbit} diagnose={diagnose} showGizmos={showGizmos} />)}
  </group>{showGizmos && isSelected && selected === node.id && !node.locked && node.editable !== false && mode !== 'select' && mode !== 'hand' ? createPortal(<TransformControls ref={controls} object={group as MutableRefObject<THREE.Group>} mode={mode} space={space} size={document.dimension === '2d' ? 1.35 : 1} showX={document.dimension === '3d' || mode !== 'rotate'} showY={document.dimension === '3d' || mode !== 'rotate'} showZ={document.dimension === '3d' || mode === 'rotate'} translationSnap={snap ? .25 : undefined} rotationSnap={snap ? Math.PI / 12 : undefined} scaleSnap={snap ? .25 : undefined} onMouseDown={() => { start.current = structuredClone(node.transform); setDragging(true); if (orbit.current) orbit.current.enabled = false }} onMouseUp={finish} />, scene) : null}</>
}

function LightIcon({ kind, color }: { kind: LightKind; color: string }) {
  const sprite = useRef<THREE.Sprite>(null)
  const parentScale = useMemo(() => new THREE.Vector3(), [])
  const texture = useMemo(() => {
    const canvas = window.document.createElement('canvas')
    canvas.width = canvas.height = 96
    const context = canvas.getContext('2d')!
    context.scale(3, 3)
    context.lineCap = 'round'; context.lineJoin = 'round'
    const path = new Path2D()
    if (kind === 'point') {
      path.arc(16, 16, 5, 0, Math.PI * 2)
      for (let i = 0; i < 8; i++) { const angle = i * Math.PI / 4; path.moveTo(16 + Math.cos(angle) * 9, 16 + Math.sin(angle) * 9); path.lineTo(16 + Math.cos(angle) * 13, 16 + Math.sin(angle) * 13) }
    } else if (kind === 'directional') {
      for (const x of [8, 16, 24]) { path.moveTo(x, 5); path.lineTo(x, 25); path.moveTo(x - 3, 21); path.lineTo(x, 25); path.lineTo(x + 3, 21) }
    } else if (kind === 'spot') {
      path.rect(11, 4, 10, 5); path.moveTo(12, 11); path.lineTo(5, 27); path.lineTo(27, 27); path.lineTo(20, 11)
      path.moveTo(16, 13); path.lineTo(16, 23)
    } else {
      path.arc(16, 23, 8, Math.PI, Math.PI * 2)
      path.moveTo(4, 24); path.lineTo(28, 24)
      for (const [x1, y1, x2, y2] of [[16, 4, 16, 10], [4, 10, 8, 14], [28, 10, 24, 14]]) { path.moveTo(x1, y1); path.lineTo(x2, y2) }
    }
    context.strokeStyle = '#11151b'; context.lineWidth = 3.5; context.stroke(path)
    context.strokeStyle = color; context.lineWidth = 1.6; context.stroke(path)
    const map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    return map
  }, [kind, color])
  useEffect(() => () => texture.dispose(), [texture])
  useFrame(({ camera, size }) => {
    // Keep the editor icon 32px high in both projection modes.
    if (!sprite.current?.parent) return
    sprite.current.parent.getWorldScale(parentScale)
    const scale = 64 / (size.height * camera.projectionMatrix.elements[5])
    sprite.current.scale.set(scale / parentScale.x, scale / parentScale.y, 1)
  })
  return <sprite ref={sprite} name={`${kind}-light-icon`} renderOrder={1000}><spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} sizeAttenuation={false} toneMapped={false} /></sprite>
}

function Light({ node, selected, gizmoColor, showIcon, dimension }: { node: SceneNode; selected: boolean; gizmoColor: string; showIcon: boolean; dimension: '2d' | '3d' }) {
  const light2d = componentOf(node, 'light-2d')?.light
  const light = light2d ?? componentOf(node, 'light')?.light
  const target = useMemo(() => { const object = new THREE.Object3D(); object.position.set(0, 0, -1); return object }, [])
  const cone = useMemo(() => {
    if (!light2d || light2d.kind !== 'spot') return null
    const shape = new THREE.Shape()
    const points = lightConePoints(light2d)
    shape.moveTo(points[0][0], points[0][1])
    for (const [x, y] of points.slice(1)) shape.lineTo(x, y)
    shape.closePath()
    return shape
  }, [light2d?.kind, light2d?.distance, light2d?.angle])
  if (!light) return null
  return <group>
    <primitive object={target} />
    {cone && <mesh userData={{ editorHelper: true }} position={[0, 0, .001]} renderOrder={998} raycast={() => {}}>
      <shapeGeometry args={[cone]} />
      <meshBasicMaterial color={light.color} transparent opacity={light.alpha ?? .35} depthTest={false} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>}
    {light.kind === 'ambient' ? <ambientLight color={light.color} intensity={light.intensity} />
      : light.kind === 'directional' ? <directionalLight color={light.color} intensity={light.intensity} target={target} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-18} shadow-camera-right={18} shadow-camera-top={18} shadow-camera-bottom={-18} shadow-camera-near={.1} shadow-camera-far={60} shadow-bias={-.0002} shadow-normalBias={.035} />
      : light.kind === 'point' ? <pointLight color={light.color} intensity={light.intensity} distance={light.distance ?? 0} />
      : <spotLight color={light.color} intensity={light.intensity} distance={light.distance ?? 0} angle={light.angle ?? Math.PI / 3} penumbra={light.penumbra ?? 0} target={target} />}
    {showIcon && <LightIcon kind={light.kind} color={light.color} />}
    {selected && dimension === '3d' && <LightGizmo light={light} color={gizmoColor} />}
  </group>
}

function SceneContents({ document, selected, selectedIds = [selected], modelSelection, hiddenIds = [], unpickableIds = [], onSelect, mode, space, snap, focus, onTransform, onDiagnostic, initialView, showGizmos = true, viewMode }: SceneViewportProps) {
  const settings = document.settings ?? DEFAULT_SCENE_SETTINGS
  const { gl } = useThree()
  useEffect(() => { gl.toneMappingExposure = settings.exposure }, [gl, settings.exposure])
  const orbit = useRef<any>(null)
  const [temporarySnap, setTemporarySnap] = useState(false)
  const diagnosticCallback = useRef(onDiagnostic)
  diagnosticCallback.current = onDiagnostic
  const diagnose = useMemo(() => reportOnce(message => diagnosticCallback.current?.(message)), [])
  return <><color attach="background" args={[settings.background]} /><ambientLight color={settings.ambientColor} intensity={settings.ambientIntensity} />{settings.fogEnabled && <fog attach="fog" args={[settings.fogColor, settings.fogNear, settings.fogFar]} />}{settings.showGrid && <Grid position={viewMode === '2d' ? [0, 0, 2] : undefined} rotation={viewMode === '2d' ? [Math.PI / 2, 0, 0] : undefined} userData={{ editorHelper: true }} args={[40, 40]} cellSize={1} sectionSize={5} sectionColor="#747980" cellColor="#555a61" fadeDistance={35} infiniteGrid />}<NavigationController orbit={orbit} handMode={mode === 'hand'} viewMode={viewMode} onTemporarySnap={setTemporarySnap} /><OrbitControls ref={orbit} target={initialView?.target} makeDefault enableRotate={false} enableDamping={false} enablePan={false} enableZoom={false} mouseButtons={{ LEFT: -1 as any, MIDDLE: -1 as any, RIGHT: -1 as any }} /><CameraRig document={document} selected={selected} modelSelection={modelSelection} focus={focus} orbit={orbit} /><SelectionOutline selectedIds={selectedIds} modelSelection={modelSelection} color={settings.selectionColor ?? '#ffad46'} width={settings.selectionWidth ?? 3} />{showGizmos && <GizmoHelper renderPriority={2} alignment="bottom-center" margin={[0, 136]}><GizmoViewport axisColors={['#d87178', '#66a58b', '#6e8ec7']} labelColor="white" /></GizmoHelper>}{document.rootIds.map(id => <NodeView key={id} id={id} document={document} selected={selected} selectedIds={selectedIds} hiddenIds={hiddenIds} unpickableIds={unpickableIds} onSelect={onSelect} mode={modelSelection ? 'select' : mode} space={space} snap={snap || temporarySnap} onTransform={onTransform} orbit={orbit} diagnose={diagnose} showGizmos={showGizmos} />)}</>
}

/** Self-contained R3F viewport used by the independent scene editor. */
export function SceneViewport(props: SceneViewportProps) {
  const effectiveOrtho = props.viewMode === '2d' || props.ortho
  const camera = effectiveOrtho
    ? { position: props.initialView?.position ?? (props.viewMode === '2d' ? [0, 0, 10] as const : [7, 6, 7] as const), zoom: 65 }
    : { position: props.initialView?.position ?? [7, 5, 7] as [number, number, number], fov: 45 }
  return <Canvas shadows events={viewportEvents} key={`${props.viewMode}-${effectiveOrtho ? 'orthographic' : 'perspective'}-${props.document.dimension}`} orthographic={effectiveOrtho} camera={camera} onPointerMissed={event => props.onSelect('', { ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey })} onCreated={({ gl }) => { gl.setClearColor('#3c3f43'); gl.domElement.tabIndex = 0; gl.domElement.setAttribute('aria-label', 'Scene viewport') }}><SceneContents {...props} /></Canvas>
}

export default SceneViewport
