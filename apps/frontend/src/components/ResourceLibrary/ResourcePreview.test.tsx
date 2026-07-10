import { describe, expect, test } from 'vitest'
import { renderPreview } from './ResourcePreview'

describe('renderPreview', () => {
  test('selects media and model renderers from the element kind', () => {
    expect(renderPreview({ name: 'image.png', kind: 'image' })).toBe('image')
    expect(renderPreview({ name: 'sound.ogg', kind: 'audio' })).toBe('audio')
    expect(renderPreview({ name: 'clip.webm', kind: 'video' })).toBe('video')
    expect(renderPreview({ name: 'typeface.woff2', kind: 'font' })).toBe('font')
    expect(renderPreview({ name: 'world.glb', kind: 'model' })).toBe('model')
  })

  test('selects PDF, text, and document-card fallbacks safely from extensions', () => {
    expect(renderPreview({ name: 'manual.pdf', kind: 'document' })).toBe('pdf')
    expect(renderPreview({ name: 'notes.md', kind: 'unknown' })).toBe('text')
    expect(renderPreview({ name: 'office.docx', kind: 'document' })).toBe('document-card')
    expect(renderPreview({ name: 'archive.unknown', kind: 'unknown' })).toBe('document-card')
  })
})
