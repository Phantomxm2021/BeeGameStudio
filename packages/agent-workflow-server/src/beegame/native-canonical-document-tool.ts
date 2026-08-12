import { createHash, randomUUID } from 'node:crypto'
import { open, readFile, rename, mkdir, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { z } from 'zod/v4'
import {
  assertOpenDecisionClosure,
  canonicalizeCompleteGameDocumentMarkdown,
  completeGameDocumentAuditAppendixSchema,
  completeGameDocumentSectionSchema,
  completeGameDocumentSubmissionSchema,
  prepareCompleteGameDocumentArtifacts,
  productionMaterialSchema,
  renderCompleteGameDocument,
  validateCompleteGameDocumentEvidence,
  type CompleteGameDocumentArtifact,
} from './complete-game-document'
import {
  authoritySidecarPath,
  canonicalFoundationAuthoritySidecarBytes,
  createFoundationAuthoritySidecar,
  foundationAuthoritySubmissionSchema,
  validateFoundationAuthoritySidecar,
} from './foundation-authority-sidecar'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENT_IDS,
  type FoundationDocumentPath,
} from './delivery-workflow/types'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import { validateDocumentEvidenceEntries } from './document-evidence'

const commitInputSchema = z
  .object({
    body: z.string().trim().min(1),
  })
  .strict()

const completeDocumentCommitInputSchema = z.union([
  z
    .object({
      part: z.discriminatedUnion('kind', [
        z
          .object({
            kind: z.literal('header'),
            title: z.string().trim().min(1),
            executiveSummary: z.string().trim().min(1),
          })
          .strict(),
        z
          .object({
            kind: z.literal('section'),
            section: completeGameDocumentSectionSchema,
          })
          .strict(),
        z
          .object({
            kind: z.literal('material'),
            material: productionMaterialSchema,
          })
          .strict(),
        z
          .object({
            kind: z.literal('audit'),
            auditAppendix: completeGameDocumentAuditAppendixSchema,
          })
          .strict(),
      ]),
    })
    .strict(),
  z.object({ document: completeGameDocumentSubmissionSchema }).strict(),
  z.object({ body: z.string().trim().min(1) }).strict(),
  z
    .object({
      body: z.string().trim().min(1),
      authority: foundationAuthoritySubmissionSchema,
    })
    .strict(),
  z.object({ authority: foundationAuthoritySubmissionSchema }).strict(),
])

const completeDocumentDraftSchema = z
  .object({
    schemaVersion: z.literal(1),
    dispatchId: z.string().min(1),
    targetPath: z.string().min(1),
    title: z.string().min(1),
    executiveSummary: z.string().min(1),
    sections: z.array(completeGameDocumentSectionSchema),
    productionMaterials: z.array(productionMaterialSchema),
    auditAppendix: completeGameDocumentAuditAppendixSchema.optional(),
  })
  .strict()

type CompleteDocumentDraft = z.infer<typeof completeDocumentDraftSchema>

const legacyReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    dispatchId: z.string().min(1),
    targetPath: z.string().min(1),
    baselineDigest: z.string().length(64).nullable(),
    finalDigest: z.string().length(64),
    documentId: z.string().min(1),
    version: z.string().min(1),
    updatedAt: z.string().datetime({ offset: true }),
    status: z.enum(['prepared', 'committed']),
  })
  .strict()

const completeDocumentReceiptSchema = z
  .object({
    schemaVersion: z.literal(2),
    dispatchId: z.string().min(1),
    targetPath: z.string().min(1),
    baselineDigest: z.string().length(64).nullable(),
    finalDigest: z.string().length(64),
    authorityPath: z.string().min(1),
    authorityDigest: z.string().length(64).nullable(),
    artifacts: z
      .array(
        z
          .object({
            artifactId: z.string().min(1),
            path: z.string().min(1),
            mediaType: z.literal('image/svg+xml'),
            digest: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .default([]),
    documentId: z.string().min(1),
    version: z.string().min(1),
    updatedAt: z.string().datetime({ offset: true }),
    status: z.enum(['document_prepared', 'committed']),
  })
  .strict()

const receiptSchema = z.union([
  legacyReceiptSchema,
  completeDocumentReceiptSchema,
])

export type CanonicalDocumentCommitContract = {
  dispatchId: string
  targetPath: string
  documentId: string
  operation: 'create' | 'revise'
  baselineDigest: string | null
  baselineVersion?: string
  baselineUpdatedAt?: string
  submissionKind?: 'complete_game_document'
}

export type LegacyCanonicalDocumentCommitReceipt = {
  schemaVersion: 1
  dispatchId: string
  targetPath: string
  baselineDigest: string | null
  finalDigest: string
  documentId: string
  version: string
  updatedAt: string
  status: 'prepared' | 'committed'
}

export type CompleteGameDocumentCommitReceipt = {
  schemaVersion: 2
  dispatchId: string
  targetPath: string
  baselineDigest: string | null
  finalDigest: string
  authorityPath: string
  authorityDigest: string | null
  artifacts: readonly Omit<CompleteGameDocumentArtifact, 'content'>[]
  documentId: string
  version: string
  updatedAt: string
  status: 'document_prepared' | 'committed'
}

export type CanonicalDocumentCommitReceipt =
  | LegacyCanonicalDocumentCommitReceipt
  | CompleteGameDocumentCommitReceipt

type BuildTool = (definition: Record<string, unknown>) => unknown

const CANONICAL_DOCUMENT_PATHS = new Set<string>(
  Object.keys(CANONICAL_PROJECT_DOCUMENT_IDS),
)

export function createNativeCanonicalDocumentTool(options: {
  buildTool: BuildTool
  workspacePath: string
  contract: CanonicalDocumentCommitContract
}): unknown {
  const completeGameDocument =
    options.contract.submissionKind === 'complete_game_document'
  if (
    completeGameDocument &&
    !CANONICAL_FOUNDATION_DOCUMENTS.includes(
      options.contract.targetPath as FoundationDocumentPath,
    )
  )
    throw new Error(
      'complete game document submission requires a Foundation target',
    )
  return options.buildTool({
    name: 'CommitCanonicalDocument',
    alwaysLoad: true,
    inputSchema: completeGameDocument
      ? completeDocumentCommitInputSchema
      : commitInputSchema,
    isConcurrencySafe: () => false,
    isReadOnly: () => false,
    async description() {
      return completeGameDocument
        ? 'Validate and durably commit the complete game-development Markdown together with its compact authority records. The workflow service owns metadata, digest binding, persistence, and recovery.'
        : 'Atomically commit the complete Markdown body of the assigned canonical document. The workflow service owns front matter, version, timestamp, target path, and durable recovery.'
    },
    async prompt() {
      const documentContract = completeGameDocument
        ? getGameDocumentContract(
            options.contract.targetPath as FoundationDocumentPath,
          )
        : undefined
      const productionMaterialContract = documentContract
        ? documentContract.productionMaterials
            .map(
              material =>
                `<!-- beegame-material:${material.materialId} -->\n### ${material.title}\nrequired mechanical format: ${material.format}`,
            )
            .join('\n')
        : ''
      const responsibilityContract = documentContract
        ? documentContract.sections
            .map(
              section =>
                `sectionId=${section.sectionId}; allowed responsibilityIds=${[
                  ...section.responsibilityIds,
                ]
                  .sort((left, right) =>
                    Buffer.compare(Buffer.from(left), Buffer.from(right)),
                  )
                  .join(',')}`,
            )
            .join('\n')
        : ''
      return completeGameDocument
        ? `Submit bounded structured document parts through separate calls so no call contains the complete document. Call {part:{kind:"header",title,executiveSummary}} first. Then submit each section in the listed contract order as {part:{kind:"section",section:{sectionId,title,body}}}. Then submit each production material in contract order as {part:{kind:"material",material:{materialId,title,format,body}}}. Finally call {part:{kind:"audit",auditAppendix}}. The service persists each part and returns the exact nextPart; never skip or combine parts. It renders every protocol marker, heading, and canonical order and returns document_prepared only after the audit part completes the full document. Never handwrite protocol markers in section or material body content. After document_prepared, call with {authority:{records}} only. Each record must contain authorityId, sectionId, kind, state, source and evidenceRefs, statement, and responsibilityIds; omit value and unit when they do not apply. model_estimate must use assumed or deferred; verified requires evidenceRefs. Exact lowercase authority ID prefix: ${options.contract.documentId.toLowerCase()}. followed by the exact sectionId and a stable lowercase suffix. Records contain every downstream-relevant fact, decision, constraint, metric, dependency, risk, and open decision; open_decision records must use state=deferred and include decision owner and neededBy. The service canonicalizes record and responsibility ordering. Use only the responsibilityIds allowed for that section:\n${responsibilityContract}\nProduction material content must use the stated mechanical format for these exact contracts:\n${productionMaterialContract}`
        : 'Call exactly once with only the complete Markdown body, beginning with the document heading. Do not include YAML front matter, version, updated_at, path, finding IDs, or completion prose.'
    },
    async checkPermissions(input: unknown) {
      return { behavior: 'allow', updatedInput: input }
    },
    async call(input: unknown) {
      const parsed = completeGameDocument
        ? completeDocumentCommitInputSchema.parse(input)
        : commitInputSchema.parse(input)
      if (completeGameDocument && 'part' in parsed)
        return {
          data: await prepareCompleteDocumentPart({
            workspacePath: options.workspacePath,
            contract: options.contract,
            part: parsed.part,
          }),
        }
      const structuredDocument =
        completeGameDocument && 'document' in parsed
          ? await validateCompleteGameDocumentEvidence(
              options.workspacePath,
              options.contract.targetPath as FoundationDocumentPath,
              parsed.document,
            )
          : undefined
      const structuredBody = structuredDocument
        ? renderCompleteGameDocument(
            options.contract.targetPath as FoundationDocumentPath,
            structuredDocument,
          )
          : undefined
      const structuredArtifacts = structuredDocument
        ? prepareCompleteGameDocumentArtifacts(
            options.contract.targetPath as FoundationDocumentPath,
            structuredDocument,
          )
        : undefined
      if (structuredDocument)
        await persistCompleteDocumentDraftSnapshot({
          workspacePath: options.workspacePath,
          contract: options.contract,
          document: structuredDocument,
        })
      const result = await commitCanonicalDocument({
          workspacePath: options.workspacePath,
          contract: options.contract,
          ...(structuredBody !== undefined
            ? { body: structuredBody }
            : 'body' in parsed
              ? { body: parsed.body }
              : {}),
          ...('authority' in parsed ? { authority: parsed.authority } : {}),
          ...(structuredArtifacts !== undefined
            ? { artifacts: structuredArtifacts }
            : {}),
        })
      if (
        completeGameDocument &&
        'authority' in parsed &&
        result.schemaVersion === 2 &&
        result.status === 'committed'
      )
        await unlink(
          completeDocumentDraftPath(
            options.workspacePath,
            options.contract.dispatchId,
          ),
        ).catch(() => undefined)
      return { data: result }
    },
    renderToolUseMessage() {
      return '提交权威文档'
    },
    mapToolResultToToolResultBlockParam(output: unknown, toolUseID: string) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: JSON.stringify(output),
      }
    },
  })
}

async function prepareCompleteDocumentPart(input: {
  workspacePath: string
  contract: CanonicalDocumentCommitContract
  part:
    | { kind: 'header'; title: string; executiveSummary: string }
    | { kind: 'section'; section: z.infer<typeof completeGameDocumentSectionSchema> }
    | { kind: 'material'; material: z.infer<typeof productionMaterialSchema> }
    | { kind: 'audit'; auditAppendix: z.infer<typeof completeGameDocumentAuditAppendixSchema> }
}): Promise<
  | { status: 'part_prepared'; nextPart: string }
  | CompleteGameDocumentCommitReceipt
> {
  const targetPath = input.contract.targetPath as FoundationDocumentPath
  const contract = getGameDocumentContract(targetPath)
  const draftPath = completeDocumentDraftPath(
    input.workspacePath,
    input.contract.dispatchId,
  )
  const existingRaw = await readOptionalFile(draftPath)
  let draft: CompleteDocumentDraft | undefined = existingRaw
    ? completeDocumentDraftSchema.parse(JSON.parse(existingRaw))
    : undefined
  if (
    draft &&
    (draft.dispatchId !== input.contract.dispatchId ||
      draft.targetPath !== input.contract.targetPath)
  )
    throw new Error('prepared document draft identity is invalid')

  if (input.part.kind === 'header') {
    if (draft) {
      if (
        draft.title === input.part.title &&
        draft.executiveSummary === input.part.executiveSummary
      )
        return {
          status: 'part_prepared',
          nextPart: nextDraftPart(contract, draft),
        }
      throw new Error(`next document part is ${nextDraftPart(contract, draft)}`)
    }
    draft = {
      schemaVersion: 1,
      dispatchId: input.contract.dispatchId,
      targetPath: input.contract.targetPath,
      title: input.part.title,
      executiveSummary: input.part.executiveSummary,
      sections: [],
      productionMaterials: [],
    }
  } else {
    if (!draft) throw new Error('next document part is header')
    const expected = nextDraftPart(contract, draft)
    if (input.part.kind === 'section') {
      const submittedSection = input.part.section
      const prior = draft.sections.find(
        section => section.sectionId === submittedSection.sectionId,
      )
      if (prior) {
        if (JSON.stringify(prior) !== JSON.stringify(submittedSection))
          throw new Error('prepared document part has different content')
        return { status: 'part_prepared', nextPart: expected }
      }
      if (expected !== `section:${submittedSection.sectionId}`)
        throw new Error(`next document part is ${expected}`)
      const expectedContract = contract.sections[draft.sections.length]
      if (submittedSection.title !== expectedContract?.title)
        throw new Error(`complete game document section title is invalid: ${submittedSection.sectionId}`)
      draft.sections.push(submittedSection)
    } else if (input.part.kind === 'material') {
      const submittedMaterial = input.part.material
      if (submittedMaterial.format === 'evidence_register')
        await validateDocumentEvidenceEntries({
          workspacePath: input.workspacePath,
          entries: submittedMaterial.entries,
        })
      const prior = draft.productionMaterials.find(
        material => material.materialId === submittedMaterial.materialId,
      )
      if (prior) {
        if (JSON.stringify(prior) !== JSON.stringify(submittedMaterial))
          throw new Error('prepared document part has different content')
        return { status: 'part_prepared', nextPart: expected }
      }
      if (expected !== `material:${submittedMaterial.materialId}`)
        throw new Error(`next document part is ${expected}`)
      const expectedContract =
        contract.productionMaterials[draft.productionMaterials.length]
      if (
        submittedMaterial.title !== expectedContract?.title ||
        submittedMaterial.format !== expectedContract.format
      )
        throw new Error(`production material contract is invalid: ${submittedMaterial.materialId}`)
      draft.productionMaterials.push(submittedMaterial)
    } else {
      if (expected !== 'audit')
        throw new Error(`next document part is ${expected}`)
      const document = await validateCompleteGameDocumentEvidence(
        input.workspacePath,
        targetPath,
        {
        title: draft.title,
        executiveSummary: draft.executiveSummary,
        sections: draft.sections,
        productionMaterials: draft.productionMaterials,
        auditAppendix: input.part.auditAppendix,
        },
      )
      draft.auditAppendix = document.auditAppendix
      await durableWrite(draftPath, `${JSON.stringify(draft, null, 2)}\n`)
      const receipt = await commitCanonicalDocument({
        workspacePath: input.workspacePath,
        contract: input.contract,
        body: renderCompleteGameDocument(targetPath, document),
        artifacts: prepareCompleteGameDocumentArtifacts(targetPath, document),
      })
      return receipt as CompleteGameDocumentCommitReceipt
    }
  }
  await durableWrite(draftPath, `${JSON.stringify(draft, null, 2)}\n`)
  return { status: 'part_prepared', nextPart: nextDraftPart(contract, draft) }
}

async function persistCompleteDocumentDraftSnapshot(input: {
  workspacePath: string
  contract: CanonicalDocumentCommitContract
  document: z.infer<typeof completeGameDocumentSubmissionSchema>
}): Promise<void> {
  const draftPath = completeDocumentDraftPath(
    input.workspacePath,
    input.contract.dispatchId,
  )
  const snapshot: CompleteDocumentDraft = {
    schemaVersion: 1,
    dispatchId: input.contract.dispatchId,
    targetPath: input.contract.targetPath,
    title: input.document.title,
    executiveSummary: input.document.executiveSummary,
    sections: input.document.sections,
    productionMaterials: input.document.productionMaterials,
    auditAppendix: input.document.auditAppendix,
  }
  const existingRaw = await readOptionalFile(draftPath)
  if (existingRaw) {
    const existing = completeDocumentDraftSchema.parse(JSON.parse(existingRaw))
    if (JSON.stringify(existing) !== JSON.stringify(snapshot))
      throw new Error('prepared document draft has different content')
    return
  }
  await durableWrite(draftPath, `${JSON.stringify(snapshot, null, 2)}\n`)
}

function nextDraftPart(
  contract: ReturnType<typeof getGameDocumentContract>,
  draft: CompleteDocumentDraft,
): string {
  const section = contract.sections[draft.sections.length]
  if (section) return `section:${section.sectionId}`
  const material = contract.productionMaterials[draft.productionMaterials.length]
  return material ? `material:${material.materialId}` : 'audit'
}

function completeDocumentDraftPath(
  workspacePath: string,
  dispatchId: string,
): string {
  return resolve(
    workspacePath,
    '.beegame',
    'workflow',
    'canonical-document-drafts',
    `${dispatchId}.json`,
  )
}

export async function commitCanonicalDocument(input: {
  workspacePath: string
  contract: CanonicalDocumentCommitContract
  body?: string
  authority?: unknown
  artifacts?: readonly CompleteGameDocumentArtifact[]
}): Promise<CanonicalDocumentCommitReceipt> {
  const body = input.body?.trim()
  const completeGameDocument =
    input.contract.submissionKind === 'complete_game_document'
  if (!body && !completeGameDocument)
    throw new Error('canonical document body is required')
  if (body?.startsWith('---') && !completeGameDocument)
    throw new Error(
      'canonical document body must not include YAML front matter; metadata is service-owned',
    )
  if (!CANONICAL_DOCUMENT_PATHS.has(input.contract.targetPath))
    throw new Error('canonical document target is invalid')
  if (
    CANONICAL_PROJECT_DOCUMENT_IDS[
      input.contract.targetPath as keyof typeof CANONICAL_PROJECT_DOCUMENT_IDS
    ] !== input.contract.documentId
  )
    throw new Error('canonical document identity is invalid')
  const workspacePath = resolve(input.workspacePath)
  const targetPath = resolve(workspacePath, input.contract.targetPath)
  const projectRelative = relative(workspacePath, targetPath)
  if (
    !projectRelative ||
    projectRelative.startsWith('..') ||
    isAbsolute(projectRelative)
  )
    throw new Error('canonical document target is outside the workspace')
  const receiptPath = canonicalDocumentReceiptPath(
    input.workspacePath,
    input.contract.dispatchId,
  )
  const currentContent = await readOptionalFile(targetPath)
  const currentDigest = currentContent === undefined ? null : digest(currentContent)
  if (input.contract.operation === 'revise' && currentContent === undefined)
    throw new Error('canonical document revision requires an existing baseline')
  const existingReceipt = await readCanonicalDocumentCommitReceipt(
    input.workspacePath,
    input.contract.dispatchId,
  )
  if (completeGameDocument) {
    return commitCompleteGameDocument({
      workspacePath,
      targetPath,
      receiptPath,
      currentContent,
      currentDigest,
      existingReceipt,
      contract: input.contract,
      body,
      authority: input.authority,
      artifacts: input.artifacts,
    })
  }
  if (existingReceipt) {
    if (existingReceipt.schemaVersion !== 1)
      throw new Error('canonical document receipt kind does not match dispatch')
    assertReceiptMatchesContract(existingReceipt, input.contract)
    if (currentDigest === existingReceipt.finalDigest) {
      const committed = { ...existingReceipt, status: 'committed' as const }
      if (existingReceipt.status !== 'committed')
        await durableWrite(receiptPath, `${JSON.stringify(committed, null, 2)}\n`)
      return committed
    }
    if (currentDigest !== existingReceipt.baselineDigest)
      throw new Error(
        'canonical document changed outside the prepared commit; refusing to overwrite concurrent content',
      )
    const proposed = canonicalDocumentContent({
      documentId: existingReceipt.documentId,
      version: existingReceipt.version,
      updatedAt: existingReceipt.updatedAt,
      body: body!,
    })
    if (digest(proposed) !== existingReceipt.finalDigest)
      throw new Error(
        'canonical document commit was already prepared with different content',
      )
    await durableWrite(targetPath, proposed)
    const committed = { ...existingReceipt, status: 'committed' as const }
    await durableWrite(receiptPath, `${JSON.stringify(committed, null, 2)}\n`)
    return committed
  }

  if (currentDigest !== input.contract.baselineDigest)
    throw new Error(
      'canonical document baseline changed before commit; refusing to overwrite concurrent content',
    )
  const version = nextVersion(input.contract)
  const updatedAt = nextUpdatedAt(input.contract)
  const finalContent = canonicalDocumentContent({
    documentId: input.contract.documentId,
    version,
    updatedAt,
    body: body!,
  })
  const prepared: CanonicalDocumentCommitReceipt = {
    schemaVersion: 1,
    dispatchId: input.contract.dispatchId,
    targetPath: input.contract.targetPath,
    baselineDigest: input.contract.baselineDigest,
    finalDigest: digest(finalContent),
    documentId: input.contract.documentId,
    version,
    updatedAt,
    status: 'prepared',
  }
  await durableWrite(receiptPath, `${JSON.stringify(prepared, null, 2)}\n`)
  await durableWrite(targetPath, finalContent)
  const committed = { ...prepared, status: 'committed' as const }
  await durableWrite(receiptPath, `${JSON.stringify(committed, null, 2)}\n`)
  return committed
}

async function commitCompleteGameDocument(input: {
  workspacePath: string
  targetPath: string
  receiptPath: string
  currentContent: string | undefined
  currentDigest: string | null
  existingReceipt: CanonicalDocumentCommitReceipt | undefined
  contract: CanonicalDocumentCommitContract
  body: string | undefined
  authority: unknown
  artifacts: readonly CompleteGameDocumentArtifact[] | undefined
}): Promise<CompleteGameDocumentCommitReceipt> {
  const documentPath = input.contract.targetPath as FoundationDocumentPath
  let receipt: CompleteGameDocumentCommitReceipt
  let markdown: string

  const expectedArtifactIds = getGameDocumentContract(documentPath).productionMaterials
    .filter(material => material.format === 'inline_svg')
    .map(material => material.materialId)
  if (!input.existingReceipt) {
    const suppliedArtifactIds = (input.artifacts ?? []).map(
      artifact => artifact.artifactId,
    )
    if (
      suppliedArtifactIds.length !== expectedArtifactIds.length ||
      expectedArtifactIds.some(
        (artifactId, index) => suppliedArtifactIds[index] !== artifactId,
      )
    )
      throw new Error(
        'complete game document requires its exact external artifact set',
      )
  }

  if (input.existingReceipt) {
    if (input.existingReceipt.schemaVersion !== 2)
      throw new Error('canonical document receipt kind does not match dispatch')
    assertReceiptMatchesContract(input.existingReceipt, input.contract)
    receipt = input.existingReceipt
    if (input.artifacts) {
      const submittedDescriptors = input.artifacts.map(({ content: _, ...artifact }) => artifact)
      if (JSON.stringify(submittedDescriptors) !== JSON.stringify(receipt.artifacts))
        throw new Error(
          'canonical document commit was already prepared with different artifacts',
        )
      await prepareCompleteDocumentArtifactFiles(
        input.workspacePath,
        input.artifacts,
      )
    } else if (!(await completeDocumentArtifactsMatch(input.workspacePath, receipt.artifacts))) {
      throw new Error('prepared canonical document artifacts are missing or stale')
    }
    if (input.currentDigest === receipt.finalDigest && input.currentContent) {
      markdown = input.currentContent
      if (input.body) {
        const proposed = canonicalizeCompleteGameDocumentMarkdown(
          documentPath,
          input.body,
          { version: receipt.version, updatedAt: receipt.updatedAt },
        )
        if (digest(proposed) !== receipt.finalDigest)
          throw new Error(
            'canonical document commit was already prepared with different content',
          )
      }
    } else {
      if (input.currentDigest !== receipt.baselineDigest)
        throw new Error(
          'canonical document changed outside the prepared commit; refusing to overwrite concurrent content',
        )
      if (!input.body)
        throw new Error(
          'prepared canonical document bytes are missing; resend body before authority repair',
        )
      markdown = canonicalizeCompleteGameDocumentMarkdown(
        documentPath,
        input.body,
        { version: receipt.version, updatedAt: receipt.updatedAt },
      )
      if (digest(markdown) !== receipt.finalDigest)
        throw new Error(
          'canonical document commit was already prepared with different content',
        )
      await durableWrite(input.targetPath, markdown)
    }
  } else {
    if (!input.body)
      throw new Error('complete game document body is required before authority repair')
    if (input.currentDigest !== input.contract.baselineDigest)
      throw new Error(
        'canonical document baseline changed before commit; refusing to overwrite concurrent content',
      )
    const version = nextVersion(input.contract)
    const updatedAt = nextUpdatedAt(input.contract)
    markdown = canonicalizeCompleteGameDocumentMarkdown(
      documentPath,
      input.body,
      { version, updatedAt },
    )
    await prepareCompleteDocumentArtifactFiles(
      input.workspacePath,
      input.artifacts ?? [],
    )
    receipt = {
      schemaVersion: 2,
      dispatchId: input.contract.dispatchId,
      targetPath: input.contract.targetPath,
      baselineDigest: input.contract.baselineDigest,
      finalDigest: digest(markdown),
      authorityPath: authoritySidecarPath(documentPath),
      authorityDigest: null,
      artifacts: (input.artifacts ?? []).map(({ content: _, ...artifact }) => artifact),
      documentId: input.contract.documentId,
      version,
      updatedAt,
      status: 'document_prepared',
    }
    await durableWrite(
      input.receiptPath,
      `${JSON.stringify(receipt, null, 2)}\n`,
    )
    await durableWrite(input.targetPath, markdown)
  }

  const authorityTarget = resolve(input.workspacePath, receipt.authorityPath)
  if (receipt.status === 'committed') {
    if (!(await completeDocumentArtifactsMatch(input.workspacePath, receipt.artifacts)))
      throw new Error('committed canonical document artifact is missing or stale')
    const raw = await readOptionalFile(authorityTarget)
    if (
      raw === undefined ||
      receipt.authorityDigest === null ||
      digest(raw) !== receipt.authorityDigest
    )
      throw new Error('committed foundation authority sidecar is missing or stale')
    validateFoundationAuthoritySidecar({
      documentPath,
      markdown,
      value: JSON.parse(raw),
    })
    if (input.authority !== undefined) {
      const submitted = createFoundationAuthoritySidecar({
        documentPath,
        markdown,
        submission: input.authority,
      })
      if (
        digest(canonicalFoundationAuthoritySidecarBytes(submitted)) !==
        receipt.authorityDigest
      )
        throw new Error(
          'canonical document commit was already prepared with different authority',
        )
    }
    return receipt
  }

  if (input.authority === undefined)
    return receipt
  const sidecar = createFoundationAuthoritySidecar({
    documentPath,
    markdown,
    submission: input.authority,
  })
  const draftRaw = await readOptionalFile(
    completeDocumentDraftPath(input.workspacePath, input.contract.dispatchId),
  )
  const draft = draftRaw
    ? completeDocumentDraftSchema.parse(JSON.parse(draftRaw))
    : undefined
  if (draft?.auditAppendix) {
    const trustedScheduleAuthorityIds = new Set(
      sidecar.records
        .filter(
          record =>
            record.state === 'verified' ||
            ((record.source === 'user_setting' ||
              record.source === 'confirmed_brief') &&
              record.state === 'confirmed'),
        )
        .map(record => record.authorityId),
    )
    assertOpenDecisionClosure({
      audit: draft.auditAppendix,
      authority: sidecar,
      trustedScheduleAuthorityIds,
    })
  } else if (sidecar.records.some(record => record.kind === 'open_decision')) {
    throw new Error(
      'open decision closure cannot be validated without a prepared audit appendix',
    )
  }
  const sidecarBytes = canonicalFoundationAuthoritySidecarBytes(sidecar)
  await durableWrite(authorityTarget, sidecarBytes)
  const committed: CompleteGameDocumentCommitReceipt = {
    ...receipt,
    authorityDigest: digest(sidecarBytes),
    status: 'committed',
  }
  await durableWrite(
    input.receiptPath,
    `${JSON.stringify(committed, null, 2)}\n`,
  )
  return committed
}

export async function readCanonicalDocumentCommitReceipt(
  workspacePath: string,
  dispatchId: string,
): Promise<CanonicalDocumentCommitReceipt | undefined> {
  const path = canonicalDocumentReceiptPath(workspacePath, dispatchId)
  const raw = await readOptionalFile(path)
  if (raw === undefined) return undefined
  const parsed = receiptSchema.parse(
    JSON.parse(raw),
  ) as CanonicalDocumentCommitReceipt
  if (parsed.dispatchId !== dispatchId)
    throw new Error('canonical document commit receipt is invalid')
  if (!CANONICAL_DOCUMENT_PATHS.has(parsed.targetPath))
    throw new Error('canonical document commit receipt target is invalid')
  if (
    CANONICAL_PROJECT_DOCUMENT_IDS[
      parsed.targetPath as keyof typeof CANONICAL_PROJECT_DOCUMENT_IDS
    ] !== parsed.documentId
  )
    throw new Error('canonical document commit receipt identity is invalid')
  return parsed
}

export async function reconcileCanonicalDocumentCommitReceipt(input: {
  workspacePath: string
  dispatchId: string
}): Promise<CanonicalDocumentCommitReceipt | undefined> {
  const receipt = await readCanonicalDocumentCommitReceipt(
    input.workspacePath,
    input.dispatchId,
  )
  if (!receipt) return undefined
  const target = await readOptionalFile(
    resolve(input.workspacePath, receipt.targetPath),
  )
  if (target === undefined || digest(target) !== receipt.finalDigest)
    return undefined
  if (receipt.schemaVersion === 2) {
    if (!(await completeDocumentArtifactsMatch(input.workspacePath, receipt.artifacts)))
      return undefined
    const authorityRaw = await readOptionalFile(
      resolve(input.workspacePath, receipt.authorityPath),
    )
    if (authorityRaw === undefined) return undefined
    let authority: unknown
    try {
      authority = JSON.parse(authorityRaw)
    } catch {
      return undefined
    }
    validateFoundationAuthoritySidecar({
      documentPath: receipt.targetPath as FoundationDocumentPath,
      markdown: target,
      value: authority,
    })
    const authorityDigest = digest(authorityRaw)
    if (
      receipt.authorityDigest !== null &&
      receipt.authorityDigest !== authorityDigest
    )
      return undefined
    if (
      receipt.status === 'committed' &&
      receipt.authorityDigest === authorityDigest
    )
      return receipt
    const committed: CompleteGameDocumentCommitReceipt = {
      ...receipt,
      authorityDigest,
      status: 'committed',
    }
    await durableWrite(
      canonicalDocumentReceiptPath(input.workspacePath, input.dispatchId),
      `${JSON.stringify(committed, null, 2)}\n`,
    )
    return committed
  }
  if (receipt.status === 'committed') return receipt
  const committed = { ...receipt, status: 'committed' as const }
  await durableWrite(
    canonicalDocumentReceiptPath(input.workspacePath, input.dispatchId),
    `${JSON.stringify(committed, null, 2)}\n`,
  )
  return committed
}

async function prepareCompleteDocumentArtifactFiles(
  workspacePath: string,
  artifacts: readonly CompleteGameDocumentArtifact[],
): Promise<void> {
  const workspace = resolve(workspacePath)
  for (const artifact of artifacts) {
    const target = resolve(workspace, artifact.path)
    const projectRelative = relative(workspace, target)
    if (
      !projectRelative ||
      projectRelative.startsWith('..') ||
      isAbsolute(projectRelative) ||
      artifact.mediaType !== 'image/svg+xml' ||
      digest(artifact.content) !== artifact.digest
    )
      throw new Error(`canonical document artifact is invalid: ${artifact.artifactId}`)
    await durableWrite(target, artifact.content)
  }
}

async function completeDocumentArtifactsMatch(
  workspacePath: string,
  artifacts: readonly Omit<CompleteGameDocumentArtifact, 'content'>[],
): Promise<boolean> {
  for (const artifact of artifacts) {
    const content = await readOptionalFile(resolve(workspacePath, artifact.path))
    if (content === undefined || digest(content) !== artifact.digest) return false
  }
  return true
}

function canonicalDocumentReceiptPath(
  workspacePath: string,
  dispatchId: string,
): string {
  const allowed = new Set(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.split(''),
  )
  if (!dispatchId || [...dispatchId].some(character => !allowed.has(character)))
    throw new Error('canonical document dispatch identity is invalid')
  return join(
    resolve(workspacePath),
    '.beegame',
    'workflow',
    'document-commits',
    `${dispatchId}.json`,
  )
}

function canonicalDocumentContent(input: {
  documentId: string
  version: string
  updatedAt: string
  body: string
}): string {
  return `---\ndocument_id: ${input.documentId}\nversion: ${input.version}\nupdated_at: ${input.updatedAt}\n---\n\n${input.body.trim()}\n`
}

function nextVersion(contract: CanonicalDocumentCommitContract): string {
  if (contract.operation === 'create') return '1.0.0'
  const parts = contract.baselineVersion?.split('.').map(Number)
  const sourceParts = contract.baselineVersion?.split('.')
  if (
    !parts ||
    !sourceParts ||
    parts.length !== 3 ||
    parts.some(
      (part, index) =>
        !Number.isInteger(part) ||
        part < 0 ||
        String(part) !== sourceParts[index],
    )
  )
    throw new Error('canonical document revision requires valid baseline metadata')
  return `${parts[0]}.${parts[1]}.${parts[2]! + 1}`
}

function nextUpdatedAt(contract: CanonicalDocumentCommitContract): string {
  const previous = contract.baselineUpdatedAt
  const now = Date.now()
  const previousTime = previous ? Date.parse(previous) : Number.NaN
  if (
    contract.operation === 'revise' &&
    (previous === undefined || !Number.isFinite(previousTime))
  )
    throw new Error('canonical document revision requires valid baseline metadata')
  return new Date(
    Number.isFinite(previousTime) ? Math.max(now, previousTime + 1) : now,
  ).toISOString()
}

function assertReceiptMatchesContract(
  receipt: CanonicalDocumentCommitReceipt,
  contract: CanonicalDocumentCommitContract,
): void {
  if (
    receipt.dispatchId !== contract.dispatchId ||
    receipt.targetPath !== contract.targetPath ||
    receipt.documentId !== contract.documentId ||
    receipt.baselineDigest !== contract.baselineDigest
  )
    throw new Error('canonical document commit receipt does not match dispatch')
}

async function durableWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporary, 'w')
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}
