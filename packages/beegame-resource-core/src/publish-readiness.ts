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
      blocking.push({ code: 'element_not_ready', message: `Element ${element.name} is not ready`, elementId: element.id })
    }
    const unresolvedTextures = element.specs.unresolvedTextureReferences
    if (typeof unresolvedTextures === 'string' && unresolvedTextures.trim()) {
      blocking.push({ code: 'unresolved_texture', message: `Element ${element.name} has unresolved texture references`, elementId: element.id })
    }
    const externalReferences = externalReferencePaths(element.specs.externalReferences, element.specs.textureReferences, element.specs.materialReferences)
    const boundReferences = new Set((element.dependencyBindings ?? []).map(binding => binding.referencePath))
    if (externalReferences.some(reference => !boundReferences.has(reference))) {
      blocking.push({ code: 'external_dependency_unmapped', message: `Element ${element.name} has external file references without dependency mappings`, elementId: element.id })
    }
    if (element.status === 'ready' && (!Number.isFinite(Number(element.specs.size)) || Number(element.specs.size) <= 0)) {
      warnings.push({ code: 'size_missing', message: `Element ${element.name} has no recorded file size`, elementId: element.id })
    }
    if (element.status === 'ready' && (typeof element.specs.mimeType !== 'string' || !element.specs.mimeType.trim())) {
      warnings.push({ code: 'mime_type_missing', message: `Element ${element.name} has no recorded MIME type`, elementId: element.id })
    }
    if (element.status === 'ready' && !element.usageTags?.length) {
      blocking.push({ code: 'usage_tags_missing', message: `Element ${element.name} has no declared usage tags`, elementId: element.id })
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
      if (!ids.has(dependencyId)) blocking.push({ code: 'dependency_missing', message: `Element ${element.name} references a missing dependency`, elementId: element.id })
      else if (!readyIds.has(dependencyId)) blocking.push({ code: 'dependency_not_ready', message: `Element ${element.name} references a dependency that is not ready`, elementId: element.id })
    }
    for (const binding of element.dependencyBindings ?? []) {
      if (!ids.has(binding.dependencyElementId)) {
        blocking.push({ code: 'dependency_binding_missing', message: `Element ${element.name} maps an external reference to a missing dependency`, elementId: element.id })
      } else if (!readyIds.has(binding.dependencyElementId)) {
        blocking.push({ code: 'dependency_binding_not_ready', message: `Element ${element.name} maps an external reference to a dependency that is not ready`, elementId: element.id })
      } else if (!element.dependencies.includes(binding.dependencyElementId)) {
        blocking.push({ code: 'dependency_binding_unlisted', message: `Element ${element.name} has a dependency mapping that is not declared in its dependency list`, elementId: element.id })
      }
    }
  }

  const seenPaths = new Map<string, string>()
  const seenContentHashes = new Map<string, string>()
  for (const element of readyElements) {
    const existing = seenPaths.get(element.path)
    if (existing) blocking.push({ code: 'duplicate_path', message: `Elements ${existing} and ${element.name} share the same path`, elementId: element.id })
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

function externalReferencePaths(...values: unknown[]): string[] {
  const references: string[] = []
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) continue
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) references.push(...parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())))
      else references.push(...value.split(' · ').map(item => item.trim()).filter(Boolean))
    } catch {
      references.push(...value.split(' · ').map(item => item.trim()).filter(Boolean))
    }
  }
  return [...new Set(references)]
}

export function assertResourcePackPublishable(pack: ResourcePack, elements: readonly ResourceElement[]): ResourcePublishReadiness {
  const report = evaluateResourcePackPublishReadiness(pack, elements)
  // Preserve the long-standing lifecycle error for callers that distinguish an
  // in-progress upload from the rest of the quality report.
  if (report.blocking.some((issue) => issue.code === 'element_not_ready')) throw new Error('Pack has incomplete uploads')
  if (!report.canPublish) throw new Error(report.blocking.map((issue) => issue.message).join('; '))
  return report
}
