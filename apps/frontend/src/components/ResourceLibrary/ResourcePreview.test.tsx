import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { renderPreview } from './ResourcePreview'
import { applyMissingTextureFallback, calculateModelMetrics, configureProceduralSky, createProceduralSkyScene, persistModelMetrics } from './ModelPreview'

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

  test('extracts material and texture metadata from a loaded model', () => {
    const map = new THREE.Texture()
    map.name = 'albedo.png'
    const material = new THREE.MeshStandardMaterial({ map, name: 'Painted metal' })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)

    expect(calculateModelMetrics(mesh)).toMatchObject({
      materialCount: 1,
      materialSlots: ['Painted metal'],
      textureReferences: ['albedo.png'],
    })
  })

  test('replaces unresolved FBX texture materials with a visible neutral material', () => {
    const material = new THREE.MeshPhongMaterial({ map: new THREE.Texture(), color: 0x111111 })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)

    applyMissingTextureFallback(mesh, ['albedo.png'])

    expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial)
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xd8dce5)
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
