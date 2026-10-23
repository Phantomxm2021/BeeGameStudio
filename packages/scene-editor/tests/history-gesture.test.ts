import { describe, expect, it } from 'vitest'
import { makeFixture } from '../src/model'
import { SceneHistory } from '../src/history'
import { operations } from '../src/commands'

describe('inspector gesture history', () => {
  it('undoes and redoes a continuous gesture as one step, keeping surrounding edits separate', () => {
    const history = new SceneHistory(makeFixture())
    history.commit([operations.rename('flower', 'Before')], 'Rename')
    history.beginGesture()
    for (const x of [2, 3, 4]) {
      const node = history.document.nodes.flower
      history.commit([operations.transform('flower', { ...node.transform, position: [x, 0, 0] }, node.transform)], 'Drag')
    }
    history.endGesture()
    history.undo()
    expect(history.document.nodes.flower.transform.position).toEqual([1.4, 1.2, 0])
    expect(history.document.nodes.flower.name).toBe('Before')
    history.redo()
    expect(history.document.nodes.flower.transform.position).toEqual([4, 0, 0])
    history.undo()
    history.undo()
    expect(history.document.nodes.flower.name).toBe('Flower')
  })
});
