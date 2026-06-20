import { describe, test, expect, beforeEach } from 'bun:test'
import { Hono } from 'hono'
import { resetDashboardProjects } from '../services/dashboard-projects'
import webDashboardProjects from '../routes/web/dashboard-projects'

function resJson(res: Response) {
  return res.json() as Promise<any>
}

function createApp() {
  const app = new Hono()
  app.route('/web', webDashboardProjects)
  return app
}

describe('dashboard project Web routes', () => {
  let app: Hono

  beforeEach(() => {
    resetDashboardProjects()
    app = createApp()
  })

  test('POST /web/projects creates a game project for the browser UUID', async () => {
    const res = await app.request('/web/projects?uuid=browser-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Orbit Garden',
        idea: 'A cozy orbital farming game',
        targetPlatform: 'web',
        workspacePath: '/tmp/orbit-garden',
      }),
    })

    expect(res.status).toBe(200)
    const body = await resJson(res)
    expect(body.id).toMatch(/^game_/)
    expect(body.ownerId).toBe('browser-user')
    expect(body.status).toBe('draft')
  })

  test('GET /web/projects lists owned projects only', async () => {
    await app.request('/web/projects?uuid=browser-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Orbit Garden',
        idea: 'A cozy orbital farming game',
        targetPlatform: 'web',
        workspacePath: '/tmp/orbit-garden',
      }),
    })
    await app.request('/web/projects?uuid=other-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Other',
        idea: 'Different game',
        targetPlatform: 'web',
        workspacePath: '/tmp/other',
      }),
    })

    const res = await app.request('/web/projects?uuid=browser-user')

    expect(res.status).toBe(200)
    const body = await resJson(res)
    expect(body.map((project: any) => project.name)).toEqual(['Orbit Garden'])
  })

  test('POST /web/runs creates a run for an owned project', async () => {
    const projectRes = await app.request('/web/projects?uuid=browser-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Orbit Garden',
        idea: 'A cozy orbital farming game',
        targetPlatform: 'web',
        workspacePath: '/tmp/orbit-garden',
      }),
    })
    const project = await resJson(projectRes)

    const runRes = await app.request('/web/runs?uuid=browser-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        modelConfigId: 'llm_default',
      }),
    })

    expect(runRes.status).toBe(200)
    const run = await resJson(runRes)
    expect(run.id).toMatch(/^run_/)
    expect(run.projectId).toBe(project.id)
    expect(run.phases).toHaveLength(8)
  })

  test('GET /web/runs/:id returns run with artifacts', async () => {
    const projectRes = await app.request('/web/projects?uuid=browser-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Orbit Garden',
        idea: 'A cozy orbital farming game',
        targetPlatform: 'web',
        workspacePath: '/tmp/orbit-garden',
      }),
    })
    const project = await resJson(projectRes)
    const runRes = await app.request('/web/runs?uuid=browser-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        modelConfigId: 'llm_default',
      }),
    })
    const run = await resJson(runRes)
    await app.request('/web/artifacts?uuid=browser-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        runId: run.id,
        kind: 'gdd',
        title: 'GDD',
        path: '/tmp/orbit-garden/docs/GDD.md',
        mimeType: 'text/markdown',
      }),
    })

    const detailRes = await app.request(`/web/runs/${run.id}?uuid=browser-user`)

    expect(detailRes.status).toBe(200)
    const detail = await resJson(detailRes)
    expect(detail.run.id).toBe(run.id)
    expect(detail.project.id).toBe(project.id)
    expect(detail.artifacts.map((artifact: any) => artifact.title)).toEqual([
      'GDD',
    ])
  })

  test('POST /web/artifacts rejects paths outside the owned project workspace', async () => {
    const projectRes = await app.request('/web/projects?uuid=browser-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Orbit Garden',
        idea: 'A cozy orbital farming game',
        targetPlatform: 'web',
        workspacePath: '/tmp/orbit-garden',
      }),
    })
    const project = await resJson(projectRes)
    const runRes = await app.request('/web/runs?uuid=browser-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        modelConfigId: 'llm_default',
      }),
    })
    const run = await resJson(runRes)

    const artifactRes = await app.request('/web/artifacts?uuid=browser-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        runId: run.id,
        kind: 'source_file',
        title: 'Escaped',
        path: '/tmp/other-project/src/main.ts',
      }),
    })

    expect(artifactRes.status).toBe(400)
    const body = await resJson(artifactRes)
    expect(body.error.message).toBe(
      'Artifact path must stay inside the project workspace',
    )
  })
})
