import {
  RESOURCE_CATEGORIES,
  RESOURCE_DIMENSIONS,
  RESOURCE_PACK_PRIMARY_CATEGORIES,
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
  requireString(value.style, 'Pack style')
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
  if (!isAllowed(value.status, ['queued', 'uploading', 'ready', 'failed', 'hidden', 'archived'] as const)) {
    throw new ResourceValidationError('Element status is unsupported')
  }
  return value as ResourceElement
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
