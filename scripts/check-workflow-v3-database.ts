import { loadEnvFile } from './beegame-migration-cli'

// Read-only structural preflight, not an SQL migration or CAS/permission proof.
// The second migration replaces a same-named RPC, so its presence cannot be
// established from the REST discovery document alone.
export async function checkWorkflowV3Database(config: {
  url: string; serviceKey: string; fetchImpl?: typeof fetch
}) {
  const response = await (config.fetchImpl ?? fetch)(config.url.replace(/\/+$/, '')+'/rest/v1/', {
    headers: { apikey: config.serviceKey, authorization: 'Bearer '+config.serviceKey },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error('Database discovery failed (HTTP '+response.status+'); check host configuration/access')
  const schema = await response.json() as { paths?: Record<string, unknown> }
  if (!schema.paths || typeof schema.paths !== 'object' || Array.isArray(schema.paths))
    throw new Error('Database discovery did not return a REST schema; migration status is unverified')
  const required = ['/beegame_workflow_v3', '/beegame_workflow_v3_events',
    '/rpc/beegame_workflow_v3_read', '/rpc/beegame_workflow_v3_commit']
  const missing = required.filter(path => !Object.hasOwn(schema.paths!, path))
  return {
    readyForDatabaseAcceptance: missing.length === 0,
    missing,
    migrations: ['supabase/migrations/20261010010000_workflow_v3_vertical_slice.sql',
      'supabase/migrations/20261010020000_workflow_v3_authorized_changes.sql',
      'supabase/migrations/20261010030000_workflow_v3_conflict_http.sql'],
    authorizedChangesMigration: 'unverified',
    conflictHttpMigration: 'unverified',
    concurrencyAndPermissions: 'unverified',
    writesPerformed: false,
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--env-file'))
    throw new Error('Usage: bun scripts/check-workflow-v3-database.ts [--env-file PATH]')
  loadEnvFile(args[1] ?? '.env.local')
  const url = process.env.BEEGAME_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim()
  const serviceKey = process.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  try {
    if (!url || !serviceKey) throw new Error('Missing host Supabase URL/service-role configuration')
    const result = await checkWorkflowV3Database({ url, serviceKey })
    console.log(JSON.stringify(result, null, 2))
    if (!result.readyForDatabaseAcceptance) process.exitCode = 1
  } catch (error) {
    // Network exceptions can contain URLs; do not print raw causes or secrets.
    console.error(JSON.stringify({ readyForDatabaseAcceptance: false,
      error: error instanceof Error && error.message.startsWith('Database discovery')
        ? error.message : 'Database preflight unavailable; verify host credentials and connectivity', writesPerformed: false }))
    process.exitCode = 1
  }
}
