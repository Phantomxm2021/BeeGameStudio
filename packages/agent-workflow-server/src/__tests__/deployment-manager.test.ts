import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BeeGameDeploymentManager,
  type BeeGameDeploymentRunner,
} from '../beegame/deployment-manager'

describe('BeeGameDeploymentManager', () => {
  let root: string
  let workspace: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-deployments-'))
    workspace = join(root, 'projects', 'sample-game')
    await mkdir(workspace, { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('builds a package project and publishes static output', async () => {
    const commands: string[][] = []
    const runner: BeeGameDeploymentRunner = async (command, options) => {
      commands.push(command)
      await mkdir(join(options.cwd, 'dist'), { recursive: true })
      await writeFile(join(options.cwd, 'dist', 'index.html'), '<h1>Playable</h1>')
      return { exitCode: 0, stdout: 'built', stderr: '' }
    }
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({ scripts: { build: 'vite build' } }),
    )

    const manager = new BeeGameDeploymentManager({
      dataRoot: root,
      runner,
      publicBaseUrl: 'http://127.0.0.1:3040',
    })
    const deployment = await manager.deploy({
      sessionId: 'beegame_test',
      projectId: 'project_test',
      workspacePath: workspace,
    })

    expect(deployment.status).toBe('succeeded')
    expect(deployment.url).toMatch(/^http:\/\/127\.0\.0\.1:3040\/deployments\/deploy_/)
    expect(deployment.buildCommand).toBe('npm run build')
    expect(commands).toEqual([['npm', 'run', 'build']])
    expect(await readFile(join(deployment.artifactPath || '', 'index.html'), 'utf8'))
      .toBe('<h1>Playable</h1>')
  })

  test('fails when the project has no build script', async () => {
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({ scripts: { dev: 'vite --host 0.0.0.0' } }),
    )
    const manager = new BeeGameDeploymentManager({
      dataRoot: root,
      runner: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      publicBaseUrl: 'http://127.0.0.1:3040',
    })

    const deployment = await manager.deploy({
      sessionId: 'beegame_test',
      projectId: 'project_test',
      workspacePath: workspace,
    })

    expect(deployment.status).toBe('failed')
    expect(deployment.message).toContain('build script')
    expect(deployment.url).toBe('')
  })

  test('rejects static output outside the workspace', async () => {
    const outside = join(root, 'outside-dist')
    const manager = new BeeGameDeploymentManager({
      dataRoot: root,
      runner: async () => {
        await mkdir(outside, { recursive: true })
        await writeFile(join(outside, 'index.html'), '<h1>Outside</h1>')
        return { exitCode: 0, stdout: 'built', stderr: '' }
      },
      outputCandidates: ['../../outside-dist'],
      publicBaseUrl: 'http://127.0.0.1:3040',
    })
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({ scripts: { build: 'vite build' } }),
    )

    const deployment = await manager.deploy({
      sessionId: 'beegame_test',
      projectId: 'project_test',
      workspacePath: workspace,
    })

    expect(deployment.status).toBe('failed')
    expect(deployment.message).toContain('inside the project workspace')
    expect(deployment.url).toBe('')
  })
})
