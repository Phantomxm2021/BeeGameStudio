import { describe, expect, test } from 'bun:test'
import {
  DeliveryValidationAdapterRegistry,
  readExplicitValidationAdapter,
  type DeliveryValidationAdapter,
} from './delivery-validation-adapter'

describe('delivery validation adapter registry', () => {
  test('selects adapters only from the explicit project contract', () => {
    expect(readExplicitValidationAdapter({ validation_adapter: 'runtime-adapter-a' })).toBe('runtime-adapter-a')
    expect(readExplicitValidationAdapter({ platform: 'arbitrary-platform' })).toBeUndefined()
  })

  test('does not infer adapters from project names or content', () => {
    const registry = new DeliveryValidationAdapterRegistry()
    const adapter: DeliveryValidationAdapter = {
      id: 'adapter-one',
      async validate() {
        return { adapterId: 'adapter-one', environment: {}, evidence: [], metrics: {}, passed: true, failures: [] }
      },
    }
    registry.register(adapter)

    expect(registry.require('adapter-one')).toBe(adapter)
    expect(() => registry.require('project-that-looks-like-an-engine')).toThrow('not configured')
  })
})
