import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInitialDeliveryRun, createRunStore } from './run-store'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import { assertNoRetiredAuthorHandoff } from './retired-foundation-author'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true })),
  )
})

describe('foundation authoring pause recovery authority', () => {
  test('preserves historical pause evidence without synthesizing consumption on ordinary commits', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'beegame-authoring-pause-'))
    temporaryDirectories.push(workspacePath)
    const confirmedBriefContext = 'pause recovery brief'
    const confirmedBriefDigest = createHash('sha256')
      .update(confirmedBriefContext)
      .digest('hex')
    const run = createInitialDeliveryRun({
      runId: 'pause-recovery-run',
      projectId: 'pause-recovery-project',
      ownerId: 'pause-recovery-owner',
      confirmedBriefContext,
      confirmedBriefDigest,
    })
    const store = createRunStore(workspacePath, run.ownerId)
    const revision = run.revision
    await store.commit(run, {
      runId: run.runId,
      type: 'run.created',
      phase: run.phase,
      status: run.status,
      revision,
      foundationAuthoringPause: 'requested',
    })

    const reached = await store.commit(
      {
        ...run,
        phase: 'DOCUMENT_DRAFTING',
        documentStep: 'FOUNDATION_DRAFTING',
        status: 'stopped',
        foundationDraftState: {
          completedPaths: [...CANONICAL_FOUNDATION_DOCUMENTS],
        },
      },
      {
        runId: run.runId,
        type: 'foundation.authoring.pause_changed',
        phase: 'DOCUMENT_DRAFTING',
        documentStep: 'FOUNDATION_DRAFTING',
        status: 'stopped',
        revision,
        foundationAuthoringPause: 'reached',
      },
    )
    await store.commit(
      {
        ...reached,
        status: 'running',
      },
      {
        runId: run.runId,
        type: 'run.resumed',
        phase: reached.phase,
        documentStep: reached.documentStep,
        status: 'running',
        revision,
      },
    )

    const events = (await readFile(join(workspacePath, '.beegame/workflow/events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as Record<string, unknown>)
      .filter(event => event.type === 'foundation.authoring.pause_changed')
    expect(events.map(event => event.foundationAuthoringPause)).toEqual([
      'reached',
    ])
    expect(() => assertNoRetiredAuthorHandoff(events, run.runId)).toThrow('retired')
    const snapshot = JSON.parse(
      await readFile(join(workspacePath, '.beegame/workflow/run.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(Object.hasOwn(snapshot, 'foundationAuthoringPause')).toBe(false)
  })
})
