import { describe, expect, it } from 'vitest'
import { applyPatch, patchFor } from '../src/commands'
import { makeFixture, type SceneDocument, type SceneOperation } from '../src/model'

function apply(document: SceneDocument, operations: SceneOperation[]) {
  const result = applyPatch(document, patchFor(document, operations, 'optional component test'))
  expect(result.applied).toBe(true)
  return result
}

describe('optional scene components', () => {
  const operations: Array<[string, SceneOperation]> = [
    ['material', { type: 'scene.setMaterialOverride', nodeId: 'root', material: { mode: 'standard', color: '#f4d35e', metalness: 0, roughness: .5, opacity: 1, alphaMode: 'opaque' } }],
    ['light', { type: 'scene.setLight', nodeId: 'root', light: { kind: 'point', color: '#ffffff', intensity: 2 } }],
    ['volume', { type: 'scene.setVolumeVisual', nodeId: 'root', volume: { role: 'trigger', shape: 'box', size: [1, 1, 1], offset: [0, 0, 0], rotation: [0, 0, 0] } }],
  ]

  it.each(operations)('deletes %s as an absent optional field and supports set, undo and redo', (_, operation) => {
    let document = makeFixture()
    if (!('nodeId' in operation)) throw new Error('expected node operation')
    const nodeId = operation.nodeId
    const set = apply(document, [operation])
    document = set.document
    expect(document.nodes[nodeId]).toHaveProperty(operation.type === 'scene.setMaterialOverride' ? 'material' : operation.type === 'scene.setLight' ? 'light' : 'volume')

    const undone = apply(document, set.inverse)
    document = undone.document
    const nodeAfterUndo = document.nodes[nodeId]
    expect('material' in nodeAfterUndo).toBe(false)
    expect('light' in nodeAfterUndo).toBe(false)
    expect('volume' in nodeAfterUndo).toBe(false)

    const redone = apply(document, [operation])
    const nodeAfterRedo = redone.document.nodes[nodeId]
    expect(nodeAfterRedo).not.toMatchObject({ material: undefined, light: undefined, volume: undefined })
  })

  it('detaches operations when constructing a patch', () => {
    const document = makeFixture()
    const operation: SceneOperation = { type: 'scene.renameNode', nodeId: 'root', name: 'Renamed' }
    const patch = patchFor(document, [operation], 'detached')
    operation.name = 'Caller mutation'
    expect(patch.operations).toEqual([{ type: 'scene.renameNode', nodeId: 'root', name: 'Renamed' }])
  })
})
