import { Canvas, createPortal, events as createPointerEvents, useFrame, useThree } from '@react-three/fiber'
import { Bounds, useBounds, Grid, GizmoHelper, GizmoViewport, OrbitControls, TransformControls } from '@react-three/drei'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js'
import type { ModelSelection } from './model-structure'
import { DEFAULT_SCENE_SETTINGS } from './model'
import { LightGizmo } from './light-gizmo'
import type { LightKind, SceneAsset, SceneDocument, SceneNode, Transform, VolumeVisual } from './model'

export type SceneViewportMode = 'select' | 'translate' | 'rotate' | 'scale' | 'hand'
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

const LOOK_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><g fill="none" stroke="#11151b" stroke-width="4" stroke-linejoin="round"><path d="M2 14s4-7 12-7 12 7 12 7-4 7-12 7S2 14 2 14Z"/><circle cx="14" cy="14" r="3"/></g><g fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"><path d="M2 14s4-7 12-7 12 7 12 7-4 7-12 7S2 14 2 14Z"/><circle cx="14" cy="14" r="3"/></g></svg>')}") 14 14, crosshair`

type NavigationAction = 'orbit' | 'pan' | 'dolly' | 'look'
type NavigationRef = { action: NavigationAction | null; pointerId: number | null; hand: boolean }

function NavigationController({ orbit, handMode, onTemporarySnap }: { orbit: MutableRefObject<any>; handMode: boolean; onTemporarySnap: (active: boolean) => void }) {
  const { camera, gl } = useThree()
  const keys = useRef(new Set<string>())
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
    const dolly = (dy: number) => {
      const ortho = camera as THREE.OrthographicCamera
      if (ortho.isOrthographicCamera) {
        ortho.zoom = THREE.MathUtils.clamp(ortho.zoom * Math.exp(-dy * .01), .01, 1e4)
        ortho.updateProjectionMatrix()
      } else {
        const direction = new THREE.Vector3(); camera.getWorldDirection(direction); camera.position.addScaledVector(direction, dy * .02)
      }
      orbit.current?.update()
    }
    const look = (dx: number, dy: number) => {
      const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
      euler.y -= dx * .004; euler.x = THREE.MathUtils.clamp(euler.x - dy * .004, -Math.PI / 2 + .01, Math.PI / 2 - .01); camera.quaternion.setFromEuler(euler); syncTargetToView(); orbit.current?.update()
    }
    const pointerDown = (event: PointerEvent) => {
      viewportActive.current = true
      let action: NavigationAction | null = null
      if (event.button === 0 && event.altKey) action = 'orbit'
      else if (event.button === 0 && navigation.current.hand) action = 'pan'
      else if (event.button === 1) action = 'pan'
      else if (event.button === 2 && event.altKey) action = 'dolly'
      else if (event.button === 2) action = 'look'
      // TransformControls disables OrbitControls while a gizmo drag is active;
      // keep every camera gesture locked for that duration as well.
      if (!action || (orbit.current && orbit.current.enabled === false && navigation.current.action === null)) return
      event.preventDefault(); event.stopImmediatePropagation(); navigation.current = { action, pointerId: event.pointerId, hand: navigation.current.hand }; element.setPointerCapture(event.pointerId); if (action === 'look') syncTargetToView(); if (orbit.current) orbit.current.enabled = false
      updateCursor()
    }
    const pointerMove = (event: PointerEvent) => {
      const state = navigation.current; if (!state.action || state.pointerId !== event.pointerId) return
      event.preventDefault(); event.stopImmediatePropagation()
      if (state.action === 'orbit') orbitCamera(event.movementX, event.movementY)
      else if (state.action === 'pan') pan(event.movementX, event.movementY)
      else if (state.action === 'dolly') dolly(event.movementY)
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
    const lostCapture = (event: PointerEvent) => resetNavigation(event.pointerId)
    element.addEventListener('lostpointercapture', lostCapture)
    element.addEventListener('contextmenu', contextMenu, true)
    element.addEventListener('pointerdown', pointerDown, true); element.addEventListener('pointermove', pointerMove, true); element.addEventListener('pointerup', pointerUp, true); element.addEventListener('pointercancel', pointerUp, true)
    element.addEventListener('pointerenter', pointerEnter, true); element.addEventListener('pointerleave', pointerLeave, true)
    window.addEventListener('pointerdown', outsidePointerDown, true)
    window.addEventListener('keydown', keyDown, true); window.addEventListener('keyup', keyUp, true); window.addEventListener('blur', blur)
    let frame = 0
    let lastTime = performance.now()
    const fly = () => {
      const now = performance.now(); const dt = THREE.MathUtils.clamp((now - lastTime) / 1000, 0, .1); lastTime = now
      const state = navigation.current
      if (state.action === 'look') {
        const direction = new THREE.Vector3(); camera.getWorldDirection(direction)
        const right = new THREE.Vector3().crossVectors(direction, camera.up).normalize(); const up = camera.up.clone().normalize(); const delta = new THREE.Vector3()
        if (keys.current.has('w')) delta.add(direction); if (keys.current.has('s')) delta.sub(direction); if (keys.current.has('a')) delta.sub(right); if (keys.current.has('d')) delta.add(right); if (keys.current.has('q')) delta.sub(up); if (keys.current.has('e')) delta.add(up)
        if (delta.lengthSq()) { delta.normalize().multiplyScalar((keys.current.has('shift') ? 7.2 : 1.8) * dt); camera.position.add(delta); target().add(delta); orbit.current?.update() }
      }
      frame = requestAnimationFrame(fly)
    }
    frame = requestAnimationFrame(fly)
    return () => { cancelAnimationFrame(frame); resetNavigation(); element.removeEventListener('lostpointercapture', lostCapture); element.removeEventListener('contextmenu', contextMenu, true); element.removeEventListener('pointerdown', pointerDown, true); element.removeEventListener('pointermove', pointerMove, true); element.removeEventListener('pointerup', pointerUp, true); element.removeEventListener('pointercancel', pointerUp, true); element.removeEventListener('pointerenter', pointerEnter, true); element.removeEventListener('pointerleave', pointerLeave, true); window.removeEventListener('pointerdown', outsidePointerDown, true); window.removeEventListener('keydown', keyDown, true); window.removeEventListener('keyup', keyUp, true); window.removeEventListener('blur', blur); if (orbit.current) orbit.current.enabled = true }
  }, [camera, gl, orbit, onTemporarySnap])
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

function useLocalTexture(uri: string | undefined, onDiagnostic?: (message: string) => void) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    let alive = true
    let loaded: THREE.Texture | null = null
    setTexture(null)
    if (!uri) return () => { alive = false }
    const loader = new THREE.TextureLoader()
    loader.load(uri, next => { if (alive) { loaded = next; next.colorSpace = THREE.SRGBColorSpace; setTexture(next) } else next.dispose() }, undefined, () => onDiagnostic?.('Local texture asset could not be decoded'))
    return () => { alive = false; loaded?.dispose() }
  }, [uri, onDiagnostic])
  return texture
}

function materialProps(material: SceneNode['material'], texture: THREE.Texture | null) {
  if (!material) return { color: '#8192b5', opacity: 1, transparent: false }
  return { color: material.color, opacity: material.opacity, transparent: material.alphaMode === 'blend', depthWrite: material.alphaMode !== 'blend', alphaTest: material.alphaMode === 'mask' ? .5 : 0, map: texture ?? undefined }
}

function Primitive({ node, assets, diagnose }: { node: SceneNode; assets: Record<string, SceneAsset>; diagnose: (message: string) => void }) {
  const texture = useLocalTexture(localAssetUri(node.material?.textureAssetId ? assets[node.material.textureAssetId] : undefined), diagnose)
  const props = materialProps(node.material, texture)
  const material = node.material?.mode === 'unlit' ? <meshBasicMaterial {...props} /> : <meshStandardMaterial {...props} metalness={node.material?.metalness ?? 0} roughness={node.material?.roughness ?? .8} />
  const shape = node.kind === 'box' ? <boxGeometry args={[1, 1, 1]} /> : node.kind === 'sphere' ? <sphereGeometry args={[1, 24, 16]} /> : <planeGeometry args={[1, 1]} />
  if (node.kind === 'light' || node.kind === 'empty' || node.kind === 'model') return null
  return <mesh rotation={node.kind === 'plane' ? [-Math.PI / 2, 0, 0] : [0, 0, 0]} castShadow receiveShadow>{shape}{material}</mesh>
}

function ModelAsset({ asset, override, assets, diagnose, onReady }: { asset: SceneAsset | undefined; override: SceneNode['material']; assets: Record<string, SceneAsset>; diagnose: (message: string) => void; onReady?: () => void }) {
  const [prototype, setPrototype] = useState<THREE.Object3D | null>(null)
  const [error, setError] = useState(false)
  const [animations, setAnimations] = useState<THREE.AnimationClip[]>([])
  const mixer = useRef<THREE.AnimationMixer | null>(null)
  const overrideTexture = useLocalTexture(localAssetUri(override?.textureAssetId ? assets[override.textureAssetId] : undefined), diagnose)
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

function Volume({ volume }: { volume: VolumeVisual }) {
  const material = <meshBasicMaterial color={volume.role === 'trigger' ? '#e27ac2' : '#4ea3db'} wireframe transparent opacity={.35} />
  const geometry = volume.shape === 'sphere' ? <sphereGeometry args={[.5, 20, 12]} /> : volume.shape === 'capsule' ? <capsuleGeometry args={[.25, .5, 8, 16]} /> : <boxGeometry args={volume.size} />
  const scale = volume.shape === 'sphere' ? volume.size : volume.shape === 'capsule' ? [volume.size[0] * 2, volume.size[1], volume.size[2] * 2] as const : [1, 1, 1] as const
  return <mesh userData={{ editorHelper: true }} position={volume.offset} rotation={volume.rotation as any} scale={scale}>{geometry}{material}</mesh>
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
  useEffect(() => {
    if (!dragging) return
    const cancel = () => { if (group.current && start.current) { group.current.position.set(...start.current.position); group.current.rotation.set(...start.current.rotation); group.current.scale.set(...start.current.scale) }; start.current = null; if (controls.current) { controls.current.dragging = false; controls.current.axis = null }; setDragging(false); orbit.current && (orbit.current.enabled = true) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }
    window.addEventListener('keydown', key); window.addEventListener('pointercancel', cancel)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('pointercancel', cancel); if (start.current) cancel() }
  }, [dragging, orbit])
  if (!node || !node.visible || hiddenIds.includes(node.id)) return null
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
    {node.kind === 'model' ? <ModelAsset asset={node.assetId ? document.assets[node.assetId] : undefined} override={node.material} assets={document.assets} diagnose={diagnose} /> : node.kind === 'light' ? <Light showIcon={showGizmos || isSelected} node={node} selected={isSelected} gizmoColor={document.settings?.selectionColor ?? '#ffad46'} /> : node.kind === 'empty' ? (showGizmos ? <axesHelper args={[.35]} /> : null) : <Primitive node={node} assets={document.assets} diagnose={diagnose} />}
    {node.volume && showGizmos ? <Volume volume={node.volume} /> : null}
    {node.children.map(child => <NodeView key={child} id={child} document={document} selected={selected} selectedIds={selectedIds} hiddenIds={hiddenIds} unpickableIds={unpickableIds} onSelect={onSelect} mode={mode} space={space} snap={snap} onTransform={onTransform} orbit={orbit} diagnose={diagnose} showGizmos={showGizmos} />)}
  </group>{isSelected && selected === node.id && !node.locked && node.editable !== false && mode !== 'select' && mode !== 'hand' ? createPortal(<TransformControls ref={controls} object={group as MutableRefObject<THREE.Group>} mode={mode} space={space} translationSnap={snap ? .25 : undefined} rotationSnap={snap ? Math.PI / 12 : undefined} scaleSnap={snap ? .25 : undefined} onMouseDown={() => { start.current = structuredClone(node.transform); setDragging(true); if (orbit.current) orbit.current.enabled = false }} onMouseUp={finish} />, scene) : null}</>
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

function Light({ node, selected, gizmoColor, showIcon }: { node: SceneNode; selected: boolean; gizmoColor: string; showIcon: boolean }) {
  const light = node.light
  const target = useMemo(() => { const object = new THREE.Object3D(); object.position.set(0, 0, -1); return object }, [])
  if (!light) return null
  return <group>
    <primitive object={target} />
    {light.kind === 'ambient' ? <ambientLight color={light.color} intensity={light.intensity} />
      : light.kind === 'directional' ? <directionalLight color={light.color} intensity={light.intensity} target={target} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-18} shadow-camera-right={18} shadow-camera-top={18} shadow-camera-bottom={-18} shadow-camera-near={.1} shadow-camera-far={60} shadow-bias={-.0002} shadow-normalBias={.035} />
      : light.kind === 'point' ? <pointLight color={light.color} intensity={light.intensity} distance={light.distance ?? 0} />
      : <spotLight color={light.color} intensity={light.intensity} distance={light.distance ?? 0} angle={light.angle ?? Math.PI / 3} penumbra={light.penumbra ?? 0} target={target} />}
    {showIcon && <LightIcon kind={light.kind} color={light.color} />}
    {selected && <LightGizmo light={light} color={gizmoColor} />}
  </group>
}

function SceneContents({ document, selected, selectedIds = [selected], modelSelection, hiddenIds = [], unpickableIds = [], onSelect, mode, space, snap, focus, onTransform, onDiagnostic, initialView, showGizmos = true }: SceneViewportProps) {
  const settings = document.settings ?? DEFAULT_SCENE_SETTINGS
  const { gl } = useThree()
  useEffect(() => { gl.toneMappingExposure = settings.exposure }, [gl, settings.exposure])
  const orbit = useRef<any>(null)
  const [temporarySnap, setTemporarySnap] = useState(false)
  const diagnosticCallback = useRef(onDiagnostic)
  diagnosticCallback.current = onDiagnostic
  const diagnose = useMemo(() => reportOnce(message => diagnosticCallback.current?.(message)), [])
  return <><color attach="background" args={[settings.background]} /><ambientLight color={settings.ambientColor} intensity={settings.ambientIntensity} />{settings.fogEnabled && <fog attach="fog" args={[settings.fogColor, settings.fogNear, settings.fogFar]} />}{settings.showGrid && <Grid userData={{ editorHelper: true }} args={[40, 40]} cellSize={1} sectionSize={5} sectionColor="#747980" cellColor="#555a61" fadeDistance={35} infiniteGrid />}<NavigationController orbit={orbit} handMode={mode === 'hand'} onTemporarySnap={setTemporarySnap} /><OrbitControls ref={orbit} target={initialView?.target} makeDefault enableRotate={false} enableDamping dampingFactor={.08} enablePan enableZoom mouseButtons={{ LEFT: -1 as any, MIDDLE: THREE.MOUSE.PAN, RIGHT: -1 as any }} /><CameraRig document={document} selected={selected} modelSelection={modelSelection} focus={focus} orbit={orbit} /><SelectionOutline selectedIds={selectedIds} modelSelection={modelSelection} color={settings.selectionColor ?? '#ffad46'} width={settings.selectionWidth ?? 3} />{showGizmos && <GizmoHelper renderPriority={2} alignment="bottom-center" margin={[0, 136]}><GizmoViewport axisColors={['#d87178', '#66a58b', '#6e8ec7']} labelColor="white" /></GizmoHelper>}{document.rootIds.map(id => <NodeView key={id} id={id} document={document} selected={selected} selectedIds={selectedIds} hiddenIds={hiddenIds} unpickableIds={unpickableIds} onSelect={onSelect} mode={modelSelection ? 'select' : mode} space={space} snap={snap || temporarySnap} onTransform={onTransform} orbit={orbit} diagnose={diagnose} showGizmos={showGizmos} />)}</>
}

/** Self-contained R3F viewport used by the independent scene editor. */
export function SceneViewport(props: SceneViewportProps) {
  return <Canvas shadows events={viewportEvents} key={props.ortho ? 'orthographic' : 'perspective'} orthographic={props.ortho} camera={props.ortho ? { position: props.initialView?.position ?? [7, 6, 7], zoom: 65 } : { position: props.initialView?.position ?? [7, 5, 7], fov: 45 }} onPointerMissed={event => props.onSelect('', { ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey })} onCreated={({ gl }) => gl.setClearColor('#3c3f43')}><SceneContents {...props} /></Canvas>
}

export default SceneViewport
