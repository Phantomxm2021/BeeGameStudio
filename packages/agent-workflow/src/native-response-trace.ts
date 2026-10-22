type RecordValue = Record<string, any>
const record = (value: unknown): RecordValue | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined
const secretKey = /(?:^|[_-])(?:api[_-]?key|auth|authorization|auth[_-]?token|password|passwd|secret|credentials?|access[_-]?token|refresh[_-]?token|token|cookie|private[_-]?key)(?:$|[_-])/i

export function createResponseRedactor(environment: Record<string, string | undefined>) {
  const secrets = Object.entries(environment).filter(([key, value]) => secretKey.test(key) && value && value.length >= 4)
    .map(([, value]) => value!).sort((a, b) => b.length - a.length)
  const text = (value: string) => {
    let result = value
    for (const secret of secrets) result = result.split(secret).join('[REDACTED]')
    // Also redact credential-shaped text inside commands and partially streamed
    // JSON. Snapshots are redacted as a WHOLE, so splitting a key/value across
    // network chunks cannot bypass this filter.
    result = result.replace(/\bBearer\s+[^\s"'\\,}]+/gi, 'Bearer [REDACTED]')
      .replace(/((?:api[_-]?key|auth(?:orization|[_-]?token)?|password|passwd|secret|access[_-]?token|refresh[_-]?token|cookie)["']?\s*[:=]\s*["']?)([^"'\r\n,}]*)(["']?)/gi, '$1[REDACTED]$3')
      .replace(/\b(?:sk|ghp|github_pat)-[A-Za-z0-9_-]+/g, '[REDACTED]')
    // Do not expose a prefix of a configured secret on an unfinished snapshot.
    for (const secret of secrets) for (let size = Math.min(secret.length - 1, result.length); size >= 4; size--)
      if (result.endsWith(secret.slice(0, size))) { result = result.slice(0, -size) + '[REDACTED_PARTIAL]'; break }
    return result
  }
  const redact = (value: any): any => {
    if (typeof value === 'string') return text(value)
    if (Array.isArray(value)) return value.map(redact)
    if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? '[REDACTED]' : redact(item)]))
    return value
  }
  return redact
}
