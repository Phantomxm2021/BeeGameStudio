import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildDocumentAuthorAuthorityBlock,
  createBeeGameDeliveryWorkerPort,
} from './delivery-worker-session-port'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import { parseWorkerTerminalResult } from './delivery-workflow/worker-contracts'
import { buildGameIrProjectionContract } from './delivery-workflow/game-ir/projection-contract'
import { digestGameIrValue } from './delivery-workflow/game-ir/model'
import { sourceSectionsForGameIrProjectionSlice } from './delivery-workflow/game-ir/projection-slice-authority'
import type {
  FoundationDocumentPath,
  WorkerDispatchRequest,
} from './delivery-workflow/types'
import { WorkflowWorkerRebindError } from './session-manager'

const EMPTY_SLICE_CONTEXT = {
  availablePriorNodes: [],
  requiredCurrentNodes: [],
  admittedCurrentNodes: [],
} as const

function projectionPacket(input: {
  taskId: string
  revision: string
  receiptDigest: string
  sliceId: string
}) {
  const compileRequest = {
    taskId: input.taskId,
    foundation: {
      foundationRevision: input.revision,
      receiptDigest: input.receiptDigest,
    },
  }
  const selectors = [
    ...sourceSectionsForGameIrProjectionSlice('gameplay.slice.0'),
    ...sourceSectionsForGameIrProjectionSlice('gameplay.slice.1'),
  ].filter(
    (selector, index, all) =>
      all.findIndex(
        candidate =>
          candidate.documentPath === selector.documentPath &&
          candidate.sectionId === selector.sectionId,
      ) === index,
  )
  const sections = selectors.map((selector, index) => {
      const bytes = `SESSION_PORT_AUTHORITY_${index}`
      return {
        ...selector,
        digest: createHash('sha256').update(bytes).digest('hex'),
        bytes,
      }
    })
  const body = {
    schemaVersion: 'game-ir-gameplay-projection-operation-packet.v1',
    source: {
      moduleId: 'gameplay',
      taskId: input.taskId,
      compileRequest,
      sectionIndex: sections.map(({ bytes: _, ...section }) => section),
      sectionBytes: Object.fromEntries(
        sections.map(section => [
          `${section.documentPath}#${section.sectionId}`,
          section.bytes,
        ]),
      ),
    },
    semanticPacket: { moduleId: 'gameplay', taskId: input.taskId },
    projectionContract: buildGameIrProjectionContract('gameplay'),
    dependencies: {},
  }
  return { ...body, packetDigest: digestGameIrValue(body) }
}

function canonicalSource(
  path: 'docs/GDD.md' | 'docs/LEVEL_SCENE_DESIGN.md',
): string {
  const contract = getGameDocumentContract(path)
  return [
    `# ${contract.discipline}`,
    ...contract.sections.flatMap(section => [
      `<!-- beegame-section:${section.sectionId} -->`,
      `## ${section.title}`,
      `Authority content for ${section.sectionId}.`,
    ]),
    '<!-- beegame-production-materials -->',
    '## Production Materials',
    'Unprojected production material payload.',
  ].join('\n')
}

async function writeAuthoritySource(
  workspacePath: string,
  path: FoundationDocumentPath,
): Promise<void> {
  const markdown = canonicalSource(
    path as 'docs/GDD.md' | 'docs/LEVEL_SCENE_DESIGN.md',
  )
  await writeFile(join(workspacePath, path), markdown)
}

describe('delivery worker complete document boundary', () => {
  test('turns native projection output into a service-bound operation terminal', async () => {
    const events = [
      {
        id: 1,
        sessionId: 'compiler-session',
        type: 'result' as const,
        text: '',
        createdAt: new Date(),
        payload: {
          record_stream: '{"record":"done","sliceId":"gameplay.slice.0"}\n',
        },
      },
    ]
    let started: WorkerDispatchRequest | undefined
    let submittedPrompt = ''
    const sessions = {
      start: (request: WorkerDispatchRequest) => {
        started = request
        return { id: 'compiler-session' }
      },
      updateAuthToken: () => undefined,
      sendWithDisplay: async (_sessionId: string, prompt: string) => {
        submittedPrompt = prompt
      },
      events: () => events,
      get: () => ({
        status: 'running',
        turnStatus: 'completed',
        createdAt: new Date(),
      }),
      waitForWorkflowWorkerIdle: async () => undefined,
      isWorkflowWorkerOpen: () => true,
    }
    const port = createBeeGameDeliveryWorkerPort({
      sessions: sessions as never,
      userId: 'user',
    })
    await port.start({
      dispatchId: 'dispatch-compiler',
      runId: 'run-compiler',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'game-ir-compiler',
      phase: 'GAME_IR_COMPILATION',
      taskId: 'task-compiler',
      revision: 'revision-compiler',
      allowedPaths: [],
      projectReadScope: 'empty',
      contract: {
        kind: 'projection',
        currentSlice: 'gameplay.slice.0',
        sliceContext: EMPTY_SLICE_CONTEXT,
        packet: projectionPacket({
          taskId: 'task-compiler',
          revision: 'revision-compiler',
          receiptDigest: 'b'.repeat(64),
          sliceId: 'gameplay.slice.0',
        }),
        compileRequestDigest: digestGameIrValue({
          taskId: 'task-compiler',
          foundation: {
            foundationRevision: 'revision-compiler',
            receiptDigest: 'b'.repeat(64),
          },
        }),
        foundationReadyReceiptDigest: 'b'.repeat(64),
      },
    } as never)
    await port.submit(
      'dispatch-compiler',
      'caller prompt must not replace the dispatcher packet',
    )
    expect(submittedPrompt).toContain('game-ir-compiler')
    expect(submittedPrompt).toContain(
      'The model contract is the sole input for this task.',
    )
    expect(submittedPrompt).toContain('current dependency-frontier slice')
    expect(submittedPrompt).not.toContain('caller prompt must not replace')
    expect(submittedPrompt).not.toContain('confirmedBriefContext')
    expect(submittedPrompt).not.toContain('Workspace root:')
    const terminal = await port.waitForTerminal!('dispatch-compiler')
    expect(started?.workflowJsonSchema).toBeUndefined()
    expect(
      (
        started as unknown as {
          workflowRecordStreamContract?: unknown
        }
      ).workflowRecordStreamContract,
    ).toEqual({
      version: 1,
      terminalRecord: { record: 'done', sliceId: 'gameplay.slice.0' },
    })
    expect(parseWorkerTerminalResult(terminal)).toMatchObject({
      workerType: 'game-ir-compiler',
      runId: 'run-compiler',
      dispatchId: 'dispatch-compiler',
      taskId: 'task-compiler',
      revision: 'revision-compiler',
      compileRequestDigest: digestGameIrValue({
        taskId: 'task-compiler',
        foundation: {
          foundationRevision: 'revision-compiler',
          receiptDigest: 'b'.repeat(64),
        },
      }),
      foundationReadyReceiptDigest: 'b'.repeat(64),
    })
    expect(terminal).toMatchObject({
      operation: 'projection',
      status: 'completed',
      sliceId: 'gameplay.slice.0',
      records: [],
      done: true,
    })
    expect(terminal).not.toHaveProperty('semantic')
    const forgedPort = createBeeGameDeliveryWorkerPort({
      sessions: sessions as never,
      userId: 'user',
    })
    await expect(
      forgedPort.start({
        dispatchId: 'dispatch-forged-compiler',
        runId: 'run-compiler',
        ownerId: 'owner',
        projectId: 'project',
        workspacePath: '/workspace',
        workerType: 'game-ir-compiler',
        phase: 'GAME_IR_COMPILATION',
        taskId: 'task-compiler',
        revision: 'revision-compiler',
        allowedPaths: [],
        projectReadScope: 'empty',
        contract: { packet: {} },
      } as never),
    ).rejects.toThrow(/operation kind/i)
  })

  test('sends one projection packet once and reuses the live session for the next slice', async () => {
    const prompts: string[] = []
    const events: Array<Record<string, unknown>> = [
      {
        id: 1,
        sessionId: 'live-projection-session',
        type: 'result',
        text: '',
        createdAt: new Date(),
        payload: {
          record_stream: '{"record":"done","sliceId":"gameplay.slice.0"}\n',
        },
      },
    ]
    let starts = 0
    let rebinds = 0
    const sessions = {
      start: () => {
        starts += 1
        return { id: 'live-projection-session' }
      },
      updateAuthToken: () => undefined,
      sendWithDisplay: async (_sessionId: string, prompt: string) => {
        prompts.push(prompt)
      },
      events: () => events,
      get: () => ({
        status: 'running',
        turnStatus: 'idle',
        createdAt: new Date(),
      }),
      rebindWorkflowWorker: async () => {
        rebinds += 1
      },
    }
    const port = createBeeGameDeliveryWorkerPort({
      sessions: sessions as never,
      userId: 'user',
    })
    const request = (
      dispatchId: string,
      currentSlice: string,
    ): WorkerDispatchRequest => ({
      dispatchId,
      runId: 'run-packet-once',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'game-ir-compiler',
      phase: 'GAME_IR_COMPILATION',
      taskId: 'task-packet-once',
      revision: 'revision',
      allowedPaths: [],
      projectReadScope: 'empty',
      contract: {
        kind: 'projection',
        currentSlice,
        sliceContext: EMPTY_SLICE_CONTEXT,
        packet: projectionPacket({
          taskId: 'task-packet-once',
          revision: 'revision',
          receiptDigest: 'b'.repeat(64),
          sliceId: currentSlice,
        }),
        compileRequestDigest: digestGameIrValue({
          taskId: 'task-packet-once',
          foundation: {
            foundationRevision: 'revision',
            receiptDigest: 'b'.repeat(64),
          },
        }),
        foundationReadyReceiptDigest: 'b'.repeat(64),
        progress:
          currentSlice === 'gameplay.slice.1'
            ? [{ sliceId: 'gameplay.slice.0', entryDigest: 'e'.repeat(64) }]
            : [],
      },
    })

    await port.start(request('dispatch-slice-0', 'gameplay.slice.0'))
    await port.submit('dispatch-slice-0', 'ignored')
    await port.start(request('dispatch-slice-1', 'gameplay.slice.1'))
    await port.submit('dispatch-slice-1', 'ignored')
    setTimeout(
      () =>
        events.push({
          id: 2,
          sessionId: 'live-projection-session',
          type: 'result',
          text: '',
          createdAt: new Date(),
          payload: {
            record_stream: '{"record":"done","sliceId":"gameplay.slice.1"}\n',
          },
        }),
      10,
    )
    await expect(
      port.waitForTerminal!('dispatch-slice-1'),
    ).resolves.toMatchObject({ sliceId: 'gameplay.slice.1' })

    expect(starts).toBe(1)
    expect(rebinds).toBe(1)
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toContain('## Current slice')
    expect(prompts[1]).toContain('## Current slice')
    expect(prompts[1]).toContain('gameplay.slice.1')
    expect(prompts[1]).not.toContain('projectionContract')
    expect(prompts[1]).not.toContain('semanticPacket')
    expect(prompts[1]).not.toContain('sectionBytes')
    expect(prompts[1]).not.toContain('PLAYER_LOOP_SENTINEL')

    await port.close!('dispatch-slice-1')
    await port.start(request('dispatch-slice-2', 'gameplay.slice.0'))
    await port.submit('dispatch-slice-2', 'ignored')
    expect(starts).toBe(2)
    expect(prompts[2]).toContain('## Current slice')
  })

  test('resends the packet when the previous live session never accepted a turn', async () => {
    const prompts: string[] = []
    let starts = 0
    const sessions = {
      start: () => {
        starts += 1
        return { id: 'live-retry-session' }
      },
      updateAuthToken: () => undefined,
      sendWithDisplay: async (_sessionId: string, prompt: string) => {
        prompts.push(prompt)
      },
      get: () => ({
        status: 'running',
        turnStatus: 'idle',
        createdAt: new Date(),
      }),
      rebindWorkflowWorker: async () => undefined,
    }
    const port = createBeeGameDeliveryWorkerPort({
      sessions: sessions as never,
      userId: 'user',
    })
    const packet = projectionPacket({
      taskId: 'task-packet-retry',
      revision: 'revision',
      receiptDigest: 'd'.repeat(64),
      sliceId: 'gameplay.slice.0',
    })
    const request = (dispatchId: string): WorkerDispatchRequest => ({
      dispatchId,
      runId: 'run-packet-retry',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'game-ir-compiler',
      phase: 'GAME_IR_COMPILATION',
      taskId: 'task-packet-retry',
      revision: 'revision',
      allowedPaths: [],
      projectReadScope: 'empty',
      contract: {
        kind: 'projection',
        currentSlice: 'gameplay.slice.0',
        sliceContext: EMPTY_SLICE_CONTEXT,
        packet,
        compileRequestDigest: digestGameIrValue({
          taskId: 'task-packet-retry',
          foundation: {
            foundationRevision: 'revision',
            receiptDigest: 'd'.repeat(64),
          },
        }),
        foundationReadyReceiptDigest: 'd'.repeat(64),
      },
    })
    await port.start(request('dispatch-retry-0'))
    await port.start(request('dispatch-retry-1'))
    await port.submit('dispatch-retry-1', 'ignored')
    expect(starts).toBe(1)
    expect(prompts[0]).toContain('## Current slice')
  })

  test('retires a non-resumable live session before retrying with the packet', async () => {
    const prompts: string[] = []
    let starts = 0
    let disposed = 0
    const sessions = {
      start: () => {
        starts += 1
        return { id: `non-resumable-session-${starts}` }
      },
      updateAuthToken: () => undefined,
      sendWithDisplay: async (_sessionId: string, prompt: string) => {
        prompts.push(prompt)
      },
      get: () => ({
        status: 'running',
        turnStatus: 'idle',
        createdAt: new Date(),
      }),
      rebindWorkflowWorker: async () => {
        throw new WorkflowWorkerRebindError(
          'native resume session ID is required',
        )
      },
      disposeWorkflowWorker: async () => {
        disposed += 1
      },
    }
    const port = createBeeGameDeliveryWorkerPort({
      sessions: sessions as never,
      userId: 'user',
    })
    const packet = projectionPacket({
      taskId: 'task-non-resumable',
      revision: 'revision',
      receiptDigest: 'f'.repeat(64),
      sliceId: 'gameplay.slice.0',
    })
    const request = (
      dispatchId: string,
      currentSlice: string,
    ): WorkerDispatchRequest => ({
      dispatchId,
      runId: 'run-non-resumable',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'game-ir-compiler',
      phase: 'GAME_IR_COMPILATION',
      taskId: 'task-non-resumable',
      revision: 'revision',
      allowedPaths: [],
      projectReadScope: 'empty',
      contract: {
        kind: 'projection',
        currentSlice,
        sliceContext: EMPTY_SLICE_CONTEXT,
        packet,
        compileRequestDigest: digestGameIrValue({
          taskId: 'task-non-resumable',
          foundation: {
            foundationRevision: 'revision',
            receiptDigest: 'f'.repeat(64),
          },
        }),
        foundationReadyReceiptDigest: 'f'.repeat(64),
      },
    })

    await port.start(request('dispatch-non-resumable-0', 'gameplay.slice.0'))
    await port.start(request('dispatch-non-resumable-1', 'gameplay.slice.1'))
    await port.submit('dispatch-non-resumable-1', 'ignored')

    expect(starts).toBe(2)
    expect(disposed).toBe(1)
    expect(prompts[0]).toContain('## Current slice')
  })

  test('does not create a fresh session for an unexpected rebind failure', async () => {
    let starts = 0
    let disposed = 0
    const sessions = {
      start: () => {
        starts += 1
        return { id: `unexpected-rebind-session-${starts}` }
      },
      updateAuthToken: () => undefined,
      get: () => ({
        status: 'running',
        turnStatus: 'idle',
        createdAt: new Date(),
      }),
      rebindWorkflowWorker: async () => {
        throw new Error('schema persistence failed')
      },
      disposeWorkflowWorker: async () => {
        disposed += 1
      },
    }
    const port = createBeeGameDeliveryWorkerPort({
      sessions: sessions as never,
      userId: 'user',
    })
    const packet = projectionPacket({
      taskId: 'task-unexpected-rebind',
      revision: 'revision',
      receiptDigest: 'a'.repeat(64),
      sliceId: 'gameplay.slice.0',
    })
    const request = (
      dispatchId: string,
      currentSlice: string,
    ): WorkerDispatchRequest => ({
      dispatchId,
      runId: 'run-unexpected-rebind',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'game-ir-compiler',
      phase: 'GAME_IR_COMPILATION',
      taskId: 'task-unexpected-rebind',
      revision: 'revision',
      allowedPaths: [],
      projectReadScope: 'empty',
      contract: {
        kind: 'projection',
        currentSlice,
        sliceContext: EMPTY_SLICE_CONTEXT,
        packet,
        compileRequestDigest: digestGameIrValue({
          taskId: 'task-unexpected-rebind',
          foundation: {
            foundationRevision: 'revision',
            receiptDigest: 'a'.repeat(64),
          },
        }),
        foundationReadyReceiptDigest: 'a'.repeat(64),
      },
    })

    await port.start(request('dispatch-unexpected-0', 'gameplay.slice.0'))
    await expect(
      port.start(request('dispatch-unexpected-1', 'gameplay.slice.1')),
    ).rejects.toThrow('schema persistence failed')
    expect(starts).toBe(1)
    expect(disposed).toBe(1)
  })

  test('blocks retry when retiring a non-resumable session fails', async () => {
    let starts = 0
    const sessions = {
      start: () => {
        starts += 1
        return { id: `dispose-failure-session-${starts}` }
      },
      updateAuthToken: () => undefined,
      get: () => ({
        status: 'running',
        turnStatus: 'idle',
        createdAt: new Date(),
      }),
      rebindWorkflowWorker: async () => {
        throw new WorkflowWorkerRebindError(
          'native resume session ID is required',
        )
      },
      disposeWorkflowWorker: async () => {
        throw new Error('session disposal failed')
      },
    }
    const port = createBeeGameDeliveryWorkerPort({
      sessions: sessions as never,
      userId: 'user',
    })
    const request = (
      dispatchId: string,
      currentSlice: string,
    ): WorkerDispatchRequest => ({
      dispatchId,
      runId: 'run-dispose-failure',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'game-ir-compiler',
      phase: 'GAME_IR_COMPILATION',
      taskId: 'task-dispose-failure',
      revision: 'revision',
      allowedPaths: [],
      projectReadScope: 'empty',
      contract: {
        kind: 'projection',
        currentSlice,
        sliceContext: EMPTY_SLICE_CONTEXT,
        packet: projectionPacket({
          taskId: 'task-dispose-failure',
          revision: 'revision',
          receiptDigest: 'b'.repeat(64),
          sliceId: currentSlice,
        }),
        compileRequestDigest: digestGameIrValue({
          taskId: 'task-dispose-failure',
          foundation: {
            foundationRevision: 'revision',
            receiptDigest: 'b'.repeat(64),
          },
        }),
        foundationReadyReceiptDigest: 'b'.repeat(64),
      },
    })

    await port.start(request('dispatch-dispose-failure-0', 'gameplay.slice.0'))
    await expect(
      port.start(request('dispatch-dispose-failure-1', 'gameplay.slice.1')),
    ).rejects.toThrow('session disposal failed')
    await expect(
      port.start(request('dispatch-dispose-failure-2', 'gameplay.slice.1')),
    ).rejects.toThrow('session disposal failed')
    expect(starts).toBe(1)
  })

  test('binds a fresh session after the previous projection session stops', async () => {
    const prompts: string[] = []
    let starts = 0
    let status: 'running' | 'stopped' = 'running'
    const sessions = {
      start: () => {
        starts += 1
        return { id: `projection-session-${starts}` }
      },
      updateAuthToken: () => undefined,
      sendWithDisplay: async (_sessionId: string, prompt: string) => {
        prompts.push(prompt)
      },
      get: () => ({ status, turnStatus: 'idle', createdAt: new Date() }),
      rebindWorkflowWorker: async () => undefined,
    }
    const port = createBeeGameDeliveryWorkerPort({
      sessions: sessions as never,
      userId: 'user',
    })
    const request: WorkerDispatchRequest = {
      dispatchId: 'dispatch-stopped-0',
      runId: 'run-stopped',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'game-ir-compiler',
      phase: 'GAME_IR_COMPILATION',
      taskId: 'task-stopped',
      revision: 'revision',
      allowedPaths: [],
      projectReadScope: 'empty',
      contract: {
        kind: 'projection',
        currentSlice: 'gameplay.slice.0',
        sliceContext: EMPTY_SLICE_CONTEXT,
        packet: projectionPacket({
          taskId: 'task-stopped',
          revision: 'revision',
          receiptDigest: 'e'.repeat(64),
          sliceId: 'gameplay.slice.0',
        }),
        compileRequestDigest: digestGameIrValue({
          taskId: 'task-stopped',
          foundation: {
            foundationRevision: 'revision',
            receiptDigest: 'e'.repeat(64),
          },
        }),
        foundationReadyReceiptDigest: 'e'.repeat(64),
      },
    }
    await port.start(request)
    status = 'stopped'
    await port.start({ ...request, dispatchId: 'dispatch-stopped-1' })
    await port.submit('dispatch-stopped-1', 'ignored')
    expect(starts).toBe(2)
    expect(prompts[0]).toContain('## Current slice')
  })

  test('rejects a caller-supplied Game IR schema before session creation', async () => {
    let starts = 0
    const port = createBeeGameDeliveryWorkerPort({
      sessions: {
        start: () => {
          starts += 1
          return { id: 'unexpected-session' }
        },
      } as never,
      userId: 'user',
    })

    await expect(
      port.start({
        dispatchId: 'dispatch-forged-schema',
        runId: 'run-compiler',
        ownerId: 'owner',
        projectId: 'project',
        workspacePath: '/workspace',
        workerType: 'game-ir-compiler',
        phase: 'GAME_IR_COMPILATION',
        taskId: 'task-compiler',
        revision: 'revision-compiler',
        workflowJsonSchema: {
          type: 'object',
          properties: { forged: { type: 'boolean' } },
        },
        contract: {},
      } as never),
    ).rejects.toThrow(/schema is service-owned/)
    expect(starts).toBe(0)
  })

  test('selects the validation schema and prompt for a validation operation', async () => {
    const events = [
      {
        id: 1,
        sessionId: 'validation-session',
        type: 'result' as const,
        text: '',
        createdAt: new Date(),
        payload: {
          structured_output: {
            status: 'completed',
            validation: {
              outcome: 'PASS',
              checkIds: ['projection.completeness'],
              coveredTargets: ['gameplay.unit'],
            },
          },
        },
      },
    ]
    let submittedPrompt = ''
    const sessions = {
      start: () => ({ id: 'validation-session' }),
      updateAuthToken: () => undefined,
      sendWithDisplay: async (_sessionId: string, prompt: string) => {
        submittedPrompt = prompt
      },
      events: () => events,
      get: () => ({
        status: 'running',
        turnStatus: 'completed',
        createdAt: new Date(),
      }),
      waitForWorkflowWorkerIdle: async () => undefined,
      isWorkflowWorkerOpen: () => true,
    }
    const port = createBeeGameDeliveryWorkerPort({
      sessions: sessions as never,
      userId: 'user',
    })
    await port.start({
      dispatchId: 'dispatch-validation',
      runId: 'run-validation',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'game-ir-compiler',
      phase: 'GAME_IR_COMPILATION',
      taskId: 'task-validation',
      revision: 'revision-validation',
      allowedPaths: [],
      projectReadScope: 'empty',
      contract: {
        kind: 'validation',
        packet: {
          schemaVersion: 'game-ir-world-scene-validation-operation-packet.v1',
        },
        compileRequestDigest: 'a'.repeat(64),
        foundationReadyReceiptDigest: 'b'.repeat(64),
      },
    } as never)
    await port.submit('dispatch-validation', 'caller prompt is ignored')
    expect(submittedPrompt).toContain('"kind":"validation"')
    expect(submittedPrompt).toContain(
      'Perform only the assigned domain validation',
    )
    expect(submittedPrompt).not.toContain(
      'Perform only the assigned domain projection',
    )
    expect(await port.waitForTerminal!('dispatch-validation')).toMatchObject({
      workerType: 'game-ir-compiler',
      operation: 'validation',
      runId: 'run-validation',
      dispatchId: 'dispatch-validation',
      taskId: 'task-validation',
      revision: 'revision-validation',
    })
  })

  test('rejects a malformed Game IR projection record stream without cancellation', async () => {
    const events = [
      {
        id: 1,
        sessionId: 'compiler-session',
        type: 'result' as const,
        text: '',
        createdAt: new Date(),
        payload: {
          record_stream: '{"record":"done","sliceId":"gameplay.slice.1"}\n',
        },
      },
    ]
    let stopCalls = 0
    let idleCalls = 0
    const sessions = {
      start: () => ({ id: 'compiler-session' }),
      updateAuthToken: () => undefined,
      sendWithDisplay: async () => undefined,
      events: () => events,
      get: () => ({
        status: 'running',
        turnStatus: 'running',
        createdAt: new Date(),
      }),
      stop: () => {
        stopCalls += 1
      },
      waitForWorkflowWorkerIdle: async () => {
        idleCalls += 1
      },
      isWorkflowWorkerOpen: () => true,
    }
    const port = createBeeGameDeliveryWorkerPort({
      sessions: sessions as never,
      userId: 'user',
    })
    await port.start({
      dispatchId: 'dispatch-failed-compiler',
      runId: 'run-failed-compiler',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'game-ir-compiler',
      phase: 'GAME_IR_COMPILATION',
      taskId: 'task-failed-compiler',
      revision: 'revision-failed-compiler',
      allowedPaths: [],
      projectReadScope: 'empty',
      contract: {
        kind: 'projection',
        currentSlice: 'gameplay.slice.0',
        sliceContext: EMPTY_SLICE_CONTEXT,
        packet: projectionPacket({
          taskId: 'task-failed-compiler',
          revision: 'revision-failed-compiler',
          receiptDigest: 'b'.repeat(64),
          sliceId: 'gameplay.slice.0',
        }),
        compileRequestDigest: digestGameIrValue({
          taskId: 'task-failed-compiler',
          foundation: {
            foundationRevision: 'revision-failed-compiler',
            receiptDigest: 'b'.repeat(64),
          },
        }),
        foundationReadyReceiptDigest: 'b'.repeat(64),
      },
    } as never)

    const terminal = await port.waitForTerminal!('dispatch-failed-compiler')
    expect(terminal).toMatchObject({
      operation: 'projection',
      status: 'failed',
      records: [],
      done: false,
    })
    expect((terminal as { reason: string }).reason).toMatch(/wrong slice/i)
    expect(stopCalls).toBe(0)
    expect(idleCalls).toBe(0)
  })

  test('rejects a Game IR operation before session creation when packet or service identity is incomplete', async () => {
    let starts = 0
    const sessions = {
      start: () => {
        starts += 1
        return { id: 'unused' }
      },
      updateAuthToken: () => undefined,
    }
    const port = createBeeGameDeliveryWorkerPort({
      sessions: sessions as never,
      userId: 'user',
    })
    const request = {
      dispatchId: 'dispatch-invalid',
      runId: 'run-invalid',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'game-ir-compiler' as const,
      phase: 'GAME_IR_COMPILATION' as const,
      taskId: 'task-invalid',
      revision: 'revision-invalid',
      allowedPaths: [],
      projectReadScope: 'empty' as const,
    }
    await expect(
      port.start({
        ...request,
        contract: {
          kind: 'projection',
          compileRequestDigest: 'a'.repeat(64),
          foundationReadyReceiptDigest: 'b'.repeat(64),
        },
      } as never),
    ).rejects.toThrow(/packet/i)
    await expect(
      port.start({
        ...request,
        taskId: undefined,
        contract: {
          kind: 'projection',
          packet: {},
          compileRequestDigest: 'a'.repeat(64),
          foundationReadyReceiptDigest: 'b'.repeat(64),
        },
      } as never),
    ).rejects.toThrow(/identity/i)
    expect(starts).toBe(0)
  })

  test('submits the dispatch-built revision projection instead of rebuilding from the start request', async () => {
    const prompts: string[] = []
    const sessions = {
      start: () => ({ id: 'revision-session' }),
      updateAuthToken: () => undefined,
      sendWithDisplay: async (_sessionId: string, prompt: string) => {
        prompts.push(prompt)
      },
    }
    const port = createBeeGameDeliveryWorkerPort({
      sessions: sessions as never,
      userId: 'user',
    })
    await port.start({
      dispatchId: 'revision-dispatch',
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'foundation-document-reviser',
      phase: 'DOCUMENT_REVIEW',
      revision: 'revision',
      allowedPaths: ['docs/GDD.md'],
      contract: {
        workerType: 'foundation-document-reviser',
        stagedPath: 'docs/GDD.md',
      },
    })
    await port.submit('revision-dispatch', 'DISPATCH_BUILT_REVISION_PROJECTION')
    expect(prompts).toEqual(['DISPATCH_BUILT_REVISION_PROJECTION'])
  })

  test('persists only the exact selected upstream authority as complete input', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'focused-authority-'))
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await writeAuthoritySource(workspacePath, 'docs/GDD.md')
      await writeAuthoritySource(workspacePath, 'docs/LEVEL_SCENE_DESIGN.md')
      await writeFile(
        join(workspacePath, 'docs/UI_UX_SPEC.md'),
        '# Stale target\n\nSTALE TARGET BODY',
      )
      const block = await buildDocumentAuthorAuthorityBlock({
        dispatchId: 'dispatch-ui-authority',
        runId: 'run-ui-authority',
        workerType: 'document-author',
        workspacePath,
        allowedPaths: ['docs/UI_UX_SPEC.md'],
        contract: {
          authoringMode: 'initial',
          documentSet: 'foundation',
          foundationDocumentPath: 'docs/UI_UX_SPEC.md',
          availableUpstreamPaths: ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'],
        },
      } as never)
      expect(block).not.toContain(
        'Write the complete assigned Markdown document directly',
      )
      expect(block).toContain('complete selected upstream authority')
      expect(block).toContain('BEGIN FOUNDATION AUTHORITY')
      expect(block).not.toContain('complete when the turn ends')
      expect(block).not.toContain('file-operation sequence')
      expect(block).not.toContain('completeDocumentContract')
      expect(block).not.toContain('CommitCanonicalDocument')
      expect(block).not.toContain('document_parts_prepared')
      expect(block).not.toContain('write or edit the assigned path directly')
      expect(block).toContain(
        '.beegame/workflow/document-projections/dispatch-ui-authority.json',
      )
      const projected = JSON.parse(
        await readFile(
          join(
            workspacePath,
            '.beegame/workflow/document-projections/dispatch-ui-authority.json',
          ),
          'utf8',
        ),
      )
      expect(projected.targetPath).toBe('docs/UI_UX_SPEC.md')
      expect(projected.sources.length).toBeGreaterThan(0)
      expect(
        projected.sources.every(
          (source: {
            sections?: Array<{
              sectionId?: unknown
              startLine?: unknown
              lineCount?: unknown
              content?: unknown
              digest?: unknown
            }>
          }) =>
            source.sections?.every(
              section =>
                typeof section.sectionId === 'string' &&
                Number.isInteger(section.startLine) &&
                Number(section.startLine) > 0 &&
                Number.isInteger(section.lineCount) &&
                Number(section.lineCount) > 0 &&
                typeof section.content === 'string' &&
                section.content.includes(
                  `Authority content for ${String(section.sectionId)}.`,
                ) &&
                typeof section.digest === 'string' &&
                /^[a-f0-9]{64}$/.test(section.digest),
            ),
        ),
      ).toBe(true)
      expect(projected.sources[0]).not.toHaveProperty('sectionIds')
      expect(projected).not.toHaveProperty('records')
      expect(projected.sources[0].sections[0]).not.toHaveProperty(
        'contentLines',
      )
      expect(block).toContain('Authority content for')
      expect(block).not.toContain('"startLine"')
      expect(block).not.toContain('"lineCount"')
      expect(block).not.toContain('"digest"')
      expect(block).not.toContain('Confirmed authority for')
      expect(block).not.toContain('Unprojected production material payload.')
      expect(block).not.toContain('STALE TARGET BODY')
      expect(block).not.toContain('remaining bounded checkpoint sequence')
      expect(block).not.toContain('do not perform a separate target read')
      expect(block).not.toContain('Follow that sequence')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
