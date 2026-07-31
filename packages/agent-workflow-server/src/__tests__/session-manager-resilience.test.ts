import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BeeGameSessionManager,
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
import {
  createInitialDeliveryRun,
  createRunStore,
} from '../beegame/delivery-workflow/run-store'

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
                    action: 'query_candidates',
                    requirement_ids: ['ground'],
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
      actions: ['query_candidates'],
      failedActions: [],
    })
    manager.dispose()
  })

  test('publishes structural resource activity without claiming durable progress', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-resource-worker-progress-'))
    const workspacePath = join(root, 'workspace')
    const store = createRunStore(workspacePath, 'user-1')
    const initial = createInitialDeliveryRun({
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
                    action: 'query_candidates',
                    requirement_ids: ['ground'],
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

    expect(run?.currentMessage).toBe('正在查询精确资源候选…')
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
              action: 'import_elements',
              selections: [
                {
                  import_id: 'selected-resource',
                  pack_id: 'pack-1',
                  element_id: 'element-1',
                  destination_path: 'assets/library/selected-resource',
                },
              ],
            },
          })
          outsideDecision = await startInput.requestPermission?.({
            toolUseID: 'resource-import-outside',
            toolName: 'ResourceLibrary',
            message: 'Import selected resources',
            input: {
              action: 'import_elements',
              selections: [
                {
                  import_id: 'outside-resource',
                  pack_id: 'pack-1',
                  element_id: 'element-2',
                  destination_path: '../outside/resource',
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

  test('hard-enforces resource phase writes and preserves canonical inventory in repair mode', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-resource-repair-permission-'))
    const workspacePath = join(root, 'workspace')
    await mkdir(join(workspacePath, 'assets'), { recursive: true })
    await writeFile(
      join(workspacePath, 'assets/asset-manifest.json'),
      JSON.stringify({
        version: 5,
        project_target: {
          asset_format_capabilities: ['glb'],
          resource_library_usage: 'preferred',
          runtime_asset_root: 'assets/library',
        },
        requirements: [
          {
            id: 'model',
            status: 'planned',
            resource_requirement: {
              accepted_formats: ['glb'],
              import_budget: 1,
              no_match: 'authored-asset',
            },
          },
        ],
        imports: [],
        compositions: [],
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
          decisions.bash = await startInput.requestPermission?.({
            toolUseID: 'resource-bash',
            toolName: 'Bash',
            message: 'Use shell in resource phase',
            input: { command: 'touch assets/asset-manifest.json' },
          })
          decisions.import = await startInput.requestPermission?.({
            toolUseID: 'repair-import',
            toolName: 'ResourceLibrary',
            message: 'Import replacement inventory',
            input: {
              action: 'import_elements',
              selections: [
                {
                  import_id: 'replacement',
                  pack_id: 'pack-1',
                  element_id: 'element-1',
                  destination_path: 'assets/library/replacement',
                },
              ],
            },
          })
          decisions.refresh = await startInput.requestPermission?.({
            toolUseID: 'repair-refresh',
            toolName: 'ResourceLibrary',
            message: 'Refresh existing inventory metadata',
            input: { action: 'refresh_import_metadata' },
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
      workflowResourceAttemptMode: 'repair',
      workflowAllowedPaths: ['assets/asset-manifest.json', 'assets/library/'],
    })

    await manager.send(session.id, 'repair resources')
    await waitForIdle(manager, session.id)

    expect(decisions.manifestWrite).toEqual({
      behavior: 'allow',
      scope: 'once',
    })
    expect(decisions.sourceWrite).toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining('outside its declared phase scope'),
    })
    expect(decisions.bash).toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining(
        'direct ResourceLibrary tool and scoped file tools',
      ),
    })
    expect(decisions.import).toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining('preserve the canonical inventory'),
    })
    expect(decisions.refresh).toEqual({ behavior: 'allow', scope: 'once' })
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
      workflowResourceAttemptMode: 'selection',
      workflowAllowedPaths: ['assets/asset-manifest.json', 'assets/library/'],
    })

    await manager.send(session.id, 'select resources')
    await waitForIdle(manager, session.id)

    expect(decision).toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining('second manifest or inventory write lane'),
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

  test('denies repair metadata refresh until the final manifest is compatible', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-resource-refresh-order-'))
    const workspacePath = join(root, 'workspace')
    await mkdir(join(workspacePath, 'assets/library'), { recursive: true })
    await writeFile(join(workspacePath, 'assets/library/model.fbx'), 'fbx')
    await writeFile(
      join(workspacePath, 'assets/asset-manifest.json'),
      JSON.stringify({
        version: 5,
        project_target: {
          asset_format_capabilities: ['glb'],
          resource_library_usage: 'preferred',
          runtime_asset_root: 'assets/library',
        },
        requirements: [
          {
            id: 'model',
            status: 'planned',
            resource_requirement: {
              accepted_formats: ['glb'],
              import_budget: 1,
              no_match: 'authored-asset',
            },
            satisfied_by: { import_ids: ['model'] },
          },
        ],
        imports: [
          {
            id: 'model',
            source: {
              type: 'resource-library',
              pack_id: 'pack-1',
              pack_version: '1.0.0',
              element_id: 'model',
              element_path: 'model.fbx',
            },
            status: 'available',
            root_path: 'assets/library/model.fbx',
            local_files: ['assets/library/model.fbx'],
            selected_at: new Date().toISOString(),
            selection_reason: ['Approved inventory'],
          },
        ],
        compositions: [],
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
            input: { action: 'refresh_import_metadata' },
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
      workflowResourceAttemptMode: 'repair',
      workflowAllowedPaths: ['assets/asset-manifest.json', 'assets/library/'],
    })

    await manager.send(session.id, 'repair resources')
    await waitForIdle(manager, session.id)

    expect(decision).toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining(
        'Imported root format fbx is not supported',
      ),
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
              action: 'import_elements',
              selections: [
                {
                  import_id: 'selected-resource',
                  pack_id: 'pack-1',
                  element_id: 'element-1',
                  destination_path: 'assets/library/selected-resource',
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
