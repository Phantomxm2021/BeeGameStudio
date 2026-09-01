import { createHash } from 'node:crypto'
import { readSecureWorkspaceFile } from '../secure-file'
import { resolve } from 'node:path'
import { z } from 'zod'
import {
  GAME_IR_CANONICAL_MODULE_IDS,
  parseGameIrCompileRequest,
  parseGameIrReadyReceipt,
  type FoundationReadyReceipt,
  type GameIrModuleId,
  type GameIrReadyReceipt,
} from './contracts'
import {
  canonicalGameIrJson,
  compareCodeUnits,
  digestGameIrValue,
  parseGameIrCandidate,
  parseGameIrModuleCandidate,
  type GameIrCandidate,
  type GameIrModuleCandidate,
  type GameIrSourceBinding,
} from './model'
import type {
  ImplementationVerificationAcceptanceScenarioValue,
  ImplementationVerificationEvidenceRequirementValue,
  ImplementationVerificationInvariantValue,
  ImplementationVerificationTargetValue,
  ImplementationVerificationUnitValue,
} from './implementation-verification-schema'
import type {
  ResourceRealizationAcquisitionProfileValue,
  ResourceRealizationDeliveryArtifactValue,
  ResourceRealizationDeliveryTargetValue,
  ResourceRealizationLogicalResourceValue,
  ResourceRealizationVariantValue,
} from './resource-realization-schema'
import { projectFoundationReadyReceipt } from './foundation-ready-adapter'
import {
  GameIrStageCheckpointLoader,
  type GameIrReplayAuthority,
} from './stage-checkpoint'
import {
  validateCommittedGameIr,
  type GameIrPublicationAuthority,
} from './publication'
import { assembleImplementationVerificationClosure } from './implementation-verification-assembler'
import type { DeliveryRun } from '../types'

type RecordValue = Record<string, unknown>

type ImplementationProjectionPayload =
  | Readonly<{ kind: 'implementation-verification.target'; value: ImplementationVerificationTargetValue }>
  | Readonly<{ kind: 'implementation-verification.unit'; value: ImplementationVerificationUnitValue }>
  | Readonly<{ kind: 'implementation-verification.acceptance-scenario'; value: ImplementationVerificationAcceptanceScenarioValue }>
  | Readonly<{ kind: 'implementation-verification.invariant'; value: ImplementationVerificationInvariantValue }>
  | Readonly<{ kind: 'implementation-verification.evidence-requirement'; value: ImplementationVerificationEvidenceRequirementValue }>
type ResourceProjectionPayload =
  | Readonly<{ kind: 'resource-realization.logical-resource'; value: ResourceRealizationLogicalResourceValue }>
  | Readonly<{ kind: 'resource-realization.acquisition-profile'; value: ResourceRealizationAcquisitionProfileValue }>
  | Readonly<{ kind: 'resource-realization.delivery-target'; value: ResourceRealizationDeliveryTargetValue }>
  | Readonly<{ kind: 'resource-realization.variant'; value: ResourceRealizationVariantValue }>
  | Readonly<{ kind: 'resource-realization.delivery-artifact'; value: ResourceRealizationDeliveryArtifactValue }>
type ProjectionPayload = ImplementationProjectionPayload | ResourceProjectionPayload

type ProjectionNodeFor<P extends ProjectionPayload> = Readonly<{
  id: string
  kind: P['kind']
  producerMode: 'mechanical' | 'semantic' | 'derived'
  references: readonly Readonly<{ targetId: string; targetType: string }>[]
  edges: readonly Readonly<{ type: string; targetId: string; targetType: string }>[]
  bindings: Readonly<Record<string, GameIrSourceBinding>>
  payload: P
}>
type ProjectionNode = {
  [P in ProjectionPayload as P['kind']]: ProjectionNodeFor<P>
}[ProjectionPayload['kind']]

export type GameIrProjectionPayload = ProjectionPayload
export type GameIrProjectionNode = ProjectionNode

export type GameIrExecutionProjection = Readonly<{
  moduleId: 'implementation-verification'
  units: readonly Extract<ProjectionNode, { kind: 'implementation-verification.unit' }>[]
  scenarios: readonly Extract<ProjectionNode, { kind: 'implementation-verification.acceptance-scenario' }>[]
  invariants: readonly Extract<ProjectionNode, { kind: 'implementation-verification.invariant' }>[]
  evidenceRequirements: readonly Extract<ProjectionNode, { kind: 'implementation-verification.evidence-requirement' }>[]
  digest: string
}>

export type GameIrResourceProjection = Readonly<{
  moduleId: 'resource-realization'
  logicalResources: readonly Extract<ProjectionNode, { kind: 'resource-realization.logical-resource' }>[]
  acquisitionProfiles: readonly Extract<ProjectionNode, { kind: 'resource-realization.acquisition-profile' }>[]
  deliveryTargets: readonly Extract<ProjectionNode, { kind: 'resource-realization.delivery-target' }>[]
  variants: readonly Extract<ProjectionNode, { kind: 'resource-realization.variant' }>[]
  deliveryArtifacts: readonly Extract<ProjectionNode, { kind: 'resource-realization.delivery-artifact' }>[]
  digest: string
}>

export type GameIrAcceptanceProjection = Readonly<{
  scenarios: readonly ProjectionNode[]
  invariants: readonly ProjectionNode[]
  evidenceRequirements: readonly ProjectionNode[]
  digest: string
}>

export type GameIrPublishedReader = Readonly<{
  foundationReadyReceipt: FoundationReadyReceipt
  readyReceipt: GameIrReadyReceipt
  candidate: GameIrCandidate
  modules: readonly GameIrModuleCandidate[]
  sourceMap: GameIrSourceMaps
  sourceMaps: GameIrSourceMaps
  dependencyGraph: GameIrDependencyGraph
  semanticEvidence: readonly GameIrSemanticEvidence[]
  manifest: GameIrManifest
  executionProjection: GameIrExecutionProjection
  resourceProjection: GameIrResourceProjection
  acceptanceProjection: GameIrAcceptanceProjection
  digests: Readonly<{
    candidate: string
    manifest: string
    dependencyGraph: string
    modules: Readonly<Record<GameIrModuleId, string>>
    sourceMaps: Readonly<Record<GameIrModuleId, string>>
    evidence: string
    closure: string
  }>
}>

export type GameIrSourceMap = Readonly<{
  schemaVersion: 'game-ir-source-map.v1'
  foundationRevision: string
  moduleId: GameIrModuleId
  bindings: readonly Readonly<{ nodeId: string; pointer: string; binding: GameIrSourceBinding }>[]
}>
export type GameIrSourceMaps = Readonly<Record<GameIrModuleId, GameIrSourceMap>>
export type GameIrDependencyGraph = Readonly<{
  schemaVersion: 'game-ir-dependency-graph.v1'
  foundationRevision: string
  edges: readonly Readonly<{ kind: string; type?: string; from: string; to: string; targetType?: string }>[]
}>
export type GameIrSemanticEvidence = Readonly<{
  phase: string
  moduleId: GameIrModuleId
  sourceDigest: string
  mechanicalReceiptDigest: string
  semanticReceiptDigest: string
  semanticValidationResultDigest?: string
  projectionDigest: string
}>
export type GameIrManifest = Readonly<{
  schemaVersion: 'game-ir-manifest.v1'
  gameIrSchemaVersion: 'game-ir.v1'
  publicationId: string
  foundationRevision: string
  foundationReceiptDigest: string
  compileRequestDigest: string
  compileRequest: ReturnType<typeof parseGameIrCompileRequest>
  candidateDigest: string
  semanticEvidence: readonly GameIrSemanticEvidence[]
  modules: readonly Readonly<{ moduleId: GameIrModuleId; path: string; digest: string; sourceMapPath: string; sourceMapDigest: string }>[]
  dependencyGraphPath: string
  dependencyGraphDigest: string
}>

const SHA256 = /^[a-f0-9]{64}$/

const textValue = z.string().min(1)
const textArray = z.array(textValue)
const implementationTargetValueSchema = z.object({
  label: textValue,
  runtime: textValue,
  platforms: textArray,
  projectRoots: textArray,
}).strict()
const implementationUnitValueSchema = z.object({
  label: textValue,
  responsibility: textValue,
  ownedPaths: textArray,
}).strict()
const implementationScenarioValueSchema = z.object({
  label: textValue,
  precondition: textValue,
  action: textValue,
  expectedOutcome: textValue,
}).strict()
const implementationInvariantValueSchema = z.object({
  label: textValue,
  assertion: textValue,
  scope: z.enum(['runtime', 'state', 'numeric', 'resource', 'persistence']),
}).strict()
const implementationEvidenceValueSchema = z.object({
  label: textValue,
  kind: z.enum(['unit-test', 'integration-test', 'build', 'runtime-observation', 'visual-observation', 'audio-observation', 'file-inspection']),
  expected: textValue,
  artifactPaths: textArray.optional(),
}).strict()

const resourceLogicalValueSchema = z.object({
  requirementId: textValue,
  resourceKind: z.enum(['model', 'mesh', 'material', 'texture', 'rig', 'animation', 'audio', 'music', 'vfx', 'shader', 'ui-asset', 'font', 'scene', 'prefab', 'content', 'config']),
  runtimeRole: textValue,
}).strict()
const resourceSourcingPolicySchema = z.object({
  allowedSourceKinds: textArray,
  licenseConstraints: textArray,
  responsibleParty: textValue,
  handoffCriteria: textArray,
}).strict()
const resourceCoverageSchema = z.object({
  assetKinds: textArray.optional(),
  usageTags: textArray.optional(),
  capabilities: textArray.optional(),
  relationKinds: textArray.optional(),
  embeddedKinds: textArray.optional(),
}).strict()
const resourceAcquisitionValueSchema = z.object({
  required: z.boolean(),
  dimensions: textArray,
  assetKinds: textArray,
  usageTags: textArray,
  capabilities: textArray,
  styles: textArray,
  sourcingPolicy: resourceSourcingPolicySchema,
  name: textValue.optional(),
  purpose: textValue.optional(),
  coverage: z.array(resourceCoverageSchema).optional(),
}).strict()
const resourceDeliveryTargetValueSchema = z.object({
  assetFormatCapabilities: textArray,
  platform: textValue.optional(),
  runtime: textValue.optional(),
}).strict()
const resourceVariantValueSchema = z.object({
  activation: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('required') }).strict(),
    z.object({ kind: z.literal('alternative'), groupId: textValue }).strict(),
    z.object({
      kind: z.literal('conditional'),
      predicate: z.object({
        field: z.enum(['platform', 'runtime', 'asset-format-capability']),
        operator: z.enum(['eq', 'contains']),
        value: textValue,
      }).strict(),
    }).strict(),
  ]),
}).strict()
const resourceAssertionSchema = z.object({
  operator: z.enum(['eq', 'lte', 'gte', 'range', 'one-of']),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  values: z.array(z.union([z.string(), z.number()])).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  unit: textValue.optional(),
}).strict()
const resourceArtifactValueSchema = z.object({
  artifactClass: z.enum(['runtime-resource', 'content-definition', 'generated-output']),
  path: textValue,
  format: textValue,
  runtimeRole: textValue,
  codec: textValue.optional(),
  technicalConstraints: z.array(z.object({ name: textValue, assertion: resourceAssertionSchema }).strict()).optional(),
  budgets: z.array(z.object({ metric: textValue, limit: z.number(), unit: textValue }).strict()).optional(),
}).strict()

const projectionPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('implementation-verification.target'), value: implementationTargetValueSchema }).strict(),
  z.object({ kind: z.literal('implementation-verification.unit'), value: implementationUnitValueSchema }).strict(),
  z.object({ kind: z.literal('implementation-verification.acceptance-scenario'), value: implementationScenarioValueSchema }).strict(),
  z.object({ kind: z.literal('implementation-verification.invariant'), value: implementationInvariantValueSchema }).strict(),
  z.object({ kind: z.literal('implementation-verification.evidence-requirement'), value: implementationEvidenceValueSchema }).strict(),
  z.object({ kind: z.literal('resource-realization.logical-resource'), value: resourceLogicalValueSchema }).strict(),
  z.object({ kind: z.literal('resource-realization.acquisition-profile'), value: resourceAcquisitionValueSchema }).strict(),
  z.object({ kind: z.literal('resource-realization.delivery-target'), value: resourceDeliveryTargetValueSchema }).strict(),
  z.object({ kind: z.literal('resource-realization.variant'), value: resourceVariantValueSchema }).strict(),
  z.object({ kind: z.literal('resource-realization.delivery-artifact'), value: resourceArtifactValueSchema }).strict(),
])

function fail(message: string): never {
  throw new Error(`invalid committed Game IR: ${message}`)
}

function record(value: unknown, label: string): RecordValue {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail(`${label} must be a plain object`)
  return value as RecordValue
}

function exact(value: RecordValue, keys: readonly string[], label: string): void {
  const actual = Reflect.ownKeys(value)
  if (actual.some(key => typeof key !== 'string')) fail(`${label} has a symbol key`)
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
      fail(`${label} has a hidden or accessor property`)
  }
  const sorted = (actual as string[]).sort(compareCodeUnits)
  const expected = [...keys].sort(compareCodeUnits)
  if (
    sorted.length !== expected.length ||
    sorted.some((key, index) => key !== expected[index])
  )
    fail(`${label} has unknown or missing fields`)
}

function digestBytes(bytes: string): string {
  return createHash('sha256').update(bytes, 'utf8').digest('hex')
}

function sha(value: unknown, label: string): string {
  const digest = typeof value === 'string' ? value : ''
  if (!SHA256.test(digest)) fail(`${label} must be a SHA-256 digest`)
  return digest
}

function same(left: unknown, right: unknown, label: string): void {
  if (canonicalGameIrJson(left) !== canonicalGameIrJson(right))
    fail(`${label} mismatch`)
}

async function readJson(root: string, path: string, label: string): Promise<RecordValue> {
  try {
    return record(JSON.parse(await readSecureWorkspaceFile(root, path)), label)
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${label} is not valid JSON`)
    throw error
  }
}

function sourceMap(module: GameIrModuleCandidate, revision: string): GameIrSourceMap {
  return {
    schemaVersion: 'game-ir-source-map.v1',
    foundationRevision: revision,
    moduleId: module.moduleId,
    bindings: module.nodes.flatMap(node =>
      Object.keys(node.bindings)
        .sort(compareCodeUnits)
        .map(pointer => ({ nodeId: node.id, pointer, binding: node.bindings[pointer] })),
    ),
  } as GameIrSourceMap
}

function dependencyGraph(candidate: GameIrCandidate): GameIrDependencyGraph {
  const edges = candidate.modules.flatMap(module =>
    module.nodes.flatMap(node => [
      ...Object.entries(node.bindings).flatMap(([pointer, binding]) =>
        binding.kind === 'derived'
          ? binding.inputs.map(input => ({
              kind: 'derived',
              from: `${module.moduleId}/${node.id}${pointer}`,
              to:
                input.kind === 'local'
                  ? `${module.moduleId}/${node.id}${input.pointer}`
                  : `${input.moduleId}/${input.nodeId}${input.pointer}`,
            }))
          : [],
      ),
      ...node.references.map(reference => ({
        kind: 'reference',
        type: 'reference',
        from: `${module.moduleId}/${node.id}`,
        to: reference.targetId,
        targetType: reference.targetType,
      })),
      ...node.edges.map(edge => ({
        kind: 'relationship',
        type: edge.type,
        from: `${module.moduleId}/${node.id}`,
        to: edge.targetId,
        targetType: edge.targetType,
      })),
    ]),
  )
  edges.sort((left, right) => compareCodeUnits(canonicalGameIrJson(left), canonicalGameIrJson(right)))
  return { schemaVersion: 'game-ir-dependency-graph.v1', foundationRevision: candidate.foundationRevision, edges }
}

type ProjectionKind = ProjectionPayload['kind']
type ProjectionValue<K extends ProjectionKind> = Extract<ProjectionPayload, { kind: K }>['value']

function projectionValue<K extends ProjectionKind>(kind: K, value: unknown): ProjectionValue<K> {
  const parsed = projectionPayloadSchema.parse({ kind, value })
  if (parsed.kind !== kind) fail(`projection kind ${kind} does not match its value`)
  return parsed.value as ProjectionValue<K>
}

function nodesOf<K extends ProjectionKind>(module: GameIrModuleCandidate, kind: K): readonly Extract<ProjectionNode, { kind: K }>[] {
  const values = Object.freeze(
    module.nodes
      .filter(node => node.kind === kind)
      .map(node =>
        Object.freeze({
          id: node.id,
          kind,
          producerMode: node.producerMode,
          references: Object.freeze(node.references.map(reference => Object.freeze({ ...reference }))),
          edges: Object.freeze(node.edges.map(edge => Object.freeze({ ...edge }))),
          bindings: Object.freeze({ ...node.bindings }),
          payload: Object.freeze({ kind, value: projectionValue(kind, node.value) }),
        }) as ProjectionNode,
      ),
  )
  return values as readonly Extract<ProjectionNode, { kind: K }>[]
}

function projections(candidate: GameIrCandidate): Pick<GameIrPublishedReader, 'executionProjection' | 'resourceProjection' | 'acceptanceProjection'> {
  const execution = candidate.modules.find(module => module.moduleId === 'implementation-verification')
  const resource = candidate.modules.find(module => module.moduleId === 'resource-realization')
  if (!execution || !resource) fail('typed projection module is missing')
  const units = nodesOf(execution, 'implementation-verification.unit')
  const scenarios = nodesOf(execution, 'implementation-verification.acceptance-scenario')
  const invariants = nodesOf(execution, 'implementation-verification.invariant')
  const evidenceRequirements = nodesOf(execution, 'implementation-verification.evidence-requirement')
  const executionProjection = Object.freeze({
    moduleId: 'implementation-verification' as const,
    units,
    scenarios,
    invariants,
    evidenceRequirements,
    digest: digestGameIrValue({ units, scenarios, invariants, evidenceRequirements }),
  })
  const logicalResources = nodesOf(resource, 'resource-realization.logical-resource')
  const acquisitionProfiles = nodesOf(resource, 'resource-realization.acquisition-profile')
  const deliveryTargets = nodesOf(resource, 'resource-realization.delivery-target')
  const variants = nodesOf(resource, 'resource-realization.variant')
  const deliveryArtifacts = nodesOf(resource, 'resource-realization.delivery-artifact')
  const resourceProjection = Object.freeze({
    moduleId: 'resource-realization' as const,
    logicalResources,
    acquisitionProfiles,
    deliveryTargets,
    variants,
    deliveryArtifacts,
    digest: digestGameIrValue({ logicalResources, acquisitionProfiles, deliveryTargets, variants, deliveryArtifacts }),
  })
  const acceptanceProjection = Object.freeze({
    scenarios,
    invariants,
    evidenceRequirements,
    digest: digestGameIrValue({ scenarios, invariants, evidenceRequirements }),
  })
  return { executionProjection, resourceProjection, acceptanceProjection }
}

function validateSemanticEvidence(value: unknown, authority: NonNullable<GameIrReplayAuthority['phase7Authority']>, closure: ReturnType<typeof assembleImplementationVerificationClosure>): readonly RecordValue[] {
  if (!Array.isArray(value)) fail('manifest semanticEvidence must be an array')
  const expected = new Map<string, RecordValue>()
  const phase4 = authority.phase6Authority.phase5Authority.phase4Authority
  const phase4Closure = closure.phase6.phase5.phase4
  const phase5 = authority.phase6Authority.phase5Authority
  const phase5Closure = closure.phase6.phase5
  const phase6 = authority.phase6Authority
  const phase6Closure = closure.phase6
  const entries = [
    ['phase4', 'balance', phase4.balance.source.sourceDigest, phase4.balance.mechanical.receiptDigest, phase4.balance.semantic.receiptDigest, phase4Closure.balance.projectionDigest],
    ['phase4', 'gameplay', phase4.gameplay.source.sourceDigest, phase4.gameplay.mechanical.receiptDigest, phase4.gameplay.semantic.receiptDigest, phase4Closure.gameplay.projectionDigest],
    ['phase7', 'implementation-verification', authority.implementationVerification.source.sourceDigest, authority.implementationVerification.mechanical.receiptDigest, authority.implementationVerification.semantic.receiptDigest, closure.implementationVerification.semanticValidationResultDigest, closure.implementationVerification.projectionDigest],
    ['phase5', 'presentation', phase5.presentation.source.sourceDigest, phase5.presentation.mechanical.receiptDigest, phase5.presentation.semantic.receiptDigest, digestGameIrValue(phase5.presentation.validation), phase5Closure.presentation.projectionDigest],
    ['phase6', 'resource-realization', phase6.resourceRealization.source.sourceDigest, phase6.resourceRealization.mechanical.receiptDigest, phase6.resourceRealization.semantic.receiptDigest, digestGameIrValue(phase6.resourceRealization.validation), phase6Closure.resourceRealization.projectionDigest],
    ['phase5', 'world-scene', phase5.worldScene.source.sourceDigest, phase5.worldScene.mechanical.receiptDigest, phase5.worldScene.semantic.receiptDigest, digestGameIrValue(phase5.worldScene.validation), phase5Closure.worldScene.projectionDigest],
  ] as const
  for (const entry of entries) {
    const [phase, moduleId, sourceDigest, mechanicalReceiptDigest, semanticReceiptDigest, ...rest] = entry
    const valueObject: RecordValue = { phase, moduleId, sourceDigest, mechanicalReceiptDigest, semanticReceiptDigest }
    if (phase !== 'phase4') valueObject.semanticValidationResultDigest = rest.shift()
    valueObject.projectionDigest = rest[0]
    expected.set(moduleId, valueObject)
  }
  const actual = value.map((item, index) => {
    const candidate = record(item, `manifest semanticEvidence[${index}]`)
    exact(candidate, Object.keys(candidate), `manifest semanticEvidence[${index}]`)
    if (typeof candidate.moduleId !== 'string' || !expected.has(candidate.moduleId)) fail('manifest semanticEvidence has an unknown module')
    const canonical = expected.get(candidate.moduleId)!
    exact(candidate, Object.keys(canonical), `manifest semanticEvidence[${index}]`)
    same(candidate, canonical, `semantic evidence for ${candidate.moduleId}`)
    return candidate
  })
  if (actual.length !== GAME_IR_CANONICAL_MODULE_IDS.length || new Set(actual.map(item => item.moduleId)).size !== actual.length)
    fail('manifest semanticEvidence must cover each module exactly once')
  return Object.freeze(actual)
}

function assertIdentity(run: DeliveryRun, request: ReturnType<typeof parseGameIrCompileRequest>, receipt: FoundationReadyReceipt): void {
  const state = run.gameIrState
  if (!state || state.status !== 'ready') fail('DeliveryRun must point to a committed ready Game IR')
  const identity = state.identity
  if (identity.runId !== run.runId || identity.taskId !== request.taskId || identity.publicationId !== request.publicationId || identity.confirmedBriefDigest !== run.confirmedBriefDigest || identity.foundationRevision !== receipt.foundationRevision || identity.foundationReadyReceiptDigest !== receipt.receiptDigest)
    fail('DeliveryRun and committed Game IR identities do not match')
  if (digestGameIrValue(request.foundation) !== digestGameIrValue(receipt)) fail('compile request Foundation READY receipt mismatch')
  if (state.readyReceiptDigest !== digestGameIrValue(state.readyReceipt)) fail('DeliveryRun ready receipt digest mismatch')
}

export async function readCommittedGameIr(input: { workspacePath: string; deliveryRun: DeliveryRun }): Promise<Readonly<GameIrPublishedReader>> {
  const keys = Object.keys(input).sort()
  if (keys.length !== 2 || keys[0] !== 'deliveryRun' || keys[1] !== 'workspacePath') fail('reader accepts only workspacePath and deliveryRun')
  const run = input.deliveryRun
  if (!run || typeof run !== 'object') fail('DeliveryRun is required')
  const state = run.gameIrState
  if (!state || state.status !== 'ready') fail('DeliveryRun must contain ready Game IR state')
  if (run.phase !== 'DOCUMENT_REVIEW' || run.documentStep !== 'CHECKLIST_DRAFTING') fail('committed Game IR reader requires Checklist drafting boundary')
  if (!run.foundationAuditState) fail('Foundation READY state is missing')
  const foundationReadyReceipt = projectFoundationReadyReceipt({ state: run.foundationAuditState, projectId: run.projectId, confirmedBriefDigest: run.confirmedBriefDigest })
  const replay = await new GameIrStageCheckpointLoader().load({ workspacePath: input.workspacePath, deliveryRun: run })
  const phase7Authority = replay.phase7Authority
  if (!phase7Authority) fail('checkpoint does not contain the complete Phase 7 authority')
  const source = phase7Authority.implementationVerification.source
  const request = parseGameIrCompileRequest(source.compileRequest)
  assertIdentity(run, request, foundationReadyReceipt)
  if (request.publicationId !== state.identity.publicationId) fail('publication identity mismatch')
  const readyReceipt = await validateCommittedGameIr({ workspacePath: input.workspacePath, publicationId: state.identity.publicationId, phase7Authority } satisfies GameIrPublicationAuthority)
  if (digestGameIrValue(readyReceipt) !== state.readyReceiptDigest) fail('committed READY receipt digest mismatch')
  parseGameIrReadyReceipt(readyReceipt)
  const root = resolve(input.workspacePath, readyReceipt.committedPath, '..')
  const manifest = await readJson(root, 'manifest.json', 'manifest')
  exact(manifest, ['schemaVersion', 'gameIrSchemaVersion', 'publicationId', 'foundationRevision', 'foundationReceiptDigest', 'compileRequestDigest', 'compileRequest', 'candidateDigest', 'semanticEvidence', 'modules', 'dependencyGraphPath', 'dependencyGraphDigest'], 'manifest')
  if (manifest.schemaVersion !== 'game-ir-manifest.v1' || manifest.gameIrSchemaVersion !== 'game-ir.v1' || manifest.publicationId !== request.publicationId || manifest.foundationRevision !== request.foundation.foundationRevision || manifest.foundationReceiptDigest !== request.foundation.receiptDigest) fail('manifest identity mismatch')
  if (manifest.compileRequestDigest !== digestBytes(canonicalGameIrJson(request))) fail('manifest compile request digest mismatch')
  same(manifest.compileRequest, request, 'manifest compile request')
  const moduleEntries = manifest.modules
  if (!Array.isArray(moduleEntries) || moduleEntries.length !== GAME_IR_CANONICAL_MODULE_IDS.length) fail('manifest must contain exactly six modules')
  const sectionIndex = source.authoritySectionIndex
  const modules: GameIrModuleCandidate[] = []
  const moduleDigests: Record<string, string> = {}
  const sourceMapDigests: Record<string, string> = {}
  const sourceMaps: Partial<Record<GameIrModuleId, GameIrSourceMap>> = {}
  const rawModules: Array<Readonly<{ moduleId: string; nodes: unknown }>> = []
  for (const [index, raw] of moduleEntries.entries()) {
    const entry = record(raw, `manifest module[${index}]`)
    exact(entry, ['moduleId', 'path', 'digest', 'sourceMapPath', 'sourceMapDigest'], `manifest module[${index}]`)
    if (typeof entry.moduleId !== 'string' || !GAME_IR_CANONICAL_MODULE_IDS.includes(entry.moduleId as never)) fail('manifest module is not canonical')
    const moduleFile = await readJson(root, String(entry.path), `module ${entry.moduleId}`)
    exact(moduleFile, ['schemaVersion', 'foundationRevision', 'moduleId', 'candidateDigest', 'nodes'], `module ${entry.moduleId}`)
    if (moduleFile.schemaVersion !== 'game-ir-module.v1' || moduleFile.moduleId !== entry.moduleId || moduleFile.foundationRevision !== request.foundation.foundationRevision) fail(`module ${entry.moduleId} identity mismatch`)
    const moduleBytes = canonicalGameIrJson(moduleFile) + '\n'
    const moduleDigest = digestBytes(moduleBytes)
    if (moduleDigest !== entry.digest || moduleDigest !== readyReceipt.moduleDigests[entry.moduleId as keyof typeof readyReceipt.moduleDigests]) fail(`module ${entry.moduleId} digest mismatch`)
    const parsed = parseGameIrModuleCandidate({ moduleId: entry.moduleId, nodes: moduleFile.nodes }, { request, sections: sectionIndex, externalModules: rawModules })
    modules.push(parsed)
    rawModules.push({ moduleId: entry.moduleId, nodes: moduleFile.nodes })
    moduleDigests[entry.moduleId] = moduleDigest
    const source = await readJson(root, String(entry.sourceMapPath), `source map ${entry.moduleId}`)
    exact(source, ['schemaVersion', 'foundationRevision', 'moduleId', 'bindings'], `source map ${entry.moduleId}`)
    const sourceBytes = canonicalGameIrJson(source) + '\n'
    const sourceDigest = digestBytes(sourceBytes)
    if (sourceDigest !== entry.sourceMapDigest || sourceDigest !== readyReceipt.sourceMapDigests[entry.moduleId as keyof typeof readyReceipt.sourceMapDigests]) fail(`source map ${entry.moduleId} digest mismatch`)
    same(source, sourceMap(parsed, request.foundation.foundationRevision), `source map ${entry.moduleId}`)
    sourceMaps[entry.moduleId as GameIrModuleId] = sourceMap(parsed, request.foundation.foundationRevision)
    sourceMapDigests[entry.moduleId] = sourceDigest
  }
  const ordered = modules.map(module => module.moduleId)
  same(ordered, GAME_IR_CANONICAL_MODULE_IDS, 'module order or coverage')
  const candidate = parseGameIrCandidate({ schemaVersion: 'game-ir.v1', taskId: request.taskId, foundationRevision: request.foundation.foundationRevision, modules: rawModules }, { request, sections: sectionIndex })
  const candidateDigest = digestGameIrValue(candidate)
  if (candidateDigest !== manifest.candidateDigest) fail('candidate digest mismatch')
  const closure = assembleImplementationVerificationClosure(phase7Authority)
  if (candidateDigest !== closure.candidateDigest) fail('candidate is detached from checkpoint closure')
  const dependency = await readJson(root, String(manifest.dependencyGraphPath), 'dependency graph')
  exact(dependency, ['schemaVersion', 'foundationRevision', 'edges'], 'dependency graph')
  const dependencyBytes = canonicalGameIrJson(dependency) + '\n'
  const dependencyDigest = digestBytes(dependencyBytes)
  if (dependencyDigest !== manifest.dependencyGraphDigest || dependencyDigest !== readyReceipt.dependencyGraphDigest) fail('dependency graph digest mismatch')
  same(dependency, dependencyGraph(candidate), 'dependency graph')
  const semanticEvidence = validateSemanticEvidence(manifest.semanticEvidence, phase7Authority, closure)
  const marker = await readJson(root, 'COMMITTED.json', 'COMMITTED marker')
  exact(marker, ['schemaVersion', 'status', 'authorityDigest', 'manifestDigest', 'candidateDigest', 'compileRequestDigest', 'publicationId', 'foundationRevision', 'foundationReceiptDigest', 'moduleDigests', 'sourceMapDigests', 'dependencyGraphDigest'], 'COMMITTED marker')
  if (marker.schemaVersion !== 'game-ir-commit.v1' || marker.status !== 'committed' || marker.manifestDigest !== readyReceipt.manifestDigest || marker.candidateDigest !== candidateDigest || marker.compileRequestDigest !== manifest.compileRequestDigest || marker.publicationId !== request.publicationId || marker.foundationRevision !== request.foundation.foundationRevision || marker.foundationReceiptDigest !== request.foundation.receiptDigest || digestGameIrValue(marker.moduleDigests) !== digestGameIrValue(moduleDigests) || digestGameIrValue(marker.sourceMapDigests) !== digestGameIrValue(sourceMapDigests) || marker.dependencyGraphDigest !== dependencyDigest) fail('COMMITTED marker mismatch')
  const projectionValues = projections(candidate)
  const typedSourceMaps: Record<GameIrModuleId, GameIrSourceMap> = {
    gameplay: sourceMaps.gameplay!,
    balance: sourceMaps.balance!,
    'world-scene': sourceMaps['world-scene']!,
    presentation: sourceMaps.presentation!,
    'resource-realization': sourceMaps['resource-realization']!,
    'implementation-verification': sourceMaps['implementation-verification']!,
  }
  const typedManifest: GameIrManifest = {
    schemaVersion: 'game-ir-manifest.v1',
    gameIrSchemaVersion: 'game-ir.v1',
    publicationId: manifest.publicationId as string,
    foundationRevision: manifest.foundationRevision as string,
    foundationReceiptDigest: manifest.foundationReceiptDigest as string,
    compileRequestDigest: manifest.compileRequestDigest as string,
    compileRequest: request,
    candidateDigest: manifest.candidateDigest as string,
    semanticEvidence: semanticEvidence as readonly GameIrSemanticEvidence[],
    modules: moduleEntries.map(entry => {
      const item = record(entry, 'manifest module')
      return {
        moduleId: item.moduleId as GameIrModuleId,
        path: item.path as string,
        digest: item.digest as string,
        sourceMapPath: item.sourceMapPath as string,
        sourceMapDigest: item.sourceMapDigest as string,
      }
    }),
    dependencyGraphPath: manifest.dependencyGraphPath as string,
    dependencyGraphDigest: manifest.dependencyGraphDigest as string,
  }
  const evidenceDigest = digestGameIrValue(semanticEvidence)
  const closureDigest = digestGameIrValue({ candidateDigest, semanticEvidence, manifestDigest: readyReceipt.manifestDigest, dependencyGraphDigest: dependencyDigest })
  return Object.freeze({ foundationReadyReceipt, readyReceipt, candidate, modules: Object.freeze(modules), sourceMap: Object.freeze(typedSourceMaps), sourceMaps: Object.freeze(typedSourceMaps), dependencyGraph: dependency as GameIrDependencyGraph, semanticEvidence: semanticEvidence as readonly GameIrSemanticEvidence[], manifest: typedManifest, ...projectionValues, digests: Object.freeze({ candidate: candidateDigest, manifest: readyReceipt.manifestDigest, dependencyGraph: dependencyDigest, modules: Object.freeze(moduleDigests) as Readonly<Record<GameIrModuleId, string>>, sourceMaps: Object.freeze(sourceMapDigests) as Readonly<Record<GameIrModuleId, string>>, evidence: evidenceDigest, closure: closureDigest }) })
}
