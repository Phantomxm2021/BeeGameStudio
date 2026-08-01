import {
  RESOURCE_ASSET_KINDS,
  RESOURCE_CAPABILITIES,
  RESOURCE_DIMENSIONS,
  RESOURCE_PACK_PRIMARY_CATEGORIES,
  RESOURCE_USAGE_TAGS,
} from '@bee-game-studio/beegame-resource-core'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod/v4'
import { CANONICAL_ASSET_MANIFEST } from './delivery-workflow/types'
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

const catalogFiltersSchema = z
  .object({
    pack_ids: z.array(z.string().trim().min(1)).min(1).optional(),
    dimensions: z.array(z.enum(RESOURCE_DIMENSIONS)).min(1).optional(),
    primary_categories: z
      .array(z.enum(RESOURCE_PACK_PRIMARY_CATEGORIES))
      .min(1)
      .optional(),
    styles: z.array(z.string().trim().min(1)).min(1).optional(),
    game_types: z.array(z.string().trim().min(1)).min(1).optional(),
    pack_tags: z.array(z.string().trim().min(1)).min(1).optional(),
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
    action: z.literal('browse_catalog'),
    filters: catalogFiltersSchema,
    cursor: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(MAX_CATALOG_PAGE_ITEMS).optional(),
  }),
  z.object({
    action: z.literal('import_resources'),
    selections: z.array(resourceSelectionSchema).min(1).max(64),
  }),
  z.object({ action: z.literal('refresh_resource_metadata') }),
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
  registrationBarrierPaths?: string[]
  allowCatalogWithExistingInventory?: boolean
  client: ProjectResourceSelectionClient
  fetchImpl?: ProjectResourceFetch
}): unknown {
  const application = new ProjectResourceApplication(
    options.client,
    options.fetchImpl,
  )
  const observed = new Map<string, string>()
  let callInFlight = false
  const existingInventoryAtSessionStart = hasRegisteredInventory(
    options.workspacePath,
  )

  return options.buildTool({
    name: 'ResourceLibrary',
    alwaysLoad: true,
    maxResultSizeChars: 24_000,
    inputSchema: resourceLibraryInputSchema,
    isConcurrencySafe: () => false,
    isReadOnly: (input: ResourceLibraryInput) =>
      input.action === 'browse_catalog',
    async description() {
      return 'Browse the Resource Library with structured filters, import exact observed elements into the project, and refresh objective metadata for existing library resources.'
    },
    async prompt() {
      return [
        'ResourceLibrary is an engine-neutral catalog and acquisition capability. You decide which project resources are useful; the service does not infer project roles or artistic suitability.',
        ...(options.registrationBarrierPaths?.length
          ? [
              'This dispatch has durable unregistered files from the prior Resource Production dispatch. Repair and register every path in contract.existingUnregisteredResourcePaths through AssetManifest before any ResourceLibrary action; the service enforces this ordering.',
            ]
          : []),
        'Begin broadly, inspect returned filter_values and selection summaries, then refine with those exact snake_case values or continue by passing next_cursor as cursor without filters. Do not repeat equivalent filters. A zero-result query is information about that query, not approval to end resource production.',
        'Catalog reads are bounded discovery, not the deliverable. After a bounded set of distinct probes has not found suitable material, create standalone provisional resource files and continue with the project content definitions.',
        'Catalog entries expose authored metadata, preview descriptors, dependency counts, semantic relations, content profiles and objective technical facts. Never treat names or paths alone as proof of suitability.',
        'import_resources copies only exact elements already observed in this tool session, pins their published Pack versions, downloads their declared dependency closure, verifies local files and records them under manifest.resources. One resource may be referenced by any number of JSON or YAML content files.',
        'If the library cannot provide appropriate material, author a real provisional resource as a normal project file and register it through AssetManifest. Do not embed placeholders in gameplay code. Provisional resources must remain independently replaceable.',
        'Resource acquisition does not fulfill requirements by itself. After the material inventory is complete, define how resources are used in engine-neutral JSON or YAML content files, then let the target implementation consume those content IDs and resource IDs.',
      ].join(' ')
    },
    async checkPermissions(input: ResourceLibraryInput) {
      if (input.action === 'browse_catalog')
        return { behavior: 'allow', updatedInput: input }
      if (input.action === 'refresh_resource_metadata')
        return {
          behavior: 'ask',
          message:
            'Allow objective metadata for existing Resource Library resources to be refreshed from their pinned Pack versions?',
          updatedInput: input,
        }
      return {
        behavior: 'ask',
        message: `Allow ${input.selections.length} selected Resource Library resource(s) to be downloaded into this project?`,
        updatedInput: input,
      }
    },
    async call(input: ResourceLibraryInput) {
      if (
        (await existingInventoryAtSessionStart) &&
        !options.allowCatalogWithExistingInventory
      )
        throw new Error(
          'The canonical resource inventory already existed when this recovery dispatch started. Finish the deterministic inventory and content correction; ResourceLibrary reopens only for an exact semantic review finding that requires renewed selection.',
        )
      const pendingRegistrationPaths = await unresolvedRegistrationBarrierPaths({
        workspacePath: options.workspacePath,
        barrierPaths: options.registrationBarrierPaths ?? [],
      })
      if (pendingRegistrationPaths.length)
        throw new Error(
          `ResourceLibrary is unavailable until every durable file from the prior resource dispatch is registered through AssetManifest: ${pendingRegistrationPaths.join(', ')}`,
        )
      if (callInFlight)
        throw new Error(
          'ResourceLibrary accepts one operation at a time. Wait for the current result before continuing.',
        )
      callInFlight = true
      try {
        if (input.action === 'browse_catalog') {
          const page = await application.browseCatalog({
            ...(input.filters
              ? {
                  filters: {
                    ...(input.filters.pack_ids
                      ? { packIds: input.filters.pack_ids }
                      : {}),
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
          return { data: compactCatalogPage(page) }
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
        if (input.action === 'refresh_resource_metadata') {
          const refreshed = await application.refreshLibraryMetadata(
            options.workspacePath,
          )
          return {
            data: {
              result: refreshed.unresolvedResourceIds.length
                ? 'partially_refreshed'
                : 'refreshed',
              refreshed_count: refreshed.refreshedResourceIds.length,
              unresolved_resource_ids: refreshed.unresolvedResourceIds,
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

async function hasRegisteredInventory(workspacePath: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(
      await readFile(join(workspacePath, CANONICAL_ASSET_MANIFEST), 'utf8'),
    ) as unknown
    return Boolean(
      parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        Array.isArray((parsed as Record<string, unknown>).resources) &&
        ((parsed as Record<string, unknown>).resources as unknown[]).length > 0,
    )
  } catch {
    return false
  }
}

async function unresolvedRegistrationBarrierPaths(input: {
  workspacePath: string
  barrierPaths: string[]
}): Promise<string[]> {
  if (input.barrierPaths.length === 0) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(
      await readFile(
        join(input.workspacePath, CANONICAL_ASSET_MANIFEST),
        'utf8',
      ),
    )
  } catch {
    return [...new Set(input.barrierPaths)]
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return [...new Set(input.barrierPaths)]
  const resources = (parsed as Record<string, unknown>).resources
  if (!Array.isArray(resources)) return [...new Set(input.barrierPaths)]
  const registeredPaths = new Set(
    resources.flatMap(resource => {
      if (!resource || typeof resource !== 'object' || Array.isArray(resource))
        return []
      const record = resource as Record<string, unknown>
      return [
        ...(typeof record.root_path === 'string' ? [record.root_path] : []),
        ...(Array.isArray(record.file_paths)
          ? record.file_paths.filter(
              (value): value is string => typeof value === 'string',
            )
          : []),
      ].map(normalizeProjectPath)
    }),
  )
  return [...new Set(input.barrierPaths)].filter(
    path => !registeredPaths.has(normalizeProjectPath(path)),
  )
}

function normalizeProjectPath(value: string): string {
  return value.trim().split('\\').join('/').replace(/^\.\//, '')
}

function observedKey(packId: string, elementId: string): string {
  return JSON.stringify([packId, elementId])
}

function compactCatalogPage(
  page: Awaited<ReturnType<ProjectResourceApplication['browseCatalog']>>,
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
    catalog_revision: page.catalogRevision,
  }
}

function compactContentProfile(
  profile: NonNullable<
    Awaited<ReturnType<ProjectResourceApplication['browseCatalog']>>['items'][number]['contentProfile']
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
