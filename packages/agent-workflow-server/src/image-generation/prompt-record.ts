import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ImageGenerationConfig } from './config'

/** Human-readable observations only. Never read by billing, recovery or asset loading. */
export function createImagePromptRecord(workspacePath: string, capabilityPath: string) {
  return (request: { requestId: string; prompt: string; quality?: string; background?: string; size?: string; referenceImagePath?: string },
    config: ImageGenerationConfig | undefined, observation: Record<string, unknown>): boolean => {
    try {
      const root = realpathSync(workspacePath)
      const directory = join(root, 'assets')
      if (!existsSync(directory)) mkdirSync(directory)
      if (lstatSync(directory).isSymbolicLink() || realpathSync(directory) !== directory)
        throw new Error('Unsafe record directory')
      const target = join(directory, 'ai-generation-prompts.md')
      if (existsSync(target) && !lstatSync(target).isFile()) throw new Error('Unsafe record file')
      const previous = existsSync(target) ? readFileSync(target, 'utf8') :
        '# AI image request records\n\nAutomatically recorded observations, not generation instructions or a runtime asset list. Final asset selection and paths belong to Asset Manifest. Editing this file does not submit requests or change billing receipts.\n'
      const id = createHash('sha256').update(request.requestId).digest('hex')
      const start = `<!-- image-request:${id} -->`
      const end = `<!-- /image-request:${id} -->`
      // Whitelist config fields; never serialize keys, endpoint, billing or raw upstream errors.
      const snapshot = { requestId: request.requestId, prompt: request.prompt,
        background: request.background ?? 'auto',
        size: request.size ?? config?.size ?? 'unknown',
        ...(request.referenceImagePath ? { referenceImagePath: request.referenceImagePath } : {}),
        provider: config?.provider ?? 'unknown', model: config?.model ?? 'unknown',
        quality: request.quality ?? config?.quality ?? 'unknown' }
      const safeJson = (value: unknown) => {
        let text = JSON.stringify(value, null, 2)
        for (const secret of [config?.apiKey, config?.upstreamApiKey, capabilityPath].filter(Boolean) as string[])
          text = text.split(JSON.stringify(secret).slice(1, -1)).join('[redacted]')
        // Do not carry signed URLs from accidentally echoed prompt text into the document.
        return text.replace(/https?:\/\/[^\s"<>]+/g, url => url.includes('?') || url.includes(capabilityPath) ? '[redacted-url]' : url)
          .replace(/</g, '\\u003c').replace(/`/g, '\\u0060')
      }
      const event = '\nObservation:\n\n~~~json\n' +
        safeJson({ at: new Date().toISOString(), ...observation }) + '\n~~~\n'
      const index = previous.indexOf(start)
      let next: string
      if (index >= 0) {
        const close = previous.indexOf(end, index)
        if (close < 0) throw new Error('Incomplete request record')
        next = previous.slice(0, close) + event + previous.slice(close)
      } else {
        next = previous + '\n' + start + '\n## Request ' + id.slice(0, 12) +
          '\n\nFirst observed request (not proof of upstream submission):\n\n~~~json\n' +
          safeJson(snapshot) + '\n~~~\n' + event + end + '\n'
      }
      const temporary = join(directory, '.image-prompts-' + randomUUID() + '.tmp')
      writeFileSync(temporary, next, { mode: 0o600, flag: 'wx' })
      renameSync(temporary, target)
      return true
    } catch {
      // An observability failure must not discard a paid response or cause regeneration.
      console.warn('[image-generation]', { event: 'prompt-record-failed' })
      return false
    }
  }
}
