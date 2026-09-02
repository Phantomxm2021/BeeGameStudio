import { randomUUID } from 'node:crypto'
import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { auditAssetContract } from './asset-contract-audit'
import { resolveWorkflowEvidencePath } from './delivery-workflow/evidence'
import {
  CANONICAL_ASSET_MANIFEST,
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENTS,
  type DeliveryWorkerPort,
  type DispatchRecord,
  type FoundationDocumentPath,
  type WorkerDispatchRequest,
} from './delivery-workflow/types'
import { atomicTaskPlannerTerminalSchema } from './delivery-workflow/worker-contracts'
import { implementationWorkerTerminalSchema } from './delivery-workflow/worker-contracts'
import {
  acceptanceValidatorTerminalSchema,
  changeImpactTerminalSchema,
  documentAuthorTerminalSchema,
  implementationAuditorTerminalSchema,
  questionAnswerTerminalSchema,
  resourceCuratorTerminalSchema,
  resourcePlannerTerminalSchema,
} from './delivery-workflow/worker-contracts'
import {
  buildFoundationFactStructuredOutputJsonSchema,
  foundationDocumentReviserTerminalSchema,
  foundationFactExtractorTerminalSchema,
  foundationFactModelPayloadSchema,
  foundationRevisionToolResultSchema,
  foundationSemanticModelPayloadSchema,
  foundationSemanticRecheckStructuredOutputJsonSchema,
  foundationSemanticRecheckTerminalSchema,
  foundationSemanticRecheckWorkerPayloadSchema,
  foundationSemanticReviewerTerminalSchema,
  foundationSemanticReviewerStructuredOutputJsonSchema,
  gameIrCompilerTerminalSchema,
  gameIrValidationStructuredOutputJsonSchema,
  parseGameIrCompilerModelPayload,
} from './delivery-workflow/worker-contracts'
import type {
  BeeGameSessionManager,
  BeeGameEvent,
  BeeGameSessionLanguage,
} from './session-manager'
import {
  selectFoundationFactFastRuntime,
  selectFoundationSemanticRuntime,
  WorkflowWorkerRebindError,
} from './session-manager'
import { mapModelConfigToRuntime } from '@bee-game-studio/agent-workflow'
import type { ResourceSelectionRuntimeConfig } from './resource-selection-config'
import {
  createResourceContentTerminalFromReceipt,
  readResourceContentCommitReceipt,
  resourceContentCommitContractSchema,
} from './native-resource-content-tool'
import { readCurrentCommittedResourceInventoryReceipt } from './resource-inventory-commit'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import { buildWorkerPrompt } from './delivery-workflow/worker-prompts'
import {
  foundationFactDefinition,
  isFoundationFactKey,
  type FoundationFactKey,
} from './delivery-workflow/foundation-fact-definitions'
import type { FoundationFactPacket } from './delivery-workflow/foundation-fact-extraction'
import {
  canonicalFoundationAuthorityProjectionBytes,
  foundationProjectionRelativePath,
  modelFoundationAuthorityProjectionBytes,
  projectFoundationAuthority,
  type FoundationAuthorityProjection,
} from './foundation-authority-projection'
import { buildChecklistAuthorityProjection } from './checklist-authority-projection'
import { canonicalGameIrJson } from './delivery-workflow/game-ir/model'
import { type GameIrProjectionModuleId } from './delivery-workflow/game-ir/projection-contract'
import {
  deriveProjectionSlicePlan,
  normalizeGameIrProjectionSliceContext,
  type GameIrProjectionSlice,
} from './delivery-workflow/game-ir/projection-slices'
import { parseGameIrProjectionRecordStream } from './delivery-workflow/game-ir/projection-record-stream'

type FoundationFactPacketContract = {
  keys: FoundationFactKey[]
  sections: Array<{
    documentPath: string
    sectionId: string
    startLine: number
    endLine: number
    digest: string
  }>
}

function foundationFactOwnerSection(
  packet: FoundationFactPacketContract,
  key: FoundationFactKey,
): FoundationFactPacketContract['sections'][number] {
  const definition = foundationFactDefinition(key)
  if (!definition)
    throw new Error(`foundation fact result has an unknown key: ${key}`)
  const section = packet.sections.find(
    candidate =>
      candidate.documentPath === definition.owner.documentPath &&
      candidate.sectionId === definition.owner.sectionId,
  )
  if (!section)
    throw new Error(`foundation fact packet owner section is missing: ${key}`)
  return section
}

function foundationFactEvidenceForPacket(
  packet: FoundationFactPacketContract,
  key: FoundationFactKey,
) {
  const { documentPath, sectionId, startLine, endLine, digest } =
    foundationFactOwnerSection(packet, key)
  return { documentPath, sectionId, startLine, endLine, digest }
}

function foundationFactPacketForRequest(
  request: WorkerDispatchRequest,
): FoundationFactPacketContract {
  const packet = request.contract.packet
  const keys =
    packet &&
    typeof packet === 'object' &&
    Array.isArray((packet as { keys?: unknown }).keys) &&
    (packet as { keys: unknown[] }).keys.every(
      key => typeof key === 'string' && isFoundationFactKey(key),
    )
      ? (packet as { keys: string[] }).keys
      : undefined
  const sections =
    packet &&
    typeof packet === 'object' &&
    Array.isArray((packet as { sections?: unknown }).sections) &&
    (packet as { sections: unknown[] }).sections.every(section => {
      if (!section || typeof section !== 'object') return false
      const value = section as Record<string, unknown>
      return (
        typeof value.documentPath === 'string' &&
        value.documentPath.length > 0 &&
        typeof value.sectionId === 'string' &&
        value.sectionId.length > 0 &&
        typeof value.startLine === 'number' &&
        Number.isInteger(value.startLine) &&
        value.startLine > 0 &&
        typeof value.endLine === 'number' &&
        Number.isInteger(value.endLine) &&
        value.endLine >= value.startLine &&
        typeof value.digest === 'string' &&
        /^[a-f0-9]{64}$/.test(value.digest)
      )
    })
  if (!keys || !sections)
    throw new Error('foundation fact extractor requires one complete packet')
  const completePacket = {
    keys: (packet as { keys: FoundationFactKey[] }).keys,
    sections: (packet as { sections: FoundationFactPacketContract['sections'] })
      .sections,
  }
  for (const key of completePacket.keys)
    foundationFactOwnerSection(completePacket, key)
  return completePacket
}

function foundationFactSchemaForRequest(
  request: WorkerDispatchRequest,
): Record<string, unknown> {
  const packet = foundationFactPacketForRequest(request)
  return buildFoundationFactStructuredOutputJsonSchema(
    packet as unknown as FoundationFactPacket,
  ) as unknown as Record<string, unknown>
}
import { documentAuthoringMetrics } from './document-authoring-metrics'
import { readAuthoredDocumentReceipt } from './authored-document-receipt'

export const FOUNDATION_WORKER_OUTPUT_MAX_BYTES = 2 * 1024 * 1024

function assertFoundationStructuredOutputWithinInfrastructureBoundary(
  value: unknown,
): void {
  const serialized = JSON.stringify(value)
  if (serialized === undefined)
    throw new Error('foundation structured output is not serializable')
  if (
    Buffer.byteLength(serialized, 'utf8') > FOUNDATION_WORKER_OUTPUT_MAX_BYTES
  ) {
    const error = new Error(
      `foundation structured output exceeds infrastructure boundary (${FOUNDATION_WORKER_OUTPUT_MAX_BYTES} bytes)`,
    )
    error.name = 'WorkerInfrastructureBoundaryError'
    throw error
  }
}

function taskTypeForWorker(
  workerType: WorkerDispatchRequest['workerType'],
): 'edit_turn' | 'agent_turn' {
  return workerType === 'document-author' ||
    workerType === 'resource-planner' ||
    workerType === 'resource-curator' ||
    workerType === 'resource-content-author' ||
    workerType === 'implementation-worker'
    ? 'edit_turn'
    : 'agent_turn'
}

function gameIrOperationForRequest(
  request: WorkerDispatchRequest,
): 'projection' | 'validation' {
  if (request.workerType !== 'game-ir-compiler')
    throw new Error('Game IR operation requested for a non-Game IR worker')
  if (
    request.contract.kind === 'projection' ||
    request.contract.kind === 'validation'
  )
    return request.contract.kind
  throw new Error(
    'Game IR worker requires one operation kind: projection or validation',
  )
}

function gameIrProjectionModuleForRequest(
  request: WorkerDispatchRequest,
): GameIrProjectionModuleId {
  if (request.workerType !== 'game-ir-compiler')
    throw new Error(
      'Game IR projection module requested for a non-Game IR worker',
    )
  const packet = request.contract.packet
  if (!packet || typeof packet !== 'object' || Array.isArray(packet))
    throw new Error('Game IR compiler requires one immutable operation packet')
  const source = (packet as Record<string, unknown>).source
  const projectionContract = (packet as Record<string, unknown>)
    .projectionContract
  if (
    !source ||
    typeof source !== 'object' ||
    Array.isArray(source) ||
    !projectionContract ||
    typeof projectionContract !== 'object' ||
    Array.isArray(projectionContract)
  )
    throw new Error(
      'Game IR operation packet is missing its schema-owned projection contract',
    )
  const moduleId = (source as Record<string, unknown>).moduleId
  const contractModuleId = (projectionContract as Record<string, unknown>)
    .moduleId
  if (
    moduleId !== contractModuleId ||
    ![
      'gameplay',
      'balance',
      'world-scene',
      'presentation',
      'resource-realization',
      'implementation-verification',
    ].includes(moduleId as string)
  )
    throw new Error('Game IR operation packet projection contract is detached')
  return moduleId as GameIrProjectionModuleId
}

function gameIrProjectionSliceForRequest(
  request: WorkerDispatchRequest,
): GameIrProjectionSlice {
  const moduleId = gameIrProjectionModuleForRequest(request)
  const candidate = request.contract.currentSlice
  const sliceId =
    typeof candidate === 'string'
      ? candidate
      : candidate &&
          typeof candidate === 'object' &&
          !Array.isArray(candidate) &&
          typeof (candidate as Record<string, unknown>).sliceId === 'string'
        ? (candidate as Record<string, unknown>).sliceId
        : undefined
  if (typeof sliceId !== 'string' || !sliceId)
    throw new Error(
      'Game IR projection request is missing its exact current slice',
    )
  const canonical = deriveProjectionSlicePlan(moduleId).slices.find(
    slice => slice.sliceId === sliceId,
  )
  if (!canonical)
    throw new Error('Game IR projection current slice is stale or detached')
  normalizeGameIrProjectionSliceContext({
    moduleId,
    sliceId,
    value: request.contract.sliceContext,
  })
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    const keys = Object.keys(candidate).sort()
    const nodeKinds = (candidate as Record<string, unknown>).nodeKinds
    const nodes = (candidate as Record<string, unknown>).nodes
    const exact =
      keys.length === 3 &&
      keys[0] === 'nodeKinds' &&
      keys[1] === 'nodes' &&
      keys[2] === 'sliceId'
    if (exact) {
      if (
        canonicalGameIrJson({ sliceId, nodeKinds, nodes }) !==
        canonicalGameIrJson(canonical)
      )
        throw new Error(
          'Game IR projection current slice contract is not canonical',
        )
    } else if (keys.length !== 1 || keys[0] !== 'sliceId') {
      throw new Error(
        'Game IR projection current slice contract is not canonical',
      )
    }
  }
  return canonical
}

function gameIrProjectionRecordStreamContract(request: WorkerDispatchRequest) {
  const slice = gameIrProjectionSliceForRequest(request)
  return {
    version: 1 as const,
    terminalRecord: { record: 'done', sliceId: slice.sliceId },
  }
}

function assertGameIrOperationRequest(
  request: WorkerDispatchRequest,
  dispatchId: string,
): void {
  const packet = request.contract.packet
  if (
    packet === null ||
    typeof packet !== 'object' ||
    Array.isArray(packet) ||
    (Object.getPrototypeOf(packet) !== Object.prototype &&
      Object.getPrototypeOf(packet) !== null)
  )
    throw new Error('Game IR operation packet is missing or invalid')
  if (!request.runId || !dispatchId || !request.taskId || !request.revision)
    throw new Error('Game IR compiler dispatch identity is incomplete')
  if (request.contract.kind === 'projection')
    gameIrProjectionSliceForRequest(request)
  for (const [label, value] of [
    ['compileRequestDigest', request.contract.compileRequestDigest],
    [
      'foundationReadyReceiptDigest',
      request.contract.foundationReadyReceiptDigest,
    ],
  ] as const)
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
      throw new Error(`Game IR compiler ${label} is invalid`)
}

type LiveGameIrProjectionSession = {
  sessionId: string
  packetDigest: string
  packet: Record<string, unknown>
  packetSent: boolean
}

function gameIrProjectionPacketDigest(request: WorkerDispatchRequest): string {
  const packet = request.contract.packet
  if (!packet || typeof packet !== 'object' || Array.isArray(packet))
    throw new Error('Game IR projection packet is missing')
  const packetDigest = (packet as Record<string, unknown>).packetDigest
  if (typeof packetDigest !== 'string' || !/^[a-f0-9]{64}$/.test(packetDigest))
    throw new Error('Game IR projection packet digest is invalid')
  return packetDigest
}

function gameIrProjectionSessionKey(
  request: WorkerDispatchRequest,
  packetDigest: string,
): string {
  return [
    request.runId,
    request.taskId ?? '',
    gameIrProjectionModuleForRequest(request),
    packetDigest,
  ].join('\0')
}

export async function buildDocumentAuthorAuthorityBlock(
  request: WorkerDispatchRequest,
  onProjection?: (projection: FoundationAuthorityProjection) => void,
): Promise<string> {
  if (request.workerType !== 'document-author') return ''
  if (
    request.contract.authoringMode === undefined &&
    request.contract.documentSet === 'checklist'
  ) {
    const targetPath = request.allowedPaths?.[0]
    if (
      typeof targetPath !== 'string' ||
      targetPath !== request.contract.checklistCandidatePath
    )
      throw new Error('checklist author target is invalid')
    if (typeof request.contract.approvedDocumentRevision !== 'string')
      throw new Error('checklist authority revision is missing')
    const projection = await buildChecklistAuthorityProjection({
      workspacePath: request.workspacePath,
      approvedDocumentRevision: request.contract.approvedDocumentRevision,
    })
    return [
      `Write the Checklist candidate only at ${targetPath}. The service will validate it and atomically publish it to ${String(request.contract.checklistCanonicalPath)} only when valid. A failed candidate is diagnostic-only and cannot become authority.`,
      projection,
    ].join('\n\n')
  }
  if (!isFoundationDocumentAuthoringTurn(request)) return ''
  const targetPath = request.contract.foundationDocumentPath
  if (
    typeof targetPath !== 'string' ||
    !CANONICAL_FOUNDATION_DOCUMENTS.includes(
      targetPath as (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
    )
  )
    throw new Error('initial document authority target is invalid')
  const upstreamPaths = Array.isArray(request.contract.availableUpstreamPaths)
    ? request.contract.availableUpstreamPaths
    : []
  if (
    new Set(upstreamPaths).size !== upstreamPaths.length ||
    upstreamPaths.some(
      path =>
        typeof path !== 'string' ||
        path === targetPath ||
        !CANONICAL_FOUNDATION_DOCUMENTS.includes(
          path as (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
        ),
    )
  )
    throw new Error('initial document upstream authority is invalid')

  const typedTargetPath =
    targetPath as (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]
  const expectedUpstreamPaths = getGameDocumentContract(
    typedTargetPath,
  ).upstreamSections.map(source => source.path)
  if (
    request.contract.authoringMode === 'initial' &&
    (upstreamPaths.length !== expectedUpstreamPaths.length ||
      expectedUpstreamPaths.some(
        (path, index) => upstreamPaths[index] !== path,
      ))
  )
    throw new Error(
      'initial document upstream authority does not match its contract',
    )
  let targetExists = true
  try {
    await access(resolve(request.workspacePath, targetPath))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') targetExists = false
    else throw error
  }
  await Promise.all(
    upstreamPaths.map(path => access(resolve(request.workspacePath, path))),
  )
  const dispatchId = request.dispatchId
  if (
    typeof dispatchId !== 'string' ||
    !dispatchId ||
    [...dispatchId].some(
      character =>
        !'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.includes(
          character,
        ),
    )
  )
    throw new Error(
      'initial document authority projection requires a dispatch identity',
    )
  const projectionRelativePath = foundationProjectionRelativePath(dispatchId)
  const projection = await persistFoundationAuthorityIndex({
    ...request,
    dispatchId,
  })
  onProjection?.(projection)
  return [
    upstreamPaths.length
      ? [
          'BGS projected the complete selected upstream authority below without summarization or rewriting. Use it as the upstream authority for this assignment.',
          `--- BEGIN FOUNDATION AUTHORITY ${projectionRelativePath} ---`,
          modelFoundationAuthorityProjectionBytes(projection).trimEnd(),
          `--- END FOUNDATION AUTHORITY ${projectionRelativePath} ---`,
        ].join('\n')
      : undefined,
    targetExists
      ? `An existing ${targetPath} is present, but this stream must return a complete replacement Markdown body from current authority.`
      : `The assigned target is ${targetPath}.`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

async function durableWriteProjection(
  path: string,
  content: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporary, 'w')
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

export function createBeeGameDeliveryWorkerPort(input: {
  sessions: BeeGameSessionManager
  userId: string
  getAuthToken?: (options?: {
    forceRefresh?: boolean
  }) => string | undefined | Promise<string | undefined>
  userDataRoot?: string
  modelConfigId?: string
  language?: BeeGameSessionLanguage
  resourceSelectionConfig?: ResourceSelectionRuntimeConfig
  confirmedBriefContext?: string
  getConfirmedBriefContext?: () => Promise<string | undefined>
}): DeliveryWorkerPort {
  const sessions = new Map<string, string>()
  const records = new Map<string, DispatchRecord>()
  const requests = new Map<string, WorkerDispatchRequest>()
  const documentAuthorityBlocks = new Map<string, string>()
  const documentAuthorityProjections = new Map<
    string,
    FoundationAuthorityProjection
  >()
  const eventOffsets = new Map<string, number>()
  const liveGameIrProjectionSessions = new Map<
    string,
    LiveGameIrProjectionSession
  >()
  const sessionEvents = (sessionId: string) =>
    typeof input.sessions.events === 'function'
      ? input.sessions.events(sessionId)
      : []
  const disposeWorkflowSession = async (sessionId: string) => {
    if (typeof input.sessions.disposeWorkflowWorker === 'function')
      await input.sessions.disposeWorkflowWorker(sessionId)
    else if (typeof input.sessions.stop === 'function')
      input.sessions.stop(sessionId)
  }
  return {
    async assertFoundationFactFastReady(request) {
      if (request.workerType !== 'foundation-fact-extractor') return
      const runtime = input.modelConfigId
        ? mapModelConfigToRuntime(input.modelConfigId)
        : undefined
      if (runtime) selectFoundationFactFastRuntime(runtime, runtime.env)
    },
    async assertFoundationSemanticModelReady(request) {
      if (request.workerType !== 'foundation-semantic-reviewer') return
      const tier = request.contract.modelTier
      if (tier !== 'fast' && tier !== 'balanced' && tier !== 'strong')
        throw new Error('foundation semantic model tier is missing')
      const runtime = input.modelConfigId
        ? mapModelConfigToRuntime(input.modelConfigId)
        : undefined
      if (runtime) selectFoundationSemanticRuntime(runtime, runtime.env, tier)
    },
    async start(request: WorkerDispatchRequest) {
      const dispatchId = request.dispatchId ?? randomUUID()
      if (
        request.workerType === 'game-ir-compiler' &&
        request.workflowJsonSchema !== undefined
      )
        throw new Error('Game IR StructuredOutput schema is service-owned')
      const gameIrOperation =
        request.workerType === 'game-ir-compiler'
          ? gameIrOperationForRequest(request)
          : undefined
      if (request.workerType === 'game-ir-compiler')
        assertGameIrOperationRequest(request, dispatchId)
      const packetWorker =
        request.workerType === 'foundation-fact-extractor' ||
        request.workerType === 'foundation-semantic-reviewer' ||
        request.workerType === 'game-ir-compiler'
      const revisionWorker =
        request.workerType === 'foundation-document-reviser'
      const requestedResumeSession = request.contract.resumeWorkerSessionId
      if (requestedResumeSession !== undefined)
        throw new Error('document author session resume is not supported')
      const documentAuthorityBlock =
        request.workerType === 'document-author' &&
        request.contract.documentSet === 'checklist'
          ? await buildDocumentAuthorAuthorityBlock(request)
          : ''
      if (request.workerType === 'atomic-task-planner') {
        await mkdir(join(request.workspacePath, '.beegame/workflow/evidence'), {
          recursive: true,
        })
      }
      const authToken = await input.getAuthToken?.()
      const projectionPacketDigest =
        gameIrOperation === 'projection'
          ? gameIrProjectionPacketDigest(request)
          : undefined
      const projectionKey =
        gameIrOperation === 'projection' && projectionPacketDigest
          ? gameIrProjectionSessionKey(request, projectionPacketDigest)
          : undefined
      let existingProjection = projectionKey
        ? liveGameIrProjectionSessions.get(projectionKey)
        : undefined
      let sessionId: string | undefined
      if (existingProjection) {
        const live = input.sessions.get(existingProjection.sessionId)
        if (!live || live.status !== 'running') {
          liveGameIrProjectionSessions.delete(projectionKey!)
          existingProjection = undefined
        } else {
          if (typeof input.sessions.rebindWorkflowWorker !== 'function')
            throw new Error('live Game IR projection session cannot be rebound')
          try {
            await input.sessions.rebindWorkflowWorker(
              existingProjection.sessionId,
              {
                runId: request.runId,
                dispatchId,
                workerType: request.workerType,
                workflowRecordStreamContract:
                  gameIrProjectionRecordStreamContract(request),
              },
            )
            sessionId = existingProjection.sessionId
          } catch (error) {
            // A schema-changing rebind is safe only when the native runner can
            // resume the existing context. If it cannot, retire the binding
            // and session before starting a fresh context that receives the
            // immutable packet again. Otherwise a failed rebind would leave
            // the live map pointing at a session the next dispatch cannot
            // safely reuse.
            const staleSessionId = existingProjection.sessionId
            await disposeWorkflowSession(staleSessionId)
            liveGameIrProjectionSessions.delete(projectionKey!)
            existingProjection = undefined
            if (
              !(error instanceof WorkflowWorkerRebindError) ||
              error.code !== 'native_resume_unavailable'
            )
              throw error
          }
        }
      }
      if (sessionId === undefined)
        sessionId = input.sessions.start({
          workspacePath: request.workspacePath,
          projectId: request.projectId,
          userId: input.userId,
          ...(authToken ? { authToken } : {}),
          ...(input.getAuthToken
            ? { getValidAuthToken: input.getAuthToken }
            : {}),
          ...(input.userDataRoot ? { userDataRoot: input.userDataRoot } : {}),
          ...(input.modelConfigId
            ? { modelConfigId: input.modelConfigId }
            : {}),
          ...(input.language ? { language: input.language } : {}),
          // Resource selection is a dedicated post-review capability. All
          // other workers consume the resulting manifest as read-only input.
          ...(request.workerType === 'resource-curator'
            ? { resourceSelectionConfig: input.resourceSelectionConfig }
            : {}),
          workflowWorker: true,
          workflowRunId: request.runId,
          workflowDispatchId: dispatchId,
          workflowWorkerType: request.workerType,
          ...(request.workerType === 'document-author' &&
          request.contract.documentSet === 'checklist'
            ? { workflowAllowedTools: ['Write', 'Edit'] }
            : {}),
          ...(request.contract.modelTier === 'fast' ||
          request.contract.modelTier === 'balanced' ||
          request.contract.modelTier === 'strong'
            ? { workflowModelTier: request.contract.modelTier }
            : {}),
          ...(request.workerType === 'foundation-document-reviser'
            ? { workflowRevisionContract: request.contract }
            : {}),
          workflowAllowedPaths: request.allowedPaths ?? [],
          ...(request.workerType === 'foundation-fact-extractor'
            ? {
                workflowJsonSchema:
                  request.workflowJsonSchema ??
                  foundationFactSchemaForRequest(request),
              }
            : request.workerType === 'foundation-semantic-reviewer'
              ? {
                  workflowJsonSchema:
                    request.workflowJsonSchema ??
                    ((typeof request.contract.issueId === 'string'
                      ? foundationSemanticRecheckStructuredOutputJsonSchema
                      : foundationSemanticReviewerStructuredOutputJsonSchema) as unknown as Record<
                      string,
                      unknown
                    >),
                }
              : request.workerType === 'game-ir-compiler'
                ? gameIrOperation === 'projection'
                  ? {
                      workflowRecordStreamContract:
                        gameIrProjectionRecordStreamContract(request),
                    }
                  : {
                      workflowJsonSchema:
                        gameIrValidationStructuredOutputJsonSchema as unknown as Record<
                          string,
                          unknown
                        >,
                    }
                : {}),
          ...(packetWorker
            ? { workflowProjectReadScope: 'empty' as const }
            : request.projectReadScope
              ? { workflowProjectReadScope: request.projectReadScope }
              : {}),
          ...(request.workerType !== 'resource-content-author' &&
          request.protectedPaths
            ? { workflowProtectedPaths: [...request.protectedPaths] }
            : {}),
          ...(request.workerType === 'resource-content-author'
            ? {
                workflowReadOnlyPaths: [
                  ...(Array.isArray(request.contract.authorityPaths)
                    ? request.contract.authorityPaths.filter(
                        (path): path is string => typeof path === 'string',
                      )
                    : []),
                  ...(Array.isArray(request.contract.repairPaths)
                    ? request.contract.repairPaths.filter(
                        (path): path is string => typeof path === 'string',
                      )
                    : []),
                ],
              }
            : {}),
          ...(isStreamedFoundationAuthoringTurn(request)
            ? {
                workflowMarkdownStreamContract: {
                  workspacePath: request.workspacePath,
                  runId: request.runId,
                  dispatchId,
                  targetPath: request.contract
                    .foundationDocumentPath as FoundationDocumentPath,
                  maxBytes: FOUNDATION_WORKER_OUTPUT_MAX_BYTES,
                },
              }
            : {}),
          ...(request.workerType === 'resource-content-author'
            ? {
                workflowResourceContentCommitContract:
                  resourceContentCommitContractSchema.parse({
                    dispatchId,
                    inventoryRevision: request.contract.inventoryRevision,
                    baselineResourceRevision:
                      request.contract.baselineResourceRevision,
                    requiredRequirementIds:
                      request.contract.requiredRequirementIds,
                    verifiedResourceIds: request.contract.verifiedResourceIds,
                    inventoryBindings: request.contract.inventoryBindings,
                    writablePaths: request.contract.repairPaths ?? [],
                  }),
              }
            : {}),
        }).id
      if (projectionKey && !existingProjection)
        liveGameIrProjectionSessions.set(projectionKey, {
          sessionId,
          packetDigest: projectionPacketDigest!,
          packet: request.contract.packet as Record<string, unknown>,
          packetSent: false,
        })
      sessions.set(dispatchId, sessionId)
      requests.set(dispatchId, { ...request, dispatchId })
      documentAuthorityBlocks.set(dispatchId, documentAuthorityBlock)
      eventOffsets.set(
        dispatchId,
        existingProjection && sessionId === existingProjection.sessionId
          ? sessionEvents(sessionId).length
          : 0,
      )
      records.set(dispatchId, {
        dispatchId,
        workerType: request.workerType,
        phase: request.phase,
        ...(request.taskId ? { taskId: request.taskId } : {}),
        revision: request.revision,
        status: 'running',
        startedAt: new Date().toISOString(),
      })
      return { sessionId, dispatchId }
    },
    async submit(dispatchId, prompt) {
      const sessionId = sessions.get(dispatchId)
      if (!sessionId) throw new Error('worker session is not registered')
      const authToken = await input.getAuthToken?.()
      input.sessions.updateAuthToken(sessionId, authToken)
      const request = requests.get(dispatchId)
      const packetWorker =
        request?.workerType === 'foundation-fact-extractor' ||
        request?.workerType === 'foundation-semantic-reviewer' ||
        request?.workerType === 'game-ir-compiler'
      const revisionWorker =
        request?.workerType === 'foundation-document-reviser'
      const confirmedBriefContext =
        packetWorker || revisionWorker
          ? undefined
          : (input.confirmedBriefContext ??
            (await input.getConfirmedBriefContext?.()))
      const languageInstruction = input.language
        ? `User-facing status language: ${input.language}. Write any status/message text in this language; keep structured tool enum values unchanged.`
        : ''
      const documentAuthorAuthorityBlock =
        documentAuthorityBlocks.get(dispatchId) ||
        (request
          ? await buildDocumentAuthorAuthorityBlock(request, projection =>
              documentAuthorityProjections.set(dispatchId, projection),
            )
          : '')
      const nativeToolAutonomyInstruction =
        request && request.workerType !== 'document-author'
          ? "Bee Game Studio's native tools, reasoning, permissions, context management, and normal completion behavior remain unchanged. Use native capabilities as needed to complete and verify this task."
          : ''
      const atomicTaskEvidenceInstruction =
        request?.workerType === 'atomic-task-planner'
          ? 'Submit the complete plan through SubmitAtomicTaskPlan exactly once. The workflow service persists the accepted plan as canonical evidence.'
          : ''
      const implementationResultInstruction =
        request?.workerType === 'implementation-worker'
          ? 'Submit the final result through SubmitImplementationResult exactly once. Validate the active contract and current project files; the workflow service owns task identity, revision, and canonical evidence persistence.'
          : ''
      const validationResultInstruction =
        request?.workerType === 'implementation-auditor' ||
        request?.workerType === 'acceptance-validator'
          ? 'Submit the final verdict through SubmitValidationResult exactly once. Do not author workflow evidence or return terminal JSON. The workflow service owns revision, complete contract ID coverage, and canonical evidence persistence.'
          : ''
      const workflowResultInstruction =
        request?.workerType === 'document-author'
          ? ''
          : request?.workerType === 'change-impact-analyzer'
            ? 'Submit the analysis through SubmitChangeImpactResult exactly once. Do not author workflow evidence or return terminal JSON.'
            : request?.workerType === 'question-answerer'
              ? 'Submit the answer through SubmitQuestionAnswerResult exactly once. Do not author workflow evidence or return terminal JSON.'
              : ''
      const revisionResultInstruction =
        request?.workerType === 'foundation-document-reviser'
          ? 'After editing only the assigned stage, call SubmitFoundationRevisionResult exactly once with status APPLIED and the exact changedSectionIds; do not return terminal JSON.'
          : ''
      const assetManifestInstruction =
        request?.workerType === 'resource-planner'
          ? 'Use AssetManifest submit_resource_plan as the only mutation and stop after it is accepted.'
          : request?.workerType === 'resource-curator'
            ? 'Use ResourceLibrary match_requirements once, then CommitResourceInventory as the only mutation and terminal operation.'
            : ''
      const liveProjection =
        request?.workerType === 'game-ir-compiler' &&
        request.contract.kind === 'projection' &&
        request.contract.packet
          ? liveGameIrProjectionSessions.get(
              gameIrProjectionSessionKey(
                request,
                gameIrProjectionPacketDigest(request),
              ),
            )
          : undefined
      const promptRequest =
        liveProjection?.packetSent && request
          ? (() => {
              const { packet: _packet, ...contractWithoutPacket } =
                request.contract
              return {
                ...request,
                contract: {
                  ...contractWithoutPacket,
                  packet: liveProjection.packet,
                  packetDigest: liveProjection.packetDigest,
                  currentSlice: gameIrProjectionSliceForRequest(request),
                },
              }
            })()
          : request
      const workerPrompt = [
        ...(packetWorker || revisionWorker ? [] : [languageInstruction]),
        ...(packetWorker || revisionWorker
          ? []
          : [confirmedBriefContext, documentAuthorAuthorityBlock]),
        (packetWorker || revisionWorker) &&
        promptRequest &&
        (Object.hasOwn(promptRequest.contract, 'packet') ||
          promptRequest.workerType === 'game-ir-compiler')
          ? buildWorkerPrompt(promptRequest)
          : prompt,
        ...(packetWorker || revisionWorker
          ? []
          : [
              nativeToolAutonomyInstruction,
              atomicTaskEvidenceInstruction,
              implementationResultInstruction,
              validationResultInstruction,
              workflowResultInstruction,
              revisionResultInstruction,
              assetManifestInstruction,
            ]),
      ]
        .filter(Boolean)
        .join('\n\n')
      await input.sessions.sendWithDisplay(sessionId, workerPrompt, {
        taskType: taskTypeForWorker(
          records.get(dispatchId)?.workerType ?? 'question-answerer',
        ),
        displayKind: 'workflow_worker',
        ...(!packetWorker && !revisionWorker && confirmedBriefContext
          ? { confirmedBriefContext }
          : {}),
        ...(authToken ? { authToken } : {}),
        ...(input.language ? { language: input.language } : {}),
      })
      if (liveProjection) liveProjection.packetSent = true
    },
    async stop(dispatchId, reason) {
      const sessionId = sessions.get(dispatchId)
      if (!sessionId) {
        await input.sessions.disposeWorkflowDispatch?.(dispatchId)
        return
      }
      input.sessions.stop(sessionId)
      records.set(dispatchId, {
        ...(records.get(dispatchId) ?? {
          dispatchId,
          workerType: 'question-answerer',
          phase: 'BRIEF_CONFIRMED',
          revision: 'unknown',
          startedAt: new Date().toISOString(),
        }),
        status: 'interrupted',
        finishedAt: new Date().toISOString(),
        terminalEvidencePath: reason,
      })
    },
    async close(dispatchId, options) {
      const sessionId = sessions.get(dispatchId)
      if (!sessionId) {
        await input.sessions.disposeWorkflowDispatch?.(dispatchId)
        return
      }
      try {
        if (!options?.preserveSession) {
          const session = input.sessions.get(sessionId)
          if (
            session?.status === 'running' &&
            typeof input.sessions.stop === 'function'
          )
            input.sessions.stop(sessionId)
          await disposeWorkflowSession(sessionId)
        }
      } finally {
        if (!options?.preserveSession) {
          for (const [key, live] of liveGameIrProjectionSessions)
            if (live.sessionId === sessionId)
              liveGameIrProjectionSessions.delete(key)
        }
        sessions.delete(dispatchId)
        records.delete(dispatchId)
        requests.delete(dispatchId)
        documentAuthorityBlocks.delete(dispatchId)
        documentAuthorityProjections.delete(dispatchId)
        eventOffsets.delete(dispatchId)
      }
    },
    async status(dispatchId) {
      const sessionId = sessions.get(dispatchId)
      const session = sessionId ? input.sessions.get(sessionId) : undefined
      const record = records.get(dispatchId)
      if (record)
        return {
          ...record,
          ...(session?.status === 'stopped'
            ? { status: 'interrupted' as const }
            : {}),
        }
      if (!session) throw new Error('worker session is not registered')
      return {
        dispatchId,
        workerType: 'question-answerer',
        phase: 'BRIEF_CONFIRMED',
        revision: 'unknown',
        status: session.turnStatus === 'running' ? 'running' : 'completed',
        startedAt: session.createdAt.toISOString(),
      }
    },
    async hasInFlightMutation(dispatchId) {
      const sessionId = sessions.get(dispatchId)
      if (!sessionId) return false
      return hasInFlightResourceMutation(input.sessions.events(sessionId))
    },
    async hasInFlightTerminalSubmission(dispatchId) {
      const sessionId = sessions.get(dispatchId)
      const request = requests.get(dispatchId)
      if (!sessionId || !request) return false
      const terminalToolName = structuredSubmissionToolName(request)
      if (!terminalToolName) return false
      return (
        Boolean(
          input.sessions.hasInFlightToolSubmission?.(
            sessionId,
            terminalToolName,
          ),
        ) ||
        hasInFlightTool(
          sessionEvents(sessionId).slice(eventOffsets.get(dispatchId) ?? 0),
          terminalToolName,
        )
      )
    },
    async waitForTerminal(dispatchId) {
      const sessionId = sessions.get(dispatchId)
      if (!sessionId) throw new Error('worker session is not registered')
      let closedTurnDrained = false
      // Recovery policy belongs to the dispatcher. A transport-level fixed
      // deadline would fail a worker that is still making durable progress.
      while (true) {
        const eventOffset = eventOffsets.get(dispatchId) ?? 0
        const events = sessionEvents(sessionId).slice(eventOffset)
        const request = requests.get(dispatchId)
        if (
          request?.workerType === 'game-ir-compiler' &&
          gameIrOperationForRequest(request) === 'validation'
        ) {
          const reason = lastFailedToolOutput(events, 'StructuredOutput')
          if (reason) {
            // StructuredOutput is the compiler's sole terminal channel. Admit
            // the service-bound failure before cancellation: stopping here can
            // reject the in-flight submit() first and race dispatcher admission.
            // The dispatcher closes the disposable session after this terminal
            // is persisted, so late native text cannot become a terminal.
            return createGameIrCompilerFailureTerminal({ request, reason })
          }
        }
        if (request?.workerType === 'resource-curator') {
          const receipt = await readCurrentCommittedResourceInventoryReceipt(
            request.workspacePath,
          )
          if (receipt) {
            const contract = auditAssetContract(request.workspacePath)
            return resourceCuratorTerminalSchema.parse({
              revision: request.revision,
              workerType: 'resource-curator',
              status: 'completed',
              catalogObserved: true,
              resourceIds: contract.resources.map(resource => resource.id),
              bindings: receipt.bindings,
              writtenPaths: [
                'assets/asset-manifest.json',
                ...contract.resources.flatMap(resource => resource.filePaths),
              ],
              taskMetrics: resourceTaskMetrics(events),
            })
          }
        }
        if (request?.workerType === 'resource-content-author') {
          const receipt = readResourceContentCommitReceipt(
            request.workspacePath,
            request.dispatchId ?? dispatchId,
          )
          if (receipt?.status === 'committed')
            return createResourceContentTerminalFromReceipt({
              workspacePath: request.workspacePath,
              revision: request.revision,
              receipt,
            })
          if (receipt?.status === 'prepared') {
            await new Promise(resolve => setTimeout(resolve, 250))
            continue
          }
        }
        // The accepted structured submission is durable workflow evidence, but
        // Bee Game Studio still owns its normal turn completion. Drain the native
        // turn before the workflow controller is allowed to close the session.
        if (request?.workerType === 'foundation-fact-extractor') {
          const factTerminal = createDeterministicFoundationFactTerminal({
            request,
            events,
          })
          if (factTerminal) return factTerminal
        }
        if (request && hasCompletedStructuredSubmission(request, events)) {
          if (typeof input.sessions.waitForWorkflowWorkerIdle === 'function')
            await input.sessions.waitForWorkflowWorkerIdle(sessionId)
          return createDeterministicStructuredTerminal({ request, events })
        }
        const result = [...events]
          .reverse()
          .find(
            event =>
              event.type === 'result' ||
              event.type === 'turn.failed' ||
              event.type === 'turn.empty',
          )
        if (result) {
          let terminalEvents = events
          if (
            result.type === 'result' &&
            request &&
            isStreamedFoundationAuthoringTurn(request)
          ) {
            if (typeof input.sessions.waitForWorkflowWorkerIdle === 'function')
              await input.sessions.waitForWorkflowWorkerIdle(sessionId)
            terminalEvents = sessionEvents(sessionId).slice(eventOffset)
          }
          const drainedFailure = [...terminalEvents]
            .reverse()
            .find(event => event.type === 'turn.failed')
          if (drainedFailure) {
            const error = new Error(
              drainedFailure.text || 'document author stream commit failed',
            )
            if (
              error.message.startsWith('foundation_transport_needs_action:') ||
              (request && isStreamedFoundationAuthoringTurn(request))
            )
              error.name = 'WorkerNeedsActionError'
            throw error
          }
          if (result.type === 'result' || result.type === 'turn.empty') {
            const missingTerminal = request
              ? missingStructuredTerminalError(request, events)
              : undefined
            if (missingTerminal) throw missingTerminal
          }
          if (result.type !== 'result') {
            const error = new Error(
              result.text || 'worker turn did not produce a terminal result',
            )
            if (error.message.startsWith('foundation_transport_needs_action:'))
              error.name = 'WorkerNeedsActionError'
            throw error
          }
          if (request?.workerType === 'resource-planner') {
            return createDeterministicResourcePlannerTerminal({
              request,
              events,
            })
          }
          if (request?.workerType === 'resource-curator')
            throw new Error(
              'resource curator completed without an accepted durable inventory receipt',
            )
          if (request?.workerType === 'resource-content-author')
            throw new Error(
              'resource content author completed without an accepted durable receipt',
            )
          if (request && isDocumentAuthor(request)) {
            const targetPath = request.allowedPaths?.[0]
            if (!targetPath)
              throw new Error('document author target is missing')
            if (isStreamedFoundationAuthoringTurn(request)) {
              const receipt = await readAuthoredDocumentReceipt(
                request.workspacePath,
                dispatchId,
              )
              if (
                receipt?.status !== 'committed' ||
                receipt.targetPath !== targetPath
              )
                throw new Error(
                  'document author completed without a committed Markdown stream receipt',
                )
              return createDeterministicDocumentAuthorTerminal(
                request,
                [receipt.targetPath],
                documentAuthoringMetrics(
                  sessionEvents(sessionId),
                  projectionMetrics(
                    documentAuthorityProjections.get(dispatchId),
                  ),
                ),
              )
            }
            let body: string
            try {
              body = await readFile(
                resolve(request.workspacePath, targetPath),
                'utf8',
              )
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                throw new Error(
                  `document author output is missing: ${targetPath}`,
                )
              throw error
            }
            if (!body.trim())
              throw new Error(
                `document author output is missing: ${targetPath}`,
              )
            if (typeof input.sessions.waitForWorkflowWorkerIdle === 'function')
              await input.sessions.waitForWorkflowWorkerIdle(sessionId)
            return createDeterministicDocumentAuthorTerminal(
              request,
              [targetPath],
              documentAuthoringMetrics(
                sessionEvents(sessionId),
                projectionMetrics(documentAuthorityProjections.get(dispatchId)),
              ),
            )
          }
          if (request)
            return createDeterministicStructuredTerminal({ request, events })
          throw new Error('worker has no structured terminal result channel')
        }
        if (
          typeof input.sessions.isWorkflowWorkerOpen === 'function' &&
          !input.sessions.isWorkflowWorkerOpen(dispatchId)
        ) {
          if (!closedTurnDrained) {
            if (typeof input.sessions.waitForWorkflowWorkerIdle === 'function')
              await input.sessions.waitForWorkflowWorkerIdle(sessionId)
            closedTurnDrained = true
            continue
          }
          const error = new Error(
            'worker stopped before producing a durable terminal result',
          )
          error.name = 'WorkerNeedsActionError'
          throw error
        }
        await new Promise(resolve => setTimeout(resolve, 250))
      }
    },
  }
}

function isDocumentAuthor(request: WorkerDispatchRequest): boolean {
  return request.workerType === 'document-author'
}

function isFoundationDocumentAuthoringTurn(
  request: WorkerDispatchRequest,
): boolean {
  return (
    request.workerType === 'document-author' &&
    ['initial', 'parallel-draft'].includes(
      String(request.contract.authoringMode),
    ) &&
    request.contract.documentSet === 'foundation' &&
    typeof request.contract.foundationDocumentPath === 'string' &&
    CANONICAL_FOUNDATION_DOCUMENTS.includes(
      request.contract.foundationDocumentPath as never,
    )
  )
}

function isStreamedFoundationAuthoringTurn(
  request: WorkerDispatchRequest,
): boolean {
  return (
    isFoundationDocumentAuthoringTurn(request) &&
    (request.contract.authoringMode === 'initial' ||
      request.contract.authoringMode === 'parallel-draft')
  )
}

async function persistFoundationAuthorityIndex(
  request: WorkerDispatchRequest,
): Promise<FoundationAuthorityProjection> {
  if (!isFoundationDocumentAuthoringTurn(request))
    throw new Error(
      'foundation authority index requires a document authoring turn',
    )
  const targetPath = request.contract.foundationDocumentPath as never
  const contract = getGameDocumentContract(targetPath)
  const availableUpstreamPaths = Array.isArray(
    request.contract.availableUpstreamPaths,
  )
    ? (request.contract.availableUpstreamPaths as FoundationDocumentPath[])
    : []
  const documents = new Map<
    (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
    string
  >()
  await Promise.all(
    contract.upstreamSections
      .filter(source => availableUpstreamPaths.includes(source.path))
      .map(async source => {
        documents.set(
          source.path,
          await readFile(resolve(request.workspacePath, source.path), 'utf8'),
        )
      }),
  )
  const projection = projectFoundationAuthority({
    targetPath,
    availableUpstreamPaths,
    documents,
  })
  const relativePath = foundationProjectionRelativePath(request.dispatchId!)
  await durableWriteProjection(
    resolve(request.workspacePath, relativePath),
    canonicalFoundationAuthorityProjectionBytes(projection),
  )
  return projection
}

function projectionMetrics(projection?: FoundationAuthorityProjection) {
  return projection
    ? {
        byteLength: projection.byteLength,
        rangeCount: projection.rangeCount,
        projectedLineCount: projection.projectedLineCount,
      }
    : undefined
}

function createDeterministicDocumentAuthorTerminal(
  request: WorkerDispatchRequest,
  writtenPaths: string[],
  authoringMetrics?: ReturnType<typeof documentAuthoringMetrics>,
) {
  if (!isDocumentAuthor(request))
    throw new Error('document author contract is invalid')
  return documentAuthorTerminalSchema.parse({
    workerType: 'document-author',
    status: 'completed',
    writtenPaths,
    resolvedFindingIds: [],
    ...(authoringMetrics ? { authoringMetrics } : {}),
  })
}

function structuredSubmissionToolName(
  request: WorkerDispatchRequest,
): string | undefined {
  switch (request.workerType) {
    case 'document-author':
      return undefined
    case 'atomic-task-planner':
      return 'SubmitAtomicTaskPlan'
    case 'implementation-worker':
      return 'SubmitImplementationResult'
    case 'foundation-document-reviser':
      return 'SubmitFoundationRevisionResult'
    case 'implementation-auditor':
    case 'acceptance-validator':
      return 'SubmitValidationResult'
    case 'change-impact-analyzer':
      return 'SubmitChangeImpactResult'
    case 'question-answerer':
      return 'SubmitQuestionAnswerResult'
    case 'resource-content-author':
      return undefined
    case 'game-ir-compiler':
      return undefined
    case 'resource-planner':
    case 'resource-curator':
      return undefined
  }
}

function hasCompletedStructuredSubmission(
  request: WorkerDispatchRequest,
  events: ReturnType<BeeGameSessionManager['events']>,
): boolean {
  const toolName = structuredSubmissionToolName(request)
  return Boolean(
    toolName &&
      events.some(
        event =>
          event.type === 'tool.completed' &&
          event.payload?.toolName === toolName,
      ),
  )
}

function missingStructuredTerminalError(
  request: WorkerDispatchRequest,
  events: ReturnType<BeeGameSessionManager['events']>,
): Error | undefined {
  const toolName = structuredSubmissionToolName(request)
  if (!toolName) return undefined
  if (
    events.some(
      event =>
        event.type === 'tool.failed' && event.payload?.toolName === toolName,
    )
  )
    return undefined
  const error = new Error(`missing_required_terminal_submission: ${toolName}`)
  error.name = 'WorkerNeedsActionError'
  return error
}

async function createDeterministicStructuredTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  switch (input.request.workerType) {
    case 'document-author':
      throw new Error(
        'canonical document completion must use its commit receipt',
      )
    case 'foundation-fact-extractor':
      return (
        createDeterministicFoundationFactTerminal(input) ??
        (() => {
          throw new Error(
            'worker terminal result is missing a valid StructuredOutput fact result',
          )
        })()
      )
    case 'foundation-semantic-reviewer':
      return (
        createDeterministicFoundationSemanticTerminal(input) ??
        (() => {
          throw new Error(
            'worker terminal result is missing a valid StructuredOutput semantic result',
          )
        })()
      )
    case 'foundation-document-reviser':
      return createDeterministicFoundationRevisionTerminal(input)
    case 'atomic-task-planner':
      return createDeterministicAtomicTaskPlannerTerminal(input)
    case 'implementation-worker':
      return createDeterministicImplementationWorkerTerminal(input)
    case 'implementation-auditor':
    case 'acceptance-validator':
      return createDeterministicValidationTerminal(input)
    case 'change-impact-analyzer':
      return createDeterministicChangeImpactTerminal(input)
    case 'question-answerer':
      return createDeterministicQuestionAnswerTerminal(input)
    case 'resource-planner':
      return createDeterministicResourcePlannerTerminal(input)
    case 'resource-curator':
      throw new Error(
        'resource curator terminal requires a committed durable inventory receipt',
      )
    case 'resource-content-author':
      throw new Error(
        'resource content terminal requires a committed durable content receipt',
      )
    case 'game-ir-compiler':
      return createDeterministicGameIrCompilerTerminal(input)
  }
}

function createDeterministicGameIrCompilerTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  const resultEvent = [...input.events]
    .reverse()
    .find(event => event.type === 'result')
  const operation = gameIrOperationForRequest(input.request)
  const resultPayload =
    resultEvent?.payload && typeof resultEvent.payload === 'object'
      ? (resultEvent.payload as Record<string, unknown>)
      : undefined
  const modelPayload =
    operation === 'projection'
      ? (() => {
          const recordStream = resultPayload?.record_stream
          if (typeof recordStream !== 'string')
            throw new Error(
              'Game IR projection result is missing native record_stream',
            )
          const stream = parseGameIrProjectionRecordStream({
            expectedSliceId: gameIrProjectionSliceForRequest(input.request)
              .sliceId,
            text: recordStream,
          })
          return {
            status: stream.done ? ('completed' as const) : ('failed' as const),
            sliceId: gameIrProjectionSliceForRequest(input.request).sliceId,
            records: stream.records,
            done: stream.done,
            ...(stream.diagnostic ? { reason: stream.diagnostic } : {}),
          }
        })()
      : (() => {
          const structured = resultPayload?.structured_output
          if (structured === undefined)
            throw new Error(
              'Game IR validation result is missing native StructuredOutput',
            )
          assertFoundationStructuredOutputWithinInfrastructureBoundary(
            structured,
          )
          return structured
        })()
  const parsedPayload = parseGameIrCompilerModelPayload(modelPayload, operation)
  const payload =
    operation === 'projection'
      ? (() => {
          const currentSlice = gameIrProjectionSliceForRequest(input.request)
          if (
            !('sliceId' in parsedPayload) ||
            parsedPayload.sliceId !== currentSlice.sliceId
          )
            throw new Error(
              'Game IR projection terminal slice identity is detached',
            )
          return parsedPayload
        })()
      : parsedPayload
  const dispatchId = input.request.dispatchId
  const compileRequestDigest = input.request.contract.compileRequestDigest
  const foundationReadyReceiptDigest =
    input.request.contract.foundationReadyReceiptDigest
  if (
    typeof dispatchId !== 'string' ||
    typeof input.request.runId !== 'string' ||
    typeof input.request.taskId !== 'string' ||
    typeof input.request.revision !== 'string' ||
    typeof compileRequestDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(compileRequestDigest) ||
    typeof foundationReadyReceiptDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(foundationReadyReceiptDigest)
  )
    throw new Error('Game IR compiler dispatch identity is incomplete')
  return gameIrCompilerTerminalSchema.parse({
    workerType: 'game-ir-compiler',
    operation,
    ...payload,
    runId: input.request.runId,
    dispatchId,
    taskId: input.request.taskId,
    revision: input.request.revision,
    compileRequestDigest,
    foundationReadyReceiptDigest,
  })
}

function createGameIrCompilerFailureTerminal(input: {
  request: WorkerDispatchRequest
  reason: string
}) {
  const operation = gameIrOperationForRequest(input.request)
  const sliceId =
    operation === 'projection'
      ? gameIrProjectionSliceForRequest(input.request).sliceId
      : undefined
  const dispatchId = input.request.dispatchId
  const compileRequestDigest = input.request.contract.compileRequestDigest
  const foundationReadyReceiptDigest =
    input.request.contract.foundationReadyReceiptDigest
  if (
    typeof dispatchId !== 'string' ||
    typeof input.request.runId !== 'string' ||
    typeof input.request.taskId !== 'string' ||
    typeof input.request.revision !== 'string' ||
    typeof compileRequestDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(compileRequestDigest) ||
    typeof foundationReadyReceiptDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(foundationReadyReceiptDigest)
  )
    throw new Error('Game IR compiler dispatch identity is incomplete')
  return gameIrCompilerTerminalSchema.parse({
    workerType: 'game-ir-compiler',
    operation,
    status: 'failed',
    ...(sliceId ? { sliceId } : {}),
    ...(operation === 'projection' ? { records: [], done: false } : {}),
    reason: input.reason,
    runId: input.request.runId,
    dispatchId,
    taskId: input.request.taskId,
    revision: input.request.revision,
    compileRequestDigest,
    foundationReadyReceiptDigest,
  })
}

function createDeterministicFoundationFactTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}): ReturnType<typeof foundationFactExtractorTerminalSchema.parse> | undefined {
  const resultEvent = [...input.events]
    .reverse()
    .find(event => event.type === 'result')
  const structured =
    resultEvent?.payload &&
    typeof resultEvent.payload === 'object' &&
    'structured_output' in resultEvent.payload
      ? (resultEvent.payload as Record<string, unknown>).structured_output
      : undefined
  if (structured === undefined) return undefined
  assertFoundationStructuredOutputWithinInfrastructureBoundary(structured)
  const payload = foundationFactModelPayloadSchema.parse(structured)
  const packet = foundationFactPacketForRequest(input.request)
  const results = payload.results.map(result => {
    if (!isFoundationFactKey(result.key))
      throw new Error(
        `foundation fact result has an unknown key: ${result.key}`,
      )
    if (!packet.keys.includes(result.key))
      throw new Error(
        `foundation fact result key is not assigned: ${result.key}`,
      )
    return result.status === 'absent'
      ? result
      : {
          ...result,
          evidence: foundationFactEvidenceForPacket(packet, result.key),
        }
  })
  return foundationFactExtractorTerminalSchema.parse({
    workerType: 'foundation-fact-extractor',
    status: payload.status,
    runId: input.request.runId,
    dispatchId: input.request.dispatchId,
    taskId: input.request.taskId,
    revision: input.request.revision,
    packetDigest: input.request.contract.packetDigest,
    results,
  })
}

function createDeterministicFoundationSemanticTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}):
  | ReturnType<typeof foundationSemanticReviewerTerminalSchema.parse>
  | undefined {
  const resultEvent = [...input.events]
    .reverse()
    .find(event => event.type === 'result')
  const structured =
    resultEvent?.payload &&
    typeof resultEvent.payload === 'object' &&
    'structured_output' in resultEvent.payload
      ? (resultEvent.payload as Record<string, unknown>).structured_output
      : undefined
  if (structured === undefined) return undefined
  assertFoundationStructuredOutputWithinInfrastructureBoundary(structured)
  if (typeof input.request.contract.issueId === 'string') {
    const payload =
      foundationSemanticRecheckWorkerPayloadSchema.parse(structured)
    return foundationSemanticRecheckTerminalSchema.parse({
      workerType: 'foundation-semantic-reviewer',
      status: 'completed',
      runId: input.request.runId,
      dispatchId: input.request.dispatchId,
      taskId: input.request.taskId,
      revision: input.request.revision,
      packetDigest: input.request.contract.packetDigest,
      outcome: payload.status,
      ...(payload.status === 'FAIL'
        ? {
            diagnostic: {
              ...payload.diagnostic,
              scopeAssessment: 'repairable_in_scope' as const,
            },
          }
        : {}),
    })
  }
  const payload = foundationSemanticModelPayloadSchema.parse(structured)
  return foundationSemanticReviewerTerminalSchema.parse({
    workerType: 'foundation-semantic-reviewer',
    status: payload.status,
    runId: input.request.runId,
    dispatchId: input.request.dispatchId,
    taskId: input.request.taskId,
    revision: input.request.revision,
    packetDigest: input.request.contract.packetDigest,
    outcome: payload.outcome,
    ...(payload.issues ? { issues: payload.issues } : {}),
    ...(payload.reason ? { reason: payload.reason } : {}),
  })
}

function createDeterministicFoundationRevisionTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  const event = [...input.events]
    .reverse()
    .find(
      candidate =>
        candidate.type === 'tool.completed' &&
        candidate.payload?.toolName === 'SubmitFoundationRevisionResult',
    )
  const output = event?.payload?.output
  if (typeof output !== 'string')
    throw new Error('foundation revision terminal output is missing')
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    throw new Error('foundation revision terminal output is malformed')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('foundation revision terminal output is not an object')
  const candidate = value as Record<string, unknown>
  if (Object.hasOwn(candidate, 'data'))
    throw new Error('foundation revision terminal output envelope is invalid')
  const declaration = foundationRevisionToolResultSchema.parse(candidate)
  return foundationDocumentReviserTerminalSchema.parse({
    workerType: 'foundation-document-reviser',
    status: 'completed',
    runId: input.request.runId,
    dispatchId: input.request.dispatchId,
    taskId: input.request.taskId,
    revision: input.request.revision,
    packetDigest: input.request.contract.packetDigest,
    round: input.request.contract.round,
    documentPath: input.request.contract.documentPath,
    declaration,
  })
}

function completedToolInputs(
  events: ReturnType<BeeGameSessionManager['events']>,
  toolName: string,
): Record<string, unknown>[] {
  return [...events].reverse().flatMap(event => {
    if (event.type !== 'tool.completed' || event.payload?.toolName !== toolName)
      return []
    const toolInput = event.payload.input
    return toolInput &&
      typeof toolInput === 'object' &&
      !Array.isArray(toolInput)
      ? [toolInput as Record<string, unknown>]
      : []
  })
}

function failedToolCount(
  events: ReturnType<BeeGameSessionManager['events']>,
  toolName: string,
): number {
  return events.filter(
    event =>
      event.type === 'tool.failed' && event.payload?.toolName === toolName,
  ).length
}

function lastFailedToolOutput(
  events: ReturnType<BeeGameSessionManager['events']>,
  toolName: string,
): string | undefined {
  for (const event of [...events].reverse()) {
    if (event.type !== 'tool.failed' || event.payload?.toolName !== toolName)
      continue
    const output = event.payload.output
    if (typeof output === 'string' && output.trim()) return output.trim()
  }
  return undefined
}

async function writeCanonicalTerminalEvidence(input: {
  workspacePath: string
  evidencePath: string
  value: unknown
}): Promise<void> {
  const absolutePath = resolveWorkflowEvidencePath(
    input.workspacePath,
    input.evidencePath,
  )
  if (!absolutePath) throw new Error('workflow evidence path is invalid')
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(
    absolutePath,
    `${JSON.stringify(input.value, null, 2)}\n`,
    'utf8',
  )
}

async function createDeterministicChangeImpactTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  const candidate = completedToolInputs(
    input.events,
    'SubmitChangeImpactResult',
  )[0]
  if (!candidate)
    throw new Error(
      'worker terminal result is missing a valid SubmitChangeImpactResult call',
    )
  const evidencePath = `.beegame/workflow/evidence/change-impact-${input.request.dispatchId}.json`
  const terminal = changeImpactTerminalSchema.parse({
    workerType: 'change-impact-analyzer',
    ...candidate,
    evidencePath,
  })
  await writeCanonicalTerminalEvidence({
    workspacePath: input.request.workspacePath,
    evidencePath,
    value: terminal,
  })
  return terminal
}

async function createDeterministicQuestionAnswerTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  const candidate = completedToolInputs(
    input.events,
    'SubmitQuestionAnswerResult',
  )[0]
  if (!candidate)
    throw new Error(
      'worker terminal result is missing a valid SubmitQuestionAnswerResult call',
    )
  const evidencePath = `.beegame/workflow/evidence/question-answer-${input.request.dispatchId}.json`
  const terminal = questionAnswerTerminalSchema.parse({
    workerType: 'question-answerer',
    ...candidate,
    evidencePath,
  })
  await writeCanonicalTerminalEvidence({
    workspacePath: input.request.workspacePath,
    evidencePath,
    value: terminal,
  })
  return terminal
}

async function createDeterministicValidationTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  const candidates = [...input.events].reverse().flatMap(event => {
    if (
      event.type !== 'tool.completed' ||
      event.payload?.toolName !== 'SubmitValidationResult'
    )
      return []
    const toolInput = event.payload.input
    return toolInput &&
      typeof toolInput === 'object' &&
      !Array.isArray(toolInput)
      ? [toolInput as Record<string, unknown>]
      : []
  })
  const errors: string[] = []
  for (const candidate of candidates) {
    try {
      const contract = input.request.contract
      const taskIds = submittedStringArray(contract.taskIds)
      const checklistIds = submittedStringArray(contract.checklistIds)
      const resourceIds = submittedStringArray(contract.resourceIds)
      const contentIds = submittedStringArray(contract.contentIds)
      const evidencePath = `.beegame/workflow/evidence/${input.request.workerType}-${input.request.dispatchId}.json`
      const findings = deriveValidationFindings(
        candidate.findings,
        contract.tasks,
      )
      const common = {
        workerType: input.request.workerType,
        revision: input.request.revision,
        status: candidate.status,
        checklistIds,
        resourceIds,
        contentIds,
        findings,
        evidencePath,
      }
      const terminal =
        input.request.workerType === 'implementation-auditor'
          ? implementationAuditorTerminalSchema.parse({
              ...common,
              auditedTaskIds: taskIds,
            })
          : acceptanceValidatorTerminalSchema.parse({
              ...common,
              validatedTaskIds: taskIds,
            })
      const absolutePath = resolveWorkflowEvidencePath(
        input.request.workspacePath,
        evidencePath,
      )
      if (!absolutePath) throw new Error('validation evidence path is invalid')
      await mkdir(dirname(absolutePath), { recursive: true })
      await writeFile(absolutePath, `${JSON.stringify(terminal)}\n`, 'utf8')
      return terminal
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new Error(
    errors.length
      ? `validation result does not match the active contract: ${errors.join('; ')}`
      : 'worker terminal result is missing a valid SubmitValidationResult call',
  )
}

function deriveValidationFindings(
  value: unknown,
  taskValue: unknown,
): unknown[] {
  const tasks = Array.isArray(taskValue)
    ? taskValue.flatMap(task => {
        if (!task || typeof task !== 'object' || Array.isArray(task)) return []
        const record = task as Record<string, unknown>
        if (typeof record.id !== 'string') return []
        return [
          {
            id: record.id,
            allowedPaths: submittedStringArray(record.allowedPaths),
            checklistIds: submittedStringArray(record.checklistIds),
          },
        ]
      })
    : []
  return Array.isArray(value)
    ? value.map(finding => {
        const record = finding as Record<string, unknown>
        const artifactPaths = submittedStringArray(record.artifactPaths)
        const owners = tasks.filter(task =>
          artifactPaths.some(artifactPath =>
            task.allowedPaths.some(scope =>
              validationScopeContains(scope, artifactPath),
            ),
          ),
        )
        return {
          artifactPaths,
          description: record.description,
          requiredAction: record.requiredAction,
          taskIds: [...new Set(owners.map(owner => owner.id))],
          checklistIds: [
            ...new Set(owners.flatMap(owner => owner.checklistIds)),
          ],
        }
      })
    : []
}

function validationScopeContains(scope: string, artifactPath: string): boolean {
  const normalize = (value: string): string => {
    let normalized = value.replaceAll('\\', '/')
    while (normalized.startsWith('./')) normalized = normalized.slice(2)
    while (normalized.endsWith('/')) normalized = normalized.slice(0, -1)
    return normalized
  }
  const normalizedScope = normalize(scope)
  const normalizedArtifact = normalize(artifactPath)
  return (
    normalizedArtifact === normalizedScope ||
    normalizedArtifact.startsWith(`${normalizedScope}/`)
  )
}

const WORKSPACE_MUTATION_TOOLS = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
])

function hasInFlightResourceMutation(events: BeeGameEvent[]): boolean {
  const active = new Map<string, boolean>()
  for (const event of events) {
    const toolUseId = String(event.payload?.toolUseID ?? '')
    if (!toolUseId) continue
    if (event.type === 'tool.completed' || event.type === 'tool.failed') {
      active.delete(toolUseId)
      continue
    }
    if (event.type !== 'tool.started') continue
    const toolName = String(event.payload?.toolName ?? '')
    if (
      WORKSPACE_MUTATION_TOOLS.has(toolName) ||
      toolName === 'CommitResourceInventory' ||
      toolName === 'AssetManifest' ||
      toolName === 'CommitResourceContent'
    )
      active.set(toolUseId, true)
  }
  return active.size > 0
}

function hasInFlightTool(
  events: BeeGameEvent[],
  expectedToolName: string,
): boolean {
  const active = new Set<string>()
  for (const event of events) {
    const toolUseId = String(event.payload?.toolUseID ?? '')
    if (!toolUseId) continue
    if (event.type === 'tool.completed' || event.type === 'tool.failed') {
      active.delete(toolUseId)
      continue
    }
    if (
      event.type === 'tool.started' &&
      String(event.payload?.toolName ?? '') === expectedToolName
    )
      active.add(toolUseId)
  }
  return active.size > 0
}

async function createDeterministicResourcePlannerTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  const taskMetrics = resourceTaskMetrics(input.events)
  const contract = auditAssetContract(input.request.workspacePath)
  const observedMutationPaths = completedMutationPaths(
    input.request.workspacePath,
    input.events,
  )
  const writtenPaths = [
    ...new Set([
      ...(contract.present ? ['assets/asset-manifest.json'] : []),
      ...contract.resources.flatMap(resource => resource.filePaths),
      ...contract.content.files.map(file => file.path),
      ...observedMutationPaths,
    ]),
  ]
  if (input.request.workerType !== 'resource-planner')
    throw new Error('resource planner terminal received another worker type')
  const submission = completedToolInputs(input.events, 'AssetManifest').find(
    candidate => candidate.action === 'submit_resource_plan',
  )
  if (!submission || !contract.present || contract.requirements.length === 0)
    throw new Error(
      'resource planner completed without an accepted canonical resource plan',
    )
  return resourcePlannerTerminalSchema.parse({
    revision: input.request.revision,
    workerType: 'resource-planner' as const,
    status: 'completed' as const,
    writtenPaths: ['assets/asset-manifest.json'],
    taskMetrics,
  })
}

function resourceTaskMetrics(
  events: ReturnType<BeeGameSessionManager['events']>,
) {
  const completed = events.filter(event => event.type === 'tool.completed')
  const catalogCalls = completed.flatMap(event => {
    if (event.payload?.toolName !== 'ResourceLibrary') return []
    const input = event.payload.input
    if (!input || typeof input !== 'object' || Array.isArray(input)) return []
    const action = (input as Record<string, unknown>).action
    if (typeof action !== 'string' || !action) return []
    const output = event.payload.output
    const serialized =
      typeof output === 'string' ? output : JSON.stringify(output ?? null)
    return [{ action, bytes: new TextEncoder().encode(serialized).byteLength }]
  })
  const canonicalMutationCount = completed.filter(event => {
    const toolName = String(event.payload?.toolName ?? '')
    if (WORKSPACE_MUTATION_TOOLS.has(toolName)) return true
    const input = event.payload?.input
    const action =
      input && typeof input === 'object' && !Array.isArray(input)
        ? String((input as Record<string, unknown>).action ?? '')
        : ''
    if (toolName === 'CommitResourceInventory') return true
    return toolName === 'AssetManifest' && action === 'submit_resource_plan'
  }).length
  return {
    catalogPayloadBytes: catalogCalls.reduce(
      (total, call) => total + call.bytes,
      0,
    ),
    catalogCallTypes: [...new Set(catalogCalls.map(call => call.action))],
    canonicalMutationCount,
  }
}

async function createDeterministicAtomicTaskPlannerTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  const candidates = [...input.events].reverse().flatMap(event => {
    if (
      event.type !== 'tool.completed' ||
      event.payload?.toolName !== 'SubmitAtomicTaskPlan'
    )
      return []
    const toolInput = event.payload.input
    return toolInput &&
      typeof toolInput === 'object' &&
      !Array.isArray(toolInput)
      ? [toolInput as Record<string, unknown>]
      : []
  })
  const errors: string[] = []
  for (const candidate of candidates) {
    try {
      const evidencePath = `.beegame/workflow/evidence/atomic-task-plan-${input.request.dispatchId}.json`
      const ownership = normalizeSubmittedOwnership(candidate.ownership)
      const terminal = atomicTaskPlannerTerminalSchema.parse({
        workerType: 'atomic-task-planner',
        revision: input.request.revision,
        status: 'completed',
        tasks: normalizePlannedAtomicTasks(candidate.tasks, ownership),
        evidencePath,
      })
      const absolutePath = resolveWorkflowEvidencePath(
        input.request.workspacePath,
        evidencePath,
      )
      if (!absolutePath) throw new Error('atomic task evidence path is invalid')
      await mkdir(dirname(absolutePath), { recursive: true })
      await writeFile(
        absolutePath,
        `${JSON.stringify({
          workerType: 'atomic-task-planner',
          status: 'completed',
          revision: input.request.revision,
          tasks: candidate.tasks,
          ownership,
        })}\n`,
        'utf8',
      )
      return terminal
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new Error(
    errors.length
      ? `atomic task evidence does not match the executable task schema: ${errors.join('; ')}`
      : 'worker terminal result is missing a valid SubmitAtomicTaskPlan call',
  )
}

function submittedStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const a = [...new Set(left)].sort()
  const b = [...new Set(right)].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function createDeterministicImplementationWorkerTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  const candidates = [...input.events].reverse().flatMap(event => {
    if (
      event.type !== 'tool.completed' ||
      event.payload?.toolName !== 'SubmitImplementationResult'
    )
      return []
    const toolInput = event.payload.input
    return toolInput &&
      typeof toolInput === 'object' &&
      !Array.isArray(toolInput)
      ? [toolInput as Record<string, unknown>]
      : []
  })
  const errors: string[] = []
  for (const candidate of candidates) {
    try {
      const evidencePath = `.beegame/workflow/evidence/implementation-${input.request.dispatchId}.json`
      const task =
        input.request.contract.task &&
        typeof input.request.contract.task === 'object' &&
        !Array.isArray(input.request.contract.task)
          ? (input.request.contract.task as Record<string, unknown>)
          : {}
      const verificationObservations = Array.isArray(
        candidate.verificationObservations,
      )
        ? candidate.verificationObservations
        : []
      const verificationCount = Array.isArray(task.verification)
        ? task.verification.length
        : 0
      if (verificationObservations.length !== verificationCount)
        throw new Error(
          `verification observations must contain exactly ${verificationCount} entries`,
        )
      const {
        verificationObservations: _verificationObservations,
        ...candidateTerminal
      } = candidate
      return implementationWorkerTerminalSchema.parse({
        ...candidateTerminal,
        verifiedArtifacts: submittedStringArray(task.expectedArtifacts),
        verificationResults: (
          task.verification as Array<Record<string, unknown>>
        ).map((verification, verificationIndex) => ({
          verificationIndex,
          status: verification.kind === 'runtime' ? 'deferred' : 'passed',
          observations: [verificationObservations[verificationIndex]],
        })),
        workerType: 'implementation-worker',
        taskId: input.request.taskId,
        revision: input.request.revision,
        evidenceRefs: [evidencePath],
        evidencePath,
      })
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new Error(
    errors.length
      ? `implementation result does not match the active task schema: ${errors.join('; ')}`
      : 'worker terminal result is missing a valid SubmitImplementationResult call',
  )
}

function normalizeSubmittedOwnership(
  value: unknown,
): Record<string, Record<string, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('atomic task ownership must be an object')
  const record = value as Record<string, unknown>
  const fields = ['checklistItems'] as const
  if (
    Object.keys(record).some(
      key => !fields.includes(key as (typeof fields)[number]),
    )
  )
    throw new Error('atomic task ownership contains unknown fields')
  return Object.fromEntries(
    fields.map(field => {
      const entries = record[field]
      if (!Array.isArray(entries))
        throw new Error(`atomic task ownership.${field} must be an array`)
      const mapping: Record<string, string> = {}
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
          throw new Error(
            `atomic task ownership.${field} entries must be objects`,
          )
        const item = entry as Record<string, unknown>
        if (
          typeof item.id !== 'string' ||
          !item.id ||
          typeof item.taskId !== 'string' ||
          !item.taskId
        )
          throw new Error(
            `atomic task ownership.${field} entries require id and taskId`,
          )
        if (mapping[item.id])
          throw new Error(
            `atomic task ownership.${field} duplicates ${item.id}`,
          )
        mapping[item.id] = item.taskId
      }
      return [field, mapping]
    }),
  )
}

function normalizePlannedAtomicTasks(
  value: unknown,
  ownershipValue: unknown,
): unknown {
  if (!Array.isArray(value)) return value
  if (
    !ownershipValue ||
    typeof ownershipValue !== 'object' ||
    Array.isArray(ownershipValue)
  )
    throw new Error('atomic task ownership must be an object')
  const ownership = ownershipValue as Record<string, unknown>
  const ownershipFields = [['checklistItems', 'checklistIds']] as const
  if (
    Object.keys(ownership).some(
      key => !ownershipFields.some(([field]) => field === key),
    )
  )
    throw new Error('atomic task ownership contains unknown fields')
  const taskIds = new Set(
    value.flatMap(task =>
      task && typeof task === 'object' && !Array.isArray(task)
        ? [String((task as Record<string, unknown>).id ?? '')]
        : [],
    ),
  )
  const owned = new Map<string, Record<string, string[]>>()
  for (const [ownershipField, taskField] of ownershipFields) {
    const mapping = ownership[ownershipField]
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping))
      throw new Error(
        `atomic task ownership.${ownershipField} must be an object`,
      )
    for (const [id, taskIdValue] of Object.entries(mapping)) {
      if (!id || typeof taskIdValue !== 'string' || !taskIdValue)
        throw new Error(
          `atomic task ownership.${ownershipField} must map non-empty IDs to task IDs`,
        )
      if (!taskIds.has(taskIdValue))
        throw new Error(
          `atomic task ownership assigns ${id} to unknown task ${taskIdValue}`,
        )
      const taskOwnership = owned.get(taskIdValue) ?? {}
      taskOwnership[taskField] = [...(taskOwnership[taskField] ?? []), id]
      owned.set(taskIdValue, taskOwnership)
    }
  }
  return value.map(task => {
    if (!task || typeof task !== 'object' || Array.isArray(task)) return task
    const record = task as Record<string, unknown>
    const forbiddenWorkerOwnedFields = [
      'checklistIds',
      'status',
      'attempt',
      'startedRevision',
      'completedRevision',
      'evidenceRefs',
      'kind',
      'summary',
      'requirementIds',
      'deliverables',
      'acceptanceCriteria',
    ]
    if (forbiddenWorkerOwnedFields.some(field => field in record)) return task
    return {
      ...task,
      checklistIds: owned.get(String(record.id))?.checklistIds ?? [],
      status: 'pending',
      attempt: 0,
      evidenceRefs: [],
    }
  })
}

function completedMutationPaths(
  workspacePath: string,
  events: ReturnType<BeeGameSessionManager['events']>,
): string[] {
  const completedToolUseIds = new Set(
    events.flatMap(event => {
      if (event.type !== 'tool.completed') return []
      const toolUseID = event.payload?.toolUseID
      return typeof toolUseID === 'string' && toolUseID ? [toolUseID] : []
    }),
  )
  return events.flatMap(event => {
    if (event.type !== 'tool.started') return []
    const toolUseID = event.payload?.toolUseID
    if (typeof toolUseID !== 'string' || !completedToolUseIds.has(toolUseID))
      return []
    if (
      !['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(
        String(event.payload?.toolName),
      )
    )
      return []
    const toolInput = event.payload?.input
    if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput))
      return []
    const record = toolInput as Record<string, unknown>
    return [record.file_path, record.path, record.notebook_path]
      .filter(
        (value): value is string =>
          typeof value === 'string' && Boolean(value.trim()),
      )
      .map(value =>
        relative(
          resolve(workspacePath),
          resolve(workspacePath, value),
        ).replaceAll('\\', '/'),
      )
  })
}
