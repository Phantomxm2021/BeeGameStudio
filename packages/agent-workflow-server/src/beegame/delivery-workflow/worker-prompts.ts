import { resolve } from 'node:path'
import {
  CANONICAL_PROJECT_ARTIFACTS,
  CANONICAL_PROJECT_DOCUMENTS,
  CANONICAL_FOUNDATION_DOCUMENTS,
  type WorkerDispatchRequest,
} from './types'
import { foundationFactDefinition } from './foundation-fact-definitions'
import {
  deriveProjectionSlicePlan,
  normalizeGameIrProjectionSliceContext,
  type GameIrProjectionSlice,
} from './game-ir/projection-slices'
import { canonicalGameIrJson } from './game-ir/model'
import {
  buildGameIrProjectionSliceAuthority,
  renderGameIrProjectionSliceAuthority,
} from './game-ir/projection-slice-authority'

const DOCUMENT_AUTHORING_DENSITY_INSTRUCTION =
  'Judge quality by distinct implementable decisions and traceability, not document length. Use the minimum sufficient headings, tables, rows, diagrams and examples. Do not expand a contract purpose phrase by phrase into H3 headings. Represent each decision in one authoritative prose, table or diagram representation; elsewhere use a stable owner reference. Do not narrate tables or diagrams. Remove generic best-practice essays, derivations, tutorials, speculative alternatives and boilerplate. Record a genuinely N/A item once with its reason and impact; never invent a system. Do not impose fixed token, word, time, heading, table, row, diagram or example caps or targets. Treat each section as the final decision record: Complete every required section and production material, omit only equivalent repetition, and keep rationale to the minimum needed for a production decision.'

const FOUNDATION_AUTHOR_AUTHORITY_INSTRUCTION =
  'Use exactly one fact owner across the eight documents: GDD owns player actions, loops, rules, states and outcomes; BALANCE_DESIGN owns units, sources, sinks, base values, formulas, bounds and tuning evidence; LEVEL_SCENE_DESIGN owns topology, placements, pacing and production acceptance; Technical owns runtime and data boundaries; Art owns visual language; UI/UX owns interaction; Audio owns event-to-cue behavior; Asset Plan owns resource responsibilities and production sourcing. Every material is an owner representation for its declared facts and contains the single canonical representation. Define each fact once and use one representation per fact in its owner section or production material; elsewhere reference that owner instead of copying the fact. Use only this document and the contract-declared committed upstream section projection as content authority. Delegate responsibilities to a not-yet-generated downstream document by its canonical `Document Path` and discipline in ordinary Markdown; do not invent downstream facts, material IDs or inventory IDs. Keep stable IDs unambiguous and do not create aliases, placeholders or alternate spellings. The Executive Summary indexes authority, while each material owns the facts declared by its serialized authority rule. Do not restate the confirmed brief or upstream authority; downstream documents may specialize already-authorized behavior but must not redefine upstream rules.'

const FOUNDATION_AUTHOR_CLOSURE_CHECK =
  'Before returning, silently perform this internal closure check (do not output a check report): every H2 in mechanicalMarkdownProtocol.closedHeadingSet appears in order and exactly once; every productionMaterials.entries H3 appears in order and exactly once. Use each reserved production-material H3 exactly once under the final `## Production Materials` heading; never place one inline in an owning prose section; retain every required heading for N/A content and state its reason and impact. Return only the complete raw Markdown body.'

const FOUNDATION_SEMANTIC_REMEDIATION_CONTRACT =
  'Semantic Issue remediation must be exactly {"kind":"patch","sectionKeys":["..."]}. Do not wrap the result in `params` or add fields such as summary, steps, description, or value. Resolve conflicts by the fixed Source of Truth order GDD > Technical > Level/Balance/UI/Art > Asset Plan, then by explicit packet hard constraints, then by the smallest authorized semantic change. Choose that repair directly; never request a user choice or preserve alternatives. All patch sectionKeys must belong to the same canonical document; never mix document prefixes in one patch. If a conflict spans documents, split it into separate Issues with independent single-document patch authority; each Issue sourceSectionKey, expected, and actual must match its single-document authority. A wording-only rewrite, synonym, alias, compatibility note, qualification, or restatement is not a repair unless it makes the exact expected condition true and removes the actual condition.'

export function buildWorkerPrompt(request: WorkerDispatchRequest): string {
  const packetWorker =
    request.workerType === 'foundation-fact-extractor' ||
    request.workerType === 'foundation-semantic-reviewer' ||
    request.workerType === 'game-ir-compiler'
  if (packetWorker) return buildPacketWorkerPrompt(request)
  if (request.workerType === 'foundation-document-reviser')
    return buildFoundationRevisionWorkerPrompt(request)
  const streamedFoundationAuthor =
    request.workerType === 'document-author' &&
    request.contract.documentSet === 'foundation' &&
    (request.contract.authoringMode === 'initial' ||
      request.contract.authoringMode === 'parallel-draft')
  if (
    streamedFoundationAuthor &&
    typeof request.contract.priorFailureReason === 'string'
  )
    throw new Error('foundation document author retry contract is removed')
  const resourceContentReadPaths =
    request.workerType === 'resource-content-author'
      ? [
          ...(Array.isArray(request.contract.authorityPaths)
            ? request.contract.authorityPaths
            : []),
          ...(Array.isArray(request.contract.repairPaths)
            ? request.contract.repairPaths
            : []),
        ].filter(
          (path, index, paths): path is string =>
            typeof path === 'string' && paths.indexOf(path) === index,
        )
      : []
  const pathScopeLabel = resourceContentReadPaths.length
    ? 'Readable task paths'
    : 'Writable paths'
  const pathScope = resourceContentReadPaths.length
    ? resourceContentReadPaths.join(', ')
    : request.allowedPaths?.length
      ? request.allowedPaths.join(', ')
      : 'read-only'
  const foundationAuthorArtifacts =
    request.workerType === 'document-author' &&
    request.contract.documentSet === 'foundation' &&
    ['initial', 'parallel-draft'].includes(
      String(request.contract.authoringMode),
    ) &&
    typeof request.contract.foundationDocumentPath === 'string'
      ? [
          ...(Array.isArray(request.contract.availableUpstreamPaths)
            ? request.contract.availableUpstreamPaths
            : []),
          request.contract.foundationDocumentPath,
        ].filter(
          (path, index, paths): path is string =>
            typeof path === 'string' && paths.indexOf(path) === index,
        )
      : undefined
  const canonicalArtifacts =
    foundationAuthorArtifacts ??
    (request.workerType === 'document-author' &&
    request.contract.documentSet === 'checklist'
      ? CANONICAL_PROJECT_DOCUMENTS
      : CANONICAL_PROJECT_ARTIFACTS)
  return [
    `BeeGame delivery worker: ${request.workerType}`,
    streamedFoundationAuthor ? undefined : `Phase: ${request.phase}`,
    streamedFoundationAuthor ? undefined : `Run: ${request.runId}`,
    streamedFoundationAuthor ? undefined : `Revision: ${request.revision}`,
    streamedFoundationAuthor
      ? undefined
      : `Workspace root: ${request.workspacePath}`,
    streamedFoundationAuthor ? undefined : `${pathScopeLabel}: ${pathScope}`,
    streamedFoundationAuthor
      ? undefined
      : `Canonical artifacts: ${canonicalArtifacts.join(', ')}`,
    'The durable confirmed brief context and its digest are the product authority for this run.',
    'Confirmed Brief settings are higher authority than free-form idea text; on conflict, do not preserve both sides as simultaneous requirements.',
    streamedFoundationAuthor
      ? `Canonical Foundation documents: ${CANONICAL_FOUNDATION_DOCUMENTS.join(', ')}`
      : undefined,
    streamedFoundationAuthor
      ? 'Markdown cross-document references may use only these exact canonical Foundation paths named above; any other docs/*.md reference is invalid, including inside code fences.'
      : undefined,
    workerInstruction(request),
    streamedFoundationAuthor
      ? undefined
      : 'Use the confirmed contract and task payload as authority. Do not use chat transcript prose as product authority.',
    streamedFoundationAuthor
      ? undefined
      : 'Use Bee Game Studio normally. Its native tools, thinking, permissions, context management, and completion behavior remain available. Do not bind a resource decision to a particular game engine or platform unless the approved target explicitly requires it.',
    terminalInstruction(request),
    formatContract(request),
    streamedFoundationAuthor ? FOUNDATION_AUTHOR_CLOSURE_CHECK : undefined,
  ].join('\n')
}

function buildFoundationRevisionWorkerPrompt(
  request: WorkerDispatchRequest,
): string {
  const packet = request.contract.packet
  const stagedPath = request.contract.stagedPath
  if (!packet || typeof packet !== 'object' || Array.isArray(packet))
    throw new Error('foundation revision worker requires one immutable packet')
  if (typeof stagedPath !== 'string' || !stagedPath.trim())
    throw new Error('foundation revision worker requires one staged path')
  const absoluteStagedPath = resolve(request.workspacePath, stagedPath)
  const priorFailureReason =
    typeof request.contract.priorFailureReason === 'string'
      ? request.contract.priorFailureReason
      : undefined
  return [
    `Revision evidence: ${JSON.stringify(projectRevisionPacketForModel(packet as Record<string, unknown>))}`,
    `Assigned staged path: ${absoluteStagedPath}`,
    'The packet sectionIds are the complete write authority: only those sections may change. Every other section—including related, risk, consistency, dependency, and production-material sections—must remain byte-identical; do not edit them to keep prose synchronized. Read and edit only the assigned staged path. Unmarked Production Materials and audit appendices are outside the packet authority; do not edit them even when they appear related to an admitted Issue. Make every admitted Issue expected true and remove its actual. For fact/schema repairs, packet.factConstraints is binding authority: satisfy its extractionInstruction and sourceOfTruthDirection. If an extractionInstruction requires an explicit mapping table or other semantic structure, do not substitute a standalone fact declaration, formatting-only change, alias, compatibility prose, risk registration, wording qualification, or downstream reinterpretation. Call SubmitFoundationRevisionResult exactly once with status APPLIED; the service injects task, round, document, Issue and base-authority identity and derives changed sections from canonical bytes. Do not return terminal JSON or prose completion text.',
    ...(priorFailureReason
      ? [
          `Automatic retry after the previous strict validation failure: ${priorFailureReason}. Correct that failure in the authorized packet sections only; do not broaden scope.`,
        ]
      : []),
  ].join('\n')
}

function buildPacketWorkerPrompt(request: WorkerDispatchRequest): string {
  const contract = formatPacketContract(request)
  return [
    `BeeGame delivery worker: ${request.workerType}`,
    'The model contract is the sole input for this task. The packet inside it is immutable service-owned authority.',
    'Do not read project files, call Read, Grep or Glob, inspect the workspace, use native tools, write files, mutate the platform, or add context from any other source.',
    request.workerType === 'game-ir-compiler' &&
    request.contract.kind === 'projection'
      ? 'Return only the strict raw NDJSON record stream for the assigned packet; do not return Markdown, prose explanations, wrappers, tools, or additional fields.'
      : 'Return only the strict structured result for the assigned packet; do not return Markdown, prose explanations, or additional fields.',
    request.workerType === 'game-ir-compiler' &&
    request.contract.kind === 'projection'
      ? 'The service owns the slice cursor; emit only the exact current slice result and never rewrite or regenerate an entire domain.'
      : 'If correctionDiagnostic is present, use it only to correct the current operation output; it is not product authority and must not redefine the assigned operation.',
    workerInstruction(request),
    terminalInstruction(request),
    `Model packet contract: ${contract}`,
  ].join('\n')
}

function formatPacketContract(request: WorkerDispatchRequest): string {
  const isGameIrProjection =
    request.workerType === 'game-ir-compiler' &&
    request.contract.kind === 'projection'
  const packet = request.contract.packet
  if (isGameIrProjection) {
    if (!packet || typeof packet !== 'object' || Array.isArray(packet))
      throw new Error(
        'Game IR projection requires one immutable operation packet',
      )
    const currentSlice = gameIrProjectionSliceForRequest(request)
    const sliceContext = projectionSliceContextForRequest(request, currentSlice)
    const retryDiagnostic = projectionRetryDiagnosticForRequest(
      request.contract.retryDiagnostic,
      currentSlice.sliceId,
    )
    const authority = buildGameIrProjectionSliceAuthority({
      packet: packet as Parameters<
        typeof buildGameIrProjectionSliceAuthority
      >[0]['packet'],
      slice: currentSlice,
      sliceContext,
      compileRequestDigest:
        typeof request.contract.compileRequestDigest === 'string'
          ? request.contract.compileRequestDigest
          : undefined,
      foundationReadyReceiptDigest:
        typeof request.contract.foundationReadyReceiptDigest === 'string'
          ? request.contract.foundationReadyReceiptDigest
          : undefined,
      ...(retryDiagnostic ? { retryDiagnostic } : {}),
    })
    return renderGameIrProjectionSliceAuthority(authority)
  }
  const projected =
    packet && typeof packet === 'object' && !Array.isArray(packet)
      ? projectPacketForModel(
          request.workerType,
          packet as Record<string, unknown>,
        )
      : undefined
  const contract: Record<string, unknown> = {
    workerType: request.workerType,
    ...(typeof request.contract.kind === 'string'
      ? { kind: request.contract.kind }
      : {}),
    ...(typeof request.contract.checkId === 'string'
      ? { checkId: request.contract.checkId }
      : {}),
    ...(!(
      request.workerType === 'game-ir-compiler' &&
      request.contract.kind === 'projection'
    ) && Object.hasOwn(request.contract, 'correctionDiagnostic')
      ? { correctionDiagnostic: request.contract.correctionDiagnostic }
      : {}),
    ...(projected ? { packet: projected } : {}),
  }
  return JSON.stringify(contract)
}

function projectionRetryDiagnosticForRequest(
  value: unknown,
  currentSliceId: string,
): Parameters<typeof buildGameIrProjectionSliceAuthority>[0]['retryDiagnostic'] {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Game IR projection retry diagnostic is invalid')
  const diagnostic = value as Record<string, unknown>
  const scope = diagnostic.scope
  const expectedKeys =
    scope === 'slice'
      ? ['reason', 'scope', 'sliceId']
      : scope === 'record'
        ? ['fragmentId', 'reason', 'recordId', 'scope', 'sliceId']
        : undefined
  const keys = Object.keys(diagnostic).sort()
  if (!expectedKeys || keys.join('\n') !== expectedKeys.join('\n'))
    throw new Error('Game IR projection retry diagnostic is invalid')
  if (
    typeof diagnostic.sliceId !== 'string' ||
    diagnostic.sliceId !== currentSliceId ||
    typeof diagnostic.reason !== 'string' ||
    !diagnostic.reason.trim()
  )
    throw new Error('Game IR projection retry diagnostic is invalid')
  if (scope === 'slice')
    return {
      scope,
      sliceId: diagnostic.sliceId,
      reason: diagnostic.reason,
    }
  if (
    typeof diagnostic.recordId !== 'string' ||
    typeof diagnostic.fragmentId !== 'string' ||
    !diagnostic.recordId.trim() ||
    !diagnostic.fragmentId.trim()
  )
    throw new Error('Game IR projection retry diagnostic is invalid')
  return {
    scope: 'record',
    sliceId: diagnostic.sliceId,
    recordId: diagnostic.recordId,
    fragmentId: diagnostic.fragmentId,
    reason: diagnostic.reason,
  }
}

function projectionSliceContextForRequest(
  request: WorkerDispatchRequest,
  slice: GameIrProjectionSlice,
) {
  const moduleId = (
    [
      'gameplay',
      'balance',
      'world-scene',
      'presentation',
      'resource-realization',
      'implementation-verification',
    ] as const
  ).find(candidate =>
    deriveProjectionSlicePlan(candidate).slices.some(
      item => item.sliceId === slice.sliceId,
    ),
  )
  if (!moduleId)
    throw new Error('Game IR projection slice context module is missing')
  return normalizeGameIrProjectionSliceContext({
    moduleId,
    sliceId: slice.sliceId,
    value: request.contract.sliceContext,
  })
}

function gameIrProjectionSliceForRequest(
  request: WorkerDispatchRequest,
): GameIrProjectionSlice {
  const packet = request.contract.packet
  if (!packet || typeof packet !== 'object' || Array.isArray(packet))
    throw new Error(
      'Game IR projection requires one immutable operation packet',
    )
  const source = (packet as Record<string, unknown>).source
  if (
    !source ||
    typeof source !== 'object' ||
    Array.isArray(source) ||
    typeof (source as Record<string, unknown>).moduleId !== 'string'
  )
    throw new Error('Game IR projection packet source module is missing')
  const moduleId = (source as Record<string, unknown>).moduleId as Parameters<
    typeof deriveProjectionSlicePlan
  >[0]
  const candidate = request.contract.currentSlice
  const candidateSliceId =
    typeof candidate === 'string'
      ? candidate
      : candidate &&
          typeof candidate === 'object' &&
          !Array.isArray(candidate) &&
          typeof (candidate as Record<string, unknown>).sliceId === 'string'
        ? (candidate as Record<string, unknown>).sliceId
        : undefined
  if (!candidateSliceId)
    throw new Error(
      'Game IR projection request is missing its exact current slice',
    )
  const canonical = deriveProjectionSlicePlan(moduleId).slices.find(
    slice => slice.sliceId === candidateSliceId,
  )
  if (!canonical)
    throw new Error('Game IR projection current slice is stale or detached')
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    const keys = Object.keys(candidate).sort()
    if (
      keys.length === 3 &&
      keys[0] === 'nodeKinds' &&
      keys[1] === 'nodes' &&
      keys[2] === 'sliceId'
    ) {
      if (canonicalGameIrJson(candidate) !== canonicalGameIrJson(canonical))
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

function semanticRef(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  const ref = value as Record<string, unknown>
  if (typeof ref.documentPath !== 'string' || typeof ref.sectionId !== 'string')
    return undefined
  return {
    documentPath: ref.documentPath,
    sectionId: ref.sectionId,
    ...(typeof ref.heading === 'string' ? { heading: ref.heading } : {}),
  }
}

function modelSection(
  value: unknown,
  contentKey: 'text' | 'bytes',
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  const section = value as Record<string, unknown>
  const ref = semanticRef(section.ref ?? section)
  const content = section[contentKey]
  if (!ref || typeof content !== 'string') return undefined
  return {
    ...ref,
    ...(typeof section.sectionKey === 'string'
      ? { sectionKey: section.sectionKey }
      : {}),
    content,
  }
}

function projectItems<T>(
  values: unknown[],
  project: (value: unknown) => T | undefined,
  label: string,
): T[] {
  return values.map((value, index) => {
    const projected = project(value)
    if (projected === undefined)
      throw new Error(`model-facing ${label} item ${index} is invalid`)
    return projected
  })
}

function modelFact(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  const fact = value as Record<string, unknown>
  const source = semanticRef(fact.source)
  if (
    typeof fact.key !== 'string' ||
    source === undefined ||
    !('value' in fact)
  )
    return undefined
  return { key: fact.key, value: fact.value, source }
}

function modelIssue(
  value: unknown,
  includeId: boolean,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  const issue = value as Record<string, unknown>
  const source = semanticRef(issue.source)
  const remediation = issue.remediation
  if (
    (includeId && typeof issue.id !== 'string') ||
    typeof issue.expected !== 'string' ||
    typeof issue.actual !== 'string' ||
    source === undefined ||
    !remediation ||
    typeof remediation !== 'object' ||
    Array.isArray(remediation)
  )
    return undefined
  const fix = remediation as Record<string, unknown>
  const target =
    issue.target === undefined ? undefined : semanticRef(issue.target)
  if (
    fix.kind !== 'patch' ||
    typeof fix.documentPath !== 'string' ||
    !Array.isArray(fix.sectionIds) ||
    fix.sectionIds.some(sectionId => typeof sectionId !== 'string') ||
    (issue.target !== undefined && target === undefined)
  )
    return undefined
  return {
    ...(includeId ? { id: issue.id } : {}),
    ...(typeof issue.severity === 'string' ? { severity: issue.severity } : {}),
    ...(typeof issue.type === 'string' ? { type: issue.type } : {}),
    source,
    ...(target ? { target } : {}),
    expected: issue.expected,
    actual: issue.actual,
    remediation: {
      kind: 'patch',
      documentPath: fix.documentPath,
      sectionIds: fix.sectionIds,
    },
    ...(typeof issue.reasonCode === 'string'
      ? { reasonCode: issue.reasonCode }
      : {}),
  }
}

function projectPacketForModel(
  workerType: WorkerDispatchRequest['workerType'],
  packet: Record<string, unknown>,
): Record<string, unknown> {
  if (workerType === 'foundation-fact-extractor') {
    return {
      keys: Array.isArray(packet.keys) ? packet.keys : [],
      sections: Array.isArray(packet.sections)
        ? projectItems(
            packet.sections,
            section => modelSection(section, 'text'),
            'fact section',
          )
        : [],
    }
  }
  if (workerType === 'foundation-semantic-reviewer') {
    const projected: Record<string, unknown> = {
      ...(typeof packet.checkId === 'string'
        ? { checkId: packet.checkId }
        : {}),
      sections: Array.isArray(packet.sections)
        ? projectItems(
            packet.sections,
            section =>
              modelSection(section, 'bytes') ?? modelSection(section, 'text'),
            'semantic section',
          )
        : [],
      facts: Array.isArray(packet.facts)
        ? projectItems(packet.facts, modelFact, 'semantic fact')
        : [],
      deterministicIssuePrefix: Array.isArray(packet.deterministicIssuePrefix)
        ? projectItems(
            packet.deterministicIssuePrefix,
            issue => modelIssue(issue, false),
            'deterministic issue',
          )
        : [],
    }
    if (typeof packet.expected === 'string')
      projected.expected = packet.expected
    if (typeof packet.actual === 'string') projected.actual = packet.actual
    if (
      packet.patchOperation &&
      typeof packet.patchOperation === 'object' &&
      !Array.isArray(packet.patchOperation)
    ) {
      const operation = packet.patchOperation as Record<string, unknown>
      projected.patchOperation = {
        ...(typeof operation.kind === 'string' ? { kind: operation.kind } : {}),
        ...(typeof operation.documentPath === 'string'
          ? { documentPath: operation.documentPath }
          : {}),
        ...(typeof operation.sectionId === 'string'
          ? { sectionId: operation.sectionId }
          : {}),
      }
    }
    return projected
  }
  if (workerType === 'game-ir-compiler')
    return projectGameIrValidationPacket(packet)
  return packet
}

const MODEL_SERVICE_FIELDS = new Set([
  'schemaVersion',
  'taskId',
  'runId',
  'dispatchId',
  'ownerId',
  'revision',
  'compileRequest',
  'compileRequestDigest',
  'foundationRevision',
  'foundationReceiptDigest',
  'sourceDigest',
  'mechanicalReceiptDigest',
  'semanticReceiptDigest',
  'packetDigest',
  'authoritySectionIndex',
  'authoritySectionIndexDigest',
  'moduleDigest',
  'targetManifestDigest',
  'identity',
])

function modelGameIrSection(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  const section = value as Record<string, unknown>
  if (
    typeof section.documentPath !== 'string' ||
    typeof section.sectionId !== 'string'
  )
    return undefined
  return {
    documentPath: section.documentPath,
    sectionId: section.sectionId,
    ...(typeof section.heading === 'string'
      ? { heading: section.heading }
      : {}),
  }
}

function modelGameIrValidationSection(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  const section = value as Record<string, unknown>
  const ref = modelGameIrSection(section.ref ?? section)
  if (!ref || typeof section.bytes !== 'string') return undefined
  return { ...ref, bytes: section.bytes }
}

function projectGameIrDependencies(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectGameIrDependencies)
  if (!value || typeof value !== 'object') return value
  if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (MODEL_SERVICE_FIELDS.has(key) || key.toLowerCase().endsWith('digest'))
      continue
    result[key] = projectGameIrDependencies(child)
  }
  return result
}

function modelGameIrModule(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  const module = value as Record<string, unknown>
  if (typeof module.moduleId !== 'string' || !Array.isArray(module.nodes))
    return undefined
  return { moduleId: module.moduleId, nodes: module.nodes }
}


function projectGameIrValidationPacket(
  packet: Record<string, unknown>,
): Record<string, unknown> {
  const projected: Record<string, unknown> = {}
  if (
    typeof packet.moduleId === 'string' &&
    typeof packet.moduleBytes === 'string'
  )
    projected.candidate = {
      moduleId: packet.moduleId,
      moduleBytes: packet.moduleBytes,
    }
  if (Array.isArray(packet.sourceSections))
    projected.sourceSections = projectItems(
      packet.sourceSections,
      modelGameIrValidationSection,
      'Game IR validation source section',
    )
  if (Array.isArray(packet.priorModules))
    projected.priorModules = projectItems(
      packet.priorModules,
      modelGameIrModule,
      'Game IR validation prior module',
    )
  for (const key of [
    'externalProjections',
    'presentationRequirements',
    'checkIds',
    'requiredTargets',
    'allowedEvidencePointers',
  ]) {
    if (Object.hasOwn(packet, key))
      projected[key] = projectGameIrDependencies(packet[key])
  }
  return projected
}

function projectRevisionPacketForModel(
  packet: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(typeof packet.documentPath === 'string'
      ? { documentPath: packet.documentPath }
      : {}),
    ...(Array.isArray(packet.issueIds) ? { issueIds: packet.issueIds } : {}),
    ...(Array.isArray(packet.sectionIds)
      ? { sectionIds: packet.sectionIds }
      : {}),
    issues: Array.isArray(packet.issues)
      ? projectItems(
          packet.issues,
          issue => modelIssue(issue, true),
          'revision issue',
        )
      : [],
    sections: Array.isArray(packet.sections)
      ? projectItems(
          packet.sections,
          section => modelSection(section, 'text'),
          'revision section',
        )
      : [],
    normalizedFacts: Array.isArray(packet.normalizedFacts)
      ? projectItems(packet.normalizedFacts, modelFact, 'revision fact')
      : [],
    ...(Array.isArray(packet.factConstraints)
      ? { factConstraints: packet.factConstraints }
      : {}),
  }
}

function formatContract(request: WorkerDispatchRequest): string {
  if (request.workerType === 'resource-content-author')
    return JSON.stringify(formatResourceContentContract(request.contract))
  const {
    confirmedBriefContext: _confirmedBriefContext,
    ...contractWithoutDuplicatedBrief
  } = request.contract
  const initialFoundationAuthor =
    request.workerType === 'document-author' &&
    request.contract.documentSet === 'foundation' &&
    ['initial', 'parallel-draft'].includes(
      String(request.contract.authoringMode),
    )
  if (initialFoundationAuthor) {
    delete contractWithoutDuplicatedBrief.availableUpstreamPaths
    const completeDocumentContract =
      contractWithoutDuplicatedBrief.completeDocumentContract
    if (
      completeDocumentContract &&
      typeof completeDocumentContract === 'object' &&
      !Array.isArray(completeDocumentContract)
    ) {
      const {
        allowedUpstreamPaths: _allowedUpstreamPaths,
        upstreamSections: _upstreamSections,
        sections,
        productionMaterials,
        ...authorDocumentContract
      } = completeDocumentContract as Record<string, unknown>
      contractWithoutDuplicatedBrief.completeDocumentContract = {
        ...authorDocumentContract,
        mechanicalMarkdownProtocol: {
          documentTitle: {
            position: 'first_non_blank_line',
            headingPrefix: '# ',
          },
          executiveSummary: {
            heading: '## Executive Summary',
          },
          sections: Array.isArray(sections)
            ? sections.map(value => {
                const section = value as Record<string, unknown>
                return {
                  ...section,
                  heading: `## ${section.title}`,
                }
              })
            : sections,
          productionMaterials: {
            heading: '## Production Materials',
            reservedH3Headings: Array.isArray(productionMaterials)
              ? productionMaterials.map(value => {
                  const material = value as Record<string, unknown>
                  return `### ${material.title}`
                })
              : [],
            placement:
              'each reserved H3 appears exactly once under the final ## Production Materials heading and never inline in an owning prose section',
            entries: Array.isArray(productionMaterials)
              ? productionMaterials.map(value => {
                  const material = value as Record<string, unknown>
                  const serialization = material.serialization
                  const serializationRule =
                    serialization === 'markdown_table'
                      ? 'Markdown table only: include a header row, a separator row, and data rows; do not use a fenced code block, YAML, JSON, or a key-value list.'
                      : serialization === 'mermaid'
                        ? 'Mermaid only: use one fenced ```mermaid block; do not replace it with prose, JSON, YAML, or a key-value list.'
                        : serialization === 'inline_svg'
                          ? 'Inline SVG only: use one inline <svg>...</svg> block; do not replace it with a fenced code block, JSON, YAML, or a key-value list.'
                          : undefined
                  return {
                    ...material,
                    heading: `### ${material.title}`,
                    ...(serializationRule ? { serializationRule } : {}),
                  }
                })
              : productionMaterials,
          },
          closedHeadingSet: [
            '## Executive Summary',
            ...(Array.isArray(sections)
              ? sections.map(
                  value => `## ${(value as Record<string, unknown>).title}`,
                )
              : []),
            '## Production Materials',
          ],
          additionalH2: 'forbidden',
          supportingContent:
            'must be nested under one of the closed H2 headings',
        },
      }
    }
    if (request.contract.foundationDocumentPath !== 'docs/TECHNICAL_DESIGN.md')
      delete contractWithoutDuplicatedBrief.systemDeliveryContract
  }
  return JSON.stringify(contractWithoutDuplicatedBrief)
}

function formatResourceContentContract(
  contract: Record<string, unknown>,
): Record<string, unknown> {
  const allowedKeys = [
    'task',
    'contentRoot',
    'schema',
    'jsonKinds',
    'yamlKinds',
    'authorityPaths',
    'repairPaths',
    'currentContentIssues',
    'requiredRequirementIds',
    'verifiedResourceIds',
    'inventoryBindings',
    'inventoryRevision',
    'baselineResourceRevision',
  ] as const
  const projection = Object.fromEntries(
    allowedKeys.flatMap(key =>
      Object.hasOwn(contract, key) ? [[key, contract[key]]] : [],
    ),
  )
  return projection
}

function workerInstruction(request: WorkerDispatchRequest): string {
  switch (request.workerType) {
    case 'game-ir-compiler':
      if (request.contract.kind === 'projection')
        return 'Project only the current dependency-frontier slice from the immutable operation packet; never project or assemble the complete domain. The `## Current slice` heading is the sole node-kind authority for this turn: use only its exact node kinds, value properties/types, and per-node `edgeRules` roles/targetKinds/cardinality and `referencePolicy`; do not invent fields or generic edge names. Apply every declared `referencePolicy` exactly. When `referencePolicy.kind` is `exact-edge-targets`, references must be the sorted targetId multiset of the node edges, with no unrelated references. When `referencePolicy.kind` is `exact-single-index-reference`, references must contain exactly one target whose targetType is one of targetKinds, and the value at indexField must equal requiredIndex. If the `## Retry diagnostic` heading is present, correct that exact admitted failure in this slice; it is not product authority and does not authorize another slice. Every emitted node must satisfy every `edgeRules` cardinality: exactly-one and at-least-one roles cannot be omitted, and singleton roles cannot repeat. The `## Dependency context` heading is binding admitted graph state: emit every required current-node item with its exact id and kind; when an edge or reference targets an admitted kind, use the exact available prior-node id, kind, and value semantics, including terminal and outcome values. Emit nodes uniquely sorted by id; sort each references array by targetId then targetType and each edges array by type then targetId then targetType. The service rejects rather than repairs non-canonical order. Emit each node with exactly the declared node fields; references use {targetId,targetType}; every edge requires edges[].type, edges[].targetId, and edges[].targetType, mapping `edgeRules[].role` to type and the selected target identity to targetId/targetType. Bind every node to exactly one fragmentId selected from the rendered `## Source fragments` heading. The service derives source evidence groups and canonical semantic targets; never output either of them. Never copy or synthesize source text and never output subjects, documentPath, sectionId, excerpt, byte offsets, sourcePointer, literal, occurrence, or serialized edge/reference JSON in evidence. The rendered `## Output contract` heading is binding: emit strict JSONL node records and exactly one final done record. Do not validate or assemble other slices, write checkpoints, publish, or provide service identity.'
      if (request.contract.kind === 'validation')
        return 'Perform only the assigned domain validation from the immutable operation packet. Return one validation result for this operation: PASS with checkIds and coveredTargets, or FAIL/AMBIGUOUS with one concrete diagnostic. Do not project, assemble a complete candidate, write checkpoints, publish, or provide service identity.'
      throw new Error(
        'Game IR worker requires one operation kind: projection or validation',
      )
    case 'foundation-fact-extractor':
      return [
        'Extract only the declared fact keys from the exact packet sections.',
        ...factExtractionInstructions(request),
        'Account for every assigned key exactly once as present, absent, or uncertain. Present values must be typed. Do not return evidence, section prose, or values not declared by the packet.',
      ].join(' ')
    case 'foundation-semantic-reviewer':
      if (request.contract.kind === 'confirmation')
        return 'This is a strong independent confirmation of the completed source task. Re-evaluate only the same immutable packet and the same check, and return your own supported PASS, ISSUES, or UNDECIDABLE outcome. Do not inherit or preserve the source outcome. Do not expand scope, create a second audit track, introduce a new check, or read any other context.'
      if (typeof request.contract.issueId === 'string')
        return 'Recheck only the admitted Issue expected against the packet current evidence. Return only PASS or FAIL in the supplied StructuredOutput schema. PASS means the exact expected is now true and the admitted actual is removed. FAIL requires one structured diagnostic grounded in packet evidence; do not discover, split, rewrite, or remediate Issues.'
      return [
        'Review only the exact semantic packet sections, normalized facts, and deterministic references.',
        FOUNDATION_SEMANTIC_REMEDIATION_CONTRACT,
        'Issue drafts must use only assigned section keys and contain no IDs.',
      ].join(' ')
    case 'foundation-document-reviser':
      return [
        'Revise only the assigned staged canonical Markdown document and exact target sections for the supplied Issue Registry issue IDs. Read and write only the staged path; never modify the canonical document or unrelated paths.',
        'Preserve all section markers and document structure. Make every admitted expected true and remove each admitted actual; never use aliases, compatibility notes, risk registration, wording qualifications or downstream reinterpretation as a substitute. Submit APPLIED; the service owns task, round, document, Issue and base-authority identity and derives changed sections from canonical bytes.',
      ].join(' ')
    case 'document-author':
      return [
        request.contract.documentSet === 'checklist'
          ? ''
          : request.contract.authoringMode === 'initial' ||
              request.contract.authoringMode === 'parallel-draft'
            ? ''
            : 'Unsupported Foundation document authoring mode.',
        request.contract.documentSet === 'checklist'
          ? [
              `Author only the Checklist candidate at ${documentAuthorTargetPath(request)} from the injected frozen Checklist Authority Projection.`,
              'Every acceptance task must be one Markdown checkbox line with a stable ID, source tag, observable behavior and evidence expectation. Create a task only for a distinct, independently observable acceptance condition explicitly present in a SCENARIO block. Do not expand sentences, table rows, variants, prior checklist entries, or generic best practice into new work.',
              'Merge equivalent variants when they share one setup, action and observable outcome. Keep each task independently pass/fail and cite its one owning source block.',
              'Use the canonical form `- [ ] <stable-id> [docs/path.md#source_block] <observable check and evidence expectation>`. For a GATE REFERENCE use exactly `Owner gate passes; evidence: linked owner validation.` after its source tag; never copy or expand its owner details. Tables may add context but cannot replace checkbox tasks.',
              'Do not modify foundation documents, resources, the asset manifest or implementation files.',
            ].join(' ')
          : request.contract.authoringMode === 'parallel-draft'
            ? [
                `Return exactly one complete raw Markdown body for ${String(request.contract.foundationDocumentPath)} as the visible response. Do not call tools, return JSON, use a code fence, or add a completion explanation.`,
                FOUNDATION_AUTHOR_AUTHORITY_INSTRUCTION,
                DOCUMENT_AUTHORING_DENSITY_INSTRUCTION,
                'Write the complete canonical Markdown body without YAML front matter or beegame protocol comments. BGS injects all beegame protocol comments and performs mechanical contract validation after the turn.',
              ].join(' ')
            : request.contract.authoringMode === 'initial'
              ? [
                  `Return exactly one complete raw Markdown body for ${String(request.contract.foundationDocumentPath)} as the visible response. Do not call tools, return JSON, use a code fence, or add a completion explanation. This is one complete human development discipline assignment. Together, the eight documents must be sufficient for a human game development team to plan, build, produce, test, release and operate the approved game. Resolve this discipline now rather than delegating completeness to review.`,
                  'The assigned Markdown must be complete and production-usable when the turn ends. The Markdown body is the sole human document authority and contains exactly one # document title. The first non-blank line must be the single # document title. Follow canonical structures in order: ## Executive Summary, every contract section, then every production material in canonical order. Do not author YAML front matter or beegame protocol comments. BGS injects document_id, version and updated_at deterministically. BGS injects all beegame protocol comments after the turn. Do not add an Audit Appendix; BGS writes those results to workflow audit metadata.',
                  FOUNDATION_AUTHOR_AUTHORITY_INSTRUCTION,
                  DOCUMENT_AUTHORING_DENSITY_INSTRUCTION,
                  'Provide concrete choices, tradeoffs, examples, units, boundaries and observable criteria so the discipline is implementable and testable. Do not author .beegame metadata. Do not claim verified license status without concrete evidence.',
                  'BGS performs mechanical contract validation after the turn and the dedicated Review stage owns independent audit; do not launch or wait for an independent review or audit.',
                  ...(request.contract.foundationDocumentPath ===
                  'docs/ASSET_PLAN.md'
                    ? [
                        'Define a reusable many-to-many semantic resource responsibility registry, source and license evidence, dependency and milestone ownership. Do not create one physical file per destination or invent Resource Library identities that were not observed.',
                      ]
                    : []),
                  ...(request.contract.foundationDocumentPath ===
                  'docs/TECHNICAL_DESIGN.md'
                    ? [
                        'Apply contract.systemDeliveryContract as the fixed delivery boundary and define one Manifest, one content root, one schema and one resource loading path without binding an unapproved engine or platform.',
                      ]
                    : []),
                  ...(typeof request.contract.changeRequest === 'string' &&
                  request.contract.changeRequest.trim()
                    ? [
                        'Apply the confirmed change request to the controlled baseline and preserve unrelated valid content.',
                      ]
                    : []),
                  'Do not create the checklist, asset manifest, resources or implementation.',
                ].join(' ')
              : 'Unsupported Foundation document authoring mode.',
      ].join(' ')
    case 'resource-planner':
      return [
        'Create the canonical Resource Production plan from only contract.authorityPaths and the confirmed brief. ASSET_PLAN owns the complete resource duties, ART_DIRECTION owns presentation constraints, and TECHNICAL_DESIGN owns runtime-consumable output formats. Do not reopen review or read other project documents.',
        'Use AssetManifest submit_resource_plan exactly once. The service owns Manifest version, resource policy and canonical roots. Submit runtime target capabilities and complete stable requirements. Every requirement must include one structured acquisition_profile containing only canonical dimensions, asset kinds, usage tags, source-intrinsic required capabilities and approved style values. Composition, placement, scaling, connection, scene assembly and runtime behavior are content or implementation duties, never source-intrinsic acquisition constraints. Never infer this profile from IDs or filenames.',
        'Never use target output formats as source-format admission rules. Source material may use another format when the current target adapter declares a deterministic direct or conversion delivery capability.',
        'Do not browse the Resource Library, create or download files, write JSON/YAML, or implement gameplay. A successful plan submission ends this dispatch.',
      ].join(' ')
    case 'resource-curator':
      return [
        'Acquire or author the complete resource inventory for the established Manifest plan. Read only contract.authorityPaths and the Manifest. Do not modify requirements or content files.',
        'Call ResourceLibrary match_requirements once. For a matched requirement, choose one returned bundle and judge only its authored metadata and technical facts, never filename, keywords, regular expressions, project names or requirement IDs. A no-match requirement may use one or more independently replaceable placeholders when its declared duties need separate resources; never mix library and placeholder decisions for one requirement.',
        'A suitable candidate may satisfy its requirement through direct delivery or a declared target conversion adapter. Choose exact candidate identities. Use a placeholder decision for every service-proven no-match group so missing library material never stops delivery.',
        'Submit one complete decision set through CommitResourceInventory. If a prior submission created a prepared or applying durable receipt, submit decisions: [] to resume that exact receipt instead of reconstructing decisions. It is the only mutation and terminal operation, preserves exact dependency closure, resumes durable progress after interruption, and derives bindings from the committed inventory. Do not write content or gameplay code.',
      ].join(' ')
    case 'resource-content-author': {
      const writablePaths = Array.isArray(request.contract.repairPaths)
        ? request.contract.repairPaths.filter(
            (path): path is string => typeof path === 'string',
          )
        : []
      return [
        `Build the engine-neutral JSON/YAML documents at the exact writable paths in contract.repairPaths: ${writablePaths.length ? writablePaths.join(', ') : '<none>'}. Submit one documents object keyed by those exact paths. Bee Game Studio's native tools remain available for inspection, reasoning, and verification. Use contract.authorityPaths, contract.requiredRequirementIds, contract.verifiedResourceIds, and contract.inventoryBindings as the task authority. CommitResourceContent is the atomic delivery interface for the final document set and preserves every canonical document outside the writable path list.`,
        'Use exactly contract.schema. JSON owns only contract.jsonKinds and YAML owns only contract.yamlKinds. Every submitted document contains exactly path, schema, id, kind, fulfills, resources and data. One coherent document may fulfill several requirements. fulfills contains only exact contract requirement IDs and resources contains only exact contract resource IDs. The single resource-registry data.bindings is the only requirement-to-resource binding representation and must agree with contract.inventoryBindings. Never duplicate the same fact in JSON and YAML.',
        'When the complete writable set is ready, call CommitResourceContent once. The service serializes JSON/YAML and validates the merged set before replacing any file.',
        'The service preserves every canonical document outside the exact writable path list during the atomic commit; never read, resubmit or rewrite those documents.',
        'If verified inventory is genuinely missing, call CommitResourceContent needs_inventory with the exact missing requirement IDs. Do not invent a path, identity or embedded substitute.',
      ].join(' ')
    }
    case 'atomic-task-planner':
      return [
        'Use contract.planningDocuments plus resourceIds and contentIds as the acceptance authority. Bee Game Studio may inspect the current workspace and use its native tools as needed to produce a correct plan.',
        'Submit one dependency graph through SubmitAtomicTaskPlan. Each task owns durable implementation artifacts and project-owned verification actions. Checklist items have one owner; resource and content IDs are read-only dependencies.',
        'Resources and content are ready before implementation. Tasks consume declared files; they do not download, generate substitute media or mutate assets/asset-manifest.json.',
        'Do not create trailing cleanup, final verification or acceptance tasks. The workflow owns those phases.',
      ].join(' ')
    case 'implementation-worker':
      return [
        'Implement the active atomic task completely within allowedPaths. Treat current source, direct dependencies, verified resources, declared JSON/YAML content, and canonical design documents as available context.',
        'Bee Game Studio may inspect the project and use its native tools as needed. Keep changes within the active task deliverables; resource acquisition and manifest changes remain separate workflow deliverables.',
        'Execute every deterministic test, build, file and asset verification with project-owned tooling. Runtime checks are deferred to acceptance.',
      ].join(' ')
    case 'implementation-auditor':
    case 'acceptance-validator':
    case 'change-impact-analyzer':
    case 'question-answerer':
      return 'Perform the assigned review or analysis as a read-only worker. Do not modify project files.'
  }
}

function factExtractionInstructions(request: WorkerDispatchRequest): string[] {
  const packet = request.contract.packet
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return []
  const keys = (packet as { keys?: unknown }).keys
  if (!Array.isArray(keys)) return []
  return keys.flatMap(key => {
    if (typeof key !== 'string') return []
    const instruction = foundationFactDefinition(key)?.extractionInstruction
    return instruction ? [`Fact ${key}: ${instruction}`] : []
  })
}

function terminalInstruction(request: WorkerDispatchRequest): string {
  switch (request.workerType) {
    case 'game-ir-compiler':
      if (request.contract.kind === 'projection')
        return 'Return raw NDJSON only, with no Markdown fence, prose, array wrapper, object wrapper, tool call, or blank line. Emit one line per node exactly as {"record":"node","sliceId":"<current exact sliceId>","fragmentId":"<one exact evidence fragmentId>","node":{...}}. After the final node emit exactly one terminal line {"record":"done","sliceId":"<current exact sliceId>"}. The done line must be last. When continuation is requested, continue from the exact byte where the stream stopped without repeating prior records. Identity, evidence groups, checkpoints, publication markers, READY receipts, sourceClaims, outcome and authority paths are service-owned and forbidden in worker output.'
      if (request.contract.kind === 'validation')
        return 'Return exactly one validation payload conforming to the supplied schema. A completed payload contains only validation; failed or blocked payloads contain only reason. Identity, checkpoints, publication markers, READY receipts, and authority paths are service-owned and forbidden in worker output.'
      throw new Error(
        'Game IR worker requires one operation kind: projection or validation',
      )
    case 'foundation-fact-extractor':
      return 'Return exactly one native StructuredOutput value conforming to the supplied foundation fact schema with the complete bounded result set. For each assigned key, return exactly one status: present requires key, status, and value; omit evidence and reason. Absent requires only key and status and must omit value, evidence, and reason. Uncertain requires key, status, and reason; omit evidence and value. The service binds immutable provenance from the packet owner section into the durable terminal.'
    case 'foundation-semantic-reviewer':
      if (typeof request.contract.issueId === 'string')
        return 'Return exactly one native StructuredOutput value conforming to the targeted semantic recheck schema. Use PASS without diagnostic, or FAIL with exactly one structured diagnostic containing observedActual, evidence, and failureReasonCode. Do not return ISSUES or UNDECIDABLE; the service determines scope assessment.'
      return 'Return exactly one native StructuredOutput value conforming to the supplied semantic schema. Use exactly one outcome shape: PASS omits issues and reason; ISSUES includes a non-empty issues array and omits reason; UNDECIDABLE includes reason and omits issues.'
    case 'foundation-document-reviser':
      return 'Complete the assigned staged Markdown revision so every admitted expected is true and every admitted actual is removed. Call SubmitFoundationRevisionResult exactly once with APPLIED; do not submit task, round, document or Issue identity, and do not end with prose completion text.'
    case 'document-author':
      return request.contract.documentSet === 'foundation' &&
        (request.contract.authoringMode === 'initial' ||
          request.contract.authoringMode === 'parallel-draft')
        ? ''
        : request.contract.authoringMode === 'initial'
          ? `Ensure the assigned Markdown game document at ${documentAuthorTargetPath(request)} is complete and end the turn normally. The native runtime owns the file-operation sequence.`
          : `Ensure the assigned Markdown document at ${documentAuthorTargetPath(request)} is complete and end the turn normally. The native runtime owns the file-operation sequence.`
    case 'resource-planner':
      return 'Call AssetManifest submit_resource_plan exactly once. Do not continue after the accepted call.'
    case 'resource-curator':
      return 'Call CommitResourceInventory exactly once with the complete bounded-match decision set, or with decisions: [] when resuming an existing prepared/applying receipt. The committed receipt is the terminal; do not return terminal JSON.'
    case 'resource-content-author':
      return 'Call CommitResourceContent exactly once with exactly the frozen writable document paths, or with the exact needs_inventory requirement IDs. The accepted call is the terminal; do not return terminal JSON or completion prose.'
    case 'atomic-task-planner':
      return 'Call SubmitAtomicTaskPlan exactly once. Assign every checklist ID to one task and declare resource/content dependencies directly on tasks.'
    case 'implementation-worker':
      return 'Call SubmitImplementationResult exactly once with status, changedPaths and one concise verification observation per task verification. Do not submit resource-binding arrays, verifiedArtifacts, terminal JSON or workflow evidence.'
    case 'implementation-auditor':
    case 'acceptance-validator':
      return 'Call SubmitValidationResult exactly once with status and findings. Passed requires no findings; failed or blocked requires actionable findings. Do not submit ownership IDs, terminal JSON or workflow evidence.'
    case 'change-impact-analyzer':
      return 'Call SubmitChangeImpactResult exactly once with classification, affected IDs and rationale.'
    case 'question-answerer':
      return 'Call SubmitQuestionAnswerResult exactly once with only the answer.'
  }
}

function documentAuthorTargetPath(request: WorkerDispatchRequest): string {
  return request.contract.documentSet === 'checklist'
    ? String(request.allowedPaths?.[0])
    : String(request.contract.foundationDocumentPath)
}
