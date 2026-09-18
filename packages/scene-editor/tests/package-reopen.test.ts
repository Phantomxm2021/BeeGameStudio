import { describe, it, expect } from 'vitest'
import { makeFixture } from '../src/model'
import { exportPackage, importPackage } from '../src/persistence'
import { SceneHistory } from '../src/history'
import { operations } from '../src/commands'

describe('materialized package reopen', () => {
  it('keeps the fixture digest stable through an unchanged export and reopen', () => {
    const fixture = makeFixture()
    expect(importPackage(exportPackage(fixture))).toEqual(fixture)
  })
  it('preserves asset metadata and supports edits and undo after reopening', () => {
    const doc = makeFixture()
    doc.assets.buffer = { id: 'buffer', name: 'model.bin', path: 'model.bin', mimeType: 'application/octet-stream', bytes: 'data:application/octet-stream;base64,AA==' }
    doc.assets.model = { id: 'model', name: 'model.gltf', path: 'model.gltf', mimeType: 'model/gltf+json', bytes: 'data:model/gltf+json;base64,e30=', dependencies: ['buffer'], diagnostics: ['Fixture metadata'] }
    const reopened = importPackage(exportPackage(doc))
    expect(reopened.assets).toEqual(doc.assets)
    const history = new SceneHistory(reopened)
    history.commit([operations.rename('hive', 'Reopened Hive')], 'Rename after reopen')
    expect(history.document.nodes.hive.name).toBe('Reopened Hive')
    history.undo()
    expect(history.document.nodes.hive.name).toBe(doc.nodes.hive.name)
  })
  it('rejects invalid graphs and conflicting resource bytes before replacing a document', () => {
    const content = exportPackage(makeFixture()); content.content.nodes.hive.children.push('missing')
    expect(() => importPackage(content)).toThrow(/invalid child/)
    const doc = makeFixture(); doc.assets.a = { id: 'a', name: 'a.bin', path: 'a.bin', mimeType: 'application/octet-stream', bytes: 'data:application/octet-stream;base64,AA==' }
    const invalid = exportPackage(doc); invalid.assets.a.data = 'data:application/octet-stream;base64,AQ=='
    expect(() => importPackage(invalid)).toThrow(/conflicting bytes/)
  })
  it('assigns changed materialized content a new digest while keeping the source identity', () => {
    const original = importPackage(exportPackage(makeFixture())); const changed = exportPackage(original)
    changed.content.nodes.hive.name = 'External edit'
    const reopened = importPackage(changed)
    expect(reopened.source.contentDigest).not.toBe(original.source.contentDigest)
    expect(reopened.source.source).toEqual(original.source.source)
  })
})
