import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { advanceAcceptance } from './acceptance'
import type { RuntimeAcceptance } from '../../runtime-acceptance'
import type { AcceptanceInput } from '../acceptance-inputs'

const state: AcceptanceInput = { objective: 'Synthetic original requirements', status: 'active', phase: 'acceptance' }
const report: RuntimeAcceptance = { scope: 'delivery', status: 'failed', summary: 'Action violates saved rule',
  environment: 'Synthetic runtime', diagnostic: { category: 'product-failed', message: 'Action violates saved rule' },
  evidence: [{ path: 'evidence/rule.txt', sha256: '1'.repeat(64) }], artifacts: [{ path: 'dist', sha256: '2'.repeat(64) }] }

test('evidenced product defect returns to implementation, not design review or silent acceptance edits', async () => {
  const next = await advanceAcceptance('/unused', state, report)
  expect(next).toMatchObject({ phase: 'implementation', shouldContinue: true, issues: [report.summary] })
  expect(await advanceAcceptance('/unused', { ...state, lastValidationFailure: next.lastValidationFailure },
    { ...report, summary: 'Reworded same failure' })).toMatchObject({ phase: 'acceptance', shouldContinue: false })
  expect(await advanceAcceptance('/unused', { ...state, lastValidationFailure: next.lastValidationFailure },
    { ...report, evidence: [{ ...report.evidence[0]!, sha256: '3'.repeat(64) }] })).toMatchObject({ phase: 'implementation', shouldContinue: true })
})

test('environment, missing evidence and request-scope reports never dispatch product repair', async () => {
  for (const candidate of [
    { ...report, evidence: [] },
    { ...report, artifacts: [] },
    { ...report, scope: 'request' as const },
    { ...report, status: 'blocked' as const, diagnostic: { category: 'verification-incomplete' as const, message: 'Browser unavailable' } },
  ]) expect((await advanceAcceptance('/unused', state, candidate)).phase).toBe('acceptance')
})

test('an intact legacy failure marker is adopted as acceptance-owned evidence without another dispatch', async () => {
  const marker = 'acceptance-product-failed:' + createHash('sha256').update(JSON.stringify({
    evidence: report.evidence, artifacts: report.artifacts,
  })).digest('hex')
  const result = await advanceAcceptance('/unused', { ...state, lastValidationFailure: marker }, report)
  expect(result).toMatchObject({ phase: 'acceptance', shouldContinue: false })
  expect(result.lastProductFailureEvidence).toBeDefined()
  expect(await advanceAcceptance('/unused', { ...state, lastValidationFailure: 'Unrelated later error',
    lastProductFailureEvidence: result.lastProductFailureEvidence }, { ...report,
    artifacts: [{ path: 'dist', sha256: '4'.repeat(64) }] }))
    .toMatchObject({ phase: 'acceptance', shouldContinue: false })
})
