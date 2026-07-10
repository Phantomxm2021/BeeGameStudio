const RESOURCE_LIBRARY_QUERY = 'resourceLibrary'
const RESOURCE_PACK_QUERY = 'resourcePack'

export function isResourceLibraryRoute(): boolean {
  return typeof window !== 'undefined' && new URL(window.location.href).searchParams.get(RESOURCE_LIBRARY_QUERY) === '1'
}

export function openResourceLibraryRoute(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set(RESOURCE_LIBRARY_QUERY, '1')
  window.history.pushState({ resourceLibrary: true }, '', url)
}

export function closeResourceLibraryRoute(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.delete(RESOURCE_LIBRARY_QUERY)
  url.searchParams.delete(RESOURCE_PACK_QUERY)
  window.history.replaceState({}, '', url)
}

export function getResourcePackRoute(): string | undefined {
  if (typeof window === 'undefined') return undefined
  return new URL(window.location.href).searchParams.get(RESOURCE_PACK_QUERY) || undefined
}

export function openResourcePackRoute(packId: string): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set(RESOURCE_LIBRARY_QUERY, '1')
  url.searchParams.set(RESOURCE_PACK_QUERY, packId)
  window.history.pushState({ resourceLibrary: true, resourcePack: packId }, '', url)
}

export function closeResourcePackRoute(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.delete(RESOURCE_PACK_QUERY)
  window.history.replaceState({ resourceLibrary: true }, '', url)
}
