import { z } from 'zod/v4'
import {
  RESOURCE_ASSET_KINDS,
  RESOURCE_CAPABILITIES,
  RESOURCE_CATEGORIES,
  RESOURCE_DIMENSIONS,
  RESOURCE_PACK_PRIMARY_CATEGORIES,
  RESOURCE_USAGE_TAGS,
} from '@bee-game-studio/beegame-resource-core'
import {
  ProjectResourceApplication,
  type ProjectResourceSelectionClient,
} from './project-resource-application'
import type {
  ResourceCatalogFilterInput,
  ResourceCatalogInput,
} from './resource-selection-client'

const catalogFiltersSchema = z.object({
  pack_ids: z.array(z.string().min(1)).optional(),
  dimensions: z.array(z.enum(RESOURCE_DIMENSIONS)).optional(),
  primary_categories: z
    .array(z.enum(RESOURCE_PACK_PRIMARY_CATEGORIES))
    .optional(),
  categories: z.array(z.enum(RESOURCE_CATEGORIES)).optional(),
  styles: z.array(z.string().min(1)).optional(),
  game_types: z.array(z.string().min(1)).optional(),
  pack_tags: z.array(z.string().min(1)).optional(),
  usage_tags: z.array(z.enum(RESOURCE_USAGE_TAGS)).optional(),
  asset_kinds: z.array(z.enum(RESOURCE_ASSET_KINDS)).optional(),
  capabilities: z.array(z.enum(RESOURCE_CAPABILITIES)).optional(),
  formats: z.array(z.string().min(1)).optional(),
})
const packElementFiltersSchema = catalogFiltersSchema.omit({ pack_ids: true })
const MAX_CATALOG_PAGE_ITEMS = 16

const catalogPageSchema = z.object({
  filters: catalogFiltersSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(MAX_CATALOG_PAGE_ITEMS).optional(),
})

const explicitImportSelectionSchema = z
  .object({
    import_id: z.string().min(1),
    requirement_ids: z.array(z.string().min(1)).min(1),
    pack_id: z.string().min(1),
    expected_pack_version: z.string().min(1),
    element_id: z.string().min(1).optional(),
    element_path: z.string().min(1).optional(),
    destination_path: z.string().min(1),
    selection_reason: z.array(z.string().min(1)).min(1).max(8),
  })
  .refine(
    selection =>
      Boolean(selection.element_id) !== Boolean(selection.element_path),
    {
      message: 'Provide exactly one of element_id or element_path',
    },
  )

const resourceLibraryInputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('browse_packs'), ...catalogPageSchema.shape }),
  z.object({ action: z.literal('inspect_pack'), pack_id: z.string().min(1) }),
  z.object({
    action: z.literal('index_pack_elements'),
    pack_id: z.string().min(1),
    filters: packElementFiltersSchema.optional(),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(MAX_CATALOG_PAGE_ITEMS).optional(),
  }),
  z.object({
    action: z.literal('import_elements'),
    selections: z.array(explicitImportSelectionSchema).min(1).max(64),
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
      input.action !== 'refresh_import_metadata',
    async description() {
      return 'Explore Resource Packs and elements, then import the exact reusable material you choose. BeeGame never chooses a candidate, assembles a scene, or certifies runtime integration for you.'
    },
    async prompt() {
      return [
        'ResourceLibrary is an exact catalog and import capability. BeeGame does not select resources, infer intent, rank artistic compatibility, or author target-runtime compositions.',
        'Catalog results are paginated. Pack and element records expose authored metadata, preview descriptors, dependency information, semantic relations and objective technical facts when available.',
        'Catalog filters are exact metadata constraints. Start with an unfiltered or canonical-structure browse, then reuse style, game-type and Pack-tag values exactly as returned in facets; do not translate or invent free-text filter values. Facets describe the available catalog scope even when the current filters return zero items.',
        'For semantic selection, element usageTags are authoritative. Pack dimension, style and game type provide compatibility context, while element category, format, assetKind, capabilities and contentProfile provide technical facts. Names, paths, folders and Pack tags may identify or discover records but never prove what gameplay or art responsibility an element can fulfill.',
        'Browse Packs first, inspect relevant Pack metadata, then page through Pack elements with exact catalog filters. Resource Library returns authored facts only; it never turns the first returned element into a recommendation.',
        'Read actions do not modify the project. import_elements copies only the exact elements supplied by Claude Code, pins their Pack versions and includes their declared dependency closures. It owns those provenance and copied-file inventory records atomically; do not hand-author or repeatedly rewrite them. refresh_import_metadata updates objective facts for existing pinned imports.',
        'Every import_elements selection must identify all current manifest requirement_ids it genuinely satisfies. One imported element may be reused by multiple requirements; BeeGame validates every requirement format contract before downloading and records those bindings atomically.',
        'New imports are accepted only while the canonical requirements declare enough resource_requirement.import_budget capacity. This budget is project inventory authority derived from the approved asset plan, not permission to import unrelated candidates.',
        'This tool reports catalog, provenance, copied-file and dependency facts only. It cannot mark a target-runtime composition complete or certify rendering, loading, visual quality, interaction, audio playback, gameplay, or player paths. Use the target runtime, native Skills and native Validator for those observations.',
        'Choose how and when to use these actions from the confirmed project context and the native capabilities available in the current session.',
      ].join(' ')
    },
    async checkPermissions(input: ResourceLibraryInput) {
      if (
        input.action !== 'import_elements' &&
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
        const catalogRead =
          input.action === 'browse_packs' ||
          input.action === 'inspect_pack' ||
          input.action === 'index_pack_elements'
        if (catalogRead) {
          if (catalogReadsSinceMutation >= catalogReadLimit) {
            throw new Error(
              `ResourceLibrary catalog budget is exhausted after ${catalogReadLimit} reads. Import a proven selection or finish with the concrete catalog blocker; another catalog read was not executed.`,
            )
          }
          catalogReadsSinceMutation += 1
        }
        if (input.action === 'browse_packs') {
          const page = await application.browsePacks(toCatalogInput(input))
          return catalogResult(compactPackPage(page))
        }
        if (input.action === 'inspect_pack') {
          const pack = await application.inspectPack(input.pack_id)
          return catalogResult(pack)
        }
        if (input.action === 'index_pack_elements') {
          const page = await application.indexPackElements(
            input.pack_id,
            toCatalogInput(input),
          )
          return catalogResult(
            compactElementIndex(input.pack_id, page, !input.cursor),
          )
        }
        if (input.action === 'import_elements') {
          const selections = await Promise.all(
            input.selections.map(async selection => ({
              importId: selection.import_id,
              requirementIds: selection.requirement_ids,
              packId: selection.pack_id,
              expectedPackVersion: selection.expected_pack_version,
              elementId:
                selection.element_id ??
                (await application.resolveElementIdByExactPath(
                  selection.pack_id,
                  selection.element_path!,
                )),
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
          }
          return { data: summarizeImportBatch(result) }
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

function toCatalogInput(
  input: Extract<
    ResourceLibraryInput,
    { action: 'browse_packs' | 'index_pack_elements' }
  >,
): ResourceCatalogInput {
  return {
    ...(input.filters ? { filters: toCatalogFilters(input.filters) } : {}),
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.limit ? { limit: input.limit } : {}),
  }
}

function compactElementIndex(
  packId: string,
  page: Awaited<ReturnType<ProjectResourceApplication['indexPackElements']>>,
  includeFacets: boolean,
) {
  return {
    packId,
    ...(page.items[0]?.packVersion
      ? { packVersion: page.items[0].packVersion }
      : {}),
    items: page.items.map(element => ({
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
    ...(includeFacets ? { facets: compactFacets(page.facets) } : {}),
  }
}

function compactContentProfile(
  profile: NonNullable<
    Awaited<
      ReturnType<ProjectResourceApplication['indexPackElements']>
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

function compactPackPage(
  page: Awaited<ReturnType<ProjectResourceApplication['browsePacks']>>,
) {
  return {
    items: page.items.map(pack => ({
      packId: pack.packId,
      packVersion: pack.packVersion,
      packName: pack.packName,
      styles: pack.styles,
      gameTypes: pack.gameTypes,
      dimension: pack.dimension,
      primaryCategory: pack.primaryCategory,
      categories: pack.categories,
      tags: pack.tags,
      readyElementCount: pack.readyElementCount,
      assetKinds: pack.assetKinds,
      usageTags: pack.usageTags,
      capabilities: pack.capabilities,
      formats: pack.formats,
    })),
    total: page.total,
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    facets: compactFacets(page.facets),
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

function toCatalogFilters(
  filters: z.infer<typeof catalogFiltersSchema>,
): ResourceCatalogFilterInput {
  return {
    ...(filters.pack_ids?.length ? { packIds: filters.pack_ids } : {}),
    ...(filters.dimensions?.length ? { dimensions: filters.dimensions } : {}),
    ...(filters.primary_categories?.length
      ? { primaryCategories: filters.primary_categories }
      : {}),
    ...(filters.categories?.length ? { categories: filters.categories } : {}),
    ...(filters.styles?.length ? { styles: filters.styles } : {}),
    ...(filters.game_types?.length ? { gameTypes: filters.game_types } : {}),
    ...(filters.pack_tags?.length ? { packTags: filters.pack_tags } : {}),
    ...(filters.usage_tags?.length ? { usageTags: filters.usage_tags } : {}),
    ...(filters.asset_kinds?.length ? { assetKinds: filters.asset_kinds } : {}),
    ...(filters.capabilities?.length
      ? { capabilities: filters.capabilities }
      : {}),
    ...(filters.formats?.length ? { formats: filters.formats } : {}),
  }
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
