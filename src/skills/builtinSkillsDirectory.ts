import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/** The host may supply a read-only catalog; standalone CLI builds ship one beside the executable. */
export function getNativeBuiltinSkillsDirectory(): string | undefined {
  const configured = process.env.BEEGAME_NATIVE_BUILTIN_SKILLS_DIR?.trim()
  if (configured) return configured

  const executable = process.argv[1]
  if (!executable) return undefined
  try {
    const entrypoint = realpathSync(executable)
    const entrypointDir = dirname(entrypoint)
    const packaged = join(entrypointDir, 'skills', 'builtinskills')
    if (existsSync(packaged)) return packaged

    // `npm run dev` launches src/entrypoints/cli.tsx directly, with no build.
    if (
      basename(entrypoint) === 'cli.tsx' &&
      basename(entrypointDir) === 'entrypoints' &&
      basename(dirname(entrypointDir)) === 'src'
    ) {
      const source = join(
        entrypointDir,
        '..',
        '..',
        '.beegame',
        'skills',
        'builtinskills',
      )
      if (existsSync(source)) return source
    }
    return undefined
  } catch {
    return undefined
  }
}
