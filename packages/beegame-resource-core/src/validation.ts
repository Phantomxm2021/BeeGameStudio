import {
  RESOURCE_CATEGORIES,
  RESOURCE_ASSET_KINDS,
  RESOURCE_CAPABILITIES,
  RESOURCE_DIMENSIONS,
  RESOURCE_EMBEDDED_COMPONENT_KINDS,
  RESOURCE_PACK_PRIMARY_CATEGORIES,
  RESOURCE_RELATION_KINDS,
  RESOURCE_USAGE_TAGS,
  type ResourceElement,
  type ResourcePack,
} from './types'

export class ResourceValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResourceValidationError'
  }
}

export function validateResourcePack(value: unknown): ResourcePack {
  if (!isRecord(value)) throw new ResourceValidationError('Resource Pack must be an object')
  requireString(value.id, 'Pack id')
  requireString(value.name, 'Pack name')
  const styles = Array.isArray(value.styles)
    ? value.styles.filter(item => typeof item === 'string' && item.trim())
    : []
  if (!styles.length) requireString(value.style, 'Pack style')
  if (value.styles !== undefined && (styles.length !== value.styles.length || !styles.length)) {
    throw new ResourceValidationError('Pack styles must be a non-empty array of strings')
  }
  requireString(value.license, 'Pack license')
  requireString(value.version, 'Pack version')
  if (!Array.isArray(value.gameTypes) || value.gameTypes.length === 0) {
    throw new ResourceValidationError('Pack gameTypes must not be empty')
  }
  if (!Array.isArray(value.categories) ||
      value.categories.some(item => !isAllowed(item, RESOURCE_CATEGORIES))) {
    throw new ResourceValidationError('Pack categories must be an array of supported values')
  }
  if (!isAllowed(value.primaryCategory, RESOURCE_PACK_PRIMARY_CATEGORIES)) {
    throw new ResourceValidationError('Pack primary category is unsupported')
  }
  if (!isAllowed(value.dimension, RESOURCE_DIMENSIONS)) {
    throw new ResourceValidationError('Pack dimension is unsupported')
  }
  if (!isAllowed(value.status, ['draft', 'published', 'archived'] as const)) {
    throw new ResourceValidationError('Pack status is unsupported')
  }
  if (value.elementDefaults !== undefined && !isElementDefaults(value.elementDefaults)) {
    throw new ResourceValidationError('Pack elementDefaults must contain supported semantic defaults')
  }
  return value as ResourcePack
}

export function validateResourceElement(value: unknown): ResourceElement {
  if (!isRecord(value)) throw new ResourceValidationError('Resource element must be an object')
  for (const field of ['id', 'packId', 'name', 'path', 'kind'] as const) {
    requireString(value[field], `Element ${field}`)
  }
  if (!isAllowed(value.category, RESOURCE_CATEGORIES)) {
    throw new ResourceValidationError('Element category is unsupported')
  }
  if (!isRecord(value.specs) || !Array.isArray(value.dependencies)) {
    throw new ResourceValidationError('Element specs and dependencies are required')
  }
  if (value.dependencyBindings !== undefined && (!Array.isArray(value.dependencyBindings) || value.dependencyBindings.some(binding => !isDependencyBinding(binding)))) {
    throw new ResourceValidationError('Element dependencyBindings must contain valid external reference mappings')
  }
  if (value.usageTags !== undefined &&
      (!Array.isArray(value.usageTags) || value.usageTags.some(item => !isAllowed(item, RESOURCE_USAGE_TAGS)))) {
    throw new ResourceValidationError('Element usageTags must contain supported values')
  }
  if (value.usageTagsMode !== undefined && !isAllowed(value.usageTagsMode, ['inherit', 'override', 'manual-only'] as const)) {
    throw new ResourceValidationError('Element usageTagsMode is unsupported')
  }
  if (value.assetKind !== undefined && !isAllowed(value.assetKind, RESOURCE_ASSET_KINDS)) {
    throw new ResourceValidationError('Element assetKind is unsupported')
  }
  if (value.capabilities !== undefined &&
      (!Array.isArray(value.capabilities) || value.capabilities.some(item => !isAllowed(item, RESOURCE_CAPABILITIES)))) {
    throw new ResourceValidationError('Element capabilities must contain supported values')
  }
  if (value.contentProfile !== undefined && !isContentProfile(value.contentProfile)) {
    throw new ResourceValidationError('Element contentProfile must contain inspected logical-asset contents')
  }
  if (value.relations !== undefined &&
      (!Array.isArray(value.relations) || value.relations.some(relation => !isElementRelation(relation)))) {
    throw new ResourceValidationError('Element relations must contain supported semantic relations')
  }
  if (!isAllowed(value.status, ['queued', 'uploading', 'ready', 'failed', 'hidden', 'archived'] as const)) {
    throw new ResourceValidationError('Element status is unsupported')
  }
  return value as ResourceElement
}

function isElementDefaults(value: unknown): boolean {
  return isRecord(value) &&
    (value.usageTags === undefined || (Array.isArray(value.usageTags) && value.usageTags.every(item => isAllowed(item, RESOURCE_USAGE_TAGS))))
}

function isContentProfile(value: unknown): boolean {
  if (!isRecord(value) || !isAllowed(value.packaging, ['self-contained', 'external-dependencies', 'unknown'] as const)) return false
  if (!Array.isArray(value.components) || value.components.some(component => !isEmbeddedComponent(component))) return false
  const inspection = value.inspection
  return isRecord(inspection) &&
    isAllowed(inspection.status, ['complete', 'partial', 'unavailable'] as const) &&
    isAllowed(inspection.source, ['server', 'client', 'admin'] as const) &&
    (inspection.inspectedAt === undefined || typeof inspection.inspectedAt === 'string') &&
    (inspection.inspectorVersion === undefined || typeof inspection.inspectorVersion === 'string')
}

function isEmbeddedComponent(value: unknown): boolean {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return false
  if (!isAllowed(value.kind, RESOURCE_EMBEDDED_COMPONENT_KINDS)) return false
  if (value.name !== undefined && typeof value.name !== 'string') return false
  if (value.roles !== undefined && (!Array.isArray(value.roles) || value.roles.some(role => typeof role !== 'string' || !role.trim()))) return false
  if (value.specs !== undefined && (!isRecord(value.specs) || Object.values(value.specs).some(item => !['string', 'number', 'boolean'].includes(typeof item)))) return false
  return value.skeletonSignature === undefined || typeof value.skeletonSignature === 'string'
}

function isElementRelation(value: unknown): boolean {
  if (!isRecord(value) || !isAllowed(value.kind, RESOURCE_RELATION_KINDS)) return false
  if (typeof value.targetElementId !== 'string' || !value.targetElementId.trim()) return false
  if (value.role !== undefined && (typeof value.role !== 'string' || !value.role.trim())) return false
  return value.required === undefined || typeof value.required === 'boolean'
}

function isDependencyBinding(value: unknown): value is { referencePath: string; dependencyElementId: string; kind?: string } {
  if (!isRecord(value)) return false
  const referencePath = value.referencePath
  const dependencyElementId = value.dependencyElementId
  if (typeof referencePath !== 'string' || !referencePath.trim() || referencePath.startsWith('/') || referencePath.includes('\\')) return false
  if (typeof dependencyElementId !== 'string' || !dependencyElementId.trim()) return false
  return value.kind === undefined || typeof value.kind === 'string'
}

function requireString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ResourceValidationError(`${label} is required`)
  }
}

function isAllowed<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T)
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
