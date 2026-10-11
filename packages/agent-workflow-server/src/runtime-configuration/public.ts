import type { RuntimeModelConfig } from '@bee-game-studio/agent-workflow'
import { normalizeRuntimeEnvironment } from '../../../../src/utils/runtimeEnvironment'
import { isEnvTruthy } from '../../../../src/utils/envUtils'
import { randomUUID } from 'node:crypto'
import { safeErrorFacts } from '../security/safe-error-facts'
import type { DashboardRepository } from '../dashboard-repository'
import type { AuthenticationClient } from '../auth/public'
import { isSupabaseRuntimeEnvAuthError } from '../supabase-runtime-env-client'

/** Version of the intentionally small runtime-configuration protocol. */
export const RUNTIME_CONFIGURATION_PROTOCOL_VERSION = 1 as const

export type RuntimeConfigurationResolution = {
  command: string[]
  env: Record<string, string>
}

export type RuntimeConfigurationClient = Readonly<{
  readonly protocolVersion: typeof RUNTIME_CONFIGURATION_PROTOCOL_VERSION
  readonly ownerId: string
  resolve(input: { ownerId: string }): Promise<RuntimeConfigurationResolution>
}>

export type RuntimeConfigurationClientFactoryOptions = {
  ownerId: string
  dataDir: string
  modelConfigId?: string
  authentication: AuthenticationClient
  repository: Pick<DashboardRepository, 'getRuntimeEnv'>
  /** Base native executable command. Runtime protocol flags are caller-owned. */
  command: readonly string[]
  /** Optional explicit provider configuration, retained as a type-only input. */
  runtime?: RuntimeModelConfig
}

/**
 * Bind one owner to runtime configuration resolution.
 *
 * The repository remains the configuration authority. This adapter only
 * obtains an owner-bound token, performs the one permitted auth refresh, and
 * combines the returned environment with the caller's explicit runtime.
 */
export function createRuntimeConfigurationClient(
  options: RuntimeConfigurationClientFactoryOptions,
): RuntimeConfigurationClient {
  assertFactoryOptions(options)
  const {
    ownerId,
    dataDir,
    modelConfigId,
    authentication,
    repository,
    command,
    runtime,
  } = options
  const boundCommand = [...command]
  const boundRuntime = runtime === undefined
    ? undefined
    : { modelType: runtime.modelType, env: { ...runtime.env } }

  const client: RuntimeConfigurationClient = {
    protocolVersion: RUNTIME_CONFIGURATION_PROTOCOL_VERSION,
    ownerId,
    async resolve(input) {
      assertResolveInput(input)
      assertNonEmpty(input.ownerId, 'ownerId')
      if (input.ownerId !== ownerId) {
        throw new Error('runtime configuration ownerId does not match the bound owner')
      }

      const traceId = randomUUID()
      const startedAt = Date.now()
      let step = 'authentication'
      let failureFacts: ReturnType<typeof safeErrorFacts> = {}
      let repositoryUnauthorized = false
      try {
        const token = await getRequiredToken(authentication, ownerId)
        let additionalEnv: Record<string, string>
        step = 'runtime_environment'
        try {
          additionalEnv = await repository.getRuntimeEnv(
            dataDir,
            ownerId,
            token,
            modelConfigId,
          )
        } catch (error) {
          failureFacts = safeErrorFacts(error)
          repositoryUnauthorized = isRuntimeAuthError(error)
          if (!repositoryUnauthorized) {
            throw new Error('runtime configuration repository unavailable')
          }
          console.warn('[BeeGame runtime configuration]', JSON.stringify({
            timestamp: new Date().toISOString(), traceId, step,
            code: 'authorization_refresh_requested', ...failureFacts,
          }))
          step = 'authentication_refresh'
          failureFacts = {}
          const refreshedToken = await getRequiredToken(authentication, ownerId, true)
          // Keep the existing single auth refresh; logging adds no retries.
          try {
            step = 'runtime_environment_retry'
            additionalEnv = await repository.getRuntimeEnv(
              dataDir,
              ownerId,
              refreshedToken,
              modelConfigId,
            )
          } catch (retryError) {
            failureFacts = safeErrorFacts(retryError)
            repositoryUnauthorized = isRuntimeAuthError(retryError)
            if (repositoryUnauthorized) {
              throw new Error('runtime configuration authorization failed')
            }
            throw new Error('runtime configuration repository unavailable')
          }
        }

        step = 'environment_validation'
        failureFacts = {}
        assertRuntimeEnvironment(additionalEnv)
        return {
          command: [...boundCommand],
          env: mergeRuntimeEnvironment(boundRuntime, additionalEnv),
        }
      } catch (error) {
        const code = step === 'authentication' || step === 'authentication_refresh'
          ? (error instanceof Error && error.message === 'runtime configuration authentication token unavailable'
              ? 'token_unavailable' : 'authentication_unavailable')
          : step === 'environment_validation' ? 'invalid_environment'
          : repositoryUnauthorized
            ? 'authorization_failed' : 'repository_unavailable'
        const diagnostic = {
          traceId, timestamp: new Date().toISOString(), step, code,
          elapsedMs: Math.max(0, Date.now() - startedAt), ...failureFacts,
        }
        console.error('[BeeGame runtime configuration]', JSON.stringify(diagnostic))
        // Only safe fields cross the stage boundary; never attach a raw cause.
        throw Object.assign(new Error(error instanceof Error ? error.message : 'runtime configuration unavailable'), { diagnostic })
      }
    },
  }
  return Object.freeze(client)
}

async function getRequiredToken(
  authentication: AuthenticationClient,
  ownerId: string,
  forceRefresh = false,
): Promise<string> {
  let token: string | undefined
  try {
    token = await authentication.getAccessToken({
      ownerId,
      ...(forceRefresh ? { forceRefresh: true } : {}),
    })
  } catch {
    throw new Error('runtime configuration authentication unavailable')
  }
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('runtime configuration authentication token unavailable')
  }
  return token
}

function mergeRuntimeEnvironment(
  runtime: RuntimeModelConfig | undefined,
  additionalEnv: Record<string, string>,
): Record<string, string> {
  const selectedEnvironment = {
    ...normalizeRuntimeEnvironment(additionalEnv),
    ...normalizeRuntimeEnvironment(runtime?.env ?? {}),
  }
  const modelType = runtime?.modelType ?? inferSelectedRuntimeModelType(selectedEnvironment)
  return {
    ...selectedEnvironment,
    ...(modelType ? { BEEGAME_MODEL_TYPE: modelType } : {}),
  }
}

function inferSelectedRuntimeModelType(
  environment: Record<string, string>,
): RuntimeModelConfig['modelType'] | undefined {
  const candidates = new Set<RuntimeModelConfig['modelType']>()
  if (
    environment.ANTHROPIC_BASE_URL ||
    environment.ANTHROPIC_AUTH_TOKEN ||
    environment.BGS_DEFAULT_BALANCED_MODEL
  ) {
    candidates.add('anthropic')
  }
  if (
    environment.OPENAI_BASE_URL ||
    environment.OPENAI_API_KEY ||
    isEnvTruthy(environment.BGS_USE_OPENAI)
  ) {
    candidates.add('openai')
  }
  if (
    environment.GEMINI_BASE_URL ||
    environment.GEMINI_API_KEY ||
    isEnvTruthy(environment.BGS_USE_GEMINI)
  ) {
    candidates.add('gemini')
  }
  if (
    environment.GROK_BASE_URL ||
    environment.GROK_API_KEY ||
    isEnvTruthy(environment.BGS_USE_GROK)
  ) {
    candidates.add('grok')
  }
  if (candidates.size > 1) {
    throw new Error('Selected model environment contains multiple providers')
  }
  return candidates.values().next().value
}

const FACTORY_OPTION_KEYS = new Set([
  'ownerId',
  'dataDir',
  'modelConfigId',
  'authentication',
  'repository',
  'command',
  'runtime',
])

function isRuntimeAuthError(error: unknown): boolean {
  return isSupabaseRuntimeEnvAuthError(error)
}

function assertFactoryOptions(value: RuntimeConfigurationClientFactoryOptions): void {
  if (!value || typeof value !== 'object') throw new TypeError('runtime configuration options are required')
  if (Object.keys(value).some(key => !FACTORY_OPTION_KEYS.has(key))) {
    throw new TypeError('runtime configuration options contain unexpected fields')
  }
  assertNonEmpty(value.ownerId, 'ownerId')
  assertNonEmpty(value.dataDir, 'dataDir')
  if (value.modelConfigId !== undefined) assertNonEmpty(value.modelConfigId, 'modelConfigId')
  if (!value.authentication || value.authentication.protocolVersion !== 1 ||
      value.authentication.ownerId !== value.ownerId ||
      typeof value.authentication.getAccessToken !== 'function') {
    throw new TypeError('runtime configuration authentication is invalid')
  }
  if (!value.repository || typeof value.repository.getRuntimeEnv !== 'function') {
    throw new TypeError('runtime configuration repository is invalid')
  }
  if (!Array.isArray(value.command) || value.command.length === 0 ||
      value.command.some(part => typeof part !== 'string' || part.length === 0)) {
    throw new TypeError('runtime configuration command is invalid')
  }
  if (value.runtime !== undefined) assertRuntimeModelConfig(value.runtime)
}

function assertResolveInput(value: unknown): asserts value is { ownerId: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof (value as { ownerId?: unknown }).ownerId !== 'string') {
    throw new TypeError('runtime configuration resolve input is invalid')
  }
  const keys = Object.keys(value)
  if (keys.some(key => key !== 'ownerId')) {
    throw new TypeError('runtime configuration resolve input is invalid')
  }
}

function assertRuntimeEnvironment(value: unknown): asserts value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('runtime configuration environment is invalid')
  }
  for (const [key, item] of Object.entries(value)) {
    if (typeof key !== 'string' || typeof item !== 'string') {
      throw new TypeError('runtime configuration environment is invalid')
    }
  }
}

function assertRuntimeModelConfig(value: RuntimeModelConfig): void {
  if (!value || typeof value !== 'object' ||
      !['anthropic', 'openai', 'gemini', 'grok'].includes(value.modelType) ||
      !value.env || typeof value.env !== 'object' || Array.isArray(value.env)) {
    throw new TypeError('runtime configuration runtime is invalid')
  }
  assertRuntimeEnvironment(value.env)
}

function assertNonEmpty(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`runtime configuration ${name} is invalid`)
  }
}
