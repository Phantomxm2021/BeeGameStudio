import { describe, expect, test } from 'bun:test'

import {
  parseBootstrapOwnerEmails,
  upsertBootstrapOwnerInvites,
} from '../beegame-owner-bootstrap'

describe('BeeGame owner bootstrap', () => {
  test('parses and normalizes bootstrap owner emails', () => {
    expect(parseBootstrapOwnerEmails(' Admin@Example.com, founder@example.com ,,admin@example.com ')).toEqual([
      'admin@example.com',
      'founder@example.com',
    ])
  })

  test('upserts owner invite rows without exposing credentials', async () => {
    const calls: Array<{ url: string; body?: unknown }> = []

    await upsertBootstrapOwnerInvites({
      url: 'https://project.supabase.co',
      serviceRoleKey: 'service-role-secret',
      emails: ['admin@example.com'],
      fetchImpl: (async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        calls.push({
          url: String(input),
          ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
        })
        return new Response('', { status: 204 })
      }) as unknown as typeof fetch,
    })

    expect(calls).toEqual([
      {
        url: 'https://project.supabase.co/rest/v1/beegame_platform_owner_invites',
        body: [{ email: 'admin@example.com' }],
      },
    ])
  })
})
