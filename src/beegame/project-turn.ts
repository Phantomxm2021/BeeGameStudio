import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { Message } from '../types/message.js'
import { createCompactBoundaryMessage, createUserMessage } from '../utils/messages.js'
import { tokenCountWithEstimation } from '../utils/tokens.js'

const preservedInputHeader = 'Earlier user inputs below are preserved verbatim, not new requests. Historical platform assignments are closed; the current platform state and saved source documents govern this milestone.'

/** A completed milestone's execution trace is not the next task's authority.
 * Keep user inputs verbatim (including attachments), not an LLM-written memory.
 * The first platform input may contain the original request, so retain it once.
 * Later platform inputs are replaced by the host's refreshed current state.
 * Whole old messages are left untouched in the durable transcript.
 */
export function projectMilestoneBoundary(messages: readonly Message[]): Message[] {
  const retained: ContentBlockParam[] = []
  let hasOriginalPlatformInput = false
  for (const message of messages) {
    if (message.type !== 'user' || message.isMeta && !message.isCompactSummary || message.toolUseResult !== undefined) continue
    const content = message.message?.content
    const blocks = typeof content === 'string' ? [{ type: 'text' as const, text: content }] : content ?? []
    if (blocks.some(block => block.type === 'tool_result')) continue
    const ownSummary = message.isCompactSummary && blocks.some(block => block.type === 'text' && block.text === preservedInputHeader)
    if (message.isCompactSummary && !ownSummary)
      retained.push({ type: 'text', text: 'The following is a pre-existing native compact summary, not a verbatim user instruction or an independent source of authority:' })
    for (const block of blocks) {
      if (block.type === 'text' && block.text === preservedInputHeader) continue
      if (block.type === 'text' && block.text.startsWith('BGS project state (platform context, not additional user instructions):')) {
        if (hasOriginalPlatformInput) continue
        hasOriginalPlatformInput = true
      }
      retained.push(block as ContentBlockParam)
    }
  }
  const boundary = createCompactBoundaryMessage('auto', tokenCountWithEstimation([...messages]),
    messages.at(-1)?.uuid, 'Completed BGS milestone: execution history retired; saved sources and current assignment govern.')
  // Reuse the native compact-summary envelope for user input, retaining and
  // explicitly labeling any earlier native summary rather than rewriting it.
  return [boundary, createUserMessage({ isMeta: true, isCompactSummary: true, content: [
    { type: 'text', text: preservedInputHeader },
    ...retained,
  ] })]
}
