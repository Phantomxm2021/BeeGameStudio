import type {
  ResourceElement,
  ResourcePack,
  ResourceResolvedElement,
  ResourceSelectionDependency,
} from './types'

/** Resolve one element explicitly selected by Claude Code without ranking it. */
export function resolveExactResourceElement(
  pack: ResourcePack,
  elements: readonly ResourceElement[],
  elementId: string,
): ResourceResolvedElement | undefined {
  if (pack.status !== 'published') return undefined
  const element = elements.find(candidate => candidate.id === elementId && candidate.packId === pack.id)
  if (!element || element.status !== 'ready') return undefined
  const readyElementIds = new Set(elements.filter(candidate => candidate.status === 'ready').map(candidate => candidate.id))
  if (element.dependencies.some(dependencyId => !readyElementIds.has(dependencyId))) return undefined
  if ((element.dependencyBindings ?? []).some(binding => !readyElementIds.has(binding.dependencyElementId))) return undefined
  if ((element.relations ?? []).some(relation => relation.required !== false && !readyElementIds.has(relation.targetElementId))) return undefined
  const elementsById = new Map(elements.map(candidate => [candidate.id, candidate]))
  return {
    packId: pack.id,
    packVersion: pack.version,
    packName: pack.name,
    packStyle: element.styleOverride ?? pack.style,
    packGameTypes: pack.gameTypes,
    elementId: element.id,
    elementName: element.name,
    elementPath: element.path,
    category: element.category,
    usageTags: element.usageTags,
    dimension: element.dimensionOverride ?? pack.dimension,
    ...(element.assetKind ? { assetKind: element.assetKind } : {}),
    ...(element.capabilities?.length ? { capabilities: element.capabilities } : {}),
    ...(element.contentProfile ? { contentProfile: element.contentProfile } : {}),
    ...(Object.keys(element.specs).length ? { technicalFacts: { ...element.specs } } : {}),
    ...(element.relations?.length ? { relations: element.relations } : {}),
    dependencies: dependencyClosure(element, elementsById),
  }
}

function dependencyClosure(root: ResourceElement, elementsById: ReadonlyMap<string, ResourceElement>): ResourceSelectionDependency[] {
  const closure: ResourceSelectionDependency[] = []
  const visit = (element: ResourceElement, parentKey: string, ancestors: ReadonlySet<string>) => {
    for (const [index, binding] of (element.dependencyBindings ?? []).entries()) {
      const dependency = elementsById.get(binding.dependencyElementId)
      if (!dependency || ancestors.has(dependency.id)) continue
      const key = `${parentKey}.${index}`
      closure.push({ key, parentKey, elementId: dependency.id, elementPath: dependency.path, referencePath: binding.referencePath, ...(binding.kind ? { kind: binding.kind } : {}) })
      visit(dependency, key, new Set([...ancestors, dependency.id]))
    }
  }
  visit(root, 'root', new Set([root.id]))
  return closure
}
