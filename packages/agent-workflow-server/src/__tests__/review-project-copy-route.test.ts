import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { createAgentWorkflowApp } from '../app'
import type { BeeGameSessionRunner } from '../beegame/session-manager'
import { createRunStore } from '../beegame/delivery-workflow/run-store'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../beegame/delivery-workflow/types'

const roots: string[] = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'beegame-review-copy-route-'))
  roots.push(root)
  const projectsRoot = join(root, 'projects')
  const ownerId = 'review-copy-owner'
  const projectId = 'source-project'
  const sourceWorkspace = join(projectsRoot, 'users', ownerId, projectId)
  for (const [index, path] of CANONICAL_FOUNDATION_DOCUMENTS.entries()) {
    const absolute = join(sourceWorkspace, path)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, `# source ${index}\n`, 'utf8')
  }
  await mkdir(join(sourceWorkspace, '.beegame/workflow'), { recursive: true })
  await writeFile(
    join(sourceWorkspace, '.beegame/workflow/run.json'),
    JSON.stringify({
      schemaVersion: 1,
      legacyField: 'intentionally-unparseable-current-schema',
      confirmedBriefContext: 'The durable confirmed source brief.',
    }),
    'utf8',
  )
  let workflowWorkerStarts = 0
  const runner: BeeGameSessionRunner = {
    start: async input => {
      if (input.workflowWorker) workflowWorkerStarts += 1
      return {
        submit: async ({ signal }) =>
          new Promise<void>(resolve => {
            signal.addEventListener('abort', () => resolve(), { once: true })
          }),
        stop: () => undefined,
      }
    },
  }
  const app = createAgentWorkflowApp({
    currentUser: { id: ownerId, role: 'owner' },
    dashboardDataRoot: join(root, 'dashboard'),
    defaultWorkspacePath: projectsRoot,
    modelConfigStore: false,
    skillsConfig: false,
    sessionRunner: runner,
  })
  const created = await app.request('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: projectId,
      name: 'Source project',
      root_path: sourceWorkspace,
      created_at: Date.now(),
    }),
  })
  expect(created.status).toBe(200)
  const modelConfig = await app.request('/api/model-configs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Review copy model',
      provider: 'openai-compatible',
      apiKey: 'test-api-key',
      models: { balanced: 'test-model' },
      isDefault: true,
    }),
  })
  expect(modelConfig.status).toBe(200)
  return {
    app,
    ownerId,
    projectId,
    sourceWorkspace,
    workflowWorkerStarts: () => workflowWorkerStarts,
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true })))
})

describe('POST /api/projects/:projectId/review-copy', () => {
  test('creates an owned current-schema review project from old snapshot bytes', async () => {
    const {
      app,
      ownerId,
      projectId,
      sourceWorkspace,
      workflowWorkerStarts,
    } = await fixture()

    const response = await app.request(`/api/projects/${projectId}/review-copy`, {
      method: 'POST',
    })

    expect(response.status).toBe(201)
    const payload = (await response.json()) as {
      project: { id: string; name: string; root_path: string }
      runId: string
      phase: string
    }
    expect(payload.project).toMatchObject({
      name: 'Source project Review Copy',
    })
    expect(payload.project.id).not.toBe(projectId)
    expect(payload.project.root_path).not.toBe(sourceWorkspace)
    expect(payload.phase).toBe('DOCUMENT_REVIEW')
    expect(workflowWorkerStarts()).toBe(1)
    const copiedStore = createRunStore(payload.project.root_path, ownerId)
    expect(await copiedStore.load()).toMatchObject({
      runId: payload.runId,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      confirmedBriefContext: 'The durable confirmed source brief.',
      documentReviewState: {
        activeRun: {
          status: 'running',
          reports: expect.arrayContaining([
            expect.objectContaining({ status: 'running' }),
          ]),
        },
      },
    })
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      expect(await readFile(join(payload.project.root_path, path))).toEqual(
        await readFile(join(sourceWorkspace, path)),
      )
    }
  })

  test('rejects snapshots without a durable brief and does not register a copy', async () => {
    const { app, projectId, sourceWorkspace } = await fixture()
    await writeFile(
      join(sourceWorkspace, '.beegame/workflow/run.json'),
      JSON.stringify({ schemaVersion: 1 }),
      'utf8',
    )

    const response = await app.request(`/api/projects/${projectId}/review-copy`, {
      method: 'POST',
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('confirmed brief'),
    })
    const projects = (await (
      await app.request('/api/projects')
    ).json()) as Array<{ id: string }>
    expect(projects.map(project => project.id)).toEqual([projectId])
  })
})
