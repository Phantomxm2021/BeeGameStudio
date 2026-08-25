import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { foundationRevisionPathGuard } from './foundationRevisionPathGuard'

let root = ''
const previousWorker = process.env.BEEGAME_WORKFLOW_WORKER_TYPE
const previousStage = process.env.BEEGAME_REVISION_STAGED_PATH
const previousWorkspace = process.env.BEEGAME_WORKSPACE_PATH

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  root = ''
  if (previousWorker === undefined) delete process.env.BEEGAME_WORKFLOW_WORKER_TYPE
  else process.env.BEEGAME_WORKFLOW_WORKER_TYPE = previousWorker
  if (previousStage === undefined) delete process.env.BEEGAME_REVISION_STAGED_PATH
  else process.env.BEEGAME_REVISION_STAGED_PATH = previousStage
  if (previousWorkspace === undefined) delete process.env.BEEGAME_WORKSPACE_PATH
  else process.env.BEEGAME_WORKSPACE_PATH = previousWorkspace
})

describe('foundation revision native file guard', () => {
  test('leaves normal workers unchanged and rejects missing or relative authority', () => {
    root = mkdtempSync('/tmp/foundation-revision-guard-')
    const staged = join(root, 'stage.md')
    writeFileSync(staged, 'stage')
    expect(foundationRevisionPathGuard(staged, 'Read')).toBeUndefined()
    process.env.BEEGAME_WORKFLOW_WORKER_TYPE = 'foundation-document-reviser'
    delete process.env.BEEGAME_REVISION_STAGED_PATH
    expect(foundationRevisionPathGuard(staged, 'Read')?.errorCode).toBe(90)
    process.env.BEEGAME_REVISION_STAGED_PATH = 'relative/stage.md'
    expect(foundationRevisionPathGuard(staged, 'Edit')?.errorCode).toBe(90)
    process.env.BEEGAME_REVISION_STAGED_PATH = staged
    delete process.env.BEEGAME_WORKSPACE_PATH
    expect(foundationRevisionPathGuard(staged, 'Read')?.errorCode).toBe(90)
    process.env.BEEGAME_WORKSPACE_PATH = 'relative/workspace'
    expect(foundationRevisionPathGuard(staged, 'Read')?.errorCode).toBe(90)
    process.env.BEEGAME_WORKSPACE_PATH = root
    expect(foundationRevisionPathGuard('stage.md', 'Read')?.errorCode).toBe(91)
  })

  test('denies wrong paths and accepts the one existing regular staged file', () => {
    root = mkdtempSync('/tmp/foundation-revision-guard-')
    const staged = join(root, 'stage.md')
    writeFileSync(staged, 'stage')
    process.env.BEEGAME_WORKFLOW_WORKER_TYPE = 'foundation-document-reviser'
    process.env.BEEGAME_WORKSPACE_PATH = root
    process.env.BEEGAME_REVISION_STAGED_PATH = staged
    expect(foundationRevisionPathGuard(join(root, 'canonical.md'), 'Read')?.behavior).toBe('deny')
    expect(foundationRevisionPathGuard(join(root, 'other.md'), 'Edit')?.behavior).toBe('deny')
    expect(foundationRevisionPathGuard(staged, 'Read')).toBeUndefined()
  })

  test('denies missing and symlink staged targets', () => {
    root = mkdtempSync('/tmp/foundation-revision-guard-')
    const staged = join(root, 'stage.md')
    process.env.BEEGAME_WORKFLOW_WORKER_TYPE = 'foundation-document-reviser'
    process.env.BEEGAME_WORKSPACE_PATH = root
    process.env.BEEGAME_REVISION_STAGED_PATH = staged
    expect(foundationRevisionPathGuard(staged, 'Read')?.behavior).toBe('deny')
    const real = join(root, 'outside.md')
    writeFileSync(real, 'outside')
    symlinkSync(real, staged)
    expect(foundationRevisionPathGuard(staged, 'Edit')?.behavior).toBe('deny')
  })

  test('denies a regular staged file reached through a symlinked parent', () => {
    root = mkdtempSync('/tmp/foundation-revision-guard-')
    const outside = join(root, 'outside')
    mkdirSync(outside)
    const escaped = join(outside, 'stage.md')
    writeFileSync(escaped, 'outside')
    const linked = join(root, 'linked')
    symlinkSync(outside, linked)
    process.env.BEEGAME_WORKFLOW_WORKER_TYPE = 'foundation-document-reviser'
    process.env.BEEGAME_WORKSPACE_PATH = root
    process.env.BEEGAME_REVISION_STAGED_PATH = join(linked, 'stage.md')
    expect(foundationRevisionPathGuard(join(linked, 'stage.md'), 'Read')?.errorCode).toBe(92)
  })
})
