import { describe, expect, it } from 'vitest'
import { resolveUnityNavigationAction, wheelPixels } from '../src/navigation'

const pointer = (button: number, modifiers: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({
  button,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...modifiers,
})

describe('Unity Scene View navigation mapping', () => {
  const threeD = { viewMode: '3d' as const, handMode: false, apple: false }

  it('maps a three-button mouse consistently', () => {
    expect(resolveUnityNavigationAction(pointer(1), threeD)).toBe('pan')
    expect(resolveUnityNavigationAction(pointer(0, { altKey: true }), threeD)).toBe('orbit')
    expect(resolveUnityNavigationAction(pointer(2, { altKey: true }), threeD)).toBe('dolly')
    expect(resolveUnityNavigationAction(pointer(2), threeD)).toBe('look')
  })

  it('uses the documented macOS trackpad alternatives', () => {
    const mac = { ...threeD, apple: true }
    expect(resolveUnityNavigationAction(pointer(0, { altKey: true, metaKey: true }), mac)).toBe('pan')
    expect(resolveUnityNavigationAction(pointer(0, { altKey: true, ctrlKey: true }), mac)).toBe('dolly')
  })

  it('uses Alt+Control+left-drag to pan on Windows and Linux', () => {
    expect(resolveUnityNavigationAction(pointer(0, { altKey: true, ctrlKey: true }), threeD)).toBe('pan')
  })

  it('separates 2D and 3D navigation from camera projection', () => {
    expect(resolveUnityNavigationAction(pointer(2), { ...threeD, viewMode: '2d' })).toBe('pan')
    expect(resolveUnityNavigationAction(pointer(2), threeD)).toBe('look')
    expect(resolveUnityNavigationAction(pointer(0, { altKey: true }), { ...threeD, viewMode: '2d' })).toBeNull()
    expect(resolveUnityNavigationAction(pointer(0, { altKey: true }), threeD)).toBe('orbit')
  })

  it('normalizes browser wheel units before zooming', () => {
    expect(wheelPixels({ deltaY: 2, deltaMode: 0 }, 800)).toBe(2)
    expect(wheelPixels({ deltaY: 2, deltaMode: 1 }, 800)).toBe(32)
    expect(wheelPixels({ deltaY: 2, deltaMode: 2 }, 800)).toBe(1600)
  })
})
