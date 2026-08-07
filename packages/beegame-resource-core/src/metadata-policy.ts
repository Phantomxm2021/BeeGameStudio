import type { ResourceElement, ResourceUsageTag, ResourceUsageTagsSource } from './types'

export function resolveEffectiveResourceMetadata(
  element: ResourceElement,
): ResourceElement {
  const explicitTags = element.usageTags ?? []
  const mode = element.usageTagsMode ?? (explicitTags.length ? 'override' : 'inherit')
  if (mode === 'override') return withEffectiveUsageTags(element, explicitTags, explicitTags.length ? 'element' : 'none')
  return withEffectiveUsageTags(element, [], 'none')
}

function withEffectiveUsageTags(element: ResourceElement, tags: readonly ResourceUsageTag[], source: ResourceUsageTagsSource): ResourceElement {
  return {
    ...element,
    usageTags: [...new Set(tags)],
    usageTagsMode: element.usageTagsMode ?? (element.usageTags?.length ? 'override' : 'inherit'),
    usageTagsSource: source,
  }
}
