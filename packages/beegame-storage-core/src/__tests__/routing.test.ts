import { describe, expect, test } from 'bun:test'
import {
  assertSafeObjectKey,
  buildResourcePackObjectKey,
  resolveProjectStorageBucketRole,
} from '../routing'

describe('project storage routing', () => {
  test('routes explicit business ownership instead of file extensions', () => {
    expect(
      resolveProjectStorageBucketRole({
        scopeType: 'project',
        objectKind: 'game_asset',
      }),
    ).toBe('project-private')
    expect(
      resolveProjectStorageBucketRole({
        scopeType: 'pack',
        objectKind: 'resource_element',
      }),
    ).toBe('resource-private')
    expect(
      resolveProjectStorageBucketRole({
        scopeType: 'deployment',
        objectKind: 'deployment_file',
      }),
    ).toBe('delivery')
    expect(
      resolveProjectStorageBucketRole({
        scopeType: 'session',
        objectKind: 'agent_log',
      }),
    ).toBe('log-private')
  })

  test('does not absorb existing account media into the project router', () => {
    expect(() =>
      resolveProjectStorageBucketRole({
        scopeType: 'user',
        objectKind: 'game_asset',
      }),
    ).toThrow('outside the project storage router')
  })

  test('rejects unsupported routes rather than guessing from names', () => {
    expect(() =>
      resolveProjectStorageBucketRole({
        scopeType: 'project',
        objectKind: 'avatar',
      }),
    ).toThrow('Unsupported project storage route')
  })
})

describe('object key safety', () => {
  test('normalizes separators and preserves opaque relative keys', () => {
    expect(assertSafeObjectKey('objects\\01\\payload.glb')).toBe(
      'objects/01/payload.glb',
    )
  })

  test('rejects absolute and traversing keys', () => {
    expect(() => assertSafeObjectKey('/objects/file')).toThrow()
    expect(() => assertSafeObjectKey('objects/../file')).toThrow()
  })

  test('groups immutable Resource Library objects under their Pack', () => {
    expect(buildResourcePackObjectKey('pack-1', 'object-1')).toBe(
      'packs/pack-1/objects/object-1/payload',
    )
    expect(() => buildResourcePackObjectKey('../pack', 'object-1')).toThrow()
    expect(() => buildResourcePackObjectKey('pack-1', 'nested/object')).toThrow()
  })
})
