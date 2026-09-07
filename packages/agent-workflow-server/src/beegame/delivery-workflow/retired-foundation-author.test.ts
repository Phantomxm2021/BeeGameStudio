import { expect, test } from 'bun:test'
import { assertNoRetiredAuthorRun, assertSharedDocumentWorker, assertNoRetiredAuthorHandoff } from './retired-foundation-author'
import { createDeliveryWorkflowController } from './controller'
import type { WorkerDispatchRequest } from './types'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import { createInitialDeliveryRun, createRunStore } from './run-store'
import { resumeRun, retryRun, stopRun, reconcileRunOnStartup } from './recovery'
import { projectExactResumeRun } from './recovery-projector'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import ts from 'typescript'

test('retired shared Author modules stay absent and cannot return through imports or receipt exports', () => {
  const beegame = join(import.meta.dir, '..')
  const removed = [
    'foundation-markdown-stream', 'foundation-authoring-input', 'foundation-authority-projection',
    ...['state', 'batch', 'recovery', 'scheduler', 'stage', 'boundary', 'context', 'prompt', 'contract', 'delivery-contract']
      .map(name => `delivery-workflow/foundation-authoring-${name}`),
  ]
  for (const path of removed) expect(existsSync(join(beegame, `${path}.ts`))).toBe(false)
  const root = join(beegame, '..')
  const obsoleteImports: string[] = []
  for (const file of readdirSync(root, { recursive: true })) {
    if (typeof file !== 'string' || !file.endsWith('.ts') || file.includes('stage-modules/')) continue
    const ast = ts.createSourceFile(file, readFileSync(join(root, file), 'utf8'), ts.ScriptTarget.Latest, true)
    for (const node of ast.statements) {
      if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || !node.moduleSpecifier ||
          !ts.isStringLiteral(node.moduleSpecifier)) continue
      const specifier = node.moduleSpecifier.text
      if (removed.some(path => specifier.endsWith(`/${path.split('/').at(-1)}`))) obsoleteImports.push(file)
    }
  }
  expect(obsoleteImports).toEqual([])
  const receipt = ts.createSourceFile('receipt.ts', readFileSync(join(beegame, 'authored-document-receipt.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
  const functionNames = receipt.statements.filter(ts.isFunctionDeclaration).map(node => node.name?.text)
  expect(functionNames).not.toContain('commitAuthoredFoundationDocument')
  expect(functionNames).not.toContain('reconcileAuthoredDocumentReceipt')
  for (const file of ['controller.ts', 'run-store.ts', 'recovery-projector.ts']) {
    const source = readFileSync(join(import.meta.dir, file), 'utf8')
    expect(source).not.toContain('readFoundationAuthoringPause')
    expect(source).not.toContain('pauseFoundationAuthoringHandoff')
    expect(source).not.toContain('foundation.authoring.pause_changed')
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    const inspect = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'restartDocumentStage') {
        // The former automatic reset is a denial boundary, never a state writer.
        expect(node.body?.statements).toHaveLength(1)
        expect(ts.isThrowStatement(node.body!.statements[0]!)).toBe(true)
      }
      ts.forEachChild(node, inspect)
    }
    inspect(ast)
  }
})

test('unconsumed old pause markers cannot reconstruct Author or start Reviewer and never mutate evidence', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'retired-author-handoff-'))
  try {
    for (const marker of ['requested', 'reached'] as const) {
      const root = join(workspace, marker)
      const brief = 'historical author handoff'
      const initial = createInitialDeliveryRun({ ownerId: 'owner', projectId: 'project', confirmedBriefContext: brief,
        confirmedBriefDigest: createHash('sha256').update(brief).digest('hex') })
      const run = { ...initial, phase: 'DOCUMENT_REVIEW' as const, documentStep: 'FOUNDATION_REVIEW' as const,
        foundationDraftState: { completedPaths: [...CANONICAL_FOUNDATION_DOCUMENTS] } }
      const store = createRunStore(root, 'owner')
      // Historical bytes cannot be created through the current schema writer.
      await mkdir(join(root, '.beegame/workflow'), { recursive: true })
      await writeFile(store.paths.snapshot, JSON.stringify(run))
      await store.appendEvent({ runId: run.runId, type: 'run.created', phase: run.phase, status: run.status,
        revision: run.revision, foundationAuthoringPause: 'requested' })
      if (marker === 'reached') await store.appendEvent({ runId: run.runId, type: 'foundation.authoring.pause_changed',
        phase: run.phase, status: run.status, revision: run.revision, foundationAuthoringPause: marker })
      const snapshot = await readFile(store.paths.snapshot, 'utf8')
      const events = await readFile(store.paths.events, 'utf8')
      let contacts = 0
      const unused = async (): Promise<never> => { contacts++; throw new Error('unexpected worker contact') }
      const controller = createDeliveryWorkflowController({ workspacePath: root, ownerId: 'owner',
        workerPort: { start: unused, submit: unused, stop: unused, status: unused } })
      for (const operation of [
        () => controller.resume(run),
        () => store.reconcile(unused),
        () => resumeRun({ store, runId: run.runId, workspacePath: root, sessionIsOpen: unused }),
        () => retryRun({ store, runId: run.runId, workspacePath: root, sessionIsOpen: unused }),
        () => stopRun({ store, runId: run.runId, reason: 'stop historical', sessionIsOpen: unused }),
        async () => projectExactResumeRun({ inspection: await store.inspectWorkflowSnapshot(), events: await store.readEvents(),
          workspacePath: root, ownerId: 'owner', projectId: 'project', confirmedBriefContext: brief }),
      ]) {
        await expect(operation()).rejects.toThrow(/retired|unsupported|invalid/)
        expect(await readFile(store.paths.snapshot, 'utf8')).toBe(snapshot)
        expect(await readFile(store.paths.events, 'utf8')).toBe(events)
        expect(contacts).toBe(0)
      }
    }
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

test('retirement recognition preserves consumed historical controls and ordinary downstream events', () => {
  expect(() => assertNoRetiredAuthorHandoff([], 'run')).not.toThrow()
  const requested = { runId: 'run', type: 'run.created', foundationAuthoringPause: 'requested' }
  expect(() => assertNoRetiredAuthorHandoff([requested], 'run')).toThrow('retired')
  expect(() => assertNoRetiredAuthorHandoff([requested,
    { runId: 'run', type: 'foundation.authoring.pause_changed', foundationAuthoringPause: null }], 'run')).not.toThrow()
})

test('all old document cursors reject resume, retry, stop and exact recovery without changing evidence or contacting workers', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'retired-author-matrix-'))
  try {
    for (const [index, path] of CANONICAL_FOUNDATION_DOCUMENTS.entries()) {
      for (const parallel of [false, true]) {
        const root = join(workspace, `${index}-${parallel}`)
        const brief = 'retirement fixture'
        const initial = createInitialDeliveryRun({ ownerId: 'owner', projectId: 'project', confirmedBriefContext: brief,
          confirmedBriefDigest: createHash('sha256').update(brief).digest('hex') })
        const store = createRunStore(root, 'owner')
        await store.save({ ...initial, phase: 'DOCUMENT_DRAFTING', documentStep: 'FOUNDATION_DRAFTING', status: 'stopped',
          foundationDraftState: { completedPaths: [CANONICAL_FOUNDATION_DOCUMENTS[0]],
            ...(parallel ? { documents: CANONICAL_FOUNDATION_DOCUMENTS.map(p => ({ path: p, status: p === path ? 'needs_action' as const : 'pending' as const })) } : {}) } })
        await mkdir(join(root, 'docs'), { recursive: true })
        await writeFile(join(root, path), 'USER DOCUMENT — KEEP')
        await mkdir(join(root, '.beegame/workflow/document-commits'), { recursive: true })
        const receipt = join(root, '.beegame/workflow/document-commits/historical.json')
        await writeFile(receipt, '{"status":"package_prepared","historical":true}')
        const snapshot = await readFile(store.paths.snapshot, 'utf8')
        let contacts = 0
        const sessionIsOpen = async () => { contacts++; return false }
        for (const operation of [
          () => resumeRun({ store, runId: initial.runId, workspacePath: root, sessionIsOpen }),
          () => retryRun({ store, runId: initial.runId, workspacePath: root, taskId: path, sessionIsOpen }),
          () => stopRun({ store, runId: initial.runId, reason: 'old stop', sessionIsOpen, stopDispatch: async () => { contacts++ } }),
          () => reconcileRunOnStartup({ store, sessionIsOpen }),
          async () => projectExactResumeRun({ inspection: await store.inspectWorkflowSnapshot(), events: await store.readEvents(),
            workspacePath: root, ownerId: 'owner', projectId: 'project', confirmedBriefContext: brief }),
        ]) {
          await expect(operation()).rejects.toThrow('retired')
          expect(await readFile(store.paths.snapshot, 'utf8')).toBe(snapshot)
          expect(await store.readEvents()).toEqual([])
          expect(await readFile(join(root, path), 'utf8')).toBe('USER DOCUMENT — KEEP')
          expect(await readFile(receipt, 'utf8')).toBe('{"status":"package_prepared","historical":true}')
        }
        expect(contacts).toBe(0)
      }
    }
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

test('retirement recognizes old execution, not an empty new invocation or public link', () => {
  expect(() => assertNoRetiredAuthorRun({ phase: 'DOCUMENT_DRAFTING', foundationDraftState: { completedPaths: [] } })).not.toThrow()
  expect(() => assertNoRetiredAuthorRun({ phase: 'DOCUMENT_DRAFTING', authorStage: { status: 'running' } })).not.toThrow()
  for (const state of [{ completedPaths: ['docs/GDD.md'] }, { documents: [{ status: 'pending' }] }])
    expect(() => assertNoRetiredAuthorRun({ phase: 'DOCUMENT_DRAFTING', foundationDraftState: state })).toThrow('retired')
  expect(() => assertNoRetiredAuthorRun({ phase: 'DOCUMENT_REVIEW', foundationDraftState: { completedPaths: ['docs/GDD.md'] } })).not.toThrow()
})

test('shared author accepts only explicit Checklist requests, never old initial or parallel execution', () => {
  for (const contract of [{}, { documentSet: 'foundation' }, { authoringMode: 'initial' }, { authoringMode: 'parallel-draft' }]) {
    const request = { workerType: 'document-author', phase: 'DOCUMENT_DRAFTING', contract } as WorkerDispatchRequest
    expect(() => assertSharedDocumentWorker(request)).toThrow('retired')
    expect(() => assertNoRetiredAuthorRun({ activeDispatch: { workerType: 'document-author', request } })).toThrow('retired')
  }
  const request: WorkerDispatchRequest = { runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/tmp', revision: 'revision', workerType: 'document-author', phase: 'DOCUMENT_REVIEW', contract: { documentSet: 'checklist' } }
  expect(() => assertSharedDocumentWorker(request)).not.toThrow()
  expect(() => assertNoRetiredAuthorRun({ activeDispatch: { workerType: 'document-author', request } })).not.toThrow()
})
