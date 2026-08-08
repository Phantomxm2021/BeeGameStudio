import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import { resolveWorkspaceRelativePath } from './revision'
import { auditAssetContract } from '../asset-contract-audit'
import { readBeeGameAssetManifest } from '../asset-contracts'
import {
  buildSystemDeliveryContract,
  SYSTEM_DELIVERY_CONTRACT_ARTIFACT_PATH,
} from './system-delivery-contract'
import {
  CANONICAL_ASSET_MANIFEST,
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENTS,
  CHECKLIST_DOCUMENT_REVIEW_CHECK_IDS,
  COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
  DOCUMENT_REVIEW_OWNER_BY_CHECK_ID,
  FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
  type DocumentReviewCheck,
  type DocumentReviewCheckId,
  type DocumentReviewFinding,
  type DocumentReviewScope,
} from './types'
import { documentReviewPacketSubmissionSchemaForContract } from './worker-contracts'

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

type ReviewArtifactDependency =
  | 'all'
  | {
      paths: readonly string[]
      includeContent?: boolean
    }

export const REVIEW_ARTIFACT_DEPENDENCIES_BY_CHECK: Record<
  DocumentReviewCheckId,
  ReviewArtifactDependency
> = {
  brief_alignment: { paths: CANONICAL_FOUNDATION_DOCUMENTS },
  cross_document_consistency: {
    paths: [
      SYSTEM_DELIVERY_CONTRACT_ARTIFACT_PATH,
      ...CANONICAL_FOUNDATION_DOCUMENTS,
    ],
  },
  gameplay_completeness: {
    paths: [
      'docs/GDD.md',
      'docs/LEVEL_SCENE_DESIGN.md',
      'docs/BALANCE_DESIGN.md',
      'docs/UI_UX_SPEC.md',
      'docs/AUDIO_DESIGN.md',
    ],
  },
  gameplay_strategy_viability: {
    paths: [
      'docs/GDD.md',
      'docs/LEVEL_SCENE_DESIGN.md',
      'docs/BALANCE_DESIGN.md',
    ],
  },
  economy_progression_integrity: {
    paths: ['docs/GDD.md', 'docs/BALANCE_DESIGN.md'],
  },
  numeric_balance_feasibility: {
    paths: [
      'docs/GDD.md',
      'docs/LEVEL_SCENE_DESIGN.md',
      'docs/BALANCE_DESIGN.md',
    ],
  },
  pacing_difficulty_coherence: {
    paths: [
      'docs/GDD.md',
      'docs/LEVEL_SCENE_DESIGN.md',
      'docs/BALANCE_DESIGN.md',
    ],
  },
  level_scene_design_integrity: {
    paths: [
      'docs/GDD.md',
      'docs/LEVEL_SCENE_DESIGN.md',
      'docs/ART_DIRECTION.md',
      'docs/UI_UX_SPEC.md',
    ],
  },
  technical_feasibility: {
    paths: [
      SYSTEM_DELIVERY_CONTRACT_ARTIFACT_PATH,
      ...CANONICAL_FOUNDATION_DOCUMENTS,
    ],
  },
  art_direction_coherence: {
    paths: [
      'docs/GDD.md',
      'docs/LEVEL_SCENE_DESIGN.md',
      'docs/ART_DIRECTION.md',
      'docs/UI_UX_SPEC.md',
      'docs/ASSET_PLAN.md',
    ],
  },
  ui_audio_consistency: {
    paths: [
      'docs/GDD.md',
      'docs/LEVEL_SCENE_DESIGN.md',
      'docs/UI_UX_SPEC.md',
      'docs/AUDIO_DESIGN.md',
    ],
  },
  acceptance_observability: { paths: CANONICAL_FOUNDATION_DOCUMENTS },
  checklist_traceability: { paths: CANONICAL_PROJECT_DOCUMENTS },
  resource_semantic_fitness: {
    paths: [...CANONICAL_FOUNDATION_DOCUMENTS, CANONICAL_ASSET_MANIFEST],
  },
  content_structure_fitness: {
    paths: [
      SYSTEM_DELIVERY_CONTRACT_ARTIFACT_PATH,
      'docs/TECHNICAL_DESIGN.md',
      'docs/ASSET_PLAN.md',
      CANONICAL_ASSET_MANIFEST,
    ],
    includeContent: true,
  },
  resource_content_consistency: {
    paths: [
      SYSTEM_DELIVERY_CONTRACT_ARTIFACT_PATH,
      'docs/TECHNICAL_DESIGN.md',
      'docs/ASSET_PLAN.md',
      CANONICAL_ASSET_MANIFEST,
    ],
    includeContent: true,
  },
}

export function documentReviewCheckDependsOnPath(
  checkId: DocumentReviewCheckId,
  path: string,
): boolean {
  const dependency = REVIEW_ARTIFACT_DEPENDENCIES_BY_CHECK[checkId]
  return (
    dependency === 'all' ||
    path === REVIEW_AUTHORITY_ARTIFACT_PATH ||
    dependency.paths.includes(path) ||
    (dependency.includeContent === true && path.startsWith('assets/content/'))
  )
}

export function artifactsForDocumentReviewCheck(
  artifacts: DocumentReviewArtifact[],
  checkId: DocumentReviewCheckId,
): DocumentReviewArtifact[] {
  return artifacts.filter(artifact =>
    documentReviewCheckDependsOnPath(checkId, artifact.path),
  )
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

export function buildDocumentReviewWireReferenceIndex(
  artifacts: DocumentReviewArtifact[],
  options?: { maxJsonPointerDepth?: number },
) {
  const index = buildDocumentReviewReferenceIndex(artifacts, options)
  const paths = [...new Set(index.references.map(reference => reference.path))]
  const artifactIdByPath = new Map(
    paths.map((path, position) => [path, `a${position}`] as const),
  )
  return {
    artifacts: paths.map(path => ({
      artifactId: artifactIdByPath.get(path)!,
      path,
    })),
    references: index.references.map(({ path, ...reference }) => ({
      ...reference,
      artifactId: artifactIdByPath.get(path)!,
    })),
    requirementIds: index.requirementIds,
    resourceIds: index.resourceIds,
    contentIdsByPath: index.contentIdsByPath,
  }
}

export type DocumentReviewSubmissionContract = {
  scope: DocumentReviewScope
  mode: 'initial' | 'closure'
  requiredCheckIds: DocumentReviewCheckId[]
  currentCheckIds: DocumentReviewCheckId[]
  artifacts: DocumentReviewArtifact[]
  activeTarget?: 'foundation' | 'checklist' | 'resource'
  priorFindings?: Array<{
    findingId: string
    checkId: DocumentReviewCheckId
    owner: 'foundation' | 'checklist' | 'resource'
    open: boolean
    evidence?: DocumentReviewFinding['evidence']
    subjects?: DocumentReviewFinding['subjects']
    observation?: string
    blockingImpact?: string
    requiredOutcome: string
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
    : scope === 'checklist'
      ? [...CHECKLIST_DOCUMENT_REVIEW_CHECK_IDS]
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

function manifestProjection(
  parsed: Awaited<ReturnType<typeof readBeeGameAssetManifest>>,
): string {
  const manifestDigest = sha256(JSON.stringify(parsed))
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
      : scope === 'checklist'
        ? CANONICAL_PROJECT_DOCUMENTS
        : [...CANONICAL_PROJECT_DOCUMENTS, CANONICAL_ASSET_MANIFEST]
  const artifacts = await Promise.all(
    paths.map(async path => {
      const absolutePath = resolveWorkspaceRelativePath(workspacePath, path)
      if (!absolutePath)
        throw new Error(
          `canonical review artifact is outside the workspace: ${path}`,
        )
      const content =
        path === CANONICAL_ASSET_MANIFEST
          ? ''
          : await readFile(absolutePath, 'utf8')
      return {
        path,
        content:
          path === CANONICAL_ASSET_MANIFEST
            ? manifestProjection(await readBeeGameAssetManifest(workspacePath))
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

function jsonPointers(content: string, maxDepth?: number): string[] {
  let root: unknown
  try {
    root = JSON.parse(content)
  } catch {
    return []
  }
  const pointers = ['$']
  const visit = (value: unknown, pointer: string, depth: number): void => {
    if (!value || typeof value !== 'object') return
    if (maxDepth !== undefined && depth >= maxDepth) return
    for (const [key, child] of Object.entries(value)) {
      const token = key.split('~').join('~0').split('/').join('~1')
      const childPointer = `${pointer}/${token}`
      pointers.push(childPointer)
      visit(child, childPointer, depth + 1)
    }
  }
  visit(root, '', 0)
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

/** Project one exact accepted reference without reloading its whole artifact. */
export function projectDocumentReviewReference(
  content: string,
  path: string,
  anchor: string,
): string {
  if (path.endsWith('.md')) {
    const lines = content.split('\n')
    const start = lines.findIndex(line => {
      const candidate = line.trimStart()
      let markerLength = 0
      while (candidate[markerLength] === '#') markerLength += 1
      if (markerLength === 0 || candidate[markerLength] !== ' ') return false
      const heading = candidate.slice(markerLength + 1).trim()
      return anchor === heading || anchor === candidate.trim()
    })
    if (start < 0)
      throw new Error(`missing exact repair authority: ${path} ${anchor}`)
    const heading = lines[start]!.trimStart()
    let level = 0
    while (heading[level] === '#') level += 1
    let end = lines.length
    for (let index = start + 1; index < lines.length; index += 1) {
      const candidate = lines[index]!.trimStart()
      let candidateLevel = 0
      while (candidate[candidateLevel] === '#') candidateLevel += 1
      if (
        candidateLevel > 0 &&
        candidate[candidateLevel] === ' ' &&
        candidateLevel <= level
      ) {
        end = index
        break
      }
    }
    return lines.slice(start, end).join('\n').trim()
  }
  if (
    path.endsWith('.json') ||
    path === SYSTEM_DELIVERY_CONTRACT_ARTIFACT_PATH
  ) {
    let value: unknown = JSON.parse(content)
    if (anchor !== '$') {
      if (!anchor.startsWith('/'))
        throw new Error(`invalid repair authority pointer: ${anchor}`)
      for (const rawToken of anchor.slice(1).split('/')) {
        const token = decodeJsonPointerToken(rawToken)
        if (Array.isArray(value)) {
          const index = Number(token)
          if (!Number.isInteger(index) || index < 0 || index >= value.length)
            throw new Error(`missing exact repair authority: ${path} ${anchor}`)
          value = value[index]
        } else {
          if (
            !value ||
            typeof value !== 'object' ||
            !Object.hasOwn(value, token)
          )
            throw new Error(`missing exact repair authority: ${path} ${anchor}`)
          value = (value as Record<string, unknown>)[token]
        }
      }
    }
    return JSON.stringify(value)
  }
  return content.trim()
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
  for (const check of input.checks) {
    const checkArtifacts = new Map(
      artifactsForDocumentReviewCheck(input.artifacts, check.id).map(
        artifact => [artifact.path, artifact.content],
      ),
    )
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
      const content = checkArtifacts.get(evidence.path)
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
        const content = checkArtifacts.get(evidence.path)
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
  return Object.fromEntries(
    input.checks.map(check => [
      check.id,
      documentReviewArtifactDigests(
        artifactsForDocumentReviewCheck(input.artifacts, check.id),
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
  options?: { maxJsonPointerDepth?: number },
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
            : jsonPointers(artifact.content, options?.maxJsonPointerDepth)
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

export type DocumentReviewAtomicCheckSubmission = {
  conclusion?: string
  evidence?: ReviewReferenceInput[]
  assessments: Array<
    Omit<DocumentReviewCheck['assessments'][number], 'evidence'> & {
      evidence: ReviewReferenceInput[]
    }
  >
  findings: Array<
    Omit<
      DocumentReviewFinding,
      'severity' | 'owner' | 'checkId' | 'evidence' | 'subjects'
    > & {
      evidence: ReviewReferenceInput[]
      subjects: ReviewSubjectReferenceInput[]
    }
  >
}

export type DocumentReviewPacketSubmission = {
  checks: DocumentReviewAtomicCheckSubmission[]
}

/** Resolve one transactional packet into canonical persisted checks. */
export function normalizeDocumentReviewPacketSubmission(input: {
  contract: DocumentReviewSubmissionContract
  submission: DocumentReviewPacketSubmission
}): { checks: DocumentReviewCheck[]; findings: DocumentReviewFinding[] } {
  const index = buildDocumentReviewReferenceIndex(input.contract.artifacts)
  const references = new Map(
    index.references.map(reference => [reference.referenceId, reference]),
  )
  const resolveReference = (value: ReviewReferenceInput) => {
    const reference = references.get(value.referenceId)
    if (!reference)
      throw new Error(
        `unknown document review referenceId: ${value.referenceId}`,
      )
    return { path: reference.path, anchor: reference.anchor }
  }
  const normalized = input.submission.checks.map((submission, index) => {
    const checkId = input.contract.currentCheckIds[index]!
    const findingIds = submission.findings.map(finding => finding.findingId)
    const designCheck = submission.assessments.length > 0
    const derivedEvidence = designCheck
      ? [
          ...new Map(
            submission.assessments
              .flatMap(assessment => assessment.evidence)
              .map(reference => [reference.referenceId, reference]),
          ).values(),
        ]
      : (submission.evidence ?? [])
    const derivedConclusion = designCheck
      ? submission.assessments
          .map(
            assessment => `${assessment.criterion}: ${assessment.conclusion}`,
          )
          .join(' ')
      : submission.conclusion!
    const check: DocumentReviewCheck = {
      conclusion: derivedConclusion,
      id: checkId,
      status: findingIds.length > 0 ? 'block' : 'pass',
      findingIds,
      evidence: derivedEvidence.map(resolveReference),
      assessments: submission.assessments.map(assessment => ({
        ...assessment,
        evidence: assessment.evidence.map(resolveReference),
      })),
    }
    const findings = submission.findings.map(finding => ({
      ...finding,
      checkId,
      severity: 'blocking' as const,
      owner: DOCUMENT_REVIEW_OWNER_BY_CHECK_ID[checkId],
      evidence: finding.evidence.map(resolveReference),
      subjects: finding.subjects.map(subject => {
        const reference = references.get(subject.referenceId)
        if (!reference)
          throw new Error(
            `unknown document review subject referenceId: ${subject.referenceId}`,
          )
        const expectedOwner = DOCUMENT_REVIEW_OWNER_BY_CHECK_ID[checkId]
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
  })
  return {
    checks: normalized.map(item => item.check),
    findings: normalized.flatMap(item => item.findings),
  }
}

/**
 * Sole contract-bound parser and acceptance boundary for one Reviewer packet.
 * Native tool acceptance and durable terminal reconstruction must both call
 * this function with the same durable contract.
 */
export function parseAndValidateDocumentReviewPacketSubmission(input: {
  contract: DocumentReviewSubmissionContract
  submission: unknown
}): { checks: DocumentReviewCheck[]; findings: DocumentReviewFinding[] } {
  const submission = documentReviewPacketSubmissionSchemaForContract(
    input.contract,
  ).parse(input.submission) as unknown as DocumentReviewPacketSubmission
  const normalized = normalizeDocumentReviewPacketSubmission({
    contract: input.contract,
    submission,
  })
  const issues = validateDocumentReviewSubmission({
    contract: input.contract,
    checks: normalized.checks,
    findings: normalized.findings,
  })
  if (issues.length)
    throw new Error(`document review submission rejected: ${issues.join('; ')}`)
  return normalized
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
    const findingArtifacts = artifactsForDocumentReviewCheck(
      input.artifacts,
      finding.checkId,
    )
    for (const evidence of finding.evidence) {
      const artifact = findingArtifacts.find(
        item => item.path === evidence.path,
      )
      if (!artifact) {
        issues.push(
          `document review finding ${finding.findingId} has unavailable evidence`,
        )
        continue
      }
      const anchorExists =
        evidence.path === REVIEW_AUTHORITY_ARTIFACT_PATH
          ? evidence.anchor === '$'
          : evidence.path.endsWith('.md')
            ? exactMarkdownHeadingExists(artifact.content, evidence.anchor)
            : evidence.path.endsWith('.json') ||
                evidence.path === SYSTEM_DELIVERY_CONTRACT_ARTIFACT_PATH
              ? exactJsonPointerExists(artifact.content, evidence.anchor)
              : contentIdsByPath.get(evidence.path) === evidence.anchor
      if (!anchorExists)
        issues.push(
          `document review finding ${finding.findingId} has missing exact evidence`,
        )
    }
    for (const subject of finding.subjects) {
      const artifact = findingArtifacts.find(item => item.path === subject.path)
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
    input.checks.length !== input.contract.currentCheckIds.length ||
    input.checks.some(
      (check, index) => check.id !== input.contract.currentCheckIds[index],
    )
  )
    return ['document review must submit exactly the active check packet']
  const checkIssues = validateReviewChecks({
    scope: input.contract.scope,
    checks: input.checks,
    artifacts: input.contract.artifacts,
  }).filter(
    issue => issue !== 'document review does not cover the required check set',
  )
  const submittedCheckIds = input.checks.map(check => check.id)
  const exactCycleCoverage =
    submittedCheckIds.length === input.contract.currentCheckIds.length &&
    submittedCheckIds.every(
      (checkId, index) =>
        checkId === input.contract.currentCheckIds[index] &&
        input.contract.requiredCheckIds.includes(checkId),
    )
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
      ? ['document review does not match the active cycle check packet']
      : []),
    ...validateReviewFindingSubjects({
      findings,
      artifacts: input.contract.artifacts,
    }),
  ]
  const submittedFindingIds = input.findings.map(finding => finding.findingId)
  if (new Set(submittedFindingIds).size !== submittedFindingIds.length)
    issues.push('document review packet finding IDs must be unique')
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
    const acceptedIds = new Set(
      (input.contract.priorFindings ?? []).map(finding => finding.findingId),
    )
    if (input.findings.some(finding => acceptedIds.has(finding.findingId)))
      issues.push(
        'initial review finding ID already exists in the cycle ledger',
      )
  } else {
    const priorById = new Map(
      (input.contract.priorFindings ?? []).map(finding => [
        finding.findingId,
        finding,
      ]),
    )
    const changedPaths = new Set(input.contract.changedPaths ?? [])
    for (const finding of findings) {
      if (finding.owner !== input.contract.activeTarget)
        issues.push(
          'closure review finding is outside the active remediation owner',
        )
      const prior = priorById.get(finding.findingId)
      if (prior) {
        if (!prior.open) {
          issues.push(
            `closure review finding ${finding.findingId} is already closed`,
          )
          continue
        }
        if (
          prior.checkId !== finding.checkId ||
          prior.owner !== finding.owner ||
          prior.requiredOutcome !== finding.requiredOutcome
        )
          issues.push(
            `closure review finding ${finding.findingId} does not preserve its accepted identity`,
          )
        if (finding.regressionPaths !== undefined)
          issues.push(
            `closure review prior finding ${finding.findingId} cannot declare regression paths`,
          )
        continue
      }
      if (finding.regressionPaths?.some(path => !changedPaths.has(path)))
        issues.push(
          'closure review regression must reference only changed paths',
        )
    }
  }
  return [...new Set(issues)]
}
