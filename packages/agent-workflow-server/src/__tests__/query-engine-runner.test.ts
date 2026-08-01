import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  closeBeeGameRuntimeDispatcher,
  consumeNativeMessageStream,
  createNativeNotificationQueue,
  createNativeSdkEventQueue,
  createBeeGameToolPermissionContext,
  createBeeGamePinnedFetch,
  ensureBeeGameMacroGlobals,
  drainNativeBackgroundNotifications,
  getCompletedNativeTaskOutputTaskId,
  getBeeGameResponseLanguageInstruction,
  getBeeGameWorkflowThinkingConfig,
  hasRunningNativeBackgroundTasks,
  initializeBeeGameNativeSandbox,
  initializeBeeGameNativeQueryMode,
  installInheritedBeeGameTools,
  NativeResourceLibraryPermissionBroker,
  ResourceCatalogTurnGate,
  NativeBackgroundTaskLedger,
  NativeSandboxNetworkPermissionBroker,
  parseNativeTerminalTaskNotification,
  resolveBeeGameSkillReadRoots,
  requiresBeeGameWorkflowBoundaryCheck,
  selectBeeGameWorkerTools,
  type MutableAppState,
  stopRunningLocalShellTasks,
} from '../beegame/query-engine-runner'
import type { ApprovedOutboundTarget } from '@bee-game-studio/security-core'

describe('QueryEngineSessionRuntime shell cleanup', () => {
  test('disables extended thinking for structured planning and implementation workers', () => {
    expect(getBeeGameWorkflowThinkingConfig('atomic-task-planner')).toEqual({
      type: 'disabled',
    })
    expect(getBeeGameWorkflowThinkingConfig('implementation-worker')).toEqual({
      type: 'disabled',
    })
    expect(
      getBeeGameWorkflowThinkingConfig('document-reviewer'),
    ).toBeUndefined()
    expect(getBeeGameWorkflowThinkingConfig()).toBeUndefined()
  })

  test('forces atomic task planner exploration through the workflow permission boundary', () => {
    for (const toolName of [
      'Agent',
      'Bash',
      'Glob',
      'Grep',
      'LS',
      'NotebookRead',
      'Read',
      'Task',
    ]) {
      expect(
        requiresBeeGameWorkflowBoundaryCheck(
          {
            workflowWorker: true,
            workflowWorkerType: 'atomic-task-planner',
          },
          toolName,
        ),
      ).toBe(true)
    }

    expect(
      requiresBeeGameWorkflowBoundaryCheck(
        {
          workflowWorker: true,
          workflowWorkerType: 'implementation-worker',
        },
        'Read',
      ),
    ).toBe(true)

  })

  test('preserves workflow mutation boundaries without exposing resource shell access', () => {
    expect(
      requiresBeeGameWorkflowBoundaryCheck(
        {
          workflowWorker: true,
          workflowWorkerType: 'implementation-worker',
        },
        'Write',
      ),
    ).toBe(true)
    expect(
      requiresBeeGameWorkflowBoundaryCheck(
        {
          workflowWorker: true,
          workflowWorkerType: 'resource-preparer',
        },
        'Bash',
      ),
    ).toBe(false)
    expect(
      requiresBeeGameWorkflowBoundaryCheck(
        {
          workflowWorker: false,
          workflowWorkerType: 'atomic-task-planner',
        },
        'Read',
      ),
    ).toBe(false)
    expect(
      requiresBeeGameWorkflowBoundaryCheck(
        {
          workflowWorker: true,
          workflowWorkerType: 'implementation-worker',
        },
        'WebSearch',
      ),
    ).toBe(true)
    expect(
      requiresBeeGameWorkflowBoundaryCheck(
        {
          workflowWorker: false,
          workflowWorkerType: 'implementation-worker',
        },
        'WebSearch',
      ),
    ).toBe(false)
  })

  test('removes deferred tool wrappers from every workflow worker terminal lane', () => {
    const tools = [
      { name: 'Read' },
      { name: 'SearchExtraTools' },
      { name: 'ExecuteExtraTool' },
      { name: 'Task' },
      { name: 'SubmitDocumentAuthorResult' },
    ]

    expect(
      selectBeeGameWorkerTools(tools, 'document-author').map(
        tool => (tool as { name: string }).name,
      ),
    ).toEqual(['Read'])
    expect(selectBeeGameWorkerTools(tools, 'document-reviewer')).toEqual([])

    expect(
      selectBeeGameWorkerTools(tools, 'resource-preparer').map(
        tool => (tool as { name: string }).name,
      ),
    ).toEqual(['Read'])

    for (const workerType of [
      'implementation-worker',
      'implementation-auditor',
      'acceptance-validator',
      'change-impact-analyzer',
      'question-answerer',
    ]) {
      expect(
        selectBeeGameWorkerTools(tools, workerType).map(
          tool => (tool as { name: string }).name,
        ),
      ).toEqual(['Read', 'Task', 'SubmitDocumentAuthorResult'])
    }

    expect(selectBeeGameWorkerTools(tools)).toEqual(tools)
    expect(selectBeeGameWorkerTools(tools, 'unrelated-agent')).toEqual(tools)
  })

  test('keeps scoped file tools for resource production', () => {
    const tools = [
      { name: 'Read' },
      { name: 'Write' },
      { name: 'Edit' },
      { name: 'MultiEdit' },
      { name: 'NotebookEdit' },
      { name: 'Bash' },
      { name: 'TodoWrite' },
    ]

    expect(
      selectBeeGameWorkerTools(tools, 'resource-preparer').map(
        tool => (tool as { name: string }).name,
      ),
    ).toEqual(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
  })

  test('gives resource production one scoped file lane without shell or nested agents', () => {
    const tools = [
      { name: 'Read' },
      { name: 'Write' },
      { name: 'Glob' },
      { name: 'Bash' },
      { name: 'Agent' },
      { name: 'Task' },
      { name: 'WebSearch' },
    ]

    expect(
      selectBeeGameWorkerTools(tools, 'resource-preparer').map(
        tool => (tool as { name: string }).name,
      ),
    ).toEqual(['Read', 'Write', 'Glob'])
  })

  test('keeps document writes batchable without the incremental Edit lane', () => {
    const tools = [
      { name: 'Read' },
      { name: 'Write' },
      { name: 'Edit' },
      { name: 'MultiEdit' },
    ]

    expect(
      selectBeeGameWorkerTools(tools, 'document-author').map(
        tool => (tool as { name: string }).name,
      ),
    ).toEqual(['Read', 'Write', 'MultiEdit'])
  })

  test('removes file and exploration lanes from the atomic planner', () => {
    const tools = [
      { name: 'Read' },
      { name: 'Bash' },
      { name: 'Write' },
      { name: 'Edit' },
      { name: 'Agent' },
    ]

    expect(
      selectBeeGameWorkerTools(tools, 'atomic-task-planner').map(
        tool => (tool as { name: string }).name,
      ),
    ).toEqual([])
  })

  test('inherits operational capabilities but keeps terminal tools on the main worker', () => {
    const existing = { name: 'existing-mcp-tool' }
    const resourceLibrary = { name: 'ResourceLibrary' }
    const terminalTools = [
      'AssetManifest',
      'SubmitAtomicTaskPlan',
      'SubmitImplementationResult',
      'SubmitValidationResult',
      'SubmitDocumentAuthorResult',
      'SubmitDocumentReviewResult',
      'SubmitChangeImpactResult',
      'SubmitQuestionAnswerResult',
    ].map(name => ({ name }))
    const state = installInheritedBeeGameTools(
      {
        mcp: {
          clients: [],
          tools: [existing],
          commands: [],
          resources: {},
        },
      },
      [resourceLibrary, ...terminalTools],
    )

    expect((state.mcp as { tools: unknown[] }).tools).toEqual([
      existing,
      resourceLibrary,
    ])
  })

  test('initializes embedded QueryEngine as Claude Code native non-interactive mode', () => {
    const values: boolean[] = []
    initializeBeeGameNativeQueryMode({
      setIsInteractive(value: boolean) {
        values.push(value)
      },
    })

    expect(values).toEqual([false])
  })

  test('initializes Claude Code native sandbox and forwards only its network decisions', async () => {
    const calls: string[] = []
    const permissionRequests: Array<Record<string, unknown>> = []
    await initializeBeeGameNativeSandbox(
      {
        SandboxManager: {
          getSandboxUnavailableReason: () => undefined,
          isSandboxRequired: () => true,
          isSandboxingEnabled: () => true,
          initialize: async (
            ask: (host: { host: string; port?: number }) => Promise<boolean>,
          ) => {
            calls.push('initialize')
            expect(await ask({ host: 'registry.example', port: 443 })).toBe(
              true,
            )
          },
        },
      },
      async request => {
        permissionRequests.push(request)
        return { behavior: 'allow' }
      },
    )

    expect(calls).toEqual(['initialize'])
    expect(permissionRequests).toEqual([
      expect.objectContaining({
        toolName: 'SandboxNetworkAccess',
        input: { host: 'registry.example', port: 443 },
      }),
    ])
  })

  test('coalesces concurrent sandbox requests for one exact network target', async () => {
    let resolveDecision:
      | ((value: { behavior: 'allow'; scope: 'once' }) => void)
      | undefined
    const requests: Array<Record<string, unknown>> = []
    const broker = new NativeSandboxNetworkPermissionBroker(request => {
      requests.push(request)
      return new Promise(resolve => {
        resolveDecision = resolve
      })
    })

    const decisions = [
      broker.request({ host: 'Registry.Example', port: 443 }),
      broker.request({ host: 'registry.example', port: 443 }),
      broker.request({ host: 'registry.example', port: 443 }),
    ]
    expect(requests).toHaveLength(1)
    resolveDecision?.({ behavior: 'allow', scope: 'once' })

    expect(await Promise.all(decisions)).toEqual([true, true, true])
    expect(requests[0]).toEqual(
      expect.objectContaining({
        toolName: 'SandboxNetworkAccess',
        input: { host: 'registry.example', port: 443 },
      }),
    )
  })

  test('keeps an exact sandbox host grant only for the current worker session', async () => {
    const requests: Array<Record<string, unknown>> = []
    const broker = new NativeSandboxNetworkPermissionBroker(async request => {
      requests.push(request)
      return { behavior: 'allow', scope: 'session' }
    })

    expect(await broker.request({ host: 'registry.example', port: 443 })).toBe(
      true,
    )
    expect(await broker.request({ host: 'REGISTRY.EXAMPLE', port: 443 })).toBe(
      true,
    )
    expect(await broker.request({ host: 'registry.example', port: 80 })).toBe(
      true,
    )
    expect(requests).toHaveLength(2)

    const separateSession = new NativeSandboxNetworkPermissionBroker(
      async request => {
        requests.push(request)
        return { behavior: 'deny' }
      },
    )
    expect(
      await separateSession.request({ host: 'registry.example', port: 443 }),
    ).toBe(false)
    expect(requests).toHaveLength(3)
  })

  test('allows the native read-only ResourceLibrary lane without prompting', async () => {
    const requests: Array<Record<string, unknown>> = []
    const broker = new NativeResourceLibraryPermissionBroker(
      () => async request => {
        requests.push(request)
        return { behavior: 'allow' }
      },
    )
    const toolInput = {
      action: 'browse_catalog',
      filters: { dimensions: ['3D'] },
    }

    expect(
      await broker.authorize({
        toolName: 'ResourceLibrary',
        toolInput,
        toolUseID: 'read-resource',
      }),
    ).toEqual(
      expect.objectContaining({
        behavior: 'allow',
        updatedInput: toolInput,
      }),
    )
    expect(requests).toEqual([])
  })

  test('allows one catalog read per model turn and leaves imports available', () => {
    const gate = new ResourceCatalogTurnGate()
    const turn = {}
    expect(
      gate.issue({
        workerType: 'resource-preparer',
        toolName: 'ResourceLibrary',
        toolInput: {
          action: 'browse_catalog',
          filters: { dimensions: ['3D'] },
        },
        assistantMessage: turn,
        toolUseContext: {},
      }),
    ).toBeUndefined()
    expect(
      gate.issue({
        workerType: 'resource-preparer',
        toolName: 'ResourceLibrary',
        toolInput: {
          action: 'browse_catalog',
          filters: { dimensions: ['3D'] },
        },
        assistantMessage: turn,
        toolUseContext: {},
      }),
    ).toContain('Only one ResourceLibrary catalog read')
    expect(
      gate.issue({
        workerType: 'resource-preparer',
        toolName: 'ResourceLibrary',
        toolInput: { action: 'import_resources', selections: [] },
        assistantMessage: turn,
        toolUseContext: {},
      }),
    ).toBeUndefined()
    expect(
      gate.issue({
        workerType: 'resource-preparer',
        toolName: 'ResourceLibrary',
        toolInput: {
          action: 'browse_catalog',
          filters: { dimensions: ['3D'] },
        },
        assistantMessage: {},
        toolUseContext: {},
      }),
    ).toBeUndefined()
  })

  test('rejects an invented ResourceLibrary action with the supported contract', async () => {
    const requests: Array<Record<string, unknown>> = []
    const broker = new NativeResourceLibraryPermissionBroker(
      () => async request => {
        requests.push(request)
        return { behavior: 'allow' }
      },
    )

    expect(
      await broker.authorize({
        toolName: 'ResourceLibrary',
        toolInput: {
          action: 'match',
        },
        toolUseID: 'invalid-resource-action',
      }),
    ).toEqual(
      expect.objectContaining({
        behavior: 'deny',
        message:
          'Unsupported ResourceLibrary action "match". Allowed actions: browse_catalog, import_resources, refresh_resource_metadata.',
      }),
    )
    expect(requests).toEqual([])
  })

  test('keeps a ResourceLibrary mutation grant scoped to this worker session', async () => {
    const requests: Array<Record<string, unknown>> = []
    const broker = new NativeResourceLibraryPermissionBroker(
      () => async request => {
        requests.push(request)
        return { behavior: 'allow', scope: 'session' }
      },
    )
    const toolInput = {
      action: 'import_resources',
      selections: [
        {
          resource_id: 'primary-character',
          pack_id: 'pack-a',
          expected_pack_version: '1.0.0',
          element_id: 'character-a',
          destination_path: 'assets/runtime/character',
          selection_reason: ['Observed fit.'],
        },
      ],
    }

    expect(
      (
        await broker.authorize({
          toolName: 'ResourceLibrary',
          toolInput,
          toolUseID: 'write-1',
        })
      )?.behavior,
    ).toBe('allow')
    expect(
      (
        await broker.authorize({
          toolName: 'ResourceLibrary',
          toolInput,
          toolUseID: 'write-2',
        })
      )?.behavior,
    ).toBe('allow')
    expect(requests).toEqual([
      expect.objectContaining({
        toolName: 'ResourceLibrary',
        input: toolInput,
      }),
    ])

    const separateSession = new NativeResourceLibraryPermissionBroker(
      () => async request => {
        requests.push(request)
        return { behavior: 'deny' }
      },
    )
    expect(
      (
        await separateSession.authorize({
          toolName: 'ResourceLibrary',
          toolInput,
          toolUseID: 'write-3',
        })
      )?.behavior,
    ).toBe('deny')
    expect(requests).toHaveLength(2)
  })

  test('routes refresh_resource_metadata through the ResourceLibrary mutation boundary', async () => {
    const requests: Array<Record<string, unknown>> = []
    const broker = new NativeResourceLibraryPermissionBroker(
      () => async request => {
        requests.push(request)
        return { behavior: 'deny' }
      },
    )
    const toolInput = { action: 'refresh_resource_metadata' }

    expect(
      await broker.authorize({
        toolName: 'ResourceLibrary',
        toolInput,
        toolUseID: 'refresh-resource',
      }),
    ).toEqual(expect.objectContaining({ behavior: 'deny' }))
    expect(requests).toEqual([
      expect.objectContaining({
        toolName: 'ResourceLibrary',
        input: toolInput,
      }),
    ])
  })

  test('never treats a session ResourceLibrary grant as approval for another deferred tool', async () => {
    const broker = new NativeResourceLibraryPermissionBroker(
      () => async () => ({
        behavior: 'allow',
        scope: 'session',
      }),
    )
    await broker.authorize({
      toolName: 'ResourceLibrary',
      toolInput: { action: 'import_resources', selections: [] },
      toolUseID: 'resource-write',
    })

    expect(
      await broker.authorize({
        toolName: 'ExecuteExtraTool',
        toolInput: { tool_name: 'UnrelatedDeferredTool', params: {} },
        toolUseID: 'unrelated-write',
      }),
    ).toBeUndefined()
  })

  test('fails at session startup when required native sandbox is unavailable', async () => {
    await expect(
      initializeBeeGameNativeSandbox({
        SandboxManager: {
          getSandboxUnavailableReason: () => 'missing sandbox dependency',
          isSandboxRequired: () => true,
          isSandboxingEnabled: () => false,
          initialize: async () => {},
        },
      }),
    ).rejects.toThrow(
      'Claude Code native sandbox is required but unavailable: missing sandbox dependency',
    )
  })

  test('maps the session language to a response-only native system preference', () => {
    expect(getBeeGameResponseLanguageInstruction('zh')).toBe(
      'Respond to the user in Simplified Chinese. Keep code, commands, file paths, package names, API identifiers, and raw errors unchanged.',
    )
    expect(getBeeGameResponseLanguageInstruction('fr')).toContain('French')
    expect(getBeeGameResponseLanguageInstruction()).toBeUndefined()
  })

  test('drains only main-session native task notifications without interpreting their result', () => {
    const queued = [
      {
        value: '<task-notification>first</task-notification>',
        mode: 'task-notification',
      },
      { value: 'user input', mode: 'prompt' },
      {
        value: '<task-notification>subagent</task-notification>',
        mode: 'task-notification',
        agentId: 'agent-1',
      },
      {
        value: '<task-notification>second</task-notification>',
        mode: 'task-notification',
      },
    ]
    const queue = createNativeNotificationQueue({
      dequeueAllMatching(
        predicate: (command: (typeof queued)[number]) => boolean,
      ) {
        const selected = queued.filter(predicate)
        for (const command of selected)
          queued.splice(queued.indexOf(command), 1)
        return selected
      },
    })

    expect(
      queue.takeMainThreadTaskNotifications().map(command => command.value),
    ).toEqual([
      '<task-notification>first</task-notification>',
      '<task-notification>second</task-notification>',
    ])
    expect(queued).toEqual([
      { value: 'user input', mode: 'prompt' },
      {
        value: '<task-notification>subagent</task-notification>',
        mode: 'task-notification',
        agentId: 'agent-1',
      },
    ])
  })

  test('forwards Claude native background SDK events without reconstructing them', () => {
    const nativeEvents = [
      { type: 'system', subtype: 'task_started', task_id: 'agent-1' },
      {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'agent-1',
        status: 'completed',
      },
    ]
    const queue = createNativeSdkEventQueue({
      drainSdkEvents: () => nativeEvents.splice(0),
    })

    expect(queue.drain()).toEqual([
      { type: 'system', subtype: 'task_started', task_id: 'agent-1' },
      {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'agent-1',
        status: 'completed',
      },
    ])
    expect(queue.drain()).toEqual([])
  })

  test('flushes native progress while a Claude message is still pending', async () => {
    let releaseMessage = () => {}
    const gate = new Promise<void>(resolve => {
      releaseMessage = resolve
    })
    const messages: Array<{ type: string }> = []
    let waits = 0
    let flushes = 0

    async function* stream() {
      await gate
      yield { type: 'assistant' }
    }

    await consumeNativeMessageStream({
      stream: stream(),
      signal: new AbortController().signal,
      onMessage: message => messages.push(message),
      flushProgress: () => {
        flushes += 1
      },
      waitForProgress: async () => {
        waits += 1
        if (waits === 2) releaseMessage()
      },
    })

    expect(waits).toBeGreaterThanOrEqual(2)
    expect(flushes).toBeGreaterThanOrEqual(3)
    expect(messages).toEqual([{ type: 'assistant' }])
  })

  test('waits for native background work but excludes foreground tasks and long-lived teammates', () => {
    expect(
      hasRunningNativeBackgroundTasks({
        tasks: {
          reviewer: {
            type: 'local_agent',
            status: 'running',
            isBackgrounded: true,
          },
        },
      }),
    ).toBe(true)
    expect(
      hasRunningNativeBackgroundTasks({
        tasks: {
          foreground: {
            type: 'local_agent',
            status: 'running',
            isBackgrounded: false,
          },
          teammate: { type: 'in_process_teammate', status: 'running' },
          completed: {
            type: 'local_agent',
            status: 'completed',
            isBackgrounded: true,
          },
        },
      }),
    ).toBe(false)
  })

  test('continues the same native session when a background notification arrives later', async () => {
    const controller = new AbortController()
    const queued: Array<{ value: string; mode: string; uuid?: string }> = []
    const processed: string[] = []
    let running = true
    let waits = 0
    let progressFlushes = 0

    await drainNativeBackgroundNotifications({
      signal: controller.signal,
      takeNotifications: () => queued.splice(0),
      hasRunningTasks: () => running,
      runNotification: async command => {
        processed.push(String(command.value))
      },
      flushProgress: () => {
        progressFlushes += 1
      },
      waitForProgress: async () => {
        waits += 1
        running = false
        queued.push({
          value:
            '<task-notification><task-id>review-1</task-id><status>completed</status><result>review complete</result></task-notification>',
          mode: 'task-notification',
          uuid: 'notification-1',
        })
      },
    })

    expect(waits).toBe(1)
    expect(progressFlushes).toBeGreaterThanOrEqual(2)
    expect(processed).toEqual([
      '<task-notification><task-id>review-1</task-id><status>completed</status><result>review complete</result></task-notification>',
    ])
  })

  test('keeps the bridge open across the foreground-to-background registration gap', async () => {
    const queued: Array<{ value: string; mode: string }> = []
    const processed: string[] = []
    let running = false
    let registrationChecks = 0

    await drainNativeBackgroundNotifications({
      signal: new AbortController().signal,
      takeNotifications: () => queued.splice(0),
      hasRunningTasks: () => running,
      waitForTaskRegistration: async () => {
        registrationChecks += 1
        if (registrationChecks === 1) running = true
      },
      waitForProgress: async () => {
        running = false
        queued.push({
          value:
            '<task-notification><task-id>validator-gap</task-id><status>completed</status></task-notification>',
          mode: 'task-notification',
        })
      },
      runNotification: async command => {
        processed.push(String(command.value))
      },
    })

    expect(registrationChecks).toBe(2)
    expect(processed).toEqual([
      '<task-notification><task-id>validator-gap</task-id><status>completed</status></task-notification>',
    ])
  })

  test('keeps a started native task pending across compaction state gaps until its terminal notification', async () => {
    const ledger = new NativeBackgroundTaskLedger()
    const queued: Array<{ value: string; mode: string }> = []
    const processed: string[] = []
    let waits = 0

    ledger.observe({
      type: 'system',
      subtype: 'task_started',
      task_id: 'auditor-long-running',
    })

    await drainNativeBackgroundNotifications({
      signal: new AbortController().signal,
      takeNotifications: () => queued.splice(0),
      // Model the native AppState temporarily losing the task during
      // compaction. The transport ledger, not that snapshot, keeps the bridge
      // alive.
      hasRunningTasks: () => ledger.hasPendingTasks(),
      waitForProgress: async () => {
        waits += 1
        if (waits === 1) {
          ledger.observe({ type: 'system', subtype: 'init' })
          return
        }
        queued.push({
          value:
            '<task-notification><task-id>auditor-long-running</task-id><status>completed</status><result>{"status":"passed"}</result></task-notification>',
          mode: 'task-notification',
        })
      },
      onTerminalNotification: notification => {
        ledger.settleNotification(notification)
      },
      runNotification: async command => {
        processed.push(String(command.value))
      },
    })

    expect(waits).toBe(2)
    expect(ledger.hasPendingTasks()).toBe(false)
    expect(processed).toHaveLength(1)
  })

  test('does not resurrect a settled native task when task_started is replayed', () => {
    const ledger = new NativeBackgroundTaskLedger()
    ledger.observe({
      type: 'system',
      subtype: 'task_started',
      task_id: 'review-replayed',
    })
    ledger.settleTask('review-replayed')
    ledger.observe({
      type: 'system',
      subtype: 'task_started',
      task_id: 'review-replayed',
    })

    expect(ledger.hasPendingTasks()).toBe(false)
  })

  test('releases pending transport tasks after an explicit interruption', () => {
    const ledger = new NativeBackgroundTaskLedger()
    ledger.observe({
      type: 'system',
      subtype: 'task_started',
      task_id: 'validator-stopped',
    })

    ledger.interruptPendingTasks()
    ledger.observe({
      type: 'system',
      subtype: 'task_started',
      task_id: 'validator-stopped',
    })

    expect(ledger.hasPendingTasks()).toBe(false)
  })

  test('returns a failed native validator notification unchanged to the same session', async () => {
    const notification =
      '<task-notification><task-id>validator-1</task-id><tool-use-id>agent-validator-1</tool-use-id><status>failed</status><result>native validator failed</result></task-notification>'
    const processed: string[] = []
    const queued = [{ value: notification, mode: 'task-notification' }]

    await drainNativeBackgroundNotifications({
      signal: new AbortController().signal,
      takeNotifications: () => queued.splice(0),
      hasRunningTasks: () => false,
      runNotification: async command => {
        processed.push(String(command.value))
      },
    })

    expect(processed).toEqual([notification])
  })

  test('preserves native notification order and stops without processing followers after abort', async () => {
    const controller = new AbortController()
    const processed: string[] = []

    await drainNativeBackgroundNotifications({
      signal: controller.signal,
      takeNotifications: () => [
        {
          value:
            '<task-notification><task-id>first</task-id><status>completed</status></task-notification>',
          mode: 'task-notification',
        },
        {
          value:
            '<task-notification><task-id>second</task-id><status>completed</status></task-notification>',
          mode: 'task-notification',
        },
      ],
      hasRunningTasks: () => true,
      runNotification: async command => {
        processed.push(String(command.value))
        controller.abort()
      },
      waitForProgress: async () => {},
    })

    expect(processed).toEqual([
      '<task-notification><task-id>first</task-id><status>completed</status></task-notification>',
    ])
  })

  test('only resumes for unique terminal native task notifications', async () => {
    const controller = new AbortController()
    const processed: string[] = []
    const observed: string[] = []
    const terminal =
      '<task-notification><task-id>review-1</task-id><tool-use-id>tool-1</tool-use-id><status>completed</status></task-notification>'
    const queued = [
      {
        value:
          '<task-notification><task-id>review-1</task-id></task-notification>',
        mode: 'task-notification',
      },
      { value: terminal, mode: 'task-notification' },
      { value: terminal, mode: 'task-notification' },
    ]
    await drainNativeBackgroundNotifications({
      signal: controller.signal,
      takeNotifications: () => queued.splice(0),
      hasRunningTasks: () => false,
      onTerminalNotification: notification => observed.push(notification.value),
      runNotification: async command => {
        processed.push(String(command.value))
      },
    })
    expect(processed).toEqual([terminal])
    expect(observed).toEqual([terminal])
  })

  test('does not resume a delayed notification after native TaskOutput already consumed the task', async () => {
    const processed: string[] = []
    const consumed = new Set(['review-1'])
    const queued = [
      {
        value:
          '<task-notification><task-id>review-1</task-id><tool-use-id>agent-tool-1</tool-use-id><status>completed</status></task-notification>',
        mode: 'task-notification',
      },
    ]
    await drainNativeBackgroundNotifications({
      signal: new AbortController().signal,
      takeNotifications: () => queued.splice(0),
      hasRunningTasks: () => false,
      runNotification: async command => {
        processed.push(String(command.value))
      },
      consumedNotificationKeys: consumed,
    })

    expect(processed).toEqual([])
  })

  test('recognizes only structured terminal TaskOutput consumption', () => {
    expect(
      getCompletedNativeTaskOutputTaskId({
        type: 'user',
        tool_use_result: {
          retrieval_status: 'success',
          task: { task_id: 'review-1', status: 'completed' },
        },
      }),
    ).toBe('review-1')
    expect(
      getCompletedNativeTaskOutputTaskId({
        type: 'user',
        tool_use_result: {
          retrieval_status: 'success',
          task: { task_id: 'review-1', status: 'running' },
        },
      }),
    ).toBeUndefined()
  })

  test('parses only the native terminal lifecycle envelope', () => {
    expect(
      parseNativeTerminalTaskNotification({
        value:
          '<task-notification><task-id>a</task-id><status>completed</status><result>{"status":"passed"}</result></task-notification>',
        mode: 'task-notification',
      }),
    ).toEqual({
      key: 'a',
      taskId: 'a',
      status: 'completed',
      result: '{"status":"passed"}',
    })
    expect(
      parseNativeTerminalTaskNotification({
        value: '<task-notification><task-id>a</task-id></task-notification>',
        mode: 'task-notification',
      }),
    ).toBeUndefined()
    expect(
      parseNativeTerminalTaskNotification({
        value:
          '<task-notification><task-id>b</task-id><status>completed</status><result>{"detail":"literal </result> text"}</result></task-notification>',
        mode: 'task-notification',
      })?.result,
    ).toBe('{"detail":"literal </result> text"}')
  })

  test('uses native acceptEdits mode without enabling permission bypass', () => {
    expect(
      createBeeGameToolPermissionContext({
        mode: 'default',
        customRule: 'preserved',
        isBypassPermissionsModeAvailable: true,
      }),
    ).toEqual({
      mode: 'acceptEdits',
      customRule: 'preserved',
      isBypassPermissionsModeAvailable: false,
    })
  })

  test('allows read-only access to runtime and trusted built-in skill roots without granting edit access', () => {
    const context = createBeeGameToolPermissionContext(
      {
        mode: 'default',
        alwaysAllowRules: { session: ['Read(/existing/reference/**)'] },
        isBypassPermissionsModeAvailable: true,
      },
      ['/runtime/skills', '/platform/builtin-skills'],
    )

    expect(context).toMatchObject({
      mode: 'acceptEdits',
      alwaysAllowRules: {
        session: [
          'Read(/existing/reference/**)',
          'Read(/runtime/skills/**)',
          'Read(/platform/builtin-skills/**)',
        ],
      },
      isBypassPermissionsModeAvailable: false,
    })
    expect(JSON.stringify(context)).not.toContain('Edit(/runtime/skills')
    expect(JSON.stringify(context)).not.toContain(
      'Edit(/platform/builtin-skills',
    )
  })

  test('delegates workspace file mutation boundaries to native acceptEdits mode', () => {
    const context = createBeeGameToolPermissionContext(
      { mode: 'acceptEdits' },
      [],
      '/workspace/current-project',
    )

    expect(context).toMatchObject({
      mode: 'acceptEdits',
      isBypassPermissionsModeAvailable: false,
    })
    expect(JSON.stringify(context)).not.toContain('Write(')
    expect(JSON.stringify(context)).not.toContain('Edit(')
    expect(JSON.stringify(context)).not.toContain('Bash(')
  })

  test('derives canonical skill roots from the current session environment', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beegame-skill-read-roots-'))
    const configDir = join(root, 'user-runtime')
    const runtimeSkillsDir = join(configDir, 'skills')
    const builtinSkillsDir = join(root, 'builtin-skills')
    await Promise.all([
      mkdir(runtimeSkillsDir, { recursive: true }),
      mkdir(builtinSkillsDir, { recursive: true }),
    ])
    try {
      expect(
        await resolveBeeGameSkillReadRoots(
          {
            BEEGAME_CONFIG_DIR: configDir,
          },
          builtinSkillsDir,
        ),
      ).toEqual([
        await realpath(runtimeSkillsDir),
        await realpath(builtinSkillsDir),
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('closes runtime dispatchers across supported Undici lifecycle shapes', async () => {
    const closed: string[] = []

    await closeBeeGameRuntimeDispatcher({
      close: () => {
        closed.push('close')
      },
      destroy: () => {
        closed.push('unexpected-destroy')
      },
    })
    await closeBeeGameRuntimeDispatcher({
      destroy: () => {
        closed.push('destroy')
      },
    })
    await closeBeeGameRuntimeDispatcher({})

    expect(closed).toEqual(['close', 'destroy'])
  })

  test('routes an approved provider origin through its pinned dispatcher and denies unapproved HTTP(S) origins', async () => {
    let pinnedLookupCalls = 0
    const providerUrl = 'https://provider.runtime.test/v1'
    const target: ApprovedOutboundTarget = {
      url: new URL(providerUrl),
      addresses: ['93.184.216.34'],
      lookup: (hostname, _options, callback) => {
        pinnedLookupCalls += 1
        expect(hostname).toBe('provider.runtime.test')
        callback(null, '93.184.216.34', 4)
      },
    }
    const calls: Array<{ url: string; dispatcher?: unknown }> = []
    const baseFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        dispatcher: (
          init as (RequestInit & { dispatcher?: unknown }) | undefined
        )?.dispatcher,
      })
      return new Response('{}')
    }) as typeof fetch
    const wrapped = createBeeGamePinnedFetch(baseFetch, {
      OPENAI_BASE_URL: target,
    })

    await wrapped('https://provider.runtime.test/v1/chat/completions')
    await expect(
      wrapped('https://non-provider.runtime.test/health'),
    ).rejects.toThrow('Outbound URL is not permitted')
    await wrapped('file:///tmp/local-runtime-input')

    expect(calls[0]?.dispatcher).toBeDefined()
    expect(calls[1]).toEqual({
      url: 'file:///tmp/local-runtime-input',
      dispatcher: undefined,
    })
    expect(pinnedLookupCalls).toBe(0)
  })

  test('rejects redirect-capable requests and cannot reuse a dispatcher across ports', async () => {
    const target: ApprovedOutboundTarget = {
      url: new URL('https://provider.runtime.test/v1'),
      addresses: ['93.184.216.34'],
      lookup: (_hostname, _options, callback) =>
        callback(null, '93.184.216.34', 4),
    }
    const calls: Array<{ init?: RequestInit }> = []
    const wrapped = createBeeGamePinnedFetch(
      (async (_input, init) => {
        calls.push({ init })
        return new Response('{}')
      }) as typeof fetch,
      { OPENAI_BASE_URL: target },
    )

    await wrapped('https://provider.runtime.test/v1/chat/completions')
    await expect(
      wrapped('https://provider.runtime.test:8443/v1/chat/completions'),
    ).rejects.toThrow('Outbound URL is not permitted')
    expect(calls[0]?.init).toMatchObject({ redirect: 'error' })
  })

  test('uses native TLS only for an approved trusted development proxy target', async () => {
    const target: ApprovedOutboundTarget = {
      url: new URL('https://provider.runtime.test/v1'),
      addresses: ['198.18.0.220'],
      trustedDevelopmentProxy: true,
      lookup: (_hostname, _options, callback) =>
        callback(null, '198.18.0.220', 4),
    }
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const wrapped = createBeeGamePinnedFetch(
      (async (input, init) => {
        calls.push({ url: String(input), init })
        return new Response('{}')
      }) as typeof fetch,
      { ANTHROPIC_BASE_URL: target },
    )

    await wrapped('https://provider.runtime.test/v1/messages')
    await expect(
      wrapped('https://other.runtime.test/v1/messages'),
    ).rejects.toThrow('Outbound URL is not permitted')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.init).toMatchObject({ redirect: 'error' })
    expect(
      (calls[0]?.init as RequestInit & { dispatcher?: unknown }).dispatcher,
    ).toBeUndefined()
  })

  test('installs MACRO globals before loading root CLI modules', () => {
    const target = globalThis as typeof globalThis & {
      MACRO?: Record<string, string>
    }
    const previous = target.MACRO
    Reflect.deleteProperty(target, 'MACRO')
    try {
      ensureBeeGameMacroGlobals()

      expect(target.MACRO).toEqual(
        expect.objectContaining({
          VERSION: expect.any(String),
          BUILD_TIME: expect.any(String),
          FEEDBACK_CHANNEL: '',
          ISSUES_EXPLAINER: '',
          NATIVE_PACKAGE_URL: '',
          PACKAGE_URL: '',
          VERSION_CHANGELOG: '',
        }),
      )
    } finally {
      if (previous === undefined) {
        Reflect.deleteProperty(target, 'MACRO')
      } else {
        target.MACRO = previous
      }
    }
  })

  test('kills only running local shell tasks for the current runtime app state', async () => {
    const killed: string[] = []
    let state: MutableAppState = {
      tasks: {
        bash_running: {
          type: 'local_bash',
          status: 'running',
        },
        bash_completed: {
          type: 'local_bash',
          status: 'completed',
        },
        agent_running: {
          type: 'local_agent',
          status: 'running',
        },
      },
    }

    const killedTaskIds = await stopRunningLocalShellTasks(
      state,
      updater => {
        state = updater(state)
      },
      taskId => {
        killed.push(taskId)
      },
    )

    expect(killedTaskIds).toEqual(['bash_running'])
    expect(killed).toEqual(['bash_running'])
  })
})
