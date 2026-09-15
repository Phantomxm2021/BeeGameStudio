import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { importPublishedScene } from './reader'
import { applyPatch, operations, patchFor } from './commands'
import { makeFixture } from './model'
const canon = (v: any): any => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(canon(v))).digest('hex')
function reader() {
  const transform = (x: number, space = 'local') => ({ dimensions: '3d', space, position: { x, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } })
  const nodes = [
    { id: 'world.main', kind: 'world-scene.scene', value: { label: 'Main', coordinateConvention: { dimensions: '3d', handedness: 'right', upAxis: '+y', forwardAxis: '-z', distanceUnit: 'centimeter' } }, edges: [{ type: 'root', targetId: 'world.root' }] },
    { id: 'world.root', kind: 'world-scene.node', value: { label: 'Root', nodeType: 'container', transform: transform(100) }, edges: [{ type: 'scene', targetId: 'world.main' }] },
    { id: 'world.child', kind: 'world-scene.node', value: { label: 'Child', nodeType: 'visual', transform: transform(300, 'world') }, edges: [{ type: 'scene', targetId: 'world.main' }, { type: 'parent', targetId: 'world.root' }] },
    { id: 'world.zone', kind: 'world-scene.zone', value: { label: 'Area', shape: { kind: 'sphere', radius: 100 }, transform: transform(0) }, edges: [{ type: 'scene', targetId: 'world.main' }] },
  ]
  return sign(nodes)
}
function sign(nodes: any[]) {
  const candidate = { schemaVersion: 'game-ir.v2', taskId: 'test-fixture', sourceRevision: 'design-1', modules: [{ moduleId: 'world-scene', nodes }] }
  const candidateDigest = hash(candidate)
  return { manifest: { gameIrSchemaVersion: 'game-ir.v2', publicationId: 'publication-world-fixture', sourceRevision: 'design-1', candidateDigest, sourceInputDigest: 'a'.repeat(64) }, candidate, modules: candidate.modules, digests: { candidate: candidateDigest }, sourceMaps: {} }
}
describe('public World/Scene reader shape (synthetic protocol fixture)', () => {
  test('uses actual edges, object vectors, quaternion, centimeters and world-space transform', async () => {
    const result = await importPublishedScene(reader())
    expect(result.nodes['ir-node.world.root'].transform.position[0]).toBe(1)
    expect(result.nodes['ir-node.world.child'].transform.position[0]).toBeCloseTo(2)
    expect(result.nodes['ir-node.world.child'].parentId).toBe('ir-node.world.root')
    expect(result.nodes['ir-node.world.child'].locked).toBe(true)
    expect(result.nodes['ir-node.world.child'].editable).toBe(false)
    const unlock = patchFor(result, [operations.locked('ir-node.world.child', false, true)], 'Unlock source projection')
    expect(applyPatch(result, unlock).applied).toBe(false)
    expect(result.source.source.kind).toBe('published-ir')
    expect(result.source.contentDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(Object.values(result.nodes).some(n => n.volume)).toBe(false)
    expect(result.diagnostics.join(' ')).toContain('semantic zone')
  })
  test('unsupported coordinate convention retains source and produces a diagnostic', async () => {
    const nodes = reader().candidate.modules[0].nodes
    nodes[0].value.coordinateConvention!.upAxis = '+z'
    const result = await importPublishedScene(sign(nodes))
    expect(result.diagnostics.join(' ')).toContain('unsupported coordinate convention')
    expect(result.nodes['ir-node.world.child'].unknown?.irSource).toBeDefined()
  })
  test('tampering, cyclic parents and wrong reader shape reject', async () => {
    const tampered = reader(); tampered.candidate.modules[0].nodes[0].value.label = 'tampered'
    await expect(importPublishedScene(tampered)).rejects.toThrow('digest mismatch')
    const nodes = reader().candidate.modules[0].nodes
    nodes[1].edges.push({ type: 'parent', targetId: 'world.child' })
    await expect(importPublishedScene(sign(nodes))).rejects.toThrow('cycle')
    await expect(importPublishedScene({ modules: {} })).rejects.toThrow('manifest')
  })
  test('validates explicit content before returning an editable document and never mutates the reader', async () => {
    const input = reader(), before = structuredClone(input), content = makeFixture()
    content.nodes.hive.source = { irId: 'world.child' }
    const result = await importPublishedScene(input, content)
    expect(input).toEqual(before)
    expect(result.nodes.hive.transform).toEqual(content.nodes.hive.transform)
    content.nodes.hive.children.push('absent')
    await expect(importPublishedScene(input, content)).rejects.toThrow(/missing child/)
  })
})
