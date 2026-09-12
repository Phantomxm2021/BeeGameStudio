import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { applyPatch, createTwoFilesPatch } from 'diff'
import { captureSingleReviewInput, reviewDocumentSetDigest, reviewHash, type SingleReviewInput } from './single-agent-contract'

const DEFAULT_LIMITS = { timeoutMs: 250, maxEditLength: 20_000, maxPatchBytes: 2 * 1024 * 1024 }

/** Deterministic source comparison, never an interpretation of repair claims.
 * When diff generation is bounded, preserve both full versions and say so. */
export function buildReviewComparison(value: SingleReviewInput, limits = DEFAULT_LIMITS) {
  const source = captureSingleReviewInput(value)
  if (!source.comparison || source.subject.kind !== 'candidate') return undefined
  const files: { path: string; content: string }[] = []
  if (source.comparison.reviewEvidence) files.push({ path: 'review-context/prior-review.json',
    content: JSON.stringify(source.comparison.reviewEvidence, null, 2) })
  const documents = source.documents.map(document => {
    const base = source.comparison!.baseDocuments.find(item => item.path === document.path)!
    const basePath = `review-context/baseline/${document.path}`
    files.push({ path: basePath, content: base.content })
    const changed = base.content !== document.content
    const binding = { path: document.path, basePath, baseDigest: reviewHash(base.content),
      candidateDigest: reviewHash(document.content), changed }
    if (!changed) return { ...binding, diffStatus: 'unchanged' as const }
    const patch = createTwoFilesPatch(basePath, document.path, base.content, document.content,
      undefined, undefined, { context: 3, stripTrailingCr: false,
        timeout: limits.timeoutMs, maxEditLength: limits.maxEditLength })
    if (patch === undefined || Buffer.byteLength(patch) > limits.maxPatchBytes)
      return { ...binding, diffStatus: 'full_files_required' as const, reason: 'diff_generation_limit' }
    // Never offer a partial or lossy diff as a faithful description of changes.
    if (applyPatch(base.content, patch) !== document.content)
      return { ...binding, diffStatus: 'full_files_required' as const, reason: 'diff_roundtrip_mismatch' }
    const diffPath = `review-context/changes/${document.path}.diff`
    files.push({ path: diffPath, content: patch })
    return { ...binding, diffStatus: 'available' as const, diffPath }
  })
  const manifest = { version: 1, sourceReviewResultId: source.subject.sourceReviewResultId,
    sourceReviewResultDigest: source.subject.sourceReviewResultDigest,
    candidateResultId: source.subject.candidateResultId, candidateId: source.subject.candidateId,
    baseDocumentSetDigest: source.subject.baseDocumentSetDigest,
    candidateDocumentSetDigest: reviewDocumentSetDigest(source.documents), round: source.subject.round,
    changedDocumentCount: documents.filter(document => document.changed).length,
    ...(source.comparison.reviewEvidence ? { priorReviewPath: 'review-context/prior-review.json' } : {}), documents }
  return { manifest, files }
}

export async function materializeReviewComparison(workspacePath: string, source: SingleReviewInput) {
  const comparison = buildReviewComparison(source)
  if (!comparison) return false
  for (const file of [...comparison.files,
    { path: 'review-context/manifest.json', content: JSON.stringify(comparison.manifest, null, 2) }]) {
    const destination = join(workspacePath, file.path)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, file.content, { flag: 'wx', mode: 0o400 })
  }
  return true
}
