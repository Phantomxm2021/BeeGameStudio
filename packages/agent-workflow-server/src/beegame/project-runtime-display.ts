import { createHash } from 'node:crypto'

type RuntimeDisplayReason = {
  message: string
  detail: string
  code: string
  diagnosticId: string
}

/** Keep internal failures actionable without showing host paths or credentials. */
export function projectRuntimeDisplayReason(value: unknown): RuntimeDisplayReason | undefined {
  const structured = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
  const reason = typeof value === 'string' ? value.trim()
    : typeof structured?.detail === 'string' ? structured.detail.trim()
    : typeof structured?.message === 'string' ? structured.message.trim() : ''
  if (!reason) return undefined
  const detail = reason
    .replace(/```[\s\S]*?```/g, '[structured payload omitted]')
    .replace(/\b(?:authorization|api[-_ ]?key|access[-_ ]?token|secret)\s*[:=]\s*[^\s,;]+/gi,
      match => `${match.split(/[:=]/, 1)[0]}: [redacted]`)
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/(?:\/Users|\/home|\/private|\/tmp|[A-Za-z]:\\)[^\s,;:()]+/g,
      path => path.split(/[\\/]/).at(-1) ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 800)
  return {
    message: typeof structured?.message === 'string' && structured.message.trim()
      ? structured.message : 'The project task failed and needs attention.',
    detail,
    code: typeof structured?.code === 'string' ? structured.code : 'runtime_failed',
    diagnosticId: typeof structured?.diagnosticId === 'string' ? structured.diagnosticId
      : `runtime-${createHash('sha256').update(reason).digest('hex').slice(0, 12)}`,
  }
}
