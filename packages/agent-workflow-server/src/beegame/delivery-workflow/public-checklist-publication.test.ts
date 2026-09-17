import { expect, test } from 'bun:test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  GameIrOperations,
  GameIrPublishedView,
} from '../stage-modules/game-ir/public'
import { foundationPublicDigest } from '../foundation-public-result'
import { acceptedIrInput } from './game-ir-link'
import { createDeliveryDispatcher } from './dispatch'
import {
  createAcceptedIrChecklistFixture,
  completedChecklistRun,
  disposeAcceptedIrChecklistFixture,
  fixtureDigest,
  readyReceipt,
} from './test-fixtures/accepted-ir-checklist'
import {
  completeDocumentDraft,
  startChecklistDraftStage,
} from './document-stage'
import { computeDocumentRevision, computeWorkspaceRevision } from './revision'
import type { DeliveryRun, DeliveryWorkerPort } from './types'

function workerPort(): DeliveryWorkerPort {
  return {
    async start(request) {
      return {
        sessionId: `session:${request.dispatchId}`,
        dispatchId: request.dispatchId!,
      }
    },
    async submit() {},
    async stop() {},
    async status(dispatchId) {
      return {
        dispatchId,
        workerType: 'document-author',
        phase: 'DOCUMENT_REVIEW',
        revision: fixtureDigest('unused'),
        status: 'interrupted',
        startedAt: new Date(0).toISOString(),
      }
    },
  }
}

function publicIr(
  run: DeliveryRun,
  replacementReady = false,
): GameIrOperations {
  const source = acceptedIrInput(run)
  const completedOutcome = run.gameIrStage?.outcome
  if (!completedOutcome || completedOutcome.status !== 'completed')
    throw new Error('publication fixture requires a completed IR outcome')
  const ready = replacementReady
    ? readyReceipt(run, 'replacement')
    : completedOutcome.result
  const candidate = {
    schemaVersion: 'game-ir.v2' as const,
    taskId: 'game-ir-task',
    sourceRevision: source.publishedDocumentRevision,
    parameters: {}, assets: [],
    scenes: [{ id: 'scene.main', name: 'Main', assetIds: [], config: {} }],
    ui: [], vfx: [], logic: {},
  }
  const view: GameIrPublishedView = { input: source, ready, candidate }
  return {
    async revise() { throw new Error('not used') },
    async start() {
      return run.gameIrStage!.handle!
    },
    async getResult() {
      return run.gameIrStage!.outcome!
    },
    async resume() {
      return run.gameIrStage!.outcome!
    },
    async stop() {
      return {
        status: 'stopped',
        handle: run.gameIrStage!.handle!,
        billingStatus: 'pending',
      }
    },
    async readResult() {
      return structuredClone(view)
    },
  }
}

async function writeFoundationDocuments(
  fixture: Awaited<ReturnType<typeof createAcceptedIrChecklistFixture>>,
) {
  await Promise.all(
    fixture.review.documents.map(async document => {
      const path = join(fixture.workspace, document.path)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, document.content)
    }),
  )
}

async function persistChecklistRun(
  fixture: Awaited<ReturnType<typeof createAcceptedIrChecklistFixture>>,
) {
  const run = completedChecklistRun(fixture)
  await fixture.store.commit(run, {
    runId: run.runId,
    type: 'fixture.checklist-ready',
    phase: run.phase,
    status: run.status,
    revision: run.revision,
  })
  return run
}

test('publishes the Checklist candidate and enters Resource Preparation with a new revision', async () => {
  const fixture = await createAcceptedIrChecklistFixture()
  try {
    await writeFoundationDocuments(fixture)
    const run = await persistChecklistRun(fixture)
    const ir = publicIr(run)
    const dispatcher = createDeliveryDispatcher({
      store: fixture.store,
      workerPort: workerPort(),
    })
    await startChecklistDraftStage({
      run,
      workspacePath: fixture.workspace,
      dispatcher,
      ir,
    })
    const active = (await fixture.store.load())!
    const candidatePath = active.activeDispatch!.request!.contract
      .checklistCandidatePath as string
    const candidate =
      '- [ ] SCN-01 [docs/GDD.md#core_loop] Observe the published core loop with runtime evidence.\n'
    await mkdir(dirname(join(fixture.workspace, candidatePath)), {
      recursive: true,
    })
    await writeFile(join(fixture.workspace, candidatePath), candidate)

    const completed = await completeDocumentDraft({
      run: active,
      workspacePath: fixture.workspace,
      terminal: {
        workerType: 'document-author',
        status: 'completed',
        writtenPaths: [candidatePath],
      },
      documentSet: 'checklist',
      ir,
      audit: () => ({ valid: true, issues: [] }),
    })
    expect(completed.phase).toBe('RESOURCE_PREPARATION')
    expect(completed.documentStep).toBeUndefined()
    expect(completed.resourceProductionState.currentTask).toBe('RESOURCE_DELIVERY')
    expect(completed.activeDispatch).toBeUndefined()
    expect(completed.revision.document).toBe(
      await computeDocumentRevision(
        fixture.workspace,
        run.confirmedBriefDigest,
      ),
    )
    expect(completed.revision.workspace).toBe(
      await computeWorkspaceRevision(fixture.workspace),
    )
    expect(
      await readFile(
        join(fixture.workspace, 'docs/acceptance/gameplay-checklist.md'),
        'utf8',
      ),
    ).toBe(candidate)
    expect(foundationPublicDigest(completed.gameIrStage)).toBe(
      foundationPublicDigest(run.gameIrStage),
    )
  } finally {
    await disposeAcceptedIrChecklistFixture(fixture)
  }
})

test('rejects Foundation source drift and a replaced public IR result without overwriting canonical Checklist', async () => {
  for (const replacementReady of [false, true]) {
    const fixture = await createAcceptedIrChecklistFixture()
    try {
      await writeFoundationDocuments(fixture)
      const run = await persistChecklistRun(fixture)
      const canonicalPath = join(
        fixture.workspace,
        'docs/acceptance/gameplay-checklist.md',
      )
      await mkdir(dirname(canonicalPath), { recursive: true })
      await writeFile(canonicalPath, 'existing canonical checklist\n')
      const ir = publicIr(run)
      const dispatcher = createDeliveryDispatcher({
        store: fixture.store,
        workerPort: workerPort(),
      })
      await startChecklistDraftStage({
        run,
        workspacePath: fixture.workspace,
        dispatcher,
        ir,
      })
      const active = (await fixture.store.load())!
      const candidatePath = active.activeDispatch!.request!.contract
        .checklistCandidatePath as string
      await mkdir(dirname(join(fixture.workspace, candidatePath)), {
        recursive: true,
      })
      await writeFile(
        join(fixture.workspace, candidatePath),
        '- [ ] SCN-01 [docs/GDD.md#core_loop] Observe the published core loop with runtime evidence.\n',
      )
      if (replacementReady) {
        await expect(
          completeDocumentDraft({
            run: active,
            workspacePath: fixture.workspace,
            terminal: {
              workerType: 'document-author',
              status: 'completed',
              writtenPaths: [candidatePath],
            },
            documentSet: 'checklist',
            ir: publicIr(run, true),
            audit: () => ({ valid: true, issues: [] }),
          }),
        ).rejects.toThrow('Checklist IR public result binding changed')
      } else {
        await writeFile(
          join(fixture.workspace, 'docs/GDD.md'),
          'tampered accepted source\n',
        )
        await expect(
          completeDocumentDraft({
            run: active,
            workspacePath: fixture.workspace,
            terminal: {
              workerType: 'document-author',
              status: 'completed',
              writtenPaths: [candidatePath],
            },
            documentSet: 'checklist',
            ir,
            audit: () => ({ valid: true, issues: [] }),
          }),
        ).rejects.toThrow(
          'Accepted Foundation document changed before Checklist publication',
        )
      }
      expect(await readFile(canonicalPath, 'utf8')).toBe(
        'existing canonical checklist\n',
      )
    } finally {
      await disposeAcceptedIrChecklistFixture(fixture)
    }
  }
})
