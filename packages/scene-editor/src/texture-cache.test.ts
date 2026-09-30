import { afterEach, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { acquireTextureSource } from './texture-cache'

afterEach(() => vi.restoreAllMocks())

it('shares concurrent atlas loads and releases only after the last consumer', async () => {
  const texture = new THREE.Texture()
  const dispose = vi.spyOn(texture, 'dispose')
  const load = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockResolvedValue(texture)
  const a = acquireTextureSource('test-atlas.png')
  const b = acquireTextureSource('test-atlas.png')
  try {
    expect(a.texture).toBe(b.texture)
    expect(await a.texture).toBe(texture)
    expect(load).toHaveBeenCalledTimes(1)
    const frame = texture.clone()
    expect(frame.source).toBe(texture.source)
    frame.dispose()
    a.release()
    a.release()
    await Promise.resolve()
    expect(dispose).not.toHaveBeenCalled()
    b.release()
    await Promise.resolve()
    expect(dispose).toHaveBeenCalledTimes(1)
  } finally { a.release(); b.release() }
  const next = acquireTextureSource('test-atlas.png')
  try { await next.texture; expect(load).toHaveBeenCalledTimes(2) }
  finally { next.release() }
})

it('allows a fresh attempt after failed consumers release the source', async () => {
  const load = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockRejectedValueOnce(new Error('decode failed')).mockResolvedValue(new THREE.Texture())
  const failed = acquireTextureSource('failed-atlas.png')
  await expect(failed.texture).rejects.toThrow('decode failed')
  failed.release()
  const next = acquireTextureSource('failed-atlas.png')
  try { await next.texture; expect(load).toHaveBeenCalledTimes(2) }
  finally { next.release() }
})
