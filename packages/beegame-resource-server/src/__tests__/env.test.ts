import { describe, expect, test } from 'bun:test'
import { resolveBeeGameResourceSemanticRuntimeOptions, resourceProcessingEnabled } from '../env'

describe('resource semantic runtime configuration', () => {
  test('requires the internal Workflow runtime URL and existing service token together', () => {
    expect(resolveBeeGameResourceSemanticRuntimeOptions({})).toEqual(expect.objectContaining({ configured: false }))
    expect(resolveBeeGameResourceSemanticRuntimeOptions({ BEEGAME_RUNTIME_SERVER_URL: 'http://runtime.test' })).toEqual(expect.objectContaining({ configured: false }))
    expect(resolveBeeGameResourceSemanticRuntimeOptions({ BEEGAME_RESOURCE_SERVICE_TOKEN: 'token' })).toEqual(expect.objectContaining({ configured: false }))
  })

  test('keeps only service topology and curator revision', () => {
    expect(resolveBeeGameResourceSemanticRuntimeOptions({
      BEEGAME_RUNTIME_SERVER_URL: 'http://runtime.test/',
      BEEGAME_RESOURCE_SERVICE_TOKEN: 'token',
      BEEGAME_RESOURCE_SEMANTIC_CURATOR_REVISION: 'semantic-curator-v2',
    })).toEqual({ configured: true, runtimeServerUrl: 'http://runtime.test/', serviceToken: 'token', curatorRevision: 'semantic-curator-v2' })
  })
})

test('catalog can start with processing explicitly paused without changing the default', () => {
  expect(resourceProcessingEnabled({})).toBe(true)
  expect(resourceProcessingEnabled({ BEEGAME_RESOURCE_PROCESSING_ENABLED: '0' })).toBe(false)
  expect(resourceProcessingEnabled({ BEEGAME_RESOURCE_PROCESSING_ENABLED: '1' })).toBe(true)
  expect(() => resourceProcessingEnabled({ BEEGAME_RESOURCE_PROCESSING_ENABLED: 'false' })).toThrow()
})
