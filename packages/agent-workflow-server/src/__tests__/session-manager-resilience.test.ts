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
import { getObservedNativeResourceLibraryEvidence } from '../beegame/native-resource-library-evidence'
import { SupabaseRuntimeEnvRequestError } from '../supabase-runtime-env-client'
import { createRunStore } from '../beegame/delivery-workflow/run-store'
import { createTestDeliveryRun } from './delivery-workflow-test-helpers'

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
      ['AssetManifest', { action: 'register_authored_resources' }],
      ['ResourceLibrary', { action: 'import_resources' }],
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
          input: { action: 'browse_catalog' },
        },
        createdAt: new Date(),
      }),
    ).toBe(false)
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
                name: 'SubmitDocumentReviewResult',
                input: {},
              },
            },
          } as DashboardSDKMessage)
          await streamGate
          input.onMessage({
            type: 'assistant',
            message: {
              content: [{
                type: 'tool_use',
                id: 'review-terminal-1',
                name: 'SubmitDocumentReviewResult',
                input: {},
              }],
            },
          })
          input.onMessage({
            type: 'user',
            message: {
              content: [{
                type: 'tool_result',
                tool_use_id: 'review-terminal-1',
                content: 'accepted',
              }],
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
      if (manager.hasInFlightToolSubmission(
        session.id,
        'SubmitDocumentReviewResult',
      )) break
      await new Promise(resolve => setTimeout(resolve, 2))
    }
    expect(manager.hasInFlightToolSubmission(
      session.id,
      'SubmitDocumentReviewResult',
    )).toBe(true)
    releaseStream()
    await send
    expect(manager.hasInFlightToolSubmission(
      session.id,
      'SubmitDocumentReviewResult',
    )).toBe(false)
  })

  test('records native Resource Library provenance from workflow workers', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-resource-worker-evidence-'))
    const workspacePath = join(root, 'workspace')
    const runner: BeeGameSessionRunner = {
      start: async () => ({
        submit: async input => {
          input.onMessage({
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: 'resource-tool-1',
                  name: 'ResourceLibrary',
                  input: {
                    action: 'browse_catalog',
                    filters: { dimensions: ['3D'] },
                  },
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
                  tool_use_id: 'resource-tool-1',
                  content: JSON.stringify({ result: 'inspected' }),
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
      workflowWorkerType: 'resource-preparer',
    })

    await manager.send(session.id, 'prepare resources')
    await waitForIdle(manager, session.id)

    expect(
      getObservedNativeResourceLibraryEvidence({
        dataRoot: root,
        sessionId: session.id,
        workspacePath,
      }),
    ).toMatchObject({
      state: 'current',
      actions: ['browse_catalog'],
      failedActions: [],
    })
    manager.dispose()
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
    })
    const startedAt = new Date().toISOString()
    await store.save({
      ...initial,
      phase: 'RESOURCE_PREPARATION',
      lastProgressAt: startedAt,
      activeDispatch: {
        dispatchId: 'dispatch-1',
        workerType: 'resource-preparer',
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
                    action: 'browse_catalog',
                    filters: { dimensions: ['3D'] },
                  },
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
      language: 'zh',
      workflowWorker: true,
      workflowRunId: 'run-1',
      workflowDispatchId: 'dispatch-1',
      workflowWorkerType: 'resource-preparer',
    })

    await manager.send(session.id, 'prepare resources')
    await waitForIdle(manager, session.id)
    const run = await store.load()

    expect(run?.currentMessage).toBe('正在浏览资源库…')
    expect(run?.lastProgressAt).toBe(startedAt)
    manager.dispose()
  })

  test('auto-approves only an exact Resource Library import for the resource worker', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-resource-worker-permission-'))
    const workspacePath = join(root, 'workspace')
    let decision: DashboardPermissionDecision | undefined
    let outsideDecision: DashboardPermissionDecision | undefined
    const runner: BeeGameSessionRunner = {
      start: async startInput => ({
        submit: async () => {
          decision = await startInput.requestPermission?.({
            toolUseID: 'resource-import-1',
            toolName: 'ResourceLibrary',
            message: 'Import selected resources',
            input: {
              action: 'import_resources',
              selections: [
                {
                  resource_id: 'selected-resource',
                  pack_id: 'pack-1',
                  expected_pack_version: '1.0.0',
                  element_id: 'element-1',
                  destination_path: 'assets/runtime/selected-resource',
                  selection_reason: ['Observed fit.'],
                },
              ],
            },
          })
          outsideDecision = await startInput.requestPermission?.({
            toolUseID: 'resource-import-outside',
            toolName: 'ResourceLibrary',
            message: 'Import selected resources',
            input: {
              action: 'import_resources',
              selections: [
                {
                  resource_id: 'outside-resource',
                  pack_id: 'pack-1',
                  expected_pack_version: '1.0.0',
                  element_id: 'element-2',
                  destination_path: '../outside/resource',
                  selection_reason: ['Observed fit.'],
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
      projectId: 'project-1',
      userId: 'user-1',
      workflowWorker: true,
      workflowRunId: 'run-1',
      workflowDispatchId: 'dispatch-1',
      workflowWorkerType: 'resource-preparer',
      workflowAllowedPaths: ['assets/'],
    })

    await manager.send(session.id, 'prepare resources')
    await waitForIdle(manager, session.id)

    expect(decision).toEqual({ behavior: 'allow', scope: 'once' })
    expect(outsideDecision).toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining('outside the current project workspace'),
    })
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
        .find(
          event =>
            event.type === 'permission.resolved' &&
            event.payload?.toolUseID === 'resource-import-1',
        )?.payload,
    ).toMatchObject({
      decision: 'allow',
      scope: 'once',
      autoApproved: true,
      reason: 'workflow_resource_preparer_import',
    })
    manager.dispose()
  })

  test('hard-enforces the sole resource-production mutation boundaries', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-resource-repair-permission-'))
    const workspacePath = join(root, 'workspace')
    await mkdir(join(workspacePath, 'assets'), { recursive: true })
    await writeFile(
      join(workspacePath, 'assets/asset-manifest.json'),
      JSON.stringify({
        version: 7,
        project_target: {
          asset_format_capabilities: ['glb'],
          runtime_asset_root: 'assets/runtime',
          content_root: 'assets/content',
          generated_asset_root: 'assets/generated',
        },
        requirements: [
          {
            id: 'model',
          },
        ],
        resources: [],
      }),
    )
    const decisions: Record<string, DashboardPermissionDecision | undefined> =
      {}
    const runner: BeeGameSessionRunner = {
      start: async startInput => ({
        submit: async () => {
          decisions.manifestWrite = await startInput.requestPermission?.({
            toolUseID: 'manifest-write',
            toolName: 'Write',
            message: 'Write canonical manifest',
            input: {
              file_path: join(workspacePath, 'assets/asset-manifest.json'),
            },
          })
          decisions.sourceWrite = await startInput.requestPermission?.({
            toolUseID: 'source-write',
            toolName: 'Write',
            message: 'Write source stub',
            input: { file_path: join(workspacePath, 'src/scene.ts') },
          })
          decisions.unsupportedResourceWrite =
            await startInput.requestPermission?.({
              toolUseID: 'unsupported-resource-write',
              toolName: 'Write',
              message: 'Write an unsupported resource format',
              input: {
                file_path: join(workspacePath, 'assets/runtime/audio.json'),
              },
            })
          decisions.binaryResourceWrite =
            await startInput.requestPermission?.({
              toolUseID: 'binary-resource-write',
              toolName: 'Write',
              message: 'Write binary media through a text tool',
              input: {
                file_path: join(workspacePath, 'assets/runtime/model.glb'),
              },
            })
          decisions.programmaticResourceWrite =
            await startInput.requestPermission?.({
              toolUseID: 'programmatic-resource-write',
              toolName: 'Write',
              message: 'Write an executable programmatic source resource',
              input: {
                file_path: join(
                  workspacePath,
                  'assets/generated/generated-audio.json',
                ),
                content: JSON.stringify({
                  format: 'beegame-programmatic-audio-v1',
                  cues: [
                    {
                      id: 'cue',
                      duration_ms: 100,
                      voices: [
                        {
                          source: {
                            type: 'oscillator',
                            waveform: 'sine',
                            frequency_hz: 440,
                          },
                          start_ms: 0,
                          duration_ms: 100,
                          gain: 0.1,
                        },
                      ],
                    },
                  ],
                }),
              },
            })
          decisions.invalidProgrammaticResourceWrite =
            await startInput.requestPermission?.({
              toolUseID: 'invalid-programmatic-resource-write',
              toolName: 'Write',
              message: 'Write an invalid programmatic source resource',
              input: {
                file_path: join(
                  workspacePath,
                  'assets/generated/invalid-generated-audio.json',
                ),
                content: JSON.stringify({
                  format: 'beegame-programmatic-audio-v1',
                  cues: [
                    {
                      id: 'cue',
                      variants: [{ waveform: 'sine', frequency: 440 }],
                    },
                  ],
                }),
              },
            })
          decisions.import = await startInput.requestPermission?.({
            toolUseID: 'repair-import',
            toolName: 'ResourceLibrary',
            message: 'Import replacement inventory',
            input: {
              action: 'import_resources',
              selections: [
                {
                  resource_id: 'replacement',
                  pack_id: 'pack-1',
                  expected_pack_version: '1.0.0',
                  element_id: 'element-1',
                  destination_path: 'assets/runtime/replacement',
                  selection_reason: ['Observed fit.'],
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
      projectId: 'project-1',
      userId: 'user-1',
      workflowWorker: true,
      workflowRunId: 'run-1',
      workflowDispatchId: 'dispatch-1',
      workflowWorkerType: 'resource-preparer',
      workflowAllowedPaths: [
        'assets/asset-manifest.json',
        'assets/runtime/',
        'assets/content/',
        'assets/generated/',
      ],
    })

    await manager.send(session.id, 'repair resources')
    await waitForIdle(manager, session.id)

    expect(decisions.manifestWrite).toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining('only through AssetManifest'),
    })
    expect(decisions.sourceWrite).toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining('outside its declared phase scope'),
    })
    expect(decisions.unsupportedResourceWrite).toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining('does not support that format'),
    })
    expect(decisions.binaryResourceWrite).toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining('author_encoded_resources'),
    })
    expect(decisions.programmaticResourceWrite).toEqual({
      behavior: 'allow',
      scope: 'once',
    })
    expect(decisions.invalidProgrammaticResourceWrite).toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining(
        'must match beegame-programmatic-audio-v1 before it is written',
      ),
    })
    expect(
      manager
        .events(session.id)
        .find(
          event =>
            event.payload?.toolUseID ===
              'invalid-programmatic-resource-write' &&
            event.type === 'permission.resolved',
        )?.payload?.reasonCode,
    ).toBe('resource_contract_invalid')
    expect(
      manager
        .events(session.id)
        .find(
          event =>
            event.payload?.toolUseID === 'unsupported-resource-write' &&
            event.type === 'permission.resolved',
        )?.payload?.reasonCode,
    ).toBe('resource_target_format_unsupported')
    expect(decisions.import).toEqual({ behavior: 'allow', scope: 'once' })
    expect(
      manager.pendingPermissionsForProject(
        'user-1',
        'project-1',
        workspacePath,
      ),
    ).toEqual([])
    manager.dispose()
  })

  test('denies a generic manifest write during resource selection', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-resource-selection-write-'))
    const workspacePath = join(root, 'workspace')
    await mkdir(join(workspacePath, 'assets'), { recursive: true })
    let decision: DashboardPermissionDecision | undefined
    const runner: BeeGameSessionRunner = {
      start: async startInput => ({
        submit: async () => {
          decision = await startInput.requestPermission?.({
            toolUseID: 'selection-manifest-write',
            toolName: 'Write',
            message: 'Write a selection result directly',
            input: {
              file_path: join(workspacePath, 'assets/asset-manifest.json'),
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
      workflowWorkerType: 'resource-preparer',
      workflowAllowedPaths: [
        'assets/asset-manifest.json',
        'assets/runtime/',
        'assets/content/',
        'assets/generated/',
      ],
    })

    await manager.send(session.id, 'select resources')
    await waitForIdle(manager, session.id)

    expect(decision).toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining('only through AssetManifest'),
    })
    manager.dispose()
  })

  test('denies external-web permission without parking a workflow worker', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-workflow-web-permission-'))
    const workspacePath = join(root, 'workspace')
    await mkdir(workspacePath, { recursive: true })
    let decision: DashboardPermissionDecision | undefined
    const runner: BeeGameSessionRunner = {
      start: async startInput => ({
        submit: async () => {
          decision = await startInput.requestPermission?.({
            toolUseID: 'document-web-search',
            toolName: 'WebSearch',
            message: 'Search external compatibility notes',
            input: { query: 'browser audio support' },
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

    await manager.send(session.id, 'repair documents')
    await waitForIdle(manager, session.id)

    expect(decision).toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining('cannot pause'),
    })
    expect(
      manager.pendingPermissionsForProject(
        'user-1',
        'project-1',
        workspacePath,
      ),
    ).toEqual([])
    manager.dispose()
  })

  test('allows one completed document mutation per path in a dispatch', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-document-mutation-boundary-'))
    const workspacePath = join(root, 'workspace')
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    let repeatedDecision: DashboardPermissionDecision | undefined
    let otherDocumentDecision: DashboardPermissionDecision | undefined
    const runner: BeeGameSessionRunner = {
      start: async () => ({
        submit: async input => {
          input.onMessage({
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: 'document-write-1',
                  name: 'MultiEdit',
                  input: { file_path: join(workspacePath, 'docs/GDD.md') },
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
                  tool_use_id: 'document-write-1',
                  content: 'updated',
                },
              ],
            },
          })
          repeatedDecision = await input.requestPermission({
            toolUseID: 'document-write-2',
            toolName: 'MultiEdit',
            message: 'Rewrite the same document',
            input: { file_path: join(workspacePath, 'docs/GDD.md') },
          })
          otherDocumentDecision = await input.requestPermission({
            toolUseID: 'document-write-3',
            toolName: 'MultiEdit',
            message: 'Update another assigned document',
            input: {
              file_path: join(workspacePath, 'docs/TECHNICAL_DESIGN.md'),
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
      workflowWorkerType: 'document-author',
      workflowAllowedPaths: ['docs/GDD.md', 'docs/TECHNICAL_DESIGN.md'],
    })

    await manager.send(session.id, 'repair documents')
    await waitForIdle(manager, session.id)

    expect(repeatedDecision).toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining('one successful mutation'),
    })
    expect(otherDocumentDecision).toEqual({
      behavior: 'allow',
      scope: 'once',
    })
    manager.dispose()
  })

  test('keeps implementation reads inside current project source and direct dependencies', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-implementation-read-scope-'))
    const workspacePath = join(root, 'workspace')
    await mkdir(join(workspacePath, 'src'), { recursive: true })
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    const decisions: Record<string, DashboardPermissionDecision | undefined> =
      {}
    const runner: BeeGameSessionRunner = {
      start: async startInput => ({
        submit: async () => {
          decisions.source = await startInput.requestPermission?.({
            toolUseID: 'implementation-source-read',
            toolName: 'Read',
            message: 'Read a direct source dependency',
            input: { file_path: join(workspacePath, 'src/input.ts') },
          })
          decisions.document = await startInput.requestPermission?.({
            toolUseID: 'implementation-document-read',
            toolName: 'Read',
            message: 'Reread canonical design authority',
            input: { file_path: join(workspacePath, 'docs/GDD.md') },
          })
          decisions.workflow = await startInput.requestPermission?.({
            toolUseID: 'implementation-workflow-read',
            toolName: 'Read',
            message: 'Inspect workflow history',
            input: {
              file_path: join(workspacePath, '.beegame/workflow/run.json'),
            },
          })
          decisions.outside = await startInput.requestPermission?.({
            toolUseID: 'implementation-outside-read',
            toolName: 'Read',
            message: 'Read outside workspace',
            input: { file_path: join(root, 'outside.ts') },
          })
          decisions.shellSource = await startInput.requestPermission?.({
            toolUseID: 'implementation-shell-source-read',
            toolName: 'Bash',
            message: 'Inspect a direct source dependency',
            input: {
              command: `sed -n '1,20p' ${join(workspacePath, 'src/input.ts')}`,
            },
          })
          decisions.shellWorkflow = await startInput.requestPermission?.({
            toolUseID: 'implementation-shell-workflow-read',
            toolName: 'Bash',
            message: 'Inspect workflow history through the shell',
            input: {
              command: `cat ${join(workspacePath, '.beegame/workflow/run.json')}`,
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
      workflowAllowedPaths: ['src/output.ts'],
    })

    await manager.send(session.id, 'implement task')
    await waitForIdle(manager, session.id)

    expect(decisions.source).toEqual({ behavior: 'allow', scope: 'once' })
    expect(decisions.shellSource).toEqual({ behavior: 'allow', scope: 'once' })
    for (const key of ['document', 'workflow']) {
      expect(decisions[key]).toMatchObject({
        behavior: 'deny',
        message: expect.stringContaining('active task as acceptance authority'),
      })
    }
    expect(decisions.outside).toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining('outside the current project workspace'),
    })
    expect(decisions.shellWorkflow).toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining('active task as acceptance authority'),
    })
    manager.dispose()
  })

  test('keeps atomic planning single-pass by denying workspace exploration while allowing evidence output', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-planner-permission-'))
    const workspacePath = join(root, 'workspace')
    await mkdir(join(workspacePath, '.beegame/workflow/evidence'), {
      recursive: true,
    })
    const decisions: Record<string, DashboardPermissionDecision | undefined> =
      {}
    const runner: BeeGameSessionRunner = {
      start: async startInput => ({
        submit: async () => {
          for (const toolName of ['Read', 'Grep', 'Bash', 'Agent']) {
            decisions[toolName] = await startInput.requestPermission?.({
              toolUseID: `planner-${toolName}`,
              toolName,
              message: `Planner requested ${toolName}`,
              input:
                toolName === 'Bash'
                  ? { command: 'find docs -type f' }
                  : toolName === 'Agent'
                    ? { prompt: 'plan a shard' }
                    : { path: join(workspacePath, 'docs/GDD.md') },
            })
          }
          decisions.Write = await startInput.requestPermission?.({
            toolUseID: 'planner-write',
            toolName: 'Write',
            message: 'Write canonical planning evidence',
            input: {
              file_path: join(
                workspacePath,
                '.beegame/workflow/evidence/plan.json',
              ),
            },
          })
          decisions.Edit = await startInput.requestPermission?.({
            toolUseID: 'planner-rewrite',
            toolName: 'Edit',
            message: 'Rewrite planning evidence after local validation',
            input: {
              file_path: join(
                workspacePath,
                '.beegame/workflow/evidence/plan.json',
              ),
              old_string: 'old',
              new_string: 'new',
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
      workflowWorkerType: 'atomic-task-planner',
      workflowAllowedPaths: ['.beegame/workflow/evidence/'],
    })

    await manager.send(session.id, 'plan implementation tasks')
    await waitForIdle(manager, session.id)

    for (const toolName of ['Read', 'Grep', 'Bash', 'Agent'])
      expect(decisions[toolName]).toMatchObject({
        behavior: 'deny',
        message: expect.stringContaining('planningDocuments'),
      })
    expect(decisions.Write).toEqual({ behavior: 'allow', scope: 'once' })
    expect(decisions.Edit).toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining('exactly one evidence mutation'),
    })
    expect(
      manager.pendingPermissionsForProject(
        'user-1',
        'project-1',
        workspacePath,
      ),
    ).toEqual([])
    manager.dispose()
  })

  test('denies metadata refresh until the canonical inventory is valid', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-resource-refresh-order-'))
    const workspacePath = join(root, 'workspace')
    await mkdir(join(workspacePath, 'assets/runtime'), { recursive: true })
    await writeFile(join(workspacePath, 'assets/runtime/model.fbx'), 'fbx')
    await writeFile(
      join(workspacePath, 'assets/asset-manifest.json'),
      JSON.stringify({
        version: 7,
        project_target: {
          asset_format_capabilities: ['glb'],
          runtime_asset_root: 'assets/runtime',
          content_root: 'assets/content',
          generated_asset_root: 'assets/generated',
        },
        requirements: [
          {
            id: 'model',
          },
        ],
        resources: [
          {
            id: 'model',
            source: {
              type: 'resource-library',
              pack_id: 'pack-1',
              pack_version: '1.0.0',
              element_id: 'model',
              element_path: 'model.fbx',
            },
            provisional: false,
            status: 'verified',
            root_path: 'assets/runtime/model.fbx',
            file_paths: ['assets/runtime/model.fbx'],
            selected_at: new Date().toISOString(),
            selection_reason: ['Approved inventory'],
          },
        ],
      }),
    )
    let decision: DashboardPermissionDecision | undefined
    const runner: BeeGameSessionRunner = {
      start: async startInput => ({
        submit: async () => {
          decision = await startInput.requestPermission?.({
            toolUseID: 'refresh-before-final-manifest',
            toolName: 'ResourceLibrary',
            message: 'Refresh metadata',
            input: { action: 'refresh_resource_metadata' },
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
      workflowWorkerType: 'resource-preparer',
      workflowAllowedPaths: [
        'assets/asset-manifest.json',
        'assets/runtime/',
        'assets/content/',
        'assets/generated/',
      ],
    })

    await manager.send(session.id, 'repair resources')
    await waitForIdle(manager, session.id)

    expect(decision).toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining('Finalize and validate'),
    })
    manager.dispose()
  })

  test('keeps Resource Library imports interactive for other workflow workers', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-non-resource-permission-'))
    const workspacePath = join(root, 'workspace')
    let decisionPromise: Promise<DashboardPermissionDecision> | undefined
    const runner: BeeGameSessionRunner = {
      start: async startInput => ({
        submit: async () => {
          decisionPromise = startInput.requestPermission?.({
            toolUseID: 'implementation-import-1',
            toolName: 'ResourceLibrary',
            message: 'Import selected resources',
            input: {
              action: 'import_resources',
              selections: [
                {
                  resource_id: 'selected-resource',
                  pack_id: 'pack-1',
                  expected_pack_version: '1.0.0',
                  element_id: 'element-1',
                  destination_path: 'assets/runtime/selected-resource',
                  selection_reason: ['Observed fit.'],
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

  test('restarts once when a retryable worker failure precedes all runtime messages', async () => {
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

    expect(starts).toBe(2)
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
