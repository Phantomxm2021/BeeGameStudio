#!/usr/bin/env bun
import {
  migrateBeeGameLocalDashboardData,
} from '../packages/agent-workflow-server/src/local-data-migration'
import {
  createSupabaseDashboardStoreFromEnv,
} from '../packages/agent-workflow-server/src/supabase-dashboard-store'
import {
  loadEnvFile,
  parseMigrationArgs,
  resolveMigrationAuthContext,
} from './beegame-migration-cli'

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp()
    return
  }
  loadEnvFile('.env.local')
  const baseStore = createSupabaseDashboardStoreFromEnv()
  if (!baseStore) {
    throw new Error(
      'Supabase is not configured. Set BEEGAME_SUPABASE_URL and BEEGAME_SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY.',
    )
  }
  const auth = await resolveMigrationAuthContext({
    url: (
      process.env.BEEGAME_SUPABASE_URL ??
      process.env.SUPABASE_URL ??
      process.env.VITE_SUPABASE_URL ??
      ''
    ),
    anonKey: (
      process.env.BEEGAME_SUPABASE_ANON_KEY ??
      process.env.SUPABASE_ANON_KEY ??
      process.env.VITE_SUPABASE_ANON_KEY ??
      ''
    ),
  })
  if (auth.userId && !process.env.BEEGAME_MIGRATION_OWNER_ID?.trim()) {
    process.env.BEEGAME_MIGRATION_AUTH_USER_ID = auth.userId
  }
  const options = parseMigrationArgs(process.argv.slice(2))
  if (!options.ownerId) {
    throw new Error(
      'Missing migration owner. Pass --owner-id <supabase-user-id>, or set BEEGAME_MIGRATION_EMAIL + BEEGAME_MIGRATION_PASSWORD.',
    )
  }
  const store = baseStore.withAuthToken(auth.authToken)
  const summary = await migrateBeeGameLocalDashboardData({
    ownerId: options.ownerId,
    dataDir: options.dataDir,
    store,
    dryRun: !options.apply,
  })
  console.log(JSON.stringify(summary, null, 2))
  if (!options.apply) {
    console.log('Dry run only. Re-run with --apply to write to Supabase.')
  }
}

function printHelp(): void {
  console.log(`Usage:
  bun scripts/migrate-beegame-local-to-supabase.ts [--owner-id <supabase-user-id>] [--data-dir <dir>] [--apply]

Defaults:
  --data-dir uses BEEGAME_MIGRATION_DATA_DIR, AGENT_WORKFLOW_DATA_DIR, or ~/.beegame/dashboard.
  Supabase access uses .env.local plus BEEGAME_SUPABASE_URL, BEEGAME_SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY.
  Auth uses BEEGAME_SUPABASE_ACCESS_TOKEN, or BEEGAME_MIGRATION_EMAIL + BEEGAME_MIGRATION_PASSWORD.
  When email/password auth is used, --owner-id defaults to the signed-in user id.
  Without --apply, the command only prints a dry-run summary.
`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
