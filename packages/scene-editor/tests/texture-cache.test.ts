import { afterEach, expect, test, vi } from 'vitest'
import * as THREE from 'three'
import { acquireTextureSource } from '../src/texture-cache'

afterEach(() => vi.restoreAllMocks())

test('600 sprite consumers decode one image, isolate UVs, and release the shared source', async () => {
  const texture = new THREE.Texture({ width: 128, height: 128 } as HTMLImageElement)
  const load = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockResolvedValue(texture)
  const dispose = vi.spyOn(texture, 'dispose')
  const consumers = Array.from({ length: 600 }, () => acquireTextureSource('blob:atlas'))
  const sources = await Promise.all(consumers.map(item => item.texture))
  expect(load).toHaveBeenCalledTimes(1)
  const first = sources[0].clone(), second = sources[1].clone()
  first.offset.set(.25, .5)
  expect(second.offset.toArray()).toEqual([0, 0])
  expect(first.source).toBe(second.source)
  for (const consumer of consumers.slice(0, -1)) consumer.release()
  await Promise.resolve()
  expect(dispose).not.toHaveBeenCalled()
  consumers.at(-1)!.release()
  consumers.at(-1)!.release()
  await Promise.resolve()
  expect(dispose).toHaveBeenCalledTimes(1)
  first.dispose(); second.dispose()
  const next = acquireTextureSource('blob:atlas')
  await next.texture
  expect(load).toHaveBeenCalledTimes(2)
  next.release()
})

test('unmount before decode releases its result, and failed loads can be retried', async () => {
  let finish!: (texture: THREE.Texture) => void
  const load = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = acquireTextureSource('blob:pending')
  pending.release()
  const texture = new THREE.Texture()
  const dispose = vi.spyOn(texture, 'dispose')
  finish(texture)
  await pending.texture
  expect(dispose).toHaveBeenCalledOnce()
  load.mockRejectedValueOnce(new Error('decode failed'))
  const failure = acquireTextureSource('blob:failed')
  await expect(failure.texture).rejects.toThrow('decode failed')
  failure.release()
  load.mockResolvedValueOnce(new THREE.Texture())
  const retry = acquireTextureSource('blob:failed')
  await expect(retry.texture).resolves.toBeInstanceOf(THREE.Texture)
  retry.release()
})
