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

  test('lets an existing signed-in user claim a bootstrap owner invite', async () => {
    const schema = await Bun.file(
      new URL('../../docs/beegame-supabase-schema.sql', import.meta.url),
    ).text()

    expect(schema).toContain(
      'create or replace function public.beegame_claim_platform_owner_invite()',
    )
    expect(schema).toMatch(
      /create or replace function public\.beegame_current_user_context\(\)[\s\S]*perform public\.beegame_claim_platform_owner_invite\(\);/,
    )
    expect(schema).not.toMatch(
      /create or replace function public\.beegame_current_user_context\(\)[\s\S]{0,260}\nstable\n/,
    )
    expect(schema).toContain(
      'grant execute on function public.beegame_claim_platform_owner_invite() to authenticated;',
    )
  })

  test('returns the platform model config owner for users without a workspace', async () => {
    const schema = await Bun.file(
      new URL('../../docs/beegame-supabase-schema.sql', import.meta.url),
    ).text()

    const noWorkspaceContext = schema.match(
      /if workspace_row\.id is null then[\s\S]*?end if;/,
    )?.[0]

    expect(noWorkspaceContext).toContain('modelConfigOwnerId')
    expect(noWorkspaceContext).toContain('model_config_owner_id')
  })

  test('keeps OAuth invitation-free accounts at zero credits until redemption', async () => {
    const migration = await Bun.file(
      new URL('../../docs/beegame-supabase-invitations-migration.sql', import.meta.url),
    ).text()

    expect(migration).not.toContain("else\n      return new;")
    expect(migration).toContain('initial_included_credits := 0;')
    expect(migration).toMatch(
      /insert into public\.beegame_credit_accounts \(user_id, included_credits\)[\s\S]*values \(canonical_account_id, initial_included_credits\)/,
    )
    expect(migration).toMatch(
      /create or replace function public\.beegame_redeem_oauth_invitation\(p_nonce text\)[\s\S]*insert into public\.beegame_credit_accounts \(user_id\)[\s\S]*on conflict \(user_id\) do update[\s\S]*included_credits = greatest\(/,
    )
  })
})
