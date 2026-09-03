import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import { createDeliveryDispatcher } from './dispatch'
import type { DeliveryRun, WorkerDispatchRequest } from './types'
import type { RunStore } from './run-store'
import { digestGameIrValue } from './game-ir/model'
import { buildGameIrProjectionContract } from './game-ir/projection-contract'
import { sourceSectionsForGameIrProjectionSlice } from './game-ir/projection-slice-authority'

function fixture() {
  const identity = {
    runId: 'run-game-ir-dispatch',
    taskId: 'game-ir-task',
    publicationId: 'game-ir-publication',
    confirmedBriefDigest: createHash('sha256')
      .update('Confirmed delivery brief for project')
      .digest('hex'),
    foundationRevision: 'foundation-revision',
    foundationReadyReceiptDigest: 'c'.repeat(64),
  } as const
  const packetBody = {
    schemaVersion: 'game-ir-gameplay-projection-operation-packet.v1',
      source: {
        moduleId: 'gameplay',
        taskId: identity.taskId,
        sourceDigest: 's'.repeat(64),
      compileRequest: {
        taskId: identity.taskId,
        foundation: {
          foundationRevision: identity.foundationRevision,
          receiptDigest: identity.foundationReadyReceiptDigest,
        },
      },
    },
    semanticPacket: { moduleId: 'gameplay', taskId: identity.taskId },
    projectionContract: buildGameIrProjectionContract('gameplay'),
    dependencies: {},
  }
  const sourceSections = sourceSectionsForGameIrProjectionSlice('gameplay.slice.0').map(
    (selector, index) => {
      const bytes = `DISPATCH_RECOVERY_AUTHORITY_${index}`
      return {
        ...selector,
        digest: createHash('sha256').update(bytes).digest('hex'),
        bytes,
      }
    },
  )
  ;(packetBody.source as Record<string, unknown>).sectionIndex = sourceSections.map(({ bytes: _, ...section }) => section)
  ;(packetBody.source as Record<string, unknown>).sectionBytes = Object.fromEntries(
    sourceSections.map(section => [
      `${section.documentPath}#${section.sectionId}`,
      section.bytes,
    ]),
  )
  const packet = { ...packetBody, packetDigest: digestGameIrValue(packetBody) }
  const inventoryBody = {
    schemaVersion: 'game-ir-semantic-obligation-inventory.v1',
    moduleId: 'gameplay',
    sourceDigest: 's'.repeat(64),
    obligations: [],
    index: {},
  }
  const obligationInventory = {
    ...inventoryBody,
    digest: digestGameIrValue(inventoryBody),
  }
  const compileRequestDigest = digestGameIrValue(
    packetBody.source.compileRequest,
  )
  const request: WorkerDispatchRequest = {
    dispatchId: 'game-ir-dispatch',
    runId: identity.runId,
    ownerId: 'owner',
    projectId: 'project',
    workspacePath: '',
    workerType: 'game-ir-compiler',
    phase: 'GAME_IR_COMPILATION',
    taskId: identity.taskId,
    revision: identity.foundationRevision,
    contract: {
      kind: 'projection',
      packet,
      compileRequestDigest,
      foundationReadyReceiptDigest: identity.foundationReadyReceiptDigest,
      currentSlice: 'gameplay.slice.0',
      progress: [],
      obligationInventory,
      sliceContext: {
        availablePriorNodes: [],
        requiredCurrentNodes: [],
        admittedCurrentNodes: [],
      },
    },
  }
  const run = {
    ...createTestDeliveryRun({
      runId: identity.runId,
      ownerId: request.ownerId,
      projectId: request.projectId,
      confirmedBriefDigest: createHash('sha256')
        .update('Confirmed delivery brief for project')
        .digest('hex'),
    }),
    phase: 'GAME_IR_COMPILATION' as const,
    status: 'running' as const,
    activeDispatch: {
      dispatchId: request.dispatchId!,
      workerType: request.workerType,
      phase: request.phase,
      taskId: request.taskId,
      revision: request.revision,
      status: 'running' as const,
      startedAt: new Date().toISOString(),
      request,
    },
    gameIrState: { status: 'compiling' as const, identity },
  }
  return { identity, request, run }
}

function memoryStore(initial: DeliveryRun): RunStore {
  let durable = initial
  return {
    load: async () => durable,
    commit: async (next: typeof durable) => {
      durable = next
      return durable
    },
    mutationLock: async () => ({ runId: durable.runId, ownerId: 'test' }),
    unlock: async () => undefined,
  } as unknown as RunStore
}

function terminal(
  request: WorkerDispatchRequest,
  overrides: Record<string, unknown> = {},
) {
  return {
    workerType: 'game-ir-compiler',
    operation: 'projection',
    status: 'completed',
    sliceId: request.contract.currentSlice,
    records: [],
    done: true,
    runId: request.runId,
    dispatchId: request.dispatchId,
    taskId: request.taskId,
    revision: request.revision,
    compileRequestDigest: request.contract.compileRequestDigest,
    foundationReadyReceiptDigest: request.contract.foundationReadyReceiptDigest,
    ...overrides,
  }
}

function failedTerminal(request: WorkerDispatchRequest, reason: string) {
  return {
    workerType: 'game-ir-compiler',
    operation: 'projection',
    status: 'failed',
    sliceId: request.contract.currentSlice,
    records: [],
    done: false,
    reason,
    runId: request.runId,
    dispatchId: request.dispatchId,
    taskId: request.taskId,
    revision: request.revision,
    compileRequestDigest: request.contract.compileRequestDigest,
    foundationReadyReceiptDigest: request.contract.foundationReadyReceiptDigest,
  }
}

function validationTerminal(request: WorkerDispatchRequest) {
  return {
    workerType: 'game-ir-compiler',
    operation: 'validation',
    status: 'completed',
    validation: {
      outcome: 'PASS',
      checkIds: ['check'],
      coveredTargets: ['gameplay.node'],
    },
    runId: request.runId,
    dispatchId: request.dispatchId,
    taskId: request.taskId,
    revision: request.revision,
    compileRequestDigest: request.contract.compileRequestDigest,
    foundationReadyReceiptDigest: request.contract.foundationReadyReceiptDigest,
  }
}

describe('Game IR dispatch crash windows', () => {
  test('binds projection dispatch and terminal to the canonical current slice', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'game-ir-slice-contract-'))
    const { request, run: fixtureRun } = fixture()
    request.workspacePath = workspace
    const run = fixtureRun as DeliveryRun
    run.activeDispatch!.request = request
    const store = memoryStore(run)
    const dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        start: async () => ({
          sessionId: 's',
          dispatchId: request.dispatchId!,
        }),
        submit: async () => undefined,
        stop: async () => undefined,
        status: async () => run.activeDispatch!,
      },
    })

    await expect(
      dispatcher.completeDispatch(
        request.dispatchId!,
        terminal(request, { sliceId: 'gameplay.slice.1' }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_terminal' })

    const forged = {
      ...request,
      contract: { ...request.contract, currentSlice: 'gameplay.not-a-slice' },
    }
    const forgedRun = {
      ...run,
      activeDispatch: { ...run.activeDispatch!, request: forged },
    }
    const forgedDispatcher = createDeliveryDispatcher({
      store: memoryStore(forgedRun),
      workerPort: {
        start: async () => ({ sessionId: 's', dispatchId: forged.dispatchId! }),
        submit: async () => undefined,
        stop: async () => undefined,
        status: async () => forgedRun.activeDispatch!,
      },
    })
    await expect(forgedDispatcher.dispatch(forged)).rejects.toMatchObject({
      code: 'blocked',
    })

    const badRetry = {
      ...request,
      contract: {
        ...request.contract,
        retryDiagnostic: {
          sliceId: 'gameplay.slice.1',
          reason: 'stale retry',
        },
      },
    }
    const retryRun = {
      ...run,
      activeDispatch: { ...run.activeDispatch!, request: badRetry },
    }
    await expect(
      createDeliveryDispatcher({
        store: memoryStore(retryRun),
        workerPort: {
          start: async () => ({
            sessionId: 's',
            dispatchId: badRetry.dispatchId!,
          }),
          submit: async () => undefined,
          stop: async () => undefined,
          status: async () => retryRun.activeDispatch!,
        },
      }).dispatch(badRetry),
    ).rejects.toMatchObject({ code: 'blocked' })
  })

  test('closes the transport after the final projection slice', async () => {
    const workspace = await mkdtemp(
      join(tmpdir(), 'game-ir-final-slice-close-'),
    )
    const { request, run: fixtureRun } = fixture()
    request.workspacePath = workspace
    request.contract = {
      ...request.contract,
      currentSlice: 'gameplay.slice.1',
      progress: [{ sliceId: 'gameplay.slice.0', entryDigest: 'f'.repeat(64) }],
    }
    const run = fixtureRun as DeliveryRun
    run.activeDispatch!.request = request
    const closed: Array<{ preserveSession?: boolean }> = []
    const store = memoryStore(run)
    const dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        start: async () => ({
          sessionId: 's',
          dispatchId: request.dispatchId!,
        }),
        submit: async () => undefined,
        stop: async () => undefined,
        close: async (_dispatchId, options) => {
          closed.push(options ?? {})
        },
        status: async () => run.activeDispatch!,
      },
    })
    await dispatcher.completeDispatch(request.dispatchId!, terminal(request))
    expect(closed).toEqual([{}])
  })

  test('closes the transport after every completed projection slice', async () => {
    const workspace = await mkdtemp(
      join(tmpdir(), 'game-ir-non-final-slice-close-'),
    )
    const { request, run: fixtureRun } = fixture()
    request.workspacePath = workspace
    const run = fixtureRun as DeliveryRun
    run.activeDispatch!.request = request
    const closed: Array<{ preserveSession?: boolean }> = []
    const dispatcher = createDeliveryDispatcher({
      store: memoryStore(run),
      workerPort: {
        start: async () => ({
          sessionId: 's',
          dispatchId: request.dispatchId!,
        }),
        submit: async () => undefined,
        stop: async () => undefined,
        close: async (_dispatchId, options) => {
          closed.push(options ?? {})
        },
        status: async () => run.activeDispatch!,
      },
      onTerminal: async () => undefined,
    })

    await dispatcher.completeDispatch(request.dispatchId!, terminal(request))
    expect(closed).toEqual([{}])
  })

  test('rejects a projection packet that tries to use the old source-missing identity fallback', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'game-ir-source-bound-'))
    const { request, run: fixtureRun } = fixture()
    request.workspacePath = workspace
    const run = fixtureRun as DeliveryRun
    const packet = { ...(request.contract.packet as Record<string, unknown>) }
    delete packet.source
    const forged = { ...request, contract: { ...request.contract, packet } }
    run.activeDispatch!.request = forged
    const dispatcher = createDeliveryDispatcher({
      store: memoryStore(run),
      workerPort: {
        start: async () => ({ sessionId: 's', dispatchId: forged.dispatchId! }),
        submit: async () => undefined,
        stop: async () => undefined,
        status: async () => run.activeDispatch!,
      },
    })
    await expect(dispatcher.dispatch(forged)).rejects.toMatchObject({
      code: 'blocked',
    })
  })

  test('rejects a terminal whose operation or service identity differs from the active contract', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'game-ir-dispatch-red-'))
    const first = fixture()
    const { request, run: fixtureRun } = first
    const run = fixtureRun as DeliveryRun
    request.workspacePath = workspace
    run.activeDispatch!.request = request
    const store = memoryStore(run)
    const dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        start: async () => ({ sessionId: 's', dispatchId: 'd' }),
        submit: async () => undefined,
        stop: async () => undefined,
        status: async () => run.activeDispatch!,
      },
    })

    await expect(
      dispatcher.completeDispatch(
        request.dispatchId!,
        validationTerminal(request),
      ),
    ).rejects.toMatchObject({ code: 'invalid_terminal' })

    const second = fixture()
    second.request.workspacePath = workspace
    second.run.activeDispatch!.request = second.request
    const secondStore = memoryStore(second.run)
    const secondDispatcher = createDeliveryDispatcher({
      store: secondStore,
      workerPort: {
        start: async () => ({ sessionId: 's', dispatchId: 'd' }),
        submit: async () => undefined,
        stop: async () => undefined,
        status: async () => second.run.activeDispatch!,
      },
    })
    await expect(
      secondDispatcher.completeDispatch(
        second.request.dispatchId!,
        terminal(second.request, { taskId: 'other-task' }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_terminal' })
  })

  test('rejects a projection correction diagnostic instead of reopening the old whole-domain route', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'game-ir-correction-'))
    const { request, run: fixtureRun } = fixture()
    const run = fixtureRun as DeliveryRun
    request.workspacePath = workspace
    const packet = request.contract.packet
    request.contract = {
      ...request.contract,
      correctionDiagnostic: {
        step: 'phase4/gameplay/projection',
        reason: 'Output does not match required schema: /semantic/nodes/0',
      },
    }
    run.activeDispatch!.request = request
    const store = memoryStore(run)
    const dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        start: async () => ({ sessionId: 's', dispatchId: 'd' }),
        submit: async () => undefined,
        stop: async () => undefined,
        status: async () => run.activeDispatch!,
      },
    })

    await expect(
      dispatcher.completeDispatch(request.dispatchId!, terminal(request)),
    ).rejects.toMatchObject({ code: 'invalid_terminal' })

    expect(request.contract.packet).toBe(packet)
    expect((await store.load())?.activeDispatch?.status).toBe('invalid')
  })

  test('rejects slice fields on an obligation preflight dispatch contract', async () => {
    const { request, run: fixtureRun } = fixture()
    const run = fixtureRun as DeliveryRun
    request.contract = {
      ...request.contract,
      kind: 'obligation-inventory',
    }
    run.activeDispatch!.request = request
    const dispatcher = createDeliveryDispatcher({
      store: memoryStore(run),
      workerPort: {
        start: async () => ({ sessionId: 's', dispatchId: 'd' }),
        submit: async () => undefined,
        stop: async () => undefined,
        status: async () => run.activeDispatch!,
      },
    })

    await expect(dispatcher.dispatch(request)).rejects.toMatchObject({
      code: 'blocked',
    })
  })

  test('rejects every terminal identity mismatch at admission and replay', async () => {
    const mismatches = [
      ['runId', 'other-run'],
      ['dispatchId', 'other-dispatch'],
      ['taskId', 'other-task'],
      ['revision', 'other-revision'],
      ['compileRequestDigest', 'd'.repeat(64)],
      ['foundationReadyReceiptDigest', 'e'.repeat(64)],
    ] as const
    for (const [field, value] of mismatches) {
      const workspace = await mkdtemp(join(tmpdir(), `game-ir-${field}-`))
      const { request, run: fixtureRun } = fixture()
      const run = fixtureRun as DeliveryRun
      request.workspacePath = workspace
      run.activeDispatch!.request = request
      const store = memoryStore(run)
      const dispatcher = createDeliveryDispatcher({
        store,
        workerPort: {
          start: async () => ({ sessionId: 's', dispatchId: 'd' }),
          submit: async () => undefined,
          stop: async () => undefined,
          status: async () => run.activeDispatch!,
        },
      })
      await expect(
        dispatcher.completeDispatch(
          request.dispatchId!,
          terminal(request, { [field]: value }),
        ),
      ).rejects.toMatchObject({ code: 'invalid_terminal' })

      run.activeDispatch!.status = 'completed'
      run.activeDispatch!.finishedAt = new Date().toISOString()
      run.activeDispatch!.terminalResult = terminal(request)
      await expect(
        dispatcher.replayTerminal({
          ...run.activeDispatch!,
          terminalResult: terminal(request, { [field]: value }),
        }),
      ).rejects.toThrow()
    }
  })

  test('keeps the accepted terminal when its handler fails before checkpoint admission', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'game-ir-handler-red-'))
    const { request, run: fixtureRun } = fixture()
    const run = fixtureRun as DeliveryRun
    request.workspacePath = workspace
    run.activeDispatch!.request = request
    const store = memoryStore(run)
    const dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        start: async () => ({ sessionId: 's', dispatchId: 'd' }),
        submit: async () => undefined,
        stop: async () => undefined,
        status: async () => run.activeDispatch!,
      },
      onTerminal: async () => {
        throw new Error('checkpoint admission failed')
      },
    })

    await expect(
      dispatcher.completeDispatch(request.dispatchId!, terminal(request)),
    ).rejects.toThrow('checkpoint admission failed')
    expect((await store.load())?.activeDispatch).toMatchObject({
      status: 'completed',
      terminalResult: {
        workerType: 'game-ir-compiler',
        operation: 'projection',
      },
    })
  })

  test('keeps a durable Game IR diagnostic when close rejects the in-flight submit', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'game-ir-submit-race-'))
    const { request, run: fixtureRun } = fixture()
    const run = fixtureRun as DeliveryRun
    request.workspacePath = workspace
    run.activeDispatch = undefined
    const store = memoryStore(run)
    const events: string[] = []
    let rejectSubmit: ((error: Error) => void) | undefined
    const diagnosticRef = 'game-ir-submit-race'
    const diagnosticReason =
      'projection output is missing required edge targetType'
    const submitRejected = new Promise<never>((_, reject) => {
      rejectSubmit = reject
    })
    const dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        start: async () => {
          events.push('start')
          return { sessionId: 's', dispatchId: request.dispatchId! }
        },
        submit: async () => {
          events.push('submit')
          return submitRejected
        },
        waitForTerminal: async () => {
          events.push('waitForTerminal')
          return failedTerminal(request, diagnosticReason)
        },
        stop: async () => {
          events.push('stop')
        },
        close: async () => {
          const current = await store.load()
          const gameIrState = current?.gameIrState
          expect(gameIrState?.status).toBe('compiling')
          if (gameIrState?.status !== 'compiling')
            throw new Error('Game IR diagnostic was not committed before close')
          expect(gameIrState.diagnosticRef).toBe(diagnosticRef)
          expect(current?.status).toBe('running')
          events.push('close-after-diagnostic')
          rejectSubmit?.(
            new Error('native session closed before submit completed'),
          )
        },
        status: async () => run.activeDispatch!,
      },
      onTerminal: async (_record, result) => {
        expect(result).toMatchObject({
          workerType: 'game-ir-compiler',
          status: 'failed',
          reason: diagnosticReason,
        })
        events.push('onTerminal')
        const current = await store.load()
        expect(current?.activeDispatch).toMatchObject({
          status: 'failed',
          terminalResult: {
            workerType: 'game-ir-compiler',
            operation: 'projection',
            status: 'failed',
            reason: diagnosticReason,
          },
        })
        const gameIrState = current?.gameIrState
        if (!current || gameIrState?.status !== 'compiling')
          throw new Error('Game IR compilation state is missing')
        const diagnosticRun: DeliveryRun = {
          ...current,
          activeDispatch: undefined,
          status: 'running',
          blockedReason: undefined,
          thinking: 'working',
          gameIrState: {
            ...gameIrState,
            diagnosticRef,
            diagnostic: {
              phase: 'GAME_IR_COMPILATION',
              step: 'phase4/gameplay/projection',
              taskId: request.taskId!,
              workerType: 'game-ir-compiler',
              reasonCode: 'compilation',
              expected: 'phase4/gameplay/projection',
              actual: diagnosticReason,
              diagnosticRef,
              recoveryAction: 'retry the same compilation identity',
            },
          },
        }
        await store.commit(diagnosticRun, {
          runId: current.runId,
          type: 'game_ir_compilation.retryable',
          phase: current.phase,
          status: 'running',
          revision: current.revision,
          dispatchId: request.dispatchId,
          reason: diagnosticReason,
        })
        events.push('diagnostic-committed')
      },
    })

    await expect(dispatcher.dispatch(request)).rejects.toThrow(
      'native session closed before submit completed',
    )
    await dispatcher.waitForTerminalReconciliation()

    const persisted = await store.load()
    expect(persisted).toMatchObject({
      status: 'running',
      activeDispatch: undefined,
      gameIrState: {
        status: 'compiling',
        diagnosticRef,
        diagnostic: {
          phase: 'GAME_IR_COMPILATION',
          actual: diagnosticReason,
        },
      },
    })
    expect(persisted?.status).not.toBe('stopped')
    expect(persisted?.blockedReason ?? '').not.toContain(
      'native session closed',
    )
    expect(events).toEqual([
      'start',
      'waitForTerminal',
      'submit',
      'onTerminal',
      'diagnostic-committed',
      'close-after-diagnostic',
      'stop',
      'close-after-diagnostic',
    ])
  })

  test('replay validates the same operation and identity binding as first admission', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'game-ir-replay-red-'))
    const { request, run: fixtureRun } = fixture()
    const run = fixtureRun as DeliveryRun
    request.workspacePath = workspace
    run.activeDispatch!.request = request
    const accepted = terminal(request)
    run.activeDispatch!.status = 'completed'
    run.activeDispatch!.finishedAt = new Date().toISOString()
    run.activeDispatch!.terminalResult = accepted
    const store = memoryStore(run)
    const dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        start: async () => ({ sessionId: 's', dispatchId: 'd' }),
        submit: async () => undefined,
        stop: async () => undefined,
        status: async () => run.activeDispatch!,
      },
      onTerminal: async () => undefined,
    })
    await expect(
      dispatcher.replayTerminal({
        ...run.activeDispatch!,
        terminalResult: validationTerminal(request),
      }),
    ).rejects.toThrow()
  })
})
