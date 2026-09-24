import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentWorkflowApp } from '../app'
import { createRunStore } from '../beegame/delivery-workflow/run-store'
import { computeWorkspaceRevision, computeResourceRevision } from '../beegame/delivery-workflow/revision'
import { readRuntimeAcceptance, runtimeAcceptancePath } from '../beegame/delivery-workflow/runtime-acceptance'
import { beginProjectDelivery, captureProjectDeliveryAcceptance, PROJECT_DELIVERY_REPORT_PATH } from '../beegame/project-delivery'
import { createTestDeliveryRun } from './delivery-workflow-test-helpers'

test('project publishing is gated, returns 202, and exposes progress without a model or real upload', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-publish-route-')))
  const owner = 'publish-owner', project = 'publish-project'
  const projects = join(root, 'projects'), workspace = join(projects, 'users', owner, project)
  await mkdir(join(workspace, '.beegame/workflow/evidence'), { recursive: true })
  await mkdir(join(workspace, 'dist'))
  await writeFile(join(workspace, 'package.json'), JSON.stringify({ scripts: { build: 'node build.js' } }))
  await writeFile(join(workspace, 'dist/index.html'), '<main>Published</main>')
  let release!: () => void, builds = 0, uploads = 0
  const gate = new Promise<void>(resolve => { release = resolve })
  const cleanups: Array<() => void> = []
  const app = createAgentWorkflowApp({ currentUser: { id: owner, role: 'owner' },
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: projects,
    modelConfigStore: false, skillsConfig: false, registerCleanup: cleanup => cleanups.push(cleanup),
    sessionRunner: { async start() { throw new Error('Publishing must not start an Agent') } },
    deploymentRunner: async () => { builds++; await gate; return { exitCode: 0, stdout: 'Built', stderr: '' } },
    deploymentPublisher: { async publishStaticDirectory() { uploads++; return { url: 'https://games.test/version/index.html' } } },
  })
  const post = (url: string, body: unknown = {}) => app.request(url, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const staticSite = join(root, 'dashboard', 'deployments', 'cached-version', 'site')
    await mkdir(staticSite, { recursive: true })
    await writeFile(join(staticSite, 'index.html'), '<main>Cached version</main>')
    const staticResponse = await app.request('/deployments/cached-version/')
    expect(staticResponse.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')

    expect((await post('/api/projects', { id: project, name: 'Publish test', root_path: workspace, created_at: Date.now() })).status).toBe(200)
    await post('/api/model-configs', { name: 'Mock', provider: 'openai-compatible', apiKey: 'fake', models: { balanced: 'fake' }, isDefault: true })
    await post(`/api/projects/${project}/session/ensure`, { language: 'zh' })
    expect((await (await app.request(`/api/projects/${project}/deployment-readiness`)).json()).allowed).toBe(false)
    expect((await post(`/api/projects/${project}/deployments`)).status).toBe(409)
    expect(builds).toBe(0)
    const report = { status: 'passed', summary: 'Fixture observations', environment: 'Test preview',
      verification: { target: 'deployment', knownIssues: [], unverified: [] },
      artifactPaths: ['dist/index.html'], evidencePaths: ['.beegame/workflow/evidence/browser.txt'] }
    await writeFile(join(workspace, report.evidencePaths[0]!), 'Observed')
    await writeFile(join(workspace, runtimeAcceptancePath('test')), JSON.stringify(report))
    const base = createTestDeliveryRun({ ownerId: owner, projectId: project, documentRevision: 'a'.repeat(64) })
    const revision = await computeWorkspaceRevision(workspace)
    const resource = await computeResourceRevision(workspace, base.revision.document), content = 'c'.repeat(64)
    const accepted = '.beegame/workflow/evidence/accepted.json'
    await writeFile(join(workspace, accepted), JSON.stringify({ revision, status: 'passed', runtimeVerification: 'agent-reported',
      runtimeReports: [await readRuntimeAcceptance(workspace, 'test')] }))
    const observedAt = new Date().toISOString()
    await createRunStore(workspace, owner).save({ ...base, status: 'completed', phase: 'DELIVERY',
      revision: { ...base.revision, workspace: revision, implementation: revision, resource, content },
      gameContentReceipt: { schemaVersion: 'game-content-ready.v2', documentRevision: base.revision.document,
        assetManifestRevision: resource, contentRevision: content, indexPath: 'content/index.json', contentIds: ['scene'] },
      evidence: { acceptance: { path: accepted, kind: 'acceptance', status: 'passed', revision, observedAt },
        gameContent: { path: 'content/index.json', kind: 'game_content', status: 'passed', revision: content, observedAt },
        resourcePreparation: { path: 'assets/asset-manifest.json', kind: 'resource_preparation', status: 'passed', revision: resource, observedAt } } })
    // A legacy workflow snapshot is historical only. It must not authorize publication.
    expect(await (await app.request(`/api/projects/${project}/deployment-readiness`)).json()).toMatchObject({ allowed: false })
    expect((await post(`/api/projects/${project}/deployments`)).status).toBe(409)
    expect(builds).toBe(0)

    // The replacement project-delivery acceptance remains the sole publish authority.
    await beginProjectDelivery(workspace, join(root, 'dashboard'), 'Publish test game')
    await mkdir(join(workspace, '.beegame/delivery'), { recursive: true })
    await writeFile(join(workspace, '.beegame/delivery/browser.txt'), 'Current build verified in browser')
    const projectReport = { scope: 'delivery', status: 'passed', summary: 'Current build verified',
      environment: 'Test preview', evidencePaths: ['.beegame/delivery/browser.txt'],
      artifactPaths: ['dist/index.html'],
      verification: { target: 'deployment', knownIssues: [], unverified: [] } }
    await writeFile(join(workspace, PROJECT_DELIVERY_REPORT_PATH), JSON.stringify(projectReport))
    await captureProjectDeliveryAcceptance(workspace, join(root, 'dashboard'), Date.now() - 5000)
    expect(await (await app.request(`/api/projects/${project}/deployment-readiness`)).json()).toMatchObject({ allowed: true, destination: 'remote' })
    const response = await post(`/api/projects/${project}/deployments`)
    expect(response.status).toBe(202)
    const queued = await response.json()
    expect(queued.status).toBe('queued')
    expect((await (await post(`/api/projects/${project}/deployments`)).json()).id).toBe(queued.id)
    expect(uploads).toBe(0)
    release()
    let final: any[] = []
    for (let index = 0; index < 100; index++) {
      final = await (await app.request(`/api/projects/${project}/deployments`)).json()
      if (final[0]?.status === 'succeeded') break
      await Bun.sleep(10)
    }
    expect(final[0]).toMatchObject({ id: queued.id, status: 'succeeded', url: 'https://games.test/version/index.html' })
    expect(builds).toBe(1)
    expect(uploads).toBe(1)
    expect((await app.request('/api/projects/unknown/deployment-readiness')).status).toBe(404)
  } finally { release(); for (const cleanup of cleanups) await cleanup(); await rm(root, { recursive: true, force: true }) }
})
