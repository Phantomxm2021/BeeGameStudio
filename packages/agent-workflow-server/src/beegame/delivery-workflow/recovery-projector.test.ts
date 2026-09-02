import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectWorkflowSnapshot } from './run-store'
import { projectExactResumeRun } from './recovery-projector'
import { createInitialDeliveryRun } from './run-store'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type AcceptedWorkflowUnit,
  type DeliveryRun,
  type WorkflowEvent,
} from './types'
import { commitAuthoredFoundationDocument } from '../authored-document-receipt'
import {
  completeTestSubmission,
  renderTestCompleteGameDocument,
} from '../../__tests__/complete-game-document-fixture'
import { withTestDocumentMetadata } from '../../__tests__/delivery-workflow-test-helpers'
import { computeDocumentRevision, computeWorkspaceRevision } from './revision'
import { createHash } from 'node:crypto'
import { deriveFoundationAuditArtifacts } from './foundation-audit-artifacts'
import { createFoundationAuditState } from './foundation-audit-state'
import { getGameDocumentContract } from './game-document-contracts'
import {
  canonicalFoundationAuthorityProjectionBytes,
  foundationProjectionRelativePath,
  projectFoundationAuthority,
} from '../foundation-authority-projection'

async function writeCommittedProjection(
  workspacePath: string,
  dispatchId: string,
  targetPath: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
): Promise<void> {
  const contract = getGameDocumentContract(targetPath)
  const documents = new Map(
    await Promise.all(
      contract.upstreamSections.map(
        async source =>
          [
            source.path,
            await readFile(join(workspacePath, source.path), 'utf8'),
          ] as const,
      ),
    ),
  )
  const projection = projectFoundationAuthority({
    targetPath,
    availableUpstreamPaths: contract.upstreamSections.map(
      source => source.path,
    ),
    documents,
  })
  const projectionPath = join(
    workspacePath,
    foundationProjectionRelativePath(dispatchId),
  )
  await mkdir(join(workspacePath, '.beegame/workflow/document-projections'), {
    recursive: true,
  })
  await writeFile(
    projectionPath,
    canonicalFoundationAuthorityProjectionBytes(projection),
  )
}

describe('recovery projector foundation audit boundary', () => {
  test('rejects downstream recovery before the sole index-staged audit state has v46 handoff authority', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'foundation-recovery-cutover-'),
    )
    try {
      const ownerId = 'recovery-cutover-owner'
      const projectId = 'recovery-cutover-project'
      const runId = 'recovery-cutover-run'
      const confirmedBriefContext = 'confirmed brief for recovery cutover'
      const confirmedBriefDigest = createHash('sha256')
        .update(confirmedBriefContext)
        .digest('hex')
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      const units: AcceptedWorkflowUnit[] = []
      for (const [index, path] of CANONICAL_FOUNDATION_DOCUMENTS.entries()) {
        const dispatchId = `recovery-document-${index}`
        await writeFile(
          join(workspacePath, path),
          withTestDocumentMetadata(
            path,
            renderTestCompleteGameDocument(path, completeTestSubmission(path)),
          ),
        )
        await writeCommittedProjection(workspacePath, dispatchId, path)
        const receipt = await commitAuthoredFoundationDocument({
          workspacePath,
          dispatchId,
          targetPath: path,
        })
        units.push({
          eventSchemaVersion: 1,
          unitId: `document:${path}`,
          kind: 'document',
          phase: 'DOCUMENT_DRAFTING' as const,
          predecessorUnitIds:
            index === 0
              ? []
              : [`document:${CANONICAL_FOUNDATION_DOCUMENTS[index - 1]}`],
          inputRevision: 'document-revision-placeholder',
          dependencyDigests: { [path]: receipt.finalDigest },
          dispatchId,
          receiptRef: `.beegame/workflow/document-commits/${dispatchId}.json`,
          acceptedAt: receipt.updatedAt,
          payload: { path, revision: 'document-revision-placeholder' },
        })
      }
      const revision = {
        document: await computeDocumentRevision(
          workspacePath,
          confirmedBriefDigest,
        ),
        workspace: await computeWorkspaceRevision(workspacePath),
      }
      const artifacts = await deriveFoundationAuditArtifacts({
        workspacePath,
        revision: revision.document,
        checkpoints: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
          path,
          status: 'committed' as const,
        })),
      })
      const foundationAuditState = createFoundationAuditState({
        revision: artifacts.revision,
        documentDigests: artifacts.documentDigests,
        manifest: artifacts.manifest,
      })
      revision.workspace = await computeWorkspaceRevision(workspacePath)
      const acceptedEvents: WorkflowEvent[] = [
        {
          eventId: 'recovery-cutover-created',
          runId,
          type: 'run.created',
          phase: 'DOCUMENT_REVIEW',
          status: 'needs_action',
          revision,
          createdAt: '2026-08-24T00:00:00.000Z',
        },
        {
          eventId: 'recovery-cutover-usage',
          runId,
          type: 'usage.updated',
          phase: 'DOCUMENT_REVIEW',
          status: 'needs_action',
          revision,
          createdAt: '2026-08-24T00:01:00.000Z',
          usage: {
            input_tokens: 0,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
        },
        ...units.map((unit, index) => ({
          eventId: `recovery-cutover-event-${index}`,
          runId,
          type: 'workflow.unit.accepted',
          phase: 'DOCUMENT_DRAFTING' as const,
          status: 'running' as const,
          revision,
          createdAt: '2026-08-24T00:02:00.000Z',
          projectId,
          ownerId,
          unit: {
            ...unit,
            inputRevision: revision.document,
            payload: {
              path: unit.payload && (unit.payload as { path: string }).path,
              revision: revision.document,
            },
          },
        })),
      ]
      const initial = createInitialDeliveryRun({
        runId,
        projectId,
        ownerId,
        confirmedBriefContext,
        confirmedBriefDigest,
        documentRevision: revision.document,
        workspaceRevision: revision.workspace,
      })
      const run: DeliveryRun = {
        ...initial,
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
        status: 'running',
        foundationDraftState: {
          completedPaths: [...CANONICAL_FOUNDATION_DOCUMENTS],
        },
        foundationAuditState,
        createdAt: '2026-08-24T00:00:00.000Z',
        updatedAt: '2026-08-24T00:02:00.000Z',
      }
      const store = (await import('./run-store')).createRunStore(
        workspacePath,
        ownerId,
      )
      await store.save(run)
      const inspection = await inspectWorkflowSnapshot({
        snapshotPath: join(workspacePath, '.beegame/workflow/run.json'),
        ownerId,
      })
      await expect(
        projectExactResumeRun({
          inspection,
          events: acceptedEvents,
          workspacePath,
          ownerId,
          projectId,
          confirmedBriefContext,
        }),
      ).rejects.toMatchObject({
        code: 'recovery_checkpoint_missing',
        message:
          'snapshot has no durable identity for the exact unfinished unit',
      })

      expect(await store.load()).toMatchObject({
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
        status: 'running',
        foundationAuditState,
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
