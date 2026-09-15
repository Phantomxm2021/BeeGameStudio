import { describe, expect, it } from 'vitest'
import { makeFixture } from './model'
import { assertSceneDocument, assertSceneNode, assertTransform } from './validation'

describe('scene DTO validation', () => {
  it('accepts a complete fixture and preserves JSON-safe unknown metadata', () => {
    const document = makeFixture()
    document.unknown = { future: { feature: true, values: [1, 'two', null] } }
    document.nodes.hive.unknown = { sourceExtension: { version: 2 } }
    expect(() => assertSceneDocument(document)).not.toThrow()
  })

  it('rejects unreachable, duplicate-parent and cyclic hierarchy graphs', () => {
    const unreachable = makeFixture()
    unreachable.nodes.orphan = { ...unreachable.nodes.hive, id: 'orphan', parentId: null, children: [] }
    expect(() => assertSceneDocument(unreachable)).toThrow(/parentId|unreachable/)

    const mismatch = makeFixture()
    mismatch.nodes.ground.parentId = 'hive'
    expect(() => assertSceneDocument(mismatch)).toThrow(/parent mismatch|children|unreachable/)

    const cycle = makeFixture()
    cycle.nodes.root.parentId = 'hive'
    expect(() => assertSceneDocument(cycle)).toThrow(/root|cycle/)
  })

  it('requires exact finite transforms and normalized optional quaternions', () => {
    const document = makeFixture()
    document.nodes.hive.transform.scale = [1, 0, 1]
    expect(() => assertSceneDocument(document)).toThrow(/scale/)
    expect(() => assertTransform({ position: [0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] })).toThrow(/exactly three/)
    expect(() => assertTransform({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], quaternion: [0, 0, 0, 0] })).toThrow(/normalized/)
  })

  it('rejects bad source digests and component ranges', () => {
    const source = makeFixture()
    source.source.contentDigest = 'not-a-digest'
    expect(() => assertSceneDocument(source)).toThrow(/contentDigest/)
    const material = makeFixture()
    material.nodes.hive.material!.opacity = 2
    expect(() => assertSceneDocument(material)).toThrow(/opacity/)
    const light = makeFixture()
    light.nodes.sun.light!.intensity = -1
    expect(() => assertSceneDocument(light)).toThrow(/intensity/)
    const volume = makeFixture()
    volume.nodes.hive.volume!.size = [1, 0, 1]
    expect(() => assertSceneDocument(volume)).toThrow(/size/)
  })

  it('checks node and asset references, dependency closure and safe paths', () => {
    const remoteAsset = makeFixture()
    remoteAsset.assets.sprite = {
      id: 'sprite',
      name: 'sprite.png',
      mimeType: 'image/png',
      path: 'sprites/sprite.png',
      uri: 'blob:https://example.test/sprite',
    }
    expect(() => assertSceneDocument(remoteAsset)).not.toThrow()
    remoteAsset.assets.sprite.uri = 'javascript:alert(1)'
    expect(() => assertSceneDocument(remoteAsset)).toThrow(/browser-loadable URI/)

    const missingNodeAsset = makeFixture()
    missingNodeAsset.nodes.hive.assetId = 'missing'
    expect(() => assertSceneDocument(missingNodeAsset)).toThrow(/missing asset/)
    const missingDependency = makeFixture()
    missingDependency.assets.model = { id: 'model', name: 'model.gltf', mimeType: 'model/gltf+json', path: 'models/model.gltf', bytes: 'data:model/gltf+json;base64,AA==', dependencies: ['buffer.bin'] }
    expect(() => assertSceneDocument(missingDependency)).toThrow(/missing dependency/)
    const unsafePath = makeFixture()
    unsafePath.assets.model = { id: 'model', name: 'model.gltf', mimeType: 'model/gltf+json', path: '../model.gltf', bytes: 'data:model/gltf+json;base64,AA==' }
    expect(() => assertSceneDocument(unsafePath)).toThrow(/safe relative path/)
    expect(() => assertSceneNode({})).toThrow(/id/)
  })

  it('rejects unsafe metadata, accessors, symbols and cycles', () => {
    const cyclic = makeFixture() as any
    cyclic.unknown = {}; cyclic.unknown.self = cyclic.unknown
    expect(() => assertSceneDocument(cyclic)).toThrow(/cycle/)
    const accessor = makeFixture() as any
    Object.defineProperty(accessor, 'unknown', { get: () => ({}) })
    expect(() => assertSceneDocument(accessor)).toThrow(/accessor/)
    const symbol = makeFixture() as any
    const metadata = {}; Object.defineProperty(metadata, Symbol('extension'), { value: true }); symbol.unknown = metadata
    expect(() => assertSceneDocument(symbol)).toThrow(/symbol/)
    const nonJson = makeFixture() as any
    nonJson.unknown = { when: new Date() }
    expect(() => assertSceneDocument(nonJson)).toThrow(/prototype|JSON-safe/)
  })
})
