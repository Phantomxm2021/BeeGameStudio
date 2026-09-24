/** Optional, browser-safe consumption helpers, not a game engine.
 * Uses the same schema and geometry/atlas functions as BGS; no filesystem,
 * workflow, networking, physics or gameplay policy belongs in this module. */
export * from './game-content-schema'
export * from '../../../scene-editor/src/content-coordinates'
export { parseSpriteSheet, spriteSheetSelection, validateSpriteSheetBounds, atlasFrameName } from '../../../scene-editor/src/sprite-sheet'
import { parseBeeGameContentDocument, parseBeeGameContentIndex } from './game-content-schema'

export function readSceneData(value: unknown) {
  const document = parseBeeGameContentDocument(value)
  if (document.kind !== 'scene-2d' && document.kind !== 'scene-3d')
    throw new Error(`Expected scene content, received ${document.kind}`)
  return document.data
}

export function readUiData(value: unknown) {
  const document = parseBeeGameContentDocument(value)
  if (document.kind !== 'ui-screen' && document.kind !== 'ui-hud' && document.kind !== 'ui-flow')
    throw new Error(`Expected UI content, received ${document.kind}`)
  return document.data
}

/** Resolve canonical document descriptors for one load phase.
 * This is metadata only: the game chooses its fetch API and rendering stack. */
export function contentDocumentsForLoad(value: unknown, phase: 'startup' | 'on-demand') {
  const index = parseBeeGameContentIndex(value)
  if (!index.documents)
    throw new Error('Content index has no document load registry; add documents before using staged loading.')
  return index.documents.filter(document => document.loadPhase === phase)
}

/** Resolve a document ID to its declared content-relative path without loading every document first. */
export function contentDocumentPath(value: unknown, documentId: string): string {
  const index = parseBeeGameContentIndex(value)
  const document = index.documents?.find(candidate => candidate.id === documentId)
  if (!document) throw new Error(`Content document is not registered: ${documentId}`)
  return document.path
}

async function fetchRegisteredContentDocument(
  entry: NonNullable<ReturnType<typeof parseBeeGameContentIndex>['documents']>[number],
  indexBase: URL,
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
  if (entry.path.startsWith('/') || entry.path.includes('\\') ||
      entry.path.split('/').some(segment => !segment || segment === '.' || segment === '..'))
    throw new Error(`Unsafe content document path: ${entry.path}`)
  const encodedPath = entry.path.split('/').map(encodeURIComponent).join('/')
  const response = await fetcher(new URL(encodedPath, indexBase))
  if (!response.ok) throw new Error(`Failed to load content document ${entry.id}: HTTP ${response.status}`)
  const document = parseBeeGameContentDocument(await response.json())
  if (document.id !== entry.id || document.kind !== entry.kind)
    throw new Error(`Loaded content document does not match registry: ${entry.id}`)
  return document
}

/** Fetch only the registered group required for the first interactive frame. */
export async function fetchStartupContentDocuments(
  value: unknown,
  indexUrl: string | URL,
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch,
) {
  const index = parseBeeGameContentIndex(value)
  const entries = contentDocumentsForLoad(index, 'startup')
  const indexBase = new URL('.', indexUrl)
  return Promise.all(entries.map(entry => fetchRegisteredContentDocument(entry, indexBase, fetcher)))
}

/** Fetch exactly one on-demand document when the game enters or needs it. */
export async function fetchContentDocument(
  value: unknown,
  documentId: string,
  indexUrl: string | URL,
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch,
) {
  const index = parseBeeGameContentIndex(value)
  const entry = index.documents?.find(document => document.id === documentId)
  if (!entry) throw new Error(`Content document is not registered: ${documentId}`)
  if (entry.loadPhase !== 'on-demand')
    throw new Error(`Content document is not on-demand: ${documentId}`)
  return fetchRegisteredContentDocument(entry, new URL('.', indexUrl), fetcher)
}
