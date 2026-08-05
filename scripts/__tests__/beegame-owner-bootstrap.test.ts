import { describe, expect, test } from 'bun:test'

import {
  parseBootstrapOwnerEmails,
  upsertBootstrapOwnerInvites,
} from '../beegame-owner-bootstrap'

describe('BeeGame owner bootstrap', () => {
  test('parses and normalizes bootstrap owner emails', () => {
    expect(
      parseBootstrapOwnerEmails(
        ' Admin@Example.com, founder@example.com ,,admin@example.com ',
      ),
    ).toEqual(['admin@example.com', 'founder@example.com'])
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

  test('uses platform runtime capability settings independently from model config ownership', async () => {
    const schema = await Bun.file(
      new URL('../../docs/beegame-supabase-schema.sql', import.meta.url),
    ).text()

    expect(schema).toContain(
      'create or replace function public.beegame_is_platform_owner_id(target_user_id uuid)',
    )
    expect(schema).toContain(
      'insert into public.beegame_platform_settings (key, config, updated_at)',
    )
    expect(schema).toContain(
      "select 'runtime_settings', s.settings, s.updated_at",
    )
    expect(schema).toContain('public.beegame_is_platform_owner_id(owner_id)')
    expect(schema).not.toContain('runtime_settings_owner_id uuid;')
  })

  test('keeps OAuth invitation redemption independent from the removed credit-account system', async () => {
    const migration = await Bun.file(
      new URL(
        '../../docs/beegame-supabase-invitations-migration.sql',
        import.meta.url,
      ),
    ).text()

    expect(migration).not.toContain('else\n      return new;')
    expect(migration).toContain(
      "jsonb_build_object('beegame_invitation_redeemed_at', now())",
    )
    expect(migration).not.toContain('beegame_credit_accounts')
    expect(migration).not.toContain('initial_included_credits')
  })
})
