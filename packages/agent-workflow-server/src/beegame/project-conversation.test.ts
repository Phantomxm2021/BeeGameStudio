import { expect, test } from 'bun:test'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BeeGameSessionManager, type BeeGameSessionRunnerStartInput } from './session-manager'
import { sendProjectConversation, isProjectConversation } from './project-conversation'
import { createNativeCliProcessRunner } from './native-cli-process-runner'
import { fileURLToPath } from 'node:url'
import { advanceProjectDeliveryAfterTurn, beginProjectDelivery, prepareProjectDesignReview, PROJECT_DOCUMENTS, projectDeliveryStatePath, readProjectDelivery, requestProjectDesignResolution } from './project-delivery'
import { designBaselineFixture, designDocumentFixture, designHandoffFixture, uiLayoutFixture, writeDesignDocumentsFixture, writeDesignDocumentFixture } from './fixtures/layout-fixture'
import { AUTHOR_BATCHES } from './project-author'
import type { DesignReviewResult } from './design-handoff'

async function idle(manager: BeeGameSessionManager, id: string) {
  for (let i = 0; i < 500 && manager.get(id)?.turnStatus !== 'idle'; i++)
    await Bun.sleep(5)
  expect(manager.get(id)?.turnStatus).toBe('idle')
}

async function completeMilestone(workspace: string, prompt: unknown) {
  const path = JSON.stringify(prompt).match(/\.beegame\/tmp\/[^\s]+\/milestone-[\w-]+\.txt/)?.[0]
  if (path) await writeFile(join(workspace, path), 'complete\n' + (JSON.stringify(prompt).includes('milestone: review.')
    ? JSON.stringify({ step: 'inspect', findings: [], resolved: [] }) : ''))
}

test('host routes cross-layer clearance to scoped UI revision despite an empty semantic receipt, then versions the actual repair', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-layer-revision-')), workspace = join(root, 'project')
  const steps: string[] = []
  const overlay = uiLayoutFixture() as any
  overlay.id = 'expanded'
  overlay.data.nodes[0].data.layoutUnderlay = { path: 'content/ui/menu.json', clearance: 'preserve' }
  overlay.data.nodes[1].data = { layoutOcclusion: 'occluder' }
  const manager = new BeeGameSessionManager({ async start() { return { stop() {}, async submit(turn) {
    const step = turn.projectTurn!.reviewStep!
    steps.push(step)
    if (step === 'revise') {
      expect(turn.projectTurn!.reviewDocuments).toEqual(['UI_UX_SPEC.md'])
      expect(turn.projectTurn!.reviewWritableFiles).toContain('content/ui/expanded.json')
      const task = await readFile(turn.projectTurn!.reviewContextPath!, 'utf8')
      expect(task).toContain('intersects preserved content/ui/menu.json#reserved')
      // Native-role stand-in edits only a synthetic authorized source.
      overlay.data.nodes[1].layout.position = [0, 100]
      await writeFile(join(workspace, 'content/ui/expanded.json'), JSON.stringify(overlay))
    }
    await writeFile(turn.projectTurn!.reviewResultPath!, 'complete\n' + JSON.stringify({ step, findings: [], resolved: [] }))
    await turn.onMessage({ type: 'result', subtype: 'success', result: 'Synthetic bounded step' })
  } } } }, root)
  try {
    await mkdir(workspace)
    const state = await beginProjectDelivery(workspace, root, 'Synthetic composition regression')
    await writeDesignDocumentsFixture(workspace)
    const base = uiLayoutFixture() as any
    base.data.nodes.push({ id: 'reserved', role: 'container', parentId: 'root', data: { layoutOcclusion: 'protected' },
      layout: { anchor: 'middle-center', size: [100, 100] } })
    await writeFile(join(workspace, 'content/ui/menu.json'), JSON.stringify(base))
    await writeFile(join(workspace, 'content/ui/expanded.json'), JSON.stringify(overlay))
    await writeDesignDocumentFixture(workspace, 'UI_UX_SPEC.md', designHandoffFixture('UI_UX_SPEC.md'),
      designDocumentFixture('UI_UX_SPEC.md') + '\nPreserve the reserved region in the expanded state.\n[Expanded](../content/ui/expanded.json)\n')
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, phase: 'review', authorBatch: AUTHOR_BATCHES.length - 1 }))
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    for (const step of ['inspect', 'revise', 'verify']) {
      await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id,
        ownerId: 'owner', message: 'Synthetic ' + step, autoContinuation: true })
      await manager.waitForSessionIdle(session.id)
      expect(manager.transcript(session.id).filter(event => event.type === 'turn.failed')).toEqual([])
    }
    expect(steps).toEqual(['inspect', 'revise', 'verify'])
    const released = (await readProjectDelivery(workspace, root))!
    expect(released.phase).toBe('resources')
    expect(released.designBaseline!.documentVersions!['UI_UX_SPEC.md']).toBe('1.1')
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test.each([
  ['output-pointer', true], ['missing-calculation', true],
  ['output-pointer', false], ['missing-calculation', false],
] as const)('deterministic %s draft failure dispatches one exact revision despite empty model findings; repair=%s', async (fault, repair) => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-deterministic-dispatch-')), workspace = join(root, 'project')
  const steps: DesignReviewResult['step'][] = []
  const manager = new BeeGameSessionManager({ async start() {
    return { stop() {}, async submit(turn) {
      const step = turn.projectTurn!.reviewStep!
      steps.push(step)
      const task = await readFile(turn.projectTurn!.reviewContextPath!, 'utf8')
      expect(turn.projectTurn!.reviewReceiptContext!.findings).toEqual([])
      if (step === 'inspect') {
        expect(task).toContain('Host deterministic check status (not a semantic verdict)')
        expect(task).toContain('Failure details go directly to the existing revision step')
        expect(task).not.toContain('Host deterministic check result (not a semantic verdict)')
        expect(task).not.toContain(fault === 'output-pointer'
          ? 'BALANCE_DESIGN.md: output ready references an absent section' : 'docs/calc/missing.json')
        // The actual draft/sidecar remain readable: this separates host
        // diagnostics, not the authored source or its semantic problems.
        expect(task).toContain('docs/BALANCE_DESIGN.md; handoff: .beegame/design-handoffs/BALANCE_DESIGN.json')
      }
      if (step === 'revise') {
        expect(turn.projectTurn!.reviewDocuments).toEqual(['BALANCE_DESIGN.md'])
        expect(turn.projectTurn!.reviewWritableDocuments).toEqual(['BALANCE_DESIGN.md'])
        expect(turn.projectTurn!.reviewWritableFiles).toEqual(['.beegame/design-handoffs/BALANCE_DESIGN.json'])
        expect(task).toContain('Correct the supplied deterministic failures')
        expect(task).toContain('even if recorded findings are empty or labelled follow-up')
        expect(task).toContain('host records saved versions and evidence hashes')
        const authorizedLine = task.split('\n').find(line => line.startsWith('Authorized revision files (exact paths, not directory grants): '))!
        expect(JSON.parse(authorizedLine.slice(authorizedLine.indexOf(': ') + 2))).toEqual([
          'docs/BALANCE_DESIGN.md', '.beegame/design-handoffs/BALANCE_DESIGN.json',
        ])
        expect(task).toContain(fault === 'output-pointer' ? 'output ready references an absent section' : 'missing.json')
        // Synthetic native agent stand-in repairs only its authorized fixture,
        // retaining no unsupported calculation claim or dangling citation.
        if (repair) await writeDesignDocumentFixture(workspace, 'BALANCE_DESIGN.md', {
          ...designHandoffFixture('BALANCE_DESIGN.md'), documentVersion: '1.1',
        })
      } else {
        expect(turn.projectTurn!.reviewWritableDocuments).toEqual([])
        expect(turn.projectTurn!.reviewWritableFiles).toEqual([])
      }
      await writeFile(turn.projectTurn!.reviewResultPath!, 'complete\n' + JSON.stringify({ step, findings: [], resolved: [] }))
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Synthetic step executed' })
    } }
  } }, root)
  try {
    await mkdir(workspace)
    const state = await beginProjectDelivery(workspace, root, 'Synthetic dispatch regression, not gameplay acceptance')
    await writeDesignDocumentsFixture(workspace)
    const handoff = designHandoffFixture('BALANCE_DESIGN.md')
    await writeDesignDocumentFixture(workspace, 'BALANCE_DESIGN.md', fault === 'output-pointer' ? {
      ...handoff, outputs: [{ id: 'ready', section: 'Missing section' }],
    } : handoff, designDocumentFixture('BALANCE_DESIGN.md') + (fault === 'missing-calculation' ? '\n[Missing calculation](calc/missing.json)\n' : ''))
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, phase: 'review', authorBatch: AUTHOR_BATCHES.length - 1 }))
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    const expectedSteps: DesignReviewResult['step'][] = repair ? ['inspect', 'revise', 'verify'] : ['inspect', 'revise']
    for (const step of expectedSteps) {
      await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id,
        ownerId: 'owner', message: 'Execute ' + step, autoContinuation: true })
      await manager.waitForSessionIdle(session.id)
      expect(manager.transcript(session.id).filter(event => event.type === 'turn.failed')).toEqual([])
    }
    expect(steps).toEqual(expectedSteps)
    const released = (await readProjectDelivery(workspace, root))!
    if (repair) {
      expect(released).toMatchObject({ phase: 'resources', authorBatch: AUTHOR_BATCHES.length - 1 })
      expect(released.designBaseline!.documentVersions!['BALANCE_DESIGN.md']).toBe('1.1')
    } else {
      expect(released).toMatchObject({ phase: 'review', authorBatch: AUTHOR_BATCHES.length - 1, designReview: { step: 'revise', stopped: true } })
      expect(released.designBaseline).toBeUndefined()
      expect(released.lastValidationFailure).toContain('still fails')
      expect(released.lastValidationFailure).toContain(fault === 'output-pointer' ? 'output ready references an absent section' : 'calc/missing.json')
    }
    expect(released.designHistory!.map(x => x.step)).toEqual(steps)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test.each([false, true])('review without a conclusion cannot silently relaunch, automatic=%s', async autoContinuation => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-bounded-review-')), workspace = join(root, 'project')
  let submissions = 0
  let observedProgress: { phase: string; shouldContinue: boolean; issues: string[] } | undefined
  const manager = new BeeGameSessionManager({ async start() {
    return { stop() {}, async submit(turn) {
      submissions++
      // Native execution can end at its effort ceiling. No milestone receipt
      // has been produced; a successful chat bookend does not certify review.
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Execution ended without a review conclusion' })
    } }
  } }, root)
  try {
    await mkdir(join(workspace, 'docs'), { recursive: true })
    await writeDesignDocumentsFixture(workspace)
    const state = await beginProjectDelivery(workspace, root, 'Fixture game')
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, phase: 'review', authorBatch: AUTHOR_BATCHES.length - 1 }))
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id,
      ownerId: 'owner', message: 'Run review', autoContinuation,
      afterTurnSettled: progress => { observedProgress = progress } })
    await idle(manager, session.id)
    expect(submissions).toBe(1)
    expect(observedProgress).toMatchObject({ phase: 'review', shouldContinue: false })
    if (autoContinuation) expect(observedProgress?.issues.join(' ')).toContain('valid version-bound result')
    else expect(observedProgress?.issues).toEqual([])
    expect(await readProjectDelivery(workspace, root)).toMatchObject({ phase: 'review', authorBatch: AUTHOR_BATCHES.length - 1 })
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('joint inspection receives all eight saved drafts and original requirements', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-joint-review-context-')), workspace = join(root, 'project')
  let observed = false
  const manager = new BeeGameSessionManager({ async start() {
    return { stop() {}, async submit(turn) {
      expect(turn.directionAuthors).toBeUndefined()
      expect(turn.projectTurn?.reviewDocuments).toEqual([...PROJECT_DOCUMENTS])
      expect(turn.projectTurn?.reviewWritableDocuments).toEqual([])
      expect(turn.projectTurn?.reviewWritableFiles).toEqual([])
      expect(Object.keys(turn.projectTurn!.reviewReceiptContext!.sourceHeadings).sort()).toEqual([...PROJECT_DOCUMENTS].sort())
      const task = await readFile(turn.projectTurn!.reviewContextPath!, 'utf8')
      for (const name of PROJECT_DOCUMENTS) expect(task).toContain('docs/' + name + '; handoff:')
      expect(task).toContain('Host deterministic check status')
      const pointers = JSON.parse(task.split('# Current saved handoff pointers (not a semantic verdict)\n\n')[1]!.split('\n\n')[1]!)
      expect(pointers.map((p: any) => p.document).sort()).toEqual([...PROJECT_DOCUMENTS].sort())
      expect(pointers.find((p: any) => p.document === 'GDD.md').outputs[0].acceptance).toEqual({ section: 'Design', method: 'test' })
      expect(pointers.every((p: any) => p.documentVersion === undefined && p.sha256 === undefined)).toBe(true)
      expect(task).toContain('Fixture game')
      expect(task).toContain('ORIGINAL_CONFIRMED_CONTEXT')
      expect(task).toContain('Document ownership follows the original author responsibilities')
      expect(task).toContain('after all eight design documents are saved')
      expect(task).toContain('UI begins linked ui-screen/ui-hud files directly in content/ui')
      expect(task).toContain('--review-layouts')
      expect(task).toContain('--author-batch 5')
      await completeMilestone(workspace, turn.prompt)
      observed = true
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Joint inspection complete' })
    } }
  } }, root)
  try {
    await mkdir(workspace)
    const state = await beginProjectDelivery(workspace, root, 'Fixture game')
    await writeDesignDocumentsFixture(workspace)
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, phase: 'review', authorBatch: AUTHOR_BATCHES.length - 1 }))
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    manager.appendUserMessage(session.id, 'Fixture game', { displayKind: 'confirmed_brief', confirmedBriefContext: 'ORIGINAL_CONFIRMED_CONTEXT' })
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id,
      ownerId: 'owner', message: 'Inspect saved design', autoContinuation: true })
    await manager.waitForSessionIdle(session.id)
    expect(manager.transcript(session.id).filter(event => event.type === 'turn.failed')).toEqual([])
    expect(observed).toBe(true)
    const released = (await readProjectDelivery(workspace, root))!
    expect(released.phase).toBe('resources')
    expect(Object.keys(released.designBaseline!.snapshots)).toHaveLength(8)
    expect(released.designHistory?.map(item => item.step)).toEqual(['inspect'])
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('explicit legacy inspection dispatches all eight documents, not just the last author batch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-legacy-design-scope-')), workspace = join(root, 'project')
  let observed = false
  const manager = new BeeGameSessionManager({ async start() {
    return { stop() {}, async submit(turn) {
      expect(turn.projectTurn?.reviewDocuments).toHaveLength(8)
      expect(turn.projectTurn?.reviewDocuments).toEqual(expect.arrayContaining([...PROJECT_DOCUMENTS]))
      expect(turn.projectTurn?.reviewWritableDocuments).toEqual([])
      const task = await readFile(turn.projectTurn!.reviewContextPath!, 'utf8')
      for (const document of PROJECT_DOCUMENTS) expect(task).toContain(document)
      observed = true
      await completeMilestone(workspace, turn.prompt)
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Initial inspection executed' })
    } }
  } }, root)
  try {
    await mkdir(workspace)
    const state = await beginProjectDelivery(workspace, root, 'Fixture game')
    await writeDesignDocumentsFixture(workspace)
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, phase: 'implementation' }))
    await requestProjectDesignResolution(workspace, root, { mode: 'inspect', instruction: 'Establish the initial baseline from all eight delivered documents.', findings: [] })
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id,
      ownerId: 'owner', message: 'Inspect migrated design', autoContinuation: true })
    await manager.waitForSessionIdle(session.id)
    expect(observed).toBe(true)
    expect(manager.transcript(session.id).filter(event => event.type === 'turn.failed')).toEqual([])
    expect((await readProjectDelivery(workspace, root))?.phase).toBe('resources')
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('stopping an accepted turn cannot advance delivery using the previous completed turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-stopped-author-turn-'))
  const workspace = join(root, 'project')
  let release!: () => void
  let entered!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { entered = resolve })
  let turns = 0
  let handoffs = 0
  const manager = new BeeGameSessionManager({ async start() {
    return { stop() { release() }, async submit(turn) {
      if (++turns === 1) {
        await turn.onMessage({ type: 'result', subtype: 'success', result: 'Prior turn done' })
      } else {
        // Even a written milestone cannot substitute for this turn's completion.
        await completeMilestone(workspace, turn.prompt)
        entered()
        await blocked
      }
    } }
  } }, root)
  try {
    await mkdir(join(workspace, 'docs'), { recursive: true })
    await writeFile(join(workspace, 'docs/GDD.md'), '# Fixture design')
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    await manager.send(session.id, 'Prior request')
    await manager.waitForSessionIdle(session.id)
    await beginProjectDelivery(workspace, root, 'Fixture delivery')
    const before = await readFile(projectDeliveryStatePath(workspace, root), 'utf8')
    await sendProjectConversation({ sessions: manager, sessionId: session.id, ownerId: 'owner',
      deliveryDataRoot: root, message: 'Write current batch', autoContinuation: true,
      afterTurnSettled: async () => { handoffs++ },
    })
    await started
    manager.stop(session.id)
    await manager.waitForSessionIdle(session.id)
    expect(await readFile(projectDeliveryStatePath(workspace, root), 'utf8')).toBe(before)
    expect(handoffs).toBe(0)
    expect(manager.transcript(session.id).filter(event => event.type === 'turn.completed')).toHaveLength(1)
  } finally { release?.(); await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('real stdio handoff ignores the prior notification and keeps review context until its actual result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-review-stdio-race-'))
  const workspace = join(root, 'project')
  const manager = new BeeGameSessionManager(createNativeCliProcessRunner({
    command: [process.execPath, fileURLToPath(new URL('./fixtures/native-runtime-fixture.ts', import.meta.url))],
  }), root)
  let closes = 0
  try {
    await mkdir(workspace)
    const state = await beginProjectDelivery(workspace, root, 'Fixture game')
    await writeDesignDocumentsFixture(workspace)
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, phase: 'review' }))
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id,
      ownerId: 'owner', message: 'fixture:review-race', autoContinuation: true,
      openCapabilities: () => ({ instruction: 'Fixture', close: async () => { closes++ } }),
    })
    await idle(manager, session.id)
    expect(closes).toBe(1)
    expect((await readProjectDelivery(workspace, root))?.phase).toBe('resources')
    const events = manager.transcript(session.id)
    expect(events.filter(event => event.type === 'result').map(event => event.text)).toEqual(['Review finished'])
    expect(events.some(event => event.payload?.subtype === 'delivery_error')).toBe(false)
    expect(events.some(event => event.type === 'turn.failed')).toBe(false)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('resumed implementation receives current responsive semantics without rewriting authored content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-runtime-contract-handoff-'))
  const workspace = join(root, 'project')
  let observed = false
  const manager = new BeeGameSessionManager({ async start(start) {
    return { stop() {}, async submit(turn) {
      const format = JSON.parse(await readFile(join(workspace, '.beegame/delivery/content-format.json'), 'utf8'))
      expect(format.uiLayoutContract.responsive).toContain('portrait')
      expect(format.runtimeConsumption.checks['ui-layout'].properties).toEqual(['layout'])
      expect(JSON.stringify(turn.prompt)).toContain('correct the data while preserving valid formats and references')
      expect(await readFile(join(workspace, 'content/ui.json'), 'utf8')).toBe('authored content unchanged')
      expect(await readFile(join(workspace, '.beegame/delivery/content-contract.json'), 'utf8')).toBe('authority snapshot unchanged')
      observed = true
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
    } }
  } }, root)
  try {
    await mkdir(workspace)
    await beginProjectDelivery(workspace, root, 'Build a game')
    await mkdir(join(workspace, 'content'))
    await writeFile(join(workspace, 'content/ui.json'), 'authored content unchanged')
    await writeFile(join(workspace, '.beegame/delivery/content-format.json'), '{}')
    await writeFile(join(workspace, '.beegame/delivery/content-contract.json'), 'authority snapshot unchanged')
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({
      ...(await readProjectDelivery(workspace, root)), phase: 'implementation',
    }))
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'test' })
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id,
      ownerId: 'owner', message: 'Continue' })
    await idle(manager, session.id)
    expect(observed).toBe(true)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test.each([1, 4])('technical author batch %d retains format tools and original requirements without layout instructions', async authorBatch => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-technical-format-context-'))
  const workspace = join(root, 'project')
  const brief = JSON.stringify({ kind: 'confirmed_build_brief', idea: 'Fixture game',
    settings: { platform: 'Web', engine: 'React', orientation: 'Landscape', inputs: ['Touch'] } })
  const scopedPaths: string[] = []
  let observed = false
  const manager = new BeeGameSessionManager({ async start(start) {
    return { stop() {}, async submit(turn) {
      const context = await readFile(join(workspace, '.beegame/tmp', start.sessionId, 'context.md'), 'utf8')
      expect(turn.projectTurn).toEqual({ restartContext: false })
      expect(context).toContain(JSON.stringify(brief))
      {
        expect(turn.directionAuthors?.contextPath).toBe(join(workspace, '.beegame/tmp', start.sessionId, 'context.md'))
        expect(turn.directionAuthors!.batch).toBe(authorBatch)
        expect(Object.keys(turn.directionAuthors!.responsibilities)).toEqual(authorBatch === 1 ? [
          'TECHNICAL_DESIGN.md', 'ART_DIRECTION.md', 'AUDIO_DESIGN.md',
        ] : ['ASSET_PLAN.md', 'TECHNICAL_DESIGN.md'])
        const owners = turn.directionAuthors!.responsibilities
        for (const role of Object.values(owners)) expect(context).toContain(role)
        for (const [document, path] of Object.entries(turn.directionAuthors!.contextPaths!)) {
          scopedPaths.push(path)
          const scoped = await readFile(path, 'utf8')
          expect(scoped).toContain(JSON.stringify(brief))
          expect(scoped).toContain(owners[document as keyof typeof owners]!)
          for (const [other, role] of Object.entries(owners))
            if (other !== document) expect(scoped).not.toContain(role)
          expect(scoped).toContain('sole writing owner of this draft')
          expect(scoped).toContain('do not dispatch replacement authors')
          expect(scoped).not.toContain('Use available subagents to advance independent work')
          if (document === 'TECHNICAL_DESIGN.md') {
            expect(scoped).toContain('--format coordinates runtimeConsumption')
            const format = JSON.parse(await readFile(join(workspace, '.beegame/delivery/content-format.json'), 'utf8'))
            const supplied = scoped.split('# Current platform runtime/data baseline')[1]!
            const selected = JSON.parse(supplied.slice(supplied.indexOf('{'), supplied.indexOf('\n\nThese selected')))
            expect(selected.values).toEqual({ coordinates: format.coordinates, runtimeConsumption: format.runtimeConsumption })
            expect(supplied).not.toContain('"sceneVocabulary"')
            expect(supplied).not.toContain('"vfxDocument"')
            expect(scoped).toContain('already supplied')
          } else {
            expect(scoped.length).toBeLessThan(context.length)
            expect(scoped).not.toContain('Content format reference:')
            expect(scoped).not.toContain('Current platform runtime/data baseline')
          }
        }
        expect(JSON.stringify(turn.prompt)).toContain('forwards their actual handoffs without another main-model turn')
      }
      for (const input of [context, JSON.stringify(turn.prompt)]) {
        expect(input).toContain('Content format reference:')
        expect(input).not.toContain('Design calculations:')
        expect(input).not.toContain('UI document construction first completes')
      }
      const format = JSON.parse(await readFile(join(workspace, '.beegame/delivery/content-format.json'), 'utf8'))
      expect(format.coordinates.scene2d).toContain('Top-left origin')
      expect(format.uiLayoutContract).toBeDefined()
      await access(join(workspace, '.beegame/delivery/check-content.mjs'))
      observed = true
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Observed baseline inputs' })
    } }
  } }, root)
  try {
    await mkdir(workspace)
    const state = await beginProjectDelivery(workspace, root, brief)
    await writeDesignDocumentsFixture(workspace)
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, authorBatch }))
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id,
      ownerId: 'owner', message: 'Continue technical authoring', autoContinuation: true })
    await idle(manager, session.id)
    expect(manager.transcript(session.id).filter(event => event.type === 'turn.failed')).toEqual([])
    expect(observed).toBe(true)
    for (const path of scopedPaths) await expect(access(path)).rejects.toThrow()
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test.each([2, 3] as const)('author batch %d supplies document-local tools and sources, not previous execution history', async authorBatch => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-scoped-author-context-')), workspace = join(root, 'project')
  const paths: string[] = []
  let observed = false
  const manager = new BeeGameSessionManager({ async start() {
    return { stop() {}, async submit(turn) {
      expect(turn.directionAuthors?.batch).toBe(authorBatch)
      const contexts = turn.directionAuthors!.contextPaths!
      expect(Object.keys(contexts)).toEqual([...AUTHOR_BATCHES[authorBatch]])
      for (const [document, path] of Object.entries(contexts)) {
        paths.push(path)
        const text = await readFile(path, 'utf8')
        expect(text).toContain('Fixture design objective')
        expect(text).toContain('sole writing owner of this draft')
        expect(text).not.toContain('RAW_NATIVE_EXECUTION_HISTORY')
        if (document === 'BALANCE_DESIGN.md') {
          expect(text).toContain('calculation appendix or scenario model is not required')
          expect(text).not.toContain('Supplied spatial command interface')
          expect(text).not.toContain('Current platform runtime/data baseline')
        } else {
          expect(text).toContain('Supplied spatial command interface')
          expect(text).toContain('Minimal UI draft')
          expect(text).toContain('Selected coordinates/layout contract')
          expect(text).not.toContain('calculation appendix or scenario model is not required')
        }
      }
      observed = true
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Synthetic owner completion' })
    } }
  } }, root)
  try {
    await mkdir(workspace)
    const state = await beginProjectDelivery(workspace, root, 'Fixture design objective')
    await writeDesignDocumentsFixture(workspace)
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, authorBatch }))
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id,
      ownerId: 'owner', message: 'RAW_NATIVE_EXECUTION_HISTORY', autoContinuation: true })
    await idle(manager, session.id)
    expect(manager.transcript(session.id).filter(event => event.type === 'turn.failed')).toEqual([])
    expect(observed).toBe(true)
    for (const path of paths) await expect(access(path)).rejects.toThrow()
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test.each(['continue', 'stop', 'cleanup-error', 'handoff-error'] as const)('delivery handoff waits for cleanup and honors %s', async action => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-delivery-handoff-'))
  const workspace = join(root, 'project')
  let releaseCleanup!: () => void
  let enteredCleanup!: () => void
  const cleaning = new Promise<void>(resolve => { enteredCleanup = resolve })
  const cleanup = new Promise<void>(resolve => { releaseCleanup = resolve })
  let turns = 0
  let callbacks = 0
  let continuationError: unknown
  const manager = new BeeGameSessionManager({ async start() {
    return { stop() {}, async submit(turn) {
      turns++
      await completeMilestone(workspace, turn.prompt)
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
    } }
  } }, root)
  try {
    await mkdir(join(workspace, 'docs'), { recursive: true })
    await writeDesignDocumentsFixture(workspace)
    await beginProjectDelivery(workspace, root, 'Fixture delivery')
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({
      ...(await readProjectDelivery(workspace, root)), phase: 'implementation', designBaseline: designBaselineFixture(workspace),
    }))
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root,
      sessionId: session.id, ownerId: 'owner', message: 'Start', autoContinuation: true,
      openCapabilities: () => ({ instruction: 'Fixture', close: async () => {
        enteredCleanup(); await cleanup
        if (action === 'cleanup-error') throw new Error('Fixture cleanup failed')
      } }),
      afterTurnSettled: async progress => {
        callbacks++
        if (action === 'handoff-error') throw new Error('Fixture handoff failed')
        try {
          expect(progress).toMatchObject({ phase: 'acceptance', shouldContinue: true })
          // Use the real send guard: idle alone is insufficient if activeTurn is still retained.
          await manager.send(session.id, 'Next turn')
        } catch (error) { continuationError = error }
      },
    })
    await cleaning
    await Bun.sleep(20)
    expect(callbacks).toBe(0)
    if (action === 'stop') manager.stop(session.id)
    releaseCleanup()
    for (let i = 0; i < 100 && (action === 'continue' ? turns < 2 : manager.get(session.id)?.turnStatus !== 'idle'); i++)
      await Bun.sleep(5)
    await Bun.sleep(20)
    expect(continuationError).toBeUndefined()
    expect(callbacks).toBe(action === 'continue' || action === 'handoff-error' ? 1 : 0)
    expect(turns).toBe(action === 'continue' ? 2 : 1)
    const errors = manager.events(session.id).filter(event => event.payload?.subtype === 'delivery_error')
    expect(errors).toHaveLength(action.endsWith('error') ? 1 : 0)
    if (action.endsWith('error')) expect(errors[0]?.text).toContain(action === 'cleanup-error' ? 'Fixture cleanup failed' : 'Fixture handoff failed')
  } finally { releaseCleanup?.(); await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('raw project turns reuse native context; language change resumes, not a new delivery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-conversation-'))
  const starts: BeeGameSessionRunnerStartInput[] = []
  const prompts: unknown[] = []
  let closed = 0
  let opened = 0
  const manager = new BeeGameSessionManager({ async start(start) {
    starts.push(start)
    start.onNativeSessionId?.('a28f9e61-96d5-4e38-981b-5acd25076508')
    return { stop() {}, async submit(turn) {
      prompts.push(turn.prompt)
      await turn.onMessage({ type: 'result', subtype: 'success', result: '检查完成' })
    } }
  } }, root)
  try {
    const session = manager.start({ workspacePath: join(root, 'project'), userId: 'owner', projectId: 'project' })
    const send = (message: string, language: 'zh' | 'en', clientMessageId: string) => sendProjectConversation({
      sessions: manager, sessionId: session.id, ownerId: 'owner', message,
      options: { language, clientMessageId },
      openCapabilities: () => ({ instruction: 'Optional preview tool',
        previewBaseUrl: `http://127.0.0.1:${50000 + ++opened}/private-preview`,
        close: async () => { closed++ } }),
    })
    await send('UI 有问题，先只诊断', 'zh', 'one'); await idle(manager, session.id)
    await send('只修复按钮文字', 'zh', 'two'); await idle(manager, session.id)
    expect(starts).toHaveLength(1)
    await send('Make the player faster', 'en', 'three'); await idle(manager, session.id)
    expect(starts).toHaveLength(2)
    expect(starts[1]?.resumeSessionId).toBe('a28f9e61-96d5-4e38-981b-5acd25076508')
    expect(prompts.map(prompt => (prompt as Array<{ text: string }>).at(-1)?.text))
      .toEqual(['UI 有问题，先只诊断', '只修复按钮文字', 'Make the player faster'])
    expect(JSON.stringify(prompts)).toContain("Previous turns' temporary localhost capability URLs have expired")
    expect(JSON.stringify(prompts)).toContain('isolated muted browser and records console/network/screenshot evidence')
    expect(JSON.stringify(prompts[0])).toContain('http://127.0.0.1:50001/private-preview')
    expect(JSON.stringify(prompts[1])).toContain('http://127.0.0.1:50002/private-preview')
    expect(JSON.stringify(prompts[1])).not.toContain('http://127.0.0.1:50001/private-preview')
    expect(starts[0]?.systemContext).toContain('revise the affected document baseline')
    expect(starts[0]?.systemContext).not.toContain('UI 有问题')
    expect(closed).toBe(3)
    expect(manager.events(session.id).filter(e => e.type === 'user.message').map(e => e.payload?.clientMessageId)).toEqual(['one', 'two', 'three'])
    expect(isProjectConversation(manager.events(session.id))).toBe(true)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('dependency responsibility stays global across project turns without new stages or runner restarts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-global-dependencies-'))
  const workspace = join(root, 'project')
  const starts: BeeGameSessionRunnerStartInput[] = []
  const manager = new BeeGameSessionManager({ async start(start) {
    starts.push(start)
    return { stop() {}, async submit(turn) {
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Observed project context' })
    } }
  } }, root)
  try {
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    const send = async (deliveryDataRoot?: string) => {
      await sendProjectConversation({ sessions: manager, sessionId: session.id,
        ownerId: 'owner', message: 'Inspect current dependencies', deliveryDataRoot })
      await idle(manager, session.id)
    }
    await send()
    const state = await beginProjectDelivery(workspace, root, 'Build a game')
    await writeDesignDocumentsFixture(workspace)
    for (const phase of ['author', 'review', 'resources', 'content', 'implementation', 'acceptance', 'complete'] as const) {
      await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, phase }))
      await send(root)
    }
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, status: 'paused' }))
    await send(root)
    expect(starts).toHaveLength(1)
    const context = starts[0]!.systemContext!
    expect(context).toContain('verify that a cited authority exists, contains the relevant decision and owns that subject')
    expect(context).toContain('actual file path and section')
    expect(context).toContain('Delegate outcomes, owned scope and source-backed constraints')
    expect(context).toContain('coordinator suggestions')
    expect(context).toContain('identified responsible role or task within the agreed workflow')
    expect(context).toContain('concrete expected output and the point where it is needed')
    expect(context).toContain('still unresolved until delivered and checked')
    expect(context).toContain('Include these dependency boundaries in subagent assignments')
    expect(context).toContain('continue independent work where possible')
    expect(context).toContain('optional work and hypotheses awaiting runtime verification')
    expect(context).toContain('including superseded statements and open items')
    expect(context).toContain('within the authorized editing scope')
    expect(context).toContain('no extra review stage is required')
    expect(context).toContain('Do not send handed-off work back to its writing Agent for revision')
    expect(context).not.toContain('Inspect current dependencies')
    expect(context).not.toContain('Current delivery milestone:')
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('platform context precedes the natural user request in a confirmed project turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-natural-project-request-'))
  const workspace = join(root, 'project')
  let prompt: unknown
  const manager = new BeeGameSessionManager({ async start() {
    return { stop() {}, async submit(turn) {
      prompt = turn.prompt
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
    } }
  } }, root)
  try {
    await mkdir(workspace)
    await beginProjectDelivery(workspace, root, '我想做一个贪吃蛇游戏')
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root,
      sessionId: session.id, ownerId: 'owner', message: 'Confirmed brief and delivery instructions',
      initialBrief: { displayText: '我想做一个贪吃蛇游戏', confirmedBriefContext: JSON.stringify({
        kind: 'confirmed_build_brief', resource_library_usage: 'optional',
        document_language: 'zh', game_user_visible_language: 'zh', agent_response_language: 'zh',
      }) } })
    await idle(manager, session.id)
    const blocks = prompt as Array<{ type: string; text: string }>
    expect(blocks[0]?.text).toContain('Confirmed brief and delivery instructions')
    expect(blocks.at(-1)?.text).toBe('我想做一个贪吃蛇游戏')
    expect(manager.events(session.id).find(event => event.type === 'user.message')?.text)
      .toBe('我想做一个贪吃蛇游戏')
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('optional asset command exists only during a project turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-conversation-assets-'))
  let observed = ''
  const manager = new BeeGameSessionManager({ async start(start) {
    return { stop() {}, async submit(turn) {
      const directory = join(start.cwd, '.beegame', 'tmp', start.sessionId)
      observed = await readFile(join(directory, 'assets.mjs'), 'utf8')
      const context = await readFile(join(directory, 'context.md'), 'utf8')
      expect(context).toContain('assets.mjs help')
      expect(context).not.toContain('http://127.0.0.1:12345')
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
    } }
  } }, root)
  try {
    const session = manager.start({ workspacePath: join(root, 'project'), userId: 'owner', projectId: 'project' })
    await sendProjectConversation({ sessions: manager, sessionId: session.id, ownerId: 'owner', message: 'Inspect resources',
      openCapabilities: () => ({ instruction: 'Optional assets', resourceTools: { libraryBaseUrl: 'http://127.0.0.1:12345' }, close: async () => {} }) })
    await idle(manager, session.id)
    expect(observed).toContain('http://127.0.0.1:12345')
    await expect(access(join(root, 'project', '.beegame', 'tmp', session.id, 'assets.mjs'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('temporary source remains a diagnostic for the final joint review and cannot release', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-temporary-source-handoff-'))
  const workspace = join(root, 'project')
  let contextPath = ''
  let progress: { shouldContinue: boolean; issues: string[] } | undefined
  const manager = new BeeGameSessionManager({ async start(start) {
    return { stop() {}, async submit(turn) {
      contextPath = join(workspace, '.beegame/tmp', start.sessionId, 'context.md')
      if (turn.directionAuthors) {
        await writeDesignDocumentFixture(workspace, 'ASSET_PLAN.md')
        await writeDesignDocumentFixture(workspace, 'TECHNICAL_DESIGN.md', undefined,
          designDocumentFixture('TECHNICAL_DESIGN.md') + '\n[Source](../.beegame/tmp/' + start.sessionId + '/context.md)\n')
      } else if (turn.projectTurn?.reviewStep) await writeFile(turn.projectTurn.reviewResultPath!, 'complete\n' +
        JSON.stringify({ step: turn.projectTurn.reviewStep, findings: [], resolved: [] }))
      else await completeMilestone(workspace, turn.prompt)
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Synthetic step finished' })
    } }
  } }, root)
  try {
    await mkdir(workspace)
    const state = await beginProjectDelivery(workspace, root, 'Fixture game')
    await writeDesignDocumentsFixture(workspace)
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, authorBatch: 4 }))
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    const send = async () => {
      await sendProjectConversation({ sessions: manager, deliveryDataRoot: root,
        sessionId: session.id, ownerId: 'owner', message: 'Execute delivery', autoContinuation: true,
        afterTurnSettled: value => { progress = value } })
      await manager.waitForSessionIdle(session.id)
    }
    await send()
    expect(progress?.shouldContinue).toBe(true)
    expect((await readProjectDelivery(workspace, root))?.phase).toBe('review')
    expect(await Bun.file(contextPath).exists()).toBe(false)
    await send()
    expect(progress?.shouldContinue).toBe(true)
    expect((await readProjectDelivery(workspace, root))?.designReview).toMatchObject({ step: 'revise', writableDocuments: ['TECHNICAL_DESIGN.md'] })
    await send()
    expect(progress?.shouldContinue).toBe(false)
    expect(progress?.issues.join(' ')).toContain('platform-temporary')
    expect((await readProjectDelivery(workspace, root))?.designReview?.stopped).toBe(true)
    expect((await readProjectDelivery(workspace, root))?.designBaseline).toBeUndefined()
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('five author turns dispatch actual owners before one joint review in the same native session', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-delivery-session-'))
  const workspace = join(root, 'project')
  const starts: BeeGameSessionRunnerStartInput[] = []
  const phases: string[] = [], batches: number[] = [], ownerBatches: number[] = []
  const observedRestarts: boolean[] = []
  const manager = new BeeGameSessionManager({ async start(start) {
    starts.push(start)
    return { stop() {}, async submit(turn) {
      observedRestarts.push(turn.projectTurn?.restartContext ?? false)
      const context = await readFile(join(workspace, '.beegame/tmp', start.sessionId, 'context.md'), 'utf8')
      const state = (await readProjectDelivery(workspace, root))!
      phases.push(state.phase!)
      if (state.phase === 'author') {
        const batch = state.authorBatch ?? 0
        batches.push(batch)
        expect(context).toContain('Author batch ' + (batch + 1) + '/5')
        expect(state.designBaseline).toBeUndefined()
        if (batch) {
          ownerBatches.push(turn.directionAuthors!.batch!)
          expect(Object.keys(turn.directionAuthors!.responsibilities).sort()).toEqual([...AUTHOR_BATCHES[batch]].sort())
          for (const path of Object.values(turn.directionAuthors!.contextPaths!)) {
            const task = await readFile(path, 'utf8')
            expect(task).toContain('saved prior drafts')
            expect(task).not.toContain('reviewed GDD')
          }
        } else expect(turn.directionAuthors).toBeUndefined()
        for (const name of AUTHOR_BATCHES[batch]) {
          await writeDesignDocumentFixture(workspace, name, undefined, designDocumentFixture(name) +
            (batch === 4 && name === 'TECHNICAL_DESIGN.md' ? '\nFinal technical consumption\n' : ''))
        }
      } else if (state.phase === 'review') {
        expect(turn.projectTurn?.reviewDocuments).toEqual([...PROJECT_DOCUMENTS])
        expect(turn.projectTurn?.reviewStep).toBe('inspect')
        expect(state.designHistory).toBeUndefined()
      }
      await completeMilestone(workspace, turn.prompt)
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Synthetic scheduled work completed' })
    } }
  } }, root)
  try {
    await mkdir(workspace)
    await beginProjectDelivery(workspace, root, 'Build a game')
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    for (let turn = 0; turn < 7; turn++) {
      await sendProjectConversation({ sessions: manager, deliveryDataRoot: root,
        sessionId: session.id, ownerId: 'owner', message: turn ? 'Continue delivery' : 'Start delivery',
        ...(turn ? { autoContinuation: true } : { initialBrief: { displayText: 'Build a game', confirmedBriefContext: JSON.stringify({
          kind: 'confirmed_build_brief', resource_library_usage: 'optional', document_language: 'en',
          game_user_visible_language: 'en', agent_response_language: 'en',
        }) } }) })
      await manager.waitForSessionIdle(session.id)
      expect(manager.transcript(session.id).filter(event => event.type === 'turn.failed')).toEqual([])
    }
    expect(phases).toEqual(['author', 'author', 'author', 'author', 'author', 'review', 'resources'])
    expect(batches).toEqual([0, 1, 2, 3, 4])
    expect(ownerBatches).toEqual([1, 2, 3, 4])
    expect(starts).toHaveLength(1)
    expect(observedRestarts).toEqual([false, ...Array(6).fill(true)])
    const released = (await readProjectDelivery(workspace, root))!
    expect(released.phase).toBe('resources')
    expect(released.designHistory?.map(item => item.step)).toEqual(['inspect'])
    expect(released.designDrafts).toBeUndefined()
    expect(released.designBaseline?.documentVersions?.['TECHNICAL_DESIGN.md']).toBe('1.1')
    expect(Object.keys(released.designBaseline!.snapshots)).toHaveLength(8)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('visual authors receive the current sample/browser capabilities without loading them into unrelated writer contexts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-visual-author-context-')), workspace = join(root, 'project')
  const captured = new Map<string, string>()
  const api = 'http://127.0.0.1:12345/' + 'a'.repeat(64)
  const manager = new BeeGameSessionManager({ async start() {
    return { stop() {}, async submit(turn) {
      for (const [name, path] of Object.entries(turn.directionAuthors!.contextPaths!))
        captured.set(name, await readFile(path!, 'utf8'))
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Synthetic context observation only' })
    } }
  } }, root)
  let closed = 0
  try {
    await mkdir(workspace)
    const state = await beginProjectDelivery(workspace, root, 'Synthetic professional design')
    await writeDesignDocumentsFixture(workspace)
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    for (const batch of [1, 3]) {
      await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, authorBatch: batch }))
      await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id, ownerId: 'owner',
        message: 'Continue', autoContinuation: true, openCapabilities: () => ({
          instruction: 'Synthetic visual capability instructions', previewBaseUrl: api,
          resourceTools: { imageEndpoint: 'http://127.0.0.1:12345/image' },
          async close() { closed++ },
        }) })
      await manager.waitForSessionIdle(session.id)
    }
    for (const name of ['ART_DIRECTION.md', 'UI_UX_SPEC.md']) {
      const task = captured.get(name)!
      expect(task).toContain('--visual-sample')
      expect(task).toContain(api)
      expect(task).not.toContain('Synthetic visual capability instructions')
      expect(task).toContain('assets.mjs help')
    }
    for (const name of ['TECHNICAL_DESIGN.md', 'AUDIO_DESIGN.md']) {
      const task = captured.get(name)!
      expect(task).not.toContain('--visual-sample')
      expect(task).not.toContain('Synthetic visual capability instructions')
    }
    expect(closed).toBe(2)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('same-phase resource continuation reuses the existing milestone handoff', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-delivery-compact-handoff-'))
  const workspace = join(root, 'project')
  const prompts: string[] = []
  const dispatched: boolean[] = []
  const restarted: boolean[] = []
  const starts: BeeGameSessionRunnerStartInput[] = []
  const manager = new BeeGameSessionManager({ async start(start) {
    starts.push(start)
    return { stop() {}, async submit(turn) {
      prompts.push(JSON.stringify(turn.prompt))
      dispatched.push(turn.directionAuthors !== undefined)
      restarted.push(turn.projectTurn?.restartContext ?? false)
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Still authoring' })
    } }
  } }, root)
  try {
    await mkdir(workspace)
    const state = await beginProjectDelivery(workspace, root, 'Build a small game')
    await writeDesignDocumentsFixture(workspace)
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, phase: 'resources', designBaseline: designBaselineFixture(workspace) }))
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    const send = async (message: string, autoContinuation: boolean) => {
      await sendProjectConversation({ sessions: manager, deliveryDataRoot: root,
        sessionId: session.id, ownerId: 'owner', message, autoContinuation })
      await idle(manager, session.id)
    }
    await send('Begin', true)
    await send('Continue', true)
    await send('Please continue', false)
    expect(starts).toHaveLength(1)
    expect(starts[0]?.systemContext).not.toContain('Publishing uses current-version evidence')
    expect(prompts[0]).toContain('Current delivery milestone: resources.')
    expect(prompts[1]).toContain('milestone: resources')
    expect(prompts[1]).not.toContain('Current delivery milestone: resources.')
    expect(prompts[2]).toContain('Current delivery milestone: resources.')
    // A user message is delivered naturally, not a forced new three-author run.
    expect(dispatched).toEqual([false, false, false])
    expect(restarted).toEqual([false, false, false])
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('forwards the BeeGameStudio built-in Skill catalog to the native Agent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-skill-runtime-'))
  const starts: BeeGameSessionRunnerStartInput[] = []
  const manager = new BeeGameSessionManager({ async start(start) {
    starts.push(start)
    start.onNativeSessionId?.('00000000-0000-4000-8000-000000000001')
    return { stop() {}, async submit(turn) {
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
    } }
  } }, root, () => ({
    BEEGAME_CONFIG_DIR: join(root, 'config'),
    BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: join(root, 'builtinskills'),
    SKILL_SEARCH_ENABLED: '1',
  }))
  try {
    const session = manager.start({ workspacePath: join(root, 'project'),
      userId: 'owner', projectId: 'project' })
    await sendProjectConversation({ sessions: manager, sessionId: session.id,
      ownerId: 'owner', message: 'Design a level' })
    await idle(manager, session.id)
    expect(starts[0]?.env.BEEGAME_NATIVE_BUILTIN_SKILLS_DIR)
      .toBe(join(root, 'builtinskills'))
    expect(starts[0]?.env.SKILL_SEARCH_ENABLED).toBe('1')
    expect((await manager.projectEditCheckpointInfo(session.id)).nativeTranscriptPath)
      .toStartWith(join(root, 'config', 'projects'))
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('release interface is precise and appears only when delivery can be accepted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-conversation-release-'))
  const workspace = join(root, 'project')
  const starts: BeeGameSessionRunnerStartInput[] = []
  const prompts: unknown[] = []
  const contexts: string[] = []
  const reportCheckers: string[] = []
  const manager = new BeeGameSessionManager({ async start(start) {
    starts.push(start)
    return { stop() {}, async submit(turn) {
      prompts.push(turn.prompt)
      contexts.push(await readFile(join(workspace, '.beegame/tmp', start.sessionId, 'context.md'), 'utf8'))
      if (prompts.length > 1)
        reportCheckers.push(await readFile(join(workspace, '.beegame/tmp', start.sessionId, 'check-acceptance.mjs'), 'utf8'))
      await turn.onMessage({ type: 'result', subtype: 'success', result: '验收通过' })
    } }
  } }, root)
  try {
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    await beginProjectDelivery(workspace, root, 'Build a playable game')
    await sendProjectConversation({ sessions: manager, sessionId: session.id, ownerId: 'owner',
      message: 'Explain the design', deliveryDataRoot: root })
    await idle(manager, session.id)
    expect(starts[0]?.systemContext).not.toContain('this turn must')
    expect(starts[0]?.systemContext).not.toContain('verification {')
    expect(starts[0]?.systemContext).toContain('revise the affected document baseline before implementing that change')
    expect(starts[0]?.systemContext).toContain('A defect fix that restores the existing design does not require rewriting the documents')
    expect(starts[0]?.systemContext).not.toContain('choose the necessary scope and order yourself')
    expect(contexts[0]).not.toContain('scope "delivery"')
    expect(contexts[0]).not.toContain('verification.requirementChecks')
    const state = await readProjectDelivery(workspace, root)
    await writeDesignDocumentsFixture(workspace)
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, phase: 'acceptance', designBaseline: designBaselineFixture(workspace) }))
    await sendProjectConversation({ sessions: manager, sessionId: session.id, ownerId: 'owner',
      message: '验收当前版本', deliveryDataRoot: root })
    await idle(manager, session.id)
    expect(starts).toHaveLength(1)
    expect(JSON.stringify(prompts[1])).toContain('evidencePaths')
    expect(contexts[1]).toContain('environment as nonempty strings')
    expect(contexts[1]).toContain('observation:"target-runtime"|"simulation"')
    expect(contexts[1]).toContain('verification.contentChecks')
    expect(contexts[1]).toContain('verification.requirementChecks')
    expect(contexts[1]).toContain('documentSha256:SHA-256 of current docs/<document> bytes')
    expect(JSON.stringify(prompts[1])).toContain('Cover all declared requirements')
    expect(contexts[1]).toContain('read-only acceptance check')
    expect(JSON.stringify(prompts[1])).toContain('not at the report top level')
    expect(JSON.stringify(prompts[1])).toContain('does not replace actual runtime verification')
    expect(JSON.stringify(prompts[1])).toContain('Failed or unverified bindings cannot be a delivery PASS')
    await sendProjectConversation({ sessions: manager, sessionId: session.id, ownerId: 'owner',
      message: 'Continue acceptance', deliveryDataRoot: root, autoContinuation: true })
    await idle(manager, session.id)
    expect(JSON.stringify(prompts[2])).toContain('milestone: acceptance')
    expect(JSON.stringify(prompts[2])).toContain('acceptance report contract remains')
    expect(JSON.stringify(prompts[2])).not.toContain('verification.contentChecks')
    expect(contexts[2]).toContain('verification.contentChecks')
    expect(JSON.stringify(prompts[2])).not.toContain('verification.requirementChecks')
    expect(contexts[2]).toContain('verification.requirementChecks')
    expect(JSON.stringify(prompts[2])).not.toContain('evidencePaths')
    expect(contexts[2]).toContain('evidencePaths')
    expect(reportCheckers).toHaveLength(2)
    for (const category of ['report-invalid', 'verification-incomplete', 'product-failed'] as const) {
      manager.recordDeliveryError(session.id, 'diagnostic detail', category)
      const event = manager.events(session.id).at(-1)!
      expect(event.payload?.category).toBe(category)
      expect(event.text).toContain('diagnostic detail')
      expect(event.text).not.toContain('Delivery could not continue')
      expect(event.text).not.toContain('交付未能继续')
    }
    await expect(access(join(workspace, '.beegame/tmp', session.id, 'check-acceptance.mjs'))).rejects.toMatchObject({ code: 'ENOENT' })
    // A natural-language PASS still must not manufacture release evidence.
    expect((await readProjectDelivery(workspace, root))?.accepted).toBeUndefined()
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('continue uses the confirmed brief in the same native session', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-conversation-blocked-'))
  const workspace = join(root, 'project')
  const starts: BeeGameSessionRunnerStartInput[] = []
  const prompts: unknown[] = []
  let handoff = ''
  const manager = new BeeGameSessionManager({ async start(start) {
    starts.push(start)
    return { stop() {}, async submit(turn) {
      prompts.push(turn.prompt)
      handoff = await readFile(join(workspace, '.beegame/tmp', start.sessionId, 'context.md'), 'utf8')
      await turn.onMessage({ type: 'result', subtype: 'success', result: '已读取现有阻塞原因' })
    } }
  } }, root)
  try {
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    manager.appendUserMessage(session.id, '做一个老师批改作业的游戏', { displayKind: 'confirmed_brief' })
    await sendProjectConversation({ sessions: manager, sessionId: session.id, ownerId: 'owner', message: '继续' })
    await idle(manager, session.id)
    expect(prompts).toEqual(['继续'])
    expect(starts[0]?.systemContext).toContain('context.md')
    expect(starts[0]?.systemContext).not.toContain('做一个老师批改作业的游戏')
    expect(handoff).toContain('做一个老师批改作业的游戏')
    expect(await Bun.file(join(workspace, '.beegame/tmp', session.id, 'context.md')).exists()).toBe(false)
    expect(manager.events(session.id).filter(e => e.type === 'user.message' && e.text === '继续')).toHaveLength(1)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('attachments survive the project entry and a transport retry does not duplicate the turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-conversation-images-'))
  const prompts: unknown[] = []
  const manager = new BeeGameSessionManager({ async start() { return { stop() {}, async submit(turn) {
    prompts.push(turn.prompt)
    await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
  } } } }, root)
  try {
    const session = manager.start({ workspacePath: join(root, 'project'), userId: 'owner', projectId: 'project' })
    const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII='
    const input = { sessions: manager, sessionId: session.id, ownerId: 'owner', message: '修复截图中的问题',
      options: { clientMessageId: 'picture-request', attachments: [{ type: 'image' as const, filename: 'bug.png', mediaType: 'image/png' as const, data }] } }
    await sendProjectConversation(input); await idle(manager, session.id)
    await sendProjectConversation(input)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toMatchObject([{ type: 'text', text: input.message }, { type: 'image', source: { data } }])
    expect(manager.events(session.id).filter(e => e.type === 'user.message')[0]?.payload?.attachments).toHaveLength(1)
    await expect(sendProjectConversation({ ...input, message: '另外的问题' })).rejects.toThrow('another request')
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('restart restores the native UUID and request identity without delivery recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-conversation-resume-'))
  const starts: BeeGameSessionRunnerStartInput[] = []
  const runner = { async start(start: BeeGameSessionRunnerStartInput) {
    starts.push(start)
    start.onNativeSessionId?.('a28f9e61-96d5-4e38-981b-5acd25076508')
    return { stop() {}, async submit(turn: Parameters<import('./session-manager').BeeGameSessionRuntime['submit']>[0]) {
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
    } }
  } }
  let manager = new BeeGameSessionManager(runner, root)
  try {
    const base = { workspacePath: join(root, 'project'), userId: 'owner', projectId: 'project' }
    const session = manager.start(base)
    await sendProjectConversation({ sessions: manager, sessionId: session.id, ownerId: 'owner', message: '只检查UI', options: { clientMessageId: 'before-restart' } })
    await idle(manager, session.id); await manager.dispose()
    manager = new BeeGameSessionManager(runner, root)
    const restored = manager.start({ ...base, transcriptSessionId: session.id })
    expect(isProjectConversation(manager.transcript(restored.id))).toBe(true)
    await sendProjectConversation({ sessions: manager, sessionId: restored.id, ownerId: 'owner', message: '只检查UI', options: { clientMessageId: 'before-restart' } })
    expect(starts).toHaveLength(1)
    await sendProjectConversation({ sessions: manager, sessionId: restored.id, ownerId: 'owner', message: '继续' })
    await idle(manager, restored.id)
    expect(starts[1]?.resumeSessionId).toBe('a28f9e61-96d5-4e38-981b-5acd25076508')
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('a user message resumes an interrupted delivery milestone after restart without repeating it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-interrupted-delivery-resume-'))
  const workspace = join(root, 'project')
  const base = { workspacePath: workspace, userId: 'owner', projectId: 'project' }
  let interrupted = true
  const starts: BeeGameSessionRunnerStartInput[] = []
  const runner = { async start(start: BeeGameSessionRunnerStartInput) {
    starts.push(start)
    start.onNativeSessionId?.('a28f9e61-96d5-4e38-981b-5acd25076508')
    return { stop() {}, async submit(turn: Parameters<import('./session-manager').BeeGameSessionRuntime['submit']>[0]) {
      if (interrupted) throw new Error('Fixture: previous server process exited mid-turn')
      const context = typeof turn.prompt === 'string' ? turn.prompt : JSON.stringify(turn.prompt)
      const resultPath = context.match(/\.beegame\/tmp\/[^\s]+\/milestone-[\w-]+\.txt/)?.[0]
      expect(resultPath).toBeTruthy()
      await completeMilestone(workspace, turn.prompt)
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Review finished' })
    } }
  } }
  let manager = new BeeGameSessionManager(runner, root)
  try {
    await mkdir(workspace)
    await beginProjectDelivery(workspace, root, 'Build a game')
    await writeDesignDocumentsFixture(workspace)
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({
      ...(await readProjectDelivery(workspace, root)), phase: 'review',
    }))
    const session = manager.start(base)
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id,
      ownerId: 'owner', message: 'Review the documents', autoContinuation: true })
    await idle(manager, session.id)
    expect(manager.transcript(session.id).findLast(event => event.type === 'turn.failed')).toBeTruthy()
    expect((await readProjectDelivery(workspace, root))?.phase).toBe('review')

    await manager.dispose()
    interrupted = false
    manager = new BeeGameSessionManager(runner, root)
    const restored = manager.start({ ...base, transcriptSessionId: session.id })
    expect(restored.id).toBe(session.id)
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: restored.id,
      ownerId: 'owner', message: '继续' })
    await idle(manager, restored.id)
    expect((await readProjectDelivery(workspace, root))?.phase).toBe('resources')
    expect(starts[1]?.resumeSessionId).toBe('a28f9e61-96d5-4e38-981b-5acd25076508')
    expect(manager.transcript(restored.id).filter(event => event.type === 'user.message').at(-1)?.text).toBe('继续')
    expect(manager.transcript(restored.id).filter(event => event.type === 'turn.completed')).toHaveLength(1)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('an ordinary user answer during review does not advance an uninterrupted milestone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-review-user-answer-'))
  const workspace = join(root, 'project')
  const manager = new BeeGameSessionManager({ async start() {
    return { stop() {}, async submit(turn) {
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Answered the question' })
    } }
  } }, root)
  try {
    await mkdir(workspace)
    await beginProjectDelivery(workspace, root, 'Build a game')
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({
      ...(await readProjectDelivery(workspace, root)), phase: 'review',
    }))
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id,
      ownerId: 'owner', message: 'What is being reviewed?' })
    await idle(manager, session.id)
    expect((await readProjectDelivery(workspace, root))?.phase).toBe('review')
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('stopping and continuing reuses the same project session and native context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-conversation-stop-resume-'))
  const starts: BeeGameSessionRunnerStartInput[] = []
  const manager = new BeeGameSessionManager({ async start(start) {
    starts.push(start)
    start.onNativeSessionId?.('a28f9e61-96d5-4e38-981b-5acd25076508')
    return { stop() {}, async submit(turn) {
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
    } }
  } }, root)
  try {
    const base = { workspacePath: join(root, 'project'), userId: 'owner', projectId: 'project' }
    const original = manager.start(base)
    await sendProjectConversation({ sessions: manager, sessionId: original.id, ownerId: 'owner', message: '先检查UI' })
    await idle(manager, original.id)
    manager.stop(original.id)
    await manager.waitForSessionIdle(original.id)
    const resumed = manager.start({ ...base, transcriptSessionId: original.id })
    expect(resumed.id).toBe(original.id)
    expect(isProjectConversation(manager.transcript(resumed.id))).toBe(true)
    await sendProjectConversation({ sessions: manager, sessionId: resumed.id, ownerId: 'owner', message: '继续修复' })
    await idle(manager, resumed.id)
    expect(starts).toHaveLength(2)
    expect(starts[1]?.sessionId).toBe(original.id)
    expect(starts[1]?.resumeSessionId).toBe('a28f9e61-96d5-4e38-981b-5acd25076508')
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('stop during preparation closes capabilities and does not launch a model or publish a user message', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-conversation-stop-'))
  const manager = new BeeGameSessionManager({ async start() { throw new Error('Must not launch') } }, root)
  let release!: () => void
  const preparing = new Promise<void>(resolve => { release = resolve })
  let closed = 0
  try {
    const base = { workspacePath: join(root, 'project'), userId: 'owner', projectId: 'project' }
    const session = manager.start(base)
    const sent = manager.sendWithDisplay(session.id, '修复', { prepareTurn: async () => {
      await preparing
      return { close: async () => { closed++ } }
    } })
    manager.stop(session.id)
    expect(() => manager.start({ ...base, transcriptSessionId: session.id })).toThrow('still stopping')
    release()
    await expect(sent).rejects.toThrow('stopped during turn preparation')
    expect(closed).toBe(1)
    expect(manager.events(session.id).filter(e => e.type === 'user.message')).toHaveLength(0)
    expect(manager.get(session.id)?.turnStatus).toBe('idle')
  } finally { release(); await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test.each(['absent', 'blocked', 'complete'] as const)('GDD handoff honors the Agent result instead of draft existence: %s', async signal => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-gdd-conclusion-'))
  const workspace = join(root, 'project')
  let progress: { shouldContinue: boolean; issues: string[] } | undefined
  let submissions = 0
  const manager = new BeeGameSessionManager({ async start() {
    return { stop() {}, async submit(turn) {
      submissions++
      const resultPath = JSON.stringify(turn.prompt).match(/\.beegame\/tmp\/[^\s]+\/milestone-[\w-]+\.txt/)?.[0]
      expect(resultPath).toBeTruthy()
      if (signal !== 'absent') await writeFile(join(workspace, resultPath!), signal === 'complete'
        ? 'complete\n' : 'blocked\nCore rule conflict remains')
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Normal native reply' })
    } }
  } }, root)
  try {
    await mkdir(join(workspace, 'docs'), { recursive: true })
    const source = designDocumentFixture('GDD.md')
    await writeDesignDocumentFixture(workspace, 'GDD.md', undefined, source)
    await beginProjectDelivery(workspace, root, 'Build a game')
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root,
      sessionId: session.id, ownerId: 'owner', message: 'What is left?',
      autoContinuation: true,
      afterTurnSettled: value => { progress = value },
    })
    await manager.waitForSessionIdle(session.id)
    expect(submissions).toBe(1)
    expect(progress?.shouldContinue).toBe(signal === 'complete')
    expect((await readProjectDelivery(workspace, root))?.phase).toBe('author')
    expect((await readProjectDelivery(workspace, root))?.authorBatch ?? 0).toBe(signal === 'complete' ? 1 : 0)
    if (signal === 'blocked') expect(progress?.issues).toEqual(['Core rule conflict remains'])
    expect(await readFile(join(workspace, 'docs/GDD.md'), 'utf8')).toBe(designDocumentFixture('GDD.md'))
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test.each(['author', 'revise'] as const)('ordinary project questions cannot finalize or advance the active %s state', async step => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-ordinary-design-question-')), workspace = join(root, 'project')
  let submissions = 0
  const manager = new BeeGameSessionManager({ async start() {
    return { stop() {}, async submit(turn) {
      submissions++
      expect(turn.directionAuthors).toBeUndefined()
      expect(turn.projectTurn?.reviewStep).toBeUndefined()
      expect(turn.projectTurn?.reviewResultPath).toBeUndefined()
      expect(JSON.stringify(turn.prompt)).not.toContain('Record your author conclusion')
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'The remaining task is still unfinished.' })
    } }
  } }, root)
  try {
    await mkdir(workspace)
    const state = await beginProjectDelivery(workspace, root, 'Synthetic ordinary question')
    await writeDesignDocumentsFixture(workspace)
    if (step === 'revise') {
      await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, phase: 'review', authorBatch: 4 }))
      await prepareProjectDesignReview(workspace, root)
      const finding = { id: 'rule', severity: 'blocker' as const, action: 'correct' as const, owner: 'GDD.md' as const,
        documents: ['GDD.md' as const], sources: [{ document: 'GDD.md' as const, section: 'Design' }],
        impact: 'Synthetic required rule is inconsistent', closeWhen: 'Correct the owned rule', neededBefore: 'resources' as const }
      await advanceProjectDeliveryAfterTurn(workspace, root, { phase: 'review', status: 'complete', summary: '',
        review: { step: 'inspect', findings: [finding], resolved: [] } })
    }
    const document = await readFile(join(workspace, 'docs/GDD.md'), 'utf8')
    const index = await readFile(join(workspace, '.beegame/design-handoffs/GDD.json'), 'utf8')
    const savedState = await readFile(projectDeliveryStatePath(workspace, root), 'utf8')
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id,
      ownerId: 'owner', message: 'What work remains?' })
    await manager.waitForSessionIdle(session.id)
    expect(submissions).toBe(1)
    expect(manager.transcript(session.id).filter(event => event.type === 'turn.failed')).toEqual([])
    expect(await readFile(join(workspace, 'docs/GDD.md'), 'utf8')).toBe(document)
    expect(await readFile(join(workspace, '.beegame/design-handoffs/GDD.json'), 'utf8')).toBe(index)
    expect(await readFile(projectDeliveryStatePath(workspace, root), 'utf8')).toBe(savedState)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('Stop resumes the pending delivery once; later ordinary questions do not redispatch writers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-stop-delivery-boundary-')), workspace = join(root, 'project')
  let submissions = 0
  const manager = new BeeGameSessionManager({ async start() {
    return { stop() {}, async submit(turn) {
      submissions++
      const receipt = JSON.stringify(turn.prompt).match(/\.beegame\/tmp\/[^\s]+\/milestone-[\w-]+\.txt/)?.[0]
      if (submissions < 3) expect(receipt).toBeTruthy()
      if (submissions === 2) {
        await writeDesignDocumentFixture(workspace, 'GDD.md', undefined,
          designDocumentFixture('GDD.md') + '\nRecovered complete draft\n')
        await writeFile(join(workspace, receipt!), 'complete\n')
      } else if (submissions === 3) {
        expect(receipt).toBeUndefined()
        expect(turn.directionAuthors).toBeUndefined()
      }
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Synthetic native answer' })
    } }
  } }, root)
  try {
    await mkdir(workspace)
    await beginProjectDelivery(workspace, root, 'Synthetic pending delivery')
    await writeDesignDocumentFixture(workspace, 'GDD.md')
    const base = { workspacePath: workspace, userId: 'owner', projectId: 'project' }
    const session = manager.start(base)
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id,
      ownerId: 'owner', message: 'Begin delivery', autoContinuation: true })
    await manager.waitForSessionIdle(session.id)
    expect((await readProjectDelivery(workspace, root))?.authorBatch ?? 0).toBe(0)
    manager.stop(session.id)
    await manager.waitForSessionIdle(session.id)
    manager.start({ ...base, transcriptSessionId: session.id })
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id,
      ownerId: 'owner', message: 'Finish the pending draft' })
    await manager.waitForSessionIdle(session.id)
    expect((await readProjectDelivery(workspace, root))?.authorBatch).toBe(1)
    expect(await readFile(join(workspace, 'docs/GDD.md'), 'utf8')).toContain('v1.1')
    const completedState = await readFile(projectDeliveryStatePath(workspace, root), 'utf8')
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id,
      ownerId: 'owner', message: 'What remains to write?' })
    await manager.waitForSessionIdle(session.id)
    expect(submissions).toBe(3)
    expect(await readFile(projectDeliveryStatePath(workspace, root), 'utf8')).toBe(completedState)
    expect(manager.transcript(session.id).filter(event => event.type === 'turn.failed')).toEqual([])
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test.each(['missing', 'empty', 'whitespace', 'native-failed', 'native-empty', 'stale-turn'] as const)('scheduled author %s cannot finalize sibling drafts or advance', async fault => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-unfinished-writing-')), workspace = join(root, 'project')
  const manager = new BeeGameSessionManager({ async start() {
    return { stop() {}, async submit(turn) {
      expect(turn.directionAuthors?.batch).toBe(1)
      for (const name of AUTHOR_BATCHES[1]) await writeDesignDocumentFixture(workspace, name, undefined,
        designDocumentFixture(name) + '\nSynthetic attempted change\n')
      if (fault === 'native-failed') throw new Error('Synthetic scheduled author failed')
      if (fault === 'native-empty') return
      if (fault === 'stale-turn') {
        const state = await readProjectDelivery(workspace, root)
        await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, authorBatch: 2 }))
        await turn.onMessage({ type: 'result', subtype: 'success', result: 'An old author handoff after the state changed' })
        return
      }
      if (fault === 'missing') await rm(join(workspace, 'docs/TECHNICAL_DESIGN.md'))
      else await writeFile(join(workspace, 'docs/TECHNICAL_DESIGN.md'), fault === 'empty' ? '' : ' \n ')
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Synthetic native author handoffs' })
    } }
  } }, root)
  try {
    await mkdir(workspace)
    await beginProjectDelivery(workspace, root, 'Synthetic failed writing')
    await writeDesignDocumentFixture(workspace, 'GDD.md')
    await advanceProjectDeliveryAfterTurn(workspace, root, { phase: 'author', status: 'complete', summary: '' })
    await writeDesignDocumentsFixture(workspace, AUTHOR_BATCHES[1])
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id,
      ownerId: 'owner', message: 'Write direction drafts', autoContinuation: true })
    await manager.waitForSessionIdle(session.id)
    const stopped = (await readProjectDelivery(workspace, root))!
    expect(stopped).toMatchObject({ phase: 'author', authorBatch: fault === 'stale-turn' ? 2 : 1 })
    expect(stopped.designBaseline).toBeUndefined()
    expect(stopped.designHistory).toBeUndefined()
    expect(await readFile(join(workspace, 'docs/ART_DIRECTION.md'), 'utf8')).toContain('v1.0')
    expect(JSON.parse(await readFile(join(workspace, '.beegame/design-handoffs/ART_DIRECTION.json'), 'utf8')).documentVersion).toBe('1.0')
    if (fault === 'native-failed') expect(manager.transcript(session.id).some(event => event.type === 'turn.failed')).toBe(true)
    else if (fault === 'native-empty') expect(manager.transcript(session.id).some(event => event.type === 'turn.empty')).toBe(true)
    else if (fault === 'stale-turn') expect(manager.transcript(session.id).some(event => event.text?.includes('Delivery changed during this turn'))).toBe(true)
    else expect(stopped.lastValidationFailure).toContain('docs/TECHNICAL_DESIGN.md')
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})
