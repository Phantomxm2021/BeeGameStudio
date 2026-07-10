import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { renderPreview } from './ResourcePreview'
import { calculateModelMetrics, persistModelMetrics } from './ModelPreview'

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

  test('selects PDF, text, and document-card fallbacks safely from extensions', () => {
    expect(renderPreview({ name: 'manual.pdf', kind: 'document' })).toBe('pdf')
    expect(renderPreview({ name: 'notes.md', kind: 'unknown' })).toBe('text')
    expect(renderPreview({ name: 'office.docx', kind: 'document' })).toBe('document-card')
    expect(renderPreview({ name: 'archive.unknown', kind: 'unknown' })).toBe('document-card')
  })
})
