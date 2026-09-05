import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { foundationAuthoringSources } from './foundation-authoring-contract'
import { getGameDocumentContract } from './game-document-contracts'
import { foundationFactDefinition } from './foundation-fact-definitions'
import { buildWorkerPrompt } from './worker-prompts'
import * as types from './types'

const root = resolve(import.meta.dir, '../../../../..')
const baseline = 'dffad4194'
const directory = 'packages/agent-workflow-server/src/beegame/delivery-workflow/'
const baselineSource = (file: string) => execFileSync('git', ['show', baseline + ':' + directory + file], { cwd: root, encoding: 'utf8' })

describe('Stage 2 isolation from review and revision', () => {
  test('freezes audit contracts, review state and revision implementation against the approved baseline', () => {
    for (const file of [
      'game-document-contracts.ts', 'foundation-audit-contracts.ts',
      'foundation-audit-production-manifest.ts', 'foundation-audit-state.ts',
      'foundation-audit-artifacts.ts', 'foundation-document-topology.ts',
    ]) {
      expect(readFileSync(resolve(root, directory, file), 'utf8')).toBe(baselineSource(file))
    }
  })

  test('changes only author scheduling, dispatch lookup and public handoff in the shared controller', () => {
    const before = baselineSource('controller.ts')
    const after = readFileSync(resolve(root, directory, 'controller.ts'), 'utf8')
    const start = before.indexOf("    if (\n      run.phase === 'DOCUMENT_DRAFTING' &&\n      run.foundationDraftState.documents\n", before.indexOf('  async function resumeUnlocked'))
    const end = before.indexOf('    // Replay a terminal from a phase', start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const hook = [
      '    if (await resumeFoundationAuthors({',
      '      run,',
      '      workspacePath: input.workspacePath,',
      '      dispatcher,',
      '      handleTerminal: handleTerminalUnlocked,',
      '      persist,',
      '    })) return',
      '',
    ].join('\n')
    expect(after.split(hook)).toHaveLength(2)
    const checkpointStart = before.indexOf('  const checkpoints = run.foundationDraftState.documents ??')
    const checkpointEnd = before.indexOf('  try {', checkpointStart)
    expect(checkpointStart).toBeGreaterThan(0)
    expect(checkpointEnd).toBeGreaterThan(checkpointStart)
    const restored = after.replace(
      '  const checkpoints = authorHandoffCheckpoints(run.foundationDraftState)\n',
      before.slice(checkpointStart, checkpointEnd),
    ).replace("import { authorHandoffCheckpoints, locateAuthorDispatch } from './foundation-authoring-state'\n", '')
    .replace(
      '    const foundationCheckpoint = run ? locateAuthorDispatch(run.foundationDraftState, record.dispatchId) : undefined',
      ['    const foundationCheckpoint = run?.foundationDraftState.documents?.find(', '      document => document.dispatch?.dispatchId === record.dispatchId,', '    )'].join('\n'),
    )
    .replace(hook, before.slice(start, end)).replace(
      "import { resumeFoundationAuthors } from './foundation-authoring-scheduler'",
      "import { recordFoundationFailure } from './foundation-authoring-batch'",
    )
    // Pause-at-handoff is a global adapter. Normalize only that adapter out
    // of the source oracle; all non-author controller code remains frozen.
    const normalized = restored
      .replace(
        "import {\n  canStartFoundationAudit,\n  readFoundationAuthoringPause,\n  pauseFoundationAuthoringHandoff,\n} from './foundation-audit-boundary'",
        "import { canStartFoundationAudit } from './foundation-audit-boundary'",
      )
      .replace(
        `      if (documentSet === 'foundation' && canStartFoundationAudit(next)) {
        const pause = readFoundationAuthoringPause(
          await store.readEvents(),
          next.runId,
        )
        const paused = pauseFoundationAuthoringHandoff(next, pause)
        if (paused) {
          await persist(paused, 'foundation.authoring.pause_changed', {
            foundationAuthoringPause: 'reached',
          })
          return
        }
        next = await deriveFoundationAudit(next, input.workspacePath)
      }`,
        "      if (documentSet === 'foundation' && canStartFoundationAudit(next))\n        next = await deriveFoundationAudit(next, input.workspacePath)",
      )
      .replace(
        /          const pause = readFoundationAuthoringPause\(\n            await store\.readEvents\(\),\n            current\.runId,\n          \)\n          const paused = pauseFoundationAuthoringHandoff\(current, pause\)\n          next = paused \?\? await deriveFoundationAudit\(current, input\.workspacePath\)/,
        "          next = await deriveFoundationAudit(current, input.workspacePath)",
      )
      .replace(
        /              type: paused\n                \? 'foundation\.authoring\.pause_changed'\n                : next\.foundationAuditState\n                \? 'foundation\.audit\.index_staged'\n                : 'foundation\.audit\.derivation_failed',\n              phase: next\.phase,\n              status: next\.status,\n              revision: next\.revision,\n              \.\.\.\(paused \? \{ foundationAuthoringPause: 'reached' \} : \{\}\),/,
        "              type: next.foundationAuditState\n                ? 'foundation.audit.index_staged'\n                : 'foundation.audit.derivation_failed',\n              phase: next.phase,\n              status: next.status,\n              revision: next.revision,",
      )
      .replace(
        `        const pause = readFoundationAuthoringPause(
          await store.readEvents(),
          run.runId,
        )
        const paused = pauseFoundationAuthoringHandoff(run, pause)
        if (paused) {
          await persist(paused, 'foundation.authoring.pause_changed', {
            foundationAuthoringPause: 'reached',
          })
          return
        }
        const next = await deriveFoundationAudit(run, input.workspacePath)`,
        "        const next = await deriveFoundationAudit(run, input.workspacePath)",
      )
      .replace(
        `  function resume(run: DeliveryRun): Promise<void> {
    return serialize(async () => {
      // Authoring handoff callers can hold a stale pre-pause snapshot. Read
      // the durable run before entering those paths so a reached stop cannot
      // be bypassed by immediately deriving the review state.
      if (
        run.phase === 'DOCUMENT_DRAFTING' ||
        (run.phase === 'DOCUMENT_REVIEW' && !run.foundationAuditState)
      ) {
        const current = await store.load()
        if (!current || current.runId !== run.runId) return
        await resumeUnlocked(current)
        return
      }
      await resumeUnlocked(run)
    })
  }

  function ensureProgress`,
        "  function resume(run: DeliveryRun): Promise<void> {\n    return serialize(() => resumeUnlocked(run))\n  }\n\n  function ensureProgress",
      )
    expect(normalized).toBe(before)
  })

  test('private author business has no dependency on review, revision or the global controller', () => {
    for (const file of ['foundation-authoring-stage.ts', 'foundation-authoring-state.ts', 'foundation-authoring-recovery.ts']) {
      const source = readFileSync(resolve(root, directory, file), 'utf8')
      expect(source).not.toContain('DeliveryRun')
      expect(source).not.toContain("from './controller'")
      expect(source).not.toContain("from './foundation-audit-state'")
      expect(source).not.toContain("from './foundation-revision-stage'")
      expect(source).not.toContain('foundationAuditState')
      expect(source).not.toContain('resourceProductionState')
    }
  })

  test('uses only valid, unique author blocks and has no circular dependencies', () => {
    const completed = new Set<string>()
    for (const path of types.CANONICAL_FOUNDATION_DOCUMENTS) {
      const sources = foundationAuthoringSources(path)
      expect(new Set(sources.map(s => s.path)).size).toBe(sources.length)
      for (const source of sources) {
        const shared = getGameDocumentContract(source.path)
        const ids = new Set([...shared.sections.map(s => s.sectionId), ...shared.productionMaterials.map(m => 'material.' + m.materialId)])
        expect(new Set(source.sectionIds).size).toBe(source.sectionIds.length)
        for (const id of source.sectionIds) expect(ids.has(id)).toBe(true)
      }
    }
    while (completed.size < types.CANONICAL_FOUNDATION_DOCUMENTS.length) {
      const ready = types.CANONICAL_FOUNDATION_DOCUMENTS.filter(p => !completed.has(p) && foundationAuthoringSources(p).every(s => completed.has(s.path)))
      expect(ready.length).toBeGreaterThan(0)
      if (!ready.length) break
      for (const path of ready) completed.add(path)
    }
    expect(completed.size).toBe(8)
  })

  test('keeps non-author worker output byte-identical to the baseline', () => {
    // Execute only trusted repository code for a differential regression oracle.
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(baselineSource('worker-prompts.ts'))
      .replace(/import[\s\S]*?from ['"][^'"]+['"];?\n/g, '').replace(/export /g, '')
    const before = new Function(
      'CANONICAL_PROJECT_ARTIFACTS', 'CANONICAL_PROJECT_DOCUMENTS', 'CANONICAL_FOUNDATION_DOCUMENTS', 'foundationFactDefinition',
      js + ';return buildWorkerPrompt',
    )(types.CANONICAL_PROJECT_ARTIFACTS, types.CANONICAL_PROJECT_DOCUMENTS, types.CANONICAL_FOUNDATION_DOCUMENTS, foundationFactDefinition)
    for (const workerType of [
      'foundation-fact-extractor', 'foundation-semantic-reviewer', 'foundation-document-reviser',
      'document-author', 'resource-planner', 'resource-curator', 'resource-content-author',
      'atomic-task-planner', 'implementation-worker', 'implementation-auditor', 'acceptance-validator',
      'change-impact-analyzer', 'question-answerer',
    ]) {
      for (const extra of [{}, { kind: 'confirmation' }, { issueId: 'issue-1' }]) {
        const request = {
          runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/workspace',
          phase: 'DOCUMENT_REVIEW', revision: 'revision', workerType, allowedPaths: [],
          contract: { documentSet: 'checklist', stagedPath: '.beegame/staged.md',
            packet: { keys: [], sections: [], issues: [], sectionIds: [], issueIds: [] }, ...extra },
        } as types.WorkerDispatchRequest
        const capture = (fn: typeof buildWorkerPrompt) => {
          try { return { result: fn(request) } } catch (error) { return { error: (error as Error).message } }
        }
        expect(capture(buildWorkerPrompt)).toEqual(capture(before))
      }
    }
  })
})
