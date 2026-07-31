import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import {
  ProjectResourceApplication,
  type ProjectResourceSelectionClient,
} from './project-resource-application'
import type { ResourceCatalogFilterInput } from './resource-selection-client'
import {
  BEEGAME_RESOURCE_NO_MATCH_OUTCOMES,
  effectiveAssetFormats,
  readBeeGameAssetManifest,
  recordBeeGameResourceNoMatchInWorkspace,
  type BeeGameRequirementDiscoveryReceipt,
} from './asset-contracts'

const MAX_CATALOG_PAGE_ITEMS = 16

const explicitImportSelectionSchema = z
  .object({
    import_id: z.string().min(1),
    requirement_ids: z.array(z.string().min(1)).min(1),
    pack_id: z.string().min(1),
    expected_pack_version: z.string().min(1),
    element_id: z.string().min(1),
    destination_path: z.string().min(1),
    selection_reason: z.array(z.string().min(1)).min(1).max(8),
  })

const resourceLibraryInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('query_candidates'),
    requirement_ids: z.array(z.string().min(1)).min(1),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(MAX_CATALOG_PAGE_ITEMS).optional(),
  }),
  z.object({
    action: z.literal('import_elements'),
    selections: z.array(explicitImportSelectionSchema).min(1).max(64),
  }),
  z.object({
    action: z.literal('record_no_match'),
    requirement_ids: z.array(z.string().min(1)).min(1),
    outcome: z.enum(BEEGAME_RESOURCE_NO_MATCH_OUTCOMES),
    reasons: z.array(z.string().trim().min(1)).min(1).max(8),
  }),
  z.object({ action: z.literal('refresh_import_metadata') }),
])

type ResourceLibraryInput = z.infer<typeof resourceLibraryInputSchema>
type BuildTool = (definition: Record<string, unknown>) => unknown
type ProjectResourceFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export function createNativeResourceLibraryTool(options: {
  buildTool: BuildTool
  workspacePath: string
  client: ProjectResourceSelectionClient
  fetchImpl?: ProjectResourceFetch
  catalogReadLimit?: number
}): unknown {
  const application = new ProjectResourceApplication(
    options.client,
    options.fetchImpl,
  )
  const catalogReadLimit = Math.max(
    1,
    Math.trunc(options.catalogReadLimit ?? 12),
  )
  let catalogReadsSinceMutation = 0
  let callInFlight = false
  let candidateObservation:
    | {
        requirementKey: string
        requirementIds: string[]
        queryDigest: string
        catalogRevision?: string
        candidateIds: Set<string>
        packIds: Set<string>
        total: number
        decisionReady: boolean
        structuredConstraintCount: number
      }
    | undefined
  const catalogBudget = () => ({
    limit: catalogReadLimit,
    used: catalogReadsSinceMutation,
    remaining: Math.max(0, catalogReadLimit - catalogReadsSinceMutation),
  })
  const catalogResult = <T extends Record<string, unknown>>(data: T) => ({
    data: { ...data, catalog_budget: catalogBudget() },
  })
  return options.buildTool({
    name: 'ResourceLibrary',
    alwaysLoad: true,
    maxResultSizeChars: 16_000,
    inputSchema: resourceLibraryInputSchema,
    isConcurrencySafe: () => false,
    isReadOnly: (input: ResourceLibraryInput) =>
      input.action !== 'import_elements' &&
      input.action !== 'record_no_match' &&
      input.action !== 'refresh_import_metadata',
    async description() {
      return 'Query exact cross-Pack candidates for the active manifest responsibilities, then either import a proven selection or record the approved no-match outcome. BeeGame never chooses artistic suitability for you.'
    },
    async prompt() {
      return [
        'ResourceLibrary is an exact catalog and import capability. BeeGame does not select resources, infer intent, rank artistic compatibility, or author target-runtime compositions.',
        'Catalog results are paginated. Pack and element records expose authored metadata, preview descriptors, dependency information, semantic relations and objective technical facts when available.',
        'Catalog filters are exact metadata constraints derived from the canonical requirement group. Do not translate, broaden, or invent free-text filter values. Facets describe the available catalog scope even when the exact query returns zero items.',
        'For semantic selection, element usageTags are authoritative. Pack dimension, style and game type provide compatibility context, while element category, format, assetKind, capabilities and contentProfile provide technical facts. Names, paths, folders and Pack tags may identify or discover records but never prove what gameplay or art responsibility an element can fulfill.',
        'query_candidates derives exact filters from the supplied canonical manifest requirement IDs and searches reusable elements across every published Pack. Page until decision_ready is true before recording no-match.',
        'Read actions do not modify the project. import_elements copies only the exact elements supplied by Claude Code, pins their Pack versions and includes their declared dependency closures. record_no_match atomically records the already-approved non-library source outcome with the completed canonical discovery receipt. These actions own manifest mutation; never hand-author their records. refresh_import_metadata updates objective facts for existing pinned imports.',
        'Every import_elements selection must identify all current manifest requirement_ids it genuinely satisfies. One imported element may be reused by multiple requirements; BeeGame validates every requirement format contract before downloading and records those bindings atomically.',
        'New imports are accepted only while the canonical requirements declare enough resource_requirement.import_budget capacity. This budget is project inventory authority derived from the approved asset plan, not permission to import unrelated candidates.',
        'This tool reports catalog, provenance, copied-file and dependency facts only. It cannot mark a target-runtime composition complete or certify rendering, loading, visual quality, interaction, audio playback, gameplay, or player paths. Use the target runtime, native Skills and native Validator for those observations.',
        'Choose how and when to use these actions from the confirmed project context and the native capabilities available in the current session.',
      ].join(' ')
    },
    async checkPermissions(input: ResourceLibraryInput) {
      if (
        input.action !== 'import_elements' &&
        input.action !== 'record_no_match' &&
        input.action !== 'refresh_import_metadata'
      )
        return { behavior: 'allow', updatedInput: input }
      if (input.action === 'refresh_import_metadata')
        return {
          behavior: 'ask',
          message:
            'Allow objective metadata for existing Resource Library imports to be refreshed from their pinned Pack versions?',
          updatedInput: input,
        }
      if (input.action === 'record_no_match')
        return { behavior: 'allow', updatedInput: input }
      return {
        behavior: 'ask',
        message: `Allow ${input.selections.length} explicitly selected Resource Library element(s) to be copied into this project?`,
        updatedInput: input,
      }
    },
    async call(input: ResourceLibraryInput) {
      if (callInFlight) {
        throw new Error(
          'ResourceLibrary accepts one operation at a time. Wait for the current result before choosing the next catalog read or import.',
        )
      }
      callInFlight = true
      try {
        const catalogRead = input.action === 'query_candidates'
        if (catalogRead && catalogReadsSinceMutation >= catalogReadLimit) {
          throw new Error(
            `ResourceLibrary catalog budget is exhausted after ${catalogReadLimit} reads. Import a proven selection or finish with the concrete catalog blocker; another catalog read was not executed.`,
          )
        }
        if (input.action === 'query_candidates') {
          const query = await deriveCandidateQuery(
            options.workspacePath,
            input.requirement_ids,
          )
          const requirementKey = query.requirementIds.join('\0')
          if (!input.cursor) {
            candidateObservation = {
              requirementKey,
              requirementIds: query.requirementIds,
              queryDigest: query.queryDigest,
              candidateIds: new Set(),
              packIds: new Set(),
              total: 0,
              decisionReady: false,
              structuredConstraintCount: query.structuredConstraintCount,
            }
          } else if (candidateObservation?.requirementKey !== requirementKey) {
            throw new Error(
              'Resource candidate cursor does not belong to these requirements',
            )
          }
          const page = await application.queryCandidates({
            filters: query.filters,
            ...(input.cursor ? { cursor: input.cursor } : {}),
            ...(input.limit ? { limit: input.limit } : {}),
          })
          catalogReadsSinceMutation += 1
          const observation = candidateObservation!
          const snapshotQueryDigest = digest([
            query.queryDigest,
            page.catalogRevision,
            JSON.stringify(page.normalizedFilters),
          ])
          if (
            observation.catalogRevision &&
            (observation.catalogRevision !== page.catalogRevision ||
              observation.queryDigest !== snapshotQueryDigest)
          )
            throw new Error(
              'Resource candidate catalog changed during pagination',
            )
          observation.catalogRevision = page.catalogRevision
          observation.queryDigest = snapshotQueryDigest
          if (observation.candidateIds.size && observation.total !== page.total)
            throw new Error('Resource candidate catalog changed during pagination')
          observation.total = page.total
          for (const element of page.items) {
            observation.candidateIds.add(
              `${element.packId}:${element.elementId}`,
            )
            observation.packIds.add(element.packId)
          }
          observation.decisionReady =
            !page.nextCursor && observation.candidateIds.size === page.total
          return catalogResult(
            compactCandidatePage(page, observation.decisionReady),
          )
        }
        if (input.action === 'import_elements') {
          const observation = candidateObservation
          if (!observation)
            throw new Error(
              'Query candidates before importing Resource Library elements',
            )
          const observedRequirementIds = new Set(observation.requirementIds)
          for (const selection of input.selections) {
            if (
              selection.requirement_ids.some(
                requirementId => !observedRequirementIds.has(requirementId),
              )
            )
              throw new Error(
                'Import selections must bind only the active candidate requirement group',
              )
            if (
              !observation.candidateIds.has(
                `${selection.pack_id}:${selection.element_id}`,
              )
            )
              throw new Error(
                `Resource candidate was not observed in the active exact query: ${selection.pack_id}:${selection.element_id}`,
              )
          }
          const selections = await Promise.all(
            input.selections.map(async selection => ({
              importId: selection.import_id,
              requirementIds: selection.requirement_ids,
              packId: selection.pack_id,
              expectedPackVersion: selection.expected_pack_version,
              elementId: selection.element_id,
              destinationPath: selection.destination_path,
              selectionReason: selection.selection_reason,
            })),
          )
          const result = await application.importExplicitSelections(
            options.workspacePath,
            selections,
          )
          if (result.results.some(item => item.status === 'available')) {
            catalogReadsSinceMutation = 0
            candidateObservation = undefined
          }
          return { data: summarizeImportBatch(result) }
        }
        if (input.action === 'record_no_match') {
          const requirementIds = [...new Set(input.requirement_ids)].sort()
          const requirementKey = requirementIds.join('\0')
          const observation = candidateObservation
          if (
            !observation ||
            observation.requirementKey !== requirementKey ||
            !observation.decisionReady
          )
            throw new Error(
              'Complete query_candidates pagination for these requirements before recording no-match',
            )
          const candidateIds = [...observation.candidateIds].sort()
          const packIds = [...observation.packIds].sort()
          const receipt: BeeGameRequirementDiscoveryReceipt = {
            version: 1,
            query_digest: observation.queryDigest,
            candidate_digest: digest(candidateIds),
            candidate_ids: candidateIds,
            inspected_pack_ids: packIds,
            represented_pack_ids: packIds,
            candidate_count: candidateIds.length,
            total_compatible: candidateIds.length,
            structured_constraint_count:
              observation.structuredConstraintCount,
            decision_ready: true,
          }
          await recordBeeGameResourceNoMatchInWorkspace({
            root: options.workspacePath,
            requirementIds,
            outcome: input.outcome,
            reasons: input.reasons,
            receipt,
          })
          catalogReadsSinceMutation = 0
          candidateObservation = undefined
          return {
            data: {
              result: 'recorded',
              requirement_ids: requirementIds,
              outcome: input.outcome,
            },
          }
        }
        if (input.action === 'refresh_import_metadata') {
          const refreshed = await application.refreshImportedMetadata(
            options.workspacePath,
          )
          catalogReadsSinceMutation = 0
          return {
            data: {
              result: refreshed.unresolvedImportIds.length
                ? 'partially_refreshed'
                : 'refreshed',
              refreshed_count: refreshed.refreshedImportIds.length,
              unresolved_count: refreshed.unresolvedImportIds.length,
              unresolved_import_ids: refreshed.unresolvedImportIds,
            },
          }
        }
        const unsupported: never = input
        throw new Error(
          `Unsupported ResourceLibrary input: ${JSON.stringify(unsupported)}`,
        )
      } finally {
        callInFlight = false
      }
    },
    renderToolUseMessage(input: Partial<ResourceLibraryInput>) {
      return input.action
        ? `Resource Library · ${input.action}`
        : 'Resource Library'
    },
    mapToolResultToToolResultBlockParam(output: unknown, toolUseID: string) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: JSON.stringify(output),
      }
    },
  })
}

async function deriveCandidateQuery(
  workspacePath: string,
  requestedRequirementIds: readonly string[],
): Promise<{
  requirementIds: string[]
  filters: ResourceCatalogFilterInput
  queryDigest: string
  structuredConstraintCount: number
}> {
  const requirementIds = [...new Set(requestedRequirementIds)].sort()
  const manifest = await readBeeGameAssetManifest(workspacePath)
  const byId = new Map(
    manifest.requirements.map(requirement => [requirement.id, requirement]),
  )
  const requirements = requirementIds.map(id => {
    const requirement = byId.get(id)
    if (!requirement?.resource_requirement)
      throw new Error(`Resource requirement ${id} is not awaiting selection`)
    return requirement
  })
  const normalized = requirements.map(requirement => {
    const resource = requirement.resource_requirement!
    return {
      ...(resource.category ? { category: resource.category } : {}),
      ...(resource.dimension ? { dimension: resource.dimension } : {}),
      accepted_formats: effectiveAssetFormats(
        requirement,
        manifest.project_target,
      ),
      ...(resource.styles?.length ? { styles: [...resource.styles].sort() } : {}),
      ...(resource.game_types?.length
        ? { game_types: [...resource.game_types].sort() }
        : {}),
      ...(resource.tags?.length ? { tags: [...resource.tags].sort() } : {}),
      ...(resource.asset_kinds?.length
        ? { asset_kinds: [...resource.asset_kinds].sort() }
        : {}),
      ...(resource.capabilities?.length
        ? { capabilities: [...resource.capabilities].sort() }
        : {}),
      ...(resource.subresources?.length
        ? { subresources: resource.subresources }
        : {}),
      ...(resource.relations?.length ? { relations: resource.relations } : {}),
      no_match: resource.no_match,
    }
  })
  const groupKey = JSON.stringify(normalized[0])
  if (normalized.some(value => JSON.stringify(value) !== groupKey))
    throw new Error(
      'query_candidates accepts only requirements from one exact selection group',
    )
  const resource = requirements[0]!.resource_requirement!
  const filters = {
    ...(resource.category ? { categories: [resource.category] } : {}),
    ...(resource.dimension ? { dimensions: [resource.dimension] } : {}),
    ...(resource.styles?.length ? { styles: resource.styles } : {}),
    ...(resource.game_types?.length ? { gameTypes: resource.game_types } : {}),
    ...(resource.tags?.length ? { usageTags: resource.tags } : {}),
    ...(resource.asset_kinds?.length
      ? { assetKinds: resource.asset_kinds }
      : {}),
    ...(resource.capabilities?.length
      ? { capabilities: resource.capabilities }
      : {}),
    formats: normalized[0]!.accepted_formats,
  } as ResourceCatalogFilterInput
  const structuredConstraintCount = Object.entries(normalized[0]!).filter(
    ([key, value]) =>
      key !== 'no_match' &&
      value !== undefined &&
      (!Array.isArray(value) || value.length > 0),
  ).length
  return {
    requirementIds,
    filters,
    queryDigest: digest([groupKey]),
    structuredConstraintCount,
  }
}

function digest(values: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex')
}

function compactCandidatePage(
  page: Awaited<ReturnType<ProjectResourceApplication['queryCandidates']>>,
  decisionReady: boolean,
) {
  return {
    items: page.items.map(element => ({
      packId: element.packId,
      packVersion: element.packVersion,
      packName: element.packName,
      packStyle: element.packStyle,
      elementId: element.elementId,
      elementName: element.elementName,
      elementPath: element.elementPath,
      ...(element.preview ? { preview: element.preview } : {}),
      category: element.category,
      dimension: element.dimension,
      ...(element.assetKind ? { assetKind: element.assetKind } : {}),
      ...(element.usageTags.length
        ? { usageTags: element.usageTags.slice(0, 8) }
        : {}),
      ...(element.capabilities.length
        ? { capabilities: element.capabilities.slice(0, 8) }
        : {}),
      ...(element.contentProfile
        ? { contentProfile: compactContentProfile(element.contentProfile) }
        : {}),
      ...(element.relations.length ? { relations: element.relations } : {}),
      ...(element.technicalFacts
        ? { technicalFacts: compactTechnicalFacts(element.technicalFacts) }
        : {}),
      ...(element.dependencyCount
        ? { dependencyCount: element.dependencyCount }
        : {}),
    })),
    total: page.total,
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    facets: compactFacets(page.facets),
    decision_ready: decisionReady,
  }
}

function compactContentProfile(
  profile: NonNullable<
    Awaited<
      ReturnType<ProjectResourceApplication['queryCandidates']>
    >['items'][number]['contentProfile']
  >,
) {
  return {
    packaging: profile.packaging,
    inspection: profile.inspection,
    components: profile.components.map(component => ({
      id: component.id,
      kind: component.kind,
      ...(component.name ? { name: component.name } : {}),
      ...(component.roles?.length ? { roles: component.roles } : {}),
      ...(component.skeletonSignature
        ? { skeletonSignature: component.skeletonSignature }
        : {}),
    })),
  }
}

function compactFacets(facets: Record<string, readonly string[]>) {
  return Object.fromEntries(
    Object.entries(facets).filter(([, values]) => values.length > 0),
  )
}

const CATALOG_TECHNICAL_FACT_KEYS = new Set([
  'extension',
  'mimeType',
  'width',
  'height',
  'vertices',
  'triangles',
  'meshCount',
  'skinCount',
  'skinnedMeshCount',
  'animationCount',
  'materialCount',
  'embeddedTextureCount',
  'morphTargetCount',
  'sceneNodeCount',
  'hasNormals',
  'hasTextureCoordinates',
  'boundsMinX',
  'boundsMinY',
  'boundsMinZ',
  'boundsMaxX',
  'boundsMaxY',
  'boundsMaxZ',
  'boundsSizeX',
  'boundsSizeY',
  'boundsSizeZ',
  'boundsCenterX',
  'boundsCenterY',
  'boundsCenterZ',
  'groundOffsetY',
  'centeringOffsetX',
  'centeringOffsetZ',
  'inspectionStatus',
  'processor',
  'processorVersion',
])

function compactTechnicalFacts(
  facts: Record<string, string | number | boolean>,
) {
  return Object.fromEntries(
    Object.entries(facts).filter(([key]) =>
      CATALOG_TECHNICAL_FACT_KEYS.has(key),
    ),
  )
}

function summarizeImportBatch(
  result: Awaited<
    ReturnType<ProjectResourceApplication['importExplicitSelections']>
  >,
) {
  const imported = result.results
    .filter(item => item.status === 'available')
    .map(item => ({
      import_id: item.importId,
      status: item.status,
      ...(item.rootPath ? { root_path: item.rootPath } : {}),
      ...(item.localFiles?.length ? { local_files: item.localFiles } : {}),
    }))
  const failuresByError = new Map<string, string[]>()
  for (const item of result.results) {
    if (item.status !== 'failed') continue
    const error = item.error ?? 'Resource import failed'
    failuresByError.set(error, [
      ...(failuresByError.get(error) ?? []),
      item.importId,
    ])
  }
  const failures = [...failuresByError].map(([error, importIds]) => ({
    error,
    import_ids: importIds,
  }))
  return {
    result:
      imported.length === result.results.length
        ? 'imported'
        : imported.length > 0
          ? 'partially_imported'
          : 'failed',
    requested_count: result.results.length,
    imported_count: imported.length,
    failed_count: result.results.length - imported.length,
    manifest: {
      version: result.manifest.version,
      project_target: result.manifest.project_target,
      requirement_count: result.manifest.requirements.length,
      import_count: result.manifest.imports?.length ?? 0,
      composition_count: result.manifest.compositions?.length ?? 0,
    },
    imported,
    failures,
  }
}
