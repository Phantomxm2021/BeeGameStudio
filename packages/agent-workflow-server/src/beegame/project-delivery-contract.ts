import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export const PROJECT_DELIVERY_CONTRACT_VERSION = 1 as const

export const PROJECT_DELIVERY_CONTRACT_PLAYER_PATH_PHASES = [
  'entry',
  'core_action',
  'state_change',
  'completion',
  'recovery',
] as const

const NON_EMPTY_OBJECT_SCHEMA = {
  type: 'object',
  minProperties: 1,
} as const

const PLAYER_PATH_STEP_SCHEMA = {
  type: 'object',
  required: ['action', 'assertions'],
  properties: {
    action: NON_EMPTY_OBJECT_SCHEMA,
    assertions: {
      type: 'array',
      minItems: 1,
      items: NON_EMPTY_OBJECT_SCHEMA,
    },
  },
} as const

/** The single, platform-neutral, server-owned description of the authorable contract shape. */
export const PROJECT_DELIVERY_CONTRACT_FORMAT = {
  type: 'object',
  required: ['version', 'requirements', 'playerPaths', 'requiredCapabilities'],
  properties: {
    version: { const: PROJECT_DELIVERY_CONTRACT_VERSION },
    requirements: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'title', 'scope', 'sourceRefs', 'evidenceRequired'],
        properties: {
          id: { type: 'string', minLength: 1 },
          title: { type: 'string', minLength: 1 },
          scope: { enum: ['mvp', 'roadmap'] },
          sourceRefs: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['path', 'locator'],
              properties: {
                path: { type: 'string', minLength: 1 },
                locator: { type: 'string', minLength: 1 },
              },
            },
          },
          evidenceRequired: {
            type: 'array',
            minItems: 1,
            items: { enum: ['implementation', 'build', 'test', 'runtime', 'asset', 'skill', 'document'] },
          },
        },
      },
    },
    playerPaths: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'requirementIds', 'phases'],
        properties: {
          id: { type: 'string', minLength: 1 },
          requirementIds: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', minLength: 1 },
          },
          phases: {
            type: 'object',
            required: PROJECT_DELIVERY_CONTRACT_PLAYER_PATH_PHASES,
            properties: Object.fromEntries(PROJECT_DELIVERY_CONTRACT_PLAYER_PATH_PHASES.map(phase => [
              phase,
              { type: 'array', minItems: 1, items: PLAYER_PATH_STEP_SCHEMA },
            ])),
          },
        },
      },
    },
    requiredCapabilities: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
    },
  },
} as const

export function formatProjectDeliveryContract(): string {
  return JSON.stringify(PROJECT_DELIVERY_CONTRACT_FORMAT)
}

export type ProjectDeliveryContractSkeleton = {
  version: typeof PROJECT_DELIVERY_CONTRACT_VERSION
  requirements: unknown[]
  playerPaths: unknown[]
  requiredCapabilities: string[]
}

export async function ensureProjectDeliveryContractSkeleton(workspacePath: string): Promise<string> {
  const path = resolve(workspacePath, 'docs', 'delivery-contract.json')
  if (existsSync(path)) return path

  const skeleton: ProjectDeliveryContractSkeleton = {
    version: PROJECT_DELIVERY_CONTRACT_VERSION,
    requirements: [],
    playerPaths: [],
    requiredCapabilities: [],
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(skeleton, null, 2)}\n`, { flag: 'wx' }).catch(error => {
    if (!isAlreadyExistsError(error)) throw error
  })
  return path
}

function isAlreadyExistsError(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'
}
