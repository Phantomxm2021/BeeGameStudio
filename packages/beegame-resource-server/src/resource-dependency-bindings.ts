import type { ResourceDependencyBinding, ResourceElement } from '@bee-game-studio/beegame-resource-core'

type DependencyCandidate = Pick<ResourceElement, 'id' | 'path' | 'kind'>

/** Normalize an authored portable relative reference without inferring meaning. */
export function normalizeResourceReference(value: string): string | undefined {
  const source = value.trim().split('\\').join('/')
  if (!source || source.startsWith('/') || source.includes(':')) return undefined
  const parts: string[] = []
  for (const part of source.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length && parts.at(-1) !== '..') parts.pop()
      else parts.push('..')
    } else parts.push(part)
  }
  return parts.join('/') || undefined
}

function resolveFromModelDirectory(modelPath: string, reference: string): string | undefined {
  const model = normalizeResourceReference(modelPath)
  if (!model || model === '..' || model.startsWith('../')) return undefined
  const directory = model.split('/').slice(0, -1)
  const resolved = normalizeResourceReference([...directory, ...reference.split('/')].join('/'))
  return !resolved || resolved === '..' || resolved.startsWith('../') ? undefined : resolved
}

/**
 * Resolve only structural paths authored by the asset exporter. A dependency
 * is accepted when the model-relative path or the Pack-root authored path
 * identifies exactly one element. If upload flattened the exporter directory,
 * an exact filename may be relocated only when it is unique across the Pack.
 * Keyword and semantic guessing are deliberately excluded.
 */
export function resolveResourceDependencyBindings(
  modelPath: string,
  references: readonly string[],
  elements: readonly DependencyCandidate[],
): ResourceDependencyBinding[] {
  const elementsByPath = new Map<string, DependencyCandidate[]>()
  for (const element of elements) {
    const path = normalizeResourceReference(element.path)
    if (!path) continue
    const candidates = elementsByPath.get(path) ?? []
    candidates.push(element)
    elementsByPath.set(path, candidates)
  }

  const bindings: ResourceDependencyBinding[] = []
  for (const sourceReference of references) {
    const referencePath = normalizeResourceReference(sourceReference)
    if (!referencePath) continue
    const modelRelativePath = resolveFromModelDirectory(modelPath, referencePath)
    const packRootPath = referencePath === '..' || referencePath.startsWith('../')
      ? undefined
      : referencePath
    const candidatePaths = [...new Set([
      modelRelativePath,
      packRootPath,
    ].filter((path): path is string => Boolean(path)))]
    if (!candidatePaths.length) continue
    const structuralMatches = [...new Map(candidatePaths.flatMap(path => elementsByPath.get(path) ?? []).map(element => [element.id, element])).values()]
    if (structuralMatches.length > 1) continue
    const matches = structuralMatches.length === 1
      ? structuralMatches
      : elements.filter(element => normalizeResourceReference(element.path)?.split('/').at(-1) === referencePath.split('/').at(-1))
    const uniqueMatches = [...new Map(matches.map(element => [element.id, element])).values()]
    if (uniqueMatches.length !== 1) continue
    bindings.push({ referencePath, dependencyElementId: uniqueMatches[0].id, kind: uniqueMatches[0].kind })
  }
  return bindings
}

export function externalReferencesFromInspection(value: unknown): string[] {
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed)) return normalizeResourceReferences(parsed)
  } catch {
    // Older preview metrics were stored as a human-readable separated list.
  }
  return normalizeResourceReferences(value.split(' · '))
}

function normalizeResourceReferences(values: readonly unknown[]): string[] {
  return [...new Set(values.flatMap(item => typeof item === 'string' ? [normalizeResourceReference(item)] : []).filter((item): item is string => Boolean(item)))]
}

/**
 * Reconcile inspection metadata with exact dependency mappings. This removes
 * only stale unresolved findings covered by an explicit binding; genuinely
 * missing or ambiguous references remain visible to the publish gate.
 */
export function reconcileResourceDependencySpecs(
  specs: ResourceElement['specs'],
  references: readonly string[],
  bindings: readonly ResourceDependencyBinding[],
): ResourceElement['specs'] {
  const normalizedReferences = normalizeResourceReferences(references)
  const boundReferences = new Set(bindings.flatMap(binding => {
    const normalized = normalizeResourceReference(binding.referencePath)
    return normalized ? [normalized] : []
  }))
  const unresolvedReferences = externalReferencesFromInspection(specs.unresolvedTextureReferences)
    .filter(reference => !boundReferences.has(reference))
  return {
    ...specs,
    ...(normalizedReferences.length ? { externalReferences: JSON.stringify(normalizedReferences) } : {}),
    ...(typeof specs.unresolvedTextureReferences === 'string'
      ? { unresolvedTextureReferences: unresolvedReferences.join(' · ') }
      : {}),
  }
}
