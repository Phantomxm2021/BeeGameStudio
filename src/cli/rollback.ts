/**
 * `bee-game-studio rollback [target]` — roll back to a previous BGS version.
 *
 * ANT-only command (USER_TYPE === "ant").
 *
 * Options:
 *   --list      List recent published versions
 *   --dry-run   Show what would be installed without installing
 *   --safe      Roll back to the server-pinned safe version
 */
export async function rollback(
  target?: string,
  options?: { list?: boolean; dryRun?: boolean; safe?: boolean },
): Promise<void> {
  if (options?.list) {
    console.error('Version listing is unavailable: no BGS release registry is configured.')
    process.exitCode = 1
    return
  }

  if (options?.safe) {
    console.error('Safe rollback is unavailable: no BGS version pinning API is configured.')
    process.exitCode = 1
    return
  }

  if (!target) {
    console.error(
      'Usage: bee-game-studio rollback [target]\n\n' +
        'Options:\n' +
        '  -l, --list     List recent published versions\n' +
        '  --dry-run      Show what would be installed\n' +
        '  --safe         Roll back to server-pinned safe version\n\n' +
        'Examples:\n' +
        '  bee-game-studio rollback 2.1.880\n' +
        '  bee-game-studio rollback --list\n' +
        '  bee-game-studio rollback --safe',
    )
    process.exitCode = 1
    return
  }

  if (!MACRO.PACKAGE_URL) {
    console.error('BGS distribution source is not configured; no installation was attempted.')
    process.exitCode = 1
    return
  }

  console.log(`Rolling back to version ${target}...`)

  if (options?.dryRun) {
    console.log(`  (dry run — would install ${target})`)
    return
  }

  const { installGlobalPackage } = await import('../utils/autoUpdater.js')
  const status = await installGlobalPackage(target)
  if (status !== 'success') {
    console.error(`Rollback failed: ${status}`)
    process.exitCode = 1
  } else {
    console.log(`Rolled back to ${target} successfully.`)
  }
}
