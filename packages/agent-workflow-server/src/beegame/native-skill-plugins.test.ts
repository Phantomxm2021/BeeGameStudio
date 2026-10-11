import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { prepareNativeSkillPlugins } from './native-skill-plugins'
import { bgsBuiltinSkillName } from '@bee-game-studio/agent-workflow/native-direction-authors'
import { getAllowedSettingSources, getInlinePlugins, setAllowedSettingSources, setInlinePlugins } from '../../../../src/bootstrap/state'
import { clearCommandsCache, getSkillToolCommands } from '../../../../src/commands'
import { clearSkillCaches, getSkillDirCommands } from '../../../../src/skills/loadSkillsDir'
import { clearPluginCache } from '../../../../src/utils/plugins/pluginLoader'

let root: string
let plugins: Awaited<ReturnType<typeof prepareNativeSkillPlugins>> | undefined
const originalEnv = { ...process.env }
let sources: ReturnType<typeof getAllowedSettingSources>, inline: string[]
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-standard-skill-test-')))
  sources = getAllowedSettingSources(); inline = getInlinePlugins()
  process.env = { ...originalEnv, BEEGAME_CONFIG_DIR: join(root, 'config'), NODE_ENV: 'test',
    ANTHROPIC_API_KEY: 'OFFLINE_TEST_ONLY', BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1' }
  setAllowedSettingSources([]); setInlinePlugins([])
  clearCommandsCache(); clearSkillCaches(); clearPluginCache()
})
afterEach(async () => {
  await plugins?.close(); plugins = undefined
  setAllowedSettingSources(sources); setInlinePlugins(inline); process.env = { ...originalEnv }
  clearCommandsCache(); clearSkillCaches(); clearPluginCache()
  await rm(root, { recursive: true, force: true })
})

test('standard plugins supply built-in and selected user Skills with settings disabled', async () => {
  const builtins = join(root, 'catalog'), user = join(root, 'config/skills')
  await mkdir(join(builtins, 'game-level-designer-expert/references'), { recursive: true })
  await mkdir(join(user, 'user-specialist'), { recursive: true })
  await writeFile(join(builtins, 'game-level-designer-expert/SKILL.md'),
    '---\nname: game-level-designer-expert\ndescription: Game level design\n---\nRead references/check.md.')
  await writeFile(join(builtins, 'game-level-designer-expert/references/check.md'), 'Original read-only reference')
  await writeFile(join(user, 'user-specialist/SKILL.md'),
    '---\nname: specialist\ndescription: Selected user reference\n---\nUser methods.')
  await writeFile(join(root, 'config/settings.json'), '{"hooks":{"Stop":[]}}')
  plugins = await prepareNativeSkillPlugins({ BEEGAME_CONFIG_DIR: join(root, 'config'),
    BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: builtins })
  expect(plugins.flags).toHaveLength(4)
  setInlinePlugins(plugins.flags.filter((_, index) => index % 2 === 1))
  clearPluginCache(); clearCommandsCache()
  const commands = await getSkillToolCommands(root)
  const skill = commands.find(command => command.name === 'bgs-builtins:game-level-designer-expert')
  expect(skill?.type).toBe('prompt')
  if (skill?.type !== 'prompt') throw new Error('Standard plugin did not load its Skill')
  expect(skill.skillRoot).toBe(join(builtins, 'game-level-designer-expert'))
  expect(JSON.stringify(await skill.getPromptForCommand('', {} as any))).toContain('Read references/check.md')
  expect(commands.map(command => command.name)).toContain('bgs-user:user-specialist')
  expect(bgsBuiltinSkillName('game-level-designer-expert', commands.map(command => command.name))).toBe(skill.name)
  expect(getAllowedSettingSources()).toEqual([])
  for (let index = 1; index < plugins.flags.length; index += 2) {
    const directory = plugins.flags[index]!
    const manifest = JSON.parse(await readFile(join(directory, '.claude-plugin/plugin.json'), 'utf8'))
    expect(Object.keys(manifest).sort()).toEqual(['description', 'name', 'skills'])
    expect(await realpath(resolve(directory, manifest.skills))).toBe(index === 1 ? builtins : user)
  }
  const wrapper = dirname(plugins.flags[1]!)
  await plugins.close()
  await expect(readFile(join(wrapper, 'bgs-builtins/.claude-plugin/plugin.json'))).rejects.toThrow()
  expect(await readFile(join(builtins, 'game-level-designer-expert/references/check.md'), 'utf8')).toContain('Original read-only')
})

test('native directory discovery ignores private BGS catalog variables without an explicit plugin', async () => {
  const catalog = join(root, 'catalog')
  await mkdir(join(catalog, 'unrequested'), { recursive: true })
  await writeFile(join(catalog, 'unrequested/SKILL.md'), '---\nname: unrequested\ndescription: Unrequested skill\n---\nMethods.')
  process.env.BEEGAME_NATIVE_BUILTIN_SKILLS_DIR = catalog
  process.env.BEEGAME_NATIVE_SKILLS_DIR = catalog
  expect((await getSkillDirCommands(root)).map(command => command.name)).not.toContain('unrequested')
  expect((await getSkillToolCommands(root)).map(command => command.name)).not.toContain('unrequested')
})

test('invalid explicit catalog is an actionable startup error, not a silent empty Skill list', async () => {
  await expect(prepareNativeSkillPlugins({ BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: join(root, 'missing') })).rejects.toThrow()
  await writeFile(join(root, 'file'), 'Not a catalog')
  await expect(prepareNativeSkillPlugins({ BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: join(root, 'file') }))
    .rejects.toThrow('must be a directory')
})
