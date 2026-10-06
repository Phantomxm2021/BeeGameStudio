import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { PREVIEW_SIZE_BYTES } from '../utils/toolResultStorage.js'

// A selected 3–8KB contract is useful input, not a large format dump. Archiving
// it at 2KB caused an extra Read and subsequent repeated format discovery.
export const SELECTED_FORMAT_INLINE_CHARS = 8_000

// Recognize the same literal format entry after a normal cwd/command prefix.
// This is source-integrity routing, not shell authorization or a shell parser.
const formatInvocation = /(?:^|&&|;)\s*(?:bun|node)\s+\.beegame\/delivery\/check-content\.mjs\s+--format(?:\s|$)/

/** Validate at execution, before stdout can be irreversibly filtered.
 * This is source retrieval only, not a general shell or tool quota.
 */
export function platformFormatCommandIssue(toolName: string, input: unknown, native: boolean): string | undefined {
  if (!native || toolName !== 'Bash' || !input || typeof input !== 'object') return
  const command = (input as { command?: unknown }).command
  if (typeof command === 'string' &&
      formatInvocation.test(command) &&
      command.includes('|'))
    return 'BGS format source must be retrieved without an output-filtering pipeline. Run --format with the needed section names directly. Complete large results are saved with a readable path; filtering with head/tail/jq before that loses the source.'
}

/** Archive format inspection at first emission, never rewrite signed history.
 * Source documents, failed checks and ordinary tools retain their normal limits.
 * The existing persistence path keeps the complete output available to Read.
 */
export function platformFormatResultLimit(
  toolName: string, input: unknown, block: ToolResultBlockParam, native: boolean,
): number | undefined {
  if (!native || block.is_error || typeof block.content !== 'string') return
  // Native Read bypassed the Bash-only format archive in the paid run. Keep
  // complete returned bytes through the same existing persistence path; never
  // lower the inline limit for design prose, focused reads or ordinary CLI work.
  if (toolName === 'Read' && input && typeof input === 'object') {
    const read = input as { file_path?: unknown; offset?: unknown; limit?: unknown }
    if (typeof read.file_path === 'string' &&
        /(?:^|[\\/])\.beegame[\\/]delivery[\\/]content-format\.json$/.test(read.file_path) &&
        read.offset === undefined && read.limit === undefined) return PREVIEW_SIZE_BYTES
    return
  }
  if (toolName !== 'Bash') return
  const command = input && typeof input === 'object' ? (input as { command?: unknown }).command : undefined
  if (typeof command !== 'string' ||
      !formatInvocation.test(command)) return
  try {
    const result = JSON.parse(block.content)
    if (result?.ok === true && ['content-format-sections', 'content-format-section', 'content-format-selection'].includes(result.scope))
      return SELECTED_FORMAT_INLINE_CHARS
  } catch { /* Incomplete, filtered or failed output must remain visible. */ }
}
