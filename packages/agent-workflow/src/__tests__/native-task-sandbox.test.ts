import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { wrapCommandWithSandboxMacOS } from '@anthropic-ai/sandbox-runtime/dist/sandbox/macos-sandbox-utils.js'
import { createNativeTaskAccess } from '../native-task-access'

test('native file tasks can use public read-only research tools without opening local URLs', async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'native-research-')))
  try {
    const access = await createNativeTaskAccess({ workspacePath: workspace })
    expect(access.settings.permissions.ask).toContain('Task')
    expect(access.settings.permissions.ask).toContain('WebSearch')
    expect(access.settings.permissions.ask).toContain('WebFetch')
    expect(access.settings.permissions.ask).toContain('DiscoverSkills')
    expect(access.settings.permissions.ask).toContain('Skill')
    expect(await access.permission({ tool_name: 'Task', input: { description: 'Inspect design', prompt: 'Review geometry',
      subagent_type: 'general-purpose', mode: 'bypassPermissions' } })).toEqual({ behavior: 'allow',
      updatedInput: { description: 'Inspect design', prompt: 'Review geometry', subagent_type: 'general-purpose' } })
    expect((await access.permission({ tool_name: 'TaskOutput', input: { task_id: 'child-1' } })).behavior).toBe('allow')
    expect((await access.permission({ tool_name: 'TaskStop', input: { task_id: 'child-1' } })).behavior).toBe('allow')
    expect((await access.permission({ tool_name: 'WebSearch', input: { query: 'XR interaction design' } })).behavior).toBe('allow')
    expect((await access.permission({ tool_name: 'DiscoverSkills', input: { description: 'level design' } })).behavior).toBe('allow')
    expect((await access.permission({ tool_name: 'Skill', input: { skill: 'user-level-design' } })).behavior).toBe('allow')
    expect((await access.permission({ tool_name: 'WebFetch', input: { url: 'https://docs.example.org/xr' } })).behavior).toBe('allow')
    for (const url of ['http://docs.example.org/xr', 'https://127.0.0.1/private',
      'https://[::1]/private', 'https://example.local/private', 'https://user:secret@docs.example.org/xr'])
      expect((await access.permission({ tool_name: 'WebFetch', input: { url } })).behavior, url).toBe('deny')
    expect((await access.permission({ tool_name: 'UnknownWriteTool', input: { path: 'docs/draft.md' } })).behavior).toBe('deny')
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

test('isolated tasks can read enabled skills without writing them or reading other runtime files', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'native-skills-')))
  const workspace = join(root, 'workspace')
  const skills = join(root, 'runtime', 'skills')
  const builtins = join(root, 'builtinskills')
  await mkdir(workspace)
  await mkdir(join(skills, 'user-level-design'), { recursive: true })
  await mkdir(join(builtins, 'game-level-designer-expert'), { recursive: true })
  await writeFile(join(skills, 'user-level-design', 'SKILL.md'), 'Level design reference')
  await writeFile(join(builtins, 'game-level-designer-expert', 'SKILL.md'), 'Built-in level design reference')
  await writeFile(join(root, 'runtime', 'credentials.json'), 'PRIVATE')
  try {
    const access = await createNativeTaskAccess({ workspacePath: workspace,
      skillsDirectory: skills, builtinSkillsDirectory: builtins })
    const skillFile = join(skills, 'user-level-design', 'SKILL.md')
    const builtinFile = join(builtins, 'game-level-designer-expert', 'SKILL.md')
    expect(access.environment.BEEGAME_NATIVE_SKILLS_DIR).toBe(skills)
    expect(access.environment.BEEGAME_NATIVE_BUILTIN_SKILLS_DIR).toBe(builtins)
    expect(access.settings.sandbox.filesystem.allowRead).toContain(skills)
    expect(access.settings.sandbox.filesystem.allowRead).toContain(builtins)
    expect((await access.permission({ tool_name: 'Read', input: { file_path: skillFile } })).behavior).toBe('allow')
    expect((await access.permission({ tool_name: 'Read', input: { file_path: builtinFile } })).behavior).toBe('allow')
    expect((await access.permission({ tool_name: 'Write', input: { file_path: skillFile, content: 'bad' } })).behavior).toBe('deny')
    expect((await access.permission({ tool_name: 'Write', input: { file_path: builtinFile, content: 'bad' } })).behavior).toBe('deny')
    expect((await access.permission({ tool_name: 'Read', input: { file_path: join(root, 'runtime', 'credentials.json') } })).behavior).toBe('deny')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test.skipIf(process.platform !== 'darwin')('task sandbox permits working-file rename/delete, not protected or external files', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'native-sandbox-')))
  const workspace = join(dir, 'workspace')
  await mkdir(workspace)
  await mkdir(join(workspace, 'docs'))
  await writeFile(join(workspace, 'requirements.md'), 'READ ONLY')
  await writeFile(join(dir, 'outside.md'), 'PRIVATE')
  const skillFile = join(dir, 'skills', 'user-level-design', 'SKILL.md')
  await mkdir(join(dir, 'skills', 'user-level-design'), { recursive: true })
  await writeFile(skillFile, 'SKILL_REFERENCE')
  await symlink(join(dir, 'outside.md'), join(workspace, 'link.md'))
  await mkdir(join(workspace, '.claude'))
  await writeFile(join(workspace, '.claude/settings.json'), '{}')
  const access = await createNativeTaskAccess({ workspacePath: workspace,
    allowWorkingFiles: true, readOnlyPaths: ['requirements.md'], skillsDirectory: join(dir, 'skills') })
  const fs = access.settings.sandbox.filesystem
  const run = async (command: string) => {
    // Production generates its profile in the native child's task cwd, not
    // the test runner's repository cwd (mandatory config paths depend on it).
    const previous = process.cwd()
    let wrapped: string
    try {
      process.chdir(workspace)
      wrapped = wrapCommandWithSandboxMacOS({ command, binShell: '/bin/bash',
        needsNetworkRestriction: true,
        readConfig: { denyOnly: fs.denyRead, allowWithinDeny: fs.allowRead },
        writeConfig: { allowOnly: fs.allowWrite, denyWithinAllow: fs.denyWrite } })
    } finally { process.chdir(previous) }
    const child = Bun.spawn(['/bin/bash', '-c', wrapped], {
      cwd: workspace, stdout: 'pipe', stderr: 'pipe',
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: join(workspace, '.native-tmp') },
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ])
    return { code, stdout, stderr }
  }
  try {
    expect(await run(`cat ${JSON.stringify(skillFile)}`)).toEqual({ code: 0, stdout: 'SKILL_REFERENCE', stderr: '' })
    expect(await run("printf test > docs/draft.tmp && mv docs/draft.tmp docs/draft.md && cat docs/draft.md && rm docs/draft.md"))
      .toEqual({ code: 0, stdout: 'test', stderr: '' })
    for (const command of ['cat ../outside.md', 'printf bad > ../outside.md',
      'rm requirements.md', 'mv requirements.md docs/moved.md', 'printf bad > requirements.md',
      'mv ../outside.md docs/stolen.md', 'mv . ../renamed', 'cat link.md',
      'printf bad > link.md', 'rm .claude/settings.json', 'mv .claude docs/config',
      'printf bad > .bashrc']) {
      expect((await run(command)).code, command).not.toBe(0)
    }
    expect((await run(`printf bad > ${JSON.stringify(skillFile)}`)).code).not.toBe(0)
    expect(await readFile(skillFile, 'utf8')).toBe('SKILL_REFERENCE')
    expect(await readFile(join(workspace, 'requirements.md'), 'utf8')).toBe('READ ONLY')
    expect(await readFile(join(dir, 'outside.md'), 'utf8')).toBe('PRIVATE')
  } finally { await rm(dir, { recursive: true, force: true }) }
}, 15000)
