import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'

export type ModelMetrics = {
  triangles: number
  vertices: number
  materialCount: number
  bounds: { width: number; height: number; depth: number }
}

type ModelPreviewProps = { url: string; extension: string; onMetrics?: (metrics: ModelMetrics) => void }

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

function calculateMetrics(object: THREE.Object3D): ModelMetrics {
  let triangles = 0
  let vertices = 0
  const materials = new Set<THREE.Material>()
  object.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    const position = node.geometry.getAttribute('position')
    vertices += position?.count ?? 0
    triangles += node.geometry.index ? node.geometry.index.count / 3 : (position?.count ?? 0) / 3
    const meshMaterials = Array.isArray(node.material) ? node.material : [node.material]
    meshMaterials.forEach(material => materials.add(material))
  })
  const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3())
  return { triangles: Math.floor(triangles), vertices, materialCount: materials.size, bounds: { width: size.x, height: size.y, depth: size.z } }
}

async function loadModel(url: string, extension: string): Promise<THREE.Object3D> {
  const normalized = extension.toLowerCase()
  if (normalized === 'glb' || normalized === 'gltf') return (await new GLTFLoader().loadAsync(url)).scene
  if (normalized === 'obj') return new OBJLoader().loadAsync(url)
  if (normalized === 'fbx') return new FBXLoader().loadAsync(url)
  throw new Error('Unsupported model format')
}

export function ModelPreview({ url, extension, onMetrics }: ModelPreviewProps) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!host.current) return
    const container = host.current
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#18181b')
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000)
    camera.position.set(3, 3, 3)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    const controls = new OrbitControls(camera, renderer.domElement)
    const light = new THREE.HemisphereLight(0xffffff, 0x303030, 2)
    scene.add(light)
    container.appendChild(renderer.domElement)
    let model: THREE.Object3D | undefined
    let frame = 0

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

    loadModel(url, extension)
      .then(loaded => {
        model = loaded
        scene.add(loaded)
        const bounds = new THREE.Box3().setFromObject(loaded)
        const center = bounds.getCenter(new THREE.Vector3())
        const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 0.5)
        controls.target.copy(center)
        camera.position.copy(center).add(new THREE.Vector3(radius * 2, radius * 1.5, radius * 2))
        camera.lookAt(center)
        controls.update()
        onMetrics?.(calculateMetrics(loaded))
      })
      .catch(() => setError('Model preview is unavailable.'))

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      if (model) disposeObject(model)
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [extension, onMetrics, url])

  return <div className="relative h-full min-h-64 w-full"><div ref={host} className="h-full min-h-64 w-full" />{error && <p className="absolute inset-0 grid place-items-center text-sm text-zinc-300">{error}</p>}</div>
}
