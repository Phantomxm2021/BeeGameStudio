/** Optional, browser-safe consumption helpers, not a game engine.
 * Uses the same schema and geometry/atlas functions as BGS; no filesystem,
 * workflow, physics or gameplay policy belongs in this module. */
export * from './game-content-schema'
export { createGameStorage } from './preview-storage.mjs'
export * from '../../../scene-editor/src/content-coordinates'
export { resolveUiNodesForViewport } from '../../../scene-editor/src/ui-responsive'
export { initializeUiLayout, type UiLayoutOptions } from '../../../scene-editor/src/ui-container-layout'
export { inspectUiLayout } from '../../../scene-editor/src/ui-layout-inspection'
export { createUiTextMeasurer } from '../../../scene-editor/src/ui-text-measurement'
export { inspectUiLayoutInBrowser, type UiBrowserInspectionOptions } from '../../../scene-editor/src/ui-browser-inspection'
export { createProductionUiSurface, renderProductionScene2d, sceneNodeClientPoint2d, PRODUCTION_SURFACE_CAPABILITIES, inspectProductionUiSupport,
  resolveSurfaceImage, type SurfaceImage, type SurfaceAssets } from '../../../scene-editor/src/production-surface'
export * from '../../../scene-editor/src/scene-camera'
export { inspectSceneLayout2d, sceneWorldTransforms2d, sceneCameraInput2d } from '../../../scene-editor/src/scene-layout-inspection'
export {
  parseGridData, parseTilemapData, parseTilemapRendererData,
  parseTileSet, validateTilemapGrid, tileRect,
} from '../../../scene-editor/src/tilemap-data'
export { parseSpriteSheet, spriteSheetSelection, validateSpriteSheetBounds, atlasFrameName } from '../../../scene-editor/src/sprite-sheet'
import { parseBeeGameContentDocument, parseBeeGameContentIndex } from './game-content-schema'
import { uiImageKey, uiNodeImageSource, editorAtlasPath } from '../../../scene-editor/src/ui-preview/uiAtlas'
import { uiFontKey } from '../../../scene-editor/src/ui-font-reference'
import { parseSpriteSheet, validateSpriteSheetBounds } from '../../../scene-editor/src/sprite-sheet'
import { resolveSurfaceImage, type SurfaceImage } from '../../../scene-editor/src/production-surface'
let productionFontSequence = 0

/** Browser adapter for the existing registry, not a second resource manifest.
 * Only referenced static images/fonts are decoded. Audio/models stay explicit
 * project integrations, with registered URLs available through resourceUrl. */
export async function loadProductionResources(manifestUrl: string | URL,
  documents: readonly ReturnType<typeof parseBeeGameContentDocument>[],
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch) {
  const base = new URL('../', manifestUrl)
  const urlFor = (path: string) => {
    if (!path || path.startsWith('/') || path.includes('\\') ||
      path.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')) ||
      /^[a-z][a-z0-9+.-]*:/i.test(path)) throw Error('Unsafe registered resource path')
    return new URL(path.split('/').map(encodeURIComponent).join('/'), base)
  }
  const json = async (url: string | URL) => {
    const response = await fetcher(url)
    if (!response.ok) throw Error('Resource metadata HTTP ' + response.status + ': ' + url)
    return response.json()
  }
  const index = await json(manifestUrl)
  if (index.version !== 9 || !Array.isArray(index.modules?.resources)) throw Error('Expected modular AssetManifest v9')
  const resources = await Promise.all(index.modules.resources.map((path: string) => json(urlFor(path)))) as
    Array<{ id:string; root_path:string; file_paths:string[] }>
  const byId = new Map(resources.map(resource => [resource.id,resource]))
  if (byId.size !== resources.length) throw Error('Duplicate registered resource ID')
  const locate = (id:string, member?:unknown) => {
    const resource = byId.get(id)
    if (!resource || !Array.isArray(resource.file_paths) || !resource.file_paths.includes(resource.root_path))
      throw Error('Missing registered resource/root: ' + id)
    const chosen = member === undefined ? resource.root_path : member
    if (typeof chosen !== 'string') throw Error('Invalid resource member: ' + id)
    const candidates = resource.file_paths.includes(chosen) ? [chosen] :
      resource.file_paths.filter(path => path.split('/').at(-1)!.replace(/\.[^.]+$/, '') === chosen)
    if (candidates.length !== 1) throw Error('Missing or ambiguous registered member: ' + id + '/' + chosen)
    urlFor(candidates[0]!)
    return {resource,path:candidates[0]!}
  }
  const assets = new Map<string,SurfaceImage>(), fonts = new Map<string,FontFace>()
  const bitmaps = new Map<string,ImageBitmap>(), faces = new Map<string,FontFace>()
  const dispose = () => { for (const bitmap of bitmaps.values()) bitmap.close(); for (const face of faces.values()) document.fonts.delete(face) }
  const loadImage = async (reference: {assetRef?:string;data?:Record<string,unknown>}) => {
    if (!reference.assetRef) return
    const {assetRef,data={}} = reference, key = uiImageKey(assetRef,{member:data.member})
    const selected = locate(assetRef,data.member)
    let path = selected.path
    if (/\.json$/i.test(path)) {
      const images = selected.resource.file_paths.filter(file => /\.(png|jpe?g|webp|gif|avif)$/i.test(file) &&
        editorAtlasPath(selected.resource,file) === path)
      if (images.length !== 1) throw Error('Atlas requires one registered sibling image: ' + assetRef)
      path = images[0]!
    }
    if (!/\.(png|jpe?g|webp|gif|avif)$/i.test(path)) throw Error('Unsupported static image format: ' + path)
    if (!bitmaps.has(path)) {
      const response = await fetcher(urlFor(path))
      if (!response.ok) throw Error('Image HTTP ' + response.status + ': ' + path)
      bitmaps.set(path,await createImageBitmap(await response.blob()))
    }
    if (!assets.has(key)) {
      const source = bitmaps.get(path)!, metadata = editorAtlasPath(selected.resource,path)
      const sheet = metadata ? parseSpriteSheet(await json(urlFor(metadata))) : undefined
      if (metadata && !sheet) throw Error('Unsupported atlas metadata: ' + metadata)
      if (sheet) validateSpriteSheetBounds(sheet,source.width,source.height)
      assets.set(key,{source,url:urlFor(path).href,...(sheet?{sheet}:{})})
    }
    const frameKey = uiImageKey(assetRef,data)
    if (frameKey !== key && !assets.has(frameKey)) {
      const chosen = resolveSurfaceImage(assets,assetRef,data)
      if (!chosen.frame) throw Error('Selected atlas frame has no rectangle')
      // Isolate the selected pixels once: browser linear filtering must not
      // sample an adjacent atlas frame when scaling a tiny UI or Scene sprite.
      const cacheKey = JSON.stringify([path,chosen.frame])
      if (!bitmaps.has(cacheKey)) bitmaps.set(cacheKey,await createImageBitmap(bitmaps.get(path)!,...chosen.frame))
      assets.set(frameKey,{source:bitmaps.get(cacheKey)!,url:chosen.url})
    }
  }
  const loadFont = async (font: unknown, family?:unknown) => {
    const key = uiFontKey(font)
    if (!key || fonts.has(key)) return
    const reference = font as {assetRef:string;member?:string}
    const {path} = locate(reference.assetRef,reference.member)
    if (!/\.(woff2?|ttf|otf)$/i.test(path)) throw Error('Unsupported font format: ' + path)
    if (!faces.has(path)) {
      const response = await fetcher(urlFor(path))
      if (!response.ok) throw Error('Font HTTP ' + response.status + ': ' + path)
      const face = new FontFace(typeof family === 'string' ? family : 'bgs-' + ++productionFontSequence,await response.arrayBuffer())
      await face.load(); document.fonts.add(face); faces.set(path,face)
    }
    fonts.set(key,faces.get(path)!)
  }
  try {
    for (const source of documents) {
      const doc = parseBeeGameContentDocument(source)
      for (const node of doc.data.nodes ?? []) {
        if (doc.kind.startsWith('ui-')) {
          await loadImage(uiNodeImageSource(node))
          await loadFont(node.data?.font,'style' in node ? node.style?.fontFamily : undefined)
        } else for (const component of 'components' in node ? node.components ?? [] : []) {
          if (component.type === 'image' || component.type === 'sprite-renderer')
            await loadImage({assetRef:component.assetRef,data:component.data})
        }
      }
    }
    return {assets,fonts,resourceUrl:(id:string,member?:string)=>urlFor(locate(id,member).path).href,dispose}
  } catch (error) { dispose(); throw error }
}

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
  const url = new URL(encodedPath, indexBase)
  let response: Response
  try {
    response = await fetcher(url)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new Error(`Failed to fetch content document ${entry.id} (${entry.path}): ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  if (!response.ok) throw new Error(`Failed to load content document ${entry.id}: HTTP ${response.status}`)
  let value: unknown
  try {
    value = await response.json()
  } catch (error) {
    throw new Error(`Invalid JSON for content document ${entry.id} (${entry.path}); check the asset URL and server fallback response`, { cause: error })
  }
  let document: ReturnType<typeof parseBeeGameContentDocument>
  try {
    document = parseBeeGameContentDocument(value)
  } catch (error) {
    throw new Error(`Invalid content document ${entry.id} (${entry.path}): ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  if (document.id !== entry.id || document.kind !== entry.kind)
    throw new Error(`Loaded content document does not match registry: ${entry.id} (${entry.path}); expected ${entry.id}/${entry.kind}, received ${document.id}/${document.kind}`)
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
