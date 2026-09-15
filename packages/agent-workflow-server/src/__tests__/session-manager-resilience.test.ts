import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BeeGameSessionManager,
  isResourceWorkerDurableProgress,
  type BeeGameSessionRunner,
  type BeeGameSessionRunnerStartInput,
  type DashboardSDKMessage,
  type DashboardPermissionDecision,
} from '../beegame/session-manager'
import {
  RuntimeWorkerError,
  serializeRuntimeWorkerError,
} from '../beegame/runtime-worker-error'
import type {
  BeeGameUsageBillingRecordResult as RecordUsageResult,
  BeeGameUsageBillingUsage as Usage,
} from '@bee-game-studio/beegame-billing-core/usage-control-client'
import { SupabaseRuntimeEnvRequestError } from '../supabase-runtime-env-client'
import { createRunStore } from '../beegame/delivery-workflow/run-store'
import { createTestDeliveryRun } from './delivery-workflow-test-helpers'
import { writeBeeGameAssetManifest } from '../beegame/asset-contracts'
import {
  completeTestSubmission,
  renderTestCompleteGameDocument,
} from './complete-game-document-fixture'
import { createModelConfig, resetModelConfigs } from '@bee-game-studio/agent-workflow'

const waitForIdle = async (
  manager: BeeGameSessionManager,
  sessionId: string,
) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (manager.get(sessionId)?.turnStatus === 'idle') return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('session did not become idle')
}

const usageMessage = (tokens: number): DashboardSDKMessage =>
  ({
    type: 'stream_event',
    event: {
      type: 'message_delta',
      usage: { input_tokens: tokens, output_tokens: 0 },
    },
  }) as DashboardSDKMessage

const usageResult = (
  usage: Usage,
  idempotencyKey: string,
): RecordUsageResult => ({
  event: {
    id: idempotencyKey,
    idempotencyKey,
    userId: 'user-1',
    sessionId: 'session-1',
    pricingVersion: 'test-v1',
    usageSource: 'runtime_snapshot',
    usage,
    delta: usage,
    weightedTokens: 0,
    weightedTokensDelta: 0,
    creditsMicro: 0,
    createdAt: new Date().toISOString(),
    metadata: {},
  },
  duplicate: false,
  cumulativeUsage: usage,
  cumulativeWeightedTokens: 0,
  creditsMicro: 0,
})

describe('BeeGame session runtime resilience', () => {
  let root = ''

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    resetModelConfigs()
  })

  test('rejects retired document sessions before creating a worker or touching a document', async () => {
    root = await mkdtemp(join(tmpdir(), 'retired-markdown-session-'))
    let starts = 0
    const runner: BeeGameSessionRunner = { start: async () => { starts++; throw new Error('Must not launch') } }
    const manager = new BeeGameSessionManager(runner, root)
    try {
      const cases = [
        { workflowMarkdownStreamContract: undefined },
        { workflowRevisionContract: undefined },
        { workflowRevisionMarkdownStreamContract: undefined },
        { workflowWorkerType: 'foundation-document-reviser' },
      ]
      for (const retiredFields of cases) {
        const workspacePath = join(root, `nonexistent-${starts}`)
        expect(() => manager.start({
          workspacePath,
          userId: 'user',
          workflowWorker: true,
          ...retiredFields,
        } as never)).toThrow('retired')
        await expect(stat(workspacePath)).rejects.toMatchObject({ code: 'ENOENT' })
      }
      expect(starts).toBe(0)
    } finally { await manager.dispose() }
  })

  test('treats canonical resource mutations as durable progress', () => {
    for (const [toolName, input] of [
      ['Write', {}],
    ] as const) {
      expect(
        isResourceWorkerDurableProgress({
          id: 1,
          sessionId: 'resource-session',
          type: 'tool.completed',
          text: `${toolName} completed`,
          payload: { type: 'tool_event', toolName, input },
          createdAt: new Date(),
        }),
      ).toBe(true)
    }

    expect(
      isResourceWorkerDurableProgress({
        id: 2,
        sessionId: 'resource-session',
        type: 'tool.completed',
        text: 'ResourceLibrary completed',
        payload: {
          type: 'tool_event',
          toolName: 'ResourceLibrary',
          input: { action: 'match_requirements' },
        },
        createdAt: new Date(),
      }),
    ).toBe(false)
  })

  test('keeps BGS routing identity separate from native resume identity', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-native-session-boundary-'))
    const workspacePath = join(root, 'workspace')
    await mkdir(workspacePath, { recursive: true })
    const starts: BeeGameSessionRunnerStartInput[] = []
    const nativeSessionId = '550e8400-e29b-41d4-a716-446655440000'
    const runner: BeeGameSessionRunner = {
      start: async input => {
        starts.push(input)
        return {
          submit: async ({ onMessage }) => {
            input.onNativeSessionId?.(nativeSessionId)
            onMessage({
              type: 'result',
              subtype: 'success',
              is_error: false,
              session_id: nativeSessionId,
              result: 'done',
            } as DashboardSDKMessage)
          },
          stop: () => undefined,
        }
      },
    }
    const firstManager = new BeeGameSessionManager(runner, root)
    const session = firstManager.start({
      workspacePath,
      userId: 'user-1',
    })
    await firstManager.send(session.id, 'first turn')
    await waitForIdle(firstManager, session.id)

    expect(session.id.startsWith('beegame_')).toBe(true)
    expect(starts[0]?.resumeSessionId).toBeUndefined()
    await firstManager.dispose()

    const resumedManager = new BeeGameSessionManager(runner, root)
    resumedManager.start({
      workspacePath,
      userId: 'user-1',
      transcriptSessionId: session.id,
    })
    await resumedManager.send(session.id, 'resumed turn')
    await waitForIdle(resumedManager, session.id)

    expect(starts[1]?.sessionId).toBe(session.id)
    expect(starts[1]?.resumeSessionId).toBe(nativeSessionId)
    await resumedManager.dispose()
  })

  test('workflow stop barrier drains the active turn and durable usage', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-workflow-stop-barrier-'))
    const workspacePath = join(root, 'workspace')
    await mkdir(workspacePath, { recursive: true })
    const run = createTestDeliveryRun({
      runId: 'run-stop-barrier',
      projectId: 'project-stop-barrier',
      ownerId: 'user-1',
    })
    const dispatchId = 'dispatch-stop-barrier'
    const store = createRunStore(workspacePath, 'user-1')
    await store.save({
      ...run,
      phase: 'DOCUMENT_DRAFTING',
      documentStep: 'FOUNDATION_DRAFTING',
      status: 'running',
      activeDispatch: {
        dispatchId,
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        revision: run.revision.document,
        status: 'running',
        startedAt: new Date().toISOString(),
      },
    })
    let releaseTurn!: () => void
    let turnStarted!: () => void
    const started = new Promise<void>(resolve => {
      turnStarted = resolve
    })
    const turnGate = new Promise<void>(resolve => {
      releaseTurn = resolve
    })
    const runner: BeeGameSessionRunner = {
      start: async () => ({
        submit: async ({ onMessage }) => {
          onMessage(usageMessage(7))
          turnStarted()
          await turnGate
        },
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath,
      userId: 'user-1',
      workflowWorker: true,
      workflowRunId: run.runId,
      workflowDispatchId: dispatchId,
      workflowWorkerType: 'document-author',
    })
    await manager.send(session.id, 'run assigned unit')
    await started
    manager.stop(session.id)
    let barrierSettled = false
    const barrier = manager.waitForWorkflowWorkerIdle(session.id).then(() => {
      barrierSettled = true
    })
    await Promise.resolve()
    expect(barrierSettled).toBe(false)
    releaseTurn()
    await barrier

    expect((await store.load())?.usage?.total_tokens).toBe(7)
    manager.dispose()
  })

  test('workflow manager disposal waits for active turns and durable usage', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-workflow-dispose-barrier-'))
    const workspacePath = join(root, 'workspace')
    await mkdir(workspacePath, { recursive: true })
    const run = createTestDeliveryRun({
      runId: 'run-dispose-barrier',
      projectId: 'project-dispose-barrier',
      ownerId: 'user-1',
    })
    const dispatchId = 'dispatch-dispose-barrier'
    const store = createRunStore(workspacePath, 'user-1')
    await store.save({
      ...run,
      phase: 'DOCUMENT_DRAFTING',
      documentStep: 'FOUNDATION_DRAFTING',
      status: 'running',
      activeDispatch: {
        dispatchId,
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        revision: run.revision.document,
        status: 'running',
        startedAt: new Date().toISOString(),
      },
    })
    let releaseTurn!: () => void
    let turnStarted!: () => void
    const started = new Promise<void>(resolve => {
      turnStarted = resolve
    })
    const turnGate = new Promise<void>(resolve => {
      releaseTurn = resolve
    })
    const runner: BeeGameSessionRunner = {
      start: async () => ({
        submit: async ({ onMessage }) => {
          onMessage(usageMessage(11))
          turnStarted()
          await turnGate
        },
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath,
      userId: 'user-1',
      workflowWorker: true,
      workflowRunId: run.runId,
      workflowDispatchId: dispatchId,
      workflowWorkerType: 'document-author',
    })
    await manager.send(session.id, 'run assigned unit')
    await started

    const disposal = manager.dispose()
    expect(disposal).toBeInstanceOf(Promise)
    let disposalSettled = false
    void disposal.then(() => {
      disposalSettled = true
    })
    await Promise.resolve()
    expect(disposalSettled).toBe(false)

    releaseTurn()
    await disposal
    expect((await store.load())?.usage?.total_tokens).toBe(11)
  })

  test('preserves structured transport retryability across worker boundaries', () => {
    const nativeError = Object.assign(new Error('transport failed'), {
      cause: { code: 'CERTIFICATE_VERIFY_FAILED' },
    })
    const serialized = serializeRuntimeWorkerError(nativeError, 'fallback')
    const reconstructed = new RuntimeWorkerError(serialized)

    expect(serialized).toMatchObject({
      causeCode: 'CERTIFICATE_VERIFY_FAILED',
      retryable: true,
    })
    expect(reconstructed).toMatchObject({
      message: 'transport failed',
      retryable: true,
    })
  })

  test('leaves unsupported external tools on the existing permission path', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-non-resource-permission-'))
    const workspacePath = join(root, 'workspace')
    let decisionPromise: Promise<DashboardPermissionDecision> | undefined
    const runner: BeeGameSessionRunner = {
      start: async startInput => ({
        submit: async () => {
          decisionPromise = startInput.requestPermission?.({
            toolUseID: 'implementation-import-1',
            toolName: 'UnknownExternalTool',
            message: 'Use an unsupported external tool',
            input: {},
          })
        },
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath,
      projectId: 'project-1',
      userId: 'user-1',
      workflowWorker: true,
      workflowRunId: 'run-1',
      workflowDispatchId: 'dispatch-1',
      workflowWorkerType: 'implementation-worker',
      workflowAllowedPaths: ['src/'],
    })

    await manager.send(session.id, 'implement the project')
    await waitForIdle(manager, session.id)
    const pending = manager.pendingPermissionsForProject(
      'user-1',
      'project-1',
      workspacePath,
    )

    expect(pending).toEqual([
      expect.objectContaining({
        toolUseID: 'implementation-import-1',
        toolName: 'UnknownExternalTool',
      }),
    ])
    manager.resolveProjectPermission(
      'user-1',
      'project-1',
      workspacePath,
      'implementation-import-1',
      { behavior: 'deny' },
    )
    expect(await decisionPromise).toEqual({ behavior: 'deny' })
    manager.dispose()
  })

  test('auto-approves project-local file mutations without creating a permission gate', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-project-file-permission-'))
    const workspacePath = join(root, 'workspace')
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    let decisionPromise: Promise<DashboardPermissionDecision> | undefined
    const runner: BeeGameSessionRunner = {
      start: async startInput => ({
        submit: async () => {
          decisionPromise = startInput.requestPermission?.({
            toolUseID: 'project-write-request',
            toolName: 'Write',
            message: 'Write the assigned document',
            input: {
              file_path: join(workspacePath, 'docs', 'GDD.md'),
              content: [
                '# Complete document',
                '<!-- beegame-section:product-definition -->',
                '## Product Definition',
                'First section body.',
                '<!-- beegame-section:experience-pillars -->',
                '## Experience Pillars',
                'Second section body.',
              ].join('\n'),
            },
          })
        },
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath,
      projectId: 'project-1',
      userId: 'user-1',
      workflowWorker: true,
      workflowRunId: 'run-1',
      workflowDispatchId: 'dispatch-1',
      workflowWorkerType: 'document-author',
      workflowAllowedPaths: ['docs/GDD.md'],
    })

    await manager.send(session.id, 'author the document')
    await waitForIdle(manager, session.id)

    expect(
      manager.pendingPermissionsForProject(
        'user-1',
        'project-1',
        workspacePath,
      ),
    ).toEqual([])
    expect(await decisionPromise).toEqual({ behavior: 'allow', scope: 'once' })
    expect(
      manager
        .events(session.id)
        .find(event => event.type === 'permission.resolved')?.payload,
    ).toMatchObject({
      autoApproved: true,
      reason: 'workflow_allowed_path',
    })
    expect(
      manager
        .events(session.id)
        .find(event => event.type === 'permission.resolved')?.payload,
    ).not.toMatchObject({ reason: 'foundation_document_draft_checkpoint' })
    manager.dispose()
  })

  test('auto-approves project-local read and search requests without creating a permission gate', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-project-read-permission-'))
    const workspacePath = join(root, 'workspace')
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    await writeFile(join(workspacePath, 'docs', 'GDD.md'), '# Game Design')
    let decisionPromises: Promise<DashboardPermissionDecision>[] = []
    const runner: BeeGameSessionRunner = {
      start: async startInput => ({
        submit: async () => {
          decisionPromises = [
            startInput.requestPermission!({
              toolUseID: 'project-read-relative',
              toolName: 'Read',
              message: 'Read a project document',
              input: { file_path: 'docs/GDD.md' },
            }),
            startInput.requestPermission!({
              toolUseID: 'project-read-absolute',
              toolName: 'Read',
              message: 'Read a project document by absolute path',
              input: { file_path: join(workspacePath, 'docs', 'GDD.md') },
            }),
            startInput.requestPermission!({
              toolUseID: 'project-grep-relative',
              toolName: 'Grep',
              message: 'Search project documents',
              input: { path: 'docs' },
            }),
            startInput.requestPermission!({
              toolUseID: 'project-glob-absolute',
              toolName: 'Glob',
              message: 'List project documents',
              input: { path: join(workspacePath, 'docs') },
            }),
            startInput.requestPermission!({
              toolUseID: 'project-glob-workspace-default',
              toolName: 'Glob',
              message: 'List the project workspace',
              input: {},
            }),
          ]
        },
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath,
      projectId: 'project-1',
      userId: 'user-1',
      workflowWorker: true,
      workflowRunId: 'run-1',
      workflowDispatchId: 'dispatch-1',
      workflowWorkerType: 'document-author',
    })

    await manager.send(session.id, 'review the project documents')
    await waitForIdle(manager, session.id)

    expect(
      manager.pendingPermissionsForProject(
        'user-1',
        'project-1',
        workspacePath,
      ),
    ).toEqual([])
    expect(await Promise.all(decisionPromises)).toEqual(
      Array.from({ length: 5 }, () => ({
        behavior: 'allow',
        scope: 'once',
      })),
    )
    const resolved = manager
      .events(session.id)
      .filter(event => event.type === 'permission.resolved')
    expect(resolved).toHaveLength(5)
    for (const event of resolved) {
      expect(event.payload).toMatchObject({
        autoApproved: true,
        reason: 'project_workspace_file_access',
      })
    }
    manager.dispose()
  })

  test('denies project file reads that escape the workspace boundary without blocking', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-project-read-boundary-'))
    const workspacePath = join(root, 'workspace')
    const outsidePath = join(root, 'outside')
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    await mkdir(outsidePath, { recursive: true })
    await writeFile(join(outsidePath, 'private.json'), '{}')
    await symlink(outsidePath, join(workspacePath, 'docs', 'escape'))
    let decisionPromises: Promise<DashboardPermissionDecision>[] = []
    const runner: BeeGameSessionRunner = {
      start: async startInput => ({
        submit: async () => {
          decisionPromises = [
            startInput.requestPermission!({
              toolUseID: 'parent-directory-read',
              toolName: 'Read',
              message: 'Read outside through a parent directory',
              input: { file_path: '../outside/private.json' },
            }),
            startInput.requestPermission!({
              toolUseID: 'symlink-escape-read',
              toolName: 'Read',
              message: 'Read outside through a symlink',
              input: { file_path: 'docs/escape/private.json' },
            }),
            startInput.requestPermission!({
              toolUseID: 'absolute-external-grep',
              toolName: 'Grep',
              message: 'Search an external directory',
              input: { path: outsidePath },
            }),
            startInput.requestPermission!({
              toolUseID: 'missing-read-target',
              toolName: 'Read',
              message: 'Read without a target',
              input: {},
            }),
          ]
        },
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath,
      projectId: 'project-1',
      userId: 'user-1',
      workflowWorker: true,
      workflowRunId: 'run-1',
      workflowDispatchId: 'dispatch-1',
      workflowWorkerType: 'document-author',
    })

    await manager.send(session.id, 'review project documents')
    await waitForIdle(manager, session.id)

    expect(
      manager.pendingPermissionsForProject(
        'user-1',
        'project-1',
        workspacePath,
      ),
    ).toEqual([])
    const decisions = await Promise.all(decisionPromises)
    expect(decisions.map(decision => decision.behavior)).toEqual([
      'deny',
      'deny',
      'deny',
      'deny',
    ])
    expect(decisions[0]?.message).toContain('outside the project workspace')
    expect(decisions[1]?.message).toContain('outside the project workspace')
    expect(decisions[2]?.message).toContain('outside the project workspace')
    expect(decisions[3]?.message).toContain('project-local target path')
    const resolved = manager
      .events(session.id)
      .filter(event => event.type === 'permission.resolved')
    expect(resolved).toHaveLength(4)
    expect(resolved.map(event => event.payload?.reason)).toEqual([
      'project_workspace_boundary',
      'project_workspace_boundary',
      'project_workspace_boundary',
      'project_workspace_target_invalid',
    ])
    for (const event of resolved) {
      expect(event.payload).toMatchObject({ autoDenied: true })
      expect(event.payload).toHaveProperty('input')
    }
    manager.dispose()
  })

  test('leaves unsupported tools on the existing permission path', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-project-tool-permission-'))
    const workspacePath = join(root, 'workspace')
    await mkdir(workspacePath, { recursive: true })
    let decisionPromise: Promise<DashboardPermissionDecision> | undefined
    const runner: BeeGameSessionRunner = {
      start: async startInput => ({
        submit: async () => {
          decisionPromise = startInput.requestPermission?.({
            toolUseID: 'project-bash-request',
            toolName: 'Bash',
            message: 'Run a shell command',
            input: { command: 'pwd' },
          })
        },
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath,
      projectId: 'project-1',
      userId: 'user-1',
      workflowWorker: true,
      workflowRunId: 'run-1',
      workflowDispatchId: 'dispatch-1',
      workflowWorkerType: 'document-author',
    })

    await manager.send(session.id, 'inspect the project')
    await waitForIdle(manager, session.id)

    expect(
      manager.pendingPermissionsForProject(
        'user-1',
        'project-1',
        workspacePath,
      ),
    ).toEqual([
      expect.objectContaining({
        toolUseID: 'project-bash-request',
        toolName: 'Bash',
      }),
    ])
    manager.resolveProjectPermission(
      'user-1',
      'project-1',
      workspacePath,
      'project-bash-request',
      { behavior: 'deny' },
    )
    expect(await decisionPromise).toEqual({ behavior: 'deny' })
    manager.dispose()
  })

  test('returns native permission suggestions as session-only rules', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-session-tool-permission-'))
    const workspacePath = join(root, 'workspace')
    await mkdir(workspacePath, { recursive: true })
    let decisionPromise: Promise<DashboardPermissionDecision> | undefined
    const runner: BeeGameSessionRunner = {
      start: async startInput => ({
        submit: async () => {
          decisionPromise = startInput.requestPermission?.({
            toolUseID: 'project-session-bash-request',
            toolName: 'Bash',
            message: 'Run a shell command',
            input: { command: 'npm run build' },
            permissionSuggestions: [
              {
                type: 'addRules',
                rules: [{ toolName: 'Bash', ruleContent: 'npm run:*' }],
                behavior: 'allow',
                destination: 'localSettings',
              },
            ],
          })
        },
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath,
      projectId: 'project-1',
      userId: 'user-1',
    })

    await manager.send(session.id, 'build the project')
    await waitForIdle(manager, session.id)
    manager.resolveProjectPermission(
      'user-1',
      'project-1',
      workspacePath,
      'project-session-bash-request',
      { behavior: 'allow', scope: 'session' },
    )

    expect(await decisionPromise).toEqual({
      behavior: 'allow',
      scope: 'session',
      updatedPermissions: [
        {
          type: 'addRules',
          rules: [{ toolName: 'Bash', ruleContent: 'npm run:*' }],
          behavior: 'allow',
          destination: 'session',
        },
      ],
    })
    manager.dispose()
  })

  test('preserves the project boundary denial when the workflow turn fails', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-project-boundary-failure-'))
    const workspacePath = join(root, 'workspace')
    const outsidePath = join(root, 'outside.json')
    await mkdir(workspacePath, { recursive: true })
    await writeFile(outsidePath, '{}')
    const runner: BeeGameSessionRunner = {
      start: async startInput => ({
        submit: async () => {
          const decision = await startInput.requestPermission!({
            toolUseID: 'external-review-read',
            toolName: 'Read',
            message: 'Read an external review projection',
            input: { file_path: outsidePath },
          })
          if (decision.behavior === 'deny') {
            throw new Error(decision.message)
          }
        },
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath,
      projectId: 'project-1',
      userId: 'user-1',
      workflowWorker: true,
      workflowRunId: 'run-1',
      workflowDispatchId: 'dispatch-1',
      workflowWorkerType: 'document-author',
    })

    await manager.send(session.id, 'verify the repaired documents')
    await waitForIdle(manager, session.id)

    expect(
      manager.pendingPermissionsForProject(
        'user-1',
        'project-1',
        workspacePath,
      ),
    ).toEqual([])
    expect(
      manager
        .events(session.id)
        .find(event => event.type === 'permission.resolved')?.payload,
    ).toMatchObject({
      autoDenied: true,
      reason: 'project_workspace_boundary',
      input: { file_path: outsidePath },
    })
    expect(
      manager.events(session.id).find(event => event.type === 'turn.failed')
        ?.text,
    ).toContain('outside the project workspace')
    manager.dispose()
  })

  test('denies workflow mutations outside the exact assigned paths without blocking', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-workflow-path-permission-'))
    const workspacePath = join(root, 'workspace')
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    let decisionPromise: Promise<DashboardPermissionDecision> | undefined
    const runner: BeeGameSessionRunner = {
      start: async startInput => ({
        submit: async () => {
          decisionPromise = startInput.requestPermission?.({
            toolUseID: 'sibling-document-write',
            toolName: 'Write',
            message: 'Write a document outside the assigned lane',
            input: {
              file_path: join(workspacePath, 'docs', 'AUDIO_DESIGN.md'),
              content: '# Unauthorized sibling',
            },
          })
        },
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath,
      projectId: 'project-1',
      userId: 'user-1',
      workflowWorker: true,
      workflowRunId: 'run-1',
      workflowDispatchId: 'dispatch-1',
      workflowWorkerType: 'document-author',
      workflowAllowedPaths: ['docs/GDD.md'],
    })

    await manager.send(session.id, 'repair the assigned document')
    await waitForIdle(manager, session.id)

    expect(
      manager.pendingPermissionsForProject(
        'user-1',
        'project-1',
        workspacePath,
      ),
    ).toEqual([])
    expect(await decisionPromise).toEqual({
      behavior: 'deny',
      scope: 'once',
      message: 'Workflow workers may mutate only their assigned project paths.',
    })
    expect(
      manager
        .events(session.id)
        .find(event => event.type === 'permission.resolved')?.payload,
    ).toMatchObject({
      autoDenied: true,
      reason: 'workflow_path_not_allowed',
    })
    manager.dispose()
  })

  test('protected authority overrides a broad workflow write scope', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-workflow-protected-path-'))
    const workspacePath = join(root, 'workspace')
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    let decisionPromise: Promise<DashboardPermissionDecision> | undefined
    const runner: BeeGameSessionRunner = {
      start: async startInput => ({
        submit: async () => {
          decisionPromise = startInput.requestPermission?.({
            toolUseID: 'protected-document-write',
            toolName: 'Edit',
            message: 'Edit protected authority',
            input: { file_path: join(workspacePath, 'docs', 'GDD.md') },
          })
        },
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath,
      projectId: 'project-1',
      userId: 'user-1',
      workflowWorker: true,
      workflowRunId: 'run-1',
      workflowDispatchId: 'dispatch-1',
      workflowWorkerType: 'implementation-worker',
      workflowAllowedPaths: ['./'],
      workflowProtectedPaths: ['docs/GDD.md', '.beegame/ir/'],
    })

    await manager.send(session.id, 'implement without changing authority')
    await waitForIdle(manager, session.id)

    expect(await decisionPromise).toEqual({
      behavior: 'deny',
      scope: 'once',
      message: 'Workflow workers may not mutate protected project authority: docs/GDD.md.',
    })
    expect(
      manager.events(session.id).find(event => event.type === 'permission.resolved')?.payload,
    ).toMatchObject({ autoDenied: true, reason: 'workflow_protected_path' })
    manager.dispose()
  })

  test('applies exact files and directory scopes without permitting symlink escapes', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-workflow-scope-permission-'))
    const workspacePath = join(root, 'workspace')
    const outsidePath = join(root, 'outside')
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    await mkdir(join(workspacePath, 'assets', 'content'), { recursive: true })
    await mkdir(outsidePath, { recursive: true })
    await symlink(
      outsidePath,
      join(workspacePath, 'assets', 'content', 'escape'),
    )
    let decisions: DashboardPermissionDecision[] = []
    const runner: BeeGameSessionRunner = {
      start: async startInput => ({
        submit: async () => {
          decisions = await Promise.all([
            startInput.requestPermission!({
              toolUseID: 'assigned-multi-edit',
              toolName: 'MultiEdit',
              message: 'Edit the assigned document',
              input: { file_path: join(workspacePath, 'docs', 'GDD.md') },
            }),
            startInput.requestPermission!({
              toolUseID: 'assigned-directory-write',
              toolName: 'Write',
              message: 'Write assigned resource content',
              input: {
                file_path: join(
                  workspacePath,
                  'assets',
                  'content',
                  'generated.json',
                ),
              },
            }),
            startInput.requestPermission!({
              toolUseID: 'assigned-directory-escape',
              toolName: 'Write',
              message: 'Escape through a project symlink',
              input: {
                file_path: join(
                  workspacePath,
                  'assets',
                  'content',
                  'escape',
                  'outside.json',
                ),
              },
            }),
          ])
        },
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath,
      projectId: 'project-1',
      userId: 'user-1',
      workflowWorker: true,
      workflowRunId: 'run-1',
      workflowDispatchId: 'dispatch-1',
      workflowWorkerType: 'document-author',
      workflowAllowedPaths: ['docs/GDD.md', 'assets/content/'],
    })

    await manager.send(session.id, 'complete assigned mutations')
    await waitForIdle(manager, session.id)

    expect(decisions).toEqual([
      { behavior: 'allow', scope: 'once' },
      { behavior: 'allow', scope: 'once' },
      {
        behavior: 'deny',
        scope: 'once',
        message:
          'Workflow workers may not mutate files outside the project workspace.',
      },
    ])
    expect(
      manager.pendingPermissionsForProject(
        'user-1',
        'project-1',
        workspacePath,
      ),
    ).toEqual([])
    manager.dispose()
  })

  test('denies out-of-project workflow file mutations without blocking the worker', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-native-permission-relay-'))
    const workspacePath = join(root, 'workspace')
    let decisionPromise: Promise<DashboardPermissionDecision> | undefined
    const runner: BeeGameSessionRunner = {
      start: async startInput => ({
        submit: async () => {
          decisionPromise = startInput.requestPermission?.({
            toolUseID: 'native-write-request',
            toolName: 'Write',
            message: 'Bee Game Studio requests permission',
            input: { file_path: join(root, 'outside.md') },
          })
        },
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath,
      projectId: 'project-1',
      userId: 'user-1',
      workflowWorker: true,
      workflowRunId: 'run-1',
      workflowDispatchId: 'dispatch-1',
      workflowWorkerType: 'document-author',
      workflowAllowedPaths: ['docs/'],
    })

    await manager.send(session.id, 'author the document')
    await waitForIdle(manager, session.id)

    expect(
      manager.pendingPermissionsForProject(
        'user-1',
        'project-1',
        workspacePath,
      ),
    ).toEqual([])
    expect(await decisionPromise).toEqual({
      behavior: 'deny',
      scope: 'once',
      message: 'Workflow workers may not mutate files outside the project workspace.',
    })
    expect(
      manager
        .events(session.id)
        .find(event => event.type === 'permission.resolved')?.payload,
    ).toMatchObject({
      autoDenied: true,
      reason: 'workflow_workspace_boundary',
    })
    manager.dispose()
  })

  test('passes selected model and the single Bee Game Studio config directory without behavior overrides', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-transparent-model-env-'))
    const workspacePath = join(root, 'workspace')
    let runtimeEnv: Record<string, string> | undefined
    let launchContract: BeeGameSessionRunnerStartInput['runtimeLaunchContract']
    const runner: BeeGameSessionRunner = {
      start: async input => {
        runtimeEnv = input.env
        launchContract = input.runtimeLaunchContract
        return {
          submit: async () => {},
          stop: () => undefined,
        }
      },
    }
    const manager = new BeeGameSessionManager(runner, root, async () => ({
      ANTHROPIC_BASE_URL: 'https://provider.example',
      ANTHROPIC_AUTH_TOKEN: 'provider-token',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'selected-model',
      BEEGAME_CONFIG_DIR: '/bgs/config',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      FEATURE_BASH_CLASSIFIER: '0',
      NPM_CONFIG_USERCONFIG: '/bgs/npmrc',
    }))
    const session = manager.start({ workspacePath, userId: 'user-1' })

    await manager.send(session.id, 'run the task')
    await waitForIdle(manager, session.id)

    expect(runtimeEnv).toEqual({
      ANTHROPIC_BASE_URL: 'https://provider.example',
      ANTHROPIC_AUTH_TOKEN: 'provider-token',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'selected-model',
      BEEGAME_CONFIG_DIR: '/bgs/config',
      BEEGAME_MODEL_TYPE: 'anthropic',
    })
    expect(launchContract).toEqual({
      selectedEnvironmentKeys: [
        'ANTHROPIC_AUTH_TOKEN',
        'ANTHROPIC_BASE_URL',
        'ANTHROPIC_DEFAULT_SONNET_MODEL',
        'BEEGAME_CONFIG_DIR',
        'BEEGAME_MODEL_TYPE',
        'CLAUDE_CODE_DISABLE_AUTO_MEMORY',
        'FEATURE_BASH_CLASSIFIER',
        'NPM_CONFIG_USERCONFIG',
      ],
      forwardedEnvironmentKeys: [
        'ANTHROPIC_AUTH_TOKEN',
        'ANTHROPIC_BASE_URL',
        'ANTHROPIC_DEFAULT_SONNET_MODEL',
        'BEEGAME_CONFIG_DIR',
        'BEEGAME_MODEL_TYPE',
      ],
      endpointClass: 'custom',
      configDirectoryConfigured: true,
      credentialConfigured: true,
    })
    manager.dispose()
  })

  test('surfaces a native runtime failure without restarting Bee Game Studio', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-runtime-retry-'))
    let starts = 0
    const runner: BeeGameSessionRunner = {
      start: async () => {
        starts += 1
        const current = starts
        return {
          submit: async () => {
            if (current === 1) {
              throw new RuntimeWorkerError({
                message: 'temporary transport failure',
                name: 'Error',
                code: 'ECONNRESET',
                retryable: true,
              })
            }
          },
          stop: () => undefined,
        }
      },
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath: join(root, 'workspace'),
      userId: 'user-1',
    })

    await manager.send(session.id, 'continue')
    await waitForIdle(manager, session.id)

    expect(starts).toBe(1)
    expect(
      manager.events(session.id).some(event => event.type === 'turn.failed'),
    ).toBe(true)
    manager.dispose()
  })

  test('surfaces a workflow runtime failure without a BeeGame retry', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-workflow-startup-retry-'))
    let starts = 0
    const runner: BeeGameSessionRunner = {
      start: async () => {
        starts += 1
        const current = starts
        return {
          submit: async () => {
            if (current === 1) throw new Error('provider startup failed')
          },
          stop: () => undefined,
        }
      },
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath: join(root, 'workspace'),
      userId: 'user-1',
      workflowWorker: true,
      workflowRunId: 'run-1',
      workflowDispatchId: 'dispatch-1',
      workflowWorkerType: 'document-author',
    })

    await manager.send(session.id, 'review documents')
    await waitForIdle(manager, session.id)

    expect(starts).toBe(1)
    expect(
      manager.events(session.id).some(event => event.type === 'turn.failed'),
    ).toBe(true)
    manager.dispose()
  })

  test('does not interrupt a workflow worker during a quiet native tool call', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-workflow-tool-idle-'))
    let starts = 0
    let firstRunnerStopped = 0
    const runner: BeeGameSessionRunner = {
      start: async () => {
        starts += 1
        const current = starts
        return {
          submit: async input => {
            if (current !== 1) return
            input.onMessage({
              type: 'stream_event',
              event: {
                type: 'content_block_start',
                index: 0,
                content_block: {
                  type: 'tool_use',
                  id: 'native-write-1',
                  name: 'Write',
                  input: {},
                },
              },
            } as DashboardSDKMessage)
            input.onMessage({
              type: 'stream_event',
              event: {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'input_json_delta', partial_json: '{"title":"' },
              },
            } as DashboardSDKMessage)
            await new Promise(resolve => setTimeout(resolve, 50))
          },
          stop: () => {
            if (current === 1) firstRunnerStopped += 1
          },
        }
      },
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath: join(root, 'workspace'),
      userId: 'user-1',
      workflowWorker: true,
      workflowRunId: 'run-1',
      workflowDispatchId: 'dispatch-1',
      workflowWorkerType: 'document-author',
    })

    await manager.send(session.id, 'review the assigned document')
    await waitForIdle(manager, session.id)

    expect(starts).toBe(1)
    expect(firstRunnerStopped).toBe(0)
    expect(
      manager.events(session.id).some(event => event.type === 'turn.failed'),
    ).toBe(false)
    manager.dispose()
  })

  test('exposes native tool input preparation without persisting streamed input', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-tool-input-activity-'))
    const runner: BeeGameSessionRunner = {
      start: async () => ({
        submit: async input => {
          input.onMessage({
            type: 'stream_event',
            event: {
              type: 'content_block_start',
              index: 3,
              content_block: {
                type: 'tool_use',
                id: 'native-write-preparing',
                name: 'Write',
                input: {},
              },
            },
          } as DashboardSDKMessage)
          input.onMessage({
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              index: 3,
              delta: {
                type: 'input_json_delta',
                partial_json: '{"content":"PRIVATE DOCUMENT BODY',
              },
            },
          } as DashboardSDKMessage)
        },
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath: join(root, 'workspace'),
      userId: 'user-1',
      workflowWorker: true,
      workflowRunId: 'run-tool-input',
      workflowDispatchId: 'dispatch-tool-input',
      workflowWorkerType: 'document-author',
    })

    await manager.send(session.id, 'author the assigned document')
    await waitForIdle(manager, session.id)

    const activity = manager
      .events(session.id)
      .filter(event => event.type === 'tool.progress')
    expect(activity).toEqual([
      expect.objectContaining({
        text: 'Write input streaming',
        payload: {
          type: 'tool_progress',
          toolUseID: 'native-write-preparing',
          toolName: 'Write',
          phase: 'input_streaming',
        },
      }),
    ])
    expect(JSON.stringify(activity)).not.toContain('PRIVATE DOCUMENT BODY')
    manager.dispose()
  })

  test('does not expose document-author assistant text as workflow progress', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-document-assistant-progress-'))
    const workspacePath = join(root, 'workspace')
    const store = createRunStore(workspacePath, 'user-1')
    const initial = createTestDeliveryRun({
      runId: 'run-document-assistant-progress',
      projectId: 'project-document-assistant-progress',
      ownerId: 'user-1',
      foundationDraftComplete: false,
    })
    const dispatchId = 'dispatch-document-assistant-progress'
    await store.save({
      ...initial,
      phase: 'DOCUMENT_DRAFTING',
      status: 'running',
      documentStep: 'FOUNDATION_DRAFTING',
      activeDispatch: {
        dispatchId,
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        taskId: 'docs/GDD.md',
        revision: initial.revision.document,
        status: 'running',
        startedAt: new Date().toISOString(),
      },
    })
    const markdown = '# Private document body\n\nThis must not become card progress.'
    const runner: BeeGameSessionRunner = {
      start: async () => ({
        submit: async ({ onMessage }) => {
          onMessage({
            type: 'assistant',
            message: { content: [{ type: 'text', text: markdown }] },
          } as DashboardSDKMessage)
        },
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath,
      userId: 'user-1',
      workflowWorker: true,
      workflowRunId: initial.runId,
      workflowDispatchId: dispatchId,
      workflowWorkerType: 'document-author',
    })

    await manager.send(session.id, 'author the assigned document')
    await waitForIdle(manager, session.id)
    let active = await store.load()
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (active?.currentMessage !== undefined) break
      await new Promise(resolve => setTimeout(resolve, 5))
      active = await store.load()
    }

    expect(active?.currentMessage).toBeUndefined()
    manager.dispose()
  })

  test('keeps a document worker visibly active while native tool input is prepared', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-document-input-progress-'))
    const workspacePath = join(root, 'workspace')
    const store = createRunStore(workspacePath, 'user-1')
    const initial = createTestDeliveryRun({
      runId: 'run-document-input',
      projectId: 'project-document-input',
      ownerId: 'user-1',
      foundationDraftComplete: false,
    })
    const startedAt = new Date().toISOString()
    await store.save({
      ...initial,
      phase: 'DOCUMENT_DRAFTING',
      status: 'running',
      documentStep: 'FOUNDATION_DRAFTING',
      lastProgressAt: startedAt,
      activeDispatch: {
        dispatchId: 'dispatch-document-input',
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        taskId: 'docs/GDD.md',
        revision: initial.revision.document,
        status: 'running',
        startedAt,
      },
    })
    let release!: () => void
    const hold = new Promise<void>(resolve => {
      release = resolve
    })
    const runner: BeeGameSessionRunner = {
      start: async () => ({
        submit: async input => {
          input.onMessage({
            type: 'stream_event',
            event: {
              type: 'content_block_start',
              index: 0,
              content_block: {
                type: 'tool_use',
                id: 'native-write-progress',
                name: 'Write',
                input: {},
              },
            },
          } as DashboardSDKMessage)
          await hold
        },
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath,
      userId: 'user-1',
      workflowWorker: true,
      workflowRunId: 'run-document-input',
      workflowDispatchId: 'dispatch-document-input',
      workflowWorkerType: 'document-author',
      language: 'zh',
    })

    const turn = manager.send(session.id, 'author the document')
    let active = await store.load()
    for (
      let attempt = 0;
      attempt < 400 && active?.thinking !== 'working';
      attempt += 1
    ) {
      await new Promise(resolve => setTimeout(resolve, 5))
      active = await store.load()
    }

    expect(
      manager.events(session.id).some(event => event.type === 'tool.progress'),
    ).toBe(true)
    expect(active?.activeDispatch).toEqual(
      expect.objectContaining({
        dispatchId: 'dispatch-document-input',
        status: 'running',
      }),
    )
    expect(active?.thinking).toBe('working')
    expect(active?.currentMessage).toBe('正在准备文档写入…')
    expect(active?.lastProgressAt).toBe(startedAt)
    release()
    await turn
    manager.dispose()
  })

  test('keeps document author visibly working when prose streams without visible reasoning', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-document-reasoning-progress-'))
    const workspacePath = join(root, 'workspace')
    const store = createRunStore(workspacePath, 'user-1')
    const initial = createTestDeliveryRun({
      runId: 'run-document-reasoning',
      projectId: 'project-document-reasoning',
      ownerId: 'user-1',
      foundationDraftComplete: false,
    })
    await store.save({
      ...initial,
      phase: 'DOCUMENT_DRAFTING',
      status: 'running',
      documentStep: 'FOUNDATION_DRAFTING',
      activeDispatch: {
        dispatchId: 'dispatch-document-reasoning',
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        taskId: 'docs/GDD.md',
        revision: initial.revision.document,
        status: 'running',
        startedAt: new Date().toISOString(),
      },
    })
    let release!: () => void
    const hold = new Promise<void>(resolve => {
      release = resolve
    })
    const runner: BeeGameSessionRunner = {
      start: async () => ({
        submit: async input => {
          input.onMessage({
            type: 'stream_event',
            event: {
              type: 'content_block_start',
              index: 0,
              content_block: {
                type: 'tool_use',
                id: 'native-edit-progress',
                name: 'Edit',
                input: {},
              },
            },
          } as DashboardSDKMessage)
          input.onMessage({
            type: 'stream_event',
            event: {
              type: 'content_block_start',
              index: 1,
              content_block: { type: 'thinking', thinking: '' },
            },
          } as DashboardSDKMessage)
          input.onMessage({
            type: 'stream_event',
            event: {
              type: 'content_block_stop',
              index: 1,
            },
          } as DashboardSDKMessage)
          input.onMessage({
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              index: 2,
              delta: { type: 'text_delta', text: '# Document' },
            },
          } as DashboardSDKMessage)
          await hold
        },
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath,
      userId: 'user-1',
      workflowWorker: true,
      workflowRunId: 'run-document-reasoning',
      workflowDispatchId: 'dispatch-document-reasoning',
      workflowWorkerType: 'document-author',
      language: 'zh',
    })

    const turn = manager.send(session.id, 'author the document')
    let active = await store.load()
    for (
      let attempt = 0;
      attempt < 400 && active?.currentMessage !== '正在撰写当前文档…';
      attempt += 1
    ) {
      await new Promise(resolve => setTimeout(resolve, 5))
      active = await store.load()
    }

    expect(active?.thinking).toBe('working')
    expect(active?.currentMessage).toBe('正在撰写当前文档…')
    release()
    await turn
    manager.dispose()
  })

  test('does not interrupt a workflow worker during quiet native thinking', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-workflow-thinking-idle-'))
    let starts = 0
    const runner: BeeGameSessionRunner = {
      start: async () => {
        starts += 1
        const current = starts
        return {
          submit: async input => {
            if (current !== 1) return
            input.onMessage({
              type: 'stream_event',
              event: {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'thinking_delta', thinking: 'planning' },
              },
            } as DashboardSDKMessage)
            await new Promise(resolve => setTimeout(resolve, 50))
          },
          stop: () => undefined,
        }
      },
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath: join(root, 'workspace'),
      userId: 'user-1',
      workflowWorker: true,
      workflowRunId: 'run-1',
      workflowDispatchId: 'dispatch-1',
      workflowWorkerType: 'document-author',
    })

    await manager.send(session.id, 'review the assigned document')
    await waitForIdle(manager, session.id)

    expect(starts).toBe(1)
    expect(
      manager.events(session.id).some(event => event.type === 'turn.failed'),
    ).toBe(false)
    manager.dispose()
  })

  test('does not interrupt a document author during a quiet native write', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-document-author-quiet-write-'))
    let starts = 0
    const runner: BeeGameSessionRunner = {
      start: async () => {
        starts += 1
        return {
          submit: async input => {
            input.onMessage({
              type: 'stream_event',
              event: {
                type: 'content_block_start',
                index: 0,
                content_block: {
                  type: 'tool_use',
                  id: 'native-write-1',
                  name: 'Write',
                  input: {},
                },
              },
            } as DashboardSDKMessage)
            await new Promise(resolve => setTimeout(resolve, 50))
          },
          stop: () => undefined,
        }
      },
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath: join(root, 'workspace'),
      userId: 'user-1',
      workflowWorker: true,
      workflowRunId: 'run-1',
      workflowDispatchId: 'dispatch-1',
      workflowWorkerType: 'document-author',
    })

    await manager.send(session.id, 'author the assigned document')
    await waitForIdle(manager, session.id)

    expect(starts).toBe(1)
    expect(
      manager.events(session.id).some(event => event.type === 'turn.failed'),
    ).toBe(false)
    manager.dispose()
  })

  test('does not override Bee Game Studio native write sizing', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-document-author-large-write-'))
    const runner: BeeGameSessionRunner = {
      start: async () => ({
        submit: async input => {
          input.onMessage({
            type: 'stream_event',
            event: {
              type: 'content_block_start',
              index: 0,
              content_block: {
                type: 'tool_use',
                id: 'native-write-large',
                name: 'Write',
                input: {},
              },
            },
          } as DashboardSDKMessage)
          input.onMessage({
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              index: 0,
              delta: {
                type: 'input_json_delta',
                partial_json: 'x'.repeat(24 * 1024 + 1),
              },
            },
          } as DashboardSDKMessage)
        },
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath: join(root, 'workspace'),
      userId: 'user-1',
      workflowWorker: true,
      workflowRunId: 'run-large-write',
      workflowDispatchId: 'dispatch-large-write',
      workflowWorkerType: 'document-author',
    })

    await manager.send(session.id, 'author the assigned document')
    await waitForIdle(manager, session.id)

    expect(
      manager.events(session.id).some(event => event.type === 'turn.failed'),
    ).toBe(false)
    manager.dispose()
  })

  test('refreshes workflow credentials once when runtime env rejects an expired token', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-runtime-auth-refresh-'))
    const observedTokens: Array<string | undefined> = []
    const refreshOptions: Array<{ forceRefresh?: boolean } | undefined> = []
    const runner: BeeGameSessionRunner = {
      start: async () => ({
        submit: async () => undefined,
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(
      runner,
      root,
      async (_dataRoot, _userId, authToken) => {
        observedTokens.push(authToken)
        if (authToken === 'expired-token') {
          throw new SupabaseRuntimeEnvRequestError(401, 'unauthorized')
        }
        return { OPENAI_API_KEY: 'runtime-key' }
      },
    )
    const session = manager.start({
      workspacePath: join(root, 'workspace'),
      userId: 'user-1',
      authToken: 'expired-token',
      workflowWorker: true,
      getValidAuthToken: options => {
        refreshOptions.push(options)
        return 'refreshed-token'
      },
    })

    await manager.send(session.id, 'continue')
    await waitForIdle(manager, session.id)

    expect(observedTokens).toEqual(['expired-token', 'refreshed-token'])
    expect(refreshOptions).toEqual([{ forceRefresh: true }])
    expect(
      manager.events(session.id).some(event => event.type === 'turn.failed'),
    ).toBe(false)
    manager.dispose()
  })

  test('does not replay a turn after the runtime emitted an event', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-runtime-no-replay-'))
    let starts = 0
    const runner: BeeGameSessionRunner = {
      start: async () => {
        starts += 1
        return {
          submit: async input => {
            input.onMessage({
              type: 'stream_event',
              event: { type: 'message_start' },
            } as DashboardSDKMessage)
            throw new RuntimeWorkerError({
              message: 'temporary transport failure',
              name: 'Error',
              code: 'ECONNRESET',
              retryable: true,
            })
          },
          stop: () => undefined,
        }
      },
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath: join(root, 'workspace'),
      userId: 'user-1',
    })

    await manager.send(session.id, 'continue')
    await waitForIdle(manager, session.id)

    expect(starts).toBe(1)
    expect(
      manager.events(session.id).some(event => event.type === 'turn.failed'),
    ).toBe(true)
    manager.dispose()
  })

  test('records and debits cumulative usage exactly once at turn terminal', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-usage-coalesce-'))
    const recorded: Array<{
      usage: Usage
      idempotencyKey: string
      metadata?: Record<string, unknown>
    }> = []
    const debited: string[] = []
    const runner: BeeGameSessionRunner = {
      start: async () => ({
        submit: async input => {
          input.onMessage(usageMessage(10))
          input.onMessage(usageMessage(20))
          input.onMessage(usageMessage(30))
        },
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root, () => ({}), {
      recordUsage: async (_userId, input) => {
        recorded.push({
          usage: input.usage,
          idempotencyKey: input.idempotencyKey,
          metadata: input.metadata,
        })
        return usageResult(input.usage, input.idempotencyKey)
      },
      debitRealtimeUsage: async (_userId, input) => {
        debited.push(input.idempotencyKey)
        return usageResult(input.usage, input.idempotencyKey)
      },
    })
    const session = manager.start({
      workspacePath: join(root, 'workspace'),
      userId: 'user-1',
    })

    await manager.send(session.id, 'continue')
    await waitForIdle(manager, session.id)

    expect(recorded).toHaveLength(1)
    expect(debited).toEqual([recorded[0]!.idempotencyKey])
    expect(recorded[0]!.usage.total_tokens).toBe(30)
    expect(recorded[0]!.metadata).toMatchObject({
      providerCumulativeUsage: expect.objectContaining({ total_tokens: 30 }),
      turnDeltaUsage: expect.objectContaining({ total_tokens: 30 }),
      billableFinalUsage: expect.objectContaining({ total_tokens: 30 }),
    })
    expect(recorded[0]!.idempotencyKey).toMatch(/^usage-terminal:/)
    manager.dispose()
  })

  test('uses the terminal cumulative difference as the next turn delta', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-usage-turn-delta-'))
    const recorded: Array<{
      usage: Usage
      metadata?: Record<string, unknown>
    }> = []
    let turn = 0
    const runner: BeeGameSessionRunner = {
      start: async () => ({
        submit: async input => {
          turn += 1
          input.onMessage(usageMessage(turn === 1 ? 10 : 30))
        },
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root, () => ({}), {
      recordUsage: async (_userId, input) => {
        recorded.push({ usage: input.usage, metadata: input.metadata })
        return usageResult(input.usage, input.idempotencyKey)
      },
    })
    const session = manager.start({
      workspacePath: join(root, 'workspace'),
      userId: 'user-1',
    })

    await manager.send(session.id, 'first')
    await waitForIdle(manager, session.id)
    await manager.send(session.id, 'second')
    await waitForIdle(manager, session.id)

    expect(recorded).toHaveLength(2)
    expect(recorded.map(value => value.usage.total_tokens)).toEqual([10, 20])
    expect(
      recorded.map(
        value => (value.metadata?.turnDeltaUsage as Usage).total_tokens,
      ),
    ).toEqual([10, 20])
    manager.dispose()
  })

  test('keeps terminal billing identity stable when a workflow dispatch is replayed', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-usage-replay-'))
    const keys: string[] = []
    const backend = {
      recordUsage: async (_userId: string, input: {
        usage: Usage
        idempotencyKey: string
      }) => {
        keys.push(input.idempotencyKey)
        return usageResult(input.usage, input.idempotencyKey)
      },
    }
    const runner: BeeGameSessionRunner = {
      start: async () => ({
        submit: async input => input.onMessage(usageMessage(12)),
        stop: () => undefined,
      }),
    }
    for (let replay = 0; replay < 2; replay += 1) {
      const manager = new BeeGameSessionManager(runner, root, () => ({}), backend)
      const session = manager.start({
        workspacePath: join(root, `workspace-${replay}`),
        userId: 'user-1',
        workflowRunId: 'run-1',
        workflowDispatchId: 'dispatch-1',
      })
      await manager.send(session.id, 'replay same terminal')
      await waitForIdle(manager, session.id)
      await manager.dispose()
    }

    expect(keys).toHaveLength(2)
    expect(new Set(keys).size).toBe(1)
    expect(keys[0]).toMatch(/^usage-terminal:run-1:dispatch-1:/)
  })

  test('bounds failed usage retries and does not append billing errors after stop', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-usage-stop-'))
    let attempts = 0
    const runner: BeeGameSessionRunner = {
      start: async () => ({
        submit: async input => input.onMessage(usageMessage(10)),
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root, () => ({}), {
      recordUsage: async () => {
        attempts += 1
        throw new Error('billing transport failed')
      },
    })
    const session = manager.start({
      workspacePath: join(root, 'workspace'),
      userId: 'user-1',
    })

    await manager.send(session.id, 'continue')
    for (let wait = 0; wait < 50 && attempts === 0; wait += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    manager.stop(session.id)
    await new Promise(resolve => setTimeout(resolve, 350))

    expect(attempts).toBe(3)
    expect(
      manager
        .events(session.id)
        .some(event => event.payload?.type === 'billing.usage_record_failed'),
    ).toBe(false)
    manager.dispose()
  })

  test('does not override native verification behavior for delivery workflow workers', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-workflow-review-owner-'))
    const workspacePath = join(root, 'workspace')
    let runtimeEnv: Record<string, string> | undefined
    const runner: BeeGameSessionRunner = {
      start: async input => {
        runtimeEnv = input.env
        return { submit: async () => {}, stop: () => undefined }
      },
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath,
      userId: 'user-1',
      workflowWorker: true,
      workflowWorkerType: 'implementation-worker',
    })

    await manager.send(session.id, 'implement the task')
    await waitForIdle(manager, session.id)

    expect(runtimeEnv?.BEEGAME_EXTERNAL_REVIEW).toBeUndefined()
    manager.dispose()
  })
})
