import { useEffect, useState } from 'react'
import type { ResourceElement } from '../../services/resourceLibraryApi'
import { ModelPreview, type ModelMetrics } from './ModelPreview'
import type { MaterialTextureBindings } from './materialTextureBindings'

export type PreviewRenderer = 'image' | 'audio' | 'video' | 'font' | 'pdf' | 'text' | 'document-card' | 'model'

type PreviewSelection = Pick<ResourceElement, 'name' | 'kind' | 'specs'> & { mimeType?: string }

const textExtensions = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'xml', 'yaml', 'yml', 'js', 'ts', 'tsx', 'jsx', 'css', 'html', 'htm', 'shader', 'glsl'])
const modelExtensions = new Set(['glb', 'gltf', 'obj', 'fbx'])
const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'avif'])
const audioExtensions = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'])
const videoExtensions = new Set(['mp4', 'webm', 'mov', 'mkv'])
const fontExtensions = new Set(['ttf', 'otf', 'woff', 'woff2'])

export function isSupportedModelPreview(element: PreviewSelection): boolean {
  return modelExtensions.has(extensionFor(element))
}

function extensionFor(element: PreviewSelection): string {
  const specified = element.specs?.extension
  if (typeof specified === 'string' && specified.length > 0) return specified.toLowerCase()
  const separator = element.name.lastIndexOf('.')
  return separator >= 0 ? element.name.slice(separator + 1).toLowerCase() : ''
}

function mimeFor(element: PreviewSelection): string {
  const specified = element.mimeType ?? element.specs?.mimeType
  return typeof specified === 'string' ? specified.toLowerCase() : ''
}

export function renderPreview(element: PreviewSelection): PreviewRenderer {
  const kind = element.kind.toLowerCase()
  const extension = extensionFor(element)
  const mimeType = mimeFor(element)

  if (kind === 'image' || mimeType.startsWith('image/') || imageExtensions.has(extension)) return 'image'
  if (kind === 'audio' || mimeType.startsWith('audio/') || audioExtensions.has(extension)) return 'audio'
  if (kind === 'video' || mimeType.startsWith('video/') || videoExtensions.has(extension)) return 'video'
  if (kind === 'font' || mimeType.startsWith('font/') || fontExtensions.has(extension)) return 'font'
  // The resource service may classify a file as a model before its concrete
  // format is known. Never send an unsupported format to a Three.js loader.
  if (isSupportedModelPreview(element)) return 'model'
  if (extension === 'pdf' || mimeType === 'application/pdf') return 'pdf'
  if (kind === 'text' || textExtensions.has(extension) || mimeType.startsWith('text/')) return 'text'
  return 'document-card'
}

type ResourcePreviewProps = {
  element: ResourceElement
  url: string
  onMetrics?: (metrics: ModelMetrics) => void
  materialTextureBindings?: MaterialTextureBindings
  textureUrls?: Readonly<Record<string, string>>
  externalResourceUrls?: Readonly<Record<string, string>>
  externalReferences?: readonly string[]
  onPreviewError?: (error: Error) => void
}

export function ResourcePreview({ element, url, onMetrics, materialTextureBindings, textureUrls, externalResourceUrls, externalReferences, onPreviewError }: ResourcePreviewProps) {
  const renderer = renderPreview(element)
  const extension = extensionFor(element)

  if (renderer === 'image') return <img src={url} alt={element.name} onError={() => onPreviewError?.(new Error('Image preview failed'))} className="h-full w-full object-contain" />
  if (renderer === 'audio') return <div className="grid h-full w-full place-items-center"><audio controls src={url} onError={() => onPreviewError?.(new Error('Audio preview failed'))}>Your browser cannot play this audio file.</audio></div>
  if (renderer === 'video') return <video controls src={url} onError={() => onPreviewError?.(new Error('Video preview failed'))} className="h-full w-full object-contain">Your browser cannot play this video file.</video>
  if (renderer === 'font') return <FontPreview url={url} element={element} onPreviewError={onPreviewError} />
  if (renderer === 'pdf') return <iframe title={element.name} src={url} sandbox="allow-same-origin" className="h-full w-full border-0" />
  if (renderer === 'text') return <SafeTextPreview url={url} onPreviewError={onPreviewError} />
  if (renderer === 'model') return <ModelPreview url={url} sourcePath={element.path} extension={extension} onMetrics={onMetrics} onMetricsError={onPreviewError} materialTextureBindings={materialTextureBindings} textureUrls={textureUrls} externalResourceUrls={externalResourceUrls} externalReferences={externalReferences} />
  return <DocumentCard element={element} url={url} />
}

function FontPreview({ url, onPreviewError }: { url: string; element: ResourceElement; onPreviewError?: (error: Error) => void }) {
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const font = new FontFace('resource-preview-font', `url(${url})`)
    let active = true
    font.load()
      .then(loadedFont => { document.fonts.add(loadedFont); if (active) setLoaded(true) })
      .catch(error => { if (active) { setLoaded(false); onPreviewError?.(error instanceof Error ? error : new Error('Font preview failed')) } })
    return () => { active = false; document.fonts.delete(font) }
  }, [url])

  return <div className="grid h-full w-full place-items-center p-8"><p className="max-w-full break-words text-center text-4xl text-white" style={{ fontFamily: loaded ? 'resource-preview-font, sans-serif' : 'sans-serif' }}>The quick brown fox jumps over the lazy dog</p></div>
}

function SafeTextPreview({ url, onPreviewError }: { url: string; onPreviewError?: (error: Error) => void }) {
  const [content, setContent] = useState('Loading text preview…')

  useEffect(() => {
    const controller = new AbortController()
    fetch(url, { signal: controller.signal })
      .then(response => response.ok ? response.text() : Promise.reject(new Error('Unable to load text preview')))
      .then(setContent)
      .catch(error => { if (error.name !== 'AbortError') { setContent('Text preview is unavailable.'); onPreviewError?.(error instanceof Error ? error : new Error('Text preview failed')) } })
    return () => controller.abort()
  }, [url])

  return <pre className="h-full w-full overflow-auto whitespace-pre-wrap break-words rounded bg-black/20 p-4 text-sm text-zinc-100">{content}</pre>
}

function DocumentCard({ element, url }: { element: ResourceElement; url: string }) {
  return <div className="grid h-full w-full place-items-center p-8"><div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center text-zinc-200"><p className="font-medium">{element.name}</p><p className="mt-2 text-sm text-zinc-400">This file type cannot be previewed in the workspace.</p><a className="mt-4 inline-block text-sm text-amber-300 underline" href={url} download={element.name}>Download file</a></div></div>
}
