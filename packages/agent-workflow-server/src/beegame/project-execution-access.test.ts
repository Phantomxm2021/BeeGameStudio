import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { wrapCommandWithSandboxMacOS } from '@anthropic-ai/sandbox-runtime/dist/sandbox/macos-sandbox-utils.js'
import { projectExecutionAccess } from './project-execution-access'

test('native project temp environment resolves inside the project before Bash tools run', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'project-temp-env-')))
  const workspace = join(root, 'game')
  try {
    await mkdir(workspace)
    const access = await projectExecutionAccess({
      workspacePath: workspace, sessionId: 'temp', environment: {},
    })
    expect(access.environment.TMPDIR).toBe(access.temporary)
    expect(access.environment.CLAUDE_CODE_TMPDIR).toBe(access.temporary)
    const modulePath = fileURLToPath(new URL('../../../../src/utils/permissions/filesystem.ts', import.meta.url))
    const child = Bun.spawn([process.execPath, '-e',
      'import { getClaudeTempDir } from ' + JSON.stringify(modulePath) +
      '; console.log(JSON.stringify({temp:process.env.TMPDIR, native:getClaudeTempDir()}))'], {
      cwd: workspace, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...access.environment },
      stdout: 'pipe', stderr: 'pipe',
    })
    const [code, output, error] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ])
    expect(code, error).toBe(0)
    const actual = JSON.parse(output)
    expect(actual.temp).toBe(access.temporary)
    expect(actual.native.startsWith(access.temporary + '/')).toBe(true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('published skills stay readable without granting their enclosing runtime directory', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'project-skills-')))
  try {
    const workspace = join(root, 'game')
    const skills = join(root, 'config/skills')
    await mkdir(workspace)
    await mkdir(skills, { recursive: true })
    await writeFile(join(skills, 'reference.md'), 'REFERENCE')
    await writeFile(join(root, 'config/private.json'), 'PRIVATE')
    await symlink(join(root, 'config/private.json'), join(skills, 'escape.json'))
    const access = await projectExecutionAccess({ workspacePath: workspace, sessionId: 'skills',
      environment: { BEEGAME_CONFIG_DIR: join(root, 'config') } })
    expect(await access.isReferenceRead('Read', { file_path: join(skills, 'reference.md') })).toBe(true)
    expect(await access.isReferenceRead('Read', { file_path: join(skills, 'escape.json') })).toBe(false)
    expect(await access.isReferenceRead('Write', { file_path: join(skills, 'reference.md') })).toBe(false)
    expect(await access.isReferenceRead('Glob', { path: skills, pattern: '../*' })).toBe(false)
    expect(access.settings.sandbox.filesystem.allowRead).not.toContain(join(root, 'config'))
    expect(access.flags).not.toContain('--tools')
    expect(access.flags).not.toContain('--disallowedTools')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test.skipIf(process.platform !== 'darwin')('project shell supports Git and local development without host reads', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'project-execution-')))
  const workspace = join(root, 'game')
  await mkdir(workspace)
  await writeFile(join(root, 'host-source.ts'), 'PRIVATE_HOST_FIXTURE')
  await symlink(join(root, 'host-source.ts'), join(workspace, 'escape.ts'))
  const access = await projectExecutionAccess({ workspacePath: workspace, sessionId: 'test', environment: {} })
  const fs = access.settings.sandbox.filesystem
  const run = async (command: string) => {
    const previous = process.cwd()
    let wrapped: string
    try {
      process.chdir(workspace)
      wrapped = wrapCommandWithSandboxMacOS({ command, binShell: '/bin/bash',
        needsNetworkRestriction: false, allowGitConfig: fs.allowGitConfig,
        readConfig: { denyOnly: fs.denyRead, allowWithinDeny: fs.allowRead },
        writeConfig: { allowOnly: fs.allowWrite, denyWithinAllow: fs.denyWrite } })
    } finally { process.chdir(previous) }
    const child = Bun.spawn(['/bin/bash', '-c', wrapped], { cwd: workspace,
      env: { HOME: process.env.HOME, ...access.environment }, stdout: 'pipe', stderr: 'pipe' })
    const [code, stdout, stderr] = await Promise.all([child.exited,
      new Response(child.stdout).text(), new Response(child.stderr).text()])
    return { code, stdout, stderr }
  }
  try {
    const git = await run('git init -q && printf game > game.txt && git add game.txt && git -c user.name=Fixture -c user.email=fixture@example.test commit -qm first && git status --porcelain')
    expect(git.code, git.stderr).toBe(0)
    expect(git.stderr).toBe('')
    expect(git.stdout).not.toContain('game.txt')
    const local = await run(`${JSON.stringify(process.execPath)} -e 'const s=Bun.serve({port:0,fetch:()=>new Response("ok")}); console.log(await (await fetch("http://127.0.0.1:"+s.port)).text()); s.stop();'`)
    expect(local.code, local.stderr).toBe(0)
    expect(local.stdout.trim()).toBe('ok')
    for (const command of ['cat ../host-source.ts', 'cat escape.ts',
      'printf bad > ../host-source.ts', 'printf bad > escape.ts',
      '/bin/bash -c "cat ../host-source.ts"']) {
      const result = await run(command)
      expect(result.code, command).not.toBe(0)
      expect(result.stdout).not.toContain('PRIVATE_HOST_FIXTURE')
    }
    expect(await readFile(join(root, 'host-source.ts'), 'utf8')).toBe('PRIVATE_HOST_FIXTURE')
  } finally { await rm(root, { recursive: true, force: true }) }
}, 20000)
