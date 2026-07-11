import { expect, test } from 'bun:test'
import { resolveResourceSelectionRuntimeConfig } from '../beegame/resource-selection-config'

test('allows an unconfigured resource selector only outside production', () => {
  expect(resolveResourceSelectionRuntimeConfig({ NODE_ENV: 'test' })).toBeUndefined()
  expect(() => resolveResourceSelectionRuntimeConfig({ NODE_ENV: 'production' })).toThrow('Resource selection configuration is required')
})

test('requires both resource selector credentials and a valid service URL', () => {
  expect(() => resolveResourceSelectionRuntimeConfig({ BEEGAME_RESOURCE_SERVER_URL: 'http://resource.test' })).toThrow('configured together')
  expect(() => resolveResourceSelectionRuntimeConfig({ BEEGAME_RESOURCE_SERVER_URL: 'resource.test', BEEGAME_RESOURCE_SERVICE_TOKEN: 'secret' })).toThrow('HTTP(S) URL')
  expect(resolveResourceSelectionRuntimeConfig({ BEEGAME_RESOURCE_SERVER_URL: 'https://resource.test/', BEEGAME_RESOURCE_SERVICE_TOKEN: 'secret' })).toEqual({ baseUrl: 'https://resource.test/', serviceToken: 'secret' })
})
