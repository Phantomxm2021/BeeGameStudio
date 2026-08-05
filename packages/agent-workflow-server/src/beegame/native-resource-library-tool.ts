import {
  RESOURCE_ASSET_KINDS,
  RESOURCE_CAPABILITIES,
  RESOURCE_CATEGORIES,
  RESOURCE_DIMENSIONS,
  RESOURCE_PACK_PRIMARY_CATEGORIES,
  RESOURCE_USAGE_TAGS,
} from '@bee-game-studio/beegame-resource-core'
import { z } from 'zod/v4'
import {
  ProjectResourceApplication,
  type ProjectResourceSelectionClient,
} from './project-resource-application'

// Keep every page inside the native tool result envelope so the agent can
// inspect catalog metadata directly instead of reaching for shell commands to
// parse an offloaded result file. Pagination remains the single continuation
// mechanism for larger result sets.
const MAX_CATALOG_PAGE_ITEMS = 8
const DEFAULT_CATALOG_PAGE_ITEMS = MAX_CATALOG_PAGE_ITEMS
const MAX_FILTER_VALUES_PER_FIELD = 32
const MAX_TECHNICAL_FACTS_PER_ITEM = 24
const MAX_TECHNICAL_FACT_STRING_CHARS = 240

const packFiltersSchema = z
  .object({
    dimensions: z.array(z.enum(RESOURCE_DIMENSIONS)).min(1).optional(),
    primary_categories: z
      .array(z.enum(RESOURCE_PACK_PRIMARY_CATEGORIES))
      .min(1)
      .optional(),
    styles: z.array(z.string().trim().min(1)).min(1).optional(),
    game_types: z.array(z.string().trim().min(1)).min(1).optional(),
    pack_tags: z.array(z.string().trim().min(1)).min(1).optional(),
  })
  .strict()
  .optional()

const elementFiltersSchema = z
  .object({
    categories: z.array(z.enum(RESOURCE_CATEGORIES)).min(1).optional(),
    usage_tags: z.array(z.enum(RESOURCE_USAGE_TAGS)).min(1).optional(),
    asset_kinds: z.array(z.enum(RESOURCE_ASSET_KINDS)).min(1).optional(),
    capabilities: z.array(z.enum(RESOURCE_CAPABILITIES)).min(1).optional(),
    formats: z.array(z.string().trim().min(1)).min(1).optional(),
  })
  .strict()
  .optional()

const resourceSelectionSchema = z.object({
  resource_id: z.string().trim().min(1),
  pack_id: z.string().trim().min(1),
  expected_pack_version: z.string().trim().min(1),
  element_id: z.string().trim().min(1),
  destination_path: z.string().trim().min(1),
  selection_reason: z.array(z.string().trim().min(1)).min(1).max(8),
})

const resourceLibraryInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('list_packs'),
    filters: packFiltersSchema,
    cursor: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(MAX_CATALOG_PAGE_ITEMS).optional(),
  }),
  z.object({
    action: z.literal('inspect_pack'),
    pack_id: z.string().trim().min(1),
    filters: elementFiltersSchema,
    cursor: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(MAX_CATALOG_PAGE_ITEMS).optional(),
  }),
  z.object({
    action: z.literal('import_resources'),
    selections: z.array(resourceSelectionSchema).min(1).max(64),
  }),
])

type ResourceLibraryInput = z.infer<typeof resourceLibraryInputSchema>
type BuildTool = (definition: Record<string, unknown>) => unknown
type ProjectResourceFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

/**
 * Agent-facing Resource Library capability. It exposes the actual catalog,
 * exact acquisition, and metadata refresh without deriving a project-semantic
 * query or deciding which project requirement an element must satisfy.
 */
export function createNativeResourceLibraryTool(options: {
  buildTool: BuildTool
  workspacePath: string
  client: ProjectResourceSelectionClient
  fetchImpl?: ProjectResourceFetch
}): unknown {
  const application = new ProjectResourceApplication(
    options.client,
    options.fetchImpl,
  )
  const observed = new Map<string, string>()
  let callInFlight = false

  return options.buildTool({
    name: 'ResourceLibrary',
    alwaysLoad: true,
    maxResultSizeChars: 24_000,
    inputSchema: resourceLibraryInputSchema,
    isConcurrencySafe: () => false,
    isReadOnly: (input: ResourceLibraryInput) =>
      input.action === 'list_packs' || input.action === 'inspect_pack',
    async description() {
      return 'List compact Resource Pack summaries, inspect elements in a selected Pack, and import exact observed elements.'
    },
    async prompt() {
      return [
        'ResourceLibrary is an engine-neutral catalog and acquisition capability. You decide which project resources are useful; the service does not infer project roles or artistic suitability.',
        'Start with list_packs using exact authored metadata. Use inspect_pack only after selecting a Pack, then inspect its elements and objective technical facts. Never treat names or paths alone as proof of suitability.',
        'import_resources copies only exact elements already observed in this tool session, pins their published Pack versions, downloads their declared dependency closure, verifies local files and records them under manifest.resources. One resource may be referenced by any number of JSON or YAML content files.',
        'If the library cannot provide appropriate material, author a real provisional resource as a normal project file and register it through AssetManifest. Do not embed placeholders in gameplay code. Provisional resources must remain independently replaceable.',
        'Resource acquisition does not fulfill requirements by itself. After the material inventory is complete, define how resources are used in engine-neutral JSON or YAML content files, then let the target implementation consume those content IDs and resource IDs.',
      ].join(' ')
    },
    async checkPermissions(input: ResourceLibraryInput) {
      if (input.action === 'list_packs' || input.action === 'inspect_pack')
        return { behavior: 'allow', updatedInput: input }
      return {
        behavior: 'ask',
        message: `Allow ${input.selections.length} selected Resource Library resource(s) to be downloaded into this project?`,
        updatedInput: input,
      }
    },
    async call(input: ResourceLibraryInput) {
      if (callInFlight)
        throw new Error(
          'ResourceLibrary accepts one operation at a time. Wait for the current result before continuing.',
        )
      callInFlight = true
      try {
        if (input.action === 'list_packs') {
          const page = await application.listPacks({
            ...(input.filters
              ? {
                  filters: {
                    ...(input.filters.dimensions
                      ? { dimensions: input.filters.dimensions }
                      : {}),
                    ...(input.filters.primary_categories
                      ? {
                          primaryCategories: input.filters.primary_categories,
                        }
                      : {}),
                    ...(input.filters.styles
                      ? { styles: input.filters.styles }
                      : {}),
                    ...(input.filters.game_types
                      ? { gameTypes: input.filters.game_types }
                      : {}),
                    ...(input.filters.pack_tags
                      ? { packTags: input.filters.pack_tags }
                      : {}),
                  },
                }
              : {}),
            ...(input.cursor ? { cursor: input.cursor } : {}),
            limit: input.limit ?? DEFAULT_CATALOG_PAGE_ITEMS,
          })
          return { data: compactPackPage(page) }
        }
        if (input.action === 'inspect_pack') {
          const page = await application.inspectPack(input.pack_id, {
            ...(input.filters
              ? {
                  filters: {
                    ...(input.filters.categories
                      ? { categories: input.filters.categories }
                      : {}),
                    ...(input.filters.usage_tags
                      ? { usageTags: input.filters.usage_tags }
                      : {}),
                    ...(input.filters.asset_kinds
                      ? { assetKinds: input.filters.asset_kinds }
                      : {}),
                    ...(input.filters.capabilities
                      ? { capabilities: input.filters.capabilities }
                      : {}),
                    ...(input.filters.formats
                      ? { formats: input.filters.formats }
                      : {}),
                  },
                }
              : {}),
            ...(input.cursor ? { cursor: input.cursor } : {}),
            limit: input.limit ?? DEFAULT_CATALOG_PAGE_ITEMS,
          })
          for (const item of page.items)
            observed.set(
              observedKey(item.packId, item.elementId),
              item.packVersion,
            )
          return { data: compactElementPage(page) }
        }
        if (input.action === 'import_resources') {
          for (const selection of input.selections) {
            const version = observed.get(
              observedKey(selection.pack_id, selection.element_id),
            )
            if (!version)
              throw new Error(
                `Browse the selected Resource Library element before importing it: ${selection.pack_id}:${selection.element_id}`,
              )
            if (version !== selection.expected_pack_version)
              throw new Error(
                `The selected Pack version differs from the observed catalog version: ${selection.pack_id}`,
              )
          }
          const result = await application.acquireResources(
            options.workspacePath,
            input.selections.map(selection => ({
              resourceId: selection.resource_id,
              packId: selection.pack_id,
              expectedPackVersion: selection.expected_pack_version,
              elementId: selection.element_id,
              destinationPath: selection.destination_path,
              selectionReason: selection.selection_reason,
            })),
          )
          return { data: summarizeAcquisition(result) }
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

function observedKey(packId: string, elementId: string): string {
  return JSON.stringify([packId, elementId])
}

function compactPackPage(
  page: Awaited<ReturnType<ProjectResourceApplication['listPacks']>>,
) {
  return {
    packs: page.items.map(pack => ({
      pack_id: pack.packId,
      pack_version: pack.packVersion,
      name: pack.packName,
      dimension: pack.dimension,
      primary_category: pack.primaryCategory,
      styles: pack.styles,
      game_types: pack.gameTypes,
      tags: pack.tags,
      capabilities: pack.capabilities,
      formats: pack.formats,
      element_count: pack.readyElementCount,
    })),
    total: page.total,
    ...(page.nextCursor ? { next_cursor: page.nextCursor } : {}),
  }
}

function compactElementPage(
  page: Awaited<ReturnType<ProjectResourceApplication['inspectPack']>>,
) {
  const filterValues = {
    dimensions: page.facets.dimensions,
    primary_categories: page.facets.primaryCategories,
    styles: page.facets.styles,
    game_types: page.facets.gameTypes,
    pack_tags: page.facets.packTags,
    usage_tags: page.facets.usageTags,
    asset_kinds: page.facets.assetKinds,
    capabilities: page.facets.capabilities,
    formats: page.facets.formats,
  }
  const compactFilterValues = Object.fromEntries(
    Object.entries(filterValues)
      .filter(([, values]) => values.length > 0)
      .map(([key, values]) => [
        key,
        [...values].sort().slice(0, MAX_FILTER_VALUES_PER_FIELD),
      ]),
  )
  const truncatedFilterValueFields = Object.entries(filterValues)
    .filter(([, values]) => values.length > MAX_FILTER_VALUES_PER_FIELD)
    .map(([key]) => key)

  return {
    items: page.items.map(element => ({
      pack_id: element.packId,
      pack_version: element.packVersion,
      pack_name: element.packName,
      pack_styles: element.packStyles,
      pack_game_types: element.packGameTypes,
      element_id: element.elementId,
      element_name: element.elementName,
      element_path: element.elementPath,
      ...(element.preview ? { preview: element.preview } : {}),
      dimension: element.dimension,
      ...(element.assetKind ? { asset_kind: element.assetKind } : {}),
      usage_tags: element.usageTags,
      capabilities: element.capabilities,
      ...(element.contentProfile
        ? { content_profile: compactContentProfile(element.contentProfile) }
        : {}),
      ...(element.relations.length ? { relations: element.relations } : {}),
      ...(element.technicalFacts
        ? compactTechnicalFacts(element.technicalFacts)
        : {}),
      dependency_count: element.dependencyCount,
    })),
    total: page.total,
    ...(page.nextCursor ? { next_cursor: page.nextCursor } : {}),
    filter_values: compactFilterValues,
    ...(truncatedFilterValueFields.length
      ? { truncated_filter_value_fields: truncatedFilterValueFields }
      : {}),
  }
}

function compactContentProfile(
  profile: NonNullable<
    Awaited<
      ReturnType<ProjectResourceApplication['inspectPack']>
    >['items'][number]['contentProfile']
  >,
) {
  const componentCounts = new Map<string, number>()
  for (const component of profile.components) {
    componentCounts.set(
      component.kind,
      (componentCounts.get(component.kind) ?? 0) + 1,
    )
  }
  return {
    packaging: profile.packaging,
    component_counts: Object.fromEntries(
      [...componentCounts.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    inspection: {
      status: profile.inspection.status,
      source: profile.inspection.source,
      ...(profile.inspection.inspectorVersion
        ? { inspector_version: profile.inspection.inspectorVersion }
        : {}),
    },
  }
}

function compactTechnicalFacts(
  facts: Record<string, string | number | boolean>,
) {
  const entries = Object.entries(facts).sort(([left], [right]) =>
    left.localeCompare(right),
  )
  const included: Array<[string, string | number | boolean]> = []
  const omitted: string[] = []
  for (const [key, value] of entries) {
    if (
      included.length >= MAX_TECHNICAL_FACTS_PER_ITEM ||
      (typeof value === 'string' &&
        value.length > MAX_TECHNICAL_FACT_STRING_CHARS)
    ) {
      omitted.push(key)
      continue
    }
    included.push([key, value])
  }
  return {
    technical_facts: Object.fromEntries(included),
    ...(omitted.length ? { omitted_technical_fact_keys: omitted } : {}),
  }
}

function summarizeAcquisition(
  result: Awaited<ReturnType<ProjectResourceApplication['acquireResources']>>,
) {
  const verified = result.resources
    .filter(item => item.status === 'verified')
    .map(item => ({
      resource_id: item.resourceId,
      status: item.status,
      root_path: item.rootPath,
      file_paths: item.filePaths,
    }))
  const failures = result.resources
    .filter(item => item.status === 'failed')
    .map(item => ({
      resource_id: item.resourceId,
      error: item.error ?? 'Resource acquisition failed',
    }))
  return {
    result:
      verified.length === result.resources.length
        ? 'imported'
        : verified.length
          ? 'partially_imported'
          : 'failed',
    requested_count: result.resources.length,
    verified_count: verified.length,
    manifest: {
      version: result.manifest.version,
      resource_count: result.manifest.resources.length,
    },
    resources: verified,
    failures,
  }
}
