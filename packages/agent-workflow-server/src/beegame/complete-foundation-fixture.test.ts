import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createNativeCanonicalDocumentTool,
  readCanonicalDocumentCommitReceipt,
} from './native-canonical-document-tool'
import {
  resolveUpstreamAuthorityReferences,
  type CompleteGameDocumentSubmission,
} from './complete-game-document'
import { auditDocumentReadiness } from './document-readiness-audit'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENT_IDS,
  type FoundationDocumentPath,
} from './delivery-workflow/types'

function bytewise(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

function authorityId(path: FoundationDocumentPath, sectionId: string): string {
  return `${CANONICAL_PROJECT_DOCUMENT_IDS[path].toLowerCase()}.${sectionId}.primary`
}

function neutralSubmission(
  path: FoundationDocumentPath,
): CompleteGameDocumentSubmission {
  const contract = getGameDocumentContract(path)
  return {
    title: contract.discipline,
    executiveSummary: `This discipline defines production-ready authority for an interactive project, its primary action, observable outcomes, and production milestone boundaries.`,
    sections: contract.sections.map((section, index) => ({
      sectionId: section.sectionId,
      title: section.title,
      body: `The ${section.title.toLowerCase()} contract owns decision ${index + 1}, its implementation boundary, responsible discipline, measurable result, verification evidence, and downstream handoff without repeating another owner's authority.`,
    })),
    productionMaterials: contract.productionMaterials.map(material =>
      material.format === 'evidence_register'
        ? {
            materialId: material.materialId,
            title: material.title,
            format: material.format,
            entries: [
              {
                evidenceId: `${material.materialId}.pending-source`,
                category: 'search_direction' as const,
                displayName: 'Pending production reference',
                purpose: material.purpose,
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
                ? '| Production Field | Authority | Evidence |\n| --- | --- | --- |\n| Primary action | Assigned discipline | Observable check |'
                : material.format === 'mermaid'
                  ? '```mermaid\ngraph TD\n  Start[Primary action] --> Result[Observable result]\n```'
                  : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#20242b"/><text x="16" y="32" fill="#ffffff">Production reference</text></svg>',
          },
    ),
    auditAppendix: {
      acceptanceCriteria: [
        'Every owned decision has an observable implementation result and named production evidence.',
      ],
      upstreamReferences: contract.allowedUpstreamPaths.map(upstreamPath => {
        const upstream = getGameDocumentContract(upstreamPath)
        return {
          path: upstreamPath,
          authorityId: authorityId(
            upstreamPath,
            upstream.sections[0]!.sectionId,
          ),
        }
      }),
      risks: [],
      openDecisions: [],
    },
  }
}

function neutralAuthority(path: FoundationDocumentPath) {
  return {
    records: getGameDocumentContract(path)
      .sections.map(section => ({
        authorityId: authorityId(path, section.sectionId),
        sectionId: section.sectionId,
        kind: 'fact' as const,
        state: 'confirmed' as const,
        source: 'confirmed_brief' as const,
        evidenceRefs: [],
        statement: `Confirmed production authority for ${section.title}.`,
        responsibilityIds: [...section.responsibilityIds].sort(bytewise),
      }))
      .sort((left, right) => bytewise(left.authorityId, right.authorityId)),
  }
}

describe('neutral complete Foundation fixture', () => {
  test('commits all eight complete documents within the bounded call target', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'neutral-foundation-'))
    try {
      const committedDocuments: string[] = []
      const documentPartCalls: number[] = []
      const submissions = new Map<
        FoundationDocumentPath,
        CompleteGameDocumentSubmission
      >()

      for (const [index, path] of CANONICAL_FOUNDATION_DOCUMENTS.entries()) {
        const submission = neutralSubmission(path)
        submissions.set(path, submission)
        let tool: Record<string, unknown> | undefined
        createNativeCanonicalDocumentTool({
          buildTool: definition => {
            tool = definition
            return definition
          },
          workspacePath,
          contract: {
            dispatchId: `neutral-document-${index}`,
            targetPath: path,
            documentId: CANONICAL_PROJECT_DOCUMENT_IDS[path],
            operation: 'create',
            baselineDigest: null,
            submissionKind: 'complete_game_document',
          },
        })
        const call = tool?.call as (
          input: unknown,
        ) => Promise<{ data: { status: string } }>
        const parts = [
          {
            kind: 'header',
            title: submission.title,
            executiveSummary: submission.executiveSummary,
          },
          ...submission.sections.map(section => ({ kind: 'section', section })),
          ...submission.productionMaterials.map(material => ({
            kind: 'material',
            material,
          })),
          {
            kind: 'audit',
            auditAppendix: submission.auditAppendix,
          },
        ]
        let calls = 0
        for (let offset = 0; offset < parts.length; offset += 3) {
          const batch = { parts: parts.slice(offset, offset + 3) }
          expect(
            Buffer.byteLength(JSON.stringify(batch), 'utf8'),
          ).toBeLessThanOrEqual(16 * 1024)
          await call(batch)
          calls += 1
        }
        const result = await call({ authority: neutralAuthority(path) })
        calls += 1
        expect(result.data.status).toBe('committed')
        expect(
          await readCanonicalDocumentCommitReceipt(
            workspacePath,
            `neutral-document-${index}`,
          ),
        ).toMatchObject({ schemaVersion: 3, status: 'committed' })
        committedDocuments.push(path)
        documentPartCalls.push(calls)
      }

      const unresolvedAuthorityReferences: string[] = []
      for (const [path, submission] of submissions)
        try {
          await resolveUpstreamAuthorityReferences({
            workspacePath,
            targetPath: path,
            references: submission.auditAppendix.upstreamReferences,
          })
        } catch (error) {
          unresolvedAuthorityReferences.push(
            `${path}:${error instanceof Error ? error.message : 'unknown'}`,
          )
        }
      const inlineSvgBytes = (
        await Promise.all(
          CANONICAL_FOUNDATION_DOCUMENTS.map(path =>
            readFile(join(workspacePath, path), 'utf8'),
          ),
        )
      ).reduce(
        (total, markdown) => total + (markdown.match(/<svg/g)?.length ?? 0),
        0,
      )

      expect(committedDocuments).toHaveLength(8)
      expect(
        auditDocumentReadiness(workspacePath, {
          includeChecklist: false,
          includeAssetManifest: false,
          requireCompleteFoundation: true,
        }).valid,
      ).toBe(true)
      expect(inlineSvgBytes).toBe(0)
      expect(unresolvedAuthorityReferences).toEqual([])
      expect(documentPartCalls.every(count => count <= 9)).toBe(true)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
