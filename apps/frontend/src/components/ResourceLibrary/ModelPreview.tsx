import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
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

type ModelPreviewProps = {
  url: string
  extension: string
  materialTextureBindings?: MaterialTextureBindings
  textureUrls?: Readonly<Record<string, string>>
  onMetrics?: (metrics: ModelMetrics) => void | Promise<void>
  onMetricsError?: (error: Error) => void
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
      const texture = elementId ? textures.get(elementId) : undefined
      if (!texture) return
      const standard = material as THREE.MeshStandardMaterial
      standard.map = texture
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
      material.dispose()
      const fallback = new THREE.MeshStandardMaterial({
        color: 0xd8dce5,
        roughness: 0.72,
        metalness: 0.08,
        side: THREE.DoubleSide,
      })
      fallback.name = material.name
      return fallback
    })
    node.material = Array.isArray(node.material) ? fallbackMaterials : fallbackMaterials[0]
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

async function loadModel(url: string, extension: string, onUnresolvedTexture?: (reference: string) => void): Promise<THREE.Object3D> {
  const normalized = extension.toLowerCase()
  if (normalized === 'glb' || normalized === 'gltf') return (await new GLTFLoader().loadAsync(url)).scene
  if (normalized === 'obj') return new OBJLoader().loadAsync(url)
  if (normalized === 'fbx') {
    const manager = new THREE.LoadingManager()
    manager.setURLModifier((requestedUrl) => {
      if (requestedUrl !== url) onUnresolvedTexture?.(requestedUrl)
      return requestedUrl
    })
    try {
      return await new FBXLoader(manager).loadAsync(url)
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
async function loadFbxWithAssimpFallback(url: string, originalError: unknown): Promise<THREE.Object3D> {
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
      return (await new GLTFLoader().loadAsync(blobUrl)).scene
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
  } catch (fallbackError) {
    const primary = normalizeModelPreviewError(originalError)
    const fallback = normalizeModelPreviewError(fallbackError)
    throw new Error(`FBX loader failed (${primary.message}); GLB preview conversion failed (${fallback.message})`)
  }
}

export function ModelPreview({ url, extension, materialTextureBindings = {}, textureUrls = {}, onMetrics, onMetricsError }: ModelPreviewProps) {
  const host = useRef<HTMLDivElement>(null)
  const onMetricsRef = useRef(onMetrics)
  const onMetricsErrorRef = useRef(onMetricsError)
  const [error, setError] = useState<string>()

  useEffect(() => { onMetricsRef.current = onMetrics }, [onMetrics])
  useEffect(() => { onMetricsErrorRef.current = onMetricsError }, [onMetricsError])

  useEffect(() => {
    if (!host.current) return
    const container = host.current
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#18181b')
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000)
    camera.position.set(3, 3, 3)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.1
    const pmremGenerator = new THREE.PMREMGenerator(renderer)
    const { scene: environmentScene, sky } = createProceduralSkyScene()
    const environmentTarget = pmremGenerator.fromScene(environmentScene, 0.04)
    scene.environment = environmentTarget.texture
    const controls = new OrbitControls(camera, renderer.domElement)
    const hemisphere = new THREE.HemisphereLight(0xf6f1e7, 0x171a21, 1.5)
    const key = new THREE.DirectionalLight(0xfff4dd, 3.1)
    const fill = new THREE.DirectionalLight(0xb9d5ff, 1.4)
    const rim = new THREE.DirectionalLight(0xffd4a8, 2.2)
    scene.add(hemisphere, key, fill, rim)
    container.appendChild(renderer.domElement)
    let model: THREE.Object3D | undefined
    let frame = 0
    let active = true

    const resize = () => {
      const { width, height } = container.getBoundingClientRect()
      renderer.setSize(width || 1, height || 1)
      camera.aspect = (width || 1) / (height || 1)
      camera.updateProjectionMatrix()
    }
    const draw = () => { controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(draw) }
    resize(); draw()
    const observer = new ResizeObserver(resize)
    observer.observe(container)

    const unresolvedTextures = new Set<string>()
    loadModel(url, extension, (reference) => unresolvedTextures.add(reference))
      .then(async loaded => {
        if (!active) {
          disposeObject(loaded)
          return
        }
        applyMissingTextureFallback(loaded, [...unresolvedTextures])
        await applyBoundBaseColorTextures(loaded, materialTextureBindings, textureUrls).catch(() => undefined)
        model = loaded
        scene.add(loaded)
        const bounds = new THREE.Box3().setFromObject(loaded)
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
          void persistModelMetrics(onMetricsRef.current, calculateModelMetrics(loaded, [...unresolvedTextures])).then(metricsError => {
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
      if (model) disposeObject(model)
      environmentTarget.dispose()
      pmremGenerator.dispose()
      sky.geometry.dispose()
      sky.material.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [extension, materialTextureBindings, textureUrls, url])

  return <div className="relative h-full min-h-64 w-full"><div ref={host} className="h-full min-h-64 w-full" />{error && <p className="absolute inset-0 grid place-items-center text-sm text-zinc-300">{error}</p>}</div>
}
