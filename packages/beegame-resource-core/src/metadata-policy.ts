import type { ResourceElement, ResourceFolder, ResourcePack, ResourceUsageTag, ResourceUsageTagsSource } from './types'

export function resolveResourceElementMetadata(
  pack: ResourcePack,
  folders: readonly ResourceFolder[],
  element: ResourceElement,
): ResourceElement {
  const explicitTags = element.usageTags ?? []
  const mode = element.usageTagsMode ?? (explicitTags.length ? 'override' : 'inherit')
  if (mode === 'override') return withEffectiveUsageTags(element, explicitTags, explicitTags.length ? 'element' : 'none')
  if (mode === 'manual-only') return withEffectiveUsageTags(element, [], 'none')

  const folder = closestContainingFolder(folders, element.path)
  const folderTags = folder?.elementDefaults?.usageTags ?? []
  if (folderTags.length) return withEffectiveUsageTags(element, folderTags, 'folder')
  const packTags = pack.elementDefaults?.usageTags ?? []
  if (packTags.length) return withEffectiveUsageTags(element, packTags, 'pack')
  return withEffectiveUsageTags(element, [], 'none')
}

function closestContainingFolder(folders: readonly ResourceFolder[], elementPath: string): ResourceFolder | undefined {
  return folders
    .filter(folder => elementPath.startsWith(`${folder.path}/`))
    .sort((left, right) => right.path.length - left.path.length)[0]
}

function withEffectiveUsageTags(element: ResourceElement, tags: readonly ResourceUsageTag[], source: ResourceUsageTagsSource): ResourceElement {
  return {
    ...element,
    usageTags: [...new Set(tags)],
    usageTagsMode: element.usageTagsMode ?? (element.usageTags?.length ? 'override' : 'inherit'),
    usageTagsSource: source,
  }
}
