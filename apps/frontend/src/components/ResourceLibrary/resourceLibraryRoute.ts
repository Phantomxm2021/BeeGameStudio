const RESOURCE_LIBRARY_QUERY = 'resourceLibrary'

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
  window.history.replaceState({}, '', url)
}
