import { describe, expect, it } from 'vitest'
import type { ImageComponent } from './model'
import { componentVisibleInEditor } from './viewport'

const image = (properties: Record<string, unknown>): ImageComponent => ({
  id: 'image',
  type: 'image',
  enabled: true,
  material: {
    mode: 'unlit',
    color: '#ffffff',
    metalness: 0,
    roughness: 1,
    opacity: 1,
    alphaMode: 'blend',
  },
  properties,
})

describe('scene authoring visibility', () => {
  it('shows state-driven effects so they remain authorable', () => {
    expect(componentVisibleInEditor(image({ visibleWhen: 'state == caught' }))).toBe(true)
  })

  it('does not evaluate runtime expressions in the editor', () => {
    expect(componentVisibleInEditor(image({ visibleWhen: 'state != caught' }))).toBe(true)
    expect(componentVisibleInEditor(image({ visibleWhen: 'state == calm' }))).toBe(true)
    expect(componentVisibleInEditor(image({ visibleWhen: 'letter_1.notCollected' }))).toBe(true)
    expect(componentVisibleInEditor(image({ visibleWhen: 'anyGuardChase' }))).toBe(true)
    expect(componentVisibleInEditor(image({ visibleWhen: 'awareness > 0 && state != chase' }))).toBe(true)
  })

  it('honors an explicit editor visibility override', () => {
    expect(componentVisibleInEditor(image({ visibleWhen: 'state == calm', visibleInEditor: false }))).toBe(false)
  })

  it('shows ordinary components', () => {
    expect(componentVisibleInEditor(image({}))).toBe(true)
  })
})
