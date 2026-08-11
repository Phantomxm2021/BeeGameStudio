import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BeeGameSessionManager,
  isResourceWorkerDurableProgress,
  type BeeGameSessionRunner,
  type DashboardSDKMessage,
  type DashboardPermissionDecision,
} from '../beegame/session-manager'
import {
  QueryEngineWorkerError,
  serializeQueryEngineError,
} from '../beegame/query-engine-worker-protocol'
import type {
  BeeGameUsageBillingRecordResult as RecordUsageResult,
  BeeGameUsageBillingUsage as Usage,
} from '@bee-game-studio/beegame-billing-core/usage-control-client'
import { SupabaseRuntimeEnvRequestError } from '../supabase-runtime-env-client'
import { createRunStore } from '../beegame/delivery-workflow/run-store'
import { createTestDeliveryRun } from './delivery-workflow-test-helpers'
import { writeBeeGameAssetManifest } from '../beegame/asset-contracts'
import { DOCUMENT_NATIVE_WRITE_MAX_BYTES } from '../beegame/workflow-tool-input-budget'

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
  })

  test('treats canonical resource mutations as durable progress', () => {
    for (const [toolName, input] of [
      ['Write', {}],
      ['AssetManifest', { action: 'submit_resource_plan' }],
      ['CommitResourceInventory', { decisions: [] }],
      ['CommitResourceContent', { action: 'commit' }],
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
    const serialized = serializeQueryEngineError(nativeError, 'fallback')
    const reconstructed = new QueryEngineWorkerError(serialized)

    expect(serialized).toMatchObject({
      causeCode: 'CERTIFICATE_VERIFY_FAILED',
      retryable: true,
    })
    expect(reconstructed).toMatchObject({
      message: 'transport failed',
      retryable: true,
    })
  })

  test('tracks a terminal tool from stream start until its result', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-streaming-terminal-'))
    const workspacePath = join(root, 'workspace')
    let releaseStream!: () => void
    const streamGate = new Promise<void>(resolve => {
      releaseStream = resolve
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
                id: 'review-terminal-1',
                name: 'SubmitDocumentReviewPacket',
                input: {},
              },
            },
          } as DashboardSDKMessage)
          await streamGate
          input.onMessage({
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: 'review-terminal-1',
                  name: 'SubmitDocumentReviewPacket',
                  input: {},
                },
              ],
            },
          })
          input.onMessage({
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'review-terminal-1',
                  content: 'accepted',
                },
              ],
            },
          })
        },
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath,
      userId: 'user-1',
      workflowWorker: true,
      workflowRunId: 'run-1',
      workflowDispatchId: 'dispatch-1',
      workflowWorkerType: 'document-reviewer',
    })

    const send = manager.send(session.id, 'review documents')
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (
        manager.hasInFlightToolSubmission(
          session.id,
          'SubmitDocumentReviewPacket',
        )
      )
        break
      await new Promise(resolve => setTimeout(resolve, 2))
    }
    expect(
      manager.hasInFlightToolSubmission(
        session.id,
        'SubmitDocumentReviewPacket',
      ),
    ).toBe(true)
    releaseStream()
    await send
    expect(
      manager.hasInFlightToolSubmission(
        session.id,
        'SubmitDocumentReviewPacket',
      ),
    ).toBe(false)
  })

  test('publishes structural resource activity without claiming durable progress', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-resource-worker-progress-'))
    const workspacePath = join(root, 'workspace')
    const store = createRunStore(workspacePath, 'user-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'user-1',
      confirmedBriefDigest: 'brief-1',
      checklistApproved: true,
    })
    const startedAt = new Date().toISOString()
    await store.save({
      ...initial,
      phase: 'RESOURCE_PREPARATION',
      lastProgressAt: startedAt,
      activeDispatch: {
        dispatchId: 'dispatch-1',
        workerType: 'resource-curator',
        phase: 'RESOURCE_PREPARATION',
        revision: initial.revision.document,
        status: 'running',
        startedAt,
      },
    })
    const runner: BeeGameSessionRunner = {
      start: async () => ({
        submit: async input => {
          input.onMessage({
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: 'resource-catalog-1',
                  name: 'ResourceLibrary',
                  input: {
                    action: 'match_requirements',
                  },
                },
              ],
            },
          })
          input.onMessage({
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'text',
                  text: 'Now I will inspect more resources.',
                },
              ],
            },
          } as DashboardSDKMessage)
        },
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath,
      userId: 'user-1',
      language: 'zh',
      workflowWorker: true,
      workflowRunId: 'run-1',
      workflowDispatchId: 'dispatch-1',
      workflowWorkerType: 'resource-curator',
    })

    await manager.send(session.id, 'prepare resources')
    await waitForIdle(manager, session.id)
    const run = await store.load()

    expect(run?.currentMessage).toBe('正在匹配资源需求…')
    expect(run?.lastProgressAt).toBe(startedAt)
    manager.dispose()
  })

  test('does not grant Resource Library access to unrelated workflow workers', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-non-resource-permission-'))
    const workspacePath = join(root, 'workspace')
    let decisionPromise: Promise<DashboardPermissionDecision> | undefined
    const runner: BeeGameSessionRunner = {
      start: async startInput => ({
        submit: async () => {
          decisionPromise = startInput.requestPermission?.({
            toolUseID: 'implementation-import-1',
            toolName: 'ResourceLibrary',
            message: 'Use resource matching outside the resource phase',
            input: {
              action: 'match_requirements',
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
        toolName: 'ResourceLibrary',
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

  test('relays native Claude Code permission requests without BeeGame policy decisions', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-native-permission-relay-'))
    const workspacePath = join(root, 'workspace')
    let decisionPromise: Promise<DashboardPermissionDecision> | undefined
    const runner: BeeGameSessionRunner = {
      start: async startInput => ({
        submit: async () => {
          decisionPromise = startInput.requestPermission?.({
            toolUseID: 'native-write-request',
            toolName: 'Write',
            message: 'Claude Code requests permission',
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
    ).toEqual([
      expect.objectContaining({
        toolUseID: 'native-write-request',
        toolName: 'Write',
      }),
    ])
    manager.resolveProjectPermission(
      'user-1',
      'project-1',
      workspacePath,
      'native-write-request',
      { behavior: 'allow', scope: 'once' },
    )
    expect(await decisionPromise).toEqual({ behavior: 'allow', scope: 'once' })
    manager.dispose()
  })

  test('passes selected model and native Claude config without BeeGame behavior overrides', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-transparent-model-env-'))
    const workspacePath = join(root, 'workspace')
    let runtimeEnv: Record<string, string> | undefined
    const runner: BeeGameSessionRunner = {
      start: async input => {
        runtimeEnv = input.env
        return {
          submit: async () => {},
          stop: () => undefined,
        }
      },
    }
    const manager = new BeeGameSessionManager(
      runner,
      root,
      async () => ({
        ANTHROPIC_BASE_URL: 'https://provider.example',
        ANTHROPIC_AUTH_TOKEN: 'provider-token',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'selected-model',
        CLAUDE_CONFIG_DIR: '/bgs/managed/config',
        BEEGAME_CONFIG_DIR: '/bgs/config',
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
        FEATURE_BASH_CLASSIFIER: '0',
        NPM_CONFIG_USERCONFIG: '/bgs/npmrc',
      }),
    )
    const session = manager.start({ workspacePath, userId: 'user-1' })

    await manager.send(session.id, 'run the task')
    await waitForIdle(manager, session.id)

    expect(runtimeEnv).toEqual({
      ANTHROPIC_BASE_URL: 'https://provider.example',
      ANTHROPIC_AUTH_TOKEN: 'provider-token',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'selected-model',
      CLAUDE_CONFIG_DIR: '/bgs/managed/config',
    })
    manager.dispose()
  })

  test('surfaces a native runtime failure without restarting Claude Code', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-runtime-retry-'))
    let starts = 0
    const runner: BeeGameSessionRunner = {
      start: async () => {
        starts += 1
        const current = starts
        return {
          submit: async () => {
            if (current === 1) {
              throw new QueryEngineWorkerError({
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
      workflowWorkerType: 'document-reviewer',
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
                  id: 'document-terminal-1',
                  name: 'CommitCanonicalDocument',
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
      workflowWorkerType: 'document-reviewer',
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
      workflowWorkerType: 'document-reviewer',
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

  test('fails a document author with the exact oversized native write error', async () => {
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
                partial_json: 'x'.repeat(DOCUMENT_NATIVE_WRITE_MAX_BYTES + 1),
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
      manager.events(session.id).find(event => event.type === 'turn.failed')?.text,
    ).toContain('document_native_write_input_too_large')
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
            throw new QueryEngineWorkerError({
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

  test('coalesces cumulative usage snapshots while a write is in flight', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-usage-coalesce-'))
    const recorded: Usage[] = []
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
        recorded.push(input.usage)
        if (recorded.length === 1) {
          await new Promise(resolve => setTimeout(resolve, 25))
        }
        return usageResult(input.usage, input.idempotencyKey)
      },
    })
    const session = manager.start({
      workspacePath: join(root, 'workspace'),
      userId: 'user-1',
    })

    await manager.send(session.id, 'continue')
    await waitForIdle(manager, session.id)

    expect(recorded).toHaveLength(2)
    expect(recorded[1]!.total_tokens).toBeGreaterThan(recorded[0]!.total_tokens)
    manager.dispose()
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
})
