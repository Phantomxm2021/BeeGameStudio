import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parseBeeGameContentDocument } from './game-content-schema'

function ui(data: Record<string, unknown>, layout: Record<string, unknown> = { size: [300, 200] }) {
  return { schema: 'beegame-content.v1', id: 'sample', kind: 'ui-screen', assetRefs: [],
    data: { rootId: 'root', nodes: [{ id: 'root', role: 'screen-root', layout, data }] } }
}

test.each(['container', 'item', 'size', 'position', 'scale', 'rotation', 'anchorMin', 'anchorMax', 'sizeDelta', 'minSize', 'maxSize'])
  ('rejects misplaced layout.%s instead of silently accepting it as metadata', key => {
    expect(() => parseBeeGameContentDocument(ui({ [key]: {} }))).toThrow(`layout.${key}`)
  })

test('keeps supported pivot overrides, legal layout and unrelated metadata extensible', () => {
  const source = ui({ anchor: { x: .5, y: 0 }, gameplay: { size: 3 }, label: 'Sample',
    layoutOcclusion: 'protected' }, { size: [300, 200], container: { direction: 'column', gap: 12 }, item: { absolute: true } })
  const parsed = parseBeeGameContentDocument(source)
  if (parsed.kind !== 'ui-screen') throw new Error('Unexpected fixture kind')
  expect(parsed.data.nodes[0]!.data).toEqual(source.data.nodes[0]!.data)
  expect(parsed.data.nodes[0]!.layout!.container!.direction).toBe('column')
  expect(() => parseBeeGameContentDocument(ui({ anchor: 'middle-center' }))).toThrow('data.anchor')
  expect(() => parseBeeGameContentDocument(ui({ anchor: { x: Infinity } }))).toThrow('data.anchor')
  expect(() => parseBeeGameContentDocument(ui({ layoutOcclusion: 'auto' }))).toThrow('layoutOcclusion')
})

test('frozen native misplaced-container failure is rejected without rewriting evidence', () => {
  const path = new URL('../../../../docs/verification/layout-2026-10-01/direction-fresh-test/final/content/ui/pause.json', import.meta.url)
  const before = readFileSync(path, 'utf8')
  expect(() => parseBeeGameContentDocument(JSON.parse(before))).toThrow('layout.container')
  expect(readFileSync(path, 'utf8')).toBe(before)
})
