import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

// Optional isolated PostgreSQL engine. Keep it outside production dependencies.
const modulePath = process.env.BGS_PGLITE_MODULE
const sqlTest = modulePath ? test : test.skip

sqlTest('usage summary RPC aggregates large filtered ledgers and grants only service access', async () => {
  const { PGlite } = await import(modulePath!)
  const db = new PGlite()
  const schema = await readFile(new URL('../../../../docs/beegame-supabase-schema.sql', import.meta.url), 'utf8')
  const migration = await readFile(new URL('../../../../supabase/migrations/20261023030000_usage_read_aggregation.sql', import.meta.url), 'utf8')
  const user = '10000000-0000-0000-0000-000000000001'
  const otherUser = '10000000-0000-0000-0000-000000000002'

  const summary = async (projectId?: string, from?: string, to?: string) => {
    const result = await db.query(
      `select public.beegame_usage_summary($1::uuid, $2::text, $3::timestamptz, $4::timestamptz) as result`,
      [user, projectId ?? null, from ?? null, to ?? null],
    )
    return (result.rows as Array<{ result: Record<string, number> }>)[0].result
  }

  try {
    await db.exec(`
      create schema auth;
      create role anon;
      create role authenticated;
      create role service_role;
      create table auth.users(id uuid primary key);
      insert into auth.users values ('${user}'), ('${otherUser}');
    `)
    const start = schema.indexOf('create table if not exists public.beegame_usage_events (')
    const end = schema.indexOf('\n);', start) + 3
    if (start < 0 || end < start) throw Error('Missing usage events table fixture')
    await db.exec(schema.slice(start, end))
    await db.exec(migration)

    await db.exec(`
      insert into public.beegame_usage_events (
        user_id, session_id, project_id, idempotency_key, usage_source,
        prompt_tokens, completion_tokens, cache_read_tokens, cache_creation_tokens,
        total_tokens, prompt_tokens_delta, completion_tokens_delta,
        cache_read_tokens_delta, cache_creation_tokens_delta, total_tokens_delta,
        weighted_tokens, weighted_tokens_delta, credits_micro, created_at
      )
      select
        '${user}'::uuid, 'session-a', 'project-a', 'usage-a-' || g, 'runtime_snapshot',
        1, 2, 3, 4, 10, 1, 2, 3, 4, 10, 20, 20, 30,
        '2026-01-01T00:00:00Z'::timestamptz + ((g - 1) % 10) * interval '1 day'
      from generate_series(1, 1001) as rows(g);

      insert into public.beegame_usage_events (
        user_id, session_id, project_id, idempotency_key, usage_source,
        prompt_tokens_delta, completion_tokens_delta, cache_read_tokens_delta,
        cache_creation_tokens_delta, total_tokens_delta, weighted_tokens_delta,
        credits_micro, created_at
      ) values
        ('${user}'::uuid, 'session-b', 'project-b', 'usage-b-1', 'runtime_snapshot', 7, 8, 9, 10, 34, 44, 55, '2026-02-01T00:00:00Z'),
        ('${user}'::uuid, 'session-b', 'project-b', 'usage-b-2', 'runtime_snapshot', 1, 2, 3, 4, 10, 20, 30, '2026-02-02T00:00:00Z'),
        ('${otherUser}'::uuid, 'session-c', 'project-a', 'usage-c-1', 'runtime_snapshot', 100, 100, 100, 100, 400, 500, 600, '2026-01-03T00:00:00Z');
    `)

    expect(await summary('project-a')).toEqual({
      events_count: 1001,
      prompt_tokens: 1001,
      completion_tokens: 2002,
      cache_read_tokens: 3003,
      cache_creation_tokens: 4004,
      total_tokens: 10010,
      weighted_tokens: 20020,
      credits_micro: 30030,
    })
    expect(await summary('project-a', '2026-01-03T00:00:00Z', '2026-01-05T23:59:59Z')).toEqual({
      events_count: 300,
      prompt_tokens: 300,
      completion_tokens: 600,
      cache_read_tokens: 900,
      cache_creation_tokens: 1200,
      total_tokens: 3000,
      weighted_tokens: 6000,
      credits_micro: 9000,
    })
    expect(await summary('project-b')).toMatchObject({ events_count: 2, total_tokens: 44, credits_micro: 85 })
    expect(await summary('no-such-project')).toEqual({
      events_count: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      total_tokens: 0,
      weighted_tokens: 0,
      credits_micro: 0,
    })

    const privileges = await db.query(`
      select
        has_function_privilege('service_role', 'public.beegame_usage_summary(uuid,text,timestamptz,timestamptz)', 'EXECUTE') as service_can_execute,
        has_function_privilege('anon', 'public.beegame_usage_summary(uuid,text,timestamptz,timestamptz)', 'EXECUTE') as anon_can_execute
    `)
    expect((privileges.rows as Array<{ service_can_execute: boolean; anon_can_execute: boolean }>)[0]).toEqual({ service_can_execute: true, anon_can_execute: false })
  } finally {
    await db.close()
  }
}, 30_000)
