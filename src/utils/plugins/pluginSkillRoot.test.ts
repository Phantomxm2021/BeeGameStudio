import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getInlinePlugins, setInlinePlugins } from '../../bootstrap/state'
import { clearPluginCache } from './pluginLoader'
import { clearPluginSkillsCache, getPluginSkills } from './loadPluginCommands'

test('a standard plugin Skill exposes its actual source directory for discovery and references', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-skill-root-'))
  const previous = getInlinePlugins()
  const skillRoot = join(root, 'skills/check-source')
  try {
    await mkdir(join(root, '.claude-plugin'), { recursive: true })
    await mkdir(skillRoot, { recursive: true })
    await writeFile(join(root, '.claude-plugin/plugin.json'), '{"name":"source-methods"}')
    await writeFile(join(skillRoot, 'SKILL.md'), '---\nname: check-source\ndescription: Inspect original evidence\n---\nRead references/input.md.')
    setInlinePlugins([root]); clearPluginCache(); clearPluginSkillsCache()
    const skill = (await getPluginSkills()).find(command => command.name === 'source-methods:check-source')
    expect(skill?.type).toBe('prompt')
    if (skill?.type !== 'prompt') throw new Error('Plugin did not load the fixture Skill')
    expect(skill.skillRoot).toBe(skillRoot)
    expect(JSON.stringify(await skill.getPromptForCommand('', {} as any))).toContain(skillRoot)
  } finally {
    setInlinePlugins(previous); clearPluginCache(); clearPluginSkillsCache()
    await rm(root, { recursive: true, force: true })
  }
})
