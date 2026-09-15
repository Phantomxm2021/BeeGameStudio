import { describe, expect, it } from 'vitest'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { makeFixture } from '../src/model'
import { SceneHistory } from '../src/history'
import { nodeWorldMatrix, transformSelection } from '../src/selection-transform'

const position = (matrix: Matrix4) => new Vector3().setFromMatrixPosition(matrix).toArray()

describe('selection world transform', () => {
  it('moves multiple siblings and restores all of them in one undo', () => {
    const doc = makeFixture()
    const next = structuredClone(doc.nodes.hive.transform); next.position[0] += 3
    const history = new SceneHistory(doc)
    history.commit(transformSelection(doc, ['hive', 'flower'], 'hive', next), 'Move selection')
    expect(history.document.nodes.hive.transform.position[0]).toBeCloseTo(1.3)
    expect(history.document.nodes.flower.transform.position[0]).toBeCloseTo(4.4)
    history.undo()
    expect(history.document.nodes.hive.transform).toEqual(doc.nodes.hive.transform)
    expect(history.document.nodes.flower.transform).toEqual(doc.nodes.flower.transform)
    expect(history.canUndo).toBe(false)
  })
  it('does not double-transform a selected descendant', () => {
    const doc = makeFixture()
    doc.nodes.flower.parentId = 'hive'
    doc.nodes.root.children = doc.nodes.root.children.filter(id => id !== 'flower')
    doc.nodes.hive.children.push('flower')
    const before = position(nodeWorldMatrix(doc, 'flower'))
    const next = structuredClone(doc.nodes.hive.transform); next.position[1] += 2
    const selected = transformSelection(doc, ['hive', 'flower'], 'hive', next)
    expect(selected).toHaveLength(1)
    const history = new SceneHistory(doc); history.commit(selected, 'Move selected subtree')
    expect(position(nodeWorldMatrix(history.document, 'flower'))[1]).toBeCloseTo(before[1] + 2)
    expect(history.document.nodes.flower.transform).toEqual(doc.nodes.flower.transform)
  })
  it('rotates the selection around the active object in world coordinates', () => {
    const doc = makeFixture()
    const next = structuredClone(doc.nodes.hive.transform); next.rotation[1] = Math.PI / 2
    const pivot = new Vector3(...doc.nodes.hive.transform.position)
    const expected = new Vector3(...doc.nodes.flower.transform.position).sub(pivot).applyQuaternion(new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0))).add(pivot)
    const history = new SceneHistory(doc)
    history.commit(transformSelection(doc, ['hive', 'flower'], 'hive', next), 'Rotate selection')
    position(nodeWorldMatrix(history.document, 'flower')).forEach((value, index) => expect(value).toBeCloseTo(expected.toArray()[index]))
  })
  it('rejects locked selections without generating partial operations', () => {
    const doc = makeFixture(); doc.nodes.flower.locked = true
    expect(() => transformSelection(doc, ['hive', 'flower'], 'hive', doc.nodes.hive.transform)).toThrow(/locked/)
  })
})
