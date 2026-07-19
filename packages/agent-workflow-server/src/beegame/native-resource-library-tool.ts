import { z } from 'zod/v4'
import {
  RESOURCE_ASSET_KINDS,
  RESOURCE_CAPABILITIES,
  RESOURCE_CATEGORIES,
  RESOURCE_DIMENSIONS,
  RESOURCE_PACK_PRIMARY_CATEGORIES,
  RESOURCE_USAGE_TAGS,
} from '@bee-game-studio/beegame-resource-core'
import { readBeeGameAssetManifest } from './asset-contracts'
import { auditAssetContract } from './asset-contract-audit'
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
  primary_categories: z.array(z.enum(RESOURCE_PACK_PRIMARY_CATEGORIES)).optional(),
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

const catalogPageSchema = z.object({
  filters: catalogFiltersSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(64).optional(),
})

const explicitImportSelectionSchema = z.object({
  import_id: z.string().min(1),
  pack_id: z.string().min(1),
  expected_pack_version: z.string().min(1),
  element_id: z.string().min(1).optional(),
  element_path: z.string().min(1).optional(),
  destination_path: z.string().min(1),
  selection_reason: z.array(z.string().min(1)).min(1).max(8),
}).refine(selection => Boolean(selection.element_id) !== Boolean(selection.element_path), {
  message: 'Provide exactly one of element_id or element_path',
})

const resourceLibraryInputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('inspect_project') }),
  z.object({ action: z.literal('browse_packs'), ...catalogPageSchema.shape }),
  z.object({ action: z.literal('inspect_pack'), pack_id: z.string().min(1) }),
  z.object({
    action: z.literal('index_pack_elements'),
    pack_id: z.string().min(1),
    filters: packElementFiltersSchema.optional(),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(64).optional(),
  }),
  z.object({
    action: z.literal('browse_pack_elements'),
    pack_id: z.string().min(1),
    filters: packElementFiltersSchema.optional(),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(64).optional(),
  }),
  z.object({
    action: z.literal('import_elements'),
    selections: z.array(explicitImportSelectionSchema).min(1).max(64),
  }),
  z.object({ action: z.literal('refresh_import_metadata') }),
  z.object({ action: z.literal('verify_integration') }),
])

type ResourceLibraryInput = z.infer<typeof resourceLibraryInputSchema>
type BuildTool = (definition: Record<string, unknown>) => unknown
type ProjectResourceFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export function createNativeResourceLibraryTool(options: {
  buildTool: BuildTool
  workspacePath: string
  client: ProjectResourceSelectionClient
  fetchImpl?: ProjectResourceFetch
}): unknown {
  const application = new ProjectResourceApplication(options.client, options.fetchImpl)
  return options.buildTool({
    name: 'ResourceLibrary',
    alwaysLoad: true,
    maxResultSizeChars: 40_000,
    inputSchema: resourceLibraryInputSchema,
    isConcurrencySafe: () => false,
    isReadOnly: (input: ResourceLibraryInput) => input.action !== 'import_elements' && input.action !== 'refresh_import_metadata',
    async description() {
      return 'Explore Resource Packs and elements, import the exact reusable material you choose, and verify project usage. BeeGame never chooses a candidate or assembles a scene for you.'
    },
    async prompt() {
      return [
        'You control Resource Library exploration and all authoring decisions.',
        'Start with browse_packs. It is a paginated catalog, not a requirement matcher: inspect its facets, compare art-direction compatibility and content coverage, and follow nextCursor when useful before selecting elements.',
        'After choosing a Pack, use index_pack_elements first. It returns one bounded compact inventory page with exact element paths and authored metadata. Keep the paths you select, follow nextCursor only when you need more candidates, and never restart the same Pack from its first page merely to recover prior output. Exact paths can be passed directly to import_elements as element_path; BeeGame resolves them against the inspected Pack version without exposing the full inventory to your context.',
        'Use inspect_pack for Pack structure and browse_pack_elements only when you need full authored details for a narrowly filtered subset. Select zero, one, or many elements for your own composition; do not map the Pack inventory one-to-one onto project requirements.',
        'Establish the approved art-direction baseline before choosing material: dimension, rendering style, shape language, material treatment, palette, scale, theme and presentation density. You may combine any number of Packs in one scene or artistic domain when their authored metadata and inspected contents can form one coherent result. Record why every selected Pack fits that shared baseline and what responsibilities it covers. Do not assume exact style-label equality is required, and do not call a decorative Pack a complete scene solution when core responsibilities remain uncovered. BeeGame never mixes Packs automatically and never decides how you use their elements.',
        'Use canonical category, usage-tag, asset-kind, capability, dimension and format fields for structured discovery. BeeGame does not interpret free-form intent, filenames, or keywords for you.',
        'A Pack may be a modular construction kit rather than a complete scene. Select independent ground, path, building, prop, character or effect elements and author the engine-native assembly yourself.',
        'Treat technicalFacts as objective source-file evidence, not target-runtime settings. Preserve authored source-format conventions and let the project\'s target-native importer decide coordinate, UV, material and animation conventions. Use inspected bounds and contentProfile when authoring target-native compositions; when a required fact is absent, inspect that resource once with the target toolchain. Never guess one fixed scale, pivot or texture orientation for every resource. Runtime visibility and loading must be observed before a composition is considered integrated.',
        'Treat project_target.asset_format_capabilities as the capabilities proven at the current revision, not an immutable ban list. Before rejecting a high-coverage, style-compatible Pack for format reasons, evaluate whether the target toolchain has a native loader or a reliable project-owned conversion path. Extend the toolchain and update the capabilities only after that path is implemented and verified; never rename binary contents or claim an untested conversion.',
        'Treat one loadable FBX, GLB, sprite atlas or similar root plus its declared dependency closure as one element; embedded meshes, skins, skeletons, clips, materials and textures are not separate selections.',
        'Before Document Reviewer READY, exploration actions are read-only. After READY, call import_elements with stable import ids, the exact Pack version you inspected, concise authored selection reasons, and project-relative destination paths chosen for the actual target toolchain. Imports are independent project inventory; they are not tied to requirement slots.',
        'For a project with Resource Library imports created before the latest Pack analysis, call refresh_import_metadata once. It refreshes only objective metadata for the exact pinned Pack versions and elements already present; it never replaces assets, downloads files, changes usage evidence or edits target-native scene code.',
        'After import, build the target-native 2D or 3D scene, animation, UI, audio or effect assembly yourself. Import source.type is resource-library only for real Pack provenance, user-upload for material supplied by the user, or project-authored for material created in the project; never fabricate Pack ids. An imported file begins as available; after real project use, set it to referenced and record usage_evidence as an object with references and runtime_event_ids arrays. A composition uses assembly_mode direct or composed and status planned, assembled, integrated or failed. Its members reference the actual import_id, requirement_id or composition_id they use. Update every implemented requirement to satisfied with its real composition/import/project references, keep genuine blockers explicit, then call verify_integration. Its coverage summary must not contain unresolved required responsibilities before you claim complete art integration. Fix every deterministic contract issue before runtime validation. Do not claim that copied files or optional decoration alone prove runtime use or complete scene coverage.',
        'If authored semantic metadata is sparse, you may use the compact inventory names and paths as evidence for your own selection reasoning, then verify the imported material in the target runtime. BeeGame itself never interprets filenames or assigns semantic roles. Do not misreport sparse metadata as an empty library.',
      ].join(' ')
    },
    async checkPermissions(input: ResourceLibraryInput) {
      if (input.action !== 'import_elements' && input.action !== 'refresh_import_metadata') return { behavior: 'allow', updatedInput: input }
      if (input.action === 'refresh_import_metadata') return {
        behavior: 'ask',
        message: 'Allow objective metadata for existing Resource Library imports to be refreshed from their pinned Pack versions?',
        updatedInput: input,
      }
      return {
        behavior: 'ask',
        message: `Allow ${input.selections.length} explicitly selected Resource Library element(s) to be copied into this project?`,
        updatedInput: input,
      }
    },
    async call(input: ResourceLibraryInput) {
      if (input.action === 'inspect_project') {
        return { data: summarizeManifest(await readBeeGameAssetManifest(options.workspacePath)) }
      }
      if (input.action === 'browse_packs') {
        return { data: await application.browsePacks(toCatalogInput(input)) }
      }
      if (input.action === 'inspect_pack') {
        return { data: await application.inspectPack(input.pack_id) }
      }
      if (input.action === 'index_pack_elements') {
        const page = await application.indexPackElements(input.pack_id, toCatalogInput(input))
        return { data: compactElementIndex(input.pack_id, page) }
      }
      if (input.action === 'browse_pack_elements') {
        return { data: await application.browsePackElements(input.pack_id, toCatalogInput(input)) }
      }
      if (input.action === 'import_elements') {
        const selections = await Promise.all(input.selections.map(async selection => ({
          importId: selection.import_id,
          packId: selection.pack_id,
          expectedPackVersion: selection.expected_pack_version,
          elementId: selection.element_id ?? await application.resolveElementIdByExactPath(selection.pack_id, selection.element_path!),
          destinationPath: selection.destination_path,
          selectionReason: selection.selection_reason,
        })))
        const result = await application.importExplicitSelections(
          options.workspacePath,
          selections,
        )
        return { data: summarizeImportBatch(result) }
      }
      if (input.action === 'refresh_import_metadata') {
        const refreshed = await application.refreshImportedMetadata(options.workspacePath)
        return { data: {
          result: refreshed.unresolvedImportIds.length ? 'partially_refreshed' : 'refreshed',
          refreshed_import_ids: refreshed.refreshedImportIds,
          unresolved_import_ids: refreshed.unresolvedImportIds,
        } }
      }
      const manifest = await readBeeGameAssetManifest(options.workspacePath)
      const contract = auditAssetContract(options.workspacePath)
      const requiredRequirements = manifest.requirements.filter(requirement => requirement.required !== false)
      // Canonical requirement states are normalized to the long-standing
      // internal slot states by asset-contracts: satisfied -> integrated and
      // blocked -> failed/missing. Keep this reporting boundary read-only
      // rather than introducing a second manifest parser here.
      const unresolvedRequired = requiredRequirements.filter(requirement => requirement.status !== 'integrated')
      const resourcePackIds = [...new Set((manifest.imports ?? [])
        .filter(resourceImport => resourceImport.source.type === 'resource-library')
        .map(resourceImport => resourceImport.source.pack_id)
        .filter((packId): packId is string => Boolean(packId)))]
      const importedPacks = await Promise.all(resourcePackIds.map(async packId => {
        try {
          const inspected = await application.inspectPack(packId)
          const pack = inspected.pack
          return {
            pack_id: packId,
            available: true,
            ...(typeof pack.name === 'string' ? { name: pack.name } : {}),
            ...(Array.isArray(pack.styles) ? { styles: pack.styles.filter(value => typeof value === 'string') } : typeof pack.style === 'string' ? { styles: [pack.style] } : {}),
            ...(typeof pack.dimension === 'string' ? { dimension: pack.dimension } : {}),
            ...(Array.isArray(pack.gameTypes) ? { game_types: pack.gameTypes.filter(value => typeof value === 'string') } : Array.isArray(pack.game_types) ? { game_types: pack.game_types.filter(value => typeof value === 'string') } : {}),
          }
        } catch (error) {
          return { pack_id: packId, available: false, error: error instanceof Error ? error.message : 'Pack inspection failed' }
        }
      }))
      const unavailablePackIds = importedPacks.filter(pack => !pack.available).map(pack => pack.pack_id)
      const importStatusCounts = countBy((manifest.imports ?? []).map(resourceImport => resourceImport.status))
      const invalidImportIds = (contract.imports ?? [])
        .filter(resourceImport => resourceImport.issues.length > 0)
        .map(resourceImport => resourceImport.id)
      const passed = contract.valid && unresolvedRequired.length === 0 && unavailablePackIds.length === 0
      return {
        data: {
          result: passed ? 'structurally_valid' : 'structurally_invalid',
          runtime_acceptance: {
            observed: false,
            required: true,
            message: 'This tool does not observe rendering, loading, visual quality, gameplay, or player paths. Use the native Validator against the current revision.',
          },
          next_action: passed
            ? 'Proceed to target-runtime validation.'
            : 'Fix every reported contract issue and unresolved required responsibility, then call verify_integration again.',
          imports: {
            total: (manifest.imports ?? []).length,
            by_status: importStatusCounts,
            invalid_ids: invalidImportIds,
          },
          coverage: {
            required_total: requiredRequirements.length,
            required_satisfied: requiredRequirements.length - unresolvedRequired.length,
            unresolved_required_ids: unresolvedRequired.map(requirement => requirement.id),
            blocked_required_ids: unresolvedRequired.filter(requirement => requirement.status === 'failed' || requirement.status === 'missing').map(requirement => requirement.id),
            compositions: {
              total: (manifest.compositions ?? []).length,
              integrated: (manifest.compositions ?? []).filter(composition => composition.status === 'integrated').map(composition => composition.id),
              unresolved: (manifest.compositions ?? []).filter(composition => composition.required !== false && composition.status !== 'integrated').map(composition => composition.id),
            },
            imported_packs: importedPacks,
          },
          contract: {
            present: contract.present,
            valid: contract.valid,
            rules: {
              import_source_types: ['resource-library', 'user-upload', 'project-authored'],
              import_statuses: ['available', 'referenced', 'failed'],
              usage_evidence_shape: { references: ['project/relative/path'], runtime_event_ids: ['runtime.event.id'] },
              composition_assembly_modes: ['direct', 'composed'],
              composition_statuses: ['planned', 'assembled', 'integrated', 'failed'],
            },
            issues: contract.issues,
            imports: (contract.imports ?? []).filter(resourceImport => resourceImport.issues.length).map(resourceImport => ({
              import_id: resourceImport.id,
              issues: resourceImport.issues,
            })),
            compositions: contract.compositions.filter(composition => composition.issues.length).map(composition => ({
              composition_id: composition.id,
              issues: composition.issues,
            })),
          },
        },
      }
    },
    renderToolUseMessage(input: Partial<ResourceLibraryInput>) {
      return input.action ? `Resource Library · ${input.action}` : 'Resource Library'
    },
    mapToolResultToToolResultBlockParam(output: unknown, toolUseID: string) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: JSON.stringify(output) }
    },
  })
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1
    return counts
  }, {})
}

function toCatalogInput(input: Extract<ResourceLibraryInput, { action: 'browse_packs' | 'browse_pack_elements' | 'index_pack_elements' }>): ResourceCatalogInput {
  return {
    ...(input.filters ? { filters: toCatalogFilters(input.filters) } : {}),
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.limit ? { limit: input.limit } : {}),
  }
}

function compactElementIndex(
  packId: string,
  page: Awaited<ReturnType<ProjectResourceApplication['indexPackElements']>>,
) {
  return {
    packId,
    items: page.items.map(element => ({
      elementPath: element.elementPath,
      category: element.category,
      dimension: element.dimension,
      ...(element.assetKind ? { assetKind: element.assetKind } : {}),
      ...(element.usageTags.length ? { usageTags: element.usageTags } : {}),
      ...(element.capabilities.length ? { capabilities: element.capabilities } : {}),
      ...(element.technicalFacts ? { technicalFacts: compactTechnicalFacts(element.technicalFacts) } : {}),
      ...(element.dependencyCount ? { dependencyCount: element.dependencyCount } : {}),
    })),
    total: page.total,
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    facets: page.facets,
  }
}

const CATALOG_TECHNICAL_FACT_KEYS = new Set([
  'extension', 'mimeType', 'width', 'height', 'vertices', 'triangles',
  'meshCount', 'skinCount', 'skinnedMeshCount', 'animationCount',
  'materialCount', 'embeddedTextureCount', 'morphTargetCount', 'sceneNodeCount',
  'hasNormals', 'hasTextureCoordinates',
  'boundsMinX', 'boundsMinY', 'boundsMinZ',
  'boundsMaxX', 'boundsMaxY', 'boundsMaxZ',
  'boundsSizeX', 'boundsSizeY', 'boundsSizeZ',
  'boundsCenterX', 'boundsCenterY', 'boundsCenterZ',
  'groundOffsetY', 'centeringOffsetX', 'centeringOffsetZ',
  'inspectionStatus', 'processor', 'processorVersion',
])

function compactTechnicalFacts(facts: Record<string, string | number | boolean>) {
  return Object.fromEntries(Object.entries(facts).filter(([key]) => CATALOG_TECHNICAL_FACT_KEYS.has(key)))
}

function toCatalogFilters(filters: z.infer<typeof catalogFiltersSchema>): ResourceCatalogFilterInput {
  return {
    ...(filters.pack_ids?.length ? { packIds: filters.pack_ids } : {}),
    ...(filters.dimensions?.length ? { dimensions: filters.dimensions } : {}),
    ...(filters.primary_categories?.length ? { primaryCategories: filters.primary_categories } : {}),
    ...(filters.categories?.length ? { categories: filters.categories } : {}),
    ...(filters.styles?.length ? { styles: filters.styles } : {}),
    ...(filters.game_types?.length ? { gameTypes: filters.game_types } : {}),
    ...(filters.pack_tags?.length ? { packTags: filters.pack_tags } : {}),
    ...(filters.usage_tags?.length ? { usageTags: filters.usage_tags } : {}),
    ...(filters.asset_kinds?.length ? { assetKinds: filters.asset_kinds } : {}),
    ...(filters.capabilities?.length ? { capabilities: filters.capabilities } : {}),
    ...(filters.formats?.length ? { formats: filters.formats } : {}),
  }
}

function summarizeManifest(manifest: Awaited<ReturnType<typeof readBeeGameAssetManifest>>) {
  return {
    version: manifest.version,
    project_target: manifest.project_target,
    requirements: manifest.requirements.map(requirement => ({
      id: requirement.id,
      name: requirement.name,
      required: requirement.required,
      status: requirement.status,
      resource_requirement: requirement.resource_requirement,
      satisfied_by: requirement.satisfied_by,
    })),
    imports: manifest.imports ?? [],
    compositions: manifest.compositions ?? [],
  }
}

function summarizeImportBatch(
  result: Awaited<ReturnType<ProjectResourceApplication['importExplicitSelections']>>,
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
    failuresByError.set(error, [...(failuresByError.get(error) ?? []), item.importId])
  }
  return {
    manifest: {
      version: result.manifest.version,
      project_target: result.manifest.project_target,
      requirement_count: result.manifest.requirements.length,
      import_count: result.manifest.imports?.length ?? 0,
      composition_count: result.manifest.compositions?.length ?? 0,
    },
    imported,
    failures: [...failuresByError].map(([error, importIds]) => ({ error, import_ids: importIds })),
  }
}
