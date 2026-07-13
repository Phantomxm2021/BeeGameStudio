import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DeliveryValidationAdapterRegistry,
  readDeliveryValidationRequest,
  readExplicitValidationAdapter,
  resolveRequiredValidationAdapter,
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

  test('builds adapter input only from the structured delivery contract', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-runtime-adapter-'))
    try {
      await mkdir(join(workspace, 'docs'), { recursive: true })
      await writeFile(join(workspace, 'docs', 'delivery-contract.json'), JSON.stringify({
        version: 1,
        playerPaths: [{ id: 'playable-loop', phases: {
          entry: [{ action: { command: 'enter' }, assertions: [{ observable: 'ready' }] }],
          completion: [{ action: { command: 'finish' }, assertions: [{ observable: 'complete' }] }],
        } }],
      }))

      expect(resolveRequiredValidationAdapter(['skill:review', 'adapter:runtime-one'])).toBe('runtime-one')
      expect(await readDeliveryValidationRequest(workspace, 'runtime-one')).toMatchObject({
        adapterId: 'runtime-one',
        contractVersion: 1,
        playerPaths: [{
          id: 'playable-loop',
          actions: [{ command: 'enter' }, { command: 'finish' }],
          assertions: [{ observable: 'ready' }, { observable: 'complete' }],
        }],
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
