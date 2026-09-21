// Isolated PostgreSQL (PGlite) validation; never reads ENV credentials or connects to a live DB.
// BEEGAME_TEST_PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-image-billing-sql.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const modulePath = process.env.BEEGAME_TEST_PGLITE_MODULE
if (!modulePath) throw new Error('Set BEEGAME_TEST_PGLITE_MODULE to an isolated PGlite installation')
const { PGlite } = await import(modulePath)
const db = new PGlite()
try {
  await db.exec(`
    create schema auth;
    create role anon;
    create role authenticated;
    create role service_role;
    create function auth.role() returns text language sql as $$ select current_setting('request.jwt.claim.role', true) $$;
    create table auth.users(id uuid primary key);
    create table public.beegame_usage_wallets (
      user_id uuid primary key references auth.users(id),
      included_credits_micro bigint not null default 300000000,
      consumed_credits_micro bigint not null default 0,
      updated_at timestamptz not null default now()
    );
    insert into auth.users values ('00000000-0000-0000-0000-000000000001');
    insert into beegame_usage_wallets(user_id,included_credits_micro) values ('00000000-0000-0000-0000-000000000001',100);
  `)
  const migration = readFileSync(new URL('../docs/image-generation-billing-migration-2026-09-20.sql', import.meta.url), 'utf8')
  assert.ok(readFileSync(new URL('../docs/beegame-supabase-schema.sql', import.meta.url), 'utf8').includes(migration.trim()))
  await db.exec(migration)
  await db.exec(migration) // Safe to reapply without altering balances.
  const apply = async (action: string, amount: number, request = 'request', budget = 100, digest = 'digest') => {
    const result = await db.query(`select public.beegame_image_billing($1::uuid,'project',$2,$3,$4,$5::bigint,$6::bigint,'{}'::jsonb) as receipt`,
      ['00000000-0000-0000-0000-000000000001', request, digest, action, amount, budget])
    return result.rows[0].receipt
  }
  const wallet = async () => (await db.query('select consumed_credits_micro::int as consumed, reserved_credits_micro::int as reserved from beegame_usage_wallets')).rows[0]
  await assert.rejects(apply('reserve', 90), /authorization/)
  await db.exec("set request.jwt.claim.role = 'service_role'")
  assert.equal((await apply('reserve', 90)).created, true)
  assert.equal((await apply('reserve', 90)).created, false)
  assert.deepEqual(await wallet(), { consumed: 0, reserved: 90 })
  await assert.rejects(apply('reserve', 90, 'request', 100, 'different'), /conflict/)
  await assert.rejects(apply('reserve', 20, 'another'), /Insufficient/)
  await assert.rejects(db.exec('update beegame_usage_wallets set consumed_credits_micro = 20'), /beegame_wallet_image_reservation/)
  assert.deepEqual(await wallet(), { consumed: 0, reserved: 90 })
  await assert.rejects(apply('settle', 91), /exceeds/)
  assert.equal((await apply('settle', 30)).state, 'settled')
  await apply('settle', 30)
  assert.deepEqual(await wallet(), { consumed: 30, reserved: 0 })
  await assert.rejects(apply('settle', 31), /conflict/)
  await assert.rejects(apply('release', 0), /conflict/)
  await assert.rejects(apply('reserve', 30, 'another', 50), /budget/)
  await apply('reserve', 70, 'another')
  await apply('release', 0, 'another')
  await apply('release', 0, 'another')
  assert.equal((await apply('reserve', 70, 'another')).state, 'released')
  assert.deepEqual(await wallet(), { consumed: 30, reserved: 0 })
  console.log('Image billing SQL passed: authorization, reapplication, idempotency, identity conflict, wallet protection, budgets, settlement and release.')
  await apply('reserve', 50, 'third')
  await db.query("select public.beegame_increment_credit_wallet('00000000-0000-0000-0000-000000000001', 100)")
  assert.deepEqual(await wallet(), { consumed: 30, reserved: 50 })
  await apply('settle', 40, 'third')
  assert.deepEqual(await wallet(), { consumed: 70, reserved: 0 })
  assert.equal((await db.query('select included_credits_micro::int as included from beegame_usage_wallets')).rows[0].included, 200)
  console.log('Atomic grant preserves both consumed credits and image holds.')
} finally { await db.close() }
