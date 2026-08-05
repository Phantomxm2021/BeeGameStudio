import { randomUUID } from 'node:crypto'
import { createQueryEngineRunner } from './query-engine-runner'
import type {
  BeeGameSessionRuntime,
  DashboardPermissionDecision,
} from './session-manager'
import { deserializeQueryEngineStartInput } from './query-engine-process-input'
import {
  serializeQueryEngineError,
  type QueryEngineParentMessage,
  type QueryEngineWorkerMessage,
} from './query-engine-worker-protocol'

let runtime: BeeGameSessionRuntime | null = null
let activeTurn: { id: string; abortController: AbortController } | null = null
const permissions = new Map<string, (decision: DashboardPermissionDecision) => void>()

process.on('message', raw => {
  void handleMessage(raw as QueryEngineParentMessage).catch(error => {
    send({
      type: 'runtime.error',
      error: serializeQueryEngineError(error, 'Claude runtime worker failed'),
    })
  })
})

async function handleMessage(message: QueryEngineParentMessage): Promise<void> {
  if (message.type === 'runtime.init') {
    if (runtime) throw new Error('Claude runtime worker is already initialized')
    runtime = await createQueryEngineRunner().start({
      ...deserializeQueryEngineStartInput(message.input),
      onNativeTaskNotification: notification => send({
        type: 'session.task-notification',
        notification,
      }),
      requestPermission: request => new Promise(resolve => {
        const requestId = randomUUID()
        permissions.set(requestId, resolve)
        send({
          type: 'session.permission.request',
          requestId,
          request,
        })
      }),
    })
    send({ type: 'runtime.ready' })
    return
  }
  if (message.type === 'turn.submit') {
    if (!runtime) throw new Error('Claude runtime worker is not initialized')
    if (activeTurn) throw new Error('Claude runtime worker already has an active turn')
    const abortController = new AbortController()
    activeTurn = { id: message.turnId, abortController }
    try {
      await runtime.submit({
        prompt: message.prompt,
        ...(message.confirmedBriefContext
          ? { confirmedBriefContext: message.confirmedBriefContext }
          : {}),
        ...(message.workflowDocumentReviewContract
          ? { workflowDocumentReviewContract: message.workflowDocumentReviewContract }
          : {}),
        signal: abortController.signal,
        onMessage: sdkMessage => send({
          type: 'turn.message',
          turnId: message.turnId,
          message: sdkMessage,
        }),
        requestPermission: request => new Promise(resolve => {
          const requestId = randomUUID()
          permissions.set(requestId, resolve)
          send({
            type: 'session.permission.request',
            requestId,
            request,
          })
        }),
      })
      send({ type: 'turn.completed', turnId: message.turnId })
    } catch (error) {
      send({
        type: 'turn.failed',
        turnId: message.turnId,
        error: serializeQueryEngineError(error, 'Claude runtime turn failed'),
      })
    } finally {
      activeTurn = null
    }
    return
  }
  if (message.type === 'permission.resolve') {
    const resolve = permissions.get(message.requestId)
    permissions.delete(message.requestId)
    resolve?.(message.decision)
    return
  }
  if (message.type === 'turn.stop') {
    if (!message.turnId || activeTurn?.id === message.turnId) {
      activeTurn?.abortController.abort()
      runtime?.stop()
    }
    return
  }
  if (message.type === 'runtime.dispose') {
    runtime?.stop()
    for (const resolve of permissions.values()) {
      resolve({ behavior: 'deny', message: 'Claude runtime worker was closed' })
    }
    permissions.clear()
    process.exit(0)
  }
}

function send(message: QueryEngineWorkerMessage): void {
  process.send?.(message)
}
