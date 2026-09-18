import { describe, expect, it } from 'vitest'
import { makeFixture } from './model'
import { assertSceneDocument } from './validation'

describe('GameObject scene validation', () => {
  it('accepts the fixed component vocabulary', () => { expect(() => assertSceneDocument(makeFixture())).not.toThrow() })
  it('rejects old primitive fields and unknown components', () => {
    const old = makeFixture() as any; old.nodes.hive.kind = 'empty'; expect(() => assertSceneDocument(old)).toThrow()
    const unknown = makeFixture() as any; unknown.nodes.hive.components.push({ id: 'bad', type: 'invented', enabled: true }); expect(() => assertSceneDocument(unknown)).toThrow(/unsupported component/)
  })
  it('rejects invalid hierarchy and component data', () => {
    const cycle = makeFixture(); cycle.nodes.root.parentId = 'hive'; expect(() => assertSceneDocument(cycle)).toThrow()
    const collider = makeFixture() as any; collider.nodes.hive.components[0].size = [1]; expect(() => assertSceneDocument(collider)).toThrow(/expected 2 numbers/)
  })
})
