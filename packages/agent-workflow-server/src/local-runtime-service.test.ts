import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, test } from 'bun:test'
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getDashboardDataRoot,
  resolveSessionWorkspacePath,
  createManagedProjectWorkspacePath,
  initializeProjectRepository,
} from './local-runtime-service'

const originalWorkspacePath = process.env.AGENT_WORKFLOW_WORKSPACE_PATH
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})))
  if (originalWorkspacePath === undefined) {
    delete process.env.AGENT_WORKFLOW_WORKSPACE_PATH
  } else {
    process.env.AGENT_WORKFLOW_WORKSPACE_PATH = originalWorkspacePath
  }
})

describe('server-managed workspace boundary', () => {
  test('does not fall back to a Projects directory under the process cwd', () => {
    delete process.env.AGENT_WORKFLOW_WORKSPACE_PATH

    expect(() => getDashboardDataRoot()).toThrow(
      'AGENT_WORKFLOW_WORKSPACE_PATH is required',
    )
  })

  test('always rejects a session workspace outside the configured root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beegame-workspace-root-'))
    roots.push(root)
    process.env.AGENT_WORKFLOW_WORKSPACE_PATH = root

    await expect(
      resolveSessionWorkspacePath('/tmp/unmanaged-project'),
    ).rejects.toThrow(
      'Workspace path must stay inside the default Projects directory',
    )
  })

  test('rejects linked project roots and linked parents of new managed workspaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beegame-workspace-link-')); roots.push(root)
    const projects = join(root, 'projects'), outside = join(root, 'outside')
    await Promise.all([mkdir(projects), mkdir(outside)])
    await symlink(outside, join(projects, 'alias'))
    await symlink(outside, join(projects, 'users'))
    await expect(resolveSessionWorkspacePath(join(projects, 'alias'), projects)).rejects.toThrow('symbolic link')
    await expect(resolveSessionWorkspacePath(join(projects, 'alias/new-project'), projects)).rejects.toThrow('symbolic link')
    await expect(createManagedProjectWorkspacePath({defaultWorkspacePath: projects, userId: 'owner', projectName: 'new-project'})).rejects.toThrow('symbolic link')
    await expect(access(join(outside, 'owner'))).rejects.toThrow()
  })

  test('allows the operator-configured root alias and ordinary new project directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beegame-workspace-configured-')); roots.push(root)
    const projects = join(root, 'projects'), configured = join(root, 'configured')
    await mkdir(projects)
    await symlink(projects, configured)
    expect(await resolveSessionWorkspacePath(join(configured, 'new-project'), configured))
      .toBe(join(await realpath(projects), 'new-project'))
    const created = await createManagedProjectWorkspacePath({defaultWorkspacePath: configured, userId: 'owner', projectName: 'new-project'})
    expect(created).toBe(join(await realpath(projects), 'users/owner/new-project'))
    await access(created)
  })
})

const exec = promisify(execFile)
async function gitAt(root: string, ...args: string[]) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return (await exec('git', ['-C', root, ...args], {
    env: {...env, GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_GLOBAL:'/dev/null'},
  })).stdout.trim()
}
async function repositoryFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-project-git-')))
  roots.push(root)
  return root
}

test('new project receives its own repository inside an ancestor repository, without staging files', async () => {
  const parent = await repositoryFixture(), project = join(parent, 'project')
  await gitAt(parent, 'init', '--template=', '--initial-branch=parent')
  await mkdir(project)
  await writeFile(join(project, 'existing.txt'), 'Existing project file')
  const before = await gitAt(parent, 'status', '--porcelain')
  const previous = process.env.GIT_DIR
  process.env.GIT_DIR = join(parent, '.git')
  try { await initializeProjectRepository(project) }
  finally {
    if (previous === undefined) delete process.env.GIT_DIR
    else process.env.GIT_DIR = previous
  }
  expect(await gitAt(project, 'rev-parse', '--show-toplevel')).toBe(project)
  expect(await gitAt(project, 'symbolic-ref', '--short', 'HEAD')).toBe('main')
  expect(await gitAt(project, 'ls-files')).toBe('')
  expect(await gitAt(parent, 'status', '--porcelain')).toBe(before)
  expect(await gitAt(parent, 'symbolic-ref', '--short', 'HEAD')).toBe('parent')
  expect(await readFile(join(project, 'existing.txt'), 'utf8')).toBe('Existing project file')
})

test('existing repository and worktree keep history, branch, configuration and staged changes', async () => {
  const root = await repositoryFixture()
  await gitAt(root, 'init', '--template=', '--initial-branch=existing')
  await writeFile(join(root, 'source.txt'), 'baseline')
  await gitAt(root, 'add', 'source.txt')
  await gitAt(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgSign=false', 'commit', '-m', 'Existing history')
  await gitAt(root, 'config', 'remote.origin.url', 'https://example.invalid/preserve.git')
  await writeFile(join(root, 'source.txt'), 'staged change')
  await gitAt(root, 'add', 'source.txt')
  const head = await gitAt(root, 'rev-parse', 'HEAD'), config = await readFile(join(root, '.git/config'), 'utf8')
  const index = await gitAt(root, 'diff', '--cached')
  await initializeProjectRepository(root)
  expect(await gitAt(root, 'rev-parse', 'HEAD')).toBe(head)
  expect(await gitAt(root, 'symbolic-ref', '--short', 'HEAD')).toBe('existing')
  expect(await readFile(join(root, '.git/config'), 'utf8')).toBe(config)
  expect(await gitAt(root, 'diff', '--cached')).toBe(index)
  const worktree = join(await repositoryFixture(), 'linked')
  await gitAt(root, 'worktree', 'add', '-b', 'linked', worktree)
  const pointer = await readFile(join(worktree, '.git'), 'utf8')
  await initializeProjectRepository(worktree)
  expect(await readFile(join(worktree, '.git'), 'utf8')).toBe(pointer)
  expect(await gitAt(worktree, 'rev-parse', 'HEAD')).toBe(head)
  expect(await gitAt(worktree, 'symbolic-ref', '--short', 'HEAD')).toBe('linked')
})

test('invalid existing Git metadata is reported without replacement', async () => {
  const root = await repositoryFixture()
  await writeFile(join(root, '.git'), 'Invalid existing Git metadata')
  await expect(initializeProjectRepository(root)).rejects.toThrow()
  expect(await readFile(join(root, '.git'), 'utf8')).toBe('Invalid existing Git metadata')
})

test('Git initialization failure is visible instead of claiming a repository exists', async () => {
  const root = await repositoryFixture(), previous = process.env.PATH
  process.env.PATH = root
  try { await expect(initializeProjectRepository(root)).rejects.toThrow() }
  finally {
    if (previous === undefined) delete process.env.PATH
    else process.env.PATH = previous
  }
  await expect(access(join(root, '.git'))).rejects.toThrow()
})

test('project Git excludes runtime data, dependencies and secrets while retaining authored inputs', async () => {
  const root = await repositoryFixture()
  const ignored = ['.beegame/chat/project-events.jsonl', '.beegame/tmp/npm-cache/blob',
    '.beegame/artifacts/archive.zip', '.runtime/state.json', 'logs/runtime-diagnostics.jsonl',
    'node_modules/pkg/index.js', 'nested/node_modules/pkg/index.js', 'dist/index.html',
    '.vite/cache', '.cache/blob', 'tsconfig.app.tsbuildinfo', '.DS_Store', '.env', '.env.local']
  const retained = ['src/main.ts', 'assets/image.png', 'content/data.json', 'reports/result.json',
    '.beegame/design-handoffs/GDD.json', '.beegame-attachments/reference.png', '.work/design.md',
    'docs/GDD.md', 'package-lock.json', '.env.example', '.env.sample', '.env.template']
  for (const path of [...ignored, ...retained]) {
    await mkdir(join(root, path, '..'), {recursive: true})
    await writeFile(join(root, path), 'fixture')
  }
  await initializeProjectRepository(root, {engine: 'React'})
  const exclude = await readFile(join(root, '.git/info/exclude'), 'utf8')
  await initializeProjectRepository(root, {engine: 'React'})
  expect(await readFile(join(root, '.git/info/exclude'), 'utf8')).toBe(exclude)
  for (const path of ignored) expect(await gitAt(root, 'check-ignore', '--', path)).toBe(path)
  // Reproduce the external diff client's temporary-index add. Ignored files
  // must never become Git objects even though the user's index is untouched.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  const temporaryIndex = join(await repositoryFixture(), 'index')
  await exec('git', ['-C', root, 'add', '-A'], { env: {...env, GIT_INDEX_FILE: temporaryIndex} })
  const staged = (await exec('git', ['-C', root, 'ls-files'], { env: {...env, GIT_INDEX_FILE: temporaryIndex} })).stdout.split('\n')
  for (const path of retained) expect(staged).toContain(path)
  for (const path of ignored) expect(staged).not.toContain(path)
  expect(await gitAt(root, 'ls-files')).toBe('')
})

test('existing ignore rules and staged runtime files are preserved; local fallback covers missing defaults', async () => {
  const root = await repositoryFixture()
  await gitAt(root, 'init', '--template=')
  const authored = '# Authored rules\ncustom-cache/\n!dist/\n'
  await writeFile(join(root, '.gitignore'), authored)
  await mkdir(join(root, '.git/info'), {recursive: true})
  await writeFile(join(root, '.git/info/exclude'), '# Existing local rules\nlocal-cache/')
  await mkdir(join(root, 'logs'))
  await writeFile(join(root, 'logs/retained.log'), 'previously staged')
  await gitAt(root, 'add', 'logs/retained.log')
  await initializeProjectRepository(root, {createIfMissing: false})
  expect(await readFile(join(root, '.gitignore'), 'utf8')).toEndWith(authored)
  expect(await readFile(join(root, '.git/info/exclude'), 'utf8')).toEndWith('# Existing local rules\nlocal-cache/')
  expect(await gitAt(root, 'check-ignore', '--', '.beegame/chat/project-events.jsonl')).toBe('.beegame/chat/project-events.jsonl')
  expect(await gitAt(root, 'ls-files')).toBe('logs/retained.log')
  const noGit = await repositoryFixture()
  await initializeProjectRepository(noGit, {createIfMissing: false})
  await expect(access(join(noGit, '.gitignore'))).rejects.toThrow()
  await expect(access(join(noGit, '.git'))).rejects.toThrow()
})

test('ignore setup refuses linked metadata without writing outside the repository', async () => {
  const root = await repositoryFixture(), outside = await repositoryFixture()
  await gitAt(root, 'init', '--template=')
  await mkdir(join(root, '.git/info'), {recursive: true})
  const target = join(outside, 'do-not-change')
  await writeFile(target, 'unchanged')
  await symlink(target, join(root, '.git/info/exclude'))
  await expect(initializeProjectRepository(root)).rejects.toThrow()
  expect(await readFile(target, 'utf8')).toBe('unchanged')
  await rm(join(root, '.git/info'), {recursive: true})
  await symlink(outside, join(root, '.git/info'))
  await expect(initializeProjectRepository(root)).rejects.toThrow('symbolic link')
  await expect(access(join(outside, 'exclude'))).rejects.toThrow()
})


test.each([
  {engine: 'React', ignored: ['dist/index.html', '.vite/cache', '.cache/cache', 'tsconfig.tsbuildinfo'],
    retained: ['src/main.tsx', 'public/image.png', 'package.json', 'bun.lock', 'Library/art.png', 'Build/tool.ts', 'logs/game-data.json']},
  {engine: 'Unity', ignored: ['Library/cache', 'Temp/cache', 'obj/cache', 'Logs/editor.log', 'UserSettings/EditorUserSettings.asset', '.vs/cache'],
    retained: ['Assets/Game.cs', 'Assets/Game.cs.meta', 'Assets/Library/image.png', 'Assets/Plugins/native.dll', 'Packages/manifest.json', 'Packages/packages-lock.json', 'ProjectSettings/ProjectVersion.txt', 'dist/source.json']},
  {engine: 'Godot', ignored: ['.godot/cache', '.import/cache', '.mono/cache'],
    retained: ['project.godot', 'main.gd', 'main.gd.uid', 'scene.tscn', 'material.tres', 'image.png', 'image.png.import', 'export_presets.cfg', 'addons/plugin/plugin.gd', 'addons/plugin/native.dll', 'locale/custom.translation', 'expansion.pck', 'dist/source.json']},
  {engine: 'Unreal', ignored: ['Intermediate/cache', 'Saved/cache', 'DerivedDataCache/cache', '.vs/cache', 'Plugins/Custom/Intermediate/cache'],
    retained: ['Game.uproject', 'Source/Game.cpp', 'Source/Game.Build.cs', 'Content/Map.umap', 'Content/Mesh.uasset', 'Content/Intermediate/image.png', 'Config/DefaultGame.ini', 'Build/Android/AndroidManifest.xml', 'Binaries/Required.dll', 'Plugins/Custom/Custom.uplugin', 'Plugins/Custom/Binaries/Required.dll', 'Plugins/Custom/Content/Mesh.uasset', 'dist/source.json']},
])('engine-specific ignores keep source and necessary resources: $engine', async ({engine, ignored, retained}) => {
  const root = await repositoryFixture()
  for (const path of [...ignored, ...retained]) {
    await mkdir(join(root, path, '..'), {recursive:true})
    await writeFile(join(root, path), 'fixture')
  }
  await initializeProjectRepository(root, {engine})
  await gitAt(root, 'add', '-A')
  const tracked = (await gitAt(root, 'ls-files')).split('\n')
  for (const path of ignored) expect(tracked).not.toContain(path)
  for (const path of retained) expect(tracked).toContain(path)
})

test('engine changes replace owned blocks without changing custom rules or their overrides', async () => {
  const root = await repositoryFixture()
  const custom = '# Project rules\r\ncustom-cache/\r\n!/dist/\r\n!/Library/'
  await writeFile(join(root, '.gitignore'), '\uFEFF' + custom)
  await mkdir(join(root, 'dist'))
  await writeFile(join(root, 'dist/needed.json'), '{}')
  await initializeProjectRepository(root, {engine:'React'})
  expect(await gitAt(root, 'ls-files', '--others', '--exclude-standard')).toContain('dist/needed.json')
  await initializeProjectRepository(root, {engine:'Unity'})
  const text = await readFile(join(root, '.gitignore'), 'utf8')
  expect(text).toStartWith('\uFEFF# BEGIN BGS managed ignores\n')
  expect(text).toEndWith(custom)
  expect(text).toContain('# Engine: Unity')
  expect(text).not.toContain('# Engine: React')
  expect(text).not.toContain('\n/dist/\n')
  expect(text).not.toContain('*.tsbuildinfo')
  const exclude = await readFile(join(root, '.git/info/exclude'), 'utf8')
  expect(exclude).not.toContain('# Engine:')
  expect(exclude).not.toContain('\n/dist/\n')
  await mkdir(join(root, 'Library'))
  await writeFile(join(root, 'Library/needed.json'), '{}')
  expect(await gitAt(root, 'ls-files', '--others', '--exclude-standard')).toContain('Library/needed.json')
  const {stat} = await import('node:fs/promises')
  const before = await stat(join(root, '.gitignore'))
  await initializeProjectRepository(root, {engine:'Unity'})
  expect(await readFile(join(root, '.gitignore'), 'utf8')).toBe(text)
  expect((await stat(join(root, '.gitignore'))).mtimeMs).toBe(before.mtimeMs)
})

test.each([undefined, 'Unknown', '__proto__'])('missing or unsupported engine only gets common rules: %s', async engine => {
  const root = await repositoryFixture()
  await initializeProjectRepository(root, {engine})
  expect(await gitAt(root, 'check-ignore', '--', '.beegame/chat/project-events.jsonl')).toBe('.beegame/chat/project-events.jsonl')
  const ignored = (await readFile(join(root, '.gitignore'), 'utf8')).split('\n')
  for (const rule of ['/dist/', '/[Ll]ibrary/', '/.godot/', '/Intermediate/', '*.tsbuildinfo', '/logs/'])
    expect(ignored).not.toContain(rule)
})

test('linked .gitignore is rejected without changing its target', async () => {
  const root = await repositoryFixture(), outside = await repositoryFixture()
  await writeFile(join(outside, 'ignore'), 'outside custom rules')
  await symlink(join(outside, 'ignore'), join(root, '.gitignore'))
  await expect(initializeProjectRepository(root, {engine:'Unity'})).rejects.toThrow()
  expect(await readFile(join(outside, 'ignore'), 'utf8')).toBe('outside custom rules')
})

test('the exact old BGS template is migrated without keeping stale Web exclusions', async () => {
  const root = await repositoryFixture()
  const legacy = `# BGS: runtime records, dependencies and generated output
/.beegame/chat/
/.beegame/tmp/
/.beegame/artifacts/
/.runtime/
/logs/
node_modules/
/dist/
.vite/
.cache/
*.tsbuildinfo
.DS_Store
.env
.env.*
!.env.example
!.env.sample
!.env.template
`
  const custom = '# Preserve this rule\ncustom-cache/\n'
  await gitAt(root, 'init', '--template=')
  await mkdir(join(root, '.git/info'))
  await writeFile(join(root, '.gitignore'), legacy + custom)
  await writeFile(join(root, '.git/info/exclude'), legacy + '# Local rule\nprivate-cache/')
  await initializeProjectRepository(root, {engine:'Godot'})
  for (const path of ['.gitignore', '.git/info/exclude']) {
    const text = await readFile(join(root, path), 'utf8')
    expect(text).not.toContain('# BGS: runtime records')
    expect(text).not.toContain('\n/dist/\n')
    expect(text).not.toContain('\n/logs/\n')
    if (path === '.gitignore') expect(text).toContain('/.godot/')
    else expect(text).not.toContain('# Engine:')
  }
  expect(await readFile(join(root, '.gitignore'), 'utf8')).toEndWith(custom)
  expect(await readFile(join(root, '.git/info/exclude'), 'utf8')).toEndWith('# Local rule\nprivate-cache/')
})


test('worktrees do not share engine exclusions through the common Git directory', async () => {
  const root = await repositoryFixture()
  await initializeProjectRepository(root, {engine:'Unity'})
  await writeFile(join(root, 'source.txt'), 'fixture')
  await gitAt(root, 'add', 'source.txt')
  await gitAt(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgSign=false', 'commit', '-m', 'Fixture')
  const worktree = join(await repositoryFixture(), 'godot')
  await gitAt(root, 'worktree', 'add', '-b', 'godot', worktree)
  await initializeProjectRepository(worktree, {engine:'Godot'})
  await initializeProjectRepository(root, {engine:'Unity'})
  for (const path of ['Library/source.gd', 'dist/resource.pck']) {
    await mkdir(join(worktree, path, '..'), {recursive:true})
    await writeFile(join(worktree, path), 'fixture')
  }
  const visible = (await gitAt(worktree, 'ls-files', '--others', '--exclude-standard')).split('\n')
  expect(visible).toContain('Library/source.gd')
  expect(visible).toContain('dist/resource.pck')
  expect(await gitAt(root, 'check-ignore', '--', 'Library/cache')).toBe('Library/cache')
  expect(await gitAt(worktree, 'check-ignore', '--', '.godot/cache')).toBe('.godot/cache')
})
