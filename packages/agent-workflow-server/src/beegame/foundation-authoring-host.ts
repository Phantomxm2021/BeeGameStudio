import type { BeeGameUsageBillingClient } from '@bee-game-studio/beegame-billing-core/usage-control-client'
import { join } from 'node:path'
import { realpath } from 'node:fs/promises'
import { createAuthenticationClient } from '../auth/public'
import type { BeeGameSessionCredential } from '../auth/session-routes'
import type { DashboardRepository } from '../dashboard-repository'
import {
  createUsageBillingClient,
} from '../billing/public'
import {
  createRuntimeConfigurationClient,
} from '../runtime-configuration/public'
import {
  createFoundationAuthoring,
  type AuthorConfiguration,
} from './stage-modules/foundation-authoring/public'
import type { AutonomousNativeExecutor } from './stage-modules/foundation-authoring/private/autonomous-native'

type AuthorOperations = ReturnType<typeof createFoundationAuthoring>

/**
 * Inputs owned by the trusted application host. Stage code receives no
 * credential, repository, billing, or worker callback from this boundary.
 */
export type FoundationAuthoringHostOptions = {
  ownerId: string
  workspacePath: string
  dataDir: string
  modelConfigId?: string
  language?: string
  /** Static command for offline hosts. Mutually exclusive with getCommand. */
  command?: readonly string[]
  /** Lazy command resolver for hosts whose native runtime is not boot-ready. */
  getCommand?: () => readonly string[]
  /** Reads the current transport credential on every runtime token request. */
  getCredential: () => BeeGameSessionCredential | undefined
  getRuntimeEnv: DashboardRepository['getRuntimeEnv']
  billingClient: BeeGameUsageBillingClient
  /** Required: production authoring must run through the project's primary conversation. */
  execute: AutonomousNativeExecutor
}

/** The only object exposed to app/controller code from this host assembly. */
export type FoundationAuthoringHost = Pick<
  AuthorOperations,
  'start' | 'resume' | 'stop' | 'getResult'
>

/**
 * Assemble the public authoring port lazily. Creating a host does not inspect
 * the native command, request a token, read runtime configuration, or start a
 * session. Those happen only when one of the four returned operations runs.
 */
export function createFoundationAuthoringHost(
  options: FoundationAuthoringHostOptions,
): FoundationAuthoringHost {
  assertHostOptions(options)

  // Snapshot the host wiring after validation. The credential getter is the
  // one intentional exception: its result must remain dynamic as transport
  // sessions refresh or rotate. No later mutation of the caller's options
  // object can change the bound workspace, model, command, reader, or billing
  // methods before the first lazy operation.
  const boundOwnerId = options.ownerId
  const boundWorkspacePath = options.workspacePath
  const boundDataDir = options.dataDir
  const boundModelConfigId = options.modelConfigId
  const boundLanguage = options.language
  const boundCommand = options.command ? [...options.command] : undefined
  const boundGetCommand = options.getCommand
  const boundGetCredential = options.getCredential
  const boundGetRuntimeEnv = options.getRuntimeEnv
  const boundRecordUsage = options.billingClient.recordUsage.bind(options.billingClient)
  const boundDebitRealTimeUsage = options.billingClient.debitRealTimeUsage.bind(options.billingClient)
  const boundExecute = options.execute

  // This wrapper is deliberately stable while its delegated credential is
  // dynamic. AuthenticationClient performs the existing owner and token
  // validation; no token or credential snapshot is retained here.
  const authentication = createAuthenticationClient({
    ownerId: boundOwnerId,
    credential: {
      async getValidAccessToken(request) {
        const credential = boundGetCredential()
        return credential?.getValidAccessToken(request)
      },
    },
  })

  let stagePromise: Promise<AuthorOperations> | undefined
  const getStage = (): Promise<AuthorOperations> => {
    if (!stagePromise) {
      const assembly = Promise.resolve().then(() => {
        const command = boundGetCommand
          ? [...boundGetCommand()]
          : [...(boundCommand ?? [])]
        const runtimeConfiguration = createRuntimeConfigurationClient({
          ownerId: boundOwnerId,
          dataDir: boundDataDir,
          ...(boundModelConfigId ? { modelConfigId: boundModelConfigId } : {}),
          authentication,
          repository: { getRuntimeEnv: boundGetRuntimeEnv },
          command,
        })
        const billing = createUsageBillingClient({
          ownerId: boundOwnerId,
          billingClient: {
            recordUsage: boundRecordUsage,
            debitRealTimeUsage: boundDebitRealTimeUsage,
          },
        })
        return realpath(boundWorkspacePath).then(workspacePath => {
          const config: AuthorConfiguration = {
            workspacePath,
            privateRootPath: join(workspacePath, '.beegame', 'workflow', 'foundation-authoring', 'state'),
            ...(boundLanguage ? { language: boundLanguage } : {}),
          }
          return createFoundationAuthoring(config, { runtimeConfiguration, billing }, boundExecute)
        })
      })
      const retryableAssembly = assembly.catch(error => {
        if (stagePromise === retryableAssembly) stagePromise = undefined
        throw error
      })
      stagePromise = retryableAssembly
    }
    return stagePromise
  }

  const host: FoundationAuthoringHost = {
    start: input => getStage().then(stage => stage.start(input)),
    resume: input => getStage().then(stage => stage.resume(input)),
    stop: input => getStage().then(stage => stage.stop(input)),
    getResult: handle => getStage().then(stage => stage.getResult(handle)),
  }
  return Object.freeze(host)
}

const HOST_OPTION_KEYS = new Set([
  'ownerId',
  'workspacePath',
  'dataDir',
  'modelConfigId',
  'language',
  'command',
  'getCommand',
  'getCredential',
  'getRuntimeEnv',
  'billingClient',
  'execute',
])

function assertHostOptions(value: FoundationAuthoringHostOptions): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('foundation authoring host options are required')
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('foundation authoring host options must be a plain object')
  }
  if (Object.keys(value).some(key => !HOST_OPTION_KEYS.has(key))) {
    throw new TypeError('foundation authoring host options contain unexpected fields')
  }
  assertNonEmpty(value.ownerId, 'ownerId')
  assertNonEmpty(value.workspacePath, 'workspacePath')
  assertNonEmpty(value.dataDir, 'dataDir')
  if (value.modelConfigId !== undefined) assertNonEmpty(value.modelConfigId, 'modelConfigId')
  if (value.language !== undefined) assertNonEmpty(value.language, 'language')
  if (typeof value.getCredential !== 'function') {
    throw new TypeError('foundation authoring host credential getter is required')
  }
  if (typeof value.getRuntimeEnv !== 'function') {
    throw new TypeError('foundation authoring host runtime environment reader is required')
  }
  if (typeof value.execute !== 'function') {
    throw new TypeError('foundation authoring host must use the project conversation executor')
  }
  if (!value.billingClient ||
      typeof value.billingClient.recordUsage !== 'function' ||
      typeof value.billingClient.debitRealTimeUsage !== 'function') {
    throw new TypeError('foundation authoring host billing client is invalid')
  }
  const hasCommand = value.command !== undefined
  const hasCommandGetter = value.getCommand !== undefined
  if (hasCommand === hasCommandGetter) {
    throw new TypeError('foundation authoring host requires exactly one command source')
  }
  if (hasCommand && (!Array.isArray(value.command) || value.command.length === 0 ||
      value.command.some(part => typeof part !== 'string' || part.length === 0))) {
    throw new TypeError('foundation authoring host command is invalid')
  }
  if (hasCommandGetter && typeof value.getCommand !== 'function') {
    throw new TypeError('foundation authoring host command getter is invalid')
  }
}

function assertNonEmpty(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`foundation authoring host ${name} is invalid`)
  }
}
