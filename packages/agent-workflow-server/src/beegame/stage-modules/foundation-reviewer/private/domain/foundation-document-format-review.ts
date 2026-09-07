import { createHash } from 'node:crypto'
import { validateCompleteGameDocumentMarkdown } from './complete-game-document'
import {
  buildFoundationSectionIndex,
  type SectionRef,
} from './foundation-section-index'
import type {
  FoundationReviewIssue,
} from './foundation-issue-registry'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './types'

type DocumentInput =
  | ReadonlyMap<string, string>
  | Record<string, string>

/** A deterministic, document-scoped diagnostic produced by the format pass. */
export type FoundationDocumentFormatDiagnostic = {
  code: 'FRONT_MATTER_INVALID' | 'MARKDOWN_FORMAT_INVALID'
  message: string
}

const DOCUMENT_FORMAT_EXPECTED =
  'canonical Foundation Markdown must satisfy its document contract, including protocol markers, heading order, Markdown integrity, and each declared production-material serialization'

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

function issueId(path: FoundationDocumentPath, digest: string): string {
  return `AUD-${sha256(canonicalJson({
    reasonCode: 'DOCUMENT_FORMAT_INVALID',
    documentPath: path,
    digest,
  }))
    .slice(0, 24)
    .toUpperCase()}`
}

function documentEntries(input: DocumentInput): Map<string, string> {
  const entries = input instanceof Map ? [...input.entries()] : Object.entries(input)
  const documents = new Map<string, string>()
  for (const [rawPath, content] of entries) {
    const path = rawPath.replaceAll('\\', '/')
    if (!CANONICAL_FOUNDATION_DOCUMENTS.includes(path as FoundationDocumentPath))
      continue
    if (documents.has(path))
      throw new Error(`duplicate canonical foundation document: ${path}`)
    if (typeof content !== 'string')
      throw new Error(`canonical foundation document content is invalid: ${path}`)
    documents.set(path, content)
  }
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS)
    if (!documents.has(path))
      throw new Error(`canonical foundation document is missing: ${path}`)
  return documents
}

function splitFrontMatter(
  path: FoundationDocumentPath,
  content: string,
): { body: string; diagnostics: FoundationDocumentFormatDiagnostic[] } {
  const lines = content.split('\n')
  if (lines[0]?.trim() !== '---')
    return { body: content, diagnostics: [] }

  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === '---',
  )
  if (closingIndex < 0)
    return {
      body: content,
      diagnostics: [
        {
          code: 'FRONT_MATTER_INVALID',
          message: `${path}: front matter is not closed`,
        },
      ],
    }

  const body = lines.slice(closingIndex + 1).join('\n').trimStart()
  if (!body.trim())
    return {
      body,
      diagnostics: [
        {
          code: 'FRONT_MATTER_INVALID',
          message: `${path}: document body is empty after front matter`,
        },
      ],
    }
  return { body, diagnostics: [] }
}

function validateDocument(
  path: FoundationDocumentPath,
  content: string,
): FoundationDocumentFormatDiagnostic[] {
  const diagnostics: FoundationDocumentFormatDiagnostic[] = []
  if (!content.trim()) {
    diagnostics.push({
      code: 'MARKDOWN_FORMAT_INVALID',
      message: `${path}: document is empty`,
    })
    return diagnostics
  }

  const frontMatter = splitFrontMatter(path, content)
  diagnostics.push(...frontMatter.diagnostics)
  if (!frontMatter.body.trim()) return diagnostics

  try {
    validateCompleteGameDocumentMarkdown(path, frontMatter.body)
  } catch (error) {
    diagnostics.push({
      code: 'MARKDOWN_FORMAT_INVALID',
      message:
        error instanceof Error
          ? error.message
          : `${path}: complete Foundation Markdown format is invalid`,
    })
  }
  return diagnostics
}

function formatIssue(
  path: FoundationDocumentPath,
  content: string,
  diagnostics: readonly FoundationDocumentFormatDiagnostic[],
): FoundationReviewIssue {
  const digest = sha256(content)
  const actual = diagnostics
    .map(diagnostic => `[${diagnostic.code}] ${diagnostic.message}`)
    .join('; ')
  const section = localizableSection(path, content, diagnostics)
  if (section)
    return {
      id: issueId(path, digest),
      severity: 'BLOCKER',
      type: 'contract',
      source: section,
      expected: DOCUMENT_FORMAT_EXPECTED,
      actual,
      remediation: {
        kind: 'patch',
        scope: 'section',
        documentPath: path,
        sectionIds: [section.sectionId],
      },
      reasonCode: 'DOCUMENT_FORMAT_INVALID',
    }
  return {
    id: issueId(path, digest),
    severity: 'BLOCKER',
    type: 'contract',
    source: {
      scope: 'document',
      documentPath: path,
      digest,
    },
    expected: DOCUMENT_FORMAT_EXPECTED,
    actual,
    remediation: {
      kind: 'patch',
      scope: 'document',
      documentPath: path,
    },
    reasonCode: 'DOCUMENT_FORMAT_INVALID',
  }
}

/**
 * A format failure belongs to a canonical block when the validator names one
 * and the immutable marker index still proves that block's exact boundary.
 * Whole-document authority remains the single fallback only when that proof
 * cannot be established (for example malformed/missing markers or headings).
 */
function localizableSection(
  path: FoundationDocumentPath,
  content: string,
  diagnostics: readonly FoundationDocumentFormatDiagnostic[],
): SectionRef | undefined {
  if (diagnostics.length !== 1 || diagnostics[0]?.code !== 'MARKDOWN_FORMAT_INVALID')
    return undefined
  const block = /:\s*([a-z0-9._-]+):line\s+\d+\s*$/i.exec(
    diagnostics[0].message,
  )?.[1]
  if (!block) return undefined
  try {
    const index = buildFoundationSectionIndex({ documents: { [path]: content } })
    return index.find(section =>
      section.documentPath === path &&
      (section.sectionId === block || section.sectionId === `material.${block}`),
    )
  } catch {
    return undefined
  }
}

/**
 * Audits all committed Foundation documents as one deterministic format pass.
 *
 * The pass intentionally emits at most one issue for each document. The issue
 * source is a document digest rather than an invented SectionRef, because an
 * invalid document may not have any trustworthy section boundaries yet.
 */
export function auditFoundationDocumentFormats(
  input: { documents: DocumentInput },
): FoundationReviewIssue[] {
  if (!input || typeof input !== 'object' || !input.documents)
    throw new Error('foundation document format review requires documents')
  const documents = documentEntries(input.documents)
  const issues: FoundationReviewIssue[] = []
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    const content = documents.get(path)!
    const diagnostics = validateDocument(path, content)
    if (diagnostics.length) issues.push(formatIssue(path, content, diagnostics))
  }
  return issues
}
