#!/usr/bin/env bun
import { createSupabaseDashboardStoreFromEnv } from '../packages/agent-workflow-server/src/supabase-dashboard-store'
import { loadEnvFile, resolveMigrationAuthContext } from './beegame-migration-cli'

async function main(): Promise<void> {
  loadEnvFile('.env.local')
  const baseStore = createSupabaseDashboardStoreFromEnv()
  if (!baseStore) throw new Error('Supabase is not configured')
  const url = process.env.BEEGAME_SUPABASE_URL ?? process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
  const anonKey = process.env.BEEGAME_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''
  const auth = await resolveMigrationAuthContext({ url, anonKey })
  const ownerId = (process.env.BEEGAME_MIGRATION_OWNER_ID ?? auth.userId ?? '').trim()
  if (!ownerId) throw new Error('Missing migration owner')
  const summary = await baseStore.withAuthToken(auth.authToken).migrateLegacySecrets(ownerId)
  console.log(`Migrated legacy secrets: modelConfigs=${summary.modelConfigs} webTools=${summary.webTools} mcpServers=${summary.mcpServers}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
