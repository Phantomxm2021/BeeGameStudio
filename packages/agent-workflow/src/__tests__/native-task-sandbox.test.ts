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
    expect(await access.permission({ tool_name: 'Task', input: { description: 'Inspect design', prompt: 'Review geometry',
      subagent_type: 'general-purpose', mode: 'bypassPermissions' } })).toEqual({ behavior: 'allow',
      updatedInput: { description: 'Inspect design', prompt: 'Review geometry', subagent_type: 'general-purpose' } })
    expect((await access.permission({ tool_name: 'TaskOutput', input: { task_id: 'child-1' } })).behavior).toBe('allow')
    expect((await access.permission({ tool_name: 'TaskStop', input: { task_id: 'child-1' } })).behavior).toBe('allow')
    expect((await access.permission({ tool_name: 'WebSearch', input: { query: 'XR interaction design' } })).behavior).toBe('allow')
    expect((await access.permission({ tool_name: 'WebFetch', input: { url: 'https://docs.example.org/xr' } })).behavior).toBe('allow')
    for (const url of ['http://docs.example.org/xr', 'https://127.0.0.1/private',
      'https://[::1]/private', 'https://example.local/private', 'https://user:secret@docs.example.org/xr'])
      expect((await access.permission({ tool_name: 'WebFetch', input: { url } })).behavior, url).toBe('deny')
    expect((await access.permission({ tool_name: 'UnknownWriteTool', input: { path: 'docs/draft.md' } })).behavior).toBe('deny')
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

test.skipIf(process.platform !== 'darwin')('task sandbox permits working-file rename/delete, not protected or external files', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'native-sandbox-')))
  const workspace = join(dir, 'workspace')
  await mkdir(workspace)
  await mkdir(join(workspace, 'docs'))
  await writeFile(join(workspace, 'requirements.md'), 'READ ONLY')
  await writeFile(join(dir, 'outside.md'), 'PRIVATE')
  await symlink(join(dir, 'outside.md'), join(workspace, 'link.md'))
  await mkdir(join(workspace, '.claude'))
  await writeFile(join(workspace, '.claude/settings.json'), '{}')
  const access = await createNativeTaskAccess({ workspacePath: workspace,
    allowWorkingFiles: true, readOnlyPaths: ['requirements.md'] })
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
    expect(await run("printf test > docs/draft.tmp && mv docs/draft.tmp docs/draft.md && cat docs/draft.md && rm docs/draft.md"))
      .toEqual({ code: 0, stdout: 'test', stderr: '' })
    for (const command of ['cat ../outside.md', 'printf bad > ../outside.md',
      'rm requirements.md', 'mv requirements.md docs/moved.md', 'printf bad > requirements.md',
      'mv ../outside.md docs/stolen.md', 'mv . ../renamed', 'cat link.md',
      'printf bad > link.md', 'rm .claude/settings.json', 'mv .claude docs/config',
      'printf bad > .bashrc']) {
      expect((await run(command)).code, command).not.toBe(0)
    }
    expect(await readFile(join(workspace, 'requirements.md'), 'utf8')).toBe('READ ONLY')
    expect(await readFile(join(dir, 'outside.md'), 'utf8')).toBe('PRIVATE')
  } finally { await rm(dir, { recursive: true, force: true }) }
}, 15000)
