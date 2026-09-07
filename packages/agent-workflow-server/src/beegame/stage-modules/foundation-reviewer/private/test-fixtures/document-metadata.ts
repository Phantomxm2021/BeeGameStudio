import type { FoundationDocumentPath } from '../domain/types'
export function withTestDocumentMetadata(path: FoundationDocumentPath, body: string): string {
  return ['---', `document_id: ${path.slice(5, -3)}`, 'version: 1.0.0', 'updated_at: 2026-08-12T00:00:00.000Z', '---', body].join('\n')
}
