import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildDerivedDocumentManifest,
  buildDocumentAuditCoverage,
} from './document-audit-manifest'
import { runDocumentAuditLocalChecks } from './document-audit-local-checks'
import {
  completeTestSubmission,
  renderTestCompleteGameDocument,
} from '../../__tests__/complete-game-document-fixture'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'

const revision = 'document-audit-test-revision'
const workspaces: string[] = []

async function createCompleteWorkspace(): Promise<string> {
  const workspacePath = await mkdtemp(join(tmpdir(), 'document-audit-local-checks-'))
  workspaces.push(workspacePath)
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    const destination = join(workspacePath, path)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, renderTestCompleteGameDocument(path, completeTestSubmission(path)))
  }
  return workspacePath
}

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map(path => rm(path, { recursive: true, force: true })),
  )
})

describe('document audit local checks', () => {
  test('passes deterministic protocol and contract checks while escalating semantic checks', async () => {
    const manifest = await buildDerivedDocumentManifest({
      workspacePath: await createCompleteWorkspace(),
      revision,
    })
    const coverage = buildDocumentAuditCoverage({ sourceRevision: revision, manifest })
    const result = runDocumentAuditLocalChecks({ coverage, manifest })

    expect(result.results.every(item => item.status === 'PASS')).toBe(true)
    expect(result.escalatedCheckIds.every(checkId => !checkId.startsWith('global:'))).toBe(true)
    expect(result.metrics.l0Pass).toBe(4)
    expect(result.metrics.l1Pass).toBe(coverage.checks.filter(check => check.kind === 'contract').length)
    expect(result.metrics.escalated).toBe(coverage.checks.filter(check => check.kind !== 'global').length)
  })
})
