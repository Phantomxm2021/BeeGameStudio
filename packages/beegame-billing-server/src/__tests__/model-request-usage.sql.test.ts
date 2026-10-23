import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

// Optional isolated PostgreSQL engine. Keep it outside production dependencies.
const modulePath = process.env.BGS_PGLITE_MODULE
const sqlTest = modulePath ? test : test.skip
sqlTest('migration bills auxiliary requests independently, keeps native snapshots cumulative and preserves debit idempotency', async () => {
  const { PGlite } = await import(modulePath!)
  const db = new PGlite()
  const schema = await readFile(new URL('../../../../docs/beegame-supabase-schema.sql', import.meta.url), 'utf8')
  const migration = await readFile(new URL('../../../../supabase/migrations/20261020020000_model_request_usage.sql', import.meta.url), 'utf8')
  const walletMigration = await readFile(new URL('../../../../supabase/migrations/20261020030000_usage_wallet_initialization.sql', import.meta.url), 'utf8')
  const previous = await readFile(new URL('../../../../supabase/migrations/20261006010000_runtime_usage_cumulative_baseline.sql', import.meta.url), 'utf8')
  const user = '10000000-0000-0000-0000-000000000001'
  const tokens = (n: number) => ({ prompt_tokens: n, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: n })
  const call = async (method: 'record' | 'debit', session: string, key: string, usage: ReturnType<typeof tokens>, source = 'model_runtime_host', metadata: object = {}) => {
    const result = await db.query(`select public.beegame_${method === 'record' ? 'record_usage' : 'debit_realtime_usage'}(
      $1::uuid, $2, p_idempotency_key => $3, p_usage => $4::jsonb, p_metadata => $5::jsonb, p_usage_source => $6) as result`,
      [user, session, key, JSON.stringify(usage), JSON.stringify(metadata), source])
    return result.rows[0].result
  }
  const consumed = async () => Number((await db.query('select consumed_credits_micro from public.beegame_usage_wallets')).rows[0].consumed_credits_micro)
  try {
    // Auth and identity are local fixtures; the production function bodies and
    // table definitions below are loaded directly from the repository.
    await db.exec(`create schema auth; create table auth.users(id uuid primary key);
      create function auth.role() returns text language sql as $$select 'service_role'::text$$;
      create function auth.uid() returns uuid language sql as $$select '${user}'::uuid$$;
      create function public.beegame_account_id(uuid) returns uuid language sql as $$select $1$$;
      insert into auth.users values ('${user}');`)
    for (const name of ['beegame_usage_events', 'beegame_usage_wallets', 'beegame_usage_debit_events']) {
      const start = schema.indexOf('create table if not exists public.' + name + ' (')
      const end = schema.indexOf('\n);', start) + 3
      if (start < 0 || end < start) throw Error('Missing billing table fixture: ' + name)
      await db.exec(schema.slice(start, end))
    }
    await db.exec(previous)
    await call('record', 'legacy', 'legacy-1', tokens(100))
    await call('record', 'legacy', 'legacy-2', tokens(150))
    const historical = (await db.query("select jsonb_agg(to_jsonb(e) order by id) as rows from public.beegame_usage_events e where session_id='legacy'")).rows[0].rows
    await db.exec(migration)
    await db.exec(walletMigration)
    expect((await db.query("select jsonb_agg(to_jsonb(e) order by id) as rows from public.beegame_usage_events e where session_id='legacy'")).rows[0].rows).toEqual(historical)
    expect((await db.query('select count(*) as count from public.beegame_usage_wallets')).rows[0].count).toBe(0)

    for (const [index, n] of [100, 150, 150].entries()) {
      const result = await call('record', 'auxiliary', 'call-' + index, tokens(n))
      expect(result.event.total_tokens_delta).toBe(n)
      await call('debit', 'auxiliary', 'call-' + index, tokens(n))
    }
    expect(await consumed()).toBe(40_000)
    expect((await db.query('select count(*) as count from public.beegame_usage_wallets')).rows[0].count).toBe(1)
    expect((await call('debit', 'auxiliary', 'call-2', tokens(150))).duplicate).toBe(true)
    expect(await consumed()).toBe(40_000)

    const cached = { prompt_tokens: 100, completion_tokens: 4, cache_read_tokens: 20, cache_creation_tokens: 8, total_tokens: 132 }
    for (const id of ['direct-1', 'direct-2']) {
      const result = await call('debit', 'direct', id, cached)
      expect(result.event.weighted_tokens_delta).toBe(132)
    }
    expect(await consumed()).toBe(66_400)
    for (const [index, n] of [100, 150].entries()) {
      const metadata = { usageBasis: 'session-cumulative-v1', providerCumulativeUsage: tokens(n) }
      const result = await call('record', 'native', 'native-' + index, tokens(n), 'runtime_snapshot', metadata)
      expect(result.event.total_tokens_delta).toBe(index === 0 ? 100 : 50)
      await call('debit', 'native', 'native-' + index, tokens(n), 'runtime_snapshot', metadata)
    }
    expect(await consumed()).toBe(81_400)
    await call('record', 'unknown-baseline', 'old-native', tokens(100), 'runtime_snapshot')
    await expect(call('record', 'unknown-baseline', 'new-native', tokens(150), 'runtime_snapshot',
      { usageBasis: 'session-cumulative-v1' })).rejects.toThrow('baseline is unknown')

    // Direct native debits use ledger pricing too, including cached input.
    await call('debit', 'cached-native', 'cached-native-1', cached, 'runtime_snapshot')
    expect(await consumed()).toBe(94_600)
    await call('debit', 'cached-native', 'cached-native-2', cached, 'runtime_snapshot')
    expect(await consumed()).toBe(94_600)

    // Insufficient credit rolls back both direct registration and debit.
    await db.exec(`alter table public.beegame_usage_wallets add column reserved_credits_micro bigint not null default 0`)
    await db.exec(`update public.beegame_usage_wallets set included_credits_micro=consumed_credits_micro+600, reserved_credits_micro=400`)
    await call('debit', 'with-hold', 'held-1', tokens(2))
    expect(await consumed()).toBe(94_800)
    await expect(call('debit', 'with-hold', 'held-2', tokens(1))).rejects.toThrow('Insufficient realtime usage credits')
    expect((await db.query("select count(*) as count from public.beegame_usage_events where idempotency_key='held-2'")).rows[0].count).toBe(0)
    expect((await db.query("select count(*) as count from public.beegame_usage_debit_events where idempotency_key='held-2'")).rows[0].count).toBe(0)

    // A failed first debit cannot leave a phantom wallet or successful receipt.
    const newcomer = '10000000-0000-0000-0000-000000000002'
    await db.query('insert into auth.users values ($1)', [newcomer])
    await expect(db.query(`select public.beegame_debit_realtime_usage($1::uuid,'new-user',p_idempotency_key=>'over-limit',p_usage=>$2::jsonb,p_usage_source=>'model_runtime_host')`,
      [newcomer, JSON.stringify(tokens(3_000_001))])).rejects.toThrow('Insufficient realtime usage credits')
    expect((await db.query('select count(*) as count from public.beegame_usage_wallets where user_id=$1', [newcomer])).rows[0].count).toBe(0)
    expect((await db.query('select count(*) as count from public.beegame_usage_events where user_id=$1', [newcomer])).rows[0].count).toBe(0)
  } finally { await db.close() }
}, 30_000)
