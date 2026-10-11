import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod/v4'
import { parseAcceptanceChecklist } from '../acceptance-checklist'
import { markedBlock, buildChecklistAuthorityProjection } from '../checklist-authority-projection'
import {
  readBeeGameAssetManifest,
  type BeeGameAssetManifest,
} from '../asset-contracts'
import {
  computeResourceContentDigest,
  computeResourceContentRootDigest,
  computeResourceRevision,
} from './revision'
import {
  readResourceContentCommitReceipt,
  type ResourceContentCommitReceipt,
} from '../native-resource-content-tool'
import {
  readCommittedResourceInventoryReceiptForDispatch,
  type DurableResourceInventoryReceipt,
} from '../resource-inventory-commit'
import { resourceInventoryPlanRevision } from '../resource-inventory-revision'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './types'
import {
  GAME_DOCUMENT_CONTRACTS,
  type GameDocumentContract,
  type TypedRecordContract,
} from './game-document-contracts'
import {
  GAME_IR_MODULE_IDS,
  assertAssetManifestMatchesProjection,
  canonicalGameIrJson,
  digestGameIrBytes,
  gameIrDependencyGraphSchema,
  gameIrModuleSchema,
  gameIrSourceMapSchema,
  loadCurrentCommittedGameIr,
  parseGameIrResourceAuthority,
  type GameIrAssetRequirementProjection,
  type GameIrModuleId,
} from './game-ir'

const DIGEST = z.string().regex(/^[a-f0-9]{64}$/u)
const NON_EMPTY = z.string().trim().min(1)
const ID = z.string().regex(/^[a-z][a-z0-9_-]*:[A-Za-z0-9._-]+$/u)
const FOUNDATION_DIGESTS = z.object(
  Object.fromEntries(CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, DIGEST])) as Record<FoundationDocumentPath, typeof DIGEST>,
).strict()

export const implementationResourceGateProofSchema = z.object({
  unitId: z.literal('resource:gate'),
  resourceRevision: DIGEST,
  inputRevision: DIGEST,
  receiptRef: NON_EMPTY,
  acceptedUnitDigest: DIGEST,
  predecessorProofDigests: z.array(DIGEST),
  status: z.literal('passed'),
}).strict()

export const implementationInventoryProofSchema = z.object({
  dispatchId: NON_EMPTY,
  receiptRef: NON_EMPTY,
  receiptDigest: DIGEST,
  inventoryRevision: DIGEST,
}).strict()

export const implementationContentProofSchema = z.object({
  dispatchId: NON_EMPTY,
  receiptRef: NON_EMPTY,
  receiptDigest: DIGEST,
  contentDigest: DIGEST,
  finalRootDigest: DIGEST,
}).strict()

export const implementationComprehensiveReadyReceiptSchema = z.object({
  schemaVersion: z.literal('comprehensive-ready-receipt.v1'),
  dispatchId: NON_EMPTY,
  receiptRef: NON_EMPTY,
  revision: DIGEST,
  receiptDigest: DIGEST,
  resourceGateReceiptRef: NON_EMPTY,
  resourceGateReceiptDigest: DIGEST,
}).strict()

export const implementationAuthoritySchema = z.object({
  schemaVersion: z.literal('implementation-authority.v1'),
  projectId: NON_EMPTY,
  confirmedBriefDigest: DIGEST,
  foundationRevision: DIGEST,
  foundationDocumentDigests: FOUNDATION_DIGESTS,
  gameIrManifestDigest: DIGEST,
  checklistDigest: DIGEST,
  assetManifestDigest: DIGEST,
  resourceRevision: DIGEST,
  resourceGateProof: implementationResourceGateProofSchema,
  inventoryProof: implementationInventoryProofSchema.nullable(),
  contentProof: implementationContentProofSchema.nullable(),
  comprehensiveReadyReceipt: implementationComprehensiveReadyReceiptSchema,
  canonicalDigest: DIGEST,
}).strict()

const irNodeSchema = z.object({
  id: ID,
  moduleId: z.enum(GAME_IR_MODULE_IDS),
  record: z.record(z.string(), z.unknown()),
}).strict()
const dependencyEdgeSchema = z.object({
  sourceId: ID,
  targetId: ID,
}).strict()
const sourceBindingSchema = z.object({
  moduleId: z.enum(GAME_IR_MODULE_IDS),
  pointer: z.string().regex(/^\//u),
  binding: z.enum(['owner', 'derived']),
}).strict()
const checklistItemSchema = z.object({
  id: NON_EMPTY,
  source: NON_EMPTY,
  description: NON_EMPTY,
  sourceDigest: DIGEST,
  irIds: z.array(ID),
}).strict()
const ownerBlockSchema = z.object({
  documentPath: z.string().regex(/^docs\/[A-Za-z0-9._/-]+$/u),
  blockId: NON_EMPTY,
  digest: DIGEST,
  markdown: z.string().min(1),
}).strict()
const resourceBindingSchema = z.object({
  requirementId: NON_EMPTY,
  resourceIds: z.array(NON_EMPTY),
}).strict()
const contentBindingSchema = z.object({
  contentId: NON_EMPTY,
  paths: z.array(NON_EMPTY),
  resourceIds: z.array(NON_EMPTY),
}).strict()
const targetRuntimeSchema = z.object({
  project_target: z.record(z.string(), z.unknown()),
  runtimeRecord: z.record(z.string(), z.unknown()),
}).strict()

export const implementationProjectionSchema = z.object({
  schemaVersion: z.literal('implementation-projection.v1'),
  authority: implementationAuthoritySchema,
  projectionDigest: DIGEST,
  requiredImplementationIrIds: z.array(ID),
  contextIrIds: z.array(ID),
  irNodes: z.array(irNodeSchema),
  dependencySubgraph: z.array(dependencyEdgeSchema),
  sourceBindings: z.array(sourceBindingSchema),
  checklistItems: z.array(checklistItemSchema),
  ownerBlocks: z.array(ownerBlockSchema),
  resourceBindings: z.array(resourceBindingSchema),
  contentBindings: z.array(contentBindingSchema),
  targetRuntime: targetRuntimeSchema,
}).strict()

export type ImplementationResourceGateProof = z.infer<typeof implementationResourceGateProofSchema>
export type ImplementationComprehensiveReadyReceipt = z.infer<typeof implementationComprehensiveReadyReceiptSchema>
export type ImplementationAuthority = z.infer<typeof implementationAuthoritySchema>
export type ImplementationProjection = z.infer<typeof implementationProjectionSchema>

export const implementationTaskSliceSchema = z.object({
  schemaVersion: z.literal('implementation-task-slice.v1'),
  authorityDigest: DIGEST,
  projectionDigest: DIGEST,
  taskId: NON_EMPTY,
  irNodes: z.array(irNodeSchema),
  ownerBlocks: z.array(ownerBlockSchema),
  resourceBindings: z.array(resourceBindingSchema),
  contentBindings: z.array(contentBindingSchema),
  targetRuntime: targetRuntimeSchema,
}).strict()

export const implementationChecklistRuntimeSliceSchema = z.object({
  schemaVersion: z.literal('implementation-checklist-runtime-slice.v1'),
  authorityDigest: DIGEST,
  projectionDigest: DIGEST,
  checklistItems: z.array(checklistItemSchema),
  targetRuntime: targetRuntimeSchema,
}).strict()

export type ImplementationTaskSlice = z.infer<typeof implementationTaskSliceSchema>
export type ImplementationChecklistRuntimeSlice = z.infer<typeof implementationChecklistRuntimeSliceSchema>

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function compareBytes(left: string, right: string): number {
  return Buffer.from(left, 'utf8').compare(Buffer.from(right, 'utf8'))
}

function sortedUnique(values: readonly string[]): string[] {
  const sorted = [...new Set(values)].sort(compareBytes)
  if (sorted.length !== values.length) throw new Error('Implementation projection contains duplicate IDs')
  return sorted
}

function digestWithout(value: Record<string, unknown>, field: string): string {
  const copy = { ...value }
  delete copy[field]
  return digestGameIrBytes(copy)
}

function contractBlock(
  documentPath: FoundationDocumentPath,
  blockId: string,
): { contract: GameDocumentContract; owner: GameDocumentContract['sections'][number] | GameDocumentContract['productionMaterials'][number] } {
  const contract = GAME_DOCUMENT_CONTRACTS[documentPath]
  const owner = blockId.startsWith('material.')
    ? contract.productionMaterials.find(item => `material.${item.materialId}` === blockId)
    : contract.sections.find(item => item.sectionId === blockId)
  if (!owner) throw new Error(`Implementation projection block is not in GAME_DOCUMENT_CONTRACTS: ${documentPath}#${blockId}`)
  return { contract, owner }
}

function typedDisposition(owner: { typedRecords?: readonly TypedRecordContract[] }): TypedRecordContract['implementationDisposition'] | undefined {
  const records = owner.typedRecords ?? []
  if (records.length > 1) throw new Error('Implementation projection owner block has multiple typed families')
  return records[0]?.implementationDisposition
}

function assertSortedUnique(values: readonly string[], label: string): void {
  const expected = sortedUnique(values)
  if (expected.length !== values.length || expected.some((value, index) => value !== values[index]))
    throw new Error(`${label} must be unique canonical byte order`)
}

function manifestDigest(manifest: BeeGameAssetManifest): string {
  return digestGameIrBytes(manifest)
}

function receiptRef(workspacePath: string, path: string): string {
  const root = `${workspacePath.replace(/[\\/]+$/u, '')}/`
  return path.startsWith(root) ? path.slice(root.length).replaceAll('\\', '/') : path
}

function parseRuntimeRecord(files: Record<string, string>): Record<string, unknown> {
  const module = gameIrModuleSchema.parse(JSON.parse(files['modules/runtime.json']!))
  return module.data.byId as Record<string, unknown>
}

function sourceBindingsAndNodes(files: Record<string, string>): {
  nodes: ImplementationProjection['irNodes']
  sourceBindings: ImplementationProjection['sourceBindings']
  requiredIds: string[]
  contextIds: string[]
} {
  const nodes: ImplementationProjection['irNodes'] = []
  const sourceBindings: ImplementationProjection['sourceBindings'] = []
  const requiredIds: string[] = []
  const contextIds: string[] = []
  for (const moduleId of GAME_IR_MODULE_IDS) {
    const module = gameIrModuleSchema.parse(JSON.parse(files[`modules/${moduleId}.json`]!))
    const sourceMap = gameIrSourceMapSchema.parse(JSON.parse(files[`source-maps/${moduleId}.json`]!))
    for (const [recordId, record] of Object.entries(module.data.byId)) {
      const id = `${moduleId}:${recordId}`
      nodes.push({ id, moduleId, record })
      const identity = sourceMap.bindings[`/byId/${recordId}`]
      if (!identity || identity.kind !== 'derived' || identity.inputPointers.length !== 1)
        throw new Error(`Implementation projection record identity binding is missing: ${id}`)
      const ownerBinding = sourceMap.bindings[identity.inputPointers[0]!.pointer]
      if (!ownerBinding || ownerBinding.kind !== 'owner') throw new Error(`Implementation projection owner binding is missing: ${id}`)
      const owner = contractBlock(ownerBinding.ownerRef.documentPath as FoundationDocumentPath, ownerBinding.ownerRef.blockId).owner
      const disposition = typedDisposition(owner)
      if (!disposition) throw new Error(`Implementation projection owner disposition is missing: ${id}`)
      if (disposition === 'owned') requiredIds.push(id)
      if (disposition === 'context') contextIds.push(id)
    }
    for (const [pointer, binding] of Object.entries(sourceMap.bindings))
      sourceBindings.push({ moduleId, pointer, binding: binding.kind })
  }
  nodes.sort((left, right) => compareBytes(left.id, right.id))
  sourceBindings.sort((left, right) => compareBytes(`${left.moduleId}\0${left.pointer}`, `${right.moduleId}\0${right.pointer}`))
  return { nodes, sourceBindings, requiredIds: sortedUnique(requiredIds), contextIds: sortedUnique(contextIds) }
}

function dependencySubgraph(files: Record<string, string>): ImplementationProjection['dependencySubgraph'] {
  const graph = gameIrDependencyGraphSchema.parse(JSON.parse(files['dependency-graph.json']!))
  const result = graph.edges.map(edge => ({
    sourceId: `${edge.sourcePointer.moduleId}:${edge.sourcePointer.pointer.split('/')[2]}`,
    targetId: `${edge.targetPointer.moduleId}:${edge.targetPointer.pointer.split('/')[2]}`,
  }))
  result.sort((left, right) => compareBytes(canonicalGameIrJson(left), canonicalGameIrJson(right)))
  return result
}

async function readProjectionOwnerBlocks(workspacePath: string): Promise<ImplementationProjection['ownerBlocks']> {
  const result: ImplementationProjection['ownerBlocks'] = []
  for (const documentPath of CANONICAL_FOUNDATION_DOCUMENTS) {
    const markdown = await readFile(join(workspacePath, documentPath), 'utf8')
    const contract = GAME_DOCUMENT_CONTRACTS[documentPath]
    const owners = [
      ...contract.sections.map(owner => ({ id: owner.sectionId, rawMode: owner.implementationRawMode })),
      ...contract.productionMaterials.map(owner => ({ id: `material.${owner.materialId}`, rawMode: owner.implementationRawMode })),
    ]
    for (const owner of owners) {
      if (owner.rawMode !== 'scoped_raw') continue
      const block = markedBlock(markdown, owner.id)
      result.push({ documentPath, blockId: owner.id, digest: sha256(Buffer.from(block, 'utf8')), markdown: block })
    }
  }
  result.sort((left, right) => compareBytes(`${left.documentPath}\0${left.blockId}`, `${right.documentPath}\0${right.blockId}`))
  return result
}

function verifyAuthority(value: ImplementationAuthority): ImplementationAuthority {
  const parsed = implementationAuthoritySchema.parse(value)
  if (digestWithout(parsed as unknown as Record<string, unknown>, 'canonicalDigest') !== parsed.canonicalDigest)
    throw new Error('Implementation authority canonical digest is invalid')
  if (parsed.resourceGateProof.resourceRevision !== parsed.resourceRevision)
    throw new Error('Implementation authority Resource Gate revision is stale')
  if (parsed.comprehensiveReadyReceipt.resourceGateReceiptRef !== parsed.resourceGateProof.receiptRef ||
    parsed.comprehensiveReadyReceipt.resourceGateReceiptDigest !== parsed.resourceGateProof.acceptedUnitDigest)
    throw new Error('Comprehensive READY receipt is not bound to the exact Resource Gate proof')
  return parsed
}

export function parseImplementationAuthority(value: unknown): ImplementationAuthority {
  return verifyAuthority(value as ImplementationAuthority)
}

export function parseImplementationProjection(value: unknown): ImplementationProjection {
  const parsed = implementationProjectionSchema.parse(value)
  verifyAuthority(parsed.authority)
  if (digestWithout(parsed as unknown as Record<string, unknown>, 'projectionDigest') !== parsed.projectionDigest)
    throw new Error('Implementation projection canonical digest is invalid')
  assertSortedUnique(parsed.requiredImplementationIrIds, 'requiredImplementationIrIds')
  assertSortedUnique(parsed.contextIrIds, 'contextIrIds')
  return parsed
}

export async function buildImplementationProjection(input: {
  workspacePath: string
  projectId: string
  confirmedBriefDigest: string
  foundationRevision: string
  foundationDocumentDigests: Readonly<Record<FoundationDocumentPath, string>>
  resourceGateProof: unknown
  comprehensiveReadyReceipt: unknown
  inventoryDispatchId?: string
  contentDispatchId?: string
}): Promise<ImplementationProjection> {
  const gate = implementationResourceGateProofSchema.parse(input.resourceGateProof)
  const comprehensive = implementationComprehensiveReadyReceiptSchema.parse(input.comprehensiveReadyReceipt)
  if (gate.inputRevision !== input.foundationRevision)
    throw new Error('Resource Gate input revision does not match Foundation authority')
  const current = await loadCurrentCommittedGameIr({
    workspacePath: input.workspacePath,
    foundationRevision: input.foundationRevision,
    manifestDigest: '',
    projectId: input.projectId,
    confirmedBriefDigest: input.confirmedBriefDigest,
    expectedDocumentDigests: input.foundationDocumentDigests,
  }).catch(error => {
    if (error instanceof Error && error.message === 'Game IR manifest digest does not match the durable workflow state') return undefined
    throw error
  })
  if (!current) {
    const documents = Object.fromEntries(await Promise.all(CANONICAL_FOUNDATION_DOCUMENTS.map(async path => [path, await readFile(join(input.workspacePath, path), 'utf8')] as const))) as Record<FoundationDocumentPath, string>
    const committed = await loadCurrentCommittedGameIr({
      workspacePath: input.workspacePath,
      foundationRevision: input.foundationRevision,
      manifestDigest: '0'.repeat(64),
      projectId: input.projectId,
      confirmedBriefDigest: input.confirmedBriefDigest,
      expectedDocumentDigests: input.foundationDocumentDigests,
    }).catch(error => {
      if (error instanceof Error && error.message === 'Game IR manifest digest does not match the durable workflow state') return error
      throw error
    })
    throw committed
  }
  // The current Game IR loader requires a manifest digest; use the committed value after the
  // same full Foundation/digest validation, with no alternate reader or fallback.
  const gameIr = await loadCurrentCommittedGameIr({
    workspacePath: input.workspacePath,
    foundationRevision: input.foundationRevision,
    manifestDigest: current.publication.committed.manifestDigest,
    projectId: input.projectId,
    confirmedBriefDigest: input.confirmedBriefDigest,
    expectedDocumentDigests: input.foundationDocumentDigests,
  })
  const authorityBase = parseGameIrResourceAuthority({
    foundationRevision: input.foundationRevision,
    documentDigests: input.foundationDocumentDigests,
    confirmedBriefDigest: input.confirmedBriefDigest,
    projectId: input.projectId,
    gameIrManifestDigest: gameIr.publication.committed.manifestDigest,
  })
  const manifest = await readBeeGameAssetManifest(input.workspacePath)
  assertAssetManifestMatchesProjection(manifest, {
    foundationRevision: authorityBase.foundationRevision,
    manifestDigest: authorityBase.gameIrManifestDigest,
  }, gameIr.projection)
  if (!manifest.project_target) throw new Error('Implementation projection requires Manifest v9 project_target')
  const checklist = await buildChecklistAuthorityProjection({
    workspacePath: input.workspacePath,
    projectId: input.projectId,
    approvedDocumentRevision: input.foundationRevision,
    confirmedBriefDigest: input.confirmedBriefDigest,
    gameIrManifestDigest: gameIr.publication.committed.manifestDigest,
    expectedDocumentDigests: input.foundationDocumentDigests,
  })
  const checklistMarkdown = await readFile(join(input.workspacePath, 'docs/acceptance/gameplay-checklist.md'), 'utf8')
  const parsedChecklist = parseAcceptanceChecklist(checklistMarkdown, 'docs/acceptance/gameplay-checklist.md', checklist.registry)
  if (parsedChecklist.issues.length) throw new Error(`Implementation projection Checklist is invalid: ${parsedChecklist.issues.join('; ')}`)
  const resourceRevision = await computeResourceRevision(input.workspacePath, input.foundationRevision)
  if (gate.resourceRevision !== resourceRevision) throw new Error('Resource Gate proof is stale for current resource revision')
  const assetManifestDigest = manifestDigest(manifest)
  let inventoryReceipt: (DurableResourceInventoryReceipt & { receiptPath: string }) | undefined
  if (gameIr.projection.length > 0) {
    if (!input.inventoryDispatchId) throw new Error('Implementation projection requires exact Inventory proof')
    inventoryReceipt = await readCommittedResourceInventoryReceiptForDispatch({
      workspacePath: input.workspacePath,
      dispatchId: input.inventoryDispatchId,
      authority: authorityBase,
      assetRequirementProjection: gameIr.projection,
    })
    if (!inventoryReceipt) throw new Error('Implementation projection Inventory proof is missing')
  } else if (input.inventoryDispatchId) {
    throw new Error('Zero-resource projection cannot carry an Inventory receipt')
  }
  let contentReceipt: ResourceContentCommitReceipt | undefined
  if (input.contentDispatchId) {
    const receipt = readResourceContentCommitReceipt(input.workspacePath, input.contentDispatchId)
    if (!receipt || receipt.action !== 'commit' || receipt.status !== 'committed')
      throw new Error('Implementation projection Content proof is missing or not committed')
    if (canonicalGameIrJson(receipt.authority) !== canonicalGameIrJson(authorityBase))
      throw new Error('Implementation projection Content proof authority is stale')
    if (receipt.finalRootDigest !== computeResourceContentRootDigest(input.workspacePath))
      throw new Error('Implementation projection Content proof root is stale')
    contentReceipt = receipt
  }
  if (comprehensive.resourceGateReceiptRef !== gate.receiptRef || comprehensive.resourceGateReceiptDigest !== gate.acceptedUnitDigest)
    throw new Error('Comprehensive READY receipt does not bind the exact Resource Gate proof')
  const { nodes, sourceBindings, requiredIds, contextIds } = sourceBindingsAndNodes(gameIr.publication.files)
  const ownerBlocks = await readProjectionOwnerBlocks(input.workspacePath)
  const dependency = dependencySubgraph(gameIr.publication.files)
  const resourceBindings = inventoryReceipt?.bindings
    .map(binding => ({ requirementId: binding.requirementId, resourceIds: [...binding.resourceIds].sort(compareBytes) }))
    .sort((left, right) => compareBytes(left.requirementId, right.requirementId)) ?? []
  const contentBindings = contentReceipt ? [{
    contentId: `content:${contentReceipt.dispatchId}`,
    paths: [...contentReceipt.writtenPaths].sort(compareBytes),
    resourceIds: sortedUnique(resourceBindings.flatMap(binding => binding.resourceIds)),
  }] : []
  const authorityWithoutDigest = {
    schemaVersion: 'implementation-authority.v1' as const,
    projectId: input.projectId,
    confirmedBriefDigest: input.confirmedBriefDigest,
    foundationRevision: input.foundationRevision,
    foundationDocumentDigests: input.foundationDocumentDigests,
    gameIrManifestDigest: gameIr.publication.committed.manifestDigest,
    checklistDigest: sha256(Buffer.from(checklistMarkdown, 'utf8')),
    assetManifestDigest,
    resourceRevision,
    resourceGateProof: gate,
    inventoryProof: inventoryReceipt ? {
      dispatchId: inventoryReceipt.dispatchId,
      receiptRef: receiptRef(input.workspacePath, inventoryReceipt.receiptPath),
      receiptDigest: sha256(Buffer.from(canonicalGameIrJson(inventoryReceipt), 'utf8')),
      inventoryRevision: inventoryReceipt.planRevision,
    } : null,
    contentProof: contentReceipt ? {
      dispatchId: contentReceipt.dispatchId,
      receiptRef: `.beegame/workflow/resource-content-commits/${contentReceipt.dispatchId}.json`,
      receiptDigest: sha256(Buffer.from(canonicalGameIrJson(contentReceipt), 'utf8')),
      contentDigest: await computeResourceContentDigest(input.workspacePath),
      finalRootDigest: contentReceipt.finalRootDigest,
    } : null,
    comprehensiveReadyReceipt: comprehensive,
  }
  const authority = implementationAuthoritySchema.parse({
    ...authorityWithoutDigest,
    canonicalDigest: digestWithout(authorityWithoutDigest, 'canonicalDigest'),
  })
  verifyAuthority(authority)
  const projectionWithoutDigest = {
    schemaVersion: 'implementation-projection.v1' as const,
    authority,
    requiredImplementationIrIds: requiredIds,
    contextIrIds: contextIds,
    irNodes: nodes,
    dependencySubgraph: dependency,
    sourceBindings,
    checklistItems: parsedChecklist.tasks.map(task => ({
      id: task.id,
      source: task.source,
      description: task.description,
      sourceDigest: task.sourceDigest ?? '',
      irIds: [...(task.irIds ?? [])].sort(compareBytes),
    })).sort((left, right) => compareBytes(left.id, right.id)),
    ownerBlocks,
    resourceBindings,
    contentBindings,
    targetRuntime: {
      project_target: manifest.project_target,
      runtimeRecord: parseRuntimeRecord(gameIr.publication.files),
    },
  }
  const projection = implementationProjectionSchema.parse({
    ...projectionWithoutDigest,
    projectionDigest: digestWithout(projectionWithoutDigest, 'projectionDigest'),
  })
  return parseImplementationProjection(projection)
}

export function buildImplementationTaskSlice(input: {
  projection: ImplementationProjection
  taskId: string
  implementsIrIds: readonly string[]
  resourceIds?: readonly string[]
  contentIds?: readonly string[]
}): ImplementationTaskSlice {
  const irIds = sortedUnique(input.implementsIrIds)
  const nodes = input.projection.irNodes.filter(node => irIds.includes(node.id))
  if (nodes.length !== irIds.length) throw new Error('Implementation task slice references an IR ID outside the projection')
  const selectedBlocks = input.projection.ownerBlocks.filter(block => nodes.some(node =>
    input.projection.sourceBindings.some(binding => binding.moduleId === node.moduleId && binding.binding === 'owner' && binding.pointer.startsWith(`/byId/${node.id.split(':')[1]!}`) && block.documentPath === block.documentPath),
  ))
  const resourceIds = sortedUnique(input.resourceIds ?? [])
  const contentIds = sortedUnique(input.contentIds ?? [])
  const resourceBindings = input.projection.resourceBindings.filter(binding => resourceIds.includes(binding.requirementId) || binding.resourceIds.some(id => resourceIds.includes(id)))
  const contentBindings = input.projection.contentBindings.filter(binding => contentIds.includes(binding.contentId))
  return implementationTaskSliceSchema.parse({
    schemaVersion: 'implementation-task-slice.v1',
    authorityDigest: input.projection.authority.canonicalDigest,
    projectionDigest: input.projection.projectionDigest,
    taskId: input.taskId,
    irNodes: nodes,
    ownerBlocks: selectedBlocks,
    resourceBindings,
    contentBindings,
    targetRuntime: input.projection.targetRuntime,
  })
}

export function buildChecklistRuntimeSlice(input: {
  projection: ImplementationProjection
  checklistIds: readonly string[]
}): ImplementationChecklistRuntimeSlice {
  const ids = sortedUnique(input.checklistIds)
  const checklistItems = input.projection.checklistItems.filter(item => ids.includes(item.id))
  if (checklistItems.length !== ids.length) throw new Error('Checklist runtime slice references an ID outside the projection')
  return implementationChecklistRuntimeSliceSchema.parse({
    schemaVersion: 'implementation-checklist-runtime-slice.v1',
    authorityDigest: input.projection.authority.canonicalDigest,
    projectionDigest: input.projection.projectionDigest,
    checklistItems,
    targetRuntime: input.projection.targetRuntime,
  })
}
