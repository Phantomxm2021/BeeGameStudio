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
import { foundationAuthoringSources } from './foundation-authoring-contract'
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
  const documents = new Map(await Promise.all(
    foundationAuthoringSources(targetPath).map(async source => [
      source.path,
      await readFile(join(workspacePath, source.path), 'utf8'),
    ] as const),
  ))
  const projection = projectFoundationAuthority({
    targetPath,
    availableUpstreamPaths: foundationAuthoringSources(targetPath).map(source => source.path),
    documents,
  })
  const projectionPath = join(workspacePath, foundationProjectionRelativePath(dispatchId))
  await mkdir(join(workspacePath, '.beegame/workflow/document-projections'), { recursive: true })
  await writeFile(projectionPath, canonicalFoundationAuthorityProjectionBytes(projection))
}

describe('recovery projector foundation audit boundary', () => {
  test('reconstructs and preserves the sole index-staged audit state after recovery', async () => {
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
      // Recovery consumes a fully published Stage 2 package, not a serial author schedule.
      for (const path of CANONICAL_FOUNDATION_DOCUMENTS)
        await writeFile(join(workspacePath, path), withTestDocumentMetadata(
          path, renderTestCompleteGameDocument(path, completeTestSubmission(path)),
        ))
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
          foundationAuthoringPause: 'requested',
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
        phase: 'RESOURCE_PREPARATION',
        status: 'running',
        foundationDraftState: {
          completedPaths: [...CANONICAL_FOUNDATION_DOCUMENTS],
        },
        foundationAuditState,
        resourceProductionState: { currentTask: 'RESOURCE_INVENTORY' },
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
      const projected = await projectExactResumeRun({
        inspection,
        events: acceptedEvents,
        workspacePath,
        ownerId,
        projectId,
        confirmedBriefContext,
      })

      expect(projected.activeUnitId).toBe('resource:inventory')
      expect(projected.run).toMatchObject({
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
        status: 'running',
        foundationAuditState,
      })

      const pausedRun: DeliveryRun = {
        ...run,
        phase: 'DOCUMENT_DRAFTING',
        documentStep: 'FOUNDATION_DRAFTING',
        status: 'stopped',
        foundationAuditState: undefined,
      }
      await store.save(pausedRun)
      const pausedInspection = await inspectWorkflowSnapshot({
        snapshotPath: join(workspacePath, '.beegame/workflow/run.json'),
        ownerId,
      })
      const pausedProjected = await projectExactResumeRun({
        inspection: pausedInspection,
        events: [
          ...acceptedEvents,
          {
            eventId: 'recovery-cutover-pause',
            runId,
            type: 'foundation.authoring.pause_changed',
            phase: 'DOCUMENT_DRAFTING' as const,
            status: 'stopped' as const,
            revision,
            createdAt: '2026-08-24T00:03:00.000Z',
            foundationAuthoringPause: 'reached',
          },
        ],
        workspacePath,
        ownerId,
        projectId,
        confirmedBriefContext,
      })
      expect(pausedProjected.activeUnitId).toBeUndefined()
      expect(pausedProjected.run).toMatchObject({
        phase: 'DOCUMENT_DRAFTING',
        documentStep: 'FOUNDATION_DRAFTING',
        status: 'stopped',
      })

      const requestedRun: DeliveryRun = {
        ...pausedRun,
        status: 'running',
      }
      await store.save(requestedRun)
      const requestedInspection = await inspectWorkflowSnapshot({
        snapshotPath: join(workspacePath, '.beegame/workflow/run.json'),
        ownerId,
      })
      const requestedProjected = await projectExactResumeRun({
        inspection: requestedInspection,
        events: acceptedEvents,
        workspacePath,
        ownerId,
        projectId,
        confirmedBriefContext,
      })
      expect(requestedProjected.activeUnitId).toBe('foundation-audit:derive')
      expect(requestedProjected.run).toMatchObject({
        phase: 'DOCUMENT_DRAFTING',
        documentStep: 'FOUNDATION_DRAFTING',
        status: 'running',
      })

      const consumedRun: DeliveryRun = {
        ...requestedRun,
      }
      await store.save(consumedRun)
      const consumedInspection = await inspectWorkflowSnapshot({
        snapshotPath: join(workspacePath, '.beegame/workflow/run.json'),
        ownerId,
      })
      const consumedProjected = await projectExactResumeRun({
        inspection: consumedInspection,
        events: [
          ...acceptedEvents,
          {
            eventId: 'recovery-cutover-pause-reached-before-consume',
            runId,
            type: 'foundation.authoring.pause_changed',
            phase: 'DOCUMENT_DRAFTING' as const,
            status: 'stopped' as const,
            revision,
            createdAt: '2026-08-24T00:02:30.000Z',
            foundationAuthoringPause: 'reached',
          },
          {
            eventId: 'recovery-cutover-pause-consumed',
            runId,
            type: 'foundation.authoring.pause_changed',
            phase: 'DOCUMENT_DRAFTING' as const,
            status: 'running' as const,
            revision,
            createdAt: '2026-08-24T00:03:00.000Z',
            foundationAuthoringPause: null,
          },
        ],
        workspacePath,
        ownerId,
        projectId,
        confirmedBriefContext,
      })
      expect(consumedProjected.activeUnitId).toBe('foundation-audit:derive')

      const invalidPauseInspection = await inspectWorkflowSnapshot({
        snapshotPath: join(workspacePath, '.beegame/workflow/run.json'),
        ownerId,
      })
      await expect(
        projectExactResumeRun({
          inspection: invalidPauseInspection,
          events: [
            ...acceptedEvents,
            {
              eventId: 'recovery-cutover-pause-invalid',
              runId,
              type: 'foundation.authoring.pause_changed',
              phase: 'DOCUMENT_DRAFTING' as const,
              status: 'stopped' as const,
              revision,
              createdAt: '2026-08-24T00:03:00.000Z',
              foundationAuthoringPause: 'requested' as never,
            },
          ],
          workspacePath,
          ownerId,
          projectId,
          confirmedBriefContext,
        }),
      ).rejects.toThrow('invalid foundation authoring pause change')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
