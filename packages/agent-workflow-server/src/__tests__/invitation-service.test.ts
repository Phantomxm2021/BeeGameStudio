import { describe, expect, test } from 'bun:test'
import { createInvitationService } from '../invitation-service'

describe('invitation service', () => {
  test('uses anon authentication only for public RPCs', async () => {
    const requests: Array<{ url: string; authorization: string | null }> = []
    const service = createInvitationService({
      url: 'https://project.supabase.test/',
      anonKey: 'anon-key',
      fetchImpl: async (input, init) => {
        requests.push({
          url: String(input),
          authorization: new Headers(init?.headers).get('authorization'),
        })
        return Response.json(requests.length === 1 ? { required: true } : true)
      },
    })

    await expect(service.getPublicSettings()).resolves.toEqual({ required: true })
    await expect(service.validateCode('BEE-ALPHA')).resolves.toBe(true)
    expect(requests).toEqual([
      {
        url: 'https://project.supabase.test/rest/v1/rpc/beegame_public_invitation_settings',
        authorization: 'Bearer anon-key',
      },
      {
        url: 'https://project.supabase.test/rest/v1/rpc/beegame_validate_invitation_code',
        authorization: 'Bearer anon-key',
      },
    ])
  })

  test('forwards the server-resolved user token for admin RPCs and normalizes deletion', async () => {
    const requests: Array<{ url: string; authorization: string | null }> = []
    const service = createInvitationService({
      url: 'https://project.supabase.test',
      anonKey: 'anon-key',
      fetchImpl: async (input, init) => {
        requests.push({
          url: String(input),
          authorization: new Headers(init?.headers).get('authorization'),
        })
        return Response.json({ deleted: true })
      },
    })

    await expect(service.delete('fresh-session-token', 'invitation-1')).resolves.toBe(true)
    expect(requests[0]).toEqual({
      url: 'https://project.supabase.test/rest/v1/rpc/beegame_admin_delete_invitation',
      authorization: 'Bearer fresh-session-token',
    })
  })

  test('never treats a non-boolean validation payload as valid', async () => {
    const service = createInvitationService({
      url: 'https://project.supabase.test',
      anonKey: 'anon-key',
      fetchImpl: async () => Response.json({ valid: true }),
    })

    await expect(service.validateCode('BEE-ALPHA')).resolves.toBe(false)
  })
})
