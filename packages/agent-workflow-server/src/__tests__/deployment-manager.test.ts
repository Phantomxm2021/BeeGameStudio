import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BeeGameDeploymentManager,
  createSupabaseStorageDeploymentPublisher,
  type BeeGameDeploymentRunner,
} from '../beegame/deployment-manager'
import { recordNativeAcceptanceReportForTest } from '../beegame/native-acceptance-evidence'
import { recordNativeDocumentReviewForTest } from '../beegame/native-document-review-evidence'
import { recordNativeImplementationAuditReportForTest } from '../beegame/native-implementation-audit-evidence'

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
    let buildEnv: Record<string, string> | undefined
    const originalSecret = process.env.BEEGAME_SKILLS_SERVICE_TOKEN
    process.env.BEEGAME_SKILLS_SERVICE_TOKEN = 'must-not-reach-project-build'
    const runner: BeeGameDeploymentRunner = async (command, options) => {
      commands.push(command)
      buildEnv = options.env
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
    }).finally(() => {
      if (originalSecret === undefined) delete process.env.BEEGAME_SKILLS_SERVICE_TOKEN
      else process.env.BEEGAME_SKILLS_SERVICE_TOKEN = originalSecret
    })

    expect(deployment.status).toBe('succeeded')
    expect(deployment.url).toMatch(/^http:\/\/127\.0\.0\.1:3040\/deployments\/deploy_/)
    expect(deployment.buildCommand).toBe('npm run build -- --base=./')
    expect(commands).toEqual([['npm', 'run', 'build', '--', '--base=./']])
    expect(buildEnv?.BEEGAME_DEPLOYMENT).toBe('1')
    expect(buildEnv?.BEEGAME_SKILLS_SERVICE_TOKEN).toBeUndefined()
    expect(await readFile(join(deployment.artifactPath || '', 'index.html'), 'utf8'))
      .toContain('input instanceof Request')
  })

  test('does not append Vite base flags to non-Vite build scripts', async () => {
    const commands: string[][] = []
    const runner: BeeGameDeploymentRunner = async (command, options) => {
      commands.push(command)
      await mkdir(join(options.cwd, 'dist'), { recursive: true })
      await writeFile(join(options.cwd, 'dist', 'index.html'), '<h1>Static</h1>')
      return { exitCode: 0, stdout: 'built', stderr: '' }
    }
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({ scripts: { build: 'node build.js' } }),
    )

    const manager = new BeeGameDeploymentManager({
      dataRoot: root,
      runner,
      publicBaseUrl: 'http://127.0.0.1:3040',
    })
    const deployment = await manager.deploy({
      sessionId: 'beegame_static',
      projectId: 'project_static',
      workspacePath: workspace,
    })

    expect(deployment.status).toBe('succeeded')
    expect(deployment.buildCommand).toBe('npm run build')
    expect(commands).toEqual([['npm', 'run', 'build']])
  })

  test('returns 404 semantics for a missing static asset instead of SPA HTML', async () => {
    const runner: BeeGameDeploymentRunner = async (_command, options) => {
      await mkdir(join(options.cwd, 'dist'), { recursive: true })
      await writeFile(join(options.cwd, 'dist', 'index.html'), '<main>Playable</main>')
      return { exitCode: 0, stdout: 'built', stderr: '' }
    }
    await writeFile(join(workspace, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' } }))
    const manager = new BeeGameDeploymentManager({ dataRoot: root, runner })
    const deployment = await manager.deploy({ sessionId: 'beegame_static_404', workspacePath: workspace })

    expect(await manager.readPublicFile(`/deployments/${deployment.id}/assets/missing.glb`)).toBeUndefined()
    expect(await manager.readPublicFile(`/deployments/${deployment.id}/game-route`)).toEqual(
      expect.objectContaining({ contentType: 'text/html; charset=utf-8' }),
    )
  })

  test('publishes static output through a configured remote publisher', async () => {
    const commands: string[][] = []
    const publishedFiles: Array<{ path: string; content: string }> = []
    const runner: BeeGameDeploymentRunner = async (command, options) => {
      commands.push(command)
      await mkdir(join(options.cwd, 'dist', 'assets'), { recursive: true })
      await writeFile(join(options.cwd, 'dist', 'index.html'), '<main>Remote game</main>')
      await writeFile(join(options.cwd, 'dist', 'assets', 'game.js'), 'console.log("play")')
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
      publisher: {
        publishStaticDirectory: async input => {
          for (const file of input.files) {
            publishedFiles.push({
              path: file.path,
              content: await file.text(),
            })
          }
          return {
            url: `https://cdn.example.com/games/${input.deploymentId}/`,
            artifactPath: `remote://${input.deploymentId}`,
            message: 'Remote deployment published',
          }
        },
      },
    })
    const deployment = await manager.deploy({
      sessionId: 'beegame_remote',
      projectId: 'project_remote',
      workspacePath: workspace,
    })

    expect(deployment.status).toBe('succeeded')
    expect(deployment.url).toBe('https://cdn.example.com/games/' + deployment.id + '/')
    expect(deployment.artifactPath).toBe(`remote://${deployment.id}`)
    expect(deployment.message).toBe('Remote deployment published')
    expect(commands).toEqual([['npm', 'run', 'build', '--', '--base=./']])
    expect(publishedFiles).toEqual([
      { path: 'assets/game.js', content: 'console.log("play")' },
      { path: 'index.html', content: expect.stringContaining('data-beegame-deployment-asset-base') },
    ])
  })

  test('publishes static output to Supabase Storage with the user token', async () => {
    const uploads: Array<{
      url: string
      authorization: string | null
      apikey: string | null
      contentType: string | null
      body: string
    }> = []
    const runner: BeeGameDeploymentRunner = async (_command, options) => {
      await mkdir(join(options.cwd, 'dist', 'assets'), { recursive: true })
      await writeFile(join(options.cwd, 'dist', 'index.html'), '<main>Storage game</main>')
      await writeFile(join(options.cwd, 'dist', 'assets', 'game.js'), 'console.log("storage")')
      return { exitCode: 0, stdout: 'built', stderr: '' }
    }
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({ scripts: { build: 'vite build' } }),
    )

    const manager = new BeeGameDeploymentManager({
      dataRoot: root,
      runner,
      publisher: createSupabaseStorageDeploymentPublisher({
        supabaseUrl: 'https://project.supabase.co',
        anonKey: 'anon-key',
        bucket: 'beegame-deployments',
        publicBaseUrl: 'https://games.example.com',
        fetch: (async (input, init) => {
          uploads.push({
            url: String(input),
            authorization: init?.headers instanceof Headers
              ? init.headers.get('authorization')
              : (init?.headers as Record<string, string>).authorization,
            apikey: init?.headers instanceof Headers
              ? init.headers.get('apikey')
              : (init?.headers as Record<string, string>).apikey,
            contentType: init?.headers instanceof Headers
              ? init.headers.get('content-type')
              : (init?.headers as Record<string, string>)['content-type'],
            body: await new Response(init?.body as BodyInit).text(),
          })
          return new Response('{}', { status: 200 })
        }) as typeof fetch,
      }),
    })
    const deployment = await manager.deploy({
      sessionId: 'beegame_storage',
      userId: 'user-storage',
      projectId: 'project_storage',
      workspacePath: workspace,
      authToken: 'user-jwt',
    })

    expect(deployment.status).toBe('succeeded')
    expect(deployment.url).toBe(`https://games.example.com/deployments/user-storage/${deployment.id}/index.html`)
    expect(deployment.artifactPath).toBe(`supabase://beegame-deployments/deployments/user-storage/${deployment.id}`)
    expect(uploads.map(upload => upload.url)).toEqual([
      `https://project.supabase.co/storage/v1/object/beegame-deployments/deployments/user-storage/${deployment.id}/assets/game.js`,
      `https://project.supabase.co/storage/v1/object/beegame-deployments/deployments/user-storage/${deployment.id}/index.html`,
    ])
    expect(uploads).toEqual([
      expect.objectContaining({
        authorization: 'Bearer user-jwt',
        apikey: 'anon-key',
        contentType: 'text/javascript; charset=utf-8',
        body: 'console.log("storage")',
      }),
      expect.objectContaining({
        authorization: 'Bearer user-jwt',
        apikey: 'anon-key',
        contentType: 'text/html; charset=utf-8',
        body: expect.stringContaining('data-beegame-deployment-asset-base'),
      }),
    ])
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

  test('requires passed native acceptance when the production delivery gate is enabled', async () => {
    let builds = 0
    const manager = new BeeGameDeploymentManager({
      dataRoot: root,
      requireAcceptedDelivery: true,
      runner: async (_command, options) => {
        builds += 1
        await mkdir(join(options.cwd, 'dist'), { recursive: true })
        await writeFile(join(options.cwd, 'dist', 'index.html'), '<main>Accepted</main>')
        return { exitCode: 0, stdout: 'built', stderr: '' }
      },
    })
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({ scripts: { build: 'vite build' } }),
    )

    const rejected = await manager.deploy({
      sessionId: 'delivery-gated-session',
      workspacePath: workspace,
    })
    expect(rejected.status).toBe('failed')
    expect(rejected.message).toContain('native Document Reviewer result')
    expect(builds).toBe(0)

    await mkdir(join(workspace, 'docs', 'acceptance'), { recursive: true })
    await mkdir(join(workspace, 'src'), { recursive: true })
    await mkdir(join(workspace, 'tests'), { recursive: true })
    await writeFile(join(workspace, 'src', 'entry.ts'), 'export const ready = true\n')
    await writeFile(join(workspace, 'tests', 'acceptance.test.ts'), 'export const observed = true\n')
    for (const name of ['GDD.md', 'TECHNICAL_DESIGN.md', 'ART_DIRECTION.md', 'UI_UX_SPEC.md', 'AUDIO_DESIGN.md', 'ASSET_PLAN.md']) {
      await writeFile(join(workspace, 'docs', name), `# ${name}\n`)
    }
    await writeFile(
      join(workspace, 'docs', 'acceptance', 'gameplay-checklist.md'),
      [
        '- [x] [requirement:requirement-primary] Primary behavior',
        '- [x] [player-path:path-primary] Primary playable path',
        '',
      ].join('\n'),
    )
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 5,
      project_target: {
        platform: 'selected-target',
        runtime: 'project-native',
        asset_format_capabilities: ['png'],
        resource_library_usage: 'optional',
      },
      requirements: [],
      imports: [],
      compositions: [],
    }))
    const report = {
      validatorId: 'beegame-acceptance-validator',
      status: 'passed',
      summary: 'Observed acceptance passed.',
      validatedChecklistIds: ['requirement:requirement-primary', 'player-path:path-primary'],
      evidence: passingNativeAcceptanceEvidence(),
      findings: [],
    }
    await writeFile(
      join(workspace, 'docs', 'acceptance', 'validation-report.json'),
      JSON.stringify(report),
    )
    recordReadyDocumentReview(root, 'delivery-gated-session', workspace)
    recordPassedImplementationAudit(root, 'delivery-gated-session', workspace)
    recordNativeAcceptanceReportForTest({
      dataRoot: root,
      sessionId: 'delivery-gated-session',
      workspacePath: workspace,
      report,
    })

    const accepted = await manager.deploy({
      sessionId: 'delivery-gated-session',
      workspacePath: workspace,
    })
    expect(accepted.status).toBe('succeeded')
    expect(builds).toBe(1)

    const mutatingManager = new BeeGameDeploymentManager({
      dataRoot: root,
      requireAcceptedDelivery: true,
      runner: async (_command, options) => {
        await mkdir(join(options.cwd, 'dist'), { recursive: true })
        await writeFile(join(options.cwd, 'dist', 'index.html'), '<main>Changed</main>')
        await writeFile(join(options.cwd, 'src', 'entry.ts'), 'export const ready = false\n')
        return { exitCode: 0, stdout: 'built and changed source', stderr: '' }
      },
    })
    const changedDuringBuild = await mutatingManager.deploy({
      sessionId: 'delivery-gated-session',
      workspacePath: workspace,
    })
    expect(changedDuringBuild.status).toBe('failed')
    expect(changedDuringBuild.message).toContain('Project source changed after acceptance')
  })

  function passingNativeAcceptanceEvidence() {
    return [
      { kind: 'document', source: 'docs/', result: 'passed', detail: 'Approved documents were reviewed.' },
      { kind: 'build', source: 'project build', result: 'passed', detail: 'The native build passed.' },
      { kind: 'test', source: 'tests/acceptance.test.ts', result: 'passed', detail: 'Assertions passed.' },
      { kind: 'runtime', source: 'path-primary', result: 'passed', detail: 'The player path was observed.' },
      { kind: 'asset', source: 'project assets', result: 'passed', detail: 'Runtime asset references were verified.' },
      { kind: 'skill', source: 'beegame-game-acceptance', result: 'passed', detail: 'The acceptance skill was used.' },
    ]
  }

  test('rejects malformed self-identifying files in the built artifact', async () => {
    const manager = new BeeGameDeploymentManager({
      dataRoot: root,
      runner: async (_command, options) => {
        await mkdir(join(options.cwd, 'dist', 'assets'), { recursive: true })
        await writeFile(join(options.cwd, 'dist', 'index.html'), '<main>Invalid asset</main>')
        await writeFile(join(options.cwd, 'dist', 'assets', 'model.glb'), '<!doctype html>')
        return { exitCode: 0, stdout: 'built', stderr: '' }
      },
    })
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({ scripts: { build: 'vite build' } }),
    )

    const deployment = await manager.deploy({
      sessionId: 'invalid-artifact-session',
      workspacePath: workspace,
    })

    expect(deployment.status).toBe('failed')
    expect(deployment.message).toContain('invalid GLB')
  })

  test('rejects symbolic links in deployment output', async () => {
    const outside = join(root, 'private.txt')
    await writeFile(outside, 'private')
    const manager = new BeeGameDeploymentManager({
      dataRoot: root,
      runner: async (_command, options) => {
        await mkdir(join(options.cwd, 'dist'), { recursive: true })
        await writeFile(join(options.cwd, 'dist', 'index.html'), '<main>Symlink</main>')
        await symlink(outside, join(options.cwd, 'dist', 'private.txt'))
        return { exitCode: 0, stdout: 'built', stderr: '' }
      },
    })
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({ scripts: { build: 'vite build' } }),
    )

    const deployment = await manager.deploy({
      sessionId: 'symlink-artifact-session',
      workspacePath: workspace,
    })

    expect(deployment.status).toBe('failed')
    expect(deployment.message).toContain('symbolic link')
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

function recordReadyDocumentReview(
  dataRoot: string,
  sessionId: string,
  workspacePath: string,
): void {
  recordNativeDocumentReviewForTest({
    dataRoot,
    sessionId,
    workspacePath,
    report: {
      reviewerId: 'beegame-document-reviewer',
      verdict: 'READY',
      summary: 'The current documents are implementation-ready.',
      confirmedResourceLibraryUsage: 'optional',
      findings: [],
    },
  })
}

function recordPassedImplementationAudit(
  dataRoot: string,
  sessionId: string,
  workspacePath: string,
): void {
  recordNativeImplementationAuditReportForTest({
    dataRoot,
    sessionId,
    workspacePath,
    report: {
      auditorId: 'beegame-implementation-auditor',
      status: 'passed',
      summary: 'The implementation matches the approved project contract.',
      auditedChecklistIds: ['requirement:requirement-primary', 'player-path:path-primary'],
      evidence: [{ source: 'src/entry.ts', detail: 'The documented implementation exists.' }],
      findings: [],
    },
  })
}
