import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export const PROJECT_DELIVERY_CONTRACT_VERSION = 1 as const

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
