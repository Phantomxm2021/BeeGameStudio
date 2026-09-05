import { describe, expect, test, setSystemTime } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { readFileSync } from 'node:fs'
import * as artifacts from './foundation-audit-artifacts'
import * as auditState from './foundation-audit-state'
import * as factStore from './foundation-fact-store'
import * as extraction from './foundation-fact-extraction'
import { auditFoundationDocumentFormats } from './foundation-document-format-review'
import { authorHandoffCheckpoints } from './foundation-authoring-state'
import { CANONICAL_FOUNDATION_DOCUMENTS, type DeliveryRun } from './types'
import { enterFoundationReview } from './stages/foundation-review/public'
import { originalEntry, approvedController, restoreReviewEntry, reviewEntrySource } from './foundation-review-isolation-oracle'
import { completeTestSubmission, renderTestCompleteGameDocument } from '../../__tests__/complete-game-document-fixture'

const dependencies = { ...artifacts, ...auditState, ...factStore, ...extraction, auditFoundationDocumentFormats, authorHandoffCheckpoints, CANONICAL_FOUNDATION_DOCUMENTS, readFile, join, enterFoundationReview }
function executable(source: string): (run: DeliveryRun, path: string) => Promise<DeliveryRun> {
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(source)
  return new Function(...Object.keys(dependencies), js + ';return deriveFoundationAudit')(...Object.values(dependencies))
}
const controller = readFileSync(join(import.meta.dir, 'controller.ts'), 'utf8')
const currentEntry = controller.match(/async function deriveFoundationAudit\([\s\S]*?\n}\n/)![0]
async function snapshot(root: string, path = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
    const relative = join(path, entry.name)
    if (entry.isDirectory()) Object.assign(result, await snapshot(root, relative))
    else result[relative] = (await readFile(join(root, relative), 'utf8')).split(root).join('<workspace>')
  }
  return result
}

describe('Reviewer entry isolation', () => {
  test('shared controller changes only the approved routing adapter', () => {
    expect(restoreReviewEntry(controller)).toBe(approvedController)
  })
  test('entry has no access to global run, author internals or revision implementation', () => {
    const source = reviewEntrySource()
    for (const forbidden of ['DeliveryRun', 'foundationDraftState', 'foundation-authoring-', 'foundation-revision-', 'Partial<', 'controller', 'writeFile(']) expect(source).not.toContain(forbidden)
  })
  for (const scenario of ['valid', 'format-invalid', 'missing', 'incomplete-handoff', 'already-started'] as const) {
    test('matches approved state and disk artifacts: ' + scenario, async () => {
      const root = await mkdtemp(join(tmpdir(), 'review-entry-equivalence-'))
      setSystemTime(new Date('2026-09-05T00:00:00.000Z'))
      try {
        const previousPath = join(root, 'before')
        const currentPath = join(root, 'after')
        for (const workspace of [previousPath, currentPath]) {
          await mkdir(workspace)
          for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
            if (scenario === 'missing' && path === CANONICAL_FOUNDATION_DOCUMENTS[0]) continue
            await mkdir(dirname(join(workspace, path)), { recursive: true })
            await writeFile(join(workspace, path), scenario === 'format-invalid' ? '# Invalid' : renderTestCompleteGameDocument(path, completeTestSubmission(path)))
          }
        }
        const run = {
          revision: { document: 'fixture-review-revision' },
          foundationDraftState: { completedPaths: scenario === 'incomplete-handoff' ? [] : [...CANONICAL_FOUNDATION_DOCUMENTS] },
          ...(scenario === 'already-started' ? { foundationAuditState: { status: 'extracting_facts' } } : {}),
          runId: 'preserved-run', projectId: 'preserved-project',
          resourceProductionState: { sentinel: ['untouched'] },
        } as unknown as DeliveryRun
        const frozen = structuredClone(run)
        const previous = await executable(originalEntry)(run, previousPath)
        const current = await executable(currentEntry)(run, currentPath)
        expect(current).toEqual(previous)
        expect(run).toEqual(frozen)
        expect(await snapshot(currentPath)).toEqual(await snapshot(previousPath))
        if (scenario === 'format-invalid') expect(current.phase).toBe('FOUNDATION_REVISION')
        if (scenario === 'valid') expect(current.foundationAuditState?.status).toMatch(/^(extracting_facts|facts_staged)$/)
        if (scenario === 'missing' || scenario === 'incomplete-handoff') expect(current.status).toBe('needs_action')
        if (scenario === 'already-started') expect(current).toBe(run)
      } finally {
        setSystemTime()
        await rm(root, { recursive: true, force: true })
      }
    })
  }
})
