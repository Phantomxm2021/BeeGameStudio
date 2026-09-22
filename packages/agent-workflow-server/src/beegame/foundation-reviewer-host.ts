import type { BeeGameUsageBillingClient } from '@bee-game-studio/beegame-billing-core/usage-control-client'
import { realpath } from 'node:fs/promises'
import { createAuthenticationClient } from '../auth/public'
import type { BeeGameSessionCredential } from '../auth/session-routes'
import type { DashboardRepository } from '../dashboard-repository'
import { createUsageBillingClient } from '../billing/public'
import { createRuntimeConfigurationClient } from '../runtime-configuration/public'
import {
  createFoundationReviewer,
} from './stage-modules/foundation-reviewer/public'

type ReviewerOperations = ReturnType<typeof createFoundationReviewer>

/**
 * Inputs owned by the trusted application host. Reviewer receives no
 * credential, repository, billing authority, worker callback, or other
 * stage's port from this boundary.
 */
export type FoundationReviewerHostOptions = {
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
}

/** The only object exposed to app/controller code from this host assembly. */
export type FoundationReviewerHost = Pick<
  ReviewerOperations,
  'start' | 'resume' | 'stop' | 'getResult'
>

/**
 * Assemble the public Reviewer port lazily. Creating a host does not inspect
 * the native command, request a token, read runtime configuration, resolve
 * the workspace, or start a session. Those happen only when one of the four
 * returned operations runs.
 */
export function createFoundationReviewerHost(
  options: FoundationReviewerHostOptions,
): FoundationReviewerHost {
  assertHostOptions(options)

  // Snapshot host wiring after validation. The credential getter is the one
  // intentional exception: its result remains dynamic as transport sessions
  // refresh or rotate. A static command is copied now; a lazy command getter
  // is bound now and its returned command is copied during assembly.
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

  let stagePromise: Promise<ReviewerOperations> | undefined
  const getStage = (): Promise<ReviewerOperations> => {
    if (!stagePromise) {
      const assembly = Promise.resolve().then(async () => {
        const command = boundGetCommand
          ? [...boundGetCommand()]
          : [...(boundCommand ?? [])]

        // Keep all public adapters behind this lazy boundary. In particular,
        // authentication construction does not happen until an operation is
        // invoked, while the adapter still delegates the current credential.
        const authentication = createAuthenticationClient({
          ownerId: boundOwnerId,
          credential: {
            async getValidAccessToken(request) {
              const credential = boundGetCredential()
              return credential?.getValidAccessToken(request)
            },
          },
        })
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
        const workspacePath = await realpath(boundWorkspacePath)
        return createFoundationReviewer(
          { workspacePath, ...(boundLanguage ? { language: boundLanguage } : {}) },
          { runtimeConfiguration, billing },
        )
      })
      const retryableAssembly = assembly.catch(error => {
        if (stagePromise === retryableAssembly) stagePromise = undefined
        throw error
      })
      stagePromise = retryableAssembly
    }
    return stagePromise
  }

  const host: FoundationReviewerHost = {
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
])

function assertHostOptions(value: FoundationReviewerHostOptions): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('foundation reviewer host options are required')
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('foundation reviewer host options must be a plain object')
  }
  if (Object.keys(value).some(key => !HOST_OPTION_KEYS.has(key))) {
    throw new TypeError('foundation reviewer host options contain unexpected fields')
  }
  assertNonEmpty(value.ownerId, 'ownerId')
  assertNonEmpty(value.workspacePath, 'workspacePath')
  assertNonEmpty(value.dataDir, 'dataDir')
  if (value.modelConfigId !== undefined) assertNonEmpty(value.modelConfigId, 'modelConfigId')
  if (value.language !== undefined) assertNonEmpty(value.language, 'language')
  if (typeof value.getCredential !== 'function') {
    throw new TypeError('foundation reviewer host credential getter is required')
  }
  if (typeof value.getRuntimeEnv !== 'function') {
    throw new TypeError('foundation reviewer host runtime environment reader is required')
  }
  if (!value.billingClient ||
      typeof value.billingClient.recordUsage !== 'function' ||
      typeof value.billingClient.debitRealTimeUsage !== 'function') {
    throw new TypeError('foundation reviewer host billing client is invalid')
  }
  const hasCommand = value.command !== undefined
  const hasCommandGetter = value.getCommand !== undefined
  if (hasCommand === hasCommandGetter) {
    throw new TypeError('foundation reviewer host requires exactly one command source')
  }
  if (hasCommand && (!Array.isArray(value.command) || value.command.length === 0 ||
      value.command.some(part => typeof part !== 'string' || part.length === 0))) {
    throw new TypeError('foundation reviewer host command is invalid')
  }
  if (hasCommandGetter && typeof value.getCommand !== 'function') {
    throw new TypeError('foundation reviewer host command getter is invalid')
  }
}

function assertNonEmpty(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`foundation reviewer host ${name} is invalid`)
  }
}
