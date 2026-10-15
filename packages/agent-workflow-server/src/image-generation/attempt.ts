import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { imageConfigSchema, type ImageGenerationConfig } from './config'
import { ImageProviderError, type ImageGenerationProvider, type ImageRequest, type ImageResult } from './provider'

/** Host-owned storage only. Never place this directory inside an Agent workspace. */
export type ImageAttemptInput = {
  ownerId: string
  projectId: string
  requestId: string
  config: ImageGenerationConfig
  request: ImageRequest
  recoverOnly?: boolean
  /** Host preflight for new work only; never part of the paid request digest. */
  validateNewRequest?: () => void
}
export class ImageRequestValidationError extends Error {}
type StoredResult = Omit<ImageResult, 'bytes'> & { base64: string }
type Record = {
  digest: string
  state: 'pending' | 'received' | 'rejected' | 'unknown'
  status?: number
  diagnosticId?: string
  code?: string
  result?: StoredResult
}

export class ImageAttemptError extends Error {
  constructor(readonly reason: 'conflict' | 'unknown' | 'rejected' | 'invalid-image', readonly status?: number,
    readonly diagnosticId?: string, readonly code?: string, readonly replayed = false,
    readonly recoveryRequestId?: string) {
    super(`Image generation attempt: ${reason}`)
  }
}

/**
 * A durable single-submission receipt, not an Agent workflow.
 * Billing authorization must happen before invoking this method; this receipt does not charge users.
 * A pending receipt survives crashes and is deliberately NOT resubmitted automatically.
 */
export class ImageAttemptStore {
  private readonly active = new Map<string, Promise<ImageResult>>()
  constructor(private readonly root: string, private readonly provider: ImageGenerationProvider) {}

  validateNewRequest(input: ImageAttemptInput): void {
    const identity = createHash('sha256').update(JSON.stringify([input.ownerId, input.projectId, input.requestId])).digest('hex')
    // A local receipt (including an incomplete one) belongs to the existing
    // recovery path. Do not reinterpret its intent against today's Manifest.
    if (!existsSync(join(this.root, identity))) input.validateNewRequest?.()
  }

  async generate(input: ImageAttemptInput): Promise<ImageResult> {
    const config = imageConfigSchema.parse(input.config)
    if (![input.ownerId, input.projectId, input.requestId].every(value => value.trim().length > 0))
      throw new Error('Image attempt identity is required')
    if (!config.apiKey || !input.request.prompt.trim() || input.request.prompt.length > 32000)
      throw new Error('Image provider configuration and prompt are required')
    input.request.signal?.throwIfAborted()
    const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
    const identity = hash([input.ownerId, input.projectId, input.requestId])
    // Never persist secrets, prompt text, or user identifiers in this receipt.
    const digest = hash([config.provider, config.baseUrl, config.model, input.request.quality ?? config.quality, input.request.size ?? config.size,
      input.request.prompt, input.request.background ?? 'auto', input.request.referenceImage?.sha256 ?? null])
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    const directory = join(this.root, identity)
    const target = join(directory, 'receipt.json')
    if (input.recoverOnly) {
      // An existing wallet receipt must never authorize resubmission after local data loss.
      try { readFileSync(target) } catch { throw new ImageAttemptError('unknown') }
    }
    let existing = false
    try { mkdirSync(directory, { mode: 0o700 }) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      existing = true
    }
    if (existing) {
      let record: Record
      try { record = JSON.parse(readFileSync(target, 'utf8')) }
      catch { throw new ImageAttemptError('unknown') }
      if (record.digest !== digest) throw new ImageAttemptError('conflict')
      const running = this.active.get(identity)
      if (running) return running
      if (record.state === 'received' && record.result) return this.restore(record.result)
      throw new ImageAttemptError(record.state === 'rejected' ? 'rejected' : 'unknown', record.status,
        record.diagnosticId, record.code, true)
    }
    const save = (record: Record) => {
      const temporary = join(directory, `${randomUUID()}.tmp`)
      writeFileSync(temporary, JSON.stringify(record), { mode: 0o600, flush: true })
      renameSync(temporary, target)
    }
    save({ digest, state: 'pending' })
    // Defer invocation until the promise is registered for concurrent callers.
    const running = Promise.resolve().then(async () => {
      let result: ImageResult
      try { result = await this.provider.generate(config, input.request) }
      catch (error) {
        const rejected = error instanceof ImageProviderError && error.outcome === 'rejected'
        const status = error instanceof ImageProviderError ? error.status : undefined
        const diagnosticId = randomUUID()
        const code = error instanceof ImageProviderError ? error.code : 'provider-execution-failed'
        console.warn('[image-generation]', { event: 'attempt-failed', diagnosticId,
          projectId: input.projectId, requestId: input.requestId, provider: config.provider,
          code, upstreamStatus: status, outcome: rejected ? 'rejected' : 'unknown' })
        save({ digest, state: rejected ? 'rejected' : 'unknown', status, diagnosticId, code })
        throw new ImageAttemptError(rejected ? 'rejected' : 'unknown', status, diagnosticId, code)
      }
      // Persist the upstream result BEFORE decoding, publishing, or billing settlement.
      // A post-processing failure must not discard paid output or induce regeneration.
      const stored: StoredResult = {
        base64: Buffer.from(result.bytes).toString('base64'), mimeType: result.mimeType,
        model: result.model, providerRequestId: result.providerRequestId, usage: result.usage,
      }
      save({ digest, state: 'received', result: stored })
      return this.restore(stored)
    })
    this.active.set(identity, running)
    try { return await running }
    finally { this.active.delete(identity) }
  }

  private async restore(result: StoredResult): Promise<ImageResult> {
    const bytes = Buffer.from(result.base64, 'base64')
    try {
      const decoded = await sharp(bytes, { failOn: 'warning' }).raw().toBuffer({ resolveWithObject: true })
      if (!decoded.info.width || !decoded.info.height || result.mimeType !== 'image/png'
        || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        throw new Error('Invalid PNG')
    } catch { throw new ImageAttemptError('invalid-image') }
    const { base64: _, ...metadata } = result
    return { ...metadata, bytes }
  }
}
