import { describe, expect, test } from 'bun:test'
import { externalReferencesFromInspection, normalizeResourceReference, reconcileResourceDependencySpecs, resolveResourceDependencyBindings } from '../resource-dependency-bindings'

describe('resource dependency bindings', () => {
  test('normalizes exporter path separators without semantic inference', () => {
    expect(normalizeResourceReference('Textures\\base.png')).toBe('Textures/base.png')
    expect(externalReferencesFromInspection('["Textures\\\\base.png"]')).toEqual(['Textures/base.png'])
  })

  test('resolves an authored Pack-root path when upload layout differs from the model directory', () => {
    expect(resolveResourceDependencyBindings('Models/hero.fbx', ['Textures\\base.png'], [
      { id: 'texture', path: 'Textures/base.png', kind: 'image' },
    ])).toEqual([{ referencePath: 'Textures/base.png', dependencyElementId: 'texture', kind: 'image' }])
  })

  test('prefers structural uniqueness and refuses ambiguous paths', () => {
    expect(resolveResourceDependencyBindings('Models/hero.fbx', ['Textures/base.png'], [
      { id: 'relative', path: 'Models/Textures/base.png', kind: 'image' },
      { id: 'root', path: 'Textures/base.png', kind: 'image' },
    ])).toEqual([])
  })

  test('relocates a flattened exporter dependency only when its filename is unique', () => {
    expect(resolveResourceDependencyBindings('Models/hero.fbx', ['Textures/base.png'], [
      { id: 'texture', path: 'base.png', kind: 'image' },
    ])).toEqual([{ referencePath: 'Textures/base.png', dependencyElementId: 'texture', kind: 'image' }])

    expect(resolveResourceDependencyBindings('Models/hero.fbx', ['Textures/base.png'], [
      { id: 'first', path: 'first/base.png', kind: 'image' },
      { id: 'second', path: 'second/base.png', kind: 'image' },
    ])).toEqual([])
  })

  test('resolves a parent-directory reference relative to the logical root without escaping the Pack', () => {
    expect(resolveResourceDependencyBindings('Models/hero/model.gltf', ['../Textures/base.png'], [
      { id: 'texture', path: 'Models/Textures/base.png', kind: 'image' },
    ])).toEqual([{ referencePath: '../Textures/base.png', dependencyElementId: 'texture', kind: 'image' }])

    expect(resolveResourceDependencyBindings('model.gltf', ['../../outside.png'], [
      { id: 'outside', path: 'outside.png', kind: 'image' },
    ])).toEqual([])
  })

  test('clears only stale unresolved findings covered by explicit bindings', () => {
    expect(reconcileResourceDependencySpecs({
      externalReferences: '["Textures\\\\base.png","Textures\\\\missing.png"]',
      unresolvedTextureReferences: 'Textures\\base.png · Textures\\missing.png',
    }, ['Textures/base.png', 'Textures/missing.png'], [
      { referencePath: 'Textures/base.png', dependencyElementId: 'base' },
    ])).toEqual({
      externalReferences: '["Textures/base.png","Textures/missing.png"]',
      unresolvedTextureReferences: 'Textures/missing.png',
    })
  })
})
