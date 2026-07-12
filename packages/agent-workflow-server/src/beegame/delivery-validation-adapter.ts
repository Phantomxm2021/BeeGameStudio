import type { DeliveryEvidence } from './delivery-contract'

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
