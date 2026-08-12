import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  commitCanonicalDocument,
  createNativeCanonicalDocumentTool,
  readCanonicalDocumentCommitReceipt,
  reconcileCanonicalDocumentCommitReceipt,
} from './native-canonical-document-tool'
import {
  authoritySidecarPath,
  validateFoundationAuthoritySidecar,
} from './foundation-authority-sidecar'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENT_IDS,
} from './delivery-workflow/types'
import { auditDocumentReadiness } from './document-readiness-audit'
import { renderCompleteGameDocument } from './complete-game-document'

function completeSubmission(path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]) {
  const contract = getGameDocumentContract(path)
  return {
    title: contract.discipline,
    executiveSummary: `Complete ${contract.discipline} authority and production outcome.`,
    sections: contract.sections.map((section, index) => ({
      sectionId: section.sectionId,
      title: section.title,
      body: `Authoritative production content ${index + 1}.`,
    })),
    productionMaterials: contract.productionMaterials.map(material =>
      material.format === 'evidence_register'
        ? {
            materialId: material.materialId,
            title: material.title,
            format: material.format,
            entries: [
              {
                evidenceId: `${material.materialId}.pending`,
                category: 'search_direction' as const,
                displayName: 'Pending reference direction',
                purpose: 'Record a production need before source selection.',
                state: 'source_not_selected' as const,
                evidenceRefs: [],
              },
            ],
          }
        : {
            materialId: material.materialId,
            title: material.title,
            format: material.format,
            body:
              material.format === 'markdown_table'
                ? '| Field | Value |\n| --- | --- |\n| Owner | Authority |'
                : material.format === 'mermaid'
                  ? '```mermaid\ngraph TD\n  A --> B\n```'
                  : '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
          },
    ),
    auditAppendix: {
      acceptanceCriteria: ['The complete document contract is inspectable and implementation-ready.'],
      upstreamReferences: [],
      risks: [],
      openDecisions: [],
    },
  }
}

function bytewise(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

function authoritySubmission(
  path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
) {
  const documentId = CANONICAL_PROJECT_DOCUMENT_IDS[path].toLowerCase()
  return {
    records: getGameDocumentContract(path).sections
      .map(section => ({
        authorityId: `${documentId}.${section.sectionId}.primary`,
        sectionId: section.sectionId,
        kind: 'fact' as const,
        state: 'confirmed' as const,
        source: 'confirmed_brief' as const,
        evidenceRefs: [],
        statement: `Confirmed authority for ${section.sectionId}.`,
        responsibilityIds: [...section.responsibilityIds].sort(bytewise),
      }))
      .sort((left, right) => bytewise(left.authorityId, right.authorityId)),
  }
}

describe('canonical document commit', () => {
  test('exposes the strict authority record contract to the document author', async () => {
    let tool: Record<string, unknown> | undefined
    createNativeCanonicalDocumentTool({
      buildTool: definition => {
        tool = definition
        return definition
      },
      workspacePath: '/tmp/authority-schema-contract',
      contract: {
        dispatchId: 'dispatch-authority-schema',
        targetPath: 'docs/GDD.md',
        documentId: 'GDD',
        operation: 'create',
        baselineDigest: null,
        submissionKind: 'complete_game_document',
      },
    })

    const inputSchema = tool?.inputSchema as {
      safeParse(input: unknown): { success: boolean }
    }
    expect(
      inputSchema.safeParse({
        body: '# GDD',
        authority: { records: [{ authorityId: 'gdd.invalid' }] },
      }).success,
    ).toBe(false)
    expect(await (tool?.prompt as () => Promise<string>)()).toContain(
      'authorityId',
    )
    const prompt = await (tool?.prompt as () => Promise<string>)()
    for (const material of getGameDocumentContract('docs/GDD.md').productionMaterials) {
      expect(prompt).toContain(`<!-- beegame-material:${material.materialId} -->`)
      expect(prompt).toContain(`### ${material.title}`)
      expect(prompt).toContain(`required mechanical format: ${material.format}`)
    }
    expect(prompt).not.toContain('format=')
    expect(prompt).toContain('authority ID prefix: gdd.')
    for (const section of getGameDocumentContract('docs/GDD.md').sections) {
      expect(prompt).toContain(
        `sectionId=${section.sectionId}; allowed responsibilityIds=${[
          ...section.responsibilityIds,
        ].sort(bytewise).join(',')}`,
      )
    }
    expect(prompt).toContain('service canonicalizes record and responsibility ordering')
    expect(prompt).toContain('open_decision records must use state=deferred')
    expect(prompt).toContain('source and evidenceRefs')
    expect(prompt).toContain('model_estimate must use assumed or deferred')
    expect(prompt).toContain('verified requires evidenceRefs')
    expect(prompt).toContain('returns document_parts_prepared')
    expect(prompt).toContain('without publishing Markdown')
  })

  test('keeps prepared document parts invisible until authority succeeds', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-two-phase-'))
    try {
      const path = 'docs/GDD.md'
      let tool: Record<string, unknown> | undefined
      createNativeCanonicalDocumentTool({
        buildTool: definition => {
          tool = definition
          return definition
        },
        workspacePath,
        contract: {
          dispatchId: 'dispatch-two-phase-gdd',
          targetPath: path,
          documentId: 'GDD',
          operation: 'create',
          baselineDigest: null,
          submissionKind: 'complete_game_document',
        },
      })
      const call = tool?.call as (input: unknown) => Promise<{
        data: { status: string }
      }>
      await expect(call({ document: completeSubmission(path) })).resolves.toMatchObject({
        data: { status: 'document_parts_prepared' },
      })
      await expect(readFile(join(workspacePath, path), 'utf8')).rejects.toThrow()
      expect(
        await readCanonicalDocumentCommitReceipt(
          workspacePath,
          'dispatch-two-phase-gdd',
        ),
      ).toBeUndefined()
      await expect(
        call({ authority: { records: authoritySubmission(path).records.slice(1) } }),
      ).rejects.toThrow(/coverage/i)
      await expect(readFile(join(workspacePath, path), 'utf8')).rejects.toThrow()
      await expect(
        readFile(join(workspacePath, authoritySidecarPath(path)), 'utf8'),
      ).rejects.toThrow()
      await expect(
        call({
          authority: {
            records: authoritySubmission(path).records.map(record => ({
              ...record,
              value: '',
              unit: '',
            })),
          },
        }),
      ).resolves.toMatchObject({ data: { status: 'committed' } })
      await expect(readFile(join(workspacePath, path), 'utf8')).resolves.toContain(
        'document_id: GDD',
      )
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('renders protocol markers from a structured document submission', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-structured-'))
    try {
      const path = 'docs/ART_DIRECTION.md'
      let tool: Record<string, unknown> | undefined
      createNativeCanonicalDocumentTool({
        buildTool: definition => {
          tool = definition
          return definition
        },
        workspacePath,
        contract: {
          dispatchId: 'dispatch-structured-art',
          targetPath: path,
          documentId: 'ART_DIRECTION',
          operation: 'create',
          baselineDigest: null,
          submissionKind: 'complete_game_document',
        },
      })
      const call = tool?.call as (input: unknown) => Promise<{
        data: { status: string }
      }>
      await expect(
        call({ document: completeSubmission(path) }),
      ).resolves.toMatchObject({ data: { status: 'document_parts_prepared' } })
      await expect(readFile(join(workspacePath, path), 'utf8')).rejects.toThrow()
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects verified license evidence that does not exist on disk', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-evidence-'))
    try {
      const path = 'docs/ASSET_PLAN.md'
      let tool: Record<string, unknown> | undefined
      createNativeCanonicalDocumentTool({
        buildTool: definition => {
          tool = definition
          return definition
        },
        workspacePath,
        contract: {
          dispatchId: 'dispatch-missing-license-evidence',
          targetPath: path,
          documentId: 'ASSET_PLAN',
          operation: 'create',
          baselineDigest: null,
          submissionKind: 'complete_game_document',
        },
      })
      const submission = completeSubmission(path)
      const document = {
        ...submission,
        productionMaterials: submission.productionMaterials.map(material =>
          material.materialId === 'license-register'
            ? {
                ...material,
                entries: [
                  {
                    evidenceId: 'asset.external.primary',
                    category: 'production_asset',
                    displayName: 'External production asset',
                    purpose: 'Bind an external source to production use.',
                    state: 'verified',
                    sourceLocator: 'https://example.com/assets/primary',
                    licenseType: 'Commercial license',
                    commercialUse: true,
                    attribution: 'Attribution required.',
                    evidenceRefs: [
                      {
                        kind: 'file',
                        locator: 'assets/_licenses/missing.txt',
                        digest: '0'.repeat(64),
                      },
                    ],
                  },
                ],
              }
            : material,
        ),
      }

      await expect(
        (tool?.call as (value: unknown) => Promise<unknown>)({ document }),
      ).rejects.toThrow(/evidence.*missing|missing.*evidence/i)
      await expect(readFile(join(workspacePath, path), 'utf8')).rejects.toThrow()
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects unresolved upstream authority before preparing a document', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-upstream-'))
    try {
      const path = 'docs/UI_UX_SPEC.md'
      let tool: Record<string, unknown> | undefined
      createNativeCanonicalDocumentTool({
        buildTool: definition => {
          tool = definition
          return definition
        },
        workspacePath,
        contract: {
          dispatchId: 'dispatch-unresolved-upstream',
          targetPath: path,
          documentId: 'UI_UX_SPEC',
          operation: 'create',
          baselineDigest: null,
          submissionKind: 'complete_game_document',
        },
      })
      const submission = completeSubmission(path)
      const document = {
        ...submission,
        auditAppendix: {
          ...submission.auditAppendix,
          upstreamReferences: [
            {
              path: 'docs/GDD.md',
              authorityId: 'gdd.core_loop.not-present',
            },
          ],
        },
      }

      await expect(
        (tool?.call as (value: unknown) => Promise<unknown>)({ document }),
      ).rejects.toThrow(/upstream.*gdd\.core_loop\.not-present|missing/i)
      await expect(readFile(join(workspacePath, path), 'utf8')).rejects.toThrow()
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects authority that does not close the prepared audit decisions', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-decisions-'))
    try {
      const path = 'docs/GDD.md'
      let tool: Record<string, unknown> | undefined
      createNativeCanonicalDocumentTool({
        buildTool: definition => {
          tool = definition
          return definition
        },
        workspacePath,
        contract: {
          dispatchId: 'dispatch-open-decision-closure',
          targetPath: path,
          documentId: 'GDD',
          operation: 'create',
          baselineDigest: null,
          submissionKind: 'complete_game_document',
        },
      })
      const submission = completeSubmission(path)
      const document = {
        ...submission,
        auditAppendix: {
          ...submission.auditAppendix,
          openDecisions: [
            {
              decisionId: 'gdd.scope_risks.platform-target',
              question: 'Which platform target is authoritative?',
              owner: 'product',
              neededBy: 'milestone.prototype',
            },
          ],
        },
      }
      await expect(
        (tool?.call as (value: unknown) => Promise<unknown>)({ document }),
      ).resolves.toMatchObject({ data: { status: 'document_parts_prepared' } })

      await expect(
        (tool?.call as (value: unknown) => Promise<unknown>)({
          authority: authoritySubmission(path),
        }),
      ).rejects.toThrow(/open decision.*closure|closure.*decision/i)
      await expect(readFile(join(workspacePath, path), 'utf8')).rejects.toThrow()
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('prepares bounded structured parts before rendering the complete document', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-parts-'))
    try {
      const path = 'docs/UI_UX_SPEC.md'
      const submission = completeSubmission(path)
      let tool: Record<string, unknown> | undefined
      createNativeCanonicalDocumentTool({
        buildTool: definition => {
          tool = definition
          return definition
        },
        workspacePath,
        contract: {
          dispatchId: 'dispatch-parts-ui',
          targetPath: path,
          documentId: 'UI_UX_SPEC',
          operation: 'create',
          baselineDigest: null,
          submissionKind: 'complete_game_document',
        },
      })
      const call = tool?.call as (input: unknown) => Promise<{
        data: { status: string; nextPart?: string }
      }>

      await expect(
        call({
          part: {
            kind: 'header',
            title: submission.title,
            executiveSummary: submission.executiveSummary,
          },
        }),
      ).resolves.toMatchObject({
        data: {
          status: 'part_prepared',
          nextPart: `section:${submission.sections[0]!.sectionId}`,
        },
      })
      await expect(
        call({
          part: {
            kind: 'header',
            title: submission.title,
            executiveSummary: submission.executiveSummary,
          },
        }),
      ).resolves.toMatchObject({
        data: {
          status: 'part_prepared',
          nextPart: `section:${submission.sections[0]!.sectionId}`,
        },
      })
      await expect(readFile(join(workspacePath, path), 'utf8')).rejects.toThrow()

      for (const section of submission.sections)
        await call({ part: { kind: 'section', section } })
      for (const material of submission.productionMaterials)
        await call({ part: { kind: 'material', material } })
      await expect(
        call({
          part: { kind: 'audit', auditAppendix: submission.auditAppendix },
        }),
      ).resolves.toMatchObject({ data: { status: 'document_parts_prepared' } })
      await expect(
        call({
          part: { kind: 'audit', auditAppendix: submission.auditAppendix },
        }),
      ).resolves.toMatchObject({ data: { status: 'document_parts_prepared' } })

      await expect(readFile(join(workspacePath, path), 'utf8')).rejects.toThrow()
      await call({ authority: authoritySubmission(path) })

      const markdown = await readFile(join(workspacePath, path), 'utf8')
      expect(markdown).toContain('<!-- beegame-section:experience_architecture -->')
      expect(markdown).toContain('<!-- beegame-production-materials -->')
      expect(markdown).toContain('<!-- beegame-audit-appendix -->')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects skipped document parts without losing the prepared draft', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-part-order-'))
    try {
      const path = 'docs/UI_UX_SPEC.md'
      const submission = completeSubmission(path)
      let tool: Record<string, unknown> | undefined
      createNativeCanonicalDocumentTool({
        buildTool: definition => {
          tool = definition
          return definition
        },
        workspacePath,
        contract: {
          dispatchId: 'dispatch-part-order-ui',
          targetPath: path,
          documentId: 'UI_UX_SPEC',
          operation: 'create',
          baselineDigest: null,
          submissionKind: 'complete_game_document',
        },
      })
      const call = tool?.call as (input: unknown) => Promise<unknown>
      await call({
        part: {
          kind: 'header',
          title: submission.title,
          executiveSummary: submission.executiveSummary,
        },
      })
      await expect(
        call({ part: { kind: 'section', section: submission.sections[1] } }),
      ).rejects.toThrow(/next document part|order/i)
      await expect(
        call({ part: { kind: 'section', section: submission.sections[0] } }),
      ).resolves.toMatchObject({ data: { status: 'part_prepared' } })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('produces the complete canonical document set from neutral product authority', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-full-set-'))
    try {
      for (const [documentIndex, path] of CANONICAL_FOUNDATION_DOCUMENTS.entries()) {
        const contract = getGameDocumentContract(path)
        let tool: Record<string, unknown> | undefined
        createNativeCanonicalDocumentTool({
          buildTool: definition => {
            tool = definition
            return definition
          },
          workspacePath,
          contract: {
            dispatchId: `dispatch-complete-${documentIndex}`,
            targetPath: path,
            documentId: CANONICAL_PROJECT_DOCUMENT_IDS[path],
            operation: 'create',
            baselineDigest: null,
            submissionKind: 'complete_game_document',
          },
        })
        const call = tool?.call as
          | ((input: unknown) => Promise<unknown>)
          | undefined
        const submission = completeSubmission(path)
        await call!({ document: submission })
        await call!({ authority: authoritySubmission(path) })
      }

      expect(
        auditDocumentReadiness(workspacePath, {
          includeChecklist: false,
          includeAssetManifest: false,
          requireCompleteFoundation: true,
        }),
      ).toEqual({ valid: true, issues: [] })
      for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
        const content = await readFile(join(workspacePath, path), 'utf8')
        const sidecar = JSON.parse(
          await readFile(join(workspacePath, authoritySidecarPath(path)), 'utf8'),
        )
        expect(
          validateFoundationAuthoritySidecar({
            documentPath: path,
            markdown: content,
            value: sidecar,
          }).documentPath,
        ).toBe(path)
        for (const section of getGameDocumentContract(path).sections)
          expect(content).toContain(
            `<!-- beegame-section:${section.sectionId} -->`,
          )
      }
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('initial authoring accepts one complete structured document and rejects raw bypasses', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-complete-'))
    try {
      const path = 'docs/GDD.md'
      const contract = getGameDocumentContract(path)
      let tool: Record<string, unknown> | undefined
      createNativeCanonicalDocumentTool({
        buildTool: definition => {
          tool = definition
          return definition
        },
        workspacePath,
        contract: {
          dispatchId: 'dispatch-complete-gdd',
          targetPath: path,
          documentId: 'GDD',
          operation: 'create',
          baselineDigest: null,
          submissionKind: 'complete_game_document',
        },
      })
      const submission = completeSubmission(path)
      const call = tool?.call as ((input: unknown) => Promise<unknown>) | undefined
      expect(call).toBeDefined()
      await call!({ document: submission })
      await call!({ authority: authoritySubmission(path) })
      const content = await readFile(join(workspacePath, path), 'utf8')
      for (const section of contract.sections)
        expect(content).toContain(`<!-- beegame-section:${section.sectionId} -->`)
      await expect(call!({ body: '# bypass' })).rejects.toThrow()
      await expect(call!(submission)).rejects.toThrow()
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('retains the prepared draft while invalid authority remains invisible', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-sidecar-repair-'))
    try {
      const path = 'docs/GDD.md'
      let tool: Record<string, unknown> | undefined
      createNativeCanonicalDocumentTool({
        buildTool: definition => {
          tool = definition
          return definition
        },
        workspacePath,
        contract: {
          dispatchId: 'dispatch-sidecar-repair',
          targetPath: path,
          documentId: 'GDD',
          operation: 'create',
          baselineDigest: null,
          submissionKind: 'complete_game_document',
        },
      })
      const call = tool?.call as (input: unknown) => Promise<unknown>
      const authority = authoritySubmission(path)
      await call({ document: completeSubmission(path) })
      await expect(
        call({ authority: { records: authority.records.slice(1) } }),
      ).rejects.toThrow(/coverage/i)

      await expect(readFile(join(workspacePath, path), 'utf8')).rejects.toThrow()
      expect(
        await readCanonicalDocumentCommitReceipt(
          workspacePath,
          'dispatch-sidecar-repair',
        ),
      ).toBeUndefined()
      await expect(
        readFile(join(workspacePath, authoritySidecarPath(path)), 'utf8'),
      ).rejects.toThrow()

      const result = (await call({ authority })) as {
        data: { status: string; authorityDigest: string }
      }
      expect(result.data.status).toBe('committed')
      expect(result.data.authorityDigest).toMatch(/^[a-f0-9]{64}$/)
      expect(await readFile(join(workspacePath, path), 'utf8')).toContain(
        'document_id: GDD',
      )
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('does not replace a revision baseline when authority validation fails', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-revision-visibility-'))
    try {
      const path = 'docs/GDD.md'
      const baseline =
        '---\ndocument_id: GDD\nversion: 1.0.0\nupdated_at: 2026-01-01T00:00:00.000Z\n---\n\n# Existing document\n'
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await writeFile(join(workspacePath, path), baseline)
      let tool: Record<string, unknown> | undefined
      createNativeCanonicalDocumentTool({
        buildTool: definition => {
          tool = definition
          return definition
        },
        workspacePath,
        contract: {
          dispatchId: 'dispatch-revision-visibility',
          targetPath: path,
          documentId: 'GDD',
          operation: 'revise',
          baselineDigest: createHash('sha256').update(baseline).digest('hex'),
          baselineVersion: '1.0.0',
          baselineUpdatedAt: '2026-01-01T00:00:00.000Z',
          submissionKind: 'complete_game_document',
        },
      })
      const call = tool?.call as (input: unknown) => Promise<unknown>
      await call({ document: completeSubmission(path) })
      await expect(
        call({
          authority: { records: authoritySubmission(path).records.slice(1) },
        }),
      ).rejects.toThrow(/coverage/i)
      expect(await readFile(join(workspacePath, path), 'utf8')).toBe(baseline)
      await expect(
        readFile(join(workspacePath, authoritySidecarPath(path)), 'utf8'),
      ).rejects.toThrow()
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('reconciles a fully landed v3 package after a final-receipt crash', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-package-recovery-'))
    try {
      const path = 'docs/GDD.md'
      const dispatchId = 'dispatch-package-recovery'
      let tool: Record<string, unknown> | undefined
      createNativeCanonicalDocumentTool({
        buildTool: definition => {
          tool = definition
          return definition
        },
        workspacePath,
        contract: {
          dispatchId,
          targetPath: path,
          documentId: 'GDD',
          operation: 'create',
          baselineDigest: null,
          submissionKind: 'complete_game_document',
        },
      })
      const call = tool?.call as (input: unknown) => Promise<{ data: Record<string, unknown> }>
      await call({ document: completeSubmission(path) })
      const draftPath = join(
        workspacePath,
        '.beegame/workflow/canonical-document-drafts',
        `${dispatchId}.json`,
      )
      const draft = await readFile(draftPath, 'utf8')
      const committed = (await call({ authority: authoritySubmission(path) })).data
      expect(committed).toMatchObject({ schemaVersion: 3, status: 'committed' })
      const receiptPath = join(
        workspacePath,
        '.beegame/workflow/document-commits',
        `${dispatchId}.json`,
      )
      await writeFile(
        receiptPath,
        `${JSON.stringify({ ...committed, status: 'package_prepared' }, null, 2)}\n`,
      )
      await mkdir(join(draftPath, '..'), { recursive: true })
      await writeFile(draftPath, draft)

      await expect(
        reconcileCanonicalDocumentCommitReceipt({ workspacePath, dispatchId }),
      ).resolves.toMatchObject({ schemaVersion: 3, status: 'committed' })
      await expect(call({ authority: authoritySubmission(path) })).resolves.toEqual({
        data: { ...committed, status: 'committed' },
      })
      const changedAuthority = authoritySubmission(path)
      changedAuthority.records[0] = {
        ...changedAuthority.records[0]!,
        statement: 'Changed authority after package preparation.',
      }
      await expect(call({ authority: changedAuthority })).rejects.toThrow(
        /different authority/i,
      )
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('writes external SVG artifacts and binds them to the durable receipt', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-artifacts-'))
    try {
      const path = 'docs/ART_DIRECTION.md'
      let tool: Record<string, unknown> | undefined
      createNativeCanonicalDocumentTool({
        buildTool: definition => {
          tool = definition
          return definition
        },
        workspacePath,
        contract: {
          dispatchId: 'dispatch-artifacts',
          targetPath: path,
          documentId: 'ART_DIRECTION',
          operation: 'create',
          baselineDigest: null,
          submissionKind: 'complete_game_document',
        },
      })
      const call = tool?.call as (input: unknown) => Promise<unknown>
      await call({ document: completeSubmission(path) })
      const committed = (await call({ authority: authoritySubmission(path) })) as {
        data: { artifacts: Array<{ artifactId: string; path: string; mediaType: string; digest: string }> }
      }
      expect(committed.data.artifacts).toHaveLength(3)
      for (const artifact of committed.data.artifacts) {
        const bytes = await readFile(join(workspacePath, artifact.path), 'utf8')
        expect(artifact.mediaType).toBe('image/svg+xml')
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(
          artifact.digest,
        )
      }
      const markdown = await readFile(join(workspacePath, path), 'utf8')
      expect(markdown).not.toContain('<svg')

      await unlink(join(workspacePath, committed.data.artifacts[0]!.path))
      await expect(
        reconcileCanonicalDocumentCommitReceipt({
          workspacePath,
          dispatchId: 'dispatch-artifacts',
        }),
      ).resolves.toBeUndefined()
      await writeFile(
        join(workspacePath, committed.data.artifacts[0]!.path),
        '<svg xmlns="http://www.w3.org/2000/svg"><text>tampered</text></svg>\n',
      )
      await expect(
        reconcileCanonicalDocumentCommitReceipt({
          workspacePath,
          dispatchId: 'dispatch-artifacts',
        }),
      ).resolves.toBeUndefined()
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('does not expose Markdown when an SVG artifact cannot be written', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-artifact-failure-'))
    try {
      const path = 'docs/UI_UX_SPEC.md'
      await mkdir(
        join(workspacePath, 'docs/artifacts/ui-ux-spec/wireframe-board.svg'),
        { recursive: true },
      )
      let tool: Record<string, unknown> | undefined
      createNativeCanonicalDocumentTool({
        buildTool: definition => {
          tool = definition
          return definition
        },
        workspacePath,
        contract: {
          dispatchId: 'dispatch-artifact-failure',
          targetPath: path,
          documentId: 'UI_UX_SPEC',
          operation: 'create',
          baselineDigest: null,
          submissionKind: 'complete_game_document',
        },
      })
      const call = tool?.call as (input: unknown) => Promise<unknown>
      await expect(call({ document: completeSubmission(path) })).resolves.toMatchObject({
        data: { status: 'document_parts_prepared' },
      })
      await expect(
        call({ authority: authoritySubmission(path) }),
      ).rejects.toThrow()
      await expect(readFile(join(workspacePath, path), 'utf8')).rejects.toThrow()
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('owns metadata and returns the same durable commit idempotently', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-document-'))
    try {
      const contract = {
        dispatchId: 'dispatch-create-gdd',
        targetPath: 'docs/GDD.md',
        documentId: 'GDD',
        operation: 'create' as const,
        baselineDigest: null,
      }
      const first = await commitCanonicalDocument({
        workspacePath,
        contract,
        body: '# Game Design\n\nRules.',
      })
      const second = await commitCanonicalDocument({
        workspacePath,
        contract,
        body: '# Game Design\n\nRules.',
      })
      expect(second).toEqual(first)
      expect(first).toMatchObject({
        version: '1.0.0',
        documentId: 'GDD',
        status: 'committed',
      })
      const content = await readFile(join(workspacePath, 'docs/GDD.md'), 'utf8')
      expect(content).toContain('document_id: GDD')
      expect(content).toContain('version: 1.0.0')
      expect(content).toContain(`updated_at: ${first.updatedAt}`)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('increments PATCH and makes updated_at strictly monotonic', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-revision-'))
    try {
      const baseline =
        '---\ndocument_id: GDD\nversion: 1.2.3\nupdated_at: 2099-01-01T00:00:00.000Z\n---\n\n# Old\n'
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await writeFile(join(workspacePath, 'docs/GDD.md'), baseline)
      const receipt = await commitCanonicalDocument({
        workspacePath,
        contract: {
          dispatchId: 'dispatch-revise-gdd',
          targetPath: 'docs/GDD.md',
          documentId: 'GDD',
          operation: 'revise',
          baselineDigest: createHash('sha256').update(baseline).digest('hex'),
          baselineVersion: '1.2.3',
          baselineUpdatedAt: '2099-01-01T00:00:00.000Z',
        },
        body: '# New\n\nRepaired rules.',
      })
      expect(receipt.version).toBe('1.2.4')
      expect(Date.parse(receipt.updatedAt)).toBeGreaterThan(
        Date.parse('2099-01-01T00:00:00.000Z'),
      )
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('reconciles a prepared receipt whose final file already landed', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-recovery-'))
    try {
      const receipt = await commitCanonicalDocument({
        workspacePath,
        contract: {
          dispatchId: 'dispatch-recover-gdd',
          targetPath: 'docs/GDD.md',
          documentId: 'GDD',
          operation: 'create',
          baselineDigest: null,
        },
        body: '# Game Design\n\nRules.',
      })
      const receiptPath = join(
        workspacePath,
        '.beegame/workflow/document-commits/dispatch-recover-gdd.json',
      )
      await writeFile(
        receiptPath,
        `${JSON.stringify({ ...receipt, status: 'prepared' }, null, 2)}\n`,
      )
      await expect(
        reconcileCanonicalDocumentCommitReceipt({
          workspacePath,
          dispatchId: 'dispatch-recover-gdd',
        }),
      ).resolves.toMatchObject({ status: 'committed' })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects model-owned front matter', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-frontmatter-'))
    try {
      await expect(
        commitCanonicalDocument({
          workspacePath,
          contract: {
            dispatchId: 'dispatch-invalid-gdd',
            targetPath: 'docs/GDD.md',
            documentId: 'GDD',
            operation: 'create',
            baselineDigest: null,
          },
          body: '---\nversion: 9.9.9\n---\n# Invalid',
        }),
      ).rejects.toThrow('must not include YAML front matter')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects a document identity that does not own the target path', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-identity-'))
    try {
      await expect(
        commitCanonicalDocument({
          workspacePath,
          contract: {
            dispatchId: 'dispatch-wrong-identity',
            targetPath: 'docs/GDD.md',
            documentId: 'BALANCE_DESIGN',
            operation: 'create',
            baselineDigest: null,
          },
          body: '# Wrong identity',
        }),
      ).rejects.toThrow('canonical document identity is invalid')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects a revision without an existing baseline', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-missing-'))
    try {
      await expect(
        commitCanonicalDocument({
          workspacePath,
          contract: {
            dispatchId: 'dispatch-missing-gdd',
            targetPath: 'docs/GDD.md',
            documentId: 'GDD',
            operation: 'revise',
            baselineDigest: null,
            baselineVersion: '1.0.0',
            baselineUpdatedAt: '2026-08-04T00:00:00.000Z',
          },
          body: '# Missing baseline',
        }),
      ).rejects.toThrow('revision requires an existing baseline')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects an invalid revision timestamp instead of replacing it', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-time-'))
    try {
      const baseline = '# Existing\n'
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await writeFile(join(workspacePath, 'docs/GDD.md'), baseline)
      await expect(
        commitCanonicalDocument({
          workspacePath,
          contract: {
            dispatchId: 'dispatch-invalid-time-gdd',
            targetPath: 'docs/GDD.md',
            documentId: 'GDD',
            operation: 'revise',
            baselineDigest: createHash('sha256').update(baseline).digest('hex'),
            baselineVersion: '1.0.0',
            baselineUpdatedAt: 'invalid',
          },
          body: '# Revised',
        }),
      ).rejects.toThrow('revision requires valid baseline metadata')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
