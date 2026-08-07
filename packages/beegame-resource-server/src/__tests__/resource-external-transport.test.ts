import { describe, expect, test } from 'bun:test'
import {
  ResourceExternalTransportError,
  withResourceExternalTransport,
} from '@bee-game-studio/beegame-resource-core'

describe('resource external transport boundary', () => {
  test('retries certificate verification failures and reports a recoverable transport error', async () => {
    let calls = 0
    await expect(withResourceExternalTransport({
      service: 'supabase',
      operation: 'load processing jobs',
      attempts: 3,
      sleep: async () => undefined,
      execute: async () => {
        calls += 1
        const error = Object.assign(new Error('certificate verification failed'), {
          code: 'UNKNOWN_CERTIFICATE_VERIFICATION_ERROR',
        })
        throw error
      },
    })).rejects.toBeInstanceOf(ResourceExternalTransportError)
    expect(calls).toBe(3)
  })

  test('does not convert a database or content error into a transport retry', async () => {
    let calls = 0
    const error = new Error('PGRST204 schema mismatch')
    await expect(withResourceExternalTransport({
      service: 'supabase',
      operation: 'write resource labels',
      sleep: async () => undefined,
      execute: async () => {
        calls += 1
        throw error
      },
    })).rejects.toBe(error)
    expect(calls).toBe(1)
  })
})
