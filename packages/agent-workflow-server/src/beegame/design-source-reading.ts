import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { array, strictObject, string } from 'zod/v4'
import { PROJECT_DOCUMENTS } from '@bee-game-studio/agent-workflow/design-review-result'
import { designDocumentSections } from './design-document-sections'

/** One explicit source batch instead of repository-wide grep or a narrative
 * handoff. Hash and text come from the same bytes; no semantic PASS is inferred. */
export function reviewSourceSnapshot(workspace: string, paths: string[], details = false, includeSections = true) {
  if (!paths.length || paths.some(path => !path || path.startsWith('--')))
    throw Error('Usage: --review-sources workspace-relative-file ... [--details]; list actual design/source/test/report files, not directories')
  const root = realpathSync(workspace), issues: string[] = []
  const sources = [...new Set(paths)].map(path => {
    try {
      if (isAbsolute(path) || path.includes('\\') || path.split('/').some(part =>
        !part || part.startsWith('.') || ['node_modules', 'transcripts'].includes(part)))
        throw Error('Use public workspace-relative source files, not private metadata, history or dependencies')
      const target = resolve(root, path), actual = realpathSync(target), part = relative(root, actual)
      if (actual !== target || isAbsolute(part) || part === '..' || part.startsWith('..' + sep) || !statSync(actual).isFile())
        throw Error('Source must be an actual workspace file without symlink redirection')
      const raw = readFileSync(actual), text = new TextDecoder('utf-8', { fatal: true }).decode(raw)
      if (text.includes('\0')) throw Error('Source must be UTF-8 text, not a binary asset')
      return { path, sha256: createHash('sha256').update(raw).digest('hex'), bytes: raw.length,
        ...(includeSections && path.endsWith('.md') ? { sections: designDocumentSections(text).map(s => ({ heading: s.heading, offset: s.start, limit: s.end - s.start + 1 })) } : {}),
        ...(details ? { text } : {}) }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      issues.push(path + ': ' + reason)
      return { path, unavailable: reason }
    }
  })
  return { scope: 'review-source-snapshot', valid: !issues.length, issues, sources,
    semanticCoverage: 'not-certified', runtimeVerified: false,
    note: 'Explicit current source batch only; not a completeness verdict or filesystem lock. --details reads the selected text together. Inspect applicable design promises as well as author-selected tests; missing evidence is unverified, not PASS. No files written.' }
}

function readSource(workspace: string, document: string) {
  if (!PROJECT_DOCUMENTS.some(name => name === document)) throw Error('Unknown design document')
  const path = join(realpathSync(workspace), 'docs', document)
  if (realpathSync(path) !== path) throw Error('Design source cannot contain symlinks')
  return readFileSync(path, 'utf8')
}

/** TOC from actual prose, including unindexed requirements. No semantic filter,
 * no eager union of all outcome/acceptance sections that approaches full text. */
export function designSourceLocations(workspace: string, documents: readonly string[]) {
  return documents.map(document => {
    try {
      const body = readSource(workspace, document)
      const sections = designDocumentSections(body).map(s => ({ heading: s.heading, offset: s.start, limit: s.end - s.start + 1 }))
      return { document, sections, ...(!sections.length ? { unavailable: 'No headings; read the actual file' } : {}) }
    } catch { return { document, unavailable: 'Source unavailable; inspect the current file, do not infer missing decisions' } }
  })
}

export function readDesignSections(workspace: string, input: unknown) {
  const requests = array(strictObject({ document: string(), sections: array(string().min(1)).min(1) })).min(1).parse(input)
  return { ok: true, scope: 'saved-design-source', semanticCoverage: 'not-certified', sources: requests.map(request => {
    const body = readSource(workspace, request.document), sections = designDocumentSections(body), lines = body.replace(/\r(?=\n|$)/g, '').split('\n')
    const ranges = request.sections.map(heading => {
      const matches = sections.filter(s => s.heading === heading)
      if (matches.length !== 1) throw Error(`${request.document}: missing/ambiguous heading ${JSON.stringify(heading)}; refresh the actual source locations`)
      return matches[0]!
    }).sort((a, b) => a.start - b.start)
    const merged: Array<{ start: number; end: number }> = []
    for (const range of ranges) {
      const previous = merged.at(-1)
      if (previous && range.start <= previous.end + 1) previous.end = Math.max(previous.end, range.end)
      else merged.push({ start: range.start, end: range.end })
    }
    return { document: request.document, requestedSections: request.sections,
      reads: merged.map(r => ({ file_path: 'docs/' + request.document, offset: r.start, limit: r.end - r.start + 1,
        text: lines.slice(r.start - 1, r.end).join('\n') })) }
  }) }
}
