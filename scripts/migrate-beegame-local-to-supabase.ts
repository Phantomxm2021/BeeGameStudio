#!/usr/bin/env bun
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  migrateBeeGameLocalDashboardData,
} from '../packages/agent-workflow-server/src/local-data-migration'
import {
  createSupabaseDashboardStoreFromEnv,
} from '../packages/agent-workflow-server/src/supabase-dashboard-store'

type CliOptions = {
  ownerId: string
  dataDir: string
  apply: boolean
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  if (!options.ownerId) {
    throw new Error('Missing --owner-id <supabase-user-id>')
  }
  const store = createSupabaseDashboardStoreFromEnv()
  if (!store) {
    throw new Error(
      'Supabase is not configured. Set BEEGAME_SUPABASE_URL and BEEGAME_SUPABASE_SERVICE_ROLE_KEY.',
    )
  }
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

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    ownerId: process.env.BEEGAME_MIGRATION_OWNER_ID?.trim() ?? '',
    dataDir: resolve(
      process.env.BEEGAME_MIGRATION_DATA_DIR?.trim() ||
        process.env.AGENT_WORKFLOW_DATA_DIR?.trim() ||
        join(homedir(), '.beegame', 'dashboard'),
    ),
    apply: false,
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }
    if (arg === '--apply') {
      options.apply = true
      continue
    }
    if (arg === '--owner-id') {
      options.ownerId = args[index + 1]?.trim() ?? ''
      index += 1
      continue
    }
    if (arg === '--data-dir') {
      options.dataDir = resolve(args[index + 1]?.trim() ?? '')
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

function printHelp(): void {
  console.log(`Usage:
  bun scripts/migrate-beegame-local-to-supabase.ts --owner-id <supabase-user-id> [--data-dir <dir>] [--apply]

Defaults:
  --data-dir uses BEEGAME_MIGRATION_DATA_DIR, AGENT_WORKFLOW_DATA_DIR, or ~/.beegame/dashboard.
  Without --apply, the command only prints a dry-run summary.
`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
