import { afterEach, beforeEach, expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { prepareNativeSkillPlugins } from './native-skill-plugins'
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

test('the copied Collection preserves all independent Skill names and resolves shared references', async () => {
  const source=await realpath(new URL('../../../../.beegame/skills/builtinskills/',import.meta.url))
  const catalog=join(root,'packaged/skills/builtinskills')
  // The runtime post-build step copies this same directory recursively.
  await cp(source,catalog,{recursive:true})
  const names=(await readdir(catalog,{withFileTypes:true})).filter(entry=>entry.isDirectory()&&
    entry.name!=='references').map(entry=>entry.name).sort()
  expect(names).toHaveLength(20)
  const navigator=await readFile(join(catalog,'README.md'),'utf8')
  const linkedNames=[...navigator.matchAll(/\]\(([^/()]+)\/SKILL\.md\)/g)].map(match=>match[1]!).sort()
  expect(linkedNames).toEqual(names)
  plugins=await prepareNativeSkillPlugins({BEEGAME_NATIVE_BUILTIN_SKILLS_DIR:catalog},false)
  expect(plugins.flags).toHaveLength(2)
  setInlinePlugins(plugins.flags.filter((_,index)=>index%2===1))
  const commands=await getSkillToolCommands(root)
  const builtinCommands=commands.filter(command=>command.name.startsWith('bgs-builtins:'))
  expect(builtinCommands.map(command=>command.name).sort()).toEqual(names.map(name=>'bgs-builtins:'+name).sort())
  const markdown=[join(catalog,'README.md')]
  for(const name of names) {
    const skill=builtinCommands.find(command=>command.name==='bgs-builtins:'+name)
    if(!skill||skill.type!=='prompt')throw Error('Missing independent Skill '+name)
    expect(skill.skillRoot).toBe(join(catalog,name))
    expect((await skill.getPromptForCommand('',{} as any)).length).toBeGreaterThan(0)
    expect(await readFile(join(catalog,name,'SKILL.md'))).toEqual(await readFile(join(source,name,'SKILL.md')))
    markdown.push(join(catalog,name,'SKILL.md'))
    for(const file of await readdir(join(catalog,name,'references')).catch((error:NodeJS.ErrnoException)=>{
      if(error.code==='ENOENT')return [] as string[]
      throw error
    }))if(file.endsWith('.md'))markdown.push(join(catalog,name,'references',file))
  }
  const shared=new Set<string>()
  for(const file of markdown) {
    const text=await readFile(file,'utf8')
    const links=[...text.matchAll(/\]\(([^)]+)\)/g)].map(match=>match[1]!)
      .concat([...text.matchAll(/`(references\/[A-Za-z0-9_./-]+\.md)`/g)].map(match=>match[1]!))
    for(const link of new Set(links)) {
      if(/^(https?:|#)/.test(link))continue
      const target=resolve(dirname(file),link.split('#')[0]!),path=relative(catalog,target)
      expect(path.startsWith('..')).toBe(false)
      expect((await stat(target)).isFile()).toBe(true)
      expect(await readFile(target)).toEqual(await readFile(join(source,path)))
      shared.add(path)
    }
  }
  expect(shared.has('game-art-director-expert/references/ui-visual-hierarchy.md')).toBe(true)
  expect(shared.has('game-art-director-expert/references/composition-studies.png')).toBe(true)
  expect(shared.has('game-ui-ux-designer/references/layout-calculation.md')).toBe(true)
  expect(shared.has('spatial-computing-game-expert/references/spatial-rule-architecture.md')).toBe(true)
  expect(getAllowedSettingSources()).toEqual([])
})
