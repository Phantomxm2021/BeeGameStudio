import { describe, expect, it } from 'vitest'
import { applyPatch, operations, patchFor } from './commands'
import { makeFixture, type SceneNode } from './model'
import { SceneHistory } from './history'
import { exportPackage, importPackage, makeEmptyScene } from './persistence'
import { cloneSubtreeForDuplicate } from './editor'
import { withAsset } from './inspector'

describe('GameObject component scene core', () => {
  it('adds and duplicates complete GameObject subtrees', () => {
    const empty = makeEmptyScene('empty')
    const parent: SceneNode = { id: 'parent', name: 'Parent', parentId: null, children: ['child'], active: true, locked: false, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, tags: ['anchor'], components: [] }
    const child: SceneNode = { id: 'child', name: 'Child', parentId: 'parent', children: [], active: true, locked: false, transform: { position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, tags: [], components: [{ id: 'child-collider', type: 'box-collider-2d', enabled: true, size: [1, 1], offset: [0, 0], isTrigger: false }] }
    const history = new SceneHistory(empty)
    history.commit([{ type: 'scene.addGameObject', node: parent }, { type: 'scene.addGameObject', node: child }], 'Create')
    const copy = cloneSubtreeForDuplicate(history.document, 'parent')
    history.commit(copy.nodes.map(node => ({ type: 'scene.addGameObject' as const, node })), 'Duplicate')
    expect(history.document.nodes[copy.rootId].children).toHaveLength(1)
    history.undo(); expect(history.document.nodes[copy.rootId]).toBeUndefined()
  })

  it('edits components atomically and supports undo', () => {
    const document = makeFixture(); const history = new SceneHistory(document)
    const collider = document.nodes.hive.components[0]
    if (collider.type !== 'box-collider-2d') throw new Error('invalid fixture')
    history.commit([operations.component('hive', { ...collider, isTrigger: true }, collider)], 'Trigger')
    expect(history.document.nodes.hive.components[0]).toMatchObject({ isTrigger: true })
    history.undo(); expect(history.document.nodes.hive.components[0]).toMatchObject({ isTrigger: false })
  })

  it('switches sprite assets without writing undefined optional fields', () => {
    const document = makeFixture()
    document.assets.old = { id: 'old', name: 'old.png', mimeType: 'image/png', path: 'old.png' }
    document.assets.next = { id: 'next', name: 'next.png', mimeType: 'image/png', path: 'next.png' }
    const sprite = { id: 'sprite', type: 'sprite-renderer' as const, enabled: true, assetId: 'old', material: { mode: 'unlit' as const, color: '#ffffff', metalness: 0, roughness: 1, opacity: 1, alphaMode: 'opaque' as const, textureAssetId: 'old' }, properties: {} }
    document.nodes.flower.components.push(sprite)
    const replacement = withAsset(sprite, 'next')
    expect(replacement).not.toHaveProperty('member')
    const history = new SceneHistory(document)
    history.commit([operations.component('flower', replacement, sprite)], 'Replace sprite')
    expect(history.document.nodes.flower.components[0]).toMatchObject({ type: 'sprite-renderer', assetId: 'next' })
  })

  it('preserves the selected resource member when choosing a sprite card', () => {
    const sprite = { id: 'sprite', type: 'sprite-renderer' as const, enabled: true, assetId: 'RES-UI:old', member: 'old', material: { mode: 'unlit' as const, color: '#ffffff', metalness: 0, roughness: 1, opacity: 1, alphaMode: 'opaque' as const, textureAssetId: 'RES-UI:old', textureRegion: { x: 32, y: 0, width: 32, height: 32 } }, properties: {} }
    expect(withAsset(sprite, 'RES-UI:ui_glyph_q')).toMatchObject({ assetId: 'RES-UI:ui_glyph_q', member: 'ui_glyph_q', material: { textureAssetId: 'RES-UI:ui_glyph_q' } })
    expect(withAsset(sprite, 'RES-UI:ui_glyph_q')).not.toHaveProperty('material.textureRegion')
  })

  it('rejects stale edits and only reopens the new schema', () => {
    const document = makeFixture(); const result = applyPatch(document, patchFor(document, [operations.rename('hive', 'Nest', 'Hive')], 'Rename'))
    expect(result.applied).toBe(true)
    expect(applyPatch(result.document, patchFor(result.document, [operations.rename('hive', 'Other', 'Wrong')], 'Stale')).applied).toBe(false)
    const reopened = importPackage(exportPackage(result.document)); expect(reopened.schemaVersion).toBe('scene-game-object.v2'); expect(reopened.nodes.hive.components[0].type).toBe('box-collider-2d')
  })
})
