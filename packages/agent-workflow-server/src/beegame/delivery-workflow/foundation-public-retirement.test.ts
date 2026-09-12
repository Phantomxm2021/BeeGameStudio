import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createInitialDeliveryRun, createRunStore } from './run-store'
import { createDeliveryWorkflowController } from './controller'
import { CANONICAL_FOUNDATION_DOCUMENTS, type DeliveryRun } from './types'
import { transitionDeliveryRun } from './transition'
test('unsupported historical review is rejected without rewriting it or contacting workers', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'foundation-retirement-')))
  const store = createRunStore(workspacePath, 'owner')
  const run: DeliveryRun = { ...createInitialDeliveryRun({ ownerId: 'owner', projectId: 'history', confirmedBriefContext: 'history', confirmedBriefDigest: createHash('sha256').update('history').digest('hex') }),
    phase: 'DOCUMENT_REVIEW', documentStep: 'FOUNDATION_REVIEW', foundationDraftState: { completedPaths: [...CANONICAL_FOUNDATION_DOCUMENTS] } }
  await mkdir(join(workspacePath, '.beegame/workflow'), { recursive: true })
  await writeFile(join(workspacePath, '.beegame/workflow/run.json'), JSON.stringify(run))
  const before = await readFile(join(workspacePath, '.beegame/workflow/run.json'), 'utf8')
  const controller = createDeliveryWorkflowController({ workspacePath, ownerId: run.ownerId, workerPort: {} as never })
  try {
    const inspection = await store.inspectWorkflowSnapshot()
    expect(inspection.currentRun).toBeUndefined()
    expect(inspection.rawText).toBe(before)
    await expect(store.load()).rejects.toThrow(/unsupported|invalid/)
    await expect(controller.resume(run)).rejects.toThrow(/unsupported|invalid/)
    await expect(controller.ensureProgress(run)).rejects.toThrow(/unsupported|invalid/)
    let workerContacts = 0
    await expect(store.reconcile(async () => { workerContacts++; return true })).rejects.toThrow(/unsupported|invalid/)
    expect(workerContacts).toBe(0)
    expect(() => transitionDeliveryRun({ ...run, status: 'needs_action' }, { type: 'retry' })).toThrow('unsupported')
    for (const workerType of ['foundation-fact-extractor', 'foundation-semantic-reviewer', 'foundation-document-reviser']) {
      expect(() => controller.dispatcher.dispatch({ workerType } as never)).toThrow('retired')
      await expect(controller.dispatcher.replayTerminal({ workerType } as never)).rejects.toThrow('retired')
    }
    expect(await readFile(join(workspacePath, '.beegame/workflow/run.json'), 'utf8')).toBe(before)
  } finally {
    try {
      // Shutdown reads the same unsupported snapshot and must also fail closed.
      await expect(controller.dispose()).rejects.toThrow(/unsupported|invalid/)
      expect(await readFile(join(workspacePath, '.beegame/workflow/run.json'), 'utf8')).toBe(before)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  }
})

test('production orchestration no longer imports old reviewer or revision execution helpers', async () => {
  for (const path of ['controller.ts', 'dispatch.ts', 'transition.ts']) {
    const text = await readFile(join(import.meta.dir, path), 'utf8')
    expect(text).not.toMatch(/from ['"].*(?:stages\/foundation-review|foundation-review-boundary|foundation-revision-stage|foundation-revision-publication|foundation-fact-runtime)['"]/)
    expect(text).not.toContain('mutateFoundationReviewTask(')
    expect(text).not.toContain('materializeFoundationRevisionPlanning(')
  }
})
