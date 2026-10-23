import { existsSync, lstatSync } from 'node:fs'
import { join } from 'node:path'

/** Never silently start a second account store when a pre-branding home exists.
 * A legacy symlink is allowed only as a migration alias for saved absolute paths. */
export function bgsHomeDirectory(configDirectory: string, override?: string) {
  if (override) return override
  const home = join(configDirectory, 'bgs'), legacy = join(configDirectory, 'codex')
  if (existsSync(legacy) && !lstatSync(legacy).isSymbolicLink())
    throw Error('An older runtime home needs offline migration. Stop its services and run bun scripts/migrate-bgs-home.ts --from ' + JSON.stringify(legacy) + ' --to ' + JSON.stringify(home) + ' --apply')
  return home
}
