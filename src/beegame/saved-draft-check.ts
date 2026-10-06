import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { ToolUseContext } from '../Tool.js'
import type { Message } from '../types/message.js'
import { getCwd } from '../utils/cwd.js'
import { readFileInRange } from '../utils/readFileInRange.js'
import { inspectedDraftHash } from '../utils/fileStateCache.js'

const normalize = (text: string) => text.replace(/^\uFEFF/, '').replace(/\r(?=\n|$)/g, '').trimEnd()

/** Checks observed source exposure, not semantics or claimed quality.
 * Write/Edit cache entries alone are not reads. A previous complete saved
 * read plus known successful edits need not be redundantly read in full.
 */
export async function missingSavedDraftReads(context: ToolUseContext, _messages: readonly Message[]): Promise<string[]> {
  if (!context.beegameReviewDocuments || !context.agentId) return []
  const documents = context.beegameReviewDocuments
  const root = await realpath(getCwd())
  const missing: string[] = []
  for (const name of documents) {
    const path = resolve(getCwd(), 'docs', name)
    try {
      const canonical = await realpath(path), part = relative(root, canonical)
      if (isAbsolute(part) || part === '..' || part.startsWith('../')) throw new Error('Source outside project')
      let cached = context.readFileState.get(path) ?? context.readFileState.get(canonical)
      if (!cached) for (const [key, entry] of context.readFileState.entries()) {
        if (await realpath(key).catch(() => undefined) === canonical) { cached = entry; break }
      }
      const info = await stat(canonical)
      const { content } = await readFileInRange(canonical)
      const currentFullRead = cached && cached.offset !== undefined && cached.offset <= 1 && !cached.isPartialView &&
        cached.timestamp === Math.floor(info.mtimeMs) && normalize(cached.content) === normalize(content)
      const inspectedCurrentVersion = cached?.beegameInspectedHash === inspectedDraftHash(content)
      if (!currentFullRead && !inspectedCurrentVersion)
        missing.push('docs/' + name)
    } catch {
      missing.push('docs/' + name)
    }
  }
  return missing
}
