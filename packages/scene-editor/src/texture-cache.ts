import * as THREE from 'three'

// Share decoded pixels, never per-object UV transforms. Entries live only as
// long as a viewport consumer; closing the editor releases the source as well.
const sources = new Map<string, { refs: number; promise: Promise<THREE.Texture> }>()

export function acquireTextureSource(uri: string) {
  let entry = sources.get(uri)
  if (!entry) {
    entry = { refs: 0, promise: new THREE.TextureLoader().loadAsync(uri).then(texture => {
      texture.colorSpace = THREE.SRGBColorSpace
      return texture
    }) }
    sources.set(uri, entry)
  }
  entry.refs++
  const acquired = entry
  let released = false
  return { texture: acquired.promise, release() {
    if (released) return
    released = true
    if (--acquired.refs === 0) {
      if (sources.get(uri) === acquired) sources.delete(uri)
      void acquired.promise.then(texture => texture.dispose(), () => undefined)
    }
  } }
}
