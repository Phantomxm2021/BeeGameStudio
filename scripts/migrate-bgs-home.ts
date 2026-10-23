import { lstat, realpath, rename, symlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const exists = async (path: string) => lstat(path).then(() => true, (error: NodeJS.ErrnoException) => {
  if (error.code === 'ENOENT') return false
  throw error
})

export async function migrateBgsHome(from: string, to: string, apply = false, checkIdle = assertIdle) {
  const source = resolve(from), destination = resolve(to)
  if (source === destination || dirname(source) !== dirname(destination))
    throw Error('Use distinct sibling paths on the same filesystem')
  const status = await lstat(source)
  if (status.isSymbolicLink()) {
    if (await realpath(source) === await realpath(destination)) return { migrated: false, alreadyMigrated: true }
    throw Error('The source is an unrelated symlink')
  }
  if (!status.isDirectory()) throw Error('The source must be a runtime home directory')
  if (await exists(destination)) throw Error('Destination already exists; refusing to merge or overwrite account data')
  if (!apply) return { migrated: false, source, destination }
  checkIdle(source)
  await rename(source, destination)
  try {
    // Existing SQLite/rollout/plugin records can contain absolute old paths.
    // Keep those references valid without rewriting history or user artifacts.
    await symlink(destination, source, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) { await rename(destination, source); throw error }
  return { migrated: true, source, destination }
}

function assertIdle(source: string) {
  if (process.platform === 'win32') throw Error('Automatic open-file verification is unavailable on Windows; migration is not applied')
  try {
    execFileSync('/usr/sbin/lsof', ['-t', '+D', source], { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error: any) {
    if (error.status === 1 && !error.stdout?.length && !error.stderr?.length) return
    throw Error('Could not prove the runtime home is idle; no data was moved')
  }
  throw Error('The runtime home has open files. Stop all services using it before migrating')
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  if ((args.length !== 4 && args.length !== 5) || args[0] !== '--from' || args[2] !== '--to' || (args[4] && args[4] !== '--apply'))
    throw Error('Usage: bun scripts/migrate-bgs-home.ts --from OLD_HOME --to BGS_HOME [--apply]')
  console.log(JSON.stringify(await migrateBgsHome(args[1]!, args[3]!, args[4] === '--apply')))
}
