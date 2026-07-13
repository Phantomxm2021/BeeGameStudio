import type { DeliveryEvidence } from './delivery-contract'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export type DeliveryValidationRequest = {
  workspacePath: string
  adapterId: string
  contractVersion: number
  playerPaths: Array<{
    id: string
    actions: Array<Record<string, unknown>>
    assertions: Array<Record<string, unknown>>
  }>
}

export type DeliveryValidationResult = {
  adapterId: string
  environment: Record<string, string | number | boolean>
  evidence: DeliveryEvidence[]
  metrics: Record<string, number>
  passed: boolean
  failures: Array<{ pathId: string; detail: string }>
}

export interface DeliveryValidationAdapter {
  readonly id: string
  validate(request: DeliveryValidationRequest): Promise<DeliveryValidationResult>
}

export class DeliveryValidationAdapterRegistry {
  private readonly adapters = new Map<string, DeliveryValidationAdapter>()

  register(adapter: DeliveryValidationAdapter): void {
    const id = adapter.id.trim()
    if (!id) throw new Error('Delivery validation adapter id is required')
    if (this.adapters.has(id)) throw new Error(`Delivery validation adapter is already registered: ${id}`)
    this.adapters.set(id, adapter)
  }

  require(id: string): DeliveryValidationAdapter {
    const adapter = this.adapters.get(id.trim())
    if (!adapter) throw new Error(`Delivery validation adapter is not configured: ${id}`)
    return adapter
  }

  list(): string[] {
    return [...this.adapters.keys()].sort((left, right) => left.localeCompare(right))
  }
}

export function readExplicitValidationAdapter(projectTarget: unknown): string | undefined {
  if (!projectTarget || typeof projectTarget !== 'object' || Array.isArray(projectTarget)) return undefined
  const value = (projectTarget as Record<string, unknown>).validation_adapter
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function resolveRequiredValidationAdapter(requiredCapabilities: string[]): string | undefined {
  const ids = requiredCapabilities
    .filter(capability => capability.startsWith('adapter:'))
    .map(capability => capability.slice('adapter:'.length).trim())
    .filter(Boolean)
  return ids.length === 1 ? ids[0] : undefined
}

export async function readDeliveryValidationRequest(
  workspacePath: string,
  adapterId: string,
): Promise<DeliveryValidationRequest> {
  const contractPath = resolve(workspacePath, 'docs', 'delivery-contract.json')
  const contract = JSON.parse(await readFile(contractPath, 'utf8')) as unknown
  if (!isRecord(contract) || contract.version !== 1 || !Array.isArray(contract.playerPaths)) {
    throw new Error('A valid delivery contract is required for runtime validation')
  }
  const playerPaths = contract.playerPaths.map((value, index) => {
    if (!isRecord(value) || typeof value.id !== 'string' || !isRecord(value.phases)) {
      throw new Error(`Player path ${index} is invalid`)
    }
    const actions: Array<Record<string, unknown>> = []
    const assertions: Array<Record<string, unknown>> = []
    for (const steps of Object.values(value.phases)) {
      if (!Array.isArray(steps)) continue
      for (const step of steps) {
        if (!isRecord(step) || !isRecord(step.action) || !Array.isArray(step.assertions)) continue
        actions.push(step.action)
        assertions.push(...step.assertions.filter(isRecord))
      }
    }
    return { id: value.id.trim(), actions, assertions }
  })
  return { workspacePath, adapterId, contractVersion: 1, playerPaths }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
