import type { BeeGameUsageBillingClient } from '@bee-game-studio/beegame-billing-core/usage-control-client'
import { realpath } from 'node:fs/promises'
import { createAuthenticationClient } from '../auth/public'
import type { BeeGameSessionCredential } from '../auth/session-routes'
import type { DashboardRepository } from '../dashboard-repository'
import { createUsageBillingClient } from '../billing/public'
import { createRuntimeConfigurationClient } from '../runtime-configuration/public'
import { createGameIrStage, type GameIrOperations } from './stage-modules/game-ir/public'

/** Trusted application-owned assembly options; no compiler or execute callback crosses this boundary. */
export type GameIrHostOptions = {
  ownerId: string
  workspacePath: string
  dataDir: string
  modelConfigId?: string
  command?: readonly string[]
  getCommand?: () => readonly string[]
  getCredential: () => BeeGameSessionCredential | undefined
  getRuntimeEnv: DashboardRepository['getRuntimeEnv']
  billingClient: BeeGameUsageBillingClient
}

export type GameIrHost = GameIrOperations

/** Lazy host assembly mirrors Foundation Reviewer and keeps credentials/billing private. */
export function createGameIrHost(options: GameIrHostOptions): GameIrHost {
  assertHostOptions(options)
  const ownerId = options.ownerId
  const workspacePath = options.workspacePath
  const dataDir = options.dataDir
  const modelConfigId = options.modelConfigId
  const command = options.command ? [...options.command] : undefined
  const getCommand = options.getCommand
  const getCredential = options.getCredential
  const getRuntimeEnv = options.getRuntimeEnv
  const recordUsage = options.billingClient.recordUsage.bind(options.billingClient)
  const debitRealTimeUsage = options.billingClient.debitRealTimeUsage.bind(options.billingClient)
  let stagePromise: Promise<GameIrOperations> | undefined
  const getStage = (): Promise<GameIrOperations> => {
    if (!stagePromise) {
      const assembly = Promise.resolve().then(async () => {
        const authentication = createAuthenticationClient({ ownerId, credential: {
          async getValidAccessToken(request) { return getCredential()?.getValidAccessToken(request) },
        } })
        const runtimeConfiguration = createRuntimeConfigurationClient({ ownerId, dataDir,
          ...(modelConfigId ? { modelConfigId } : {}), authentication,
          repository: { getRuntimeEnv }, command: getCommand ? [...getCommand()] : [...(command ?? [])],
        })
        const billing = createUsageBillingClient({ ownerId, billingClient: { recordUsage, debitRealTimeUsage } })
        return createGameIrStage({ workspacePath: await realpath(workspacePath) }, { runtimeConfiguration, billing })
      })
      const retryable = assembly.catch(error => { if (stagePromise === retryable) stagePromise = undefined; throw error })
      stagePromise = retryable
    }
    return stagePromise
  }
  return Object.freeze({
    start: input => getStage().then(stage => stage.start(input)),
    resume: input => getStage().then(stage => stage.resume(input)),
    stop: input => getStage().then(stage => stage.stop(input)),
    getResult: input => getStage().then(stage => stage.getResult(input)),
    readResult: input => getStage().then(stage => stage.readResult(input)),
    revise: input => getStage().then(stage => stage.revise(input)),
  })
}

const OPTION_KEYS = new Set(['ownerId', 'workspacePath', 'dataDir', 'modelConfigId', 'command', 'getCommand', 'getCredential', 'getRuntimeEnv', 'billingClient'])
function assertHostOptions(value: GameIrHostOptions): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)
    throw new TypeError('game IR host options are required')
  if (Object.keys(value).some(key => !OPTION_KEYS.has(key))) throw new TypeError('game IR host options contain unexpected fields')
  for (const key of ['ownerId', 'workspacePath', 'dataDir'] as const)
    if (typeof value[key] !== 'string' || value[key].length === 0) throw new TypeError(`game IR host ${key} is invalid`)
  if (value.modelConfigId !== undefined && (!value.modelConfigId || typeof value.modelConfigId !== 'string')) throw new TypeError('game IR host modelConfigId is invalid')
  if (typeof value.getCredential !== 'function' || typeof value.getRuntimeEnv !== 'function') throw new TypeError('game IR host runtime readers are required')
  if (!value.billingClient || typeof value.billingClient.recordUsage !== 'function' || typeof value.billingClient.debitRealTimeUsage !== 'function') throw new TypeError('game IR host billing client is invalid')
  const hasCommand = value.command !== undefined, hasGetter = value.getCommand !== undefined
  if (hasCommand === hasGetter) throw new TypeError('game IR host requires exactly one command source')
  if (hasCommand && (!Array.isArray(value.command) || value.command.length === 0 || value.command.some(part => typeof part !== 'string' || part.length === 0))) throw new TypeError('game IR host command is invalid')
  if (hasGetter && typeof value.getCommand !== 'function') throw new TypeError('game IR host command getter is invalid')
}
