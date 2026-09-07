import { describe, expect, test } from 'bun:test'
import { createAuthenticationClient } from './public'
import type { BeeGameSessionCredential } from './session-routes'

function credentialFixture() {
  const calls: Array<{ forceRefresh?: boolean } | undefined> = []
  const credential: BeeGameSessionCredential = {
    async getValidAccessToken(options) {
      calls.push(options)
      return options?.forceRefresh ? 'refreshed-token' : 'current-token'
    },
  }
  return { credential, calls }
}

describe('public authentication client', () => {
  test('two clients delegate to the same credential authority', async () => {
    const fixture = credentialFixture()
    const first = createAuthenticationClient({ ownerId: 'owner@example.com', credential: fixture.credential })
    const second = createAuthenticationClient({ ownerId: 'owner@example.com', credential: fixture.credential })
    expect(await first.getAccessToken({ ownerId: 'owner@example.com' })).toBe('current-token')
    expect(await second.getAccessToken({ ownerId: 'owner@example.com', forceRefresh: true })).toBe('refreshed-token')
    expect(fixture.calls).toEqual([undefined, { forceRefresh: true }])
  })

  test('rejects foreign owners before calling the credential', async () => {
    const fixture = credentialFixture()
    const client = createAuthenticationClient({ ownerId: 'owner', credential: fixture.credential })
    await expect(client.getAccessToken({ ownerId: 'other-owner' })).rejects.toThrow(/owner mismatch/)
    expect(fixture.calls).toHaveLength(0)
  })

  test('rejects extra factory/request payload and exposes no credential state', async () => {
    const fixture = credentialFixture()
    expect(() => createAuthenticationClient({ ownerId: 'owner', credential: fixture.credential, refreshToken: 'secret' } as never)).toThrow()
    await expect(createAuthenticationClient({ ownerId: 'owner', credential: fixture.credential }).getAccessToken({ ownerId: 'owner', extra: true } as never)).rejects.toThrow()
    const client = createAuthenticationClient({ ownerId: 'owner', credential: fixture.credential })
    expect(Object.keys(client).sort()).toEqual(['getAccessToken', 'ownerId', 'protocolVersion'])
    expect((client as Record<string, unknown>).refreshToken).toBeUndefined()
    expect(Object.isFrozen(client)).toBe(true)
  })

  test('sanitizes credential errors and validates token output type', async () => {
    const throwing: BeeGameSessionCredential = { async getValidAccessToken() { throw new Error('refresh secret-token') } }
    await expect(createAuthenticationClient({ ownerId: 'owner', credential: throwing }).getAccessToken({ ownerId: 'owner' })).rejects.toThrow('token unavailable')
    const invalid = { async getValidAccessToken() { return 42 } } as unknown as BeeGameSessionCredential
    await expect(createAuthenticationClient({ ownerId: 'owner', credential: invalid }).getAccessToken({ ownerId: 'owner' })).rejects.toThrow('invalid token')
  })
})
