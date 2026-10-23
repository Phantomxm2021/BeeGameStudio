import { Canvas, createPortal, events as createPointerEvents, useFrame, useThree } from '@react-three/fiber'
import { Bounds, useBounds, Grid, Line, GizmoHelper, GizmoViewport, OrbitControls, TransformControls } from '@react-three/drei'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js'
import type { ModelSelection } from './model-structure'
import { componentOf, DEFAULT_SCENE_SETTINGS, rendererOrder } from './model'
import { colliderOutline } from './collider-outline'
import { resolveGameCameraPreview } from './game-camera-preview'
import { TilemapPreview } from './tilemap-preview'
import type { TileBrush } from './tilemap-brush'
import { acquireTextureSource } from './texture-cache'
import { editorRect, rectTransform } from './rect-transform'
import { LightGizmo, lightConePoints } from './light-gizmo'
import { isApplePlatform, resolveUnityNavigationAction, wheelPixels } from './navigation'
import type { NavigationAction } from './navigation'
import type { Collider2DComponent, Collider3DComponent, LightKind, MaterialOverride, SceneAsset, SceneComponent, SceneDocument, SceneNode, Transform } from './model'

export type SceneViewportMode = 'select' | 'translate' | 'rotate' | 'scale' | 'hand'
export type SceneViewMode = '2d' | '3d'
export type SceneViewportProps = {
  gameCamera?: boolean
  tileBrush?: TileBrush
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
    const rotation = node.transform.quaternion ? new THREE.Quaternion(...node.transform.quaternion)
      : new THREE.Quaternion().setFromEuler(new THREE.Euler(...node.transform.rotation))
    matrix.multiply(new THREE.Matrix4().compose(new THREE.Vector3(...rectTransform(node, document.nodes).position), rotation, new THREE.Vector3(...node.transform.scale)))
  }
  result.setFromMatrixPosition(matrix)
  return result
}

function CameraRig({ document, selected, modelSelection, focus, orbit, preview }: { document: SceneDocument; selected: string; modelSelection?: ModelSelection | null; focus: number; orbit: MutableRefObject<any>; preview?: ReturnType<typeof resolveGameCameraPreview> }) {
  const { camera, scene, size, set } = useThree()
  const documentRef = useRef(document)
  const selectedRef = useRef(selected)
  const partRef = useRef(modelSelection)
  partRef.current = modelSelection
  documentRef.current = document
  selectedRef.current = selected
  const cameraNode = Object.values(document.nodes).find(node => componentOf(node, 'camera'))
  const cameraComponent = cameraNode ? componentOf(cameraNode, 'camera') : undefined
  const orthographicSize = cameraComponent?.orthographicSize ?? 3.6
  // Keep the observer camera itself, so projection changes do not destroy its pose or zoom.
  const observer = useRef(camera)
  const wasPreviewing = useRef(false)
  const previewCamera = useMemo(() => preview?.view.projection === 'orthographic'
    ? new THREE.OrthographicCamera() : new THREE.PerspectiveCamera(), [preview?.view.projection])
  useEffect(() => {
    if (preview) {
      if (preview.view.projection === 'orthographic') Object.assign(previewCamera, {
        left: -preview.view.halfWidth!, right: preview.view.halfWidth!, top: preview.view.halfHeight!, bottom: -preview.view.halfHeight! })
      else Object.assign(previewCamera, { fov: preview.view.verticalFieldOfView, aspect: preview.view.aspect })
      Object.assign(previewCamera, { manual: true, zoom: 1, near: preview.near, far: preview.far })
      previewCamera.position.fromArray(preview.position); previewCamera.quaternion.fromArray(preview.quaternion)
      previewCamera.updateProjectionMatrix(); previewCamera.updateMatrixWorld(true)
      set({ camera: previewCamera }); wasPreviewing.current = true
      return
    }
    const free = observer.current
    const orthographic = free as THREE.OrthographicCamera
    if (wasPreviewing.current) {
      // The frame may have resized while letterboxed; update projection, not observer pose.
      if (orthographic.isOrthographicCamera) {
        orthographic.left = -size.width / 2; orthographic.right = size.width / 2
        orthographic.top = size.height / 2; orthographic.bottom = -size.height / 2
      } else (free as THREE.PerspectiveCamera).aspect = size.width / size.height
      free.updateProjectionMatrix(); set({ camera: free }); wasPreviewing.current = false
      return
    }
    if (!orthographic.isOrthographicCamera) return
    orthographic.zoom = size.height / Math.max(.01, orthographicSize * 2)
    orthographic.updateProjectionMatrix()
  }, [orthographicSize, size.width, size.height, preview, previewCamera, set])
  useEffect(() => {
    const id = selectedRef.current
    if (preview || !focus || !documentRef.current.nodes[id]) return
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
  }, [camera, focus, orbit, scene, preview])
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
  const [source, setSource] = useState<{ uri: string; texture: THREE.Texture } | null>(null)
  const diagnostic = useRef(onDiagnostic)
  diagnostic.current = onDiagnostic
  useEffect(() => {
    let alive = true
    setSource(null)
    if (!uri) return () => { alive = false }
    const shared = acquireTextureSource(uri)
    void shared.texture.then(texture => {
      if (alive) setSource({ uri, texture })
    }, () => { if (alive) diagnostic.current?.('Local texture asset could not be decoded') })
    return () => { alive = false; shared.release() }
  }, [uri])
  const texture = useMemo(() => {
    if (!source || source.uri !== uri) return null
    const next = source.texture.clone()
    if (region) applyTextureRegion(next, region)
    return next
  }, [source, uri, region?.x, region?.y, region?.width, region?.height])
  useEffect(() => {
    if (texture && region && !applyTextureRegion(texture, region))
      diagnostic.current?.('Texture region falls outside the decoded image')
    return () => { texture?.dispose() }
  }, [texture])
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

export function rendererSize(node: SceneNode, pixelsPerUnit = 100): [number, number] {
  const renderer = componentOf(node, 'sprite-renderer') ?? componentOf(node, 'image')
  const properties = renderer && 'properties' in renderer ? renderer.properties : undefined
  const value = properties?.size
  const sprite = properties?.sprite
  const logical = sprite && typeof sprite === 'object' && !Array.isArray(sprite) ? (sprite as Record<string, unknown>).logicalSize : undefined
  const rect = componentOf(node, 'rect-transform')
  const rectSize = rect?.sizeDelta
  const size = Array.isArray(value) ? { width: value[0], height: value[1] }
    : value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown>
    : logical && typeof logical === 'object' && !Array.isArray(logical) ? logical as Record<string, unknown>
    : rectSize ? { width: rectSize[0] * pixelsPerUnit, height: rectSize[1] * pixelsPerUnit }
    : undefined
  const width = typeof size?.width === 'number' && Number.isFinite(size.width) ? size.width : 100
  const height = typeof size?.height === 'number' && Number.isFinite(size.height) ? size.height : 100
  return [Math.max(0, width) / pixelsPerUnit, Math.max(0, height) / pixelsPerUnit]
}

/** A visual pivot offsets geometry, not its GameObject, children or colliders. */
export function rendererOffset(node: SceneNode, size: readonly number[]): [number, number, number] {
  const rect = componentOf(node, 'rect-transform')
  if (rect) return [(.5-rect.pivot[0])*size[0], (.5-rect.pivot[1])*size[1], 0]
  const renderer = componentOf(node, 'sprite-renderer') ?? componentOf(node, 'image')
  const anchor = renderer?.properties.anchor
  const value = Array.isArray(anchor) ? anchor : anchor && typeof anchor === 'object' ? [(anchor as {x?: number}).x, (anchor as {y?: number}).y] : [.5, .5]
  const x = typeof value[0] === 'number' ? value[0] : .5, y = typeof value[1] === 'number' ? value[1] : .5
  return [(.5-x)*size[0], (y-.5)*size[1], 0]
}

function patrolPosition(patrol: NonNullable<Preview2D['patrol']>, elapsedSecs: number, pixelsPerUnit: number): { x: number; y: number } | undefined {
  const forward = patrol.waypoints?.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)) ?? []
  if (!forward.length) return undefined
  const points = patrol.mode === 'pingpong'
    ? [...forward, ...forward.slice(1, -1).reverse()]
    : [...forward, ...(patrol.returnPath?.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)) ?? [])]
  if (points.length === 1) return { x: points[0].x! / pixelsPerUnit, y: points[0].y! / pixelsPerUnit }
  const startDelay = Math.max(0, patrol.startDelaySecs ?? 0)
  if (elapsedSecs <= startDelay) return { x: points[0].x! / pixelsPerUnit, y: points[0].y! / pixelsPerUnit }
  const speed = 80
  const segments = points.map((point, index) => {
    const next = points[(index + 1) % points.length]
    const distance = Math.hypot(next.x! - point.x!, next.y! - point.y!)
    return { point, next, travelSecs: distance / speed, pauseSecs: Math.max(0, point.pauseSecs ?? 0) }
  })
  const cycleSecs = segments.reduce((sum, segment) => sum + segment.travelSecs + segment.pauseSecs, 0)
  let cursor = (elapsedSecs - startDelay) % Math.max(.1, cycleSecs)
  for (const segment of segments) {
    if (cursor < segment.pauseSecs) return { x: segment.point.x! / pixelsPerUnit, y: segment.point.y! / pixelsPerUnit }
    cursor -= segment.pauseSecs
    if (cursor <= segment.travelSecs) {
      const progress = segment.travelSecs > 0 ? cursor / segment.travelSecs : 1
      return {
        x: THREE.MathUtils.lerp(segment.point.x!, segment.next.x!, progress) / pixelsPerUnit,
        y: THREE.MathUtils.lerp(segment.point.y!, segment.next.y!, progress) / pixelsPerUnit,
      }
    }
    cursor -= segment.travelSecs
  }
  return { x: points[0].x! / pixelsPerUnit, y: points[0].y! / pixelsPerUnit }
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

function NodeAnimation({ group, node, nodes, preview, pixelsPerUnit, paused }: {
  group: React.RefObject<THREE.Group | null>; node: SceneNode; nodes: SceneDocument['nodes'];
  preview: Preview2D; pixelsPerUnit: number; paused: boolean
}) {
  const position = useMemo(() => rectTransform(node, nodes).position, [node, nodes])
  useFrame(({ clock }) => {
    const object = group.current
    if (!object || paused) return
    const time = clock.elapsedTime
    object.position.set(...position)
    object.scale.set(...node.transform.scale)
    const patrol = preview.patrol ? patrolPosition(preview.patrol, time, pixelsPerUnit) : undefined
    if (patrol) { object.position.x = patrol.x; object.position.y = patrol.y }
    const motion = preview.motion
    if (motion?.kind === 'vertical-bob') object.position.y += Math.sin(time * Math.PI * 2 / Math.max(.1, typeof motion.periodSecs === 'number' ? motion.periodSecs : 2.4)) * (motion.amplitudePx ?? 0) / pixelsPerUnit
    else if (motion?.kind === 'horizontal-drift') object.position.x += Math.sin(time * Math.PI / 8) * Math.max(.02, (motion.speedPxPerSec ?? 0) / pixelsPerUnit)
    const animation = preview.animation
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
  return null
}

function SpriteAnimation({ texture, sprite }: { texture: THREE.Texture; sprite: NonNullable<Preview2D['sprite']> }) {
  const frame = useRef(-1)
  useEffect(() => { frame.current = -1 }, [texture, sprite.frameWidth, sprite.frameHeight, sprite.framesPerFacing, sprite.initialFacing, sprite.facings?.join('|')])
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
    // Offset/repeat update the UV matrix; pixels did not change. Marking the
    // texture dirty here would upload the same atlas again on every frame.
  })
  return null
}

function Primitive({ node, assets, diagnose, pixelsPerUnit, rectSize, flat2d }: { pixelsPerUnit: number; node: SceneNode; assets: Record<string, SceneAsset>; diagnose: (message: string) => void; rectSize?: [number, number]; flat2d?: boolean }) {
  const renderer = componentOf(node, 'sprite-renderer') ?? componentOf(node, 'image')
  const materialData = renderer?.material
  const texture = useLocalTexture(localAssetUri(materialData?.textureAssetId ? assets[materialData.textureAssetId] : undefined), materialData?.textureRegion, diagnose)
  const sprite = preview2d(node)?.sprite
  const props = materialProps(materialData, texture)
  if (flat2d) { props.transparent = true; props.depthWrite = false }
  const blending = preview2d(node)?.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending
  // A material compiled without a map will not necessarily acquire the map's
  // shader defines when an asynchronous texture arrives. Recreate it once the
  // texture identity changes so image-backed 2D planes stop rendering white.
  const materialKey = texture?.uuid ?? 'no-texture'
  const material = materialData?.mode === 'standard' ? <meshStandardMaterial key={materialKey} {...props} blending={blending} metalness={materialData.metalness} roughness={materialData.roughness} /> : <meshBasicMaterial key={materialKey} {...props} blending={blending} />
  if (!componentVisibleInEditor(renderer)) return null
  const size = rectSize ?? rendererSize(node, pixelsPerUnit)
  return <mesh castShadow receiveShadow renderOrder={flat2d ? rendererOrder(node) : 0} position={rendererOffset(node, size)} scale={[...size, 1]}><planeGeometry args={[1, 1]} />{material}{texture && sprite?.frameWidth && sprite.frameHeight ? <SpriteAnimation key={texture.uuid} texture={texture} sprite={sprite} /> : null}</mesh>
}

/** Keep the authored font identity stable across the UI and scene previews. */
export function textFontFamily(assetId: string): string {
  return `BGS-${assetId.replace(/[^a-z0-9_-]/gi, '-')}`
}

type SceneFontEntry = { refs: number; face?: FontFace; promise: Promise<boolean> }
const sceneFontFaces = new Map<string, SceneFontEntry>()

function fontCacheKey(assetId: string, url: string): string {
  // Asset bytes can be a large data URL. Hash the URL for cache identity so a
  // long base64 string is not retained again as a Map key.
  let hash = 2166136261
  for (let index = 0; index < url.length; index += 1) hash = Math.imul(hash ^ url.charCodeAt(index), 16777619)
  return `${assetId}:${hash >>> 0}`
}

function acquireSceneFont(assetId: string, url: string): { promise: Promise<boolean>; release: () => void } {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts || typeof document.fonts.add !== 'function') return { promise: Promise.resolve(false), release: () => undefined }
  const key = fontCacheKey(assetId, url)
  const existing = sceneFontFaces.get(key)
  if (existing) {
    existing.refs += 1
    let released = false
    return {
      promise: existing.promise,
      release: () => {
        if (released) return
        released = true
        existing.refs -= 1
        if (existing.refs > 0) return
        void existing.promise.then(() => {
          if (sceneFontFaces.get(key) !== existing || existing.refs > 0) return
          if (existing.face && typeof document.fonts.delete === 'function') document.fonts.delete(existing.face)
          sceneFontFaces.delete(key)
        })
      },
    }
  }
  const family = textFontFamily(assetId)
  const entry = { refs: 1, face: undefined, promise: Promise.resolve(false) } as SceneFontEntry
  entry.promise = new FontFace(family, `url("${url}")`).load().then(face => {
    entry.face = face
    document.fonts.add(face)
    return true
  }).catch(() => false)
  sceneFontFaces.set(key, entry)
  let released = false
  return {
    promise: entry.promise,
    release: () => {
      if (released) return
      released = true
      entry.refs -= 1
      if (entry.refs > 0) return
      void entry.promise.then(() => {
        if (sceneFontFaces.get(key) !== entry || entry.refs > 0) return
        if (entry.face && typeof document.fonts.delete === 'function') document.fonts.delete(entry.face)
        sceneFontFaces.delete(key)
      })
    },
  }
}

function textPadding(value: unknown) {
  const scalar = (input: unknown) => typeof input === 'number' && Number.isFinite(input) ? Math.max(0, input) : 0
  if (typeof value === 'number') {
    const all = scalar(value)
    return { top: all, right: all, bottom: all, left: all }
  }
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return { top: scalar(source.top), right: scalar(source.right), bottom: scalar(source.bottom), left: scalar(source.left) }
}

function wrapTextLines(context: CanvasRenderingContext2D, value: string, maxWidth?: number): string[] {
  const paragraphs = value.split('\n')
  if (!maxWidth || maxWidth <= 0) return paragraphs
  return paragraphs.flatMap(paragraph => {
    if (!paragraph) return ['']
    const lines: string[] = []
    let line = ''
    for (const character of Array.from(paragraph)) {
      const candidate = line + character
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line)
        line = character
      } else line = candidate
    }
    lines.push(line)
    return lines
  })
}

/**
 * Convert authored scene text metrics into a canvas raster size without
 * changing the authored font size.  In a 2D scene, pixelsPerUnit only maps
 * the RectTransform to texture pixels; it must not be applied to the glyph
 * size a second time.
 */
export function textRasterMetrics(fontSizeValue: unknown, rectSize: [number, number] | undefined, pixelsPerUnit: number, flat2d: boolean) {
  const density = flat2d ? Math.max(1, pixelsPerUnit) : 1
  const fontSize = Math.max(1, typeof fontSizeValue === 'number' && Number.isFinite(fontSizeValue) ? fontSizeValue : 32)
  return {
    density,
    fontSize,
    width: rectSize ? Math.max(1, Math.round(rectSize[0] * density)) : undefined,
    height: rectSize ? Math.max(1, Math.round(rectSize[1] * density)) : undefined,
  }
}

function TextPreview({ node, rectSize, assets, pixelsPerUnit, flat2d }: { node: SceneNode; rectSize?: [number, number]; assets: Record<string, SceneAsset>; pixelsPerUnit: number; flat2d: boolean }) {
  const component = componentOf(node, 'text')
  const fontAssetId = component?.fontAssetId
  const fontAsset = fontAssetId ? assets[fontAssetId] ?? assets[fontAssetId.split(':', 1)[0]] : undefined
  // Prefer the bytes loaded by SceneEditorOverlay. A stale/remote URI must
  // not win over the verified local font payload used by this document.
  const fontUrl = fontAsset?.bytes?.startsWith('data:') ? fontAsset.bytes : fontAsset?.uri
  const [fontReady, setFontReady] = useState(false)
  useEffect(() => {
    let active = true
    setFontReady(false)
    if (!fontAssetId || !fontUrl) return () => { active = false }
    const font = acquireSceneFont(fontAssetId, fontUrl)
    void font.promise.then(ready => { if (active) setFontReady(ready) })
    return () => { active = false; font.release() }
  }, [fontAssetId, fontUrl])
  const texture = useMemo(() => {
    if (!componentVisibleInEditor(component) || !component) return null
    const raster = textRasterMetrics(component.properties.fontSize, rectSize, pixelsPerUnit, flat2d)
    const { fontSize } = raster
    const fontWeight = typeof component.properties.fontWeight === 'number'
      ? Math.max(100, Math.min(900, component.properties.fontWeight))
      : component.properties.bold === true ? 700 : 400
    const authoredFamily = typeof component.properties.fontFamily === 'string' && component.properties.fontFamily.trim()
      ? component.properties.fontFamily.trim()
      : '"SF Pro Text", "PingFang SC", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif'
    const family = fontReady && fontAssetId ? `"${textFontFamily(fontAssetId)}", ${authoredFamily}` : authoredFamily
    const lineHeightSource = typeof component.properties.lineHeight === 'number' && component.properties.lineHeight > 0 ? component.properties.lineHeight : 1.35
    const lineHeight = (lineHeightSource <= 4 ? lineHeightSource * fontSize : lineHeightSource)
    const alignSource = component.properties.textAlign ?? component.properties.align
    const align = alignSource === 'left' || alignSource === 'right' || alignSource === 'center' ? alignSource : 'center'
    const verticalSource = component.properties.verticalAlign ?? component.properties.textVerticalAlign
    const vertical = verticalSource === 'top' || verticalSource === 'bottom' ? verticalSource : 'center'
    const padding = textPadding(component.properties.padding)
    const canvas = window.document.createElement('canvas')
    const context = canvas.getContext('2d')!
    context.font = `${fontWeight} ${fontSize}px ${family}`
    const rawLines = component.text.split('\n')
    const measuredWidth = Math.max(1, ...rawLines.map(line => context.measureText(line || ' ').width))
    const targetWidth = raster.width ?? Math.ceil(measuredWidth + padding.left + padding.right)
    const lines = wrapTextLines(context, component.text, raster.width ? Math.max(1, targetWidth - padding.left - padding.right) : undefined)
    const targetHeight = raster.height ?? Math.ceil(lines.length * lineHeight + padding.top + padding.bottom)
    // The texture uses the same pixel dimensions as the authored 2D rect.
    // Scaling a tightly measured text canvas to a wide RectTransform stretches
    // glyphs and was the source of the distorted Scene Editor typography.
    canvas.width = targetWidth
    canvas.height = targetHeight
    context.font = `${fontWeight} ${fontSize}px ${family}`
    context.fillStyle = typeof component.properties.color === 'string' ? component.properties.color : typeof component.properties.textColor === 'string' ? component.properties.textColor : '#ffffff'
    context.textAlign = align
    context.textBaseline = 'middle'
    const contentLeft = padding.left
    const contentRight = canvas.width - padding.right
    const x = align === 'left' ? contentLeft : align === 'right' ? contentRight : (contentLeft + contentRight) / 2
    const blockHeight = lines.length * lineHeight
    const firstBaseline = vertical === 'top'
      ? padding.top + lineHeight / 2
      : vertical === 'bottom'
        ? canvas.height - padding.bottom - blockHeight + lineHeight / 2
        : (canvas.height - blockHeight) / 2 + lineHeight / 2
    lines.forEach((line, index) => context.fillText(line, x, firstBaseline + lineHeight * index))
    const map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    return map
  }, [component?.text, component?.enabled, component?.fontAssetId, component?.properties.fontSize, component?.properties.fontWeight, component?.properties.bold, component?.properties.fontFamily, component?.properties.lineHeight, component?.properties.align, component?.properties.textAlign, component?.properties.verticalAlign, component?.properties.textVerticalAlign, component?.properties.padding, component?.properties.color, component?.properties.textColor, fontReady, flat2d, pixelsPerUnit, rectSize?.[0], rectSize?.[1]])
  useEffect(() => () => texture?.dispose(), [texture])
  if (!texture || !component) return null
  const rect = componentOf(node, 'rect-transform')
  const size: [number, number] = rectSize ?? (rect ? [Math.max(.01, rect.sizeDelta[0]), Math.max(.01, rect.sizeDelta[1])] : [Math.max(.01, texture.image.width / texture.image.height), 1])
  // 2D scene content is painter-ordered.  Text must not disappear behind a
  // card/background mesh merely because both planes share the same camera
  // depth; use the authored node order and keep the text overlay out of the
  // depth buffer, just like the sprite renderer path.
  return <mesh renderOrder={flat2d ? rendererOrder(node) : 0} position={rendererOffset(node, size)} scale={[size[0], size[1], 1]}><planeGeometry args={[1, 1]} /><meshBasicMaterial map={texture} transparent depthWrite={false} depthTest={flat2d ? false : true} toneMapped={false} /></mesh>
}

function seeded(index: number, salt: number): number {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453
  return value - Math.floor(value)
}

function ParticleEmitterPreview({ node, assets, diagnose, pixelsPerUnit }: { pixelsPerUnit: number; node: SceneNode; assets: Record<string, SceneAsset>; diagnose: (message: string) => void }) {
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
      x: ((zone?.x ?? 0) + seeded(index, 1) * (zone?.width ?? 0)) / pixelsPerUnit,
      y: ((zone?.y ?? 0) + seeded(index, 2) * (zone?.height ?? 0)) / pixelsPerUnit,
      size: (sizeMin + seeded(index, 3) * (sizeMax - sizeMin)) / pixelsPerUnit,
      phase: seeded(index, 4) * Math.PI * 2,
      speed: (emitter?.motion?.periodSecs?.min ?? 3) + seeded(index, 5) * ((emitter?.motion?.periodSecs?.max ?? 6) - (emitter?.motion?.periodSecs?.min ?? 3)),
      opacity: (emitter?.alpha?.min ?? .35) + seeded(index, 6) * ((emitter?.alpha?.max ?? .9) - (emitter?.alpha?.min ?? .35)),
    }
  }), [count, emitter, pixelsPerUnit])
  useFrame(({ clock }) => {
    if (!root.current) return
    root.current.children.forEach((child, index) => {
      const particle = particles[index]
      if (!particle) return
      const wave = clock.elapsedTime * Math.PI * 2 / Math.max(.1, particle.speed) + particle.phase
      child.position.x = particle.x + Math.sin(wave) * (emitter?.motion?.amplitudePx ?? 0) / pixelsPerUnit
      child.position.y = particle.y + Math.cos(wave * .7) * (emitter?.motion?.amplitudePx ?? 0) / (pixelsPerUnit * 2)
      const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial
      material.opacity = particle.opacity * (.7 + .3 * Math.sin(wave))
    })
  })
  if (!emitter || !texture) return null
  return <group ref={root}>{particles.map((particle, index) => <mesh key={index} renderOrder={rendererOrder(node)} position={[particle.x, particle.y, index * .0001]}>
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
  const points = colliderOutline(volume)
  return points.length > 1 ? <Line userData={{ editorHelper: true }} points={points} renderOrder={1001} color={volume.isTrigger ? '#e27ac2' : '#4ea3db'} lineWidth={1} transparent opacity={.8} depthWrite={false} depthTest={false} raycast={() => null} /> : null
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

function NodeView({ id, document, selected, selectedIds, hiddenIds, unpickableIds, onSelect, mode, space, snap, onTransform, orbit, diagnose, showGizmos, viewMode, tileBrush }: { id: string; document: SceneDocument; selected: string; selectedIds: readonly string[]; hiddenIds: readonly string[]; unpickableIds: readonly string[]; onSelect: (id: string, modifiers?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void; mode: SceneViewportMode; space: 'local' | 'world'; snap: boolean; onTransform: (transform: Transform) => void; orbit: MutableRefObject<any>; diagnose: (message: string) => void; showGizmos: boolean; viewMode: SceneViewMode; tileBrush?: TileBrush }) {
  const pixelsPerUnit = document.pixelsPerUnit ?? 100
  const node = document.nodes[id]
  const group = useRef<THREE.Group>(null)
  const controls = useRef<any>(null)
  const scene = useThree(state => state.scene)
  const start = useRef<Transform | null>(null)
  const [dragging, setDragging] = useState(false)
  const preview = node ? preview2d(node) : undefined
  useEffect(() => {
    if (!dragging) return
    const cancel = () => { if (group.current && start.current && node) { group.current.position.set(...rectTransform(node, document.nodes, start.current).position); group.current.rotation.set(...start.current.rotation); group.current.scale.set(...start.current.scale) }; start.current = null; if (controls.current) { controls.current.dragging = false; controls.current.axis = null }; setDragging(false); orbit.current && (orbit.current.enabled = true) }
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
      const authored = rectTransform(node, document.nodes, next, true)
      if (!sameTransform(authored, start.current)) onTransform(authored)
    }
    start.current = null; setDragging(false); if (orbit.current) orbit.current.enabled = true
  }
  const rectSize = editorRect(node, document.nodes)?.size
  return <><group ref={group} name={node.id} position={rectTransform(node, document.nodes).position} rotation={node.transform.quaternion ? undefined : node.transform.rotation as any} quaternion={node.transform.quaternion} scale={node.transform.scale} onClick={event => { event.stopPropagation(); if (!tileBrush && !unpickableIds.includes(node.id) && mode !== 'hand' && !event.altKey) onSelect(node.id, { ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey }) }}>
    {preview && (preview.motion || preview.patrol || preview.animation) ? <NodeAnimation group={group} node={node} nodes={document.nodes} preview={preview} pixelsPerUnit={pixelsPerUnit} paused={dragging || isSelected} /> : null}
    {componentOf(node, 'sprite-renderer') || componentOf(node, 'image') ? <Primitive node={node} flat2d={document.dimension === '2d'} rectSize={rectSize} pixelsPerUnit={pixelsPerUnit} assets={document.assets} diagnose={diagnose} /> : null}
    {componentOf(node, 'tilemap') ? <TilemapPreview node={node} document={document} diagnose={diagnose} showGizmos={showGizmos} brush={tileBrush?.nodeId===node.id && !node.locked && node.editable!==false && !unpickableIds.includes(node.id) ? tileBrush : undefined} /> : null}
    {componentOf(node, 'text') ? <TextPreview node={node} rectSize={rectSize} assets={document.assets} pixelsPerUnit={pixelsPerUnit} flat2d={document.dimension === '2d'} /> : null}
    {componentOf(node, 'mesh-filter') && componentOf(node, 'mesh-renderer') ? <ModelAsset asset={document.assets[componentOf(node, 'mesh-filter')!.assetId]} override={componentOf(node, 'mesh-renderer')!.material} assets={document.assets} diagnose={diagnose} /> : null}
    {componentOf(node, 'skinned-mesh-renderer') ? <ModelAsset asset={document.assets[componentOf(node, 'skinned-mesh-renderer')!.assetId]} override={componentOf(node, 'skinned-mesh-renderer')!.material} assets={document.assets} diagnose={diagnose} /> : null}
    {componentOf(node, 'particle-system') ? <ParticleEmitterPreview node={node} pixelsPerUnit={pixelsPerUnit} assets={document.assets} diagnose={diagnose} /> : null}
    {componentVisibleInEditor(componentOf(node, 'light-2d') ?? componentOf(node, 'light')) ? <Light dimension={viewMode} showIcon={showGizmos} node={node} selected={isSelected} gizmoColor={document.settings?.selectionColor ?? '#ffad46'} /> : null}
    {showGizmos && (viewMode === '3d' || isSelected) ? node.components.filter((component): component is Collider2DComponent => ['box-collider-2d', 'circle-collider-2d', 'capsule-collider-2d', 'polygon-collider-2d'].includes(component.type) && component.enabled).map(component => <Volume2D key={component.id} volume={component} />) : null}
    {showGizmos && (viewMode === '3d' || isSelected) ? node.components.filter((component): component is Collider3DComponent => ['box-collider', 'sphere-collider', 'capsule-collider', 'mesh-collider'].includes(component.type) && component.enabled).map(component => <Volume3D key={component.id} volume={component} />) : null}
    {viewMode === '3d' && !node.components.some(component => ['sprite-renderer', 'image', 'tilemap-renderer', 'mesh-renderer', 'skinned-mesh-renderer', 'particle-system', 'light-2d', 'light'].includes(component.type)) && showGizmos ? <axesHelper args={[.35]} /> : null}
    {node.children.map(child => <NodeView key={child} id={child} document={document} selected={selected} selectedIds={selectedIds} hiddenIds={hiddenIds} unpickableIds={unpickableIds} onSelect={onSelect} mode={mode} space={space} snap={snap} onTransform={onTransform} orbit={orbit} diagnose={diagnose} showGizmos={showGizmos} viewMode={viewMode} tileBrush={tileBrush} />)}
  </group>{showGizmos && isSelected && selected === node.id && !node.locked && node.editable !== false && mode !== 'select' && mode !== 'hand' ? createPortal(<TransformControls ref={controls} object={group as MutableRefObject<THREE.Group>} mode={mode} space={space} size={viewMode === '2d' ? 1.35 : 1} showX={viewMode === '3d' || mode !== 'rotate'} showY={viewMode === '3d' || mode !== 'rotate'} showZ={viewMode === '3d' || mode === 'rotate'} translationSnap={snap ? .25 : undefined} rotationSnap={snap ? Math.PI / 12 : undefined} scaleSnap={snap ? .25 : undefined} onMouseDown={() => { start.current = structuredClone(node.transform); setDragging(true); if (orbit.current) orbit.current.enabled = false }} onMouseUp={finish} />, scene) : null}</>
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

function SceneContents({ document, selected, selectedIds = [selected], modelSelection, hiddenIds = [], unpickableIds = [], onSelect, mode, space, snap, focus, onTransform, onDiagnostic, initialView, showGizmos = true, viewMode, tileBrush, gamePreview }: SceneViewportProps & { gamePreview?: ReturnType<typeof resolveGameCameraPreview> }) {
  const settings = document.settings ?? DEFAULT_SCENE_SETTINGS
  const { gl, camera } = useThree()
  const observer = useRef(camera)
  useEffect(() => { gl.toneMappingExposure = settings.exposure }, [gl, settings.exposure])
  const orbit = useRef<any>(null)
  const [temporarySnap, setTemporarySnap] = useState(false)
  const diagnosticCallback = useRef(onDiagnostic)
  diagnosticCallback.current = onDiagnostic
  const diagnose = useMemo(() => reportOnce(message => diagnosticCallback.current?.(message)), [])
  return <><color attach="background" args={[settings.background]} /><ambientLight color={settings.ambientColor} intensity={settings.ambientIntensity} />{settings.fogEnabled && <fog attach="fog" args={[settings.fogColor, settings.fogNear, settings.fogFar]} />}{!gamePreview && settings.showGrid && <Grid position={viewMode === '2d' ? [0, 0, 2] : undefined} rotation={viewMode === '2d' ? [Math.PI / 2, 0, 0] : undefined} userData={{ editorHelper: true }} args={[40, 40]} cellSize={1} sectionSize={5} sectionColor="#747980" cellColor="#555a61" fadeDistance={35} infiniteGrid />}{!gamePreview && <NavigationController orbit={orbit} handMode={mode === 'hand'} viewMode={viewMode} onTemporarySnap={setTemporarySnap} />}{<OrbitControls ref={orbit} camera={observer.current} enabled={!gamePreview} target={initialView?.target} makeDefault enableRotate={false} enableDamping={false} enablePan={false} enableZoom={false} mouseButtons={{ LEFT: -1 as any, MIDDLE: -1 as any, RIGHT: -1 as any }} />}<CameraRig preview={gamePreview} document={document} selected={selected} modelSelection={modelSelection} focus={focus} orbit={orbit} /><SelectionOutline selectedIds={gamePreview ? [] : selectedIds} modelSelection={modelSelection} color={settings.selectionColor ?? '#ffad46'} width={settings.selectionWidth ?? 3} />{!gamePreview && showGizmos && <GizmoHelper renderPriority={2} alignment="bottom-center" margin={[0, 136]}><GizmoViewport axisColors={['#d87178', '#66a58b', '#6e8ec7']} labelColor="white" /></GizmoHelper>}{document.rootIds.map(id => <NodeView key={id} id={id} document={document} selected={gamePreview ? '' : selected} selectedIds={gamePreview ? [] : selectedIds} hiddenIds={gamePreview ? [] : hiddenIds} unpickableIds={unpickableIds} onSelect={gamePreview ? () => {} : onSelect} mode={gamePreview ? 'select' : modelSelection ? 'select' : mode} space={space} snap={snap || temporarySnap} onTransform={onTransform} orbit={orbit} diagnose={diagnose} showGizmos={!gamePreview && showGizmos} viewMode={viewMode} tileBrush={gamePreview ? undefined : tileBrush} />)}</>
}

/** Self-contained R3F viewport used by the independent scene editor. */
export function SceneViewport(props: SceneViewportProps) {
  const host = useRef<HTMLDivElement>(null)
  const [hostSize, setHostSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const element = host.current
    if (!element) return
    const update = () => { const rect = element.getBoundingClientRect(); setHostSize({ width: rect.width, height: rect.height }) }
    update()
    const observer = new ResizeObserver(update); observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const game = useMemo(() => {
    if (!props.gameCamera || !hostSize.width || !hostSize.height) return {}
    try { return { preview: resolveGameCameraPreview(props.document, hostSize) } }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
  }, [props.gameCamera, props.document, hostSize])
  const effectiveOrtho = props.viewMode === '2d' || props.ortho
  const authoredViewMatchesMode = props.document.dimension === props.viewMode
  const position = authoredViewMatchesMode ? props.initialView?.position : undefined
  const camera = effectiveOrtho
    ? { position: position ?? (props.viewMode === '2d' ? [0, 0, 10] as const : [7, 6, 7] as const), zoom: 65 }
    : { position: position ?? [7, 5, 7] as [number, number, number], fov: 45 }
  const rect = game.preview?.view.rect
  return <div ref={host} style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }} data-testid="scene-camera-host">
    {game.error ? <div role="alert" style={{ padding: 16 }}>{game.error}</div> : <div data-testid="scene-camera-frame" data-framing={game.preview?.view.framing}
      style={{ position: 'absolute', left: rect?.x ?? 0, top: rect?.y ?? 0, width: rect?.width ?? '100%', height: rect?.height ?? '100%' }}>
      <Canvas shadows events={viewportEvents} key={`${props.viewMode}-${effectiveOrtho ? 'orthographic' : 'perspective'}-${props.document.dimension}`} orthographic={effectiveOrtho} camera={camera} onPointerMissed={event => !props.gameCamera && !props.tileBrush && props.onSelect('', { ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey })} onCreated={({ gl }) => { gl.setClearColor('#3c3f43'); gl.domElement.tabIndex = 0; gl.domElement.setAttribute('aria-label', 'Scene viewport') }}><SceneContents {...props} gamePreview={game.preview} /></Canvas>
    </div>}
  </div>
}

export default SceneViewport
