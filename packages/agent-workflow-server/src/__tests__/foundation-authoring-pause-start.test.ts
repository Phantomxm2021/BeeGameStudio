import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentWorkflowApp } from '../app'
import type { BeeGameSessionRunner } from '../beegame/session-manager'

const originalPauseProject =
  process.env.BEEGAME_FOUNDATION_AUTHORING_PAUSE_PROJECT_ID
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true })),
  )
  if (originalPauseProject === undefined)
    delete process.env.BEEGAME_FOUNDATION_AUTHORING_PAUSE_PROJECT_ID
  else
    process.env.BEEGAME_FOUNDATION_AUTHORING_PAUSE_PROJECT_ID =
      originalPauseProject
})

type ObservedDispatch = {
  cwd: string
  snapshot: Record<string, unknown>
  events: Array<Record<string, unknown>>
  eventTypes: string[]
}

async function readObservedDispatch(cwd: string): Promise<ObservedDispatch> {
  const workflowDirectory = join(cwd, '.beegame', 'workflow')
  const snapshot = JSON.parse(
    await readFile(join(workflowDirectory, 'run.json'), 'utf8'),
  ) as Record<string, unknown>
  const events = (await readFile(join(workflowDirectory, 'events.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as Record<string, unknown>)
  return {
    cwd,
    snapshot,
    events,
    eventTypes: events.map(event => event.type as string),
  }
}

describe('Foundation authoring pause request at workflow creation', () => {
  test('targets only a new run, persists before its first dispatch, and does not retrofit an existing run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beegame-foundation-pause-'))
    temporaryDirectories.push(root)
    const projectsRoot = join(root, 'projects')
    await mkdir(projectsRoot, { recursive: true })

    const observations: ObservedDispatch[] = []
    const runner: BeeGameSessionRunner = {
      start: async input => {
        observations.push(await readObservedDispatch(input.cwd))
        return {
          submit: async ({ signal }) =>
            await new Promise<void>(resolve => {
              if (signal.aborted) {
                resolve()
                return
              }
              signal.addEventListener('abort', () => resolve(), { once: true })
            }),
          stop: () => undefined,
        }
      },
    }
    const cleanups: Array<() => void | Promise<void>> = []
    const app = createAgentWorkflowApp({
      currentUser: { id: 'pause-owner', role: 'owner' },
      dashboardDataRoot: join(root, 'dashboard'),
      defaultWorkspacePath: projectsRoot,
      modelConfigStore: false,
      skillsConfig: false,
      sessionRunner: runner,
      registerCleanup: cleanup => cleanups.push(cleanup),
    })

    async function bootstrap(projectId: string) {
      const response = await app.request('/api/projects/bootstrap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project: {
            id: projectId,
            name: `Pause fixture ${projectId}`,
            created_at: Date.now(),
          },
          projectName: projectId,
          brief: {
            idea: 'A small test game used only to verify workflow initialization.',
            kind: 'confirmed_build_brief',
            resource_library_usage: 'optional',
            document_language: 'en',
            game_user_visible_language: 'en',
            agent_response_language: 'en',
          },
        }),
      })
      expect(response.status).toBe(202)
      return (await response.json()) as {
        project: { root_path: string }
        runId: string
      }
    }

    try {
      const targetProjectId = 'pause-target-new-project'
      const otherProjectId = 'pause-other-project'
      const modelConfig = await app.request('/api/model-configs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Foundation pause fixture model',
          provider: 'openai-compatible',
          apiKey: 'fixture-api-key',
          models: { balanced: 'fixture-model' },
          isDefault: true,
        }),
      })
      expect(modelConfig.status).toBe(200)
      process.env.BEEGAME_FOUNDATION_AUTHORING_PAUSE_PROJECT_ID =
        targetProjectId

      const target = await bootstrap(targetProjectId)
      expect(observations).toHaveLength(1)
      expect(observations[0]!.snapshot.projectId).toBe(targetProjectId)
      expect(
        Object.hasOwn(observations[0]!.snapshot, 'foundationAuthoringPause'),
      ).toBe(false)
      expect(observations[0]!.eventTypes[0]).toBe('run.created')
      expect(observations[0]!.events[0]!.foundationAuthoringPause).toBe(
        'requested',
      )
      expect(
        observations[0]!.events.filter(
          event => event.type === 'foundation.authoring.pause_changed',
        ),
      ).toHaveLength(0)
      expect(target.runId).toBe(observations[0]!.snapshot.runId as string)

      const other = await bootstrap(otherProjectId)
      expect(observations).toHaveLength(2)
      expect(observations[1]!.snapshot).toMatchObject({
        projectId: otherProjectId,
      })
      expect(
        Object.hasOwn(observations[1]!.snapshot, 'foundationAuthoringPause'),
      ).toBe(false)
      expect(
        observations[1]!.events.filter(
          event =>
            event.type === 'foundation.authoring.pause_changed' ||
            (event.type === 'run.created' &&
              Object.hasOwn(event, 'foundationAuthoringPause')),
        ),
      ).toHaveLength(0)

      const existingBefore = await readFile(
        join(other.project.root_path, '.beegame', 'workflow', 'run.json'),
        'utf8',
      )
      process.env.BEEGAME_FOUNDATION_AUTHORING_PAUSE_PROJECT_ID =
        otherProjectId
      const resume = await app.request(
        `/api/projects/${otherProjectId}/workflow/resume`,
        { method: 'POST' },
      )
      expect(resume.status).toBe(200)
      const existingAfter = await readFile(
        join(other.project.root_path, '.beegame', 'workflow', 'run.json'),
        'utf8',
      )
      expect(existingAfter).toBe(existingBefore)
      expect(
        Object.hasOwn(JSON.parse(existingAfter) as Record<string, unknown>, 'foundationAuthoringPause'),
      ).toBe(false)
      expect(observations).toHaveLength(2)
    } finally {
      await Promise.all(cleanups.map(cleanup => cleanup()))
    }
  })
})
