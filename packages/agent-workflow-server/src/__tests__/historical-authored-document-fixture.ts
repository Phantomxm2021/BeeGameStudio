import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CANONICAL_PROJECT_DOCUMENT_IDS, type FoundationDocumentPath } from '../beegame/delivery-workflow/types'
import type { AuthoredDocumentReceipt } from '../beegame/authored-document-receipt'
import { injectFoundationProtocolMarkers } from '../beegame/foundation-protocol-markers'

/** Test data only: seeds an already committed historical artifact, without
 * author execution, projection, retry, reconciliation or publication logic. */
export async function seedHistoricalAuthoredDocument(input: {
  workspacePath: string
  dispatchId: string
  targetPath: FoundationDocumentPath
  updatedAt?: string
  authoredBody?: string
}): Promise<AuthoredDocumentReceipt> {
  const path = join(input.workspacePath, input.targetPath)
  const raw = input.authoredBody ?? await readFile(path, 'utf8')
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '')
  const updatedAt = input.updatedAt ?? '2026-08-12T00:00:00.000Z'
  const documentId = CANONICAL_PROJECT_DOCUMENT_IDS[input.targetPath]
  const markdown = ['---', `document_id: ${documentId}`, 'version: 1.0.0',
    `updated_at: ${updatedAt}`, '---', injectFoundationProtocolMarkers(input.targetPath, body).trimStart()].join('\n')
  const receipt: AuthoredDocumentReceipt = {
    schemaVersion: 5, dispatchId: input.dispatchId, targetPath: input.targetPath,
    finalDigest: createHash('sha256').update(markdown).digest('hex'),
    byteLength: Buffer.byteLength(markdown), documentId, version: '1.0.0',
    updatedAt, status: 'committed',
  }
  const receiptPath = join(input.workspacePath, '.beegame/workflow/document-commits', `${input.dispatchId}.json`)
  await mkdir(dirname(path), { recursive: true })
  await mkdir(dirname(receiptPath), { recursive: true })
  await writeFile(path, markdown)
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  return receipt
}
