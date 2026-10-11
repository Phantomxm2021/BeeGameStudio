import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { getBuiltinSkillsDirectory } from '@bee-game-studio/beegame-skills-core/store'

/** A standard, session-only plugin supplies skills without changing native
 * discovery or enabling disabled settings. No skill copies, hooks or agents;
 * manifest paths resolve to the original read-only catalog. */
export async function prepareNativeSkillPlugins(environment: Record<string, string>, includeUserSkills = true) {
  const builtins = await realpath(environment.BEEGAME_NATIVE_BUILTIN_SKILLS_DIR ?? getBuiltinSkillsDirectory())
  if (!(await lstat(builtins)).isDirectory()) throw new Error('BGS built-in Skills must be a directory')
  const userPath = includeUserSkills && environment.BEEGAME_CONFIG_DIR && join(environment.BEEGAME_CONFIG_DIR, 'skills')
  const user = userPath ? await realpath(userPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  }) : undefined
  if (user && !(await lstat(user)).isDirectory()) throw new Error('BGS user Skills must be a directory')
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'bgs-skill-plugins-')))
  const flags: string[] = []
  try {
    for (const [name, source] of [['bgs-builtins', builtins], ['bgs-user', user]] as const) {
      if (!source) continue
      const root = join(directory, name)
      await mkdir(join(root, '.claude-plugin'), { recursive: true, mode: 0o700 })
      await writeFile(join(root, '.claude-plugin/plugin.json'), JSON.stringify({
        name, description: 'BGS-provided Skill catalog', skills: './' + relative(root, source),
      }), { mode: 0o600, flag: 'wx' })
      flags.push('--plugin-dir', root)
    }
    let closing: Promise<void> | undefined
    return { flags, builtins, close() { return closing ??= rm(directory, { recursive: true, force: true }) } }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}
