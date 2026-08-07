import { randomUUID } from 'node:crypto'
import { link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod/v4'
import lockfile from 'proper-lockfile'
import {
  parseRequirementMatchResponse,
  type ResourceRequirementMatchResponse,
} from './resource-selection-client'
import { canonicalResourceInventoryRevision } from './resource-inventory-revision'

export type DurableResourceInventoryTransaction = {
  version: 2
  transactionId: string
  planRevision: string
  policyRevision: string
  createdAt: string
}

export type DurableResourceMatchObservation = {
  version: 2
  transactionId: string
  planRevision: string
  policyRevision: string
  observedAt: string
  result: ResourceRequirementMatchResponse
}

export const RESOURCE_MATCH_POLICY_REVISION = canonicalResourceInventoryRevision({
  version: 2,
  catalogEligibility: 'selection-ready-published-pack',
  workflowOutcomes: ['matched', 'no-match'],
})

const nonEmptyString = z.string().trim().min(1)
const transactionSchema = z.object({
  version: z.literal(2),
  transactionId: nonEmptyString,
  planRevision: nonEmptyString,
  policyRevision: nonEmptyString,
  createdAt: nonEmptyString,
}).strict()
const observationSchema = z.object({
  version: z.literal(2),
  transactionId: nonEmptyString,
  planRevision: nonEmptyString,
  policyRevision: nonEmptyString,
  observedAt: nonEmptyString,
  result: z.unknown(),
}).strict()
const inFlightTransactions = new Map<string, Promise<DurableResourceInventoryTransaction>>()
const inFlightObservations = new Map<string, Promise<DurableResourceMatchObservation>>()

export async function getOrCreateResourceInventoryTransaction(options: {
  workspacePath: string
  planRevision: string
}): Promise<DurableResourceInventoryTransaction> {
  const path = currentTransactionPath(options.workspacePath, options.planRevision)
  const inFlight = inFlightTransactions.get(path)
  if (inFlight) return inFlight
  const creation = withTransactionLock(path, () =>
    refreshResourceInventoryTransaction(options, path))
  inFlightTransactions.set(path, creation)
  try {
    return await creation
  } finally {
    if (inFlightTransactions.get(path) === creation)
      inFlightTransactions.delete(path)
  }
}

async function withTransactionLock<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  await mkdir(dirname(path), { recursive: true })
  const release = await lockfile.lock(path, {
    realpath: false,
    stale: 30_000,
    update: 10_000,
    retries: {
      retries: 0,
      forever: true,
      factor: 1,
      minTimeout: 5,
      maxTimeout: 25,
    },
  })
  try {
    return await operation()
  } finally {
    await release()
  }
}

async function refreshResourceInventoryTransaction(
  options: { workspacePath: string; planRevision: string },
  path: string,
): Promise<DurableResourceInventoryTransaction> {
  const existing = await readTransactionCandidate(path)
  if (
    existing?.transaction &&
    existing.transaction.planRevision === options.planRevision &&
    existing.transaction.policyRevision === RESOURCE_MATCH_POLICY_REVISION
  ) return existing.transaction
  if (existing?.transactionId && await hasPreparedInventoryReceipt(
    options.workspacePath,
    existing.transactionId,
  )) {
    if (existing.planRevision !== options.planRevision)
      throw new Error('Prepared resource inventory receipt belongs to a different plan revision')
    const promoted: DurableResourceInventoryTransaction = {
      version: 2,
      transactionId: existing.transactionId,
      planRevision: options.planRevision,
      policyRevision: RESOURCE_MATCH_POLICY_REVISION,
      createdAt: existing.createdAt,
    }
    await promoteObservationPolicy(options.workspacePath, promoted)
    await replaceDurableJson(path, promoted)
    return promoted
  }
  if (existing?.transactionId) {
    await rm(observationPath(options.workspacePath, existing.transactionId), { force: true })
  }
  if (existing) await rm(path, { force: true })
  const transaction: DurableResourceInventoryTransaction = {
    version: 2,
    transactionId: randomUUID(),
    planRevision: options.planRevision,
    policyRevision: RESOURCE_MATCH_POLICY_REVISION,
    createdAt: new Date().toISOString(),
  }
  await writeDurableJsonOnce(path, transaction)
  return (await readTransaction(path)) ?? transaction
}

export async function requireCurrentResourceInventoryTransaction(options: {
  workspacePath: string
  planRevision: string
}): Promise<DurableResourceInventoryTransaction> {
  const transaction = await readTransaction(
    currentTransactionPath(options.workspacePath, options.planRevision),
  )
  if (!transaction)
    throw new Error('Resource inventory commit requires the current bounded-match transaction')
  return transaction
}

export async function completeResourceInventoryTransaction(options: {
  workspacePath: string
  planRevision: string
  transactionId: string
}): Promise<void> {
  const path = currentTransactionPath(options.workspacePath, options.planRevision)
  const transaction = await readTransaction(path)
  if (!transaction) return
  if (transaction.transactionId !== options.transactionId)
    throw new Error('A different resource inventory transaction is currently active')
  await rm(path, { force: true })
}

export async function getOrCreateResourceMatchObservation(options: {
  workspacePath: string
  transactionId: string
  planRevision: string
  match(): Promise<ResourceRequirementMatchResponse>
}): Promise<DurableResourceMatchObservation> {
  const path = observationPath(options.workspacePath, options.transactionId)
  const existing = await readResourceMatchObservation(
    options.workspacePath,
    options.transactionId,
  )
  if (existing) {
    assertObservationIdentity(existing, options.transactionId, options.planRevision)
    return existing
  }
  const inFlight = inFlightObservations.get(path)
  if (inFlight) return inFlight
  const creation = createResourceMatchObservation(options, path)
  inFlightObservations.set(path, creation)
  try {
    return await creation
  } finally {
    if (inFlightObservations.get(path) === creation)
      inFlightObservations.delete(path)
  }
}

async function createResourceMatchObservation(
  options: {
    workspacePath: string
    transactionId: string
    planRevision: string
    match(): Promise<ResourceRequirementMatchResponse>
  },
  path: string,
): Promise<DurableResourceMatchObservation> {
  const observation: DurableResourceMatchObservation = {
    version: 2,
    transactionId: options.transactionId,
    planRevision: options.planRevision,
    policyRevision: RESOURCE_MATCH_POLICY_REVISION,
    observedAt: new Date().toISOString(),
    result: parseRequirementMatchResponse(await options.match()),
  }
  await writeDurableJsonOnce(
    path,
    observation,
  )
  return (await readResourceMatchObservation(
    options.workspacePath,
    options.transactionId,
  )) ?? observation
}

export async function requireResourceMatchObservation(options: {
  workspacePath: string
  transactionId: string
  planRevision: string
}): Promise<DurableResourceMatchObservation> {
  const observation = await readResourceMatchObservation(
    options.workspacePath,
    options.transactionId,
  )
  if (!observation)
    throw new Error('Resource inventory commit requires the current transaction bounded match observation')
  assertObservationIdentity(observation, options.transactionId, options.planRevision)
  return observation
}

async function readTransaction(
  path: string,
): Promise<DurableResourceInventoryTransaction | undefined> {
  const candidate = await readTransactionCandidate(path)
  if (!candidate) return undefined
  if (!candidate.transaction)
    throw new Error('Resource inventory transaction uses a stale matching policy')
  return candidate.transaction
}

type TransactionCandidate = {
  transaction?: DurableResourceInventoryTransaction
  transactionId?: string
  planRevision?: string
  createdAt: string
}

async function readTransactionCandidate(
  path: string,
): Promise<TransactionCandidate | undefined> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as unknown
    const parsed = transactionSchema.safeParse(raw)
    if (parsed.success) return {
      transaction: parsed.data,
      transactionId: parsed.data.transactionId,
      planRevision: parsed.data.planRevision,
      createdAt: parsed.data.createdAt,
    }
    if (
      isStaleTransactionEnvelope(raw) &&
      typeof raw.transactionId === 'string' && raw.transactionId.trim() &&
      typeof raw.planRevision === 'string' && raw.planRevision.trim() &&
      typeof raw.createdAt === 'string' && raw.createdAt.trim()
    ) return {
      transactionId: raw.transactionId,
      planRevision: raw.planRevision,
      createdAt: raw.createdAt,
    }
    throw parsed.error
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error(
      `Resource inventory transaction is invalid: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function readResourceMatchObservation(
  workspacePath: string,
  transactionId: string,
): Promise<DurableResourceMatchObservation | undefined> {
  try {
    const envelope = observationSchema.parse(JSON.parse(
      await readFile(observationPath(workspacePath, transactionId), 'utf8'),
    ))
    return { ...envelope, result: parseRequirementMatchResponse(envelope.result) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error(
      `Resource match observation is invalid: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function assertObservationIdentity(
  observation: DurableResourceMatchObservation,
  transactionId: string,
  planRevision: string,
): void {
  if (
    observation.transactionId !== transactionId ||
    observation.planRevision !== planRevision ||
    observation.policyRevision !== RESOURCE_MATCH_POLICY_REVISION
  )
    throw new Error('Resource match observation does not belong to the active plan transaction')
}

async function hasPreparedInventoryReceipt(
  workspacePath: string,
  transactionId: string,
): Promise<boolean> {
  try {
    const value = JSON.parse(await readFile(join(
      workspacePath,
      '.beegame/workflow/resource-inventory-commits',
      `${canonicalResourceInventoryRevision(transactionId)}.json`,
    ), 'utf8')) as unknown
    return isRecord(value) &&
      value.transactionId === transactionId &&
      ['prepared', 'applying', 'committed'].includes(String(value.state))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function promoteObservationPolicy(
  workspacePath: string,
  transaction: DurableResourceInventoryTransaction,
): Promise<void> {
  const path = observationPath(workspacePath, transaction.transactionId)
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error('Prepared resource inventory receipt has no bounded match observation')
    throw error
  }
  if (!isRecord(raw) || raw.transactionId !== transaction.transactionId ||
    raw.planRevision !== transaction.planRevision || typeof raw.observedAt !== 'string')
    throw new Error('Prepared resource inventory match observation identity is invalid')
  const observation: DurableResourceMatchObservation = {
    version: 2,
    transactionId: transaction.transactionId,
    planRevision: transaction.planRevision,
    policyRevision: RESOURCE_MATCH_POLICY_REVISION,
    observedAt: raw.observedAt,
    result: parseRequirementMatchResponse(raw.result),
  }
  await replaceDurableJson(path, observation)
}

function currentTransactionPath(workspacePath: string, planRevision: string): string {
  return join(
    workspacePath,
    '.beegame/workflow/resource-inventory-current',
    `${canonicalResourceInventoryRevision(planRevision)}.json`,
  )
}

function observationPath(workspacePath: string, transactionId: string): string {
  return join(
    workspacePath,
    '.beegame/workflow/resource-match-observations',
    `${canonicalResourceInventoryRevision(transactionId)}.json`,
  )
}

async function writeDurableJsonOnce(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`)
  try {
    await link(temporary, path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  } finally {
    await rm(temporary, { force: true })
  }
}

async function replaceDurableJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`)
  try {
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isStaleTransactionEnvelope(
  value: unknown,
): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const keys = Object.keys(value).sort()
  const staleKeys = ['createdAt', 'planRevision', 'transactionId', 'version']
  return (value.version === 1 || value.version === 2) &&
    keys.length === staleKeys.length &&
    keys.every((key, index) => key === staleKeys[index])
}
