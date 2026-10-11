import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { foundationRevisionPathGuard } from './foundationRevisionPathGuard'

let root = ''
const previousWorker = process.env.BEEGAME_WORKFLOW_WORKER_TYPE
const previousStage = process.env.BEEGAME_REVISION_STAGED_PATH

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
  root = ''
  if (previousWorker === undefined) delete process.env.BEEGAME_WORKFLOW_WORKER_TYPE
  else process.env.BEEGAME_WORKFLOW_WORKER_TYPE = previousWorker
  if (previousStage === undefined) delete process.env.BEEGAME_REVISION_STAGED_PATH
  else process.env.BEEGAME_REVISION_STAGED_PATH = previousStage
})

describe('foundation revision native file guard', () => {
  test('denies canonical and other paths even when native permissions auto-allow', async () => {
    root = await mkdtemp('/tmp/foundation-revision-guard-')
    const staged = join(root, 'stage.md')
    await writeFile(staged, 'stage')
    process.env.BEEGAME_WORKFLOW_WORKER_TYPE = 'foundation-document-reviser'
    process.env.BEEGAME_REVISION_STAGED_PATH = staged
    expect(foundationRevisionPathGuard(join(root, 'canonical.md'), 'Read')?.behavior).toBe('deny')
    expect(foundationRevisionPathGuard(join(root, 'other.md'), 'Edit')?.behavior).toBe('deny')
    expect(foundationRevisionPathGuard(staged, 'Read')).toBeUndefined()
  })

  test('fails closed when the staged path is a symlink or missing', async () => {
    root = await mkdtemp('/tmp/foundation-revision-guard-')
    const staged = join(root, 'stage.md')
    await mkdir(join(root, 'outside'))
    await writeFile(join(root, 'outside', 'real.md'), 'outside')
    process.env.BEEGAME_WORKFLOW_WORKER_TYPE = 'foundation-document-reviser'
    process.env.BEEGAME_REVISION_STAGED_PATH = staged
    expect(foundationRevisionPathGuard(staged, 'Read')?.behavior).toBe('deny')
  })
})
