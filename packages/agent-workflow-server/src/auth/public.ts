import type { BeeGameSessionCredential } from './session-routes'

export type AuthenticationClient = Readonly<{
  protocolVersion: 1
  ownerId: string
  getAccessToken(input: { ownerId: string; forceRefresh?: boolean }): Promise<string | undefined>
}>

type AuthenticationClientInput = {
  ownerId: string
  credential: BeeGameSessionCredential
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateOwnerId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new Error('authentication ownerId is invalid')
  }
  return value
}

function validateFactoryInput(value: unknown): AuthenticationClientInput {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).sort().join(',') !== 'credential,ownerId') {
    throw new Error('authentication client configuration is invalid')
  }
  const ownerId = validateOwnerId(value.ownerId)
  const credential = value.credential
  if (!isRecord(credential) || typeof credential.getValidAccessToken !== 'function') {
    throw new Error('authentication credential is invalid')
  }
  return { ownerId, credential: credential as unknown as BeeGameSessionCredential }
}

function validateRequest(value: unknown): { ownerId: string; forceRefresh?: boolean } {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('authentication token request is invalid')
  }
  const keys = Object.keys(value)
  if (keys.some(key => key !== 'ownerId' && key !== 'forceRefresh') || !('ownerId' in value)) {
    throw new Error('authentication token request is invalid')
  }
  const ownerId = validateOwnerId(value.ownerId)
  if ('forceRefresh' in value && value.forceRefresh !== undefined && typeof value.forceRefresh !== 'boolean') {
    throw new Error('authentication token request is invalid')
  }
  const forceRefresh = value.forceRefresh
  return {
    ownerId,
    ...(forceRefresh === undefined ? {} : { forceRefresh: forceRefresh as boolean }),
  }
}

export function createAuthenticationClient(value: AuthenticationClientInput): AuthenticationClient {
  const { ownerId, credential } = validateFactoryInput(value)
  const client: AuthenticationClient = {
    protocolVersion: 1,
    ownerId,
    async getAccessToken(input) {
      const request = validateRequest(input)
      if (request.ownerId !== ownerId) throw new Error('authentication owner mismatch')
      let token: string | undefined
      try {
        token = await credential.getValidAccessToken(
          request.forceRefresh === undefined ? undefined : { forceRefresh: request.forceRefresh },
        )
      } catch {
        throw new Error('authentication token unavailable')
      }
      if (token !== undefined && (typeof token !== 'string' || token.length === 0)) {
        throw new Error('authentication credential returned an invalid token')
      }
      return token
    },
  }
  return Object.freeze(client)
}
