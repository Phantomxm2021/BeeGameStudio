import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ReviewerReviewResult } from '../../stage-modules/foundation-reviewer/public'
import { reviewFixtureDocuments } from '../../stage-modules/foundation-reviewer/private/test-fixtures/review-documents'
import {
  buildSingleReviewResult,
  singleReviewInputDigest,
} from '../../stage-modules/foundation-reviewer/private/single-agent-publication'
import type {
  GameIrHandle,
  GameIrReadyResult,
} from '../../stage-modules/game-ir/public'
import { foundationPublicDigest } from '../../foundation-public-result'
import { acceptedIrInput } from '../game-ir-link'
import { createInitialDeliveryRun, createRunStore } from '../run-store'
import type { DeliveryRun } from '../types'

export const fixtureDigest = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex')

export function acceptedReviewFixture(
  summary = 'Accepted Game IR fixture',
): ReviewerReviewResult {
  const brief = 'Confirmed requirements for the Game IR link fixture.'
  const documents = reviewFixtureDocuments()
  const input = {
    subject: {
      kind: 'initial' as const,
      sourceResultId: 'author-result',
      sourceDocumentRevision: fixtureDigest('published author revision'),
      confirmedBriefDigest: fixtureDigest(brief),
    },
    requirements: {
      status: 'available' as const,
      content: brief,
      digest: fixtureDigest(brief),
    },
    documents,
  }
  const start = {
    protocolVersion: 1 as const,
    ownerId: 'owner',
    projectId: 'project',
    requestId: 'review-request',
    input,
    inputDigest: singleReviewInputDigest({
      ownerId: 'owner',
      projectId: 'project',
      input,
    }),
  }
  return buildSingleReviewResult(start, { summary }) as ReviewerReviewResult
}

export async function createAcceptedIrChecklistFixture() {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), 'accepted-ir-checklist-')),
  )
  const review = acceptedReviewFixture()
  const brief = 'Confirmed requirements for the Game IR link fixture.'
  const authorResultId = 'a'.repeat(64)
  const authorHandleId = randomUUID()
  const authorInputDigest = fixtureDigest('author input')
  const authorResult = {
    protocolVersion: 1 as const,
    producer: 'foundation-authoring' as const,
    kind: 'foundation_documents' as const,
    resultId: authorResultId,
    inputDigest: authorInputDigest,
    ownerId: 'owner',
    projectId: 'project',
    confirmedBriefDigest: fixtureDigest(brief),
    documents: review.documents.map(document => ({
      path: document.path,
      digest: fixtureDigest(document.content),
      byteLength: Buffer.byteLength(document.content, 'utf8'),
      artifactPath: `.beegame/workflow/foundation-authoring/artifacts/${authorResultId}/${document.path}`,
    })),
    documentRevision: fixtureDigest('author revision'),
    workspaceRevision: fixtureDigest('author workspace revision'),
    receiptSetDigest: fixtureDigest('author receipt set'),
  }
  const run: DeliveryRun = {
    ...createInitialDeliveryRun({
      runId: 'run-accepted-ir-checklist',
      ownerId: 'owner',
      projectId: 'project',
      confirmedBriefContext: brief,
      confirmedBriefDigest: fixtureDigest(brief),
      documentRevision: review.documentSetDigest,
    }),
    phase: 'DOCUMENT_REVIEW',
    documentStep: 'FOUNDATION_REVIEW',
    authorStage: {
      protocolVersion: 1,
      requestId: 'author-request',
      inputDigest: authorInputDigest,
      handle: {
        protocolVersion: 1,
        producer: 'foundation-authoring',
        id: authorHandleId,
      },
      status: 'completed',
      result: authorResult,
      control: { sequence: 0, action: 'run', requestId: 'author-request' },
    },
    foundationReviewStage: {
      protocolVersion: 1,
      authorResultId,
      control: { sequence: 0, appliedSequence: 0, action: 'run' },
      invocation: {
        stage: 'reviewer',
        handle: {
          protocolVersion: 1,
          producer: 'foundation-reviewer',
          id: authorHandleId,
        },
        request: {
          protocolVersion: 1,
          ownerId: 'owner',
          projectId: 'project',
          requestId: 'review-request',
          input: {
            subject: {
              kind: 'initial',
              sourceResultId: 'author-result',
              sourceDocumentRevision: fixtureDigest(
                'published author revision',
              ),
              confirmedBriefDigest: fixtureDigest(brief),
            },
            requirements: {
              status: 'available',
              content: brief,
              digest: fixtureDigest(brief),
            },
            documents: review.documents.map(document => ({
              path: document.path,
              content: document.content,
            })),
          },
          inputDigest: review.inputDigest,
        },
        outcome: {
          status: 'completed',
          billingStatus: 'settled',
          handle: {
            protocolVersion: 1,
            producer: 'foundation-reviewer',
            id: authorHandleId,
          },
          result: review,
        },
      },
      acceptedReview: review,
    },
  }
  const store = createRunStore(workspace, run.ownerId)
  await store.commit(run, {
    runId: run.runId,
    type: 'run.created',
    phase: run.phase,
    status: run.status,
    revision: run.revision,
  })
  return { workspace, run, store, review }
}

export function readyReceipt(
  run: DeliveryRun,
  marker = 'fixture',
): GameIrReadyResult {
  const source = acceptedIrInput(run)
  const digest = fixtureDigest
  return {
    schemaVersion: 'game-ir-ready-receipt.v2',
    taskId: 'game-ir-task',
    publicationId: `ir-publication-${marker}`,
    gameIrSchemaVersion: 'game-ir.v2',
    foundationRevision: source.publishedDocumentRevision,
    foundationReceiptDigest: digest(`foundation-receipt-${marker}`),
    candidateDigest: digest(`candidate-${marker}`),
    manifestDigest: digest(`manifest-${marker}`),
    committedPath: `.beegame/ir/game-ir.v2/revisions/${source.publishedDocumentRevision}/COMMITTED.json`,
  }
}

export function completedChecklistRun(
  fixture: Awaited<ReturnType<typeof createAcceptedIrChecklistFixture>>,
  handle: GameIrHandle = {
    protocolVersion: 1,
    producer: 'game-ir',
    id: fixtureDigest('accepted-ir-handle'),
  },
): DeliveryRun {
  const source = acceptedIrInput(fixture.run)
  const ready = readyReceipt(fixture.run)
  return {
    ...fixture.run,
    documentStep: 'CHECKLIST_DRAFTING',
    gameIrStage: {
      protocolVersion: 1,
      requestId: `ir:${fixture.run.runId}:${source.foundationResultId}`,
      inputDigest: foundationPublicDigest(source),
      foundationRevision: source.publishedDocumentRevision,
      foundationResultId: source.foundationResultId,
      handle,
      outcome: {
        status: 'completed',
        handle,
        billingStatus: 'settled',
        result: ready,
      },
      control: { sequence: 0, appliedSequence: 0, action: 'run' },
    },
  }
}

export async function disposeAcceptedIrChecklistFixture(
  fixture: Awaited<ReturnType<typeof createAcceptedIrChecklistFixture>>,
) {
  await rm(fixture.workspace, { recursive: true, force: true })
}
