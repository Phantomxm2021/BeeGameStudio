import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { renderPreview } from './ResourcePreview'
import { annotateAuthoredGltfTextureNames, applyMissingTextureFallback, applyPreviewMaterialMode, applyTextureTransform, calculateModelMetrics, configureProceduralSky, createProceduralSkyScene, enableVertexColors, modelAnimations, normalizeModelPreviewError, persistModelMetrics, resolveModelExternalResourceUrl, restartAnimationAction, snapshotTextureTransform } from './ModelPreview'

describe('renderPreview', () => {
  test('selects media and model renderers from the element kind', () => {
    expect(renderPreview({ name: 'image.png', kind: 'image' })).toBe('image')
    expect(renderPreview({ name: 'sound.ogg', kind: 'audio' })).toBe('audio')
    expect(renderPreview({ name: 'clip.webm', kind: 'video' })).toBe('video')
    expect(renderPreview({ name: 'typeface.woff2', kind: 'font' })).toBe('font')
    expect(renderPreview({ name: 'world.glb', kind: 'model' })).toBe('model')
  })

  test('does not attempt a model loader for an unsupported model extension', () => {
    expect(renderPreview({ name: 'legacy.asset', kind: 'model' })).toBe('document-card')
  })

  test('reports a model metrics persistence error instead of leaving a rejected promise', async () => {
    const error = new Error('offline')
    const result = await persistModelMetrics(async () => { throw error }, {
      triangles: 12,
      vertices: 8,
      materialCount: 2,
      bounds: { width: 1, height: 2, depth: 3 },
    })

    expect(result).toBe(error)
  })

  test('retains a model loader failure for diagnostics instead of replacing it with a generic message', () => {
    const original = new Error('THREE.FBXLoader: Unexpected token')
    expect(normalizeModelPreviewError(original)).toBe(original)
    expect(normalizeModelPreviewError('Model bytes are invalid').message).toBe('Model bytes are invalid')
  })

  test('extracts material and texture metadata from a loaded model', () => {
    const map = new THREE.Texture()
    map.name = 'albedo.png'
    const material = new THREE.MeshStandardMaterial({ map, name: 'Painted metal' })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)

    expect(calculateModelMetrics(mesh)).toMatchObject({
      materialCount: 1,
      materialSlots: ['Painted metal'],
      textureReferences: ['albedo.png'],
      components: expect.arrayContaining([
        expect.objectContaining({ kind: 'mesh' }),
        expect.objectContaining({ kind: 'material', name: 'Painted metal' }),
        expect.objectContaining({ kind: 'texture', name: 'albedo.png' }),
      ]),
    })
  })

  test('resolves a loader request only through an explicit dependency binding', () => {
    const modelUrl = 'https://storage.test/object/sign/pack/models/ship.fbx?token=model'
    const textureUrl = 'https://storage.test/object/sign/pack/textures/texture-a.png?token=texture'
    expect(resolveModelExternalResourceUrl(
      'https://storage.test/object/sign/pack/models/texture-a.png',
      modelUrl,
      { 'Textures/texture-a.png': textureUrl },
    )).toBe(textureUrl)
    expect(resolveModelExternalResourceUrl(
      'https://storage.test/object/sign/pack/models/texture-a.png',
      modelUrl,
      { 'SetA/texture-a.png': 'https://storage.test/a', 'SetB/texture-a.png': 'https://storage.test/b' },
    )).toBeUndefined()
  })

  test('resolves external images retained by an Assimp GLB against explicit dependencies', () => {
    const modelUrl = 'blob:http://127.0.0.1:62173/686e096c-ae55-40bb-8cba-9fd31c86895d'
    const textureUrl = 'https://storage.test/object/sign/pack/textures/base.png?token=texture'

    expect(resolveModelExternalResourceUrl(
      'blob:http://127.0.0.1:62173/Textures\\base.png',
      modelUrl,
      { 'Textures/base.png': textureUrl },
    )).toBe(textureUrl)
  })

  test('preserves authored external texture paths and deduplicates material slots', () => {
    const first = new THREE.MeshStandardMaterial({ name: 'Shared' })
    const second = new THREE.MeshStandardMaterial({ name: 'Shared' })
    const object = new THREE.Group()
    object.add(new THREE.Mesh(new THREE.BoxGeometry(), first), new THREE.Mesh(new THREE.BoxGeometry(), second))
    const metrics = calculateModelMetrics(object, ['Textures/texture-a.png', 'Textures/texture-a.png'])
    expect(metrics.materialSlots).toEqual(['Shared'])
    expect(metrics.unresolvedTextureReferences).toEqual(['Textures/texture-a.png'])
  })

  test('preserves the authored image reference on textures loaded from a converted GLB', () => {
    const texture = new THREE.Texture()
    const material = new THREE.MeshStandardMaterial({ map: texture })
    const object = new THREE.Mesh(new THREE.BoxGeometry(), material)
    const associations = new Map<unknown, { textures?: number }>([[texture, { textures: 0 }]])

    annotateAuthoredGltfTextureNames(object, {
      associations,
      json: { textures: [{ source: 0 }], images: [{ uri: 'Textures\\base.png' }] },
    })

    expect(texture.name).toBe('Textures/base.png')
    expect(calculateModelMetrics(object).textureReferences).toEqual(['Textures/base.png'])
  })

  test('keeps embedded animation clips inside the inspected logical asset', () => {
    const clip = new THREE.AnimationClip('Walk', 1, [])
    expect(calculateModelMetrics(new THREE.Group(), [], [clip]).components).toEqual([
      expect.objectContaining({ id: 'animation:0', kind: 'animation-clip', name: 'Walk' }),
    ])
  })

  test('preserves animation clips attached by loaders such as FBX', () => {
    const clip = new THREE.AnimationClip('Walk', 1, [])
    const object = new THREE.Group() as THREE.Group & { animations: THREE.AnimationClip[] }
    object.animations = [clip]

    expect(modelAnimations(object)).toEqual([clip])
  })

  test('restarts an action when switching from looping to a paused one-shot preview', () => {
    const object = new THREE.Group()
    const mixer = new THREE.AnimationMixer(object)
    const clip = new THREE.AnimationClip('Walk', 1, [])
    const action = mixer.clipAction(clip).setLoop(THREE.LoopRepeat, Infinity).play()
    mixer.update(0.8)

    restartAnimationAction(action, mixer, false, false)

    expect(action.loop).toBe(THREE.LoopOnce)
    expect(action.repetitions).toBe(1)
    expect(action.time).toBe(0)
    expect(action.enabled).toBe(true)
    expect(action.paused).toBe(true)
  })

  test('preserves source texture UV channel and atlas transform when rebinding an image', () => {
    const source = new THREE.Texture()
    source.channel = 1
    source.flipY = false
    source.wrapS = THREE.RepeatWrapping
    source.wrapT = THREE.MirroredRepeatWrapping
    source.offset.set(0.25, 0.5)
    source.repeat.set(0.5, 0.25)
    source.center.set(0.5, 0.5)
    source.rotation = Math.PI / 2
    const rebound = new THREE.Texture()

    applyTextureTransform(rebound, snapshotTextureTransform(source))

    expect(rebound.channel).toBe(1)
    expect(rebound.flipY).toBe(false)
    expect(rebound.wrapS).toBe(THREE.RepeatWrapping)
    expect(rebound.wrapT).toBe(THREE.MirroredRepeatWrapping)
    expect(rebound.offset.toArray()).toEqual([0.25, 0.5])
    expect(rebound.repeat.toArray()).toEqual([0.5, 0.25])
    expect(rebound.rotation).toBe(Math.PI / 2)
  })

  test('uses a neutral self-illuminated material for albedo inspection and restores lit values', () => {
    const map = new THREE.Texture()
    const material = new THREE.MeshStandardMaterial({ color: 0x886644, emissive: 0x112233, emissiveIntensity: 0.4, map })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material)
    const states = new Map()

    applyPreviewMaterialMode(mesh, 'albedo', states)
    expect(material.color.getHex()).toBe(0x000000)
    expect(material.emissive.getHex()).toBe(0xffffff)
    expect(material.emissiveMap).toBe(map)
    expect(material.toneMapped).toBe(false)

    applyPreviewMaterialMode(mesh, 'lit', states)
    expect(material.color.getHex()).toBe(0x886644)
    expect(material.emissive.getHex()).toBe(0x112233)
    expect(material.emissiveIntensity).toBe(0.4)
  })

  test('replaces unresolved FBX texture materials with a visible neutral material', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3).fill(1), 3))
    const material = new THREE.MeshPhongMaterial({ map: new THREE.Texture(), color: 0x111111, name: 'Body' })
    const mesh = new THREE.Mesh(geometry, material)

    applyMissingTextureFallback(mesh, ['albedo.png'])

    expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial)
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xd8dce5)
    expect((mesh.material as THREE.MeshStandardMaterial).name).toBe('Body')
    expect((mesh.material as THREE.MeshStandardMaterial).vertexColors).toBe(true)
  })

  test('enables imported vertex colors without replacing the converted material', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3).fill(0.5), 3))
    const material = new THREE.MeshStandardMaterial({ vertexColors: false })
    const mesh = new THREE.Mesh(geometry, material)

    enableVertexColors(mesh)

    expect(material.vertexColors).toBe(true)
  })

  test('configures the physical sky with a finite sun direction for HDRI generation', () => {
    const sky = new Sky()

    configureProceduralSky(sky)

    const sunPosition = sky.material.uniforms.sunPosition.value as THREE.Vector3
    expect(sunPosition.length()).toBeGreaterThan(0)
    expect(sky.material.uniforms.turbidity.value).toBeGreaterThan(0)
  })

  test('keeps the procedural sky in an offscreen scene instead of the camera-visible stage', () => {
    const { scene, sky } = createProceduralSkyScene()

    expect(scene.children).toContain(sky)
    expect(scene.background).toBeNull()
  })

  test('selects PDF, text, and document-card fallbacks safely from extensions', () => {
    expect(renderPreview({ name: 'manual.pdf', kind: 'document' })).toBe('pdf')
    expect(renderPreview({ name: 'notes.md', kind: 'unknown' })).toBe('text')
    expect(renderPreview({ name: 'office.docx', kind: 'document' })).toBe('document-card')
    expect(renderPreview({ name: 'archive.unknown', kind: 'unknown' })).toBe('document-card')
  })
})
