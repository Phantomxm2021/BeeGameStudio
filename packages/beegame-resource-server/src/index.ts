import { createInMemoryResourceRepository, resolveResourceSemanticVisualKind, type PackSummary, type ResourceElement, type ResourcePack } from '@bee-game-studio/beegame-resource-core'
import { createBeeGameResourceServerApp, ResourceLifecycleNotFoundError } from './app'
import { resolveBeeGameResourceListenOptions } from './env'
import { resolveBeeGameResourceSemanticRuntimeOptions } from './env'
import { createSupabaseResourceRepository } from './supabase-resource-repository'
import { createR2StorageDriver, resolveProjectStorageConfiguration } from '@bee-game-studio/beegame-storage-core'
import { contentProfileFromInspection, inspectUploadedResource } from './resource-inspection'
import { createSupabaseResourceProcessingHandlers, type ResourceProcessingBatchRetry } from './resource-processing-jobs'
import { createSubprocessModelPreviewProcessor, createSubprocessModelProcessor } from './model-processing'
import { externalReferencesFromInspection, reconcileResourceDependencySpecs, resolveResourceDependencyBindings } from './resource-dependency-bindings'
import { createR2ResourceStorage, type R2ResourceStorage } from './r2-resource-storage'
import { buildResourceSemanticContentProjection, buildResourceSemanticVisualInput } from './semantic-curation-evidence'
import { createResourceSemanticModelClient } from './semantic-curation-model'
import { buildResourceSemanticSubrequestMetadata, convertResourceSemanticProviderResults, partitionResourceSemanticBatch, resourceSemanticSubrequestId } from './semantic-curation-batch'
import { createSupabaseResourceModelConfigResolver } from './supabase-model-config-resolver'
import { createConfiguredResourceUserResolver } from './auth'
import { createResourceServerFetch } from './external-fetch'

export { createBeeGameResourceServerApp } from './app'
export type { BeeGameResourceServerAppOptions } from './app'
export { createSupabaseResourceProcessingHandlers } from './resource-processing-jobs'
export type { ResourceProcessingBatchContext, ResourceProcessingBatchItem, ResourceProcessingBatchReceipt, ResourceProcessingBatchRetry, ResourceProcessingFailure, ResourceProcessingHandlers, ResourceProcessingJob, ResourceProcessingJobStatus, ResourceProcessingProviderBatchResult, ResourceProcessingProviderBatchStatus, ResourceProcessingProviderBatchSubmission, ResourceProcessingUsage } from './resource-processing-jobs'
export { createSubprocessModelPreviewProcessor, createSubprocessModelProcessor } from './model-processing'
export type { ResourceInspectionFacts, ResourceModelPreviewProcessor, ResourceModelProcessor } from './model-processing'

if (import.meta.main) {
  await loadResourceSupabaseEnv()
  const resourceFetch = createResourceServerFetch()
  const { host, port } = resolveBeeGameResourceListenOptions()
  const baseUrl = process.env.BEEGAME_SUPABASE_URL
  const serviceRoleKey = process.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY
  const projectStorage = resolveProjectStorageConfiguration(process.env)
  const r2ResourceStorage = baseUrl && serviceRoleKey
    ? projectStorage.provider === 'r2'
      ? createR2ResourceStorage({ baseUrl, serviceRoleKey, bucket: projectStorage.buckets['resource-private'], driver: createR2StorageDriver(projectStorage.r2), fetchImpl: resourceFetch })
      : (() => { throw new Error('Resource Library storage provider must be R2') })()
    : undefined
  const modelProcessor = process.env.BEEGAME_RESOURCE_MODEL_PROCESSOR_ENABLED === '0' ? undefined : createSubprocessModelProcessor()
  const modelPreviewProcessor = process.env.BEEGAME_RESOURCE_MODEL_PROCESSOR_ENABLED === '0' ? undefined : createSubprocessModelPreviewProcessor()
  const repository = createConfiguredResourceRepository(process.env, resourceFetch, r2ResourceStorage)
  const semanticRuntimeOptions = resolveBeeGameResourceSemanticRuntimeOptions(process.env)
  const semanticConfigResolver = baseUrl && serviceRoleKey
    ? createSupabaseResourceModelConfigResolver({ baseUrl, serviceRoleKey, fetchImpl: resourceFetch })
    : undefined
  let semanticModel: ReturnType<typeof createResourceSemanticModelClient> | undefined
  if (semanticRuntimeOptions.configured && semanticConfigResolver) {
    try {
      semanticModel = createResourceSemanticModelClient({ runtimeServerUrl: semanticRuntimeOptions.runtimeServerUrl!, serviceToken: semanticRuntimeOptions.serviceToken!, fetchImpl: resourceFetch })
    } catch (error) {
      console.warn('Resource semantic model configuration rejected:', error)
    }
  }
  const inspectResourceElement = baseUrl && serviceRoleKey && r2ResourceStorage ? createSupabaseResourceReinspectionHandler({ baseUrl, serviceRoleKey, modelProcessor, r2Storage: r2ResourceStorage, fetchImpl: resourceFetch }) : undefined
  const resourceProcessing = baseUrl && serviceRoleKey && inspectResourceElement
    ? createSupabaseResourceProcessingHandlers({
      baseUrl, serviceRoleKey, inspectElement: inspectResourceElement, fetchImpl: resourceFetch,
      canProcessKind: kind => kind === 'inspect-elements' || Boolean(semanticModel && semanticConfigResolver),
      ...(semanticModel && semanticConfigResolver ? {
        assertProviderBatchReady: async (ownerId: string, modelConfigId: string) => {
          const modelConfig = await semanticConfigResolver.resolve(ownerId, modelConfigId)
          if (modelConfig.runtime.modelType !== 'anthropic') throw new Error(`Native provider batch is not supported for model provider "${modelConfig.runtime.modelType}"`)
        },
        submitProviderBatch: async (_kind, packId, batchId, contexts, _analysisMode) => {
        if (!contexts.length) throw new Error('Resource semantic processing batch is empty')
        if (!contexts.every(context => context.ownerId && context.modelConfigId)) throw new Error('Resource semantic processing model identity is missing')
        const curatorRevision = contexts[0]!.curatorRevision
        if (!curatorRevision || contexts.some(context => context.curatorRevision !== curatorRevision)) throw new Error('Resource semantic processing curator revision is inconsistent')
        const modelConfig = await semanticConfigResolver.resolve(contexts[0]!.ownerId!, contexts[0]!.modelConfigId!)
        const loadedResults = await Promise.all(contexts.map(async context => {
          try {
            const element = await repository.getElement(packId, context.elementId)
            if (!element) throw new Error('Resource element not found')
            const source = await loadResourceSemanticSource(baseUrl!, serviceRoleKey!, r2ResourceStorage!, packId, element, resourceFetch, modelPreviewProcessor)
            if (!source?.visualFile) throw new ResourceSemanticPreviewRequiredError('Resource semantic visual preview is unavailable')
            const projection = buildResourceSemanticContentProjection(element)
            if (context.sourceContentHash && context.sourceContentHash !== projection.sourceContentHash) throw new Error('Resource semantic processing content hash is stale')
            return { kind: 'ready' as const, value: { context, element, file: source.file, visualFile: source.visualFile, projection } }
          } catch (error) {
            if (!(error instanceof ResourceSemanticPreviewRequiredError)) throw error
            return { kind: 'retry' as const, value: { elementId: context.elementId, error: safeResourceProcessingMessage(error) } satisfies ResourceProcessingBatchRetry }
          }
        }))
        let loaded = loadedResults.filter((result): result is Extract<(typeof loadedResults)[number], { kind: 'ready' }> => result.kind === 'ready').map(result => result.value)
        const retryItems = loadedResults.filter((result): result is Extract<(typeof loadedResults)[number], { kind: 'retry' }> => result.kind === 'retry').map(result => result.value)
        if (!loaded.length) return { retryItems }
        const loadedById = new Map(loaded.map(item => [item.context.elementId, item]))
        const requests = []
        for (const [ordinal, subcontexts] of partitionResourceSemanticBatch(loaded.map(item => item.context)).entries()) {
          const customId = resourceSemanticSubrequestId(batchId, ordinal)
          const subloaded = subcontexts.map(context => loadedById.get(context.elementId)!).filter(Boolean)
          requests.push({
            customId,
            ownerId: contexts[0]!.ownerId!,
            modelConfigId: modelConfig.id,
            modelType: modelConfig.runtime.modelType,
            runtimeEnv: modelConfig.runtime.env,
            packId,
            jobId: contexts[0]!.jobId,
            batchId,
            curatorRevision,
            items: subloaded.map(item => ({ elementId: item.context.elementId, attempt: item.context.attempt, projection: item.projection })),
            visualInput: await buildResourceSemanticVisualInput(subloaded.map(item => ({ elementId: item.context.elementId, file: item.visualFile }))),
          })
        }
        const submission = await semanticModel.submitBatch({ requests })
        return { ...submission, retryItems }
      },
        retrieveProviderBatch: async (_kind, packId, batchId, providerBatchId, contexts, analysisMode) => {
          if (!contexts.length) throw new Error('Resource semantic processing batch is empty')
          if (!contexts.every(context => context.ownerId && context.modelConfigId)) throw new Error('Resource semantic processing model identity is missing')
          const curatorRevision = contexts[0]!.curatorRevision
          if (!curatorRevision || contexts.some(context => context.curatorRevision !== curatorRevision)) throw new Error('Resource semantic processing curator revision is inconsistent')
          const modelConfig = await semanticConfigResolver.resolve(contexts[0]!.ownerId!, contexts[0]!.modelConfigId!)
          const metadata = buildResourceSemanticSubrequestMetadata({
            batchId,
            contexts,
            requestFor: (subcontexts, customId) => ({
              customId,
              curatorRevision,
              items: subcontexts.map(context => ({
                elementId: context.elementId,
                attempt: context.attempt,
                projection: {
                  elementId: context.elementId,
                  sourceContentHash: context.sourceContentHash ?? '',
                },
              })),
            }),
          })
          const result = await semanticModel.retrieveBatch({
            ownerId: contexts[0]!.ownerId!,
            modelConfigId: modelConfig.id,
            modelType: modelConfig.runtime.modelType,
            runtimeEnv: modelConfig.runtime.env,
            providerBatchId,
            jobId: contexts[0]!.jobId,
            batchId,
          })
          if (result.status === 'processing') return { status: 'processing' as const }
          const committed = await convertResourceSemanticProviderResults({
            batchId,
            requests: metadata,
            results: result.results ?? [],
            commitDecision: async decision => {
              const saved = await repository.commitSemanticDecision?.(packId, decision, new Date().toISOString(), { commitMode: analysisMode === 'all' ? 'refresh-suggestion' : 'standard' })
              if (!saved) throw new Error('Resource semantic metadata commit is not configured')
              return { receiptId: saved.receiptId }
            },
          })
          return { status: 'ended' as const, receipt: committed }
        },
      } : {}),
    })
    : undefined
  const app = createBeeGameResourceServerApp({
    repository,
    ...(process.env.BEEGAME_RESOURCE_SERVICE_TOKEN ? { serviceSelectionToken: process.env.BEEGAME_RESOURCE_SERVICE_TOKEN } : {}),
    ...(baseUrl && serviceRoleKey ? { currentUserResolver: createConfiguredResourceUserResolver(process.env, { fetchImpl: resourceFetch }), canManagePack: createSupabaseResourcePackAccessChecker({ baseUrl, serviceRoleKey, fetchImpl: resourceFetch }) } : {}),
    ...(baseUrl && serviceRoleKey && r2ResourceStorage ? createSupabaseResourceLifecycleHandlers({ baseUrl, serviceRoleKey, r2Storage: r2ResourceStorage, fetchImpl: resourceFetch }) : {}),
    ...(baseUrl && serviceRoleKey && r2ResourceStorage ? createSupabaseResourceAuthoringHandlers({ baseUrl, serviceRoleKey, r2Storage: r2ResourceStorage, fetchImpl: resourceFetch }) : {}),
    ...(inspectResourceElement ? { inspectResourceElement } : {}),
    ...(resourceProcessing ? { resourceProcessing } : {}),
    ...(semanticModel && semanticConfigResolver ? { semanticCuration: { curatorRevision: semanticRuntimeOptions.curatorRevision, resolveModelConfigId: async (ownerId: string, requestedId?: string) => (await semanticConfigResolver.resolve(ownerId, requestedId)).id } } : {}),
    ...(baseUrl && serviceRoleKey && r2ResourceStorage ? { inspectPackStorage: createSupabaseResourceStorageInspector({ baseUrl, serviceRoleKey, r2Storage: r2ResourceStorage, fetchImpl: resourceFetch }) } : {}),
    ...(baseUrl && serviceRoleKey ? { recordAuditEvent: createSupabaseResourceAuditWriter({ baseUrl, serviceRoleKey, fetchImpl: resourceFetch }) } : {}),
    addResourceElement: baseUrl && serviceRoleKey && r2ResourceStorage ? async (packId, request) => {
      const form = await request.formData(); const file = form.get('file'); const category = String(form.get('category') || 'assets'); const folderPath = safeRelativeStoragePath(trimPath(String(form.get('folderPath') || category)), 'Element folder path')
      if (!(file instanceof File)) throw new Error('Element file is required')
      const storagePackId = safeStorageComponent(packId, 'Pack id')
      const filename = safeStorageComponent(file.name, 'Element filename')
      const relativePath = `${folderPath}/${filename}`
      const headers = { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, 'content-type': 'application/json', prefer: 'return=representation' }
      const r2Object = await r2ResourceStorage.upload({ packId: storagePackId, logicalPath: relativePath, file, objectKind: 'resource_element' })
      const row = buildElementUploadRow(storagePackId, category, file, `${storagePackId}-${crypto.randomUUID()}`, relativePath, filename)
      row.storage_object_id = r2Object.storageObjectId
      const inspection = await inspectUploadedResource(file)
      row.specs = { ...(row.specs as Record<string, unknown>), ...inspection }
      const contentProfile = contentProfileFromInspection(inspection)
      row.content_profile = contentProfile
      row.capabilities = capabilitiesFromContentProfile(contentProfile)
      const saved = await resourceFetch(`${baseUrl.replace(/\/+$/, '')}/rest/v1/beegame_resource_elements`, { method: 'POST', headers, body: JSON.stringify(row) })
      if (!saved.ok) {
        await r2ResourceStorage.delete(r2Object.storageObjectId, storagePackId)
        throw new Error('Element metadata persistence failed')
      }
      return toResourceElement(((await saved.json()) as Array<Record<string, unknown>>)[0])
    } : undefined,
  })
  const server = Bun.serve({ hostname: host, port, fetch: app.fetch })
  if (resourceProcessing) await resourceProcessing.resumePending().catch(error => console.warn('Resource processing recovery failed:', error))
  console.log(`BeeGame resource server listening on http://${host}:${server.port}`)
}

function capabilitiesFromContentProfile(profile: NonNullable<ResourceElement['contentProfile']>): ResourceElement['capabilities'] {
  const kinds = new Set(profile.components.map(component => component.kind))
  return [
    kinds.has('skeleton') ? 'rigged' : undefined,
    kinds.has('skeleton') ? 'skinned' : undefined,
    kinds.has('animation-clip') ? 'contains-animations' : undefined,
    kinds.has('material') ? 'contains-materials' : undefined,
    kinds.has('texture') ? 'contains-textures' : undefined,
    kinds.has('morph-target') ? 'morph-targets' : undefined,
  ].filter((value): value is NonNullable<ResourceElement['capabilities']>[number] => Boolean(value))
}

async function loadResourceSemanticSource(
  baseUrl: string,
  serviceRoleKey: string,
  r2Storage: R2ResourceStorage,
  packId: string,
  element: ResourceElement,
  fetchImpl: import('./external-fetch').ResourceServerFetch,
  modelPreviewProcessor?: (file: File) => Promise<File | undefined>,
) {
  const kind = resolveResourceSemanticPreviewKind(element)
  if (!kind) throw new ResourceSemanticPreviewRequiredError('Resource semantic visual preview is unsupported for this resource')
  const metadata = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/rest/v1/beegame_resource_elements?id=eq.${encodeURIComponent(element.id)}&pack_id=eq.${encodeURIComponent(packId)}&select=storage_object_id`, {
    headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` },
  })
  if (!metadata.ok) throw new Error(`Resource semantic preview lookup failed (${metadata.status})`)
  const row = ((await metadata.json()) as Array<{ storage_object_id?: unknown }>)[0]
  if (typeof row?.storage_object_id !== 'string' || !row.storage_object_id.trim()) throw new Error('Resource semantic preview storage object is missing')
  const file = await r2Storage.getFile(row.storage_object_id, packId)
  if (!file) throw new Error('Resource semantic preview content is unavailable')
  if (kind === 'model') {
    if (!modelPreviewProcessor) throw new ResourceSemanticPreviewRequiredError('Resource model semantic preview processor is unavailable')
    let visualFile: File | undefined
    try {
      visualFile = await modelPreviewProcessor(file)
    } catch (error) {
      throw new ResourceSemanticPreviewRequiredError(`Resource model semantic preview could not be rendered: ${safeResourceProcessingMessage(error)}`)
    }
    if (!visualFile || !visualFile.type.trim().toLowerCase().startsWith('image/')) throw new ResourceSemanticPreviewRequiredError('Resource model semantic preview could not be rendered')
    return { file, visualFile }
  }
  if (!file.type.trim().toLowerCase().startsWith('image/')) throw new ResourceSemanticPreviewRequiredError('Resource image semantic preview content is unavailable')
  return { file, visualFile: file }
}

export class ResourceSemanticPreviewRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResourceSemanticPreviewRequiredError'
  }
}

export function resolveResourceSemanticPreviewKind(element: ResourceElement): 'image' | 'model' | undefined {
  return resolveResourceSemanticVisualKind(element)
}

function safeResourceProcessingMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error)
  return value.replaceAll('\r', ' ').replaceAll('\n', ' ').replaceAll('\t', ' ').slice(0, 500)
}

const INSPECTION_DERIVED_CAPABILITIES = new Set<string>([
  'rigged', 'skinned', 'contains-animations', 'contains-materials',
  'contains-textures', 'morph-targets',
] as const)

/**
 * Rebuilds objective metadata for an existing Storage object. Authored roles
 * survive when the inspector returns the same stable component id and kind;
 * subject matter and gameplay purpose are never inferred from filenames.
 */
export function createSupabaseResourceReinspectionHandler(options: SupabaseAuthoringOptions) {
  const fetchImpl = options.fetchImpl ?? fetch
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const headers = { apikey: options.serviceRoleKey, authorization: `Bearer ${options.serviceRoleKey}` }
  return async (packId: string, elementId: string,
  ): Promise<ResourceElement | undefined> => {
    const metadata = await fetchImpl(`${baseUrl}/rest/v1/beegame_resource_elements?id=eq.${encodeURIComponent(elementId)}&pack_id=eq.${encodeURIComponent(packId)}&select=*`, { headers })
    if (!metadata.ok) throw new Error(`Resource inspection metadata lookup failed (${metadata.status})`)
    const current = (
      (await metadata.json()) as Array<Record<string, unknown>>)[0]
    if (!current) return undefined
    const relativePath = safeRelativeStoragePath(String(current.path || ''), 'Resource element path')
    if (typeof current.storage_object_id !== 'string') throw new Error('Resource element storage object is required')
    const r2File = await options.r2Storage.getFile(current.storage_object_id, packId)
    if (!r2File) throw new Error('Resource element storage object is unavailable')
    const currentSpecs = current.specs && typeof current.specs === 'object' && !Array.isArray(current.specs)
      ? (current.specs as ResourceElement['specs'])
        : {}
    const file = r2File
    const inspection = await inspectUploadedResource(file, { modelProcessor: options.modelProcessor })
    const references = [...new Set([
      ...externalReferencesFromInspection(inspection.externalReferences),
      ...externalReferencesFromInspection(inspection.unresolvedTextureReferences),
    ])]
    if (references.length) inspection.externalReferences = JSON.stringify(references)
    const inspectedProfile = contentProfileFromInspection(inspection)
    const previousProfile = current.content_profile && typeof current.content_profile === 'object' && !Array.isArray(current.content_profile)
      ? (current.content_profile as NonNullable<ResourceElement['contentProfile']>)
        : undefined
    const authoredRoles = new Map(
      (previousProfile?.components ?? [])
        .filter(component => component.roles?.length)
        .map(component => [`${component.kind}:${component.id}`, component.roles] as const),
    )
    const contentProfile = {
      ...inspectedProfile,
      components: inspectedProfile.components.map(component => ({
        ...component,
        ...(authoredRoles.get(`${component.kind}:${component.id}`)
          ? { roles: authoredRoles.get(`${component.kind}:${component.id}`) }
          : {}),
      })),
    }
    const existingCapabilities = Array.isArray(current.capabilities)
      ? current.capabilities.filter((value,
          ): value is NonNullable<ResourceElement['capabilities']>[number] => typeof value === 'string' && !INSPECTION_DERIVED_CAPABILITIES.has(value))
      : []
    const packElementsResponse = await fetchImpl(`${baseUrl}/rest/v1/beegame_resource_elements?pack_id=eq.${encodeURIComponent(packId)}&select=id,path,kind`, { headers })
    if (!packElementsResponse.ok) throw new Error(`Resource dependency lookup failed (${packElementsResponse.status})`)
    const packElements = (await packElementsResponse.json()) as Array<{ id: string; path: string; kind: string }>
    const dependencyBindings = resolveResourceDependencyBindings(relativePath, references, packElements)
    const dependencySpecs = reconcileResourceDependencySpecs({ ...currentSpecs, ...inspection }, references, dependencyBindings)
    const body = {
      specs: dependencySpecs,
      content_profile: contentProfile,
      capabilities: [...new Set([...existingCapabilities, ...(capabilitiesFromContentProfile(contentProfile) ?? [])])],
      dependencies: [...new Set(dependencyBindings.map(binding => binding.dependencyElementId))],
      dependency_bindings: dependencyBindings,
      ...(current.asset_kind ? {} : { asset_kind: defaultAssetKind(inferElementKind(file)) ?? null }),
    }
    const saved = await fetchImpl(`${baseUrl}/rest/v1/beegame_resource_elements?id=eq.${encodeURIComponent(elementId)}&pack_id=eq.${encodeURIComponent(packId)}`, {
      method: 'PATCH',
      headers: { ...headers, 'content-type': 'application/json', prefer: 'return=representation' },
      body: JSON.stringify(body),
    })
    if (!saved.ok) throw new Error(`Resource inspection persistence failed (${saved.status})`)
    const row = ((await saved.json()) as Array<Record<string, unknown>>)[0]
    if (!row) throw new Error('Resource inspection persistence returned no element')
    return toResourceElement(row)
  }
}

type SupabaseAuthoringOptions = { baseUrl: string; serviceRoleKey: string; fetchImpl?: FetchImplementation; modelProcessor?: import('./model-processing').ResourceModelProcessor; r2Storage: R2ResourceStorage }

export function createSupabaseResourceAuditWriter(options: { baseUrl: string; serviceRoleKey: string; fetchImpl?: FetchImplementation }) {
  const fetchImpl = options.fetchImpl ?? fetch
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  return async (event: { actorId: string; action: string; packId?: string; elementId?: string; metadata?: Record<string, unknown> }) => {
    const response = await fetchImpl(`${baseUrl}/rest/v1/beegame_resource_audit_events`, {
      method: 'POST',
      headers: { apikey: options.serviceRoleKey, authorization: `Bearer ${options.serviceRoleKey}`, 'content-type': 'application/json', prefer: 'return=minimal' },
      body: JSON.stringify({ actor_id: event.actorId, action: event.action, pack_id: event.packId ?? null, element_id: event.elementId ?? null, metadata: event.metadata ?? {} }),
    })
    if (!response.ok) throw new Error(`Resource audit persistence failed (${response.status})`)
  }
}

/**
 * Service-role requests bypass Postgres RLS. Keep the same Pack ownership
 * boundary in the resource API before any lifecycle handler reaches Storage.
 */
export function createSupabaseResourcePackAccessChecker(options: { baseUrl: string; serviceRoleKey: string; fetchImpl?: FetchImplementation }) {
  const fetchImpl = options.fetchImpl ?? fetch
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  return async (user: { id: string; role?: string }, packId: string,
  ): Promise<boolean> => {
    if (user.role === 'owner') return true
    const response = await fetchImpl(`${baseUrl}/rest/v1/beegame_resource_packs?id=eq.${encodeURIComponent(packId)}&select=created_by&limit=1`, {
      headers: { apikey: options.serviceRoleKey, authorization: `Bearer ${options.serviceRoleKey}`, accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`Resource Pack ownership lookup failed (${response.status})`)
    const row = ((await response.json()) as Array<{ created_by?: unknown }>)[0]
    return typeof row?.created_by === 'string' && row.created_by === user.id
  }
}

/** Read-only reconciliation for the publication gate; no Storage mutation occurs here. */
export function createSupabaseResourceStorageInspector(options: SupabaseLifecycleOptions) {
  const fetchImpl = options.fetchImpl ?? fetch
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const headers = { apikey: options.serviceRoleKey, authorization: `Bearer ${options.serviceRoleKey}` }
  return async (packId: string,
  ): Promise<{ missingPaths: string[]; orphanPaths: string[] }> => {
    const [packResponse, elementResponse] = await Promise.all([
      fetchImpl(`${baseUrl}/rest/v1/beegame_resource_packs?id=eq.${encodeURIComponent(packId)}&select=cover_path`, { headers }),
      fetchImpl(`${baseUrl}/rest/v1/beegame_resource_elements?pack_id=eq.${encodeURIComponent(packId)}&select=path`, { headers }),
    ])
    if (!packResponse.ok || !elementResponse.ok) throw new Error('Resource storage reconciliation metadata lookup failed')
    const pack = (
      (await packResponse.json()) as Array<{ cover_path?: unknown }>)[0]
    const elements = (await elementResponse.json()) as Array<{ path?: unknown }>
    const expected = new Set<string>()
    if (typeof pack?.cover_path === 'string' && isSafeRelativeStoragePath(pack.cover_path)) expected.add(pack.cover_path)
    for (const element of elements) if (typeof element.path === 'string' && isSafeRelativeStoragePath(element.path)) expected.add(element.path)

    const actual = new Set<string>()
    for (const object of await options.r2Storage.listPackObjects(packId)) {
      if (object.status === 'ready' && object.logicalPath) actual.add(object.logicalPath)
    }
    return {
      missingPaths: [...expected].filter(path => !actual.has(path)).sort(),
      orphanPaths: [...actual].filter(path => !expected.has(path)).sort(),
    }
  }
}

/** Keeps storage object keys and database paths in lock-step for explorer edits. */
export function createSupabaseResourceAuthoringHandlers(options: SupabaseAuthoringOptions) {
  const fetchImpl = options.fetchImpl ?? fetch
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const headers = { apikey: options.serviceRoleKey, authorization: `Bearer ${options.serviceRoleKey}` }
  const rest = `${baseUrl}/rest/v1`
  const getRows = async <T>(table: string, query: string): Promise<T[]> => {
    const response = await fetchImpl(`${rest}/${table}?${query}`, { headers })
    if (!response.ok) throw new Error(`Resource metadata lookup failed (${response.status})`)
    return response.json() as Promise<T[]>
  }
  const patchRows = async <T>(table: string, query: string, body: Record<string, unknown>,
  ): Promise<T[]> => {
    const response = await fetchImpl(`${rest}/${table}?${query}`, { method: 'PATCH', headers: { ...headers, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify(body) })
    if (!response.ok) throw new Error(`Resource metadata update failed (${response.status})`)
    return response.json() as Promise<T[]>
  }
  const deleteRows = async <T>(table: string, query: string): Promise<T[]> => {
    const response = await fetchImpl(`${rest}/${table}?${query}`, { method: 'DELETE', headers: { ...headers, prefer: 'return=representation' } })
    if (!response.ok) throw new Error(`Resource metadata deletion failed (${response.status})`)
    return response.json() as Promise<T[]>
  }
  type ElementRow = Record<string, unknown> & { id: string; pack_id: string; name: string; path: string; storage_object_id?: string | null }
  type FolderRow = { id: string; pack_id: string; name: string; parent_id?: string | null; path: string }
  const storageObjectId = (element: ElementRow): string => {
    if (typeof element.storage_object_id !== 'string') throw new Error('Resource element storage object is required')
    return element.storage_object_id
  }
  const updateElement = async (packId: string, elementId: string, body: Record<string, unknown>,
  ) => {
    const current = (await getRows<ElementRow>('beegame_resource_elements', `id=eq.${encodeURIComponent(elementId)}&pack_id=eq.${encodeURIComponent(packId)}&select=*`))[0]
    if (!current) return undefined
    const row = toElementRow(body)
    const oldPath = safeRelativeStoragePath(current.path, 'Resource element path')
    const nextPath = Object.hasOwn(row, 'path') ? safeRelativeStoragePath(String(row.path), 'Resource element path') : oldPath
    let moved = false
    if (nextPath !== oldPath) {
      await options.r2Storage.updateLogicalPath(storageObjectId(current), packId, nextPath)
      moved = true
    }
    try {
      const saved = (await patchRows<ElementRow>('beegame_resource_elements', `id=eq.${encodeURIComponent(elementId)}&pack_id=eq.${encodeURIComponent(packId)}`, row))[0]
      if (!saved) throw new ResourceLifecycleNotFoundError('Resource element not found')
      return toResourceElement(saved)
    } catch (error) {
      if (moved) {
        await options.r2Storage.updateLogicalPath(storageObjectId(current), packId, oldPath).catch(() => undefined)
      }
      throw error
    }
  }
  return {
    updateResourceElement: updateElement,
    deleteResourceElement: async (packId: string, elementId: string) => {
      const current = (await getRows<ElementRow>('beegame_resource_elements', `id=eq.${encodeURIComponent(elementId)}&pack_id=eq.${encodeURIComponent(packId)}&select=*`))[0]
      if (!current) return false
      await options.r2Storage.delete(storageObjectId(current), packId)
      return (
        (
          await deleteRows<ElementRow>('beegame_resource_elements', `id=eq.${encodeURIComponent(elementId)}&pack_id=eq.${encodeURIComponent(packId)}`)).length > 0
      )
    },
    updateResourceFolder: async (packId: string, folderId: string, body: Record<string, unknown>,
    ) => {
      const folders = await getRows<FolderRow>('beegame_resource_folders', `pack_id=eq.${encodeURIComponent(packId)}&select=*`)
      const folder = folders.find((item) => item.id === folderId)
      if (!folder) return undefined
      const name = Object.hasOwn(body, 'name') ? String(body.name || '').trim() : folder.name
      if (!name || name.includes('/') || name.includes('\\')) throw new Error('Folder name is invalid')
      const parent = folder.parent_id ? folders.find((item) => item.id === folder.parent_id) : undefined
      const nextPath = parent ? `${parent.path}/${name}` : name
      if (folders.some((item) => item.id !== folderId && item.path === nextPath)) throw new Error('Folder path already exists')
      const oldPath = folder.path
      const replacePath = (value: string) => value === oldPath ? nextPath : value.startsWith(`${oldPath}/`) ? `${nextPath}${value.slice(oldPath.length)}` : value
      const elements = (await getRows<ElementRow>('beegame_resource_elements', `pack_id=eq.${encodeURIComponent(packId)}&select=*`)).filter((item) => item.path === oldPath || item.path.startsWith(`${oldPath}/`))
      const moves = elements.map((item) => ({ from: item.path, to: replacePath(item.path) }))
      try {
        for (const move of moves) {
          const element = elements.find(item => item.path === move.from)
          if (!element) throw new Error('Resource element metadata is inconsistent')
          await options.r2Storage.updateLogicalPath(storageObjectId(element), packId, move.to)
        }
        for (const item of folders.filter((candidate) => candidate.path === oldPath || candidate.path.startsWith(`${oldPath}/`))) await patchRows<FolderRow>('beegame_resource_folders', `id=eq.${encodeURIComponent(item.id)}&pack_id=eq.${encodeURIComponent(packId)}`, { ...(item.id === folderId ? { name } : {}), path: replacePath(item.path) })
        for (const item of elements) await patchRows<ElementRow>('beegame_resource_elements', `id=eq.${encodeURIComponent(item.id)}&pack_id=eq.${encodeURIComponent(packId)}`, { path: replacePath(item.path) })
      } catch (error) {
        for (const move of [...moves].reverse()) {
          const element = elements.find(item => item.path === move.from)
          if (element) await options.r2Storage.updateLogicalPath(storageObjectId(element), packId, move.from).catch(() => undefined)
        }
        throw error
      }
      return { id: folder.id, packId, name, ...(folder.parent_id ? { parentId: folder.parent_id } : {}), path: nextPath }
    },
    deleteResourceFolder: async (packId: string, folderId: string) => {
      const folders = await getRows<FolderRow>('beegame_resource_folders', `pack_id=eq.${encodeURIComponent(packId)}&select=*`)
      const folder = folders.find((item) => item.id === folderId)
      if (!folder) return false
      const elements = await getRows<ElementRow>('beegame_resource_elements', `pack_id=eq.${encodeURIComponent(packId)}&select=*`)
      const folderPrefix = `${folder.path}/`
      const containedElements = elements.filter((item) => item.path === folder.path || item.path.startsWith(folderPrefix))
      for (const element of containedElements) {
        await options.r2Storage.delete(storageObjectId(element), packId)
      }
      for (const element of containedElements) {
        await deleteRows<ElementRow>('beegame_resource_elements', `id=eq.${encodeURIComponent(element.id)}&pack_id=eq.${encodeURIComponent(packId)}`)
      }
      const descendants = folders.filter((item) => item.path === folder.path || item.path.startsWith(folderPrefix)).sort((left, right) => right.path.length - left.path.length)
      for (const descendant of descendants) {
        await deleteRows<FolderRow>('beegame_resource_folders', `id=eq.${encodeURIComponent(descendant.id)}&pack_id=eq.${encodeURIComponent(packId)}`)
      }
      return true
    },
  }
}

async function loadResourceSupabaseEnv(): Promise<void> {
  for (const path of ['.env.billing', 'docker/.env.billing', '.env.local']) {
    const file = Bun.file(path)
    if (!(await file.exists())) continue
    const text = await file.text()
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*(BEEGAME_(?:SUPABASE_(?:URL|SERVICE_ROLE_KEY|ANON_KEY)|CONFIG_ENCRYPTION_KEY|PROJECT_STORAGE_PROVIDER|R2_(?:ACCOUNT_ID|ENDPOINT|ACCESS_KEY_ID|SECRET_ACCESS_KEY|PROJECT_BUCKET|RESOURCE_BUCKET|DELIVERY_BUCKET|LOG_BUCKET)|RUNTIME_SERVER_URL|RESOURCE_SEMANTIC_CURATOR_REVISION))\s*=\s*(.*)\s*$/)
      if (match?.[1] && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
    }
  }
}

function createConfiguredResourceRepository(
  env: NodeJS.ProcessEnv,
  fetchImpl: import('./external-fetch').ResourceServerFetch,
  r2Storage?: R2ResourceStorage,
) {
  const baseUrl = env.BEEGAME_SUPABASE_URL?.trim()
  const serviceRoleKey = env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (baseUrl && serviceRoleKey) {
    if (!r2Storage) throw new Error('Resource repository requires R2 object storage')
    return createSupabaseResourceRepository({
      baseUrl,
      serviceRoleKey,
      fetchImpl,
      getStorageObjectUrl: (storageObjectId: string, packId: string) => r2Storage.createDownloadUrl(storageObjectId, packId),
    })
  }
  if (env.BEEGAME_RESOURCE_REPOSITORY === 'memory' || env.NODE_ENV !== 'production') {
    return createInMemoryResourceRepository({ packs: [], elements: [] })
  }
  throw new Error('Resource repository requires Supabase configuration in production')
}

function trimPath(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && value[start] === '/') start += 1
  while (end > start && value[end - 1] === '/') end -= 1
  return value.slice(start, end)
}

export function toElementRow(body: Record<string, unknown>): Record<string, unknown> {
  const editable: Record<string, string> = {
    name: 'name', path: 'path', category: 'category', kind: 'kind', preview: 'preview', specs: 'specs',
    usageTags: 'usage_tags', usageTagsMode: 'usage_tags_mode', assetKind: 'asset_kind', capabilities: 'capabilities', contentProfile: 'content_profile', relations: 'relations', dependencies: 'dependencies', dependencyBindings: 'dependency_bindings', status: 'status', styleOverride: 'style_override', dimensionOverride: 'dimension_override',
  }
  const row: Record<string, unknown> = {}
  for (const [key, column] of Object.entries(editable)) {
    if (Object.hasOwn(body, key)) row[column] = body[key]
  }
  if (Object.hasOwn(body, 'usageTags') && !Object.hasOwn(body, 'usageTagsMode')) {
    row.usage_tags_mode = Array.isArray(body.usageTags) && body.usageTags.length ? 'override' : 'manual-only'
  }
  return row
}

export function toPackUpdateRow(body: Record<string, unknown>): Record<string, unknown> {
  const editable: Record<string, string> = {
    name: 'name', styles: 'styles', gameTypes: 'game_types', dimension: 'dimension',
    primaryCategory: 'primary_category', categories: 'categories', license: 'license', version: 'version',
    description: 'description', tags: 'tags', source: 'source', author: 'author', licenseEvidence: 'license_evidence', compatibleEngines: 'compatible_engines', deprecatedAt: 'deprecated_at',
  }
  const row: Record<string, unknown> = {}
  for (const [input, column] of Object.entries(editable)) {
    if (Object.hasOwn(body, input)) row[column] = body[input]
  }
  return row
}

export function extensionFromName(name: string): string {
  const index = name.lastIndexOf('.')
  return index > 0 && index < name.length - 1 ? name.slice(index + 1).toLowerCase() : ''
}

export function inferElementKind(file: File): string {
  const extension = extensionFromName(file.name)
  const mimeType = file.type.toLowerCase()
  if (['glb', 'gltf', 'obj', 'fbx', 'dae', 'blend', 'stl', 'usd', 'usdz'].includes(extension) || mimeType.startsWith('model/')) return 'model'
  if (mimeType.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(extension)) return 'audio'
  if (mimeType.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv'].includes(extension)) return 'video'
  if (mimeType.startsWith('font/') || ['ttf', 'otf', 'woff', 'woff2'].includes(extension)) return 'font'
  if (mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'avif'].includes(extension)) return 'image'
  if (mimeType === 'application/pdf' || ['pdf', 'txt', 'md', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(extension)) return 'document'
  return 'file'
}

export function buildElementUploadRow(packId: string, category: string, file: File, id = `${packId}-${crypto.randomUUID()}`, path = `${category}/${file.name}`, name = file.name): Record<string, unknown> {
  const kind = inferElementKind(file)
  const assetKind = defaultAssetKind(kind)
  const preview = previewDescriptor(kind, path)
  return {
    id,
    pack_id: packId,
    name,
    path,
    category,
    kind,
    ...(assetKind ? { asset_kind: assetKind } : {}),
    usage_tags_mode: 'inherit',
    capabilities: [],
    content_profile: {
      packaging: 'unknown',
      components: [],
      inspection: { status: 'unavailable', source: 'server' },
    },
    relations: [],
    ...(preview ? { preview } : {}),
    specs: {
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      extension: extensionFromName(name),
      previewStatus: preview ? 'ready' : 'unsupported',
    },
    dependencies: [],
    status: 'ready',
  }
}

function defaultAssetKind(kind: string): 'model' | 'audio-clip' | 'font' | 'image' | undefined {
  if (kind === 'model') return 'model'
  if (kind === 'audio') return 'audio-clip'
  if (kind === 'font') return 'font'
  if (kind === 'image') return 'image'
  return undefined
}

function previewDescriptor(kind: string, path: string):
  | { kind: 'image' | 'model' | 'audio' | 'document'; path: string } | undefined {
  if (kind === 'image') return { kind: 'image', path }
  if (kind === 'model') return { kind: 'model', path }
  if (kind === 'audio') return { kind: 'audio', path }
  if (kind === 'video' || kind === 'font' || kind === 'document') return { kind: 'document', path }
  return undefined
}

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type SupabaseLifecycleOptions = { baseUrl: string; serviceRoleKey: string; fetchImpl?: FetchImplementation; r2Storage: R2ResourceStorage }

export function createSupabaseResourceLifecycleHandlers(options: SupabaseLifecycleOptions) {
  const fetchImpl = options.fetchImpl ?? fetch
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const headers = { apikey: options.serviceRoleKey, authorization: `Bearer ${options.serviceRoleKey}` }
  const toClientPack = async (packId: string, row: Record<string, unknown>,
  ): Promise<PackSummary> => {
    const pack = toResourcePack(row)
    const hasCoverPath = typeof row.cover_path === 'string' && row.cover_path.trim().length > 0
    const storageObjectId = typeof row.cover_storage_object_id === 'string'
      ? row.cover_storage_object_id
      : undefined
    if (hasCoverPath !== Boolean(storageObjectId)) throw new Error('Resource Pack cover storage binding is invalid')
    if (!storageObjectId) return pack
    const coverPath = await options.r2Storage.createDownloadUrl(storageObjectId, packId)
    if (!coverPath) throw new Error('Resource Pack cover object is unavailable')
    return { ...pack, coverPath }
  }
  return {
    updateResourcePack: async (packId: string, body: Record<string, unknown>,
    ) => {
      const row = toPackUpdateRow(body)
      if (Object.keys(row).length === 0) throw new Error('No editable Pack fields were supplied')
      const response = await fetchImpl(`${baseUrl}/rest/v1/beegame_resource_packs?id=eq.${encodeURIComponent(packId)}`, { method: 'PATCH', headers: { ...headers, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify(row) })
      if (!response.ok) throw new Error(`Resource Pack update failed (${response.status})`)
      const savedRow = (
        (await response.json()) as Array<Record<string, unknown>>)[0]
      if (!savedRow) throw new ResourceLifecycleNotFoundError('Resource Pack not found')
      return toClientPack(packId, savedRow)
    },
    deleteResourcePack: async (packId: string) => {
      for (const object of await options.r2Storage.listPackObjects(packId)) await options.r2Storage.delete(object.id, packId)
      const deleted = await fetchImpl(`${baseUrl}/rest/v1/beegame_resource_packs?id=eq.${encodeURIComponent(packId)}`, { method: 'DELETE', headers: { ...headers, prefer: 'return=representation' } })
      if (!deleted.ok) throw new Error(`Resource Pack deletion failed (${deleted.status})`)
      return ((await deleted.json()) as Array<unknown>).length > 0
    },
    uploadPackCover: async (packId: string, request: Request,
    ): Promise<ResourcePack> => {
      const form = await request.formData(); const file = form.get('file')
      if (!(file instanceof File)) throw new Error('Cover file is required')
      const storagePackId = safeStorageComponent(packId, 'Pack id')
      const current = await fetchImpl(`${baseUrl}/rest/v1/beegame_resource_packs?id=eq.${encodeURIComponent(packId)}&select=cover_path,cover_storage_object_id`, { headers })
      if (!current.ok) throw new Error(`Resource Pack lookup failed (${current.status})`)
      const currentRow = (
        (await current.json()) as Array<{ cover_path?: string | null; cover_storage_object_id?: string | null }>)[0]
      if (!currentRow) throw new ResourceLifecycleNotFoundError('Resource Pack not found')
      const coverPath = `cover/${crypto.randomUUID()}-${sanitizeStorageBasename(file.name)}`
      const r2Object = await options.r2Storage.upload({ packId: storagePackId, logicalPath: coverPath, file, objectKind: 'resource_preview' })
      let signedCoverUrl: string
      try {
        const r2CoverUrl = await options.r2Storage.createDownloadUrl(r2Object.storageObjectId, storagePackId)
        if (!r2CoverUrl) throw new Error('R2 cover URL signing returned no URL')
        signedCoverUrl = r2CoverUrl
      } catch (error) {
        await options.r2Storage.delete(r2Object.storageObjectId, storagePackId)
        throw error
      }
      const saved = await fetchImpl(`${baseUrl}/rest/v1/beegame_resource_packs?id=eq.${encodeURIComponent(packId)}`, { method: 'PATCH', headers: { ...headers, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify({ cover_path: coverPath, cover_storage_object_id: r2Object.storageObjectId }) })
      if (!saved.ok) {
        await options.r2Storage.delete(r2Object.storageObjectId, storagePackId)
        throw new Error(`Resource Pack cover update failed (${saved.status})`)
      }
      if (typeof currentRow.cover_storage_object_id === 'string') await options.r2Storage.delete(currentRow.cover_storage_object_id, storagePackId)
      const row = ((await saved.json()) as Array<Record<string, unknown>>)[0]
      if (!row) throw new ResourceLifecycleNotFoundError('Resource Pack not found')
      return { ...toResourcePack(row), coverPath: signedCoverUrl }
    },
    getElementResourceUrl: async (packId: string, elementId: string) => {
      const lookup = await fetchImpl(`${baseUrl}/rest/v1/beegame_resource_elements?id=eq.${encodeURIComponent(elementId)}&pack_id=eq.${encodeURIComponent(packId)}&select=pack_id,path,storage_object_id`, { headers })
      if (!lookup.ok) throw new Error(`Resource element lookup failed (${lookup.status})`)
      const element = (
        (await lookup.json()) as Array<{ pack_id?: string; path?: string; storage_object_id?: string | null }>)[0]
      if (!element?.pack_id || !element.path || element.pack_id !== packId) throw new Error('Resource element not found in Pack')
      if (typeof element.storage_object_id !== 'string') throw new Error('Resource element storage object is required')
      const url = await options.r2Storage.createDownloadUrl(element.storage_object_id, packId)
      if (!url) throw new Error('Resource element storage object is unavailable')
      return url
    },
  }
}

export function toResourcePack(row: Record<string, unknown>): PackSummary {
  const styles = Array.isArray(row.styles) ? row.styles.map(String).filter(Boolean) : []
  return {
    id: String(row.id),
    name: String(row.name),
    styles,
    gameTypes: Array.isArray(row.game_types) ? row.game_types.map(String) : [],
    dimension: row.dimension as ResourcePack['dimension'],
    primaryCategory: row.primary_category as ResourcePack['primaryCategory'],
    categories: Array.isArray(row.categories) ? (row.categories as ResourcePack['categories'])
      : [],
    license: String(row.license),
    version: String(row.version),
    status: row.status as ResourcePack['status'],
    ...(typeof row.description === 'string' && row.description ? { description: row.description } : {}),
    ...(Array.isArray(row.tags) && row.tags.length ? { tags: row.tags.map(String) } : {}),
    ...(typeof row.source === 'string' && row.source ? { source: row.source } : {}),
    ...(typeof row.author === 'string' && row.author ? { author: row.author } : {}),
    ...(typeof row.license_evidence === 'string' && row.license_evidence ? { licenseEvidence: row.license_evidence } : {}),
    ...(Array.isArray(row.compatible_engines) && row.compatible_engines.length ? { compatibleEngines: row.compatible_engines.map(String) } : {}),
    ...(typeof row.deprecated_at === 'string' && row.deprecated_at ? { deprecatedAt: row.deprecated_at } : {}),
    elementCount: typeof row.element_count === 'number' ? row.element_count : 0,
  }
}


export function toResourceElement(row: Record<string, unknown>): ResourceElement {
  return {
    id: String(row.id), packId: String(row.pack_id), name: String(row.name), path: String(row.path),
    category: String(row.category) as ResourceElement['category'], kind: String(row.kind),
    ...(row.preview && typeof row.preview === 'object' ? { preview: row.preview as ResourceElement['preview'] } : {}),
    specs: row.specs && typeof row.specs === 'object' ? (row.specs as ResourceElement['specs'])
        : {},
    ...(Array.isArray(row.usage_tags) && row.usage_tags.length ? { usageTags: row.usage_tags.map(String) as ResourceElement['usageTags'] } : {}),
    ...(typeof row.usage_tags_mode === 'string' ? { usageTagsMode: row.usage_tags_mode as ResourceElement['usageTagsMode'] } : {}),
    ...(row.semantic_suggestion && typeof row.semantic_suggestion === 'object' && !Array.isArray(row.semantic_suggestion)
      ? { semanticSuggestion: row.semantic_suggestion as ResourceElement['semanticSuggestion'] }
      : {}),
    ...(typeof row.asset_kind === 'string' ? { assetKind: row.asset_kind as ResourceElement['assetKind'] } : {}),
    ...(Array.isArray(row.capabilities) && row.capabilities.length ? { capabilities: row.capabilities.map(String) as ResourceElement['capabilities'] } : {}),
    ...(row.content_profile && typeof row.content_profile === 'object' ? { contentProfile: row.content_profile as ResourceElement['contentProfile'] } : {}),
    ...(Array.isArray(row.relations) && row.relations.length ? { relations: row.relations as ResourceElement['relations'] } : {}),
    dependencies: Array.isArray(row.dependencies) ? row.dependencies.map(String) : [],
    ...(Array.isArray(row.dependency_bindings) && row.dependency_bindings.length ? { dependencyBindings: row.dependency_bindings as ResourceElement['dependencyBindings'] } : {}),
    status: row.status as ResourceElement['status'],
    ...(typeof row.style_override === 'string' ? { styleOverride: row.style_override } : {}),
    ...(typeof row.dimension_override === 'string' ? { dimensionOverride: row.dimension_override as ResourceElement['dimensionOverride'] } : {}),
  }
}

export function sanitizeStorageBasename(name: string): string {
  const basename = name.split(/[\\/]/).at(-1) ?? ''
  return safeStorageComponent(basename, 'Cover filename')
}

function safeStorageComponent(value: string, label: string): string {
  if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label} is invalid`)
  return value
}

function isSafeRelativeStoragePath(value: string): boolean {
  try { safeRelativeStoragePath(value, 'Storage path'); return true } catch { return false }
}

function safeRelativeStoragePath(value: string, label: string): string {
  if (!value || value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label} is invalid`)
  const parts = value.split('/')
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error(`${label} is invalid`)
  return value
}
