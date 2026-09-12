/** Opt-in local reviewer evidence. Never routed through stderr or telemetry. */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, constants, lstatSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs'
import { isAbsolute, join, parse, relative, resolve } from 'node:path'

export const EVIDENCE_VERSION = 'review-evidence-v1'
export type EvidenceIds = { runId: string; attemptId: string; turnId?: string; hostRequestId?: string; reviewerHandleId?: string }
export type RequestIds = { requestId: number; requestAttempt?: number }
const digest = (text: string) => createHash('sha256').update(text).digest('hex')

/** No environment dump. Values are used only to remove known credentials from body text. */
export function evidenceSecrets(env: Readonly<Record<string, string | undefined>>): string[] {
  return Object.entries(env).filter(([key, value]) => /key|token|secret|password|passphrase|credential/i.test(key) && value && value.length >= 4)
    .map(([, value]) => value!).sort((a, b) => b.length - a.length)
}
export function redactEvidence(value: unknown, secrets: readonly string[] = []): unknown {
  const serialized = JSON.stringify(value, (key, item) => {
    if (/^(authorization|proxy.authorization|cookie|set.cookie|.*api.?key|.*auth.?token|api.?token|password|passphrase|secret|client_secret|access_token|refresh_token)$/i.test(key)) return '[REDACTED]'
    if (/^(reasoning_content|signature|encrypted_content)$/i.test(key) || (key === 'thinking' && typeof item === 'string')) return '[OMITTED]'
    if (item && typeof item === 'object' && /^(thinking|redacted_thinking|reasoning|thinking_delta|signature_delta)$/.test(item.type)) return { type: item.type, omitted: true }
    if (typeof item !== 'string') return item
    let safe = item
    for (const secret of secrets) safe = safe.split(secret).join('[REDACTED]')
    return safe.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
      .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
      .replace(/https?:\/\/[^\s<>"'\\]+/gi, raw => {
        // Work on the captured substring only: URL serialization normalizes
        // ordinary source text and can consume a nested JSON quote's escape.
        // Preserve the scheme/host/path bytes; remove userinfo and query data.
        const parts = /^(https?:\/\/)([^/?#]*)(.*)$/i.exec(raw)
        if (!parts) return '[REDACTED_URL]'
        return parts[1]! + parts[2]!.replace(/^.*@/, '') + parts[3]!.replace(/\?[^#]*/, '?redacted')
      })
  })
  return serialized === undefined ? null : JSON.parse(serialized)
}

/** Reject symlink ancestors; diagnostics must not redirect writes outside their owned workspace. */
function privateDirectory(path: string) {
  if (!isAbsolute(path)) throw new Error('Absolute evidence directory required')
  let current = parse(path).root
  for (const part of relative(current, resolve(path)).split('/').filter(Boolean)) {
    current = join(current, part)
    try { mkdirSync(current, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    const stat = lstatSync(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe evidence directory')
  }
  if ((lstatSync(path).mode & 0o077) !== 0) throw new Error('Evidence directory must be private')
}

export function createEvidenceWriter(options: { enabled: boolean; directory: string; ids: EvidenceIds;
  secrets?: readonly string[]; maxBytes?: number; onIncomplete?: () => void }) {
  let fd: number | undefined, sequence = 0, bytes = 0, stopped = false
  const captureId = randomUUID(), seen = new Set<string>()
  const limit = options.maxBytes ?? 64 * 1024 * 1024
  const warn = () => {
    try { options.onIncomplete?.() } catch { /* Diagnostics cannot affect execution. */ }
    try { process.stderr.write('BEEGAME_EVIDENCE_INCOMPLETE\n') } catch { /* No body/error text. */ }
  }
  const close = () => { if (fd !== undefined) { try { closeSync(fd) } catch { /* Best effort. */ } fd = undefined } }
  if (options.enabled) try {
    privateDirectory(options.directory)
    fd = openSync(join(options.directory, `${captureId}.jsonl`), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  } catch { stopped = true; warn() }
  function record(event: string, value: unknown, extra: Partial<EvidenceIds> & Partial<RequestIds> = {}) {
    if (fd === undefined || stopped) return
    try {
      const body = JSON.stringify(redactEvidence(value, options.secrets))
      const sha256 = digest(body), size = Buffer.byteLength(body), name = `${captureId}-${sha256}.json`
      const line = JSON.stringify({ version: EVIDENCE_VERSION, at: new Date().toISOString(), captureId, sequence: ++sequence,
        ...options.ids, ...extra, event, payload: { file: name, sha256, bytes: size, redacted: true } }) + '\n'
      if (bytes + (seen.has(sha256) ? 0 : size) + Buffer.byteLength(line) > limit) {
        writeSync(fd, JSON.stringify({ version: EVIDENCE_VERSION, at: new Date().toISOString(), captureId, sequence, ...options.ids, ...extra,
          event: 'capture_incomplete', reason: 'size_limit', limit }) + '\n')
        stopped = true; warn(); close(); return
      }
      if (!seen.has(sha256)) {
        const blob = openSync(join(options.directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
        try { writeSync(blob, body) } finally { closeSync(blob) }
        seen.add(sha256); bytes += size
      }
      writeSync(fd, line); bytes += Buffer.byteLength(line)
    } catch { stopped = true; warn(); close() }
  }
  return { record, close, get enabled() { return fd !== undefined && !stopped }, get incomplete() { return stopped } }
}

export function evidenceFileDigest(path: string): string | null {
  try { return createHash('sha256').update(readFileSync(path)).digest('hex') } catch { return null }
}
