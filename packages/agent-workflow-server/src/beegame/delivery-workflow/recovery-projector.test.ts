import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import { inspectWorkflowSnapshot } from './run-store'
import { projectExactResumeRun } from './recovery-projector'

test('legacy foundation review state is rejected before projection or mutation', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-recovery-retired-'))
  try {
    const run = createTestDeliveryRun({
      runId: 'retired-review-run',
      projectId: 'retired-review-project',
      ownerId: 'retired-review-owner',
      confirmedBriefContext: 'retired review brief',
    })
    const raw = JSON.stringify({
      ...run,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      foundationAuditState: { status: 'facts_staged', tasks: [] },
    })
    const snapshotPath = join(workspacePath, '.beegame/workflow/run.json')
    await mkdir(join(workspacePath, '.beegame/workflow'), { recursive: true })
    await writeFile(snapshotPath, raw)
    const inspection = await inspectWorkflowSnapshot({ snapshotPath, ownerId: run.ownerId })

    await expect(projectExactResumeRun({
      inspection,
      events: [],
      workspacePath,
      ownerId: run.ownerId,
      projectId: run.projectId,
      confirmedBriefContext: run.confirmedBriefContext,
    })).rejects.toThrow('retired')
    expect(await readFile(snapshotPath, 'utf8')).toBe(raw)
  } finally {
    await rm(workspacePath, { recursive: true, force: true })
  }
})
