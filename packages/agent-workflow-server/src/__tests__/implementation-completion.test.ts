import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  implementationCompletionIssue,
  startNextImplementationTask,
} from '../beegame/delivery-workflow/implementation-stage'
import { persistImplementationEvidence } from '../beegame/delivery-workflow/evidence'
import { createInitialDeliveryRun } from '../beegame/delivery-workflow/run-store'
import type { AtomicTask } from '../beegame/delivery-workflow/types'
import type { WorkerTerminalResult } from '../beegame/delivery-workflow/worker-contracts'

describe('implementation completion boundary', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('accepts an unchanged verified artifact and defers only runtime verification', async () => {
    workspace = await createWorkspace()
    const task = activeTask()
    const terminal = implementationTerminal()
    await persistTerminalEvidence(workspace, terminal)

    expect(
      implementationCompletionIssue({
        workspacePath: workspace,
        task,
        terminal,
      }),
    ).toBeUndefined()
  })

  test('rejects deferred deterministic verification', async () => {
    workspace = await createWorkspace()
    const task = activeTask()
    const terminal = implementationTerminal()
    terminal.verificationResults[0]!.status = 'deferred'
    await persistTerminalEvidence(workspace, terminal)

    expect(
      implementationCompletionIssue({
        workspacePath: workspace,
        task,
        terminal,
      }),
    ).toContain('may be deferred only when its kind is runtime')
  })

  test('retries a failed task through the same implementation contract', async () => {
    const initial = createInitialDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    const task: AtomicTask = {
      ...activeTask(),
      status: 'failed',
    }
    const requests: unknown[] = []

    await startNextImplementationTask({
      run: {
        ...initial,
        phase: 'IMPLEMENTATION',
        status: 'running',
        tasks: [task],
      },
      workspacePath: '/workspace',
      revision: initial.revision.workspace,
      dispatcher: {
        dispatch: async request => {
          requests.push(request)
          return request
        },
      },
    })

    expect(requests).toEqual([
      expect.objectContaining({
        allowedPaths: ['src/'],
        contract: expect.objectContaining({
          task: expect.any(Object),
          currentRevision: expect.any(String),
        }),
      }),
    ])
  })

  test('service overwrites stale worker evidence from the terminal authority', async () => {
    workspace = await createWorkspace()
    const terminal = implementationTerminal()
    await writeFile(
      join(workspace, terminal.evidencePath),
      JSON.stringify({ verificationResults: [{ observations: ['stale'] }] }),
    )

    await persistTerminalEvidence(workspace, terminal)

    expect(
      JSON.parse(await readFile(join(workspace, terminal.evidencePath), 'utf8')),
    ).toEqual({
      version: 1,
      workerType: terminal.workerType,
      taskId: terminal.taskId,
      revision: terminal.revision,
      verifiedArtifacts: terminal.verifiedArtifacts,
      verificationResults: terminal.verificationResults,
    })
  })

  async function createWorkspace(): Promise<string> {
    const root = await mkdtemp(
      join(tmpdir(), 'beegame-implementation-completion-'),
    )
    await mkdir(join(root, 'src'), { recursive: true })
    await mkdir(join(root, '.beegame', 'workflow', 'evidence'), {
      recursive: true,
    })
    await writeFile(
      join(root, 'src', 'runtime.ts'),
      'export const ready = true\n',
    )
    return root
  }
})

async function persistTerminalEvidence(
  workspacePath: string,
  terminal: Extract<WorkerTerminalResult, { workerType: 'implementation-worker' }>,
): Promise<void> {
  await persistImplementationEvidence({
    workspacePath,
    evidencePath: terminal.evidencePath,
    taskId: terminal.taskId,
    revision: terminal.revision,
    verifiedArtifacts: terminal.verifiedArtifacts,
    verificationResults: terminal.verificationResults,
  })
}

function activeTask(): AtomicTask {
  return {
    id: 'task-1',
    title: 'Implement one runtime boundary',
    resourceRequirementIds: [],
    checklistIds: ['check-1'],
    dependsOn: [],
    allowedPaths: ['src/'],
    expectedArtifacts: ['src/runtime.ts'],
    verification: [
      {
        kind: 'test',
        commandOrAction: 'run deterministic tests',
        expectedResult: 'tests pass',
      },
      {
        kind: 'runtime',
        commandOrAction: 'exercise the integrated player path',
        expectedResult: 'the player path is observable',
      },
    ],
    status: 'running',
    attempt: 1,
    evidenceRefs: [],
  }
}

function implementationTerminal(): Extract<
  WorkerTerminalResult,
  { workerType: 'implementation-worker' }
> {
  return {
    workerType: 'implementation-worker',
    taskId: 'task-1',
    status: 'completed',
    revision: 'dispatch-revision',
    changedPaths: [],
    verifiedArtifacts: ['src/runtime.ts'],
    verificationResults: [
      {
        verificationIndex: 0,
        status: 'passed',
        observations: ['Deterministic tests exited successfully.'],
      },
      {
        verificationIndex: 1,
        status: 'deferred',
        observations: [
          'The integrated player path belongs to final acceptance.',
        ],
      },
    ],
    evidenceRefs: ['.beegame/workflow/evidence/task-1.json'],
    evidencePath: '.beegame/workflow/evidence/task-1.json',
    resourceReferences: [],
    compositionIntegrations: [],
    requirementSatisfactions: [],
  }
}
