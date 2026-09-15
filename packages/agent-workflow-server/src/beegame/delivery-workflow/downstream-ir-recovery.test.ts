import { expect, test } from 'bun:test'
import { readFile, writeFile } from 'node:fs/promises'
import { recoverAndResumeRun } from './recovery'
import { completedChecklistRun, createAcceptedIrChecklistFixture, disposeAcceptedIrChecklistFixture } from './test-fixtures/accepted-ir-checklist'

test('invalid public IR snapshot is not rebuilt by the historical projector without its version binding', async () => {
  const f = await createAcceptedIrChecklistFixture()
  try {
    const invalid = { ...completedChecklistRun(f), phase: 'RESOURCE_PREPARATION', documentStep: undefined,
      status: 'invalid-status', resourceProductionState: { currentTask: 'RESOURCE_DELIVERED', irResultId: 'a'.repeat(64) } }
    const original = JSON.stringify(invalid)
    await writeFile(f.store.paths.snapshot, original)
    let stopped = false, resumed = false
    await expect(recoverAndResumeRun({ store: f.store, workspacePath: f.workspace,
      ownerId: f.run.ownerId, projectId: f.run.projectId, confirmedBriefContext: f.run.confirmedBriefContext!,
      async stopWorkspaceWorkers() { stopped = true }, async resumeCurrentRun() { resumed = true },
    })).rejects.toThrow('Public IR workflow snapshot is invalid')
    expect(stopped).toBe(true)
    expect(resumed).toBe(false)
    expect(await readFile(f.store.paths.snapshot, 'utf8')).toBe(original)
  } finally { await disposeAcceptedIrChecklistFixture(f) }
})
