import { randomUUID } from 'node:crypto'
import type { ApprovedOutboundTarget } from '@bee-game-studio/security-core'
import { createQueryEngineRunner } from './query-engine-runner'
import type {
  BeeGameApprovedOutboundTargets,
  BeeGameSessionRuntime,
  DashboardPermissionDecision,
} from './session-manager'
import type {
  QueryEngineParentMessage,
  QueryEngineWorkerMessage,
  SerializedQueryEngineStartInput,
} from './query-engine-worker-protocol'

let runtime: BeeGameSessionRuntime | null = null
let activeTurn: { id: string; abortController: AbortController } | null = null
const permissions = new Map<string, (decision: DashboardPermissionDecision) => void>()

process.on('message', raw => {
  void handleMessage(raw as QueryEngineParentMessage).catch(error => {
    send({
      type: 'runtime.error',
      message: error instanceof Error ? error.message : 'Claude runtime worker failed',
    })
  })
})

async function handleMessage(message: QueryEngineParentMessage): Promise<void> {
  if (message.type === 'runtime.init') {
    if (runtime) throw new Error('Claude runtime worker is already initialized')
    runtime = await createQueryEngineRunner().start(deserializeStartInput(message.input))
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
        signal: abortController.signal,
        ...(message.deliveryValidationRequired
          ? { deliveryValidationRequired: true }
          : {}),
        ...(message.deliveryValidationOnMutation
          ? { deliveryValidationOnMutation: true }
          : {}),
        onMessage: sdkMessage => send({
          type: 'turn.message',
          turnId: message.turnId,
          message: sdkMessage,
        }),
        requestPermission: request => new Promise(resolve => {
          const requestId = randomUUID()
          permissions.set(requestId, resolve)
          send({
            type: 'permission.request',
            turnId: message.turnId,
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
        message: error instanceof Error ? error.message : 'Claude runtime turn failed',
      })
    } finally {
      activeTurn = null
      permissions.clear()
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
    process.exit(0)
  }
}

function deserializeStartInput(input: SerializedQueryEngineStartInput) {
  return {
    sessionId: input.sessionId,
    ...(input.resumeSessionId ? { resumeSessionId: input.resumeSessionId } : {}),
    cwd: input.cwd,
    env: input.env,
    approvedOutboundTargets: Object.fromEntries(
      Object.entries(input.approvedOutboundTargets).map(([key, target]) => [
        key,
        createApprovedTarget(target.url, target.addresses),
      ]),
    ) as BeeGameApprovedOutboundTargets,
    ...(input.agentDefinitions
      ? {
          agentDefinitions: input.agentDefinitions.map(agent => ({
            agentType: agent.agentType,
            whenToUse: agent.whenToUse,
            ...(agent.tools ? { tools: agent.tools } : {}),
            ...(agent.disallowedTools ? { disallowedTools: agent.disallowedTools } : {}),
            source: agent.source,
            ...(agent.permissionMode ? { permissionMode: agent.permissionMode } : {}),
            getSystemPrompt: () => agent.systemPrompt,
            ...(agent.maxTurns ? { maxTurns: agent.maxTurns } : {}),
          })),
        }
      : {}),
  }
}

function createApprovedTarget(url: string, addresses: string[]): ApprovedOutboundTarget {
  const parsed = new URL(url)
  return {
    url: parsed,
    addresses,
    lookup(hostname, _options, callback) {
      if (hostname !== parsed.hostname || addresses.length === 0) {
        callback(new Error('Outbound URL is not permitted'), '', 4)
        return
      }
      const address = addresses[0]!
      callback(null, address, address.includes(':') ? 6 : 4)
    },
  }
}

function send(message: QueryEngineWorkerMessage): void {
  process.send?.(message)
}
