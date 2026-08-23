import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildDerivedDocumentManifest,
  buildDocumentAuditCoverage,
} from './document-audit-manifest'
import { GAME_DOCUMENT_CONTRACTS } from './game-document-contracts'
import {
  completeTestSubmission,
  renderTestCompleteGameDocument,
} from '../../__tests__/complete-game-document-fixture'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'

const revision = 'document-audit-test-revision'
const workspaces: string[] = []

async function createCompleteWorkspace(): Promise<string> {
  const workspacePath = await mkdtemp(join(tmpdir(), 'document-audit-manifest-'))
  workspaces.push(workspacePath)
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    const destination = join(workspacePath, path)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(
      destination,
      renderTestCompleteGameDocument(path, completeTestSubmission(path)),
    )
  }
  return workspacePath
}

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map(path => rm(path, { recursive: true, force: true })),
  )
})

describe('document audit coverage manifest', () => {
  test('covers every canonical section and declared upstream source exactly once', async () => {
    const manifest = await buildDerivedDocumentManifest({
      workspacePath: await createCompleteWorkspace(),
      revision,
    })
    const coverage = buildDocumentAuditCoverage({ sourceRevision: revision, manifest })

    const sectionChecks = coverage.checks.filter(check => check.kind === 'section')
    expect(new Set(sectionChecks.map(check => `${check.targetPath}#${check.targetSectionIds[0]}`))).toEqual(
      new Set(
        Object.values(GAME_DOCUMENT_CONTRACTS).flatMap(contract =>
          contract.sections.map(section => `${contract.path}#${section.sectionId}`),
        ),
      ),
    )

    const contractChecks = coverage.checks.filter(check => check.kind === 'contract')
    expect(new Set(contractChecks.map(check => `${check.sourcePath}#${check.sourceSectionIds[0]}->${check.targetPath}`))).toEqual(
      new Set(
        Object.values(GAME_DOCUMENT_CONTRACTS).flatMap(contract =>
          contract.upstreamSections.flatMap(upstream =>
            upstream.sectionIds.map(sectionId => `${upstream.path}#${sectionId}->${contract.path}`),
          ),
        ),
      ),
    )
    expect(new Set(coverage.checks.map(check => check.checkId)).size).toBe(coverage.checks.length)
    expect(new Set(sectionChecks.map(check => check.targetPath))).toEqual(new Set(CANONICAL_FOUNDATION_DOCUMENTS))
    expect(coverage.checks.filter(check => check.kind === 'global').map(check => check.checkId)).toEqual([
      'global:all-required-documents-present',
      'global:canonical-markdown-valid',
      'global:canonical-section-markers-valid',
      'global:production-material-markers-valid',
    ])
  })

  test('binds coverage to the exact manifest revision and digest', async () => {
    const manifest = await buildDerivedDocumentManifest({
      workspacePath: await createCompleteWorkspace(),
      revision,
    })
    const coverage = buildDocumentAuditCoverage({ sourceRevision: revision, manifest })
    expect(coverage.sourceRevision).toBe(revision)
    expect(coverage.manifestDigest).toBe(manifest.digest)
    expect(coverage.contractDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(coverage.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(coverage.checks.map(check => check.checkId)).toEqual(
      [...coverage.checks.map(check => check.checkId)].sort((left, right) =>
        Buffer.compare(Buffer.from(left), Buffer.from(right)),
      ),
    )
  })
})
