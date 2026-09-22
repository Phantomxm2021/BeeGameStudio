import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectGameContent, runGameContentCommand } from './game-content-validation-cli'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'content-inspection-'))
  roots.push(root)
  mkdirSync(join(root, 'content/scenes'), { recursive: true })
  const index = { schema: 'beegame-content-package.v2' as const, id: 'test', dimension: '2d' as const,
    documentRevision: 'a'.repeat(64), assetManifestRevision: 'b'.repeat(64),
    sceneModel: 'game-object-v2' as const, entryScene: 'level', files: ['scenes/level.json'] }
  const nodes = Array.from({ length: 600 }, (_, i) => ({
    id: `node-${i}`, semantic: ['platform'],
    transform: { position: [i * 20, -40, 0] },
    data: { customAuthoredField: 'x'.repeat(600) },
  }))
  const doc = { schema: 'beegame-content.v1', id: 'level', kind: 'scene-2d', assetRefs: [],
    data: { nodes, settings: { coordinateSystem: { origin: 'top-left' } } } }
  writeFileSync(join(root, 'content/index.json'), JSON.stringify(index))
  writeFileSync(join(root, 'content/scenes/level.json'), JSON.stringify(doc))
  return { root, doc, index }
}

test('large scenes have a compact node index and exact node access without rewriting content', () => {
  const { root, doc, index } = fixture()
  const path = join(root, 'content/scenes/level.json')
  const before = readFileSync(path)
  expect(before.length).toBeGreaterThan(256 * 1024)
  expect(inspectGameContent(root).index).toEqual(index)
  const summary = inspectGameContent(root, 'scenes/level.json')
  expect(summary.nodeCount).toBe(600)
  expect(summary.nodeIds).toEqual(doc.data.nodes.map(n => n.id))
  expect(JSON.stringify(summary).length).toBeLessThan(before.length / 20)
  const result = runGameContentCommand(root, ['--inspect', 'scenes/level.json', '--node', 'node-300'])
  expect('node' in result && result.node).toEqual(doc.data.nodes[300])
  expect(readFileSync(path)).toEqual(before)
})

test('inspection fails explicitly for unknown files/nodes, ambiguous nodes and invalid arguments', () => {
  const { root, doc } = fixture()
  expect(() => inspectGameContent(root, '../outside.json')).toThrow('registered')
  expect(() => inspectGameContent(root, 'scenes/level.json', 'absent')).toThrow('found 0')
  doc.data.nodes.push(doc.data.nodes[0]!)
  writeFileSync(join(root, 'content/scenes/level.json'), JSON.stringify(doc))
  expect(() => inspectGameContent(root, 'scenes/level.json', 'node-0')).toThrow('found 2')
  expect(() => runGameContentCommand(root, ['--inspect', 'scenes/level.json', '--node'])).toThrow('Usage')
  expect(() => runGameContentCommand(root, ['--unknown'])).toThrow('Usage')
})

test('inspection does not follow indexed symlinks outside the content directory', () => {
  const { root } = fixture()
  const path = join(root, 'content/scenes/level.json')
  rmSync(path)
  writeFileSync(join(root, 'outside.json'), '{}')
  symlinkSync(join(root, 'outside.json'), path)
  expect(() => inspectGameContent(root, 'scenes/level.json')).toThrow('outside')
})

test('validation feedback never claims runtime or playability verification', () => {
  const { root } = fixture()
  mkdirSync(join(root, '.beegame/workflow'), { recursive: true })
  writeFileSync(join(root, '.beegame/workflow/run.json'), JSON.stringify({ revision: {} }))
  const result = runGameContentCommand(root)
  expect(result).toMatchObject({
    valid: false, scope: 'content-contract-and-references', runtimeVerified: false,
  })
})

test('migrated native projects validate authored content instead of stale workflow revisions', () => {
  const { root } = fixture()
  mkdirSync(join(root, '.beegame/workflow'), { recursive: true })
  mkdirSync(join(root, '.beegame/delivery'), { recursive: true })
  writeFileSync(join(root, '.beegame/workflow/run.json'), JSON.stringify({ revision: {} }))
  writeFileSync(join(root, '.beegame/delivery/content-contract.json'), '{}')
  const result = runGameContentCommand(root)
  expect(result).toMatchObject({ scope: 'content-contract-and-references', runtimeVerified: false })
  expect('issues' in result && result.issues).not.toContain('An accepted Asset Manifest revision is required.')
})
