import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { applyBoundBaseColorTextures, ModelPreview } from './ModelPreview'

const mocks = vi.hoisted(() => ({
  load: vi.fn(), render: vi.fn(), dispose: vi.fn(),
  change: undefined as undefined | (() => void),
}))
vi.mock('three', async importOriginal => {
  const actual = await importOriginal<typeof import('three')>()
  return { ...actual,
    WebGLRenderer: class {
      domElement = document.createElement('canvas')
      setSize() {}
      render = mocks.render
      dispose = mocks.dispose
      forceContextLoss() {}
    },
    PMREMGenerator: class {
      fromScene() { return { texture: new actual.Texture(), dispose() {} } }
      dispose() {}
    },
  }
})
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({ GLTFLoader: class { loadAsync = mocks.load } }))
vi.mock('three/examples/jsm/controls/OrbitControls.js', async () => {
  const { Vector3 } = await import('three')
  return { OrbitControls: class {
    target = new Vector3()
    update() {}
    dispose() {}
    addEventListener(_type: string, listener: () => void) { mocks.change = listener }
    removeEventListener() { mocks.change = undefined }
  } }
})
vi.mock('../beui/project-select', () => ({ ProjectSelect: () => null }))
vi.mock('../beui/motion/animated-number', () => ({ AnimatedNumber: ({ children }: { children: unknown }) => children }))

const frames = new Map<number, FrameRequestCallback>()
let nextFrame = 0
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function mesh() {
  const material = new THREE.MeshStandardMaterial(); material.name = 'body'
  return new THREE.Mesh(new THREE.BoxGeometry(), material)
}
async function flushFrame() {
  const pending = [...frames]; frames.clear()
  await act(async () => { for (const [, draw] of pending) draw(performance.now()) })
}
beforeEach(() => {
  vi.clearAllMocks(); frames.clear(); nextFrame = 0
  vi.stubGlobal('requestAnimationFrame', (draw: FrameRequestCallback) => { frames.set(++nextFrame, draw); return nextFrame })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('disposes a model and its delayed texture after unmount without attaching it', async () => {
  const object = mesh(); const texture = new THREE.Texture()
  const geometryDispose = vi.spyOn(object.geometry, 'dispose')
  const materialDispose = vi.spyOn(object.material, 'dispose')
  const textureDispose = vi.spyOn(THREE.Texture.prototype, 'dispose')
  const pending = deferred<THREE.Texture>()
  vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockReturnValue(pending.promise)
  mocks.load.mockResolvedValue({ scene: object, animations: [] })
  const onMetrics = vi.fn()
  const view = render(<ModelPreview url="old.glb" sourcePath="old.glb" extension="glb" materialTextureBindings={{ body: { baseColor: 'image' } }} textureUrls={{ image: 'texture.png' }} onMetrics={onMetrics} />)
  await act(async () => {})
  view.unmount()
  await act(async () => pending.resolve(texture))
  expect(object.parent).toBeNull()
  expect(geometryDispose).toHaveBeenCalledOnce()
  expect(materialDispose).toHaveBeenCalledOnce()
  expect(textureDispose).toHaveBeenCalledTimes(2) // loaded source and assigned clone
  expect(onMetrics).not.toHaveBeenCalled()
  expect(frames.size).toBe(0)
})

it('keeps the new preview when the previous model texture finishes after switching', async () => {
  const old = mesh(); const current = mesh(); current.material.name = 'unbound'
  const oldDispose = vi.spyOn(old.geometry, 'dispose')
  const pending = deferred<THREE.Texture>()
  vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockReturnValue(pending.promise)
  mocks.load.mockResolvedValueOnce({ scene: old, animations: [] }).mockResolvedValueOnce({ scene: current, animations: [] })
  const bindings = { body: { baseColor: 'image' } }; const urls = { image: 'texture.png' }
  const view = render(<ModelPreview url="old.glb" sourcePath="model.glb" extension="glb" materialTextureBindings={bindings} textureUrls={urls} />)
  await act(async () => {})
  // The new model uses no overrides, so it can finish independently.
  view.rerender(<ModelPreview url="new.glb" sourcePath="model.glb" extension="glb" />)
  await act(async () => {})
  expect(current.parent).not.toBeNull()
  await act(async () => pending.resolve(new THREE.Texture()))
  expect(oldDispose).toHaveBeenCalledOnce()
  expect(old.parent).toBeNull()
  expect(current.parent).not.toBeNull()
  expect(mocks.load).toHaveBeenCalledTimes(2)
})

it('renders static models on demand and wakes for controls, mode, playback and scrubbing', async () => {
  const object = mesh()
  mocks.load.mockResolvedValue({ scene: object, animations: [new THREE.AnimationClip('idle', 2, [])] })
  const view = render(<ModelPreview url="model.glb" sourcePath="model.glb" extension="glb" />)
  await act(async () => {})
  await flushFrame()
  expect(frames.size).toBe(0)
  const renders = mocks.render.mock.calls.length
  act(() => mocks.change?.())
  await flushFrame()
  expect(mocks.render).toHaveBeenCalledTimes(renders + 1)
  fireEvent.click(view.getByRole('button', { name: /lighting|工作室光照/i }))
  await flushFrame()
  expect(frames.size).toBe(0)
  fireEvent.click(view.getByRole('button', { name: 'Play animation' }))
  await flushFrame()
  expect(frames.size).toBe(1)
  fireEvent.click(view.getByRole('button', { name: 'Pause animation' }))
  await flushFrame()
  expect(frames.size).toBe(0)
  fireEvent.change(view.getByRole('slider', { name: 'Animation timeline' }), { target: { value: '1' } })
  expect(frames.size).toBe(1)
  await flushFrame()
  expect(frames.size).toBe(0)
  expect(mocks.load).toHaveBeenCalledOnce()
})

it('releases successful late textures when another binding fails', async () => {
  const late = deferred<THREE.Texture>(); const texture = new THREE.Texture()
  const dispose = vi.spyOn(texture, 'dispose')
  vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(url => url === 'bad' ? Promise.reject(new Error('bad image')) : late.promise)
  const result = applyBoundBaseColorTextures(mesh(), { body: { baseColor: 'a' }, other: { baseColor: 'b' } }, { a: 'bad', b: 'late' })
  const rejected = expect(result).rejects.toThrow('bad image')
  late.resolve(texture)
  await rejected
  expect(dispose).toHaveBeenCalledOnce()
})

it('loads a shared image once and gives each material its own transform', async () => {
  const object = mesh(); const second = new THREE.MeshStandardMaterial(); second.name = 'other'
  object.add(new THREE.Mesh(object.geometry, second))
  const texture = new THREE.Texture(); const dispose = vi.spyOn(texture, 'dispose')
  const load = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockResolvedValue(texture)
  await applyBoundBaseColorTextures(object, { body: { baseColor: 'a' }, other: { baseColor: 'a' } }, { a: 'atlas' })
  expect(load).toHaveBeenCalledOnce()
  expect(object.material.map).not.toBe(second.map)
  expect(dispose).toHaveBeenCalledOnce()
})
