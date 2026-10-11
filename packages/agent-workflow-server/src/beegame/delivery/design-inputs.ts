import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { AUTHOR_BATCHES } from '../project-author'
import { PROJECT_DOCUMENTS } from '../project-content-authority'
import { checkReviewDesignLayouts } from '../design-layout-check'
import { checkDesignDocumentReferences } from '../design-document-references'
import { checkDesignHandoff } from '../design-handoff'
import { projectDeliveryPhase } from './phases'
import type { DesignStageState } from './design-state'

export function legacyIntermediateReview(state: DesignStageState) {
  return projectDeliveryPhase(state) === 'review' && (state.authorBatch ?? AUTHOR_BATCHES.length - 1) < AUTHOR_BATCHES.length - 1 ||
    projectDeliveryPhase(state) === 'author' && !!state.designBaseline && state.designBaseline.batch < AUTHOR_BATCHES.length - 1
}

export const LEGACY_INTERMEDIATE_REVIEW = 'This delivery retains an earlier per-batch review. It cannot be treated as the joint eight-document inspection; explicit owner migration is required before continuing.'

/** Basic saved delivery, not semantic approval of an author's design. */
export async function projectAuthorDraftIssues(workspace: string, batch: number) {
  if (!AUTHOR_BATCHES[batch]) throw new Error('Invalid author batch')
  const issues: string[] = []
  for (const name of new Set(AUTHOR_BATCHES.slice(0, batch + 1).flat())) {
    try {
      const path = join(workspace, 'docs', name), file = await stat(path)
      if (!file.isFile() || !(await readFile(path, 'utf8')).trim()) issues.push(`docs/${name} is missing or empty`)
    } catch { issues.push(`docs/${name} is missing`) }
  }
  return issues
}

export function projectDesignNextConsumers(state: DesignStageState): readonly string[] {
  const next = state.designReview?.returnPhase ?? 'resources'
  return next === 'author'
    ? AUTHOR_BATCHES[state.designReview?.returnAuthorBatch ?? (state.authorBatch ?? AUTHOR_BATCHES.length - 1) + 1] ?? []
    : [next]
}

export function designCheck(workspace: string, state: DesignStageState, nextConsumers?: readonly string[]) {
  const batch = state.authorBatch ?? (projectDeliveryPhase(state) === 'author' ? 0 : AUTHOR_BATCHES.length - 1)
  const documents = [...new Set(AUTHOR_BATCHES.slice(0, batch + 1).flat())]
  let settings: { inputs?: string[]; orientation?: unknown; dimension?: unknown } | undefined
  try { settings = JSON.parse(state.objective).settings } catch { /* Plain-text brief. */ }
  const handoff = checkDesignHandoff(workspace, documents, { nextConsumers: nextConsumers ?? (state.designReview?.returnPhase ? [state.designReview.returnPhase] : AUTHOR_BATCHES[batch + 1] ?? ['resources']),
    technicalBaseline: batch < AUTHOR_BATCHES.length - 1, inputs: settings?.inputs,
    digestVersion: state.designReview ? state.designReview.digestVersion ?? 1 : 2 })
  const geometry = documents.includes('UI_UX_SPEC.md') ? checkReviewDesignLayouts(workspace, settings) : undefined
  return { ...handoff, valid: handoff.valid && (!geometry || geometry.valid), issues: [...handoff.issues, ...geometry?.issues ?? []],
    diagnostics: geometry?.diagnostics ?? [],
    coverage: { documents, layout: geometry?.coverage, files: geometry?.files ?? [], deferred: geometry?.deferred ?? [],
      unverified: ['Semantic completeness and factual observation authenticity require inspection.'] } }
}

export function projectDesignReleaseDiagnostics(workspace: string, state: DesignStageState) {
  return [...designCheck(workspace, state).issues,
    ...checkDesignDocumentReferences(workspace, state.authorBatch ?? AUTHOR_BATCHES.length - 1).issues]
}

export function projectDesignReleaseReport(workspace: string, state: DesignStageState) {
  const check = designCheck(workspace, state)
  const references = checkDesignDocumentReferences(workspace, state.authorBatch ?? AUTHOR_BATCHES.length - 1)
  const documents = state.designReview?.writableDocuments
  const all = [...check.issues, ...references.issues]
  return { revision: check.revision, issues: documents ? all.filter(issue => {
    const owner = PROJECT_DOCUMENTS.find(name => issue.startsWith(name + ':') || issue.startsWith('docs/' + name + ':'))
    return !owner || documents.includes(owner)
  }) : all,
    diagnostics: check.diagnostics.filter(item => !documents || documents.includes(item.owner)), coverage: check.coverage }
}
