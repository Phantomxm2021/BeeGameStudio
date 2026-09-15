import { describe, expect, it } from 'vitest'
import { applyPatch, operations, patchFor } from './commands'
import { SceneHistory } from './history'
import { clone, makeFixture, type ScenePatchV1 } from './model'
import { canonicalJson, exportPackage, importPackage, refreshContentDigest, sha256Json } from './persistence'

describe('independent scene contract audit', () => {
  it('binds successive transactions to a fresh revision and digest', async () => {
    const initial = await refreshContentDigest(makeFixture())
    const first = applyPatch(initial, patchFor(initial, [operations.rename('hive', 'First', 'Hive Box')], 'Rename'))
    expect(first.applied, first.diagnostic).toBe(true)
    expect(first.document.source.contentRevision).toBe(String(first.document.revision))
    expect(first.document.source.contentDigest).not.toBe(initial.source.contentDigest)
    const normalized = await refreshContentDigest(first.document)
    expect(normalized.source.contentDigest).toBe(first.document.source.contentDigest)
    const second = applyPatch(first.document, patchFor(first.document, [operations.rename('hive', 'Second', 'First')], 'Rename again'))
    expect(second.applied, second.diagnostic).toBe(true)
    expect(second.document.nodes.hive.name).toBe('Second')
  })

  it('makes exact replay idempotent while rejecting changed transaction content', async () => {
    const initial = await refreshContentDigest(makeFixture())
    const patch = patchFor(initial, [operations.rename('hive', 'First', 'Hive Box')], 'Rename')
    const first = applyPatch(initial, patch)
    expect(first.applied, first.diagnostic).toBe(true)
    const replay = applyPatch(first.document, clone(patch))
    expect(replay.applied, replay.diagnostic).toBe(true)
    expect(replay.document.revision).toBe(first.document.revision)
    const changed = clone(patch); changed.base.contentDigest = 'f'.repeat(64)
    expect(applyPatch(first.document, changed).applied).toBe(false)
  })

  it('keeps prior operations atomic when a later operation fails', async () => {
    const initial = await refreshContentDigest(makeFixture()), before = clone(initial)
    const bad = patchFor(initial, [operations.rename('hive', 'First', 'Hive Box'), operations.rename('missing', 'Oops', 'Old')], 'Atomic edit')
    expect(applyPatch(initial, bad).applied).toBe(false)
    expect(initial).toEqual(before)
  })

  it.each([
    ['missing base', (p: any) => { delete p.base }],
    ['unknown envelope property', (p: any) => { p.extra = 'unsupported' }],
    ['blank transaction', (p: any) => { p.transactionId = '' }],
    ['wrong content schema', (p: any) => { p.base.contentSchemaVersion = 'unsupported' }],
    ['nonboolean visibility', (p: any) => { p.operations = [{ type: 'scene.setVisibility', nodeId: 'hive', visible: 'yes' }] }],
    ['unknown operation property', (p: any) => { p.operations[0].extra = true }],
    ['out of range material', (p: any) => { p.operations = [{ type: 'scene.setMaterialOverride', nodeId: 'hive', material: { ...makeFixture().nodes.hive.material, opacity: 9 } }] }],
    ['dangling child', (p: any) => { p.operations = [{ type: 'scene.addNode', node: { ...makeFixture().nodes.hive, id: 'new', children: ['missing'] } }] }],
  ])('rejects %s without throwing or mutating the source', async (_, mutate) => {
    const initial = await refreshContentDigest(makeFixture()), before = clone(initial)
    const patch = patchFor(initial, [operations.rename('hive', 'First', 'Hive Box')], 'Rename')
    mutate(patch)
    expect(() => applyPatch(initial, patch as ScenePatchV1)).not.toThrow()
    expect(applyPatch(initial, patch as ScenePatchV1).applied).toBe(false)
    expect(initial).toEqual(before)
  })

  it('retains a deleted subtree, sibling order and unknown data through undo/redo and package reopen', async () => {
    const initial = await refreshContentDigest(makeFixture())
    initial.nodes.hive.children = ['child']
    initial.nodes.child = { ...clone(initial.nodes.flower), id: 'child', parentId: 'hive', unknown: { runtimeOnly: { tuning: [1, 2] } } }
    const start = await refreshContentDigest(initial), history = new SceneHistory(start)
    history.commit([{ type: 'scene.removeNode', nodeId: 'hive', expectedExists: true }], 'Delete subtree')
    expect(history.document.nodes.child).toBeUndefined()
    history.undo()
    expect(history.document.nodes).toEqual(start.nodes)
    expect(history.document.rootIds).toEqual(start.rootIds)
    const reopened = importPackage(exportPackage(history.document))
    expect(reopened.nodes.child.unknown).toEqual(start.nodes.child.unknown)
    history.redo(); expect(history.document.nodes.hive).toBeUndefined()
  })

  it('isolates history from caller-owned operation objects', async () => {
    const history = new SceneHistory(await refreshContentDigest(makeFixture()))
    const op = operations.rename('hive', 'Committed', 'Hive Box')
    history.commit([op], 'Rename')
    ;(op as any).name = 'Caller mutated it'
    history.undo(); history.redo()
    expect(history.document.nodes.hive.name).toBe('Committed')
  })

  it('canonicalizes by code units and rejects non-JSON input', async () => {
    expect(canonicalJson({ z: 1, A: 2, a: 3 })).toBe('{"A":2,"a":3,"z":1}')
    expect(await sha256Json({ b: 1, a: [2] })).toBe(await sha256Json({ a: [2], b: 1 }))
    for (const bad of [{ a: undefined }, { a: NaN }, { a: Infinity }, new Date(), { a: 1n }]) {
      expect(() => canonicalJson(bad)).toThrow()
    }
  })
})
