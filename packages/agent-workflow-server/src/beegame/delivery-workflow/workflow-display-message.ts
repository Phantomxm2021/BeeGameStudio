/**
 * Keeps worker protocol payloads out of the user-facing workflow card. Worker
 * responses may include a fenced terminal object after the human-readable
 * update; that object remains available in the durable dispatch record.
 */
export function sanitizeWorkflowDisplayMessage(value: string): string {
  const lines = value.replaceAll('\r', '').split('\n')
  const visible: string[] = []
  let insideFence = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      insideFence = !insideFence
      continue
    }
    if (!insideFence) visible.push(line)
  }

  const message = visible.join('\n').trim()
  if (!message) return ''

  try {
    const payload: unknown = JSON.parse(message)
    if (payload !== null && typeof payload === 'object') return ''
  } catch {
    // Human-readable progress is not required to be JSON.
  }

  return message
}
