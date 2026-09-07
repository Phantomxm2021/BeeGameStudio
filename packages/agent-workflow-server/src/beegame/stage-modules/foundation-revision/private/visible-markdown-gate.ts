import { revisionCanonicalJson } from './json-digest'

export const REVISION_MARKDOWN_RESTART_PROMPT =
  'No visible Markdown was emitted. Return the complete raw Markdown document from the beginning now; do not explain or summarize.'

type Decision = 'forward' | 'restart' | 'reject_missing_markdown'

/** One native turn, before the Markdown sink. This owns no process or retry dispatch.
 * Frozen native behavior: only an empty *successful result* may request one restart,
 * and only if no visible text has been observed. That result is not forwarded.
 * Error results always reach the downstream failure/usage handling.
 */
export function createRevisionVisibleMarkdownGate() {
  let visible = ''
  let deltaSeen = false
  let restarted = false
  let ended = false
  return {
    observe(value: unknown): Decision {
      if (ended) throw new Error('Revision visible Markdown turn already ended')
      const message: unknown = JSON.parse(revisionCanonicalJson(value))
      if (!message || typeof message !== 'object' || Array.isArray(message))
        throw new Error('Revision native message must be an object')
      const event = message as Record<string, unknown>
      if (event.type === 'stream_event') {
        deltaSeen = true
        const delta = object(object(event.event)?.delta)
        if (delta?.type === 'text_delta') visible += string(delta.text)
      } else if (event.type === 'assistant' && (!deltaSeen || !visible)) {
        const content = object(event.message)?.content
        if (Array.isArray(content)) {
          visible += content.map(object).filter(block => block?.type === 'text')
            .map(block => string(block!.text)).join('')
        }
      } else if (event.type === 'result' && !visible) {
        visible = string(event.result)
      }
      if (event.type !== 'result') return 'forward'
      const error = event.is_error === true ||
        (typeof event.subtype === 'string' && event.subtype !== 'success')
      if (!error && !string(event.result).trim()) {
        if (!visible.trim() && !restarted) {
          restarted = true
          return 'restart'
        }
        ended = true
        return 'reject_missing_markdown'
      }
      ended = true
      return 'forward'
    },
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

function string(value: unknown): string { return typeof value === 'string' ? value : '' }
