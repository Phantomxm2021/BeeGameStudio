import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Palette, Pause, Play, Repeat2, Sun } from 'lucide-react'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import assimpWasmUrl from 'assimpjs/dist/assimpjs.wasm?url'
import type { MaterialTextureBindings } from './materialTextureBindings'

export type ModelMetrics = {
  triangles: number
  vertices: number
  materialCount: number
  materialSlots: string[]
  textureReferences: string[]
  unresolvedTextureReferences: string[]
  bounds: { width: number; height: number; depth: number }
}

type LoadedModel = {
  object: THREE.Object3D
  animations: THREE.AnimationClip[]
  /** Only direct FBX loads need a neutral material for unresolved external textures. */
  applyMissingTextureFallback: boolean
}

type ModelPreviewProps = {
  url: string
  extension: string
  materialTextureBindings?: MaterialTextureBindings
  textureUrls?: Readonly<Record<string, string>>
  onMetrics?: (metrics: ModelMetrics) => void | Promise<void>
  onMetricsError?: (error: Error) => void
}

type TextureTransformSnapshot = {
  mapping: THREE.AnyMapping
  channel: number
  wrapS: THREE.Wrapping
  wrapT: THREE.Wrapping
  magFilter: THREE.MagnificationTextureFilter
  minFilter: THREE.MinificationTextureFilter
  anisotropy: number
  flipY: boolean
  generateMipmaps: boolean
  premultiplyAlpha: boolean
  offset: [number, number]
  repeat: [number, number]
  center: [number, number]
  rotation: number
  matrixAutoUpdate: boolean
  matrix: number[]
}

type MaterialWithMap = THREE.Material & { map?: THREE.Texture }
const textureTransformKey = '__beegamePreviewBaseColorTransform'

type PreviewMode = 'albedo' | 'lit'
type PreviewMaterialState = {
  color?: THREE.Color
  emissive?: THREE.Color
  emissiveMap?: THREE.Texture | null
  emissiveIntensity?: number
  toneMapped?: boolean
}
type PreviewMaterial = MaterialWithMap & {
  color?: THREE.Color
  emissive?: THREE.Color
  emissiveMap?: THREE.Texture | null
  emissiveIntensity?: number
  toneMapped?: boolean
}
type PreviewStage = {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  environment: THREE.Texture
  lights: THREE.Light[]
}

export function snapshotTextureTransform(texture: THREE.Texture | undefined): TextureTransformSnapshot | undefined {
  if (!texture) return undefined
  return {
    mapping: texture.mapping,
    channel: texture.channel,
    wrapS: texture.wrapS,
    wrapT: texture.wrapT,
    magFilter: texture.magFilter,
    minFilter: texture.minFilter,
    anisotropy: texture.anisotropy,
    flipY: texture.flipY,
    generateMipmaps: texture.generateMipmaps,
    premultiplyAlpha: texture.premultiplyAlpha,
    offset: [texture.offset.x, texture.offset.y],
    repeat: [texture.repeat.x, texture.repeat.y],
    center: [texture.center.x, texture.center.y],
    rotation: texture.rotation,
    matrixAutoUpdate: texture.matrixAutoUpdate,
    matrix: [...texture.matrix.elements],
  }
}

export function applyTextureTransform(texture: THREE.Texture, transform: TextureTransformSnapshot | undefined): void {
  if (!transform) return
  texture.mapping = transform.mapping
  texture.channel = transform.channel
  texture.wrapS = transform.wrapS
  texture.wrapT = transform.wrapT
  texture.magFilter = transform.magFilter
  texture.minFilter = transform.minFilter
  texture.anisotropy = transform.anisotropy
  texture.flipY = transform.flipY
  texture.generateMipmaps = transform.generateMipmaps
  texture.premultiplyAlpha = transform.premultiplyAlpha
  texture.offset.set(...transform.offset)
  texture.repeat.set(...transform.repeat)
  texture.center.set(...transform.center)
  texture.rotation = transform.rotation
  texture.matrixAutoUpdate = transform.matrixAutoUpdate
  if (!transform.matrixAutoUpdate) texture.matrix.fromArray(transform.matrix)
  texture.needsUpdate = true
}

function materialTextureTransform(material: THREE.Material): TextureTransformSnapshot | undefined {
  const direct = snapshotTextureTransform((material as MaterialWithMap).map)
  if (direct) return direct
  const stored = material.userData[textureTransformKey]
  return isTextureTransformSnapshot(stored) ? stored : undefined
}

function isTextureTransformSnapshot(value: unknown): value is TextureTransformSnapshot {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<TextureTransformSnapshot>
  return typeof record.channel === 'number' && Array.isArray(record.offset) && Array.isArray(record.repeat) && Array.isArray(record.center) && Array.isArray(record.matrix)
}

/**
 * Albedo mode makes a color map self-illuminated and neutral, so texture and
 * UV inspection is not affected by the studio's PBR lighting. Lit mode
 * restores the imported material values exactly.
 */
export function applyPreviewMaterialMode(
  object: THREE.Object3D,
  mode: PreviewMode,
  states: Map<THREE.Material, PreviewMaterialState>,
): void {
  object.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    materials.forEach(rawMaterial => {
      const material = rawMaterial as PreviewMaterial
      if (mode === 'lit') {
        const state = states.get(material)
        if (!state) return
        if (state.color && material.color) material.color.copy(state.color)
        if (state.emissive && material.emissive) material.emissive.copy(state.emissive)
        if ('emissiveMap' in material) material.emissiveMap = state.emissiveMap
        if (typeof state.emissiveIntensity === 'number' && 'emissiveIntensity' in material) material.emissiveIntensity = state.emissiveIntensity
        if (typeof state.toneMapped === 'boolean') material.toneMapped = state.toneMapped
        material.needsUpdate = true
        return
      }

      if (!states.has(material)) {
        states.set(material, {
          ...(material.color ? { color: material.color.clone() } : {}),
          ...(material.emissive ? { emissive: material.emissive.clone() } : {}),
          ...('emissiveMap' in material ? { emissiveMap: material.emissiveMap ?? null } : {}),
          ...('emissiveIntensity' in material ? { emissiveIntensity: material.emissiveIntensity } : {}),
          toneMapped: material.toneMapped,
        })
      }
      if (material.emissive && material.map) {
        material.color?.set(0x000000)
        material.emissive.set(0xffffff)
        material.emissiveMap = material.map
        material.emissiveIntensity = 1
      } else {
        // Unlit/basic materials already display their maps without lights.
        material.color?.set(0xffffff)
      }
      material.toneMapped = false
      material.needsUpdate = true
    })
  })
}

function applyPreviewStageMode(
  stage: PreviewStage,
  object: THREE.Object3D,
  mode: PreviewMode,
  states: Map<THREE.Material, PreviewMaterialState>,
): void {
  const lit = mode === 'lit'
  stage.scene.environment = lit ? stage.environment : null
  stage.scene.environmentIntensity = lit ? 0.58 : 0
  stage.lights.forEach(light => { light.visible = lit })
  stage.renderer.toneMapping = lit ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping
  stage.renderer.toneMappingExposure = lit ? 0.88 : 1
  applyPreviewMaterialMode(object, mode, states)
}

export async function applyBoundBaseColorTextures(
  object: THREE.Object3D,
  bindings: MaterialTextureBindings,
  textureUrls: Readonly<Record<string, string>>,
): Promise<void> {
  const loader = new THREE.TextureLoader()
  const textures = new Map<string, THREE.Texture>()
  await Promise.all(Object.values(bindings).flatMap(binding => binding.baseColor ? [binding.baseColor] : []).map(async elementId => {
    const url = textureUrls[elementId]
    if (!url || textures.has(elementId)) return
    const texture = await loader.loadAsync(url)
    texture.colorSpace = THREE.SRGBColorSpace
    textures.set(elementId, texture)
  }))
  object.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    materials.forEach(material => {
      const elementId = bindings[material.name]?.baseColor
      const sourceTexture = elementId ? textures.get(elementId) : undefined
      if (!sourceTexture) return
      // Texture transform belongs to a material binding, not the image asset.
      // Clone the loaded image so different material slots can safely use the
      // same atlas with their own UV channel or transform.
      const texture = sourceTexture.clone()
      applyTextureTransform(texture, materialTextureTransform(material))
      const standard = material as THREE.MeshStandardMaterial
      standard.map = texture
      // A bound base-color image is authoritative; inherited FBX diffuse
      // colors should not tint or wash out the atlas.
      standard.color.set(0xffffff)
      standard.needsUpdate = true
    })
  })
}

export async function persistModelMetrics(
  onMetrics: (metrics: ModelMetrics) => void | Promise<void>,
  metrics: ModelMetrics,
): Promise<Error | undefined> {
  try {
    await onMetrics(metrics)
    return undefined
  } catch (reason) {
    return reason instanceof Error ? reason : new Error('Unable to save model metrics')
  }
}

function disposeMaterial(material: THREE.Material) {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) value.dispose()
  }
  material.dispose()
}

function disposeObject(object: THREE.Object3D) {
  object.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    node.geometry.dispose()
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    materials.forEach(disposeMaterial)
  })
}

function textureReference(texture: THREE.Texture): string | undefined {
  if (texture.name) return texture.name
  const image = texture.image as { currentSrc?: string; src?: string } | undefined
  const source = image?.currentSrc || image?.src
  if (!source) return undefined
  try {
    return new URL(source).pathname.split('/').pop() || source
  } catch {
    return source.split('/').pop() || source
  }
}

function referenceBasename(reference: string): string {
  try {
    return new URL(reference).pathname.split('/').pop() || reference
  } catch {
    return reference.split('/').pop() || reference
  }
}

export function calculateModelMetrics(object: THREE.Object3D, unresolvedTextureReferences: readonly string[] = []): ModelMetrics {
  let triangles = 0
  let vertices = 0
  const materials = new Set<THREE.Material>()
  const textures = new Set<string>()
  object.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    const position = node.geometry.getAttribute('position')
    vertices += position?.count ?? 0
    triangles += node.geometry.index ? node.geometry.index.count / 3 : (position?.count ?? 0) / 3
    const meshMaterials = Array.isArray(node.material) ? node.material : [node.material]
    meshMaterials.forEach(material => {
      materials.add(material)
      for (const value of Object.values(material)) {
        if (!(value instanceof THREE.Texture)) continue
        const reference = textureReference(value)
        if (reference) textures.add(reference)
      }
    })
  })
  const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3())
  return {
    triangles: Math.floor(triangles),
    vertices,
    materialCount: materials.size,
    materialSlots: [...materials].map((material, index) => material.name || `Material ${index + 1}`),
    textureReferences: [...textures],
    unresolvedTextureReferences: [...new Set(unresolvedTextureReferences.map(referenceBasename))]
      .filter(reference => !textures.has(reference)),
    bounds: { width: size.x, height: size.y, depth: size.z },
  }
}

/**
 * FBX texture URLs are relative to the original authoring directory. A signed
 * object URL cannot grant those follow-up requests access, so keep the model
 * inspectable with a neutral PBR material rather than rendering it black.
 */
export function applyMissingTextureFallback(object: THREE.Object3D, unresolvedTextureReferences: readonly string[]): void {
  if (unresolvedTextureReferences.length === 0) return
  object.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    const originalMaterials = Array.isArray(node.material) ? node.material : [node.material]
    const fallbackMaterials = originalMaterials.map((material) => {
      const transform = materialTextureTransform(material)
      material.dispose()
      const fallback = new THREE.MeshStandardMaterial({
        color: 0xd8dce5,
        roughness: 0.72,
        metalness: 0.08,
        side: THREE.DoubleSide,
        vertexColors: node.geometry.getAttribute('color') !== undefined,
      })
      fallback.name = material.name
      if (transform) fallback.userData[textureTransformKey] = transform
      return fallback
    })
    node.material = Array.isArray(node.material) ? fallbackMaterials : fallbackMaterials[0]
  })
}

/** Preserve imported per-vertex color data even when a material is later rebound to a Pack texture. */
export function enableVertexColors(object: THREE.Object3D): void {
  object.traverse(node => {
    if (!(node instanceof THREE.Mesh) || node.geometry.getAttribute('color') === undefined) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    materials.forEach(material => {
      if (!('vertexColors' in material)) return
      material.vertexColors = true
      material.needsUpdate = true
    })
  })
}

/** Configure Three's physical-atmosphere Sky for both the visible sky and PMREM HDR environment. */
export function configureProceduralSky(sky: Sky): void {
  const uniforms = sky.material.uniforms
  uniforms.turbidity.value = 7
  uniforms.rayleigh.value = 1.6
  uniforms.mieCoefficient.value = 0.006
  uniforms.mieDirectionalG.value = 0.78

  const elevation = THREE.MathUtils.degToRad(27)
  const azimuth = THREE.MathUtils.degToRad(155)
  uniforms.sunPosition.value.setFromSphericalCoords(1, Math.PI / 2 - elevation, azimuth)
}

export function createProceduralSkyScene(): { scene: THREE.Scene; sky: Sky } {
  const scene = new THREE.Scene()
  const sky = new Sky()
  sky.scale.setScalar(10000)
  configureProceduralSky(sky)
  scene.add(sky)
  return { scene, sky }
}

export function normalizeModelPreviewError(reason: unknown): Error {
  if (reason instanceof Error) return reason
  return new Error(typeof reason === 'string' && reason.trim() ? reason : 'Unknown model loading error')
}

async function loadModel(url: string, extension: string, onUnresolvedTexture?: (reference: string) => void): Promise<LoadedModel> {
  const normalized = extension.toLowerCase()
  if (normalized === 'glb' || normalized === 'gltf') {
    const gltf = await new GLTFLoader().loadAsync(url)
    return { object: gltf.scene, animations: gltf.animations, applyMissingTextureFallback: false }
  }
  if (normalized === 'obj') {
    const object = await new OBJLoader().loadAsync(url)
    return { object, animations: modelAnimations(object), applyMissingTextureFallback: false }
  }
  if (normalized === 'fbx') {
    const manager = new THREE.LoadingManager()
    manager.setURLModifier((requestedUrl) => {
      if (requestedUrl !== url) onUnresolvedTexture?.(requestedUrl)
      return requestedUrl
    })
    try {
      const object = await new FBXLoader(manager).loadAsync(url)
      return { object, animations: modelAnimations(object), applyMissingTextureFallback: true }
    } catch (threeError) {
      return loadFbxWithAssimpFallback(url, threeError)
    }
  }
  throw new Error('Unsupported model format')
}

/**
 * FBX is an interchange format with many exporter-specific variants. When the
 * browser's lightweight loader rejects one, convert only that preview request
 * to a canonical GLB through Assimp's WebAssembly build. The source FBX stays
 * untouched in the Pack.
 */
async function loadFbxWithAssimpFallback(url: string, originalError: unknown): Promise<LoadedModel> {
  const response = await fetch(url)
  if (!response.ok) throw normalizeModelPreviewError(originalError)
  try {
    const [{ default: createAssimp }, bytes] = await Promise.all([
      import('assimpjs'),
      response.arrayBuffer(),
    ])
    const assimp = await createAssimp({ locateFile: () => assimpWasmUrl })
    const files = new assimp.FileList()
    files.AddFile('preview.fbx', new Uint8Array(bytes))
    const converted = assimp.ConvertFileList(files, 'glb2')
    if (!converted.IsSuccess() || converted.FileCount() < 1) {
      throw new Error(converted.GetErrorCode() || 'Assimp could not convert this FBX')
    }
    const glb = converted.GetFile(0).GetContent()
    const glbBytes = new Uint8Array(glb.byteLength)
    glbBytes.set(glb)
    const blobUrl = URL.createObjectURL(new Blob([glbBytes.buffer], { type: 'model/gltf-binary' }))
    try {
      const gltf = await new GLTFLoader().loadAsync(blobUrl)
      return { object: gltf.scene, animations: gltf.animations, applyMissingTextureFallback: false }
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
  } catch (fallbackError) {
    const primary = normalizeModelPreviewError(originalError)
    const fallback = normalizeModelPreviewError(fallbackError)
    throw new Error(`FBX loader failed (${primary.message}); GLB preview conversion failed (${fallback.message})`)
  }
}

export function modelAnimations(object: THREE.Object3D): THREE.AnimationClip[] {
  const animations = (object as THREE.Object3D & { animations?: THREE.AnimationClip[] }).animations
  return Array.isArray(animations) ? animations : []
}

export function ModelPreview({ url, extension, materialTextureBindings = {}, textureUrls = {}, onMetrics, onMetricsError }: ModelPreviewProps) {
  const host = useRef<HTMLDivElement>(null)
  const onMetricsRef = useRef(onMetrics)
  const onMetricsErrorRef = useRef(onMetricsError)
  const mixerRef = useRef<THREE.AnimationMixer | undefined>(undefined)
  const animationActionsRef = useRef<THREE.AnimationAction[]>([])
  const activeActionRef = useRef<THREE.AnimationAction | undefined>(undefined)
  const activeClipRef = useRef<THREE.AnimationClip | undefined>(undefined)
  const selectedAnimationRef = useRef(0)
  const isPlayingRef = useRef(false)
  const isLoopingRef = useRef(false)
  const modelRef = useRef<THREE.Object3D | undefined>(undefined)
  const stageRef = useRef<PreviewStage | undefined>(undefined)
  const previewModeRef = useRef<PreviewMode>('albedo')
  const previewMaterialStatesRef = useRef(new Map<THREE.Material, PreviewMaterialState>())
  const [error, setError] = useState<string>()
  const [animations, setAnimations] = useState<THREE.AnimationClip[]>([])
  const [selectedAnimation, setSelectedAnimation] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLooping, setIsLooping] = useState(false)
  const [timelineTime, setTimelineTime] = useState(0)
  const [previewMode, setPreviewMode] = useState<PreviewMode>('albedo')

  useEffect(() => { onMetricsRef.current = onMetrics }, [onMetrics])
  useEffect(() => { onMetricsErrorRef.current = onMetricsError }, [onMetricsError])
  useEffect(() => {
    previewModeRef.current = previewMode
    const stage = stageRef.current
    const model = modelRef.current
    if (stage && model) applyPreviewStageMode(stage, model, previewMode, previewMaterialStatesRef.current)
  }, [previewMode])
  useEffect(() => { selectedAnimationRef.current = selectedAnimation }, [selectedAnimation])
  useEffect(() => { isPlayingRef.current = isPlaying; if (activeActionRef.current) activeActionRef.current.paused = !isPlaying }, [isPlaying])
  useEffect(() => {
    isLoopingRef.current = isLooping
    const action = activeActionRef.current
    if (!action) return
    // Three keeps internal loop counters after an action has repeated. Switching
    // from LoopRepeat to LoopOnce in-place can therefore leave the action in a
    // finished state even though the controls say it can be played. Rebuild the
    // selected action from its authored first pose whenever its loop mode changes.
    restartAnimationAction(action, mixerRef.current, isLooping, isPlayingRef.current)
    setTimelineTime(0)
  }, [isLooping])
  useEffect(() => {
    const nextAction = animationActionsRef.current[selectedAnimation]
    if (!nextAction || nextAction === activeActionRef.current) return
    // Previewing one clip must be deterministic. Fading the previous action
    // leaves it scheduled in the mixer, which blends unrelated transforms
    // when a model has multiple clips. Stop it before starting the next one.
    activeActionRef.current?.stop()
    mixerRef.current?.setTime(0)
    nextAction.reset().play()
    configureAnimationLoop(nextAction, isLoopingRef.current)
    nextAction.paused = !isPlayingRef.current
    activeActionRef.current = nextAction
    activeClipRef.current = nextAction.getClip()
    setTimelineTime(0)
  }, [selectedAnimation])

  useEffect(() => {
    if (!host.current) return
    setError(undefined)
    setAnimations([])
    setTimelineTime(0)
    selectedAnimationRef.current = 0
    setSelectedAnimation(0)
    const container = host.current
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#121317')
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000)
    camera.position.set(3, 3, 3)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.88
    const pmremGenerator = new THREE.PMREMGenerator(renderer)
    const { scene: environmentScene, sky } = createProceduralSkyScene()
    const environmentTarget = pmremGenerator.fromScene(environmentScene, 0.04)
    scene.environment = environmentTarget.texture
    scene.environmentIntensity = 0.58
    const controls = new OrbitControls(camera, renderer.domElement)
    const hemisphere = new THREE.HemisphereLight(0xc7d6ff, 0x101217, 0.62)
    const key = new THREE.DirectionalLight(0xf4f7ff, 1.35)
    const fill = new THREE.DirectionalLight(0xb7c9ef, 0.52)
    const rim = new THREE.DirectionalLight(0xd9e4ff, 0.72)
    scene.add(hemisphere, key, fill, rim)
    const stage: PreviewStage = { scene, renderer, environment: environmentTarget.texture, lights: [hemisphere, key, fill, rim] }
    stageRef.current = stage
    container.appendChild(renderer.domElement)
    let model: THREE.Object3D | undefined
    let mixer: THREE.AnimationMixer | undefined
    let frame = 0
    let active = true
    let lastTimelineUpdate = 0
    const clock = new THREE.Clock()

    const resize = () => {
      const { width, height } = container.getBoundingClientRect()
      renderer.setSize(width || 1, height || 1)
      camera.aspect = (width || 1) / (height || 1)
      camera.updateProjectionMatrix()
    }
    const draw = () => {
      if (mixer && isPlayingRef.current) {
        mixer.update(clock.getDelta())
        const clipDuration = activeClipRef.current?.duration
        const now = performance.now()
        if (clipDuration && now - lastTimelineUpdate > 80) {
          const actionTime = activeActionRef.current?.time ?? mixer.time
          const nextTime = isLoopingRef.current ? actionTime % clipDuration : Math.min(actionTime, clipDuration)
          setTimelineTime(nextTime)
          if (!isLoopingRef.current && nextTime >= clipDuration) {
            const action = activeActionRef.current
            // A non-looping preview returns to its authored first pose after
            // completion. The next Play action can therefore always start
            // deterministically from time zero.
            mixer.setTime(0)
            action?.reset().play()
            if (action) action.paused = true
            setTimelineTime(0)
            isPlayingRef.current = false
            setIsPlaying(false)
          }
          lastTimelineUpdate = now
        }
      }
      controls.update()
      renderer.render(scene, camera)
      frame = requestAnimationFrame(draw)
    }
    resize(); draw()
    const observer = new ResizeObserver(resize)
    observer.observe(container)

    const unresolvedTextures = new Set<string>()
    loadModel(url, extension, (reference) => unresolvedTextures.add(reference))
      .then(async loaded => {
        if (!active) {
          disposeObject(loaded.object)
          return
        }
        if (loaded.applyMissingTextureFallback) applyMissingTextureFallback(loaded.object, [...unresolvedTextures])
        enableVertexColors(loaded.object)
        await applyBoundBaseColorTextures(loaded.object, materialTextureBindings, textureUrls).catch(() => undefined)
        model = loaded.object
        modelRef.current = loaded.object
        previewMaterialStatesRef.current = new Map()
        applyPreviewStageMode(stage, loaded.object, previewModeRef.current, previewMaterialStatesRef.current)
        scene.add(loaded.object)
        if (loaded.animations.length) {
          mixer = new THREE.AnimationMixer(loaded.object)
          mixerRef.current = mixer
          animationActionsRef.current = loaded.animations.map(clip => mixer!.clipAction(clip))
          const initialIndex = Math.min(selectedAnimationRef.current, loaded.animations.length - 1)
          const initialAction = animationActionsRef.current[initialIndex]
          initialAction.reset().play()
          configureAnimationLoop(initialAction, isLoopingRef.current)
          initialAction.paused = !isPlayingRef.current
          activeActionRef.current = initialAction
          activeClipRef.current = loaded.animations[initialIndex]
          setTimelineTime(0)
          setSelectedAnimation(initialIndex)
          setAnimations(loaded.animations)
        } else {
          mixerRef.current = undefined
          animationActionsRef.current = []
          activeActionRef.current = undefined
          activeClipRef.current = undefined
          setAnimations([])
        }
        const bounds = new THREE.Box3().setFromObject(loaded.object)
        const center = bounds.getCenter(new THREE.Vector3())
        const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 0.5)
        controls.target.copy(center)
        camera.position.copy(center).add(new THREE.Vector3(radius * 2, radius * 1.5, radius * 2))
        key.position.copy(center).add(new THREE.Vector3(radius * 2.5, radius * 3, radius * 2))
        fill.position.copy(center).add(new THREE.Vector3(-radius * 2, radius, radius * 1.5))
        rim.position.copy(center).add(new THREE.Vector3(-radius * 1.5, radius * 2.5, -radius * 2))
        key.target.position.copy(center); fill.target.position.copy(center); rim.target.position.copy(center)
        scene.add(key.target, fill.target, rim.target)
        camera.lookAt(center)
        controls.update()
        if (onMetricsRef.current) {
          void persistModelMetrics(onMetricsRef.current, calculateModelMetrics(loaded.object, loaded.applyMissingTextureFallback ? [...unresolvedTextures] : [])).then(metricsError => {
            if (!metricsError || !active) return
            setError('模型信息保存失败，请重试。')
            onMetricsErrorRef.current?.(metricsError)
          })
        }
      })
      .catch(reason => {
        if (!active) return
        const error = normalizeModelPreviewError(reason)
        console.error('Resource model preview failed', { extension, url, error })
        onMetricsErrorRef.current?.(error)
        setError(`Model preview failed: ${error.message || 'Unknown model loading error'}`)
      })

    return () => {
      active = false
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      mixer?.stopAllAction()
      if (mixer && model) mixer.uncacheRoot(model)
      if (mixerRef.current === mixer) mixerRef.current = undefined
      if (modelRef.current === model) modelRef.current = undefined
      if (stageRef.current === stage) stageRef.current = undefined
      previewMaterialStatesRef.current = new Map()
      animationActionsRef.current = []
      activeActionRef.current = undefined
      activeClipRef.current = undefined
      if (model) disposeObject(model)
      environmentTarget.dispose()
      pmremGenerator.dispose()
      sky.geometry.dispose()
      sky.material.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [extension, materialTextureBindings, textureUrls, url])

  const activeDuration = animations[selectedAnimation]?.duration ?? 0
  const timelineProgress = activeDuration > 0 ? Math.min(Math.max(timelineTime / activeDuration, 0), 1) * 100 : 0
  const scrubTimeline = (value: number) => {
    const bounded = Math.min(Math.max(value, 0), activeDuration)
    mixerRef.current?.setTime(bounded)
    setTimelineTime(bounded)
  }
  const togglePlayback = () => {
    if (isPlaying) {
      setIsPlaying(false)
      return
    }
    const action = activeActionRef.current
    if (!action) return
    const duration = activeClipRef.current?.duration ?? 0
    if (duration > 0 && action.time >= duration) {
      mixerRef.current?.setTime(0)
      action.reset()
      setTimelineTime(0)
    }
    configureAnimationLoop(action, isLoopingRef.current)
    action.enabled = true
    action.play()
    action.paused = false
    setIsPlaying(true)
  }

  return <div className="relative h-full min-h-64 w-full">
    <div ref={host} className="h-full min-h-64 w-full" />
    <div className="absolute left-1/2 top-3 z-10 inline-flex -translate-x-1/2 rounded-lg border border-white/[0.1] bg-zinc-950/80 p-1 shadow-lg backdrop-blur">
      <button type="button" aria-label="Albedo preview" title="原色预览" onClick={() => setPreviewMode('albedo')} className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition ${previewMode === 'albedo' ? 'bg-white/[0.12] text-white' : 'text-zinc-500 hover:text-zinc-200'}`}>
        <Palette className="h-3.5 w-3.5" />原色
      </button>
      <button type="button" aria-label="Studio lighting preview" title="工作室光照" onClick={() => setPreviewMode('lit')} className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition ${previewMode === 'lit' ? 'bg-white/[0.12] text-white' : 'text-zinc-500 hover:text-zinc-200'}`}>
        <Sun className="h-3.5 w-3.5" />光照
      </button>
    </div>
    {animations.length > 0 ? (
      <div className="absolute bottom-3 left-1/2 w-[min(31rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-xl border border-white/[0.12] bg-zinc-950/88 px-2.5 py-2 shadow-xl backdrop-blur">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={isPlaying ? 'Pause animation' : 'Play animation'}
            title={isPlaying ? 'Pause animation' : 'Play animation'}
            onClick={togglePlayback}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-100 transition hover:bg-white/[0.1]"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <select
            aria-label="Model animation"
            value={selectedAnimation}
            onChange={event => setSelectedAnimation(Number(event.target.value))}
            className="type-caption-2 min-w-0 flex-1 truncate rounded-md border-0 bg-transparent px-1 py-1 text-zinc-200 outline-none"
          >
            {animations.map((clip, index) => <option key={`${clip.uuid}:${index}`} value={index}>{clip.name || `Animation ${index + 1}`}</option>)}
          </select>
          <span className="type-code-sm shrink-0 text-zinc-500">{formatAnimationTime(timelineTime)} / {formatAnimationTime(activeDuration)}</span>
          <button
            type="button"
            aria-label={isLooping ? 'Disable animation loop' : 'Enable animation loop'}
            title={isLooping ? 'Loop enabled' : 'Loop disabled'}
            onClick={() => setIsLooping(value => !value)}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition ${isLooping ? 'bg-white/[0.12] text-zinc-100' : 'text-zinc-500 hover:bg-white/[0.08] hover:text-zinc-200'}`}
          >
            <Repeat2 className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="relative mt-2 h-2 rounded-full bg-white/[0.12] focus-within:ring-2 focus-within:ring-emerald-300/50">
          <div className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-emerald-300/90 shadow-[0_0_10px_rgba(110,231,183,0.3)]" style={{ width: `${timelineProgress}%` }} />
          <input
            type="range"
            min={0}
            max={Math.max(activeDuration, 0.01)}
            step={0.01}
            value={Math.min(timelineTime, activeDuration)}
            aria-label="Animation timeline"
            onChange={event => scrubTimeline(Number(event.target.value))}
            className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0"
          />
        </div>
      </div>
    ) : null}
    {error && <p className="absolute inset-0 grid place-items-center text-sm text-zinc-300">{error}</p>}
  </div>
}

function configureAnimationLoop(action: THREE.AnimationAction, loop: boolean): void {
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1)
  action.clampWhenFinished = !loop
}

export function restartAnimationAction(action: THREE.AnimationAction, mixer: THREE.AnimationMixer | undefined, loop: boolean, shouldPlay: boolean): void {
  action.stop()
  mixer?.setTime(0)
  configureAnimationLoop(action, loop)
  action.reset()
  action.enabled = true
  action.play()
  action.paused = !shouldPlay
}

function formatAnimationTime(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(value, 0) : 0
  const minutes = Math.floor(safe / 60)
  const seconds = safe - minutes * 60
  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`
}
