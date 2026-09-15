import { describe, expect, it } from 'vitest'
import { applyPatch, operations, patchFor } from './commands'
import { makeFixture } from './model'
import { SceneHistory } from './history'
import { canonicalJson, exportPackage, exportYaml, importPackage, makeEmptyScene, sha256Sync } from './persistence'
import { cloneSubtreeForDuplicate } from './editor'

describe('scene patch core', () => {
  it('starts as a real blank scene and duplicates a complete subtree as one undoable edit', () => {
    const empty = makeEmptyScene('test-empty')
    expect(empty.rootIds).toEqual([])
    expect(empty.nodes).toEqual({})
    const parent = { id: 'parent', name: 'Parent', kind: 'empty' as const, parentId: null, children: ['child'], visible: true, locked: false, transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] } }
    const child = { id: 'child', name: 'Child', kind: 'box' as const, parentId: 'parent', children: [], visible: true, locked: false, transform: { position: [1, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] } }
    const history = new SceneHistory(empty)
    history.commit([{ type: 'scene.addNode', node: parent }, { type: 'scene.addNode', node: child }], 'Create subtree')
    const copy = cloneSubtreeForDuplicate(history.document, 'parent')
    history.commit(copy.nodes.map(node => ({ type: 'scene.addNode' as const, node })), 'Duplicate subtree')
    expect(history.document.nodes[copy.rootId].children).toHaveLength(1)
    const copyChild = history.document.nodes[copy.rootId].children[0]
    expect(history.document.nodes[copyChild].parentId).toBe(copy.rootId)
    history.undo()
    expect(history.document.nodes[copy.rootId]).toBeUndefined()
  })
  it('uses canonical JSON and real SHA-256 for content identity', () => { expect(sha256Sync('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'); expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}'); expect(() => canonicalJson({ bad: undefined })).toThrow() })
  it('applies atomically and rejects stale expected values', () => {
    const doc = makeFixture(); const patch = patchFor(doc, [operations.rename('hive', 'Nest', 'Hive Box')], 'rename'); const result = applyPatch(doc, patch)
    expect(result.applied).toBe(true); expect(result.document.nodes.hive.name).toBe('Nest'); expect(result.document.source.contentRevision).toBe('2'); expect(result.document.source.contentDigest).toMatch(/^[a-f0-9]{64}$/)
    const stale = applyPatch(result.document, { ...patch, transactionId: crypto.randomUUID() }); expect(stale.applied).toBe(false); expect(stale.diagnostic).toContain('stale')
  })
  it('undoes a removed subtree including children and order', () => {
    const doc = makeFixture(); const child = { ...doc.nodes.flower, id: 'flower-child', name: 'Child', parentId: 'hive', children: [] }; doc.nodes.hive.children.push(child.id); doc.nodes[child.id] = child
    const history = new SceneHistory(doc); history.commit([{ type: 'scene.removeNode', nodeId: 'hive', expectedExists: true }], 'delete subtree'); expect(history.document.nodes.hive).toBeUndefined(); history.undo(); expect(history.document.nodes.hive.children).toContain('flower-child'); expect(history.document.nodes['flower-child']).toBeDefined()
  })
  it('rejects hierarchy cycles and locked edits without mutating', () => {
    const doc = makeFixture(); doc.nodes.hive.locked = true; const lock = applyPatch(doc, patchFor(doc, [operations.transform('hive', { position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, doc.nodes.hive.transform)], 'locked')); expect(lock.applied).toBe(false); const cycle = applyPatch(doc, patchFor(doc, [operations.reparent('root', 'flower', undefined, null)], 'cycle')); expect(cycle.applied).toBe(false)
  })
  it('deduplicates exact transactions and rejects conflicting reuse', () => { const doc = makeFixture(); const patch = patchFor(doc, [operations.rename('hive', 'Nest', 'Hive Box')], 'rename'); const once = applyPatch(doc, patch); const twice = applyPatch(once.document, patch); expect(twice.applied).toBe(true); expect(twice.diagnostic).toContain('already'); const conflict = applyPatch(once.document, { ...patch, operations: [operations.rename('hive', 'Other', 'Nest')] }); expect(conflict.applied).toBe(false); expect(conflict.diagnostic).toContain('different') })
  it('round trips package bytes and complete YAML payload', () => { const doc = makeFixture(); doc.assets.logo = { id: 'logo', name: 'logo.png', mimeType: 'image/png', path: 'textures/logo.png', bytes: 'data:image/png;base64,AA==' }; const restored = importPackage(exportPackage(doc)); expect(restored.assets.logo.bytes).toContain('base64'); const yaml = JSON.parse(exportYaml(doc)); expect(yaml.schema).toBe('beegame-content-v1'); expect(yaml.data.nodes.hive.volume.role).toBe('collider') })
})
