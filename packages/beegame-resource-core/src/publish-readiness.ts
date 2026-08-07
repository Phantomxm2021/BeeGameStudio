import type { ResourceElement, ResourcePack } from './types'

export type ResourcePublishIssue = {
  code: string
  message: string
  elementId?: string
}

export type ResourcePublishReadiness = {
  blocking: readonly ResourcePublishIssue[]
  warnings: readonly ResourcePublishIssue[]
  canPublish: boolean
}

export type ResourceElementSelectionReadiness = {
  selectionReady: boolean
  blocking: readonly ResourcePublishIssue[]
  warnings: readonly ResourcePublishIssue[]
  dependencyIds: readonly string[]
}

export function evaluateResourceElementSelectionReadiness(
  _pack: ResourcePack,
  root: ResourceElement,
  elements: readonly ResourceElement[],
): ResourceElementSelectionReadiness {
  const blocking: ResourcePublishIssue[] = []
  const warnings: ResourcePublishIssue[] = []
  const byId = new Map(elements.map(element => [element.id, element]))
  const dependencyIds = new Set<string>()
  const visited = new Set<string>()
  const visit = (element: ResourceElement): void => {
    if (visited.has(element.id)) return
    visited.add(element.id)
    for (const dependencyId of [
      ...element.dependencies,
      ...(element.dependencyBindings ?? []).map(binding => binding.dependencyElementId),
    ]) {
      dependencyIds.add(dependencyId)
      const dependency = byId.get(dependencyId)
      if (!dependency) {
        blocking.push({ code: 'dependency_missing', message: `Element ${element.name} references a missing dependency`, elementId: element.id })
      } else if (dependency.status !== 'ready') {
        blocking.push({ code: 'dependency_not_ready', message: `Element ${element.name} references a dependency that is not ready`, elementId: element.id })
      } else {
        visit(dependency)
      }
    }
  }
  visit(root)

  if (root.status !== 'ready') blocking.push({ code: 'element_not_ready', message: `Element ${root.name} is not ready`, elementId: root.id })
  if (!hasImmutableContentHash(root)) blocking.push({ code: 'content_hash_missing', message: `Element ${root.name} has no immutable content hash`, elementId: root.id })
  if (!root.assetKind) blocking.push({ code: 'asset_kind_missing', message: `Element ${root.name} has no typed asset kind`, elementId: root.id })
  if (!(root.usageTags?.length ?? 0)) blocking.push({ code: 'usage_tags_missing', message: `Element ${root.name} has no confirmed effective usage tags`, elementId: root.id })

  const externalReferences = externalReferencePaths(root.specs.externalReferences, root.specs.unresolvedTextureReferences)
  const boundReferences = new Set((root.dependencyBindings ?? []).map(binding => normalizeExternalReferencePath(binding.referencePath)).filter((value): value is string => Boolean(value)))
  if (externalReferences.some(reference => !boundReferences.has(reference))) {
    blocking.push({ code: 'external_dependency_unmapped', message: `Element ${root.name} has external file references without dependency mappings`, elementId: root.id })
  }
  for (const relation of root.relations ?? []) {
    if (relation.required !== false && !byId.has(relation.targetElementId)) {
      blocking.push({ code: 'semantic_relation_missing', message: `Element ${root.name} has a required relation to a missing element`, elementId: root.id })
    }
  }
  if (root.kind === 'model' && (!root.contentProfile || root.contentProfile.inspection.status !== 'complete')) {
    warnings.push({ code: 'content_profile_incomplete', message: `Element ${root.name} has not been fully inspected as a logical asset`, elementId: root.id })
  }
  return {
    selectionReady: blocking.length === 0,
    blocking,
    warnings,
    dependencyIds: [...dependencyIds].sort(),
  }
}

/**
 * Evaluates only deterministic repository facts. It deliberately does not
 * guess an asset's meaning from a filename: an incompatible or unresolved
 * resource must remain visible to the administrator instead of being silently
 * accepted at publication time.
 */
export function evaluateResourcePackPublishReadiness(
  pack: ResourcePack,
  elements: readonly ResourceElement[],
): ResourcePublishReadiness {
  const blocking: ResourcePublishIssue[] = []
  const warnings: ResourcePublishIssue[] = []
  const activeElements = elements.filter((element) => element.status !== 'archived')
  const readyElements = activeElements.filter((element) => element.status === 'ready')
  const dependencyElementIds = new Set(activeElements.flatMap(element => [
    ...element.dependencies,
    ...(element.dependencyBindings ?? []).map(binding => binding.dependencyElementId),
  ]))

  if (!pack.license.trim() || ['unassigned', 'unknown', 'none'].includes(pack.license.trim().toLowerCase())) {
    blocking.push({ code: 'license_missing', message: 'Pack license must be recorded before publishing' })
  }
  if (pack.license.trim().toLowerCase() !== 'internal' && !pack.licenseEvidence?.trim()) {
    warnings.push({ code: 'license_evidence_missing', message: 'Pack license has no recorded evidence' })
  }
  if (!pack.version.trim()) blocking.push({ code: 'version_missing', message: 'Pack version must be recorded before publishing' })
  if (!readyElements.length) blocking.push({ code: 'no_ready_elements', message: 'Pack has no ready elements to publish' })

  for (const element of activeElements) {
    if (['queued', 'uploading', 'failed'].includes(element.status)) {
      warnings.push({ code: 'element_not_ready', message: `Element ${element.name} is not ready`, elementId: element.id })
    }
    const externalReferences = externalReferencePaths(element.specs.externalReferences)
    const boundReferences = new Set((element.dependencyBindings ?? []).flatMap(binding => {
      const normalized = normalizeExternalReferencePath(binding.referencePath)
      return normalized ? [normalized] : []
    }))
    const unresolvedTextures = externalReferencePaths(element.specs.unresolvedTextureReferences)
    if (unresolvedTextures.some(reference => !boundReferences.has(reference))) {
      warnings.push({ code: 'unresolved_texture', message: `Element ${element.name} has unresolved texture references`, elementId: element.id })
    }
    if (externalReferences.some(reference => !boundReferences.has(reference))) {
      warnings.push({ code: 'external_dependency_unmapped', message: `Element ${element.name} has external file references without dependency mappings`, elementId: element.id })
    }
    if (element.status === 'ready' && (!Number.isFinite(Number(element.specs.size)) || Number(element.specs.size) <= 0)) {
      warnings.push({ code: 'size_missing', message: `Element ${element.name} has no recorded file size`, elementId: element.id })
    }
    if (element.status === 'ready' && (typeof element.specs.mimeType !== 'string' || !element.specs.mimeType.trim())) {
      warnings.push({ code: 'mime_type_missing', message: `Element ${element.name} has no recorded MIME type`, elementId: element.id })
    }
    if (element.status === 'ready' && !dependencyElementIds.has(element.id) && !element.usageTags?.length) {
      warnings.push({ code: 'usage_tags_missing', message: `Element ${element.name} has no declared usage tags`, elementId: element.id })
    }
    if (element.status === 'ready' && !hasImmutableContentHash(element)) {
      warnings.push({ code: 'content_hash_missing', message: `Element ${element.name} has no immutable content hash`, elementId: element.id })
    }
    if (element.status === 'ready' && !element.assetKind) {
      warnings.push({ code: 'asset_kind_missing', message: `Element ${element.name} has no typed asset kind`, elementId: element.id })
    }
    if (element.status === 'ready' && element.kind === 'model' && (!element.contentProfile || element.contentProfile.inspection.status !== 'complete')) {
      warnings.push({ code: 'content_profile_incomplete', message: `Element ${element.name} has not been fully inspected as a logical asset`, elementId: element.id })
    }
    if (element.specs.previewStatus === 'failed') {
      warnings.push({ code: 'preview_failed', message: `Element ${element.name} preview generation failed`, elementId: element.id })
    }
    if (element.specs.inspectionStatus === 'binary_fbx_requires_processor') {
      warnings.push({ code: 'model_inspection_incomplete', message: `Element ${element.name} requires binary FBX inspection`, elementId: element.id })
    }
    if (Number(element.specs.size) > 512 * 1024 * 1024) {
      warnings.push({ code: 'file_size_large', message: `Element ${element.name} exceeds the recommended 512 MB size`, elementId: element.id })
    }
  }

  const ids = new Set(elements.map((element) => element.id))
  const readyIds = new Set(readyElements.map((element) => element.id))
  for (const element of readyElements) {
    for (const dependencyId of element.dependencies) {
      if (!ids.has(dependencyId)) warnings.push({ code: 'dependency_missing', message: `Element ${element.name} references a missing dependency`, elementId: element.id })
      else if (!readyIds.has(dependencyId)) warnings.push({ code: 'dependency_not_ready', message: `Element ${element.name} references a dependency that is not ready`, elementId: element.id })
    }
    for (const binding of element.dependencyBindings ?? []) {
      if (!ids.has(binding.dependencyElementId)) {
        warnings.push({ code: 'dependency_binding_missing', message: `Element ${element.name} maps an external reference to a missing dependency`, elementId: element.id })
      } else if (!readyIds.has(binding.dependencyElementId)) {
        warnings.push({ code: 'dependency_binding_not_ready', message: `Element ${element.name} maps an external reference to a dependency that is not ready`, elementId: element.id })
      } else if (!element.dependencies.includes(binding.dependencyElementId)) {
        warnings.push({ code: 'dependency_binding_unlisted', message: `Element ${element.name} has a dependency mapping that is not declared in its dependency list`, elementId: element.id })
      }
    }
    for (const relation of element.relations ?? []) {
      if (!ids.has(relation.targetElementId)) {
        warnings.push({ code: 'semantic_relation_missing', message: `Element ${element.name} has a semantic relation to a missing element`, elementId: element.id })
      } else if (relation.required !== false && !readyIds.has(relation.targetElementId)) {
        warnings.push({ code: 'semantic_relation_not_ready', message: `Element ${element.name} requires a semantic relation that is not ready`, elementId: element.id })
      }
    }
  }

  const seenPaths = new Map<string, string>()
  const seenContentHashes = new Map<string, string>()
  for (const element of readyElements) {
    const existing = seenPaths.get(element.path)
    if (existing) warnings.push({ code: 'duplicate_path', message: `Elements ${existing} and ${element.name} share the same path`, elementId: element.id })
    else seenPaths.set(element.path, element.name)
    const contentHash = typeof element.specs.contentHash === 'string' ? element.specs.contentHash.trim() : ''
    if (contentHash) {
      const duplicate = seenContentHashes.get(contentHash)
      if (duplicate) warnings.push({ code: 'duplicate_content', message: `Elements ${duplicate} and ${element.name} have identical file content`, elementId: element.id })
      else seenContentHashes.set(contentHash, element.name)
    }
  }

  return { blocking, warnings, canPublish: blocking.length === 0 }
}

function hasImmutableContentHash(element: ResourceElement): boolean {
  const value = element.specs.contentHash
  if (typeof value !== 'string' || value.length !== 64) return false
  for (const character of value.toLocaleLowerCase())
    if (!'0123456789abcdef'.includes(character)) return false
  return true
}

function externalReferencePaths(...values: unknown[]): string[] {
  const references: string[] = []
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) continue
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) references.push(...parsed.flatMap(item => typeof item === 'string' ? [normalizeExternalReferencePath(item)] : []).filter((item): item is string => Boolean(item)))
      else references.push(...value.split(' · ').map(normalizeExternalReferencePath).filter((item): item is string => Boolean(item)))
    } catch {
      references.push(...value.split(' · ').map(normalizeExternalReferencePath).filter((item): item is string => Boolean(item)))
    }
  }
  return [...new Set(references)]
}

function normalizeExternalReferencePath(value: string): string | undefined {
  const source = value.trim().split('\\').join('/')
  if (!source || source.startsWith('/') || source.includes(':')) return undefined
  const parts: string[] = []
  for (const part of source.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) return undefined
      parts.pop()
    } else parts.push(part)
  }
  return parts.join('/') || undefined
}

export function assertResourcePackPublishable(pack: ResourcePack, elements: readonly ResourceElement[]): ResourcePublishReadiness {
  const report = evaluateResourcePackPublishReadiness(pack, elements)
  if (!report.canPublish) throw new Error(report.blocking.map((issue) => issue.message).join('; '))
  return report
}
