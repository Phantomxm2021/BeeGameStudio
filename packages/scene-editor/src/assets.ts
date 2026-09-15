import type { SceneAsset, SceneDocument } from './model'

export type AssetPort = { read(path: string): Promise<Uint8Array>; resolve(basePath: string, relativePath: string): string; write(path: string, bytes: Uint8Array): Promise<void> }
export type AssetDiagnostic = { path: string; message: string }
export function dataUri(bytes: Uint8Array, mimeType = 'application/octet-stream') { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return `data:${mimeType};base64,${btoa(binary)}` }
export function fromDataUri(uri: string) { const [, encoded] = uri.split(','); const binary = atob(encoded ?? ''); return Uint8Array.from(binary, char => char.charCodeAt(0)) }
export function registerAsset(document: SceneDocument, asset: SceneAsset) { document.assets[asset.id] = asset; return document }
export function collectRelativeDependencies(gltfText: string, basePath: string) {
  const diagnostics: AssetDiagnostic[] = []; let parsed: { buffers?: { uri?: string }[]; images?: { uri?: string }[] }
  try { parsed = JSON.parse(gltfText) } catch { return { dependencies: [], diagnostics: [{ path: basePath, message: 'Invalid glTF JSON' }] } }
  const dependencies = [...(parsed.buffers ?? []), ...(parsed.images ?? [])].map(item => item.uri).filter((uri): uri is string => Boolean(uri && !uri.startsWith('data:')))
  return { dependencies: [...new Set(dependencies)], diagnostics }
}
export async function importFile(file: File): Promise<SceneAsset> {
  const bytes = new Uint8Array(await file.arrayBuffer()); const id = `asset-${crypto.randomUUID()}`
  return { id, name: file.name, mimeType: file.type || 'application/octet-stream', path: file.name, bytes: dataUri(bytes, file.type || 'application/octet-stream') }
}
