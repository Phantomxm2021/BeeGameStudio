import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
    productionMaterials: contract.productionMaterials.map(material => ({
      materialId: material.materialId,
      title: material.title,
      format: material.format,
      body:
        material.format === 'markdown_table'
          ? '| Field | Value |\n| --- | --- |\n| Owner | Authority |'
          : material.format === 'mermaid'
            ? '```mermaid\ngraph TD\n  A --> B\n```'
            : '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
    })),
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
  })

  test('prepares Markdown before accepting authority without resending the body', async () => {
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
      const body = renderCompleteGameDocument(path, completeSubmission(path))
      await expect(call({ body })).resolves.toMatchObject({
        data: { status: 'document_prepared' },
      })
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
      ).resolves.toMatchObject({ data: { status: 'document_prepared' } })
      const markdown = await readFile(join(workspacePath, path), 'utf8')
      expect(markdown).toContain('<!-- beegame-section:visual_pillars -->')
      expect(markdown).toContain('<!-- beegame-material:visual-pillar-board -->')
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
      ).resolves.toMatchObject({ data: { status: 'document_prepared' } })
      await expect(
        call({
          part: { kind: 'audit', auditAppendix: submission.auditAppendix },
        }),
      ).resolves.toMatchObject({ data: { status: 'document_prepared' } })

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
        await call!({
          body: renderCompleteGameDocument(path, submission),
          authority: authoritySubmission(path),
        })
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

  test('initial authoring accepts one complete Markdown document and rejects incomplete bodies', async () => {
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
      await call!({
        body: renderCompleteGameDocument(path, submission),
        authority: authoritySubmission(path),
      })
      const content = await readFile(join(workspacePath, path), 'utf8')
      for (const section of contract.sections)
        expect(content).toContain(`<!-- beegame-section:${section.sectionId} -->`)
      await expect(call!({ body: '# bypass' })).rejects.toThrow()
      await expect(call!(submission)).rejects.toThrow()
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('retains valid Markdown and repairs only an invalid authority sidecar', async () => {
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
      await expect(
        call({
          body: renderCompleteGameDocument(path, completeSubmission(path)),
          authority: { records: authority.records.slice(1) },
        }),
      ).rejects.toThrow(/coverage/i)

      const preparedMarkdown = await readFile(join(workspacePath, path), 'utf8')
      expect(preparedMarkdown).toContain('document_id: GDD')
      expect(
        await readCanonicalDocumentCommitReceipt(
          workspacePath,
          'dispatch-sidecar-repair',
        ),
      ).toMatchObject({ status: 'document_prepared', authorityDigest: null })
      await expect(
        readFile(join(workspacePath, authoritySidecarPath(path)), 'utf8'),
      ).rejects.toThrow()

      const result = (await call({ authority })) as {
        data: { status: string; authorityDigest: string }
      }
      expect(result.data.status).toBe('committed')
      expect(result.data.authorityDigest).toMatch(/^[a-f0-9]{64}$/)
      expect(await readFile(join(workspacePath, path), 'utf8')).toBe(
        preparedMarkdown,
      )
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
