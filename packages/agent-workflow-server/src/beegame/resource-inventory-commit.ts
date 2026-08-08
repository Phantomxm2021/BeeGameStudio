import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ResourceDeliveryCapability } from '@bee-game-studio/beegame-resource-core'
import { z } from 'zod/v4'
import {
  publishBeeGameResourceInventoryFromStaging,
  readBeeGameAssetManifest,
  writeBeeGameAssetManifest,
  type BeeGameProjectResource,
} from './asset-contracts'
import {
  ProjectResourceApplication,
  type ProjectResourceSelectionClient,
} from './project-resource-application'
import {
  authorProvisionalResources,
  type ProvisionalResourceAdapter,
  validateProvisionalResources,
} from './provisional-resource-adapters'
import { convertResourceDelivery } from './resource-delivery-adapters'
import { auditAssetContract } from './asset-contract-audit'
import {
  completeResourceInventoryTransaction,
  requireCurrentResourceInventoryTransaction,
  requireResourceMatchObservation,
} from './resource-match-observation'
import {
  canonicalResourceInventoryRevision,
  resourceInventoryPlanRevision,
} from './resource-inventory-revision'

export type ResourceInventoryDecision =
  | {
      requirementId: string
      kind: 'library'
      resourceId: string
      packId: string
      expectedPackVersion: string
      elementId: string
      destinationPath: string
      selectionReason: string[]
    }
  | {
      requirementId: string
      kind: 'placeholder'
      resourceId: string
      destinationPath: string
      format: string
      reason: string
      selectionReason: string[]
      assetKind: string
      parameters?: Record<string, unknown>
    }

export type ResourceInventoryCommitInput = {
  decisions: readonly ResourceInventoryDecision[]
}

export type DurableResourceInventoryReceipt = {
  version: 1
  state: 'prepared' | 'applying' | 'committed'
  transactionId: string
  dispatchId: string
  planRevision: string
  catalogRevision: string
  decisions: ResourceInventoryDecision[]
  deliveryByResource: Record<string, ResourceDeliveryCapability>
  stagedResourceIds: string[]
  outputHashesByResource: Record<string, Record<string, string>>
  bindings: Array<{ requirementId: string; resourceIds: string[] }>
  preparedAt: string
  committedAt?: string
}

const nonEmptyString = z.string().trim().min(1)
const resourceInventoryDecisionSchema = z.discriminatedUnion('kind', [
  z.object({
    requirementId: nonEmptyString,
    kind: z.literal('library'),
    resourceId: nonEmptyString,
    packId: nonEmptyString,
    expectedPackVersion: nonEmptyString,
    elementId: nonEmptyString,
    destinationPath: nonEmptyString,
    selectionReason: z.array(nonEmptyString).min(1),
  }).strict(),
  z.object({
    requirementId: nonEmptyString,
    kind: z.literal('placeholder'),
    resourceId: nonEmptyString,
    destinationPath: nonEmptyString,
    format: nonEmptyString,
    reason: nonEmptyString,
    selectionReason: z.array(nonEmptyString).min(1),
    assetKind: nonEmptyString,
    parameters: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
])
const resourceDeliveryCapabilitySchema = z.object({
  sourceFormat: nonEmptyString,
  disposition: z.enum(['direct', 'convert']),
  targetFormat: nonEmptyString,
  adapterId: nonEmptyString.optional(),
}).strict()
const durableResourceInventoryReceiptSchema = z.object({
  version: z.literal(1),
  state: z.enum(['prepared', 'applying', 'committed']),
  transactionId: nonEmptyString,
  dispatchId: nonEmptyString,
  planRevision: nonEmptyString,
  catalogRevision: nonEmptyString,
  decisions: z.array(resourceInventoryDecisionSchema).min(1),
  deliveryByResource: z.record(z.string(), resourceDeliveryCapabilitySchema),
  stagedResourceIds: z.array(nonEmptyString),
  outputHashesByResource: z.record(z.string(), z.record(z.string(), nonEmptyString)),
  bindings: z.array(z.object({
    requirementId: nonEmptyString,
    resourceIds: z.array(nonEmptyString).min(1),
  }).strict()).min(1),
  preparedAt: nonEmptyString,
  committedAt: nonEmptyString.optional(),
}).strict().superRefine((receipt, context) => {
  const requirementIds = receipt.decisions.map(decision => decision.requirementId)
  const decisionResourceIds = new Set(receipt.decisions.map(decision => decision.resourceId))
  const staged = new Set(receipt.stagedResourceIds)
  const bindingIds = receipt.bindings.map(binding => binding.requirementId)
  const uniqueRequirementIds = new Set(requirementIds)
  if (staged.size !== receipt.stagedResourceIds.length || [...staged].some(id => !decisionResourceIds.has(id)))
    context.addIssue({ code: 'custom', path: ['stagedResourceIds'], message: 'staged resource IDs must be unique decision resource IDs' })
  if ([...staged].some(id => !receipt.outputHashesByResource[id]))
    context.addIssue({ code: 'custom', path: ['outputHashesByResource'], message: 'every staged resource requires frozen output hashes' })
  if (new Set(bindingIds).size !== bindingIds.length || bindingIds.length !== uniqueRequirementIds.size || bindingIds.some(id => !uniqueRequirementIds.has(id)))
    context.addIssue({ code: 'custom', path: ['bindings'], message: 'bindings must exactly cover decision requirement IDs' })
  for (const binding of receipt.bindings) {
    const expected = new Set(
      receipt.decisions
        .filter(decision => decision.requirementId === binding.requirementId)
        .map(decision => decision.resourceId),
    )
    const actual = new Set(binding.resourceIds)
    if (
      actual.size !== binding.resourceIds.length ||
      actual.size !== expected.size ||
      [...actual].some(resourceId => !expected.has(resourceId))
    )
      context.addIssue({ code: 'custom', path: ['bindings'], message: 'binding resources must exactly match their decision group' })
  }
  if (receipt.state === 'committed' && !receipt.committedAt)
    context.addIssue({ code: 'custom', path: ['committedAt'], message: 'committed receipt requires committedAt' })
})

export async function commitResourceInventory(options: {
  workspacePath: string
  dispatchId: string
  client: ProjectResourceSelectionClient
  provisionalAdapters: readonly ProvisionalResourceAdapter[]
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  input: ResourceInventoryCommitInput
  assertMutationAuthority(): Promise<void>
}): Promise<DurableResourceInventoryReceipt & { receiptPath: string }> {
  const manifest = await readBeeGameAssetManifest(options.workspacePath)
  const planRevision = resourceInventoryPlanRevision(manifest)
  const transaction = await requireCurrentResourceInventoryTransaction({
    workspacePath: options.workspacePath,
    planRevision,
  })
  const observation = await requireResourceMatchObservation({
    workspacePath: options.workspacePath,
    transactionId: transaction.transactionId,
    planRevision,
  })
  const receiptPath = join(
    options.workspacePath,
    '.beegame/workflow/resource-inventory-commits',
    `${canonicalResourceInventoryRevision(transaction.transactionId)}.json`,
  )
  let receipt = await readReceipt(receiptPath)
  let decisions: ResourceInventoryDecision[]
  if (receipt) {
    if (
      receipt.transactionId !== transaction.transactionId ||
      receipt.planRevision !== planRevision ||
      receipt.catalogRevision !== observation.result.catalogRevision
    ) {
      throw new Error('Resource inventory commit receipt does not match the current frozen transaction')
    }
    decisions = receipt.decisions
    await options.assertMutationAuthority()
    if (receipt.dispatchId !== options.dispatchId) {
      receipt.dispatchId = options.dispatchId
      await writeReceipt(receiptPath, receipt)
    }
    if (receipt.state !== 'committed') {
      const previousDecisions = receipt.decisions
      const canonicalDecisions = canonicalizeExistingProvisionalPaths(
        previousDecisions,
        manifest.resources,
      )
      if (canonicalDecisions.some((decision, index) =>
        decision.kind === 'placeholder' &&
        decision.destinationPath !== previousDecisions[index]?.destinationPath,
      )) {
        receipt.decisions = canonicalDecisions
        receipt.bindings = buildBindings(canonicalDecisions)
        receipt.stagedResourceIds = []
        receipt.outputHashesByResource = {}
        receipt.state = 'prepared'
        await rm(`${receiptPath.slice(0, -'.json'.length)}.staging`, {
          recursive: true,
          force: true,
        })
        await writeReceipt(receiptPath, receipt)
      }
    }
    if (receipt.state === 'committed') {
      await finalizeCommittedTransaction(options.workspacePath, transaction.transactionId, planRevision, receipt, receiptPath)
      return { ...receipt, receiptPath }
    }
  } else {
    const proposedDecisions = validateDecisionCoverage(
      manifest.requirements.filter(item => item.required !== false).map(item => item.id),
      canonicalizeExistingProvisionalPaths(options.input.decisions, manifest.resources),
    )
    const previousReceipt = await readCurrentCommittedResourceInventoryReceipt(
      options.workspacePath,
    )
    decisions = preserveProvisionalResourceIds(
      proposedDecisions,
      previousReceipt?.decisions ?? [],
    )
    const deliveryByResource: Record<string, ResourceDeliveryCapability> = {}
    const decisionsByRequirement = new Map<string, ResourceInventoryDecision[]>()
    for (const decision of decisions) {
      const group = decisionsByRequirement.get(decision.requirementId) ?? []
      group.push(decision)
      decisionsByRequirement.set(decision.requirementId, group)
    }
    for (const [requirementId, requirementDecisions] of decisionsByRequirement) {
      const group = observation.result.groups.find(item => item.requirementId === requirementId)
      if (!group) throw new Error(`Resource match group is missing: ${requirementId}`)
      const placeholders = requirementDecisions.filter((decision): decision is Extract<ResourceInventoryDecision, { kind: 'placeholder' }> => decision.kind === 'placeholder')
      if (placeholders.length) {
        if (group.status !== 'no-match' || placeholders.length !== requirementDecisions.length) {
          throw new Error(`Placeholder is forbidden because ${requirementId} has selectable Resource Library bundles`)
        }
        const requirement = manifest.requirements.find(item => item.id === requirementId)
        if (!requirement)
          throw new Error(`Resource requirement is missing: ${requirementId}`)
        for (const decision of placeholders) {
          if (!requirement.acquisition_profile.asset_kinds.some(kind => kind === decision.assetKind))
            throw new Error(`Resource placeholder asset kind is not declared by ${requirementId}`)
          const adapter = options.provisionalAdapters.find(item => item.format === decision.format)
          if (!adapter)
            throw new Error(`No provisional resource adapter is registered for format: ${decision.format}`)
          if (!adapter.assetKinds.some(kind => kind === decision.assetKind))
            throw new Error(`Provisional resource adapter ${decision.format} does not support asset kind: ${decision.assetKind}`)
        }
        continue
      }
      if (group.status !== 'matched')
        throw new Error(`Library decision is not allowed for no-match requirement: ${requirementId}`)
      const libraryDecisions = requirementDecisions.filter((decision): decision is Extract<ResourceInventoryDecision, { kind: 'library' }> => decision.kind === 'library')
      const bundle = group.bundles.find(candidateBundle => libraryDecisions.every(decision =>
        candidateBundle.candidates.some(candidate =>
          candidate.packId === decision.packId &&
          candidate.packVersion === decision.expectedPackVersion &&
          candidate.elementId === decision.elementId,
        )))
      if (!bundle)
        throw new Error(`Library decisions do not exactly cover one returned Resource Library bundle: ${requirementId}`)
      for (const decision of libraryDecisions) {
        const candidate = bundle.candidates.find(candidate =>
          candidate.packId === decision.packId &&
          candidate.packVersion === decision.expectedPackVersion &&
          candidate.elementId === decision.elementId,
        )
        if (!candidate)
          throw new Error(`Library decision is not an exact bundle member for ${requirementId}`)
        const established = deliveryByResource[decision.resourceId]
        if (established && canonicalResourceInventoryRevision(established) !== canonicalResourceInventoryRevision(candidate.delivery))
          throw new Error(`Reused resource has inconsistent delivery capabilities: ${decision.resourceId}`)
        deliveryByResource[decision.resourceId] = candidate.delivery
      }
    }
    const provisionalResources = decisions
      .filter((decision): decision is Extract<ResourceInventoryDecision, { kind: 'placeholder' }> =>
        decision.kind === 'placeholder')
      .map(decision => ({
        id: decision.resourceId,
        destinationPath: decision.destinationPath,
        format: decision.format,
        reason: decision.reason,
        selectionReason: decision.selectionReason,
        assetKind: decision.assetKind,
        ...(decision.parameters ? { parameters: decision.parameters } : {}),
      }))
    if (provisionalResources.length)
      await validateProvisionalResources({
        workspacePath: options.workspacePath,
        adapters: options.provisionalAdapters,
        resources: provisionalResources,
      })
    receipt = {
      version: 1,
      state: 'prepared',
      transactionId: transaction.transactionId,
      dispatchId: options.dispatchId,
      planRevision,
      catalogRevision: observation.result.catalogRevision,
      decisions,
      deliveryByResource,
      stagedResourceIds: [],
      outputHashesByResource: {},
      bindings: buildBindings(decisions),
      preparedAt: new Date().toISOString(),
    }
    await options.assertMutationAuthority()
    await writeReceipt(receiptPath, receipt)
  }

  await options.assertMutationAuthority()
  receipt.state = 'applying'
  await writeReceipt(receiptPath, receipt)
  const stagingWorkspacePath = `${receiptPath.slice(0, -'.json'.length)}.staging`
  const stagedManifest = await readBeeGameAssetManifest(stagingWorkspacePath)
  if (!stagedManifest.project_target && !stagedManifest.requirements.length && !stagedManifest.resources.length) {
    await writeBeeGameAssetManifest(stagingWorkspacePath, manifest)
  } else if (resourceInventoryPlanRevision(stagedManifest) !== planRevision) {
    throw new Error('Staged resource inventory does not match the current canonical resource plan')
  }
  const staged = new Set(receipt.stagedResourceIds)
  const application = new ProjectResourceApplication(
    options.client,
    options.fetchImpl,
    convertResourceDelivery,
  )
  for (const decision of uniqueResourceDecisions(receipt.decisions)) {
    if (staged.has(decision.resourceId)) continue
    await options.assertMutationAuthority()
    if (decision.kind === 'library') {
      const result = await application.acquireResources(stagingWorkspacePath, receipt.catalogRevision, [{
        resourceId: decision.resourceId,
        packId: decision.packId,
        expectedPackVersion: decision.expectedPackVersion,
        elementId: decision.elementId,
        destinationPath: decision.destinationPath,
        selectionReason: decision.selectionReason,
        ...(receipt.deliveryByResource[decision.resourceId]
          ? { delivery: receipt.deliveryByResource[decision.resourceId] }
          : {}),
      }])
      const acquired = result.resources[0]
      if (!acquired || acquired.status !== 'verified') {
        throw new Error(`Resource inventory acquisition failed for ${decision.requirementId}: ${acquired?.error ?? 'missing result'}`)
      }
    } else {
      await authorProvisionalResources({
        workspacePath: stagingWorkspacePath,
        adapters: options.provisionalAdapters,
        resources: [{
          id: decision.resourceId,
          destinationPath: decision.destinationPath,
          format: decision.format,
          reason: decision.reason,
          selectionReason: decision.selectionReason,
          assetKind: decision.assetKind,
          ...(decision.parameters ? { parameters: decision.parameters } : {}),
        }],
      })
    }
    await options.assertMutationAuthority()
    const stagedAfterAcquisition = await readBeeGameAssetManifest(stagingWorkspacePath)
    const stagedResource = stagedAfterAcquisition.resources.find(resource => resource.id === decision.resourceId)
    if (!stagedResource?.local_file_hashes)
      throw new Error(`Staged resource has no canonical output hashes: ${decision.resourceId}`)
    staged.add(decision.resourceId)
    receipt.stagedResourceIds = [...staged]
    receipt.outputHashesByResource[decision.resourceId] = structuredClone(stagedResource.local_file_hashes)
    await writeReceipt(receiptPath, receipt)
  }
  await options.assertMutationAuthority()
  await publishBeeGameResourceInventoryFromStaging(
    options.workspacePath,
    stagingWorkspacePath,
    [...new Set(receipt.decisions.map(decision => decision.resourceId))],
    receipt.outputHashesByResource,
  )
  const finalManifest = await readBeeGameAssetManifest(options.workspacePath)
  const verified = new Set(finalManifest.resources.filter(item => item.status === 'verified').map(item => item.id))
  for (const binding of receipt.bindings) {
    if (binding.resourceIds.some(resourceId => !verified.has(resourceId))) {
      throw new Error(`Committed inventory binding is not verified: ${binding.requirementId}`)
    }
  }
  receipt.state = 'committed'
  receipt.committedAt = new Date().toISOString()
  await writeReceipt(receiptPath, receipt)
  await finalizeCommittedTransaction(options.workspacePath, transaction.transactionId, planRevision, receipt, receiptPath)
  return { ...receipt, receiptPath }
}

export async function readCurrentCommittedResourceInventoryReceipt(
  workspacePath: string,
): Promise<(DurableResourceInventoryReceipt & { receiptPath: string }) | undefined> {
  const manifest = await readBeeGameAssetManifest(workspacePath)
  const planRevision = resourceInventoryPlanRevision(manifest)
  const root = join(workspacePath, '.beegame/workflow/resource-inventory-commits')
  let names: string[]
  try {
    names = await readdir(root)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const receipts = (
    await Promise.all(
      names.filter(name => name.endsWith('.json')).map(async name => {
        const receiptPath = join(root, name)
        const receipt = await readReceipt(receiptPath)
        return receipt ? { ...receipt, receiptPath } : undefined
      }),
    )
  ).filter((value): value is DurableResourceInventoryReceipt & { receiptPath: string } =>
    Boolean(value?.state === 'committed' && value.planRevision === planRevision),
  )
  receipts.sort((left, right) =>
    String(right.committedAt).localeCompare(String(left.committedAt)),
  )
  const receipt = receipts[0]
  if (!receipt) return undefined
  const audit = auditAssetContract(workspacePath)
  const byId = new Map(audit.resources.map(resource => [resource.id, resource]))
  if (receipt.bindings.some(binding =>
    binding.resourceIds.some(resourceId => {
      const resource = byId.get(resourceId)
      return !resource || resource.status !== 'verified' || resource.issues.length > 0
    }),
  )) return undefined
  return receipt
}

function validateDecisionCoverage(
  requiredIds: readonly string[],
  input: readonly ResourceInventoryDecision[],
): ResourceInventoryDecision[] {
  const required = new Set(requiredIds)
  const decisions = input.map(value => structuredClone(value))
  for (const decision of decisions) {
    if (!required.has(decision.requirementId)) throw new Error(`Unknown required resource requirement: ${decision.requirementId}`)
  }
  const missing = requiredIds.filter(id => !decisions.some(decision => decision.requirementId === id))
  if (missing.length) throw new Error(`Resource inventory decisions do not cover required requirements: ${missing.join(', ')}`)
  for (const requirementId of requiredIds) {
    const group = decisions.filter(decision => decision.requirementId === requirementId)
    const placeholders = group.filter(decision => decision.kind === 'placeholder')
    if (placeholders.length && placeholders.length !== group.length)
      throw new Error(`Resource inventory requirement must use either library resources or one or more placeholders: ${requirementId}`)
  }
  const byResource = new Map<string, string>()
  for (const decision of decisions) {
    const identity = canonicalResourceInventoryRevision({
      ...decision,
      requirementId: undefined,
    })
    const established = byResource.get(decision.resourceId)
    if (established && established !== identity)
      throw new Error(`Reused resource has inconsistent acquisition decisions: ${decision.resourceId}`)
    byResource.set(decision.resourceId, identity)
  }
  return decisions.sort((left, right) =>
    requiredIds.indexOf(left.requirementId) - requiredIds.indexOf(right.requirementId) ||
    left.resourceId.localeCompare(right.resourceId),
  )
}

function uniqueResourceDecisions(
  decisions: readonly ResourceInventoryDecision[],
): ResourceInventoryDecision[] {
  const seen = new Set<string>()
  return decisions.filter(decision => {
    if (seen.has(decision.resourceId)) return false
    seen.add(decision.resourceId)
    return true
  })
}

function preserveProvisionalResourceIds(
  decisions: readonly ResourceInventoryDecision[],
  previousDecisions: readonly ResourceInventoryDecision[],
): ResourceInventoryDecision[] {
  const provisionalByRequirement = new Map(
    previousDecisions
      .filter((decision): decision is Extract<ResourceInventoryDecision, { kind: 'placeholder' }> =>
        decision.kind === 'placeholder',
      )
      .map(decision => [decision.requirementId, decision.resourceId] as const),
  )
  const assigned = new Set<string>()
  return decisions.map(decision => {
    if (decision.kind !== 'library') return decision
    const provisionalId = provisionalByRequirement.get(decision.requirementId)
    if (!provisionalId || assigned.has(provisionalId)) return decision
    assigned.add(provisionalId)
    return { ...decision, resourceId: provisionalId }
  })
}

function canonicalizeExistingProvisionalPaths(
  decisions: readonly ResourceInventoryDecision[],
  resources: readonly BeeGameProjectResource[],
): ResourceInventoryDecision[] {
  const provisionalById = new Map(
    resources
      .filter(resource => resource.provisional && resource.source.type === 'agent-authored')
      .map(resource => [resource.id, resource.root_path] as const),
  )
  return decisions.map(decision => {
    if (decision.kind !== 'placeholder') return structuredClone(decision)
    const canonicalPath = provisionalById.get(decision.resourceId)
    return canonicalPath
      ? { ...structuredClone(decision), destinationPath: canonicalPath }
      : structuredClone(decision)
  })
}

function buildBindings(
  decisions: readonly ResourceInventoryDecision[],
): Array<{ requirementId: string; resourceIds: string[] }> {
  const bindings = new Map<string, string[]>()
  for (const decision of decisions) {
    const resourceIds = bindings.get(decision.requirementId) ?? []
    if (!resourceIds.includes(decision.resourceId)) resourceIds.push(decision.resourceId)
    bindings.set(decision.requirementId, resourceIds)
  }
  return [...bindings].map(([requirementId, resourceIds]) => ({
    requirementId,
    resourceIds,
  }))
}

async function finalizeCommittedTransaction(
  workspacePath: string,
  transactionId: string,
  planRevision: string,
  receipt: DurableResourceInventoryReceipt,
  receiptPath: string,
): Promise<void> {
  const audit = auditAssetContract(workspacePath)
  const resources = new Map(audit.resources.map(resource => [resource.id, resource]))
  for (const binding of receipt.bindings) {
    for (const resourceId of binding.resourceIds) {
      const resource = resources.get(resourceId)
      if (!resource || resource.status !== 'verified' || resource.issues.length)
        throw new Error(`Committed inventory binding is not verified: ${binding.requirementId}`)
    }
  }
  await rm(`${receiptPath.slice(0, -'.json'.length)}.staging`, {
    recursive: true,
    force: true,
  })
  await completeResourceInventoryTransaction({
    workspacePath,
    transactionId,
    planRevision,
  })
}

async function readReceipt(path: string): Promise<DurableResourceInventoryReceipt | undefined> {
  try {
    return parseReceipt(JSON.parse(await readFile(path, 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function parseReceipt(value: unknown): DurableResourceInventoryReceipt {
  const parsed = durableResourceInventoryReceiptSchema.safeParse(value)
  if (!parsed.success)
    throw new Error(`Resource inventory receipt is invalid: ${parsed.error.message}`)
  return parsed.data
}

async function writeReceipt(path: string, receipt: DurableResourceInventoryReceipt): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`)
  await rename(temporary, path)
}
