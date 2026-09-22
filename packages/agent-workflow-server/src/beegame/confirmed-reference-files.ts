import { createHash } from 'node:crypto'
import { readChatAttachment } from './chat-attachments'

/** Read only attachment-writer files explicitly bound into the confirmed brief. */
export async function readConfirmedReferenceFiles(workspace: string, confirmedBrief: string) {
  let brief: unknown
  try { brief = JSON.parse(confirmedBrief) } catch { return [] }
  if (!brief || typeof brief !== 'object' || !('reference_files' in brief)) return []
  const references = brief.reference_files
  if (!Array.isArray(references) || references.length > 8) throw new Error('Invalid confirmed references')
  const files: Array<{ path: string; bytes: Buffer }> = []
  for (const reference of references) {
    if (!reference || typeof reference.storageId !== 'string' || typeof reference.sha256 !== 'string' ||
        reference.relativePath !== `.beegame-attachments/${reference.storageId}`)
      throw new Error('Invalid confirmed reference path')
    const response = await readChatAttachment(workspace, reference.storageId)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (createHash('sha256').update(bytes).digest('hex') !== reference.sha256)
      throw new Error('Confirmed reference file has changed')
    files.push({ path: reference.relativePath, bytes })
  }
  return files
}
