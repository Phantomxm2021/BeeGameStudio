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
  DOCUMENT_REVIEW_OWNER_BY_CHECK_ID,
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

export type DocumentReviewReferenceIndex = {
  references: Array<{
    referenceId: string
    path: string
    anchor: string
    subjectOwner?: 'foundation' | 'checklist' | 'resource'
  }>
  requirementIds: string[]
  resourceIds: string[]
  contentIdsByPath: Record<string, string>
}

export type DocumentReviewSubmissionContract = {
  scope: DocumentReviewScope
  mode: 'initial' | 'closure'
  requiredCheckIds: DocumentReviewCheckId[]
  currentCheckId: DocumentReviewCheckId
  artifacts: DocumentReviewArtifact[]
  activeTarget?: 'foundation' | 'checklist' | 'resource'
  priorFindings?: Array<{
    findingId: string
    owner: 'foundation' | 'checklist' | 'resource'
    subjects?: DocumentReviewFinding['subjects']
    observation?: string
    blockingReason?: string
    requiredAction?: string
    closureCondition?: string
  }>
  changedPaths?: string[]
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export function assertReviewAuthority(authority: ReviewAuthority): void {
  if (!authority.confirmedBriefContext.trim())
    throw new Error('document review authority is empty')
  if (
    sha256(authority.confirmedBriefContext) !== authority.confirmedBriefDigest
  )
    throw new Error(
      'document review authority digest does not match durable context',
    )
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
  return Object.fromEntries(
    Object.entries({
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
    }).filter(([, field]) => field !== undefined),
  )
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

function exactMarkdownHeadings(content: string): string[] {
  return content.split('\n').flatMap(line => {
    const candidate = line.trimStart()
    let markerLength = 0
    while (candidate[markerLength] === '#') markerLength += 1
    if (markerLength === 0 || candidate[markerLength] !== ' ') return []
    return [candidate.trim()]
  })
}

function jsonPointers(content: string): string[] {
  let root: unknown
  try {
    root = JSON.parse(content)
  } catch {
    return []
  }
  const pointers = ['$']
  const visit = (value: unknown, pointer: string): void => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      const token = key.split('~').join('~0').split('/').join('~1')
      const childPointer = `${pointer}/${token}`
      pointers.push(childPointer)
      visit(child, childPointer)
    }
  }
  visit(root, '')
  return pointers
}

function subjectOwnerForPath(
  path: string,
): 'foundation' | 'checklist' | 'resource' | undefined {
  if (CANONICAL_FOUNDATION_DOCUMENTS.includes(path as never))
    return 'foundation'
  if (path === 'docs/acceptance/gameplay-checklist.md') return 'checklist'
  if (path === CANONICAL_ASSET_MANIFEST || path.startsWith('assets/content/'))
    return 'resource'
  return undefined
}

function referenceId(path: string, anchor: string): string {
  return `ref-${sha256(`${path}\n${anchor}`).slice(0, 16)}`
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

function structuredContentId(
  content: string,
  yaml: boolean,
): string | undefined {
  try {
    const value = yaml
      ? (parseYaml(content) as unknown)
      : (JSON.parse(content) as unknown)
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return undefined
    const id = (value as Record<string, unknown>).id
    return typeof id === 'string' && id.trim() ? id : undefined
  } catch {
    return undefined
  }
}

function validateReviewChecks(input: {
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
        evidence => evidence.path === SYSTEM_DELIVERY_CONTRACT_ARTIFACT_PATH,
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
    for (const assessment of check.assessments ?? []) {
      for (const evidence of assessment.evidence) {
        const content = artifacts.get(evidence.path)
        if (content === undefined) {
          issues.push(
            `document review criterion ${assessment.criterion} references an unavailable artifact`,
          )
          continue
        }
        const anchorExists =
          evidence.path === REVIEW_AUTHORITY_ARTIFACT_PATH
            ? evidence.anchor === '$'
            : evidence.path.endsWith('.md')
              ? exactMarkdownHeadingExists(content, evidence.anchor)
              : evidence.path.endsWith('.yaml') ||
                  evidence.path.endsWith('.yml')
                ? structuredContentId(content, true) === evidence.anchor
                : exactJsonPointerExists(content, evidence.anchor)
        if (!anchorExists)
          issues.push(
            `document review criterion ${assessment.criterion} references a missing exact anchor`,
          )
      }
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
        [
          ...check.evidence,
          ...(check.assessments ?? []).flatMap(
            assessment => assessment.evidence,
          ),
        ].map(evidence => [evidence.path, digests[evidence.path]!]),
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

export function buildDocumentReviewReferenceIndex(
  artifacts: DocumentReviewArtifact[],
): DocumentReviewReferenceIndex {
  const manifest = artifacts.find(
    artifact => artifact.path === CANONICAL_ASSET_MANIFEST,
  )
  let projection: Record<string, unknown> = {}
  if (manifest) {
    const parsed = JSON.parse(manifest.content) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      projection = parsed as Record<string, unknown>
  }
  const contentIdsByPath = Object.fromEntries(
    artifacts
      .filter(artifact => artifact.path.startsWith('assets/content/'))
      .flatMap(artifact => {
        const id = structuredContentId(
          artifact.content,
          artifact.path.endsWith('.yaml') || artifact.path.endsWith('.yml'),
        )
        return id ? [[artifact.path, id] as const] : []
      }),
  )
  const references = artifacts.flatMap(artifact => {
    const anchors =
      artifact.path === REVIEW_AUTHORITY_ARTIFACT_PATH
        ? ['$']
        : artifact.path.endsWith('.md')
          ? exactMarkdownHeadings(artifact.content)
          : artifact.path.endsWith('.yaml') || artifact.path.endsWith('.yml')
            ? [structuredContentId(artifact.content, true)].filter(
                (value): value is string => Boolean(value),
              )
            : jsonPointers(artifact.content)
    const subjectOwner = subjectOwnerForPath(artifact.path)
    return anchors.map(anchor => ({
      referenceId: referenceId(artifact.path, anchor),
      path: artifact.path,
      anchor,
      ...(subjectOwner ? { subjectOwner } : {}),
    }))
  })
  return {
    references,
    requirementIds: [...idSet(projection.requirements)],
    resourceIds: [...idSet(projection.resources)],
    contentIdsByPath,
  }
}

type ReviewReferenceInput = { referenceId: string }
type ReviewSubjectReferenceInput = ReviewReferenceInput & {
  requirementId?: string
  resourceId?: string
  contentId?: string
}

export type DocumentReviewCheckSubmission = {
  check: Omit<DocumentReviewCheck, 'evidence' | 'assessments'> & {
    evidence: ReviewReferenceInput[]
    assessments: Array<
      Omit<DocumentReviewCheck['assessments'][number], 'evidence'> & {
        evidence: ReviewReferenceInput[]
      }
    >
  }
  findings: Array<
    Omit<DocumentReviewFinding, 'severity' | 'owner' | 'subjects'> & {
      subjects: ReviewSubjectReferenceInput[]
    }
  >
}

/** Resolve model-selected stable references into canonical persisted evidence. */
export function normalizeDocumentReviewCheckSubmission(input: {
  contract: DocumentReviewSubmissionContract
  submission: DocumentReviewCheckSubmission
}): { check: DocumentReviewCheck; findings: DocumentReviewFinding[] } {
  const index = buildDocumentReviewReferenceIndex(input.contract.artifacts)
  const references = new Map(
    index.references.map(reference => [reference.referenceId, reference]),
  )
  const resolveReference = (value: ReviewReferenceInput) => {
    const reference = references.get(value.referenceId)
    if (!reference)
      throw new Error(`unknown document review referenceId: ${value.referenceId}`)
    return { path: reference.path, anchor: reference.anchor }
  }
  if (input.submission.check.id !== input.contract.currentCheckId)
    throw new Error('document review submission is not for the active check')
  const check: DocumentReviewCheck = {
    ...input.submission.check,
    evidence: input.submission.check.evidence.map(resolveReference),
    assessments: input.submission.check.assessments.map(assessment => ({
      ...assessment,
      evidence: assessment.evidence.map(resolveReference),
    })),
  }
  const findings = input.submission.findings.map(finding => ({
    ...finding,
    severity: 'blocking' as const,
    owner: DOCUMENT_REVIEW_OWNER_BY_CHECK_ID[finding.checkId],
    subjects: finding.subjects.map(subject => {
      const reference = references.get(subject.referenceId)
      if (!reference)
        throw new Error(
          `unknown document review subject referenceId: ${subject.referenceId}`,
        )
      const expectedOwner = DOCUMENT_REVIEW_OWNER_BY_CHECK_ID[finding.checkId]
      if (reference.subjectOwner !== expectedOwner)
        throw new Error(
          `document review subject ${subject.referenceId} is not owned by ${expectedOwner}`,
        )
      return {
        path: reference.path,
        anchor: reference.anchor,
        ...(subject.requirementId
          ? { requirementId: subject.requirementId }
          : {}),
        ...(subject.resourceId ? { resourceId: subject.resourceId } : {}),
        ...(subject.contentId ? { contentId: subject.contentId } : {}),
      }
    }),
  }))
  return { check, findings }
}

function validateReviewFindingSubjects(input: {
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
        issues.push(
          `document review finding ${finding.findingId} has an unavailable subject`,
        )
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
        issues.push(
          `document review finding ${finding.findingId} has a missing exact anchor`,
        )

      const foundationPath = CANONICAL_FOUNDATION_DOCUMENTS.includes(
        subject.path as never,
      )
      const checklistPath =
        subject.path === 'docs/acceptance/gameplay-checklist.md'
      const resourcePath =
        subject.path === CANONICAL_ASSET_MANIFEST ||
        subject.path.startsWith('assets/content/')
      if (finding.owner === 'foundation' && !foundationPath)
        issues.push(
          `document review finding ${finding.findingId} has an invalid foundation subject`,
        )
      if (finding.owner === 'checklist' && !checklistPath)
        issues.push(
          `document review finding ${finding.findingId} has an invalid checklist subject`,
        )
      if (finding.owner === 'resource' && !resourcePath)
        issues.push(
          `document review finding ${finding.findingId} has an invalid resource subject`,
        )

      if (subject.requirementId && !requirementIds.has(subject.requirementId))
        issues.push(
          `document review finding ${finding.findingId} has unknown requirement ID`,
        )
      if (subject.resourceId && !resourceIds.has(subject.resourceId))
        issues.push(
          `document review finding ${finding.findingId} has unknown resource ID`,
        )
      if (
        subject.contentId &&
        (contentIdsByPath.get(subject.path) !== subject.contentId ||
          !contentIds.has(subject.contentId))
      )
        issues.push(
          `document review finding ${finding.findingId} has unknown content ID`,
        )
    }
  }
  return issues
}

/**
 * Sole revision-bound semantic acceptance contract for Reviewer submissions.
 * Both the native terminal tool and the durable commit boundary call this
 * function; neither boundary owns an alternate validation policy.
 */
export function validateDocumentReviewSubmission(input: {
  contract: DocumentReviewSubmissionContract
  checks: DocumentReviewCheck[]
  findings: Array<
    Omit<DocumentReviewFinding, 'id' | 'owner' | 'severity'> & {
      owner?: 'foundation' | 'checklist' | 'resource'
    }
  >
}): string[] {
  if (
    input.checks.length !== 1 ||
    input.checks[0]?.id !== input.contract.currentCheckId
  )
    return ['document review must submit exactly the active check']
  const checkIssues = validateReviewChecks({
    scope: input.contract.scope,
    checks: input.checks,
    artifacts: input.contract.artifacts,
  }).filter(
    issue => issue !== 'document review does not cover the required check set',
  )
  const submittedCheckIds = input.checks.map(check => check.id)
  const exactCycleCoverage =
    submittedCheckIds.length === 1 &&
    submittedCheckIds[0] === input.contract.currentCheckId &&
    input.contract.requiredCheckIds.includes(input.contract.currentCheckId)
  const findings = input.findings.map((finding, index) => {
    const owner = DOCUMENT_REVIEW_OWNER_BY_CHECK_ID[finding.checkId]
    return {
      ...finding,
      id: `submitted-${index}`,
      severity: 'blocking' as const,
      owner,
    }
  })
  const issues = [
    ...checkIssues,
    ...(!exactCycleCoverage
      ? ['document review does not match the active cycle check']
      : []),
    ...validateReviewFindingSubjects({
      findings,
      artifacts: input.contract.artifacts,
    }),
  ]
  for (const [index, finding] of input.findings.entries()) {
    const expectedOwner = DOCUMENT_REVIEW_OWNER_BY_CHECK_ID[finding.checkId]
    if (finding.owner !== undefined && finding.owner !== expectedOwner)
      issues.push(
        `document review finding ${input.findings[index]!.findingId} has an invalid derived owner`,
      )
  }
  if (input.contract.mode === 'initial') {
    if (input.findings.some(finding => finding.regressionPaths?.length))
      issues.push('initial review cannot reference repair regressions')
  } else {
    const priorIds = new Set(
      (input.contract.priorFindings ?? []).map(finding => finding.findingId),
    )
    const changedPaths = new Set(input.contract.changedPaths ?? [])
    for (const finding of findings) {
      if (finding.owner !== input.contract.activeTarget)
        issues.push(
          'closure review finding is outside the active remediation owner',
        )
      const priorFindingValid = priorIds.has(finding.findingId)
      const regressionValid =
        Boolean(finding.regressionPaths?.length) &&
        finding.regressionPaths!.every(path => changedPaths.has(path))
      if (!priorFindingValid && !regressionValid)
        issues.push(
          'closure review finding must reference an active prior finding or a changed-path regression',
        )
    }
  }
  return [...new Set(issues)]
}
