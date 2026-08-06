import { randomUUID } from 'node:crypto'
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod/v4'
import {
  parseRequirementMatchResponse,
  type ResourceRequirementMatchResponse,
} from './resource-selection-client'
import { canonicalResourceInventoryRevision } from './resource-inventory-revision'

export type DurableResourceInventoryTransaction = {
  version: 1
  transactionId: string
  planRevision: string
  createdAt: string
}

export type DurableResourceMatchObservation = {
  version: 1
  transactionId: string
  planRevision: string
  observedAt: string
  result: ResourceRequirementMatchResponse
}

const nonEmptyString = z.string().trim().min(1)
const transactionSchema = z.object({
  version: z.literal(1),
  transactionId: nonEmptyString,
  planRevision: nonEmptyString,
  createdAt: nonEmptyString,
}).strict()
const observationSchema = z.object({
  version: z.literal(1),
  transactionId: nonEmptyString,
  planRevision: nonEmptyString,
  observedAt: nonEmptyString,
  result: z.unknown(),
}).strict()
const inFlightObservations = new Map<string, Promise<DurableResourceMatchObservation>>()

export async function getOrCreateResourceInventoryTransaction(options: {
  workspacePath: string
  planRevision: string
}): Promise<DurableResourceInventoryTransaction> {
  const path = currentTransactionPath(options.workspacePath, options.planRevision)
  const existing = await readTransaction(path)
  if (existing) return existing
  const transaction: DurableResourceInventoryTransaction = {
    version: 1,
    transactionId: randomUUID(),
    planRevision: options.planRevision,
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
    version: 1,
    transactionId: options.transactionId,
    planRevision: options.planRevision,
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
  try {
    return transactionSchema.parse(JSON.parse(await readFile(path, 'utf8')))
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
    observation.planRevision !== planRevision
  )
    throw new Error('Resource match observation does not belong to the active plan transaction')
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
