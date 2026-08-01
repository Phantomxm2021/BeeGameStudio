import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import { resolveWorkspaceRelativePath } from './revision'
import { auditAssetContract } from '../asset-contract-audit'
import {
  buildSystemDeliveryContract,
  SYSTEM_DELIVERY_CONTRACT_ARTIFACT_PATH,
} from './system-delivery-contract'
import {
  CANONICAL_ASSET_MANIFEST,
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENTS,
  COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
  FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
  type DocumentReviewCheck,
  type DocumentReviewCheckId,
  type DocumentReviewFinding,
  type DocumentReviewScope,
} from './types'

export const REVIEW_AUTHORITY_ARTIFACT_PATH = 'reviewAuthority' as const

const SYSTEM_DELIVERY_CONTRACT_CHECK_IDS = new Set<DocumentReviewCheckId>([
  'cross_document_consistency',
  'technical_feasibility',
  'content_structure_fitness',
  'resource_content_consistency',
])

export type ReviewAuthority = {
  confirmedBriefContext: string
  confirmedBriefDigest: string
}

export type DocumentReviewArtifact = {
  path: string
  content: string
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export function assertReviewAuthority(authority: ReviewAuthority): void {
  if (!authority.confirmedBriefContext.trim())
    throw new Error('document review authority is empty')
  if (sha256(authority.confirmedBriefContext) !== authority.confirmedBriefDigest)
    throw new Error('document review authority digest does not match durable context')
}

export function requiredDocumentReviewCheckIds(
  scope: DocumentReviewScope,
): DocumentReviewCheckId[] {
  return scope === 'foundation'
    ? [...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS]
    : [...COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS]
}

function reviewResourceProjection(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const resource = value as Record<string, unknown>
  return Object.fromEntries(Object.entries({
    id: resource.id,
    source: resource.source,
    root_path: resource.root_path,
    file_paths: resource.file_paths,
    provisional: resource.provisional,
    status: resource.status,
    selection_reason: resource.selection_reason,
    asset_kind: resource.asset_kind,
    capabilities: resource.capabilities,
    content_profile: resource.content_profile,
    technical_facts: resource.technical_facts,
  }).filter(([, field]) => field !== undefined))
}

function manifestProjection(content: string): string {
  const parsed = JSON.parse(content) as Record<string, unknown>
  const manifestDigest = sha256(content)
  return `${JSON.stringify({
    manifestRevision: manifestDigest,
    manifestDigest,
    version: parsed.version,
    project_target: parsed.project_target,
    requirements: parsed.requirements,
    resources: Array.isArray(parsed.resources)
      ? parsed.resources.map(reviewResourceProjection)
      : parsed.resources,
  })}\n`
}
/** Build the exact revision-bound source for an initial or closure review. */
export async function readDocumentReviewArtifacts(
  workspacePath: string,
  scope: DocumentReviewScope,
  authority: ReviewAuthority,
): Promise<DocumentReviewArtifact[]> {
  assertReviewAuthority(authority)
  const paths =
    scope === 'foundation'
      ? CANONICAL_FOUNDATION_DOCUMENTS
      : [...CANONICAL_PROJECT_DOCUMENTS, CANONICAL_ASSET_MANIFEST]
  const artifacts = await Promise.all(
    paths.map(async path => {
      const absolutePath = resolveWorkspaceRelativePath(workspacePath, path)
      if (!absolutePath)
        throw new Error(
          `canonical review artifact is outside the workspace: ${path}`,
        )
      const content = await readFile(absolutePath, 'utf8')
      return {
        path,
        content:
          path === CANONICAL_ASSET_MANIFEST
            ? manifestProjection(content)
            : content,
      }
    }),
  )
  const contentArtifacts =
    scope === 'complete'
      ? await Promise.all(
          auditAssetContract(workspacePath).content.files.map(async file => ({
            path: file.path,
            content: await readFile(
              resolveWorkspaceRelativePath(workspacePath, file.path)!,
              'utf8',
            ),
          })),
        )
      : []
  return [
    {
      path: REVIEW_AUTHORITY_ARTIFACT_PATH,
      content: authority.confirmedBriefContext,
    },
    {
      path: SYSTEM_DELIVERY_CONTRACT_ARTIFACT_PATH,
      content: `${JSON.stringify(buildSystemDeliveryContract())}\n`,
    },
    ...artifacts,
    ...contentArtifacts,
  ]
}

export function documentReviewArtifactDigests(
  artifacts: DocumentReviewArtifact[],
): Record<string, string> {
  return Object.fromEntries(
    artifacts.map(artifact => [artifact.path, sha256(artifact.content)]),
  )
}

function exactMarkdownHeadingExists(content: string, anchor: string): boolean {
  for (const line of content.split('\n')) {
    const candidate = line.trimStart()
    let markerLength = 0
    while (candidate[markerLength] === '#') markerLength += 1
    if (markerLength === 0 || candidate[markerLength] !== ' ') continue
    const heading = candidate.slice(markerLength + 1).trim()
    if (anchor === heading || anchor === candidate.trim()) return true
  }
  return false
}

function decodeJsonPointerToken(value: string): string {
  return value.split('~1').join('/').split('~0').join('~')
}

function exactJsonPointerExists(content: string, pointer: string): boolean {
  if (pointer === '$') return true
  if (!pointer.startsWith('/')) return false
  let current: unknown
  try {
    current = JSON.parse(content)
  } catch {
    return false
  }
  for (const rawToken of pointer.slice(1).split('/')) {
    const token = decodeJsonPointerToken(rawToken)
    if (Array.isArray(current)) {
      const index = Number(token)
      if (!Number.isInteger(index) || index < 0 || index >= current.length)
        return false
      current = current[index]
      continue
    }
    if (!current || typeof current !== 'object') return false
    const record = current as Record<string, unknown>
    if (!Object.hasOwn(record, token)) return false
    current = record[token]
  }
  return true
}

function structuredContentId(content: string, yaml: boolean): string | undefined {
  try {
    const value = yaml
      ? (parseYaml(content) as unknown)
      : (JSON.parse(content) as unknown)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const id = (value as Record<string, unknown>).id
    return typeof id === 'string' && id.trim() ? id : undefined
  } catch {
    return undefined
  }
}

export function validateDocumentReviewChecks(input: {
  scope: DocumentReviewScope
  checks: DocumentReviewCheck[]
  artifacts: DocumentReviewArtifact[]
}): string[] {
  const expected = requiredDocumentReviewCheckIds(input.scope)
  const submitted = input.checks.map(check => check.id)
  const issues: string[] = []
  if (
    submitted.length !== expected.length ||
    new Set(submitted).size !== expected.length ||
    expected.some(id => !submitted.includes(id))
  )
    issues.push('document review does not cover the required check set')
  const artifacts = new Map(
    input.artifacts.map(artifact => [artifact.path, artifact.content]),
  )
  for (const check of input.checks) {
    if (
      SYSTEM_DELIVERY_CONTRACT_CHECK_IDS.has(check.id) &&
      !check.evidence.some(
        evidence =>
          evidence.path === SYSTEM_DELIVERY_CONTRACT_ARTIFACT_PATH,
      )
    )
      issues.push(
        `document review check ${check.id} does not cite the system delivery contract`,
      )
    for (const evidence of check.evidence) {
      const content = artifacts.get(evidence.path)
      if (content === undefined) {
        issues.push(
          `document review check ${check.id} references an unavailable artifact`,
        )
        continue
      }
      const anchorExists =
        evidence.path === REVIEW_AUTHORITY_ARTIFACT_PATH
          ? evidence.anchor === '$'
          : evidence.path.endsWith('.md')
          ? exactMarkdownHeadingExists(content, evidence.anchor)
          : evidence.path.endsWith('.yaml') || evidence.path.endsWith('.yml')
            ? structuredContentId(content, true) === evidence.anchor
            : exactJsonPointerExists(content, evidence.anchor)
      if (!anchorExists)
        issues.push(
          `document review check ${check.id} references a missing exact anchor`,
        )
    }
  }
  return issues
}

export function checkEvidenceDigests(input: {
  checks: DocumentReviewCheck[]
  artifacts: DocumentReviewArtifact[]
}): Record<string, Record<string, string>> {
  const digests = documentReviewArtifactDigests(input.artifacts)
  return Object.fromEntries(
    input.checks.map(check => [
      check.id,
      Object.fromEntries(
        check.evidence.map(evidence => [
          evidence.path,
          digests[evidence.path]!,
        ]),
      ),
    ]),
  )
}

function idSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set()
  return new Set(
    value.flatMap(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return []
      const id = (item as Record<string, unknown>).id
      return typeof id === 'string' && id ? [id] : []
    }),
  )
}

export function validateDocumentReviewFindingSubjects(input: {
  findings: DocumentReviewFinding[]
  artifacts: DocumentReviewArtifact[]
}): string[] {
  const manifest = input.artifacts.find(
    artifact => artifact.path === CANONICAL_ASSET_MANIFEST,
  )
  let projection: Record<string, unknown> = {}
  if (manifest)
    try {
      const parsed = JSON.parse(manifest.content) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        projection = parsed as Record<string, unknown>
    } catch {
      return ['document review manifest projection is invalid']
    }
  const requirementIds = idSet(projection.requirements)
  const resourceIds = idSet(projection.resources)
  const contentIdsByPath = new Map(
    input.artifacts
      .filter(artifact => artifact.path.startsWith('assets/content/'))
      .flatMap(artifact => {
        const id = structuredContentId(
          artifact.content,
          artifact.path.endsWith('.yaml') || artifact.path.endsWith('.yml'),
        )
        return id ? [[artifact.path, id] as const] : []
      }),
  )
  const contentIds = new Set(contentIdsByPath.values())
  const issues: string[] = []
  for (const finding of input.findings) {
    for (const subject of finding.subjects) {
      const artifact = input.artifacts.find(item => item.path === subject.path)
      if (!artifact) {
        issues.push(`document review finding ${finding.findingId} has an unavailable subject`)
        continue
      }
      const anchorExists =
        subject.path === REVIEW_AUTHORITY_ARTIFACT_PATH
          ? subject.anchor === '$'
          : subject.path.endsWith('.md')
            ? exactMarkdownHeadingExists(artifact.content, subject.anchor)
            : subject.path.endsWith('.json')
              ? exactJsonPointerExists(artifact.content, subject.anchor)
              : contentIdsByPath.get(subject.path) === subject.anchor
      if (!anchorExists)
        issues.push(`document review finding ${finding.findingId} has a missing exact anchor`)

      const foundationPath = CANONICAL_FOUNDATION_DOCUMENTS.includes(
        subject.path as never,
      )
      const checklistPath =
        subject.path === 'docs/acceptance/gameplay-checklist.md'
      const resourcePath =
        subject.path === CANONICAL_ASSET_MANIFEST ||
        subject.path.startsWith('assets/content/')
      if (finding.owner === 'foundation' && !foundationPath)
        issues.push(`document review finding ${finding.findingId} has an invalid foundation subject`)
      if (finding.owner === 'checklist' && !checklistPath)
        issues.push(`document review finding ${finding.findingId} has an invalid checklist subject`)
      if (finding.owner === 'resource' && !resourcePath)
        issues.push(`document review finding ${finding.findingId} has an invalid resource subject`)

      if (subject.requirementId && !requirementIds.has(subject.requirementId))
        issues.push(`document review finding ${finding.findingId} has unknown requirement ID`)
      if (subject.resourceId && !resourceIds.has(subject.resourceId))
        issues.push(`document review finding ${finding.findingId} has unknown resource ID`)
      if (
        subject.contentId &&
        (contentIdsByPath.get(subject.path) !== subject.contentId ||
          !contentIds.has(subject.contentId))
      )
        issues.push(`document review finding ${finding.findingId} has unknown content ID`)
    }
  }
  return issues
}
