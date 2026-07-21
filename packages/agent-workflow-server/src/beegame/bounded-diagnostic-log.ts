import {
  appendFileSync,
  existsSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs'

export type BoundedDiagnosticLogOptions = {
  maxBytes: number
  archiveCount: number
}

/**
 * Appends one diagnostic record while keeping a bounded number of local log
 * segments. These logs are observability artifacts only; canonical transcripts
 * and native evidence are persisted independently and are never rotated here.
 */
export function appendBoundedDiagnosticRecord(
  path: string,
  record: string,
  options: BoundedDiagnosticLogOptions,
): void {
  const maxBytes = positiveInteger(options.maxBytes, 'maxBytes')
  const archiveCount = nonNegativeInteger(options.archiveCount, 'archiveCount')
  const encodedRecord = record.endsWith('\n') ? record : `${record}\n`
  const recordBytes = Buffer.byteLength(encodedRecord, 'utf8')
  const storedRecord = recordBytes <= maxBytes
    ? encodedRecord
    : `${JSON.stringify({
        type: 'diagnostic.record_omitted',
        reason: 'record_exceeds_segment_limit',
        originalBytes: recordBytes,
      })}\n`
  const currentBytes = fileSize(path)

  if (currentBytes > maxBytes) {
    // Unbounded logs written by an older runtime must not survive forever as
    // the first archive of the new bounded format.
    unlinkSync(path)
  } else if (currentBytes > 0 && currentBytes + Buffer.byteLength(storedRecord, 'utf8') > maxBytes) {
    rotateLog(path, archiveCount)
  }

  appendFileSync(path, storedRecord, 'utf8')
}

function rotateLog(path: string, archiveCount: number): void {
  if (archiveCount === 0) {
    if (existsSync(path)) unlinkSync(path)
    return
  }

  const oldest = `${path}.${archiveCount}`
  if (existsSync(oldest)) unlinkSync(oldest)

  for (let index = archiveCount - 1; index >= 1; index -= 1) {
    const source = `${path}.${index}`
    if (existsSync(source)) renameSync(source, `${path}.${index + 1}`)
  }

  if (existsSync(path)) renameSync(path, `${path}.1`)
}

function fileSize(path: string): number {
  if (!existsSync(path)) return 0
  return statSync(path).size
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer.`)
  }
  return value
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer.`)
  }
  return value
}
